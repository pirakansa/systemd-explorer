//! Collection orchestration. No management operations and no raw journal/config export.
use crate::{
    command::Runner,
    model::*,
    parse::{self, RELATION_KINDS, TIMESTAMP_PROPERTIES},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const SHOW_BATCH: usize = 64;
const MAX_CONFIG_BYTES: u64 = 256 * 1024;
const MAX_UNITS: usize = 50_000;
const MAX_SAFE_TIMESTAMP: u64 = 9_007_199_254_740_991;
const FALLBACK_PATHS: &[&str] = &[
    "/etc/systemd/system.control",
    "/run/systemd/system.control",
    "/run/systemd/transient",
    "/run/systemd/generator.early",
    "/etc/systemd/system",
    "/run/systemd/system",
    "/run/systemd/generator",
    "/usr/local/lib/systemd/system",
    "/usr/lib/systemd/system",
    "/lib/systemd/system",
    "/run/systemd/generator.late",
];

pub fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
fn boot_id() -> Option<String> {
    fs::read_to_string("/proc/sys/kernel/random/boot_id")
        .ok()
        .map(|s| s.trim().into())
}
fn command(
    r: &mut impl Runner,
    s: &mut Snapshot,
    item: &str,
    program: &str,
    args: &[&str],
) -> Option<String> {
    match r.run(program, args) {
        Ok(v) => {
            s.diagnostic(item, "ok", format!("{program}: observation completed"));
            Some(v)
        }
        Err(e) => {
            s.diagnostic(item, "unavailable", e.to_string());
            s.warn(item, None, e.to_string());
            None
        }
    }
}
fn get_inventory(
    r: &mut impl Runner,
    s: &mut Snapshot,
    installed: bool,
) -> Vec<parse::InventoryEntry> {
    let op = if installed {
        "list-unit-files"
    } else {
        "list-units"
    };
    let args = [
        op,
        "--all",
        "--no-pager",
        "--no-legend",
        "--plain",
        "--output=json",
    ];
    match r
        .run("systemctl", &args)
        .map_err(|e| e.to_string())
        .and_then(|text| parse::inventory(&text, installed, true))
    {
        Ok(rows) => {
            s.diagnostic(op, "ok", "JSON inventory");
            rows
        }
        Err(e) => {
            s.warn(
                op,
                None,
                format!("JSON inventory unavailable ({e}); trying name/state column fallback."),
            );
            let fallback = [
                op,
                "--all",
                "--no-pager",
                "--no-legend",
                "--plain",
                "--full",
            ];
            match r
                .run("systemctl", &fallback)
                .map_err(|e| e.to_string())
                .and_then(|text| parse::inventory(&text, installed, false))
            {
                Ok(rows) => {
                    s.diagnostic(
                        op,
                        "fallback",
                        "Name/load/active/sub columns parsed; descriptions come from properties",
                    );
                    rows
                }
                Err(e) => {
                    s.warn(op, None, &e);
                    s.diagnostic(op, "unavailable", e);
                    vec![]
                }
            }
        }
    }
}
fn relation(from: &str, to: &str, kind: &str, evidence: &str, source: String) -> Relation {
    Relation {
        from: from.into(),
        to: to.into(),
        kind: kind.into(),
        evidence: evidence.into(),
        source,
        confidence: "observed".into(),
        origin: "undetermined".into(),
    }
}
fn optional(map: &BTreeMap<String, String>, key: &str) -> Option<String> {
    map.get(key).filter(|v| !v.is_empty()).cloned()
}
fn boolean(map: &BTreeMap<String, String>, key: &str) -> Option<bool> {
    match map.get(key).map(String::as_str) {
        Some("yes") => Some(true),
        Some("no") => Some(false),
        _ => None,
    }
}
fn apply_properties(
    s: &mut Snapshot,
    units: &mut BTreeMap<String, Unit>,
    p: BTreeMap<String, String>,
    r: &mut impl Runner,
) {
    let Some(name) = p.get("Id").filter(|n| parse::valid_unit(n)) else {
        return;
    };
    let u = units
        .entry(name.clone())
        .or_insert_with(|| Unit::named(name));
    u.unresolved = false;
    u.loaded = true;
    u.description = optional(&p, "Description");
    u.load_state = optional(&p, "LoadState");
    u.active_state = optional(&p, "ActiveState");
    u.sub_state = optional(&p, "SubState");
    let specific = match u.unit_type.as_str() {
        "service" => parse::SERVICE_PROPERTIES,
        "mount" => parse::MOUNT_PROPERTIES,
        _ => &[],
    };
    let mut missing = Vec::new();
    for key in parse::COMMON_RUNTIME_PROPERTIES.iter().chain(specific) {
        if let Some(value) = optional(&p, key) {
            // Never export mount source userinfo or inline password-like material.
            if *key == "What"
                && (value.contains(['@', '?', '#'])
                    || value.contains("://")
                    || value.to_ascii_lowercase().contains("password="))
            {
                s.warn(
                    "runtime-properties",
                    Some(name),
                    "Mount source omitted because it may contain credentials.",
                );
                continue;
            }
            u.runtime_properties.insert((*key).into(), value);
        } else {
            missing.push(*key);
        }
    }
    if !missing.is_empty() {
        s.warn("runtime-properties", Some(name), format!("Properties unavailable or empty: {}. Older snapshots and unsupported properties remain unknown.", missing.join(", ")));
    }

    if let Some(state) = optional(&p, "UnitFileState") {
        u.unit_file_state = Some(state);
    }
    u.fragment_path = optional(&p, "FragmentPath");
    u.source_path = optional(&p, "SourcePath");
    u.drop_in_paths = parse::path_words(p.get("DropInPaths").map_or("", String::as_str));
    u.default_dependencies = boolean(&p, "DefaultDependencies");
    u.need_daemon_reload = boolean(&p, "NeedDaemonReload");
    u.generator_hint = u.fragment_path.as_deref().is_some_and(|path| {
        [
            "/run/systemd/generator/",
            "/run/systemd/generator.early/",
            "/run/systemd/generator.late/",
        ]
        .iter()
        .any(|root| path.starts_with(root))
    });
    u.config_notes.push("Effective relation origins are undetermined; explicit, implicit, generator and default dependencies may coexist. Disk files may differ from loaded settings.".into());
    if u.need_daemon_reload == Some(true) {
        s.warn(
            "configuration",
            Some(name),
            "Manager reports NeedDaemonReload=yes; disk and loaded configuration differ.",
        );
    }
    for kind in RELATION_KINDS {
        if let Some(targets) = p.get(*kind) {
            for to in targets.split_whitespace().filter(|n| parse::valid_unit(n)) {
                s.relations.push(relation(
                    name,
                    to,
                    kind,
                    "effective",
                    format!("systemctl show: {kind}"),
                ));
            }
        }
    }
    for prop in TIMESTAMP_PROPERTIES {
        let value = p
            .get(*prop)
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v > 0 && *v <= MAX_SAFE_TIMESTAMP);
        s.timings.push(Timing {
            unit: name.clone(),
            event: (*prop).into(),
            value,
            clock: "boot_monotonic".into(),
            unit_of_time: "microseconds".into(),
            certainty: if value.is_some() {
                "observed"
            } else {
                "unknown"
            }
            .into(),
            source: format!("systemctl show: {prop}"),
        });
    }
    if u.unit_type == "device" {
        if let Some(path) = optional(&p, "SysFSPath").filter(|p| p.starts_with("/sys/")) {
            let mut properties = BTreeMap::new();
            match r.run("udevadm", &["info", "--query=property", "--path", &path]) {
                Ok(text) => {
                    for line in text.lines() {
                        if let Some((k, v)) = line.split_once('=')
                            && [
                                "SYSTEMD_WANTS",
                                "SYSTEMD_USER_WANTS",
                                "SYSTEMD_READY",
                                "TAGS",
                                "CURRENT_TAGS",
                                "DEVPATH",
                                "SUBSYSTEM",
                            ]
                            .contains(&k)
                        {
                            properties.insert(k.into(), v.into());
                        }
                    }
                    s.diagnostic(
                        &format!("udev:{name}"),
                        "ok",
                        "Allowlisted device properties only",
                    );
                }
                Err(e) => {
                    s.warn("udev", Some(name), e.to_string());
                    s.diagnostic(&format!("udev:{name}"), "unavailable", e.to_string());
                }
            }
            s.devices.push(Device {
                unit: name.clone(),
                sysfs_path: path,
                properties,
                source: "manager SysFSPath + udevadm info".into(),
                rule_origin: "undetermined; no event history collected".into(),
            });
        } else {
            s.warn(
                "udev",
                Some(name),
                "SysFSPath unavailable; no device mapping inferred from escaped unit name.",
            );
        }
    }
}
fn read_config(path: &Path) -> Result<String, String> {
    if !fs::metadata(path).map_err(|e| e.to_string())?.is_file() {
        return Err("not a regular file".into());
    }
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("not a regular file".into());
    }
    let mut text = String::new();
    file.take(MAX_CONFIG_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() as u64 > MAX_CONFIG_BYTES {
        return Err("configuration exceeds 256 KiB limit".into());
    }
    Ok(text)
}
fn disk_hints(
    s: &mut Snapshot,
    units: &mut BTreeMap<String, Unit>,
    paths: &[PathBuf],
    r: &impl Runner,
) {
    for root in paths {
        let entries = match fs::read_dir(root) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => {
                s.warn("unit-paths", None, format!("{}: {e}", root.display()));
                continue;
            }
        };
        for entry in entries {
            if r.exhausted() {
                s.warn(
                    "disk-hints",
                    None,
                    "Collection budget exhausted; disk hints incomplete.",
                );
                return;
            }
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    s.warn("unit-paths", None, e.to_string());
                    continue;
                }
            };
            let name = entry.file_name().to_string_lossy().into_owned();
            let (owner, kind) = if let Some(n) = name.strip_suffix(".wants") {
                (n, "Wants")
            } else if let Some(n) = name.strip_suffix(".requires") {
                (n, "Requires")
            } else {
                continue;
            };
            if !parse::valid_unit(owner) {
                continue;
            }
            // Do not follow a directory symlink to arbitrary locations.
            if !entry.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            match fs::read_dir(entry.path()) {
                Ok(links) => {
                    for link in links {
                        let Ok(link) = link else {
                            continue;
                        };
                        let target = link.file_name().to_string_lossy().into_owned();
                        if parse::valid_unit(&target)
                            && let Ok(dest) = fs::read_link(link.path())
                        {
                            s.relations.push(relation(
                                owner,
                                &target,
                                kind,
                                "disk_symlink",
                                format!("{} -> {}", link.path().display(), dest.display()),
                            ));
                        }
                    }
                }
                Err(e) => s.warn("symlinks", Some(owner), e.to_string()),
            }
        }
    }
    for u in units
        .values_mut()
        .filter(|u| u.installed || u.fragment_path.is_some())
    {
        if r.exhausted() {
            s.warn(
                "disk-hints",
                None,
                "Collection budget exhausted; disk hints incomplete.",
            );
            return;
        }
        let path = u.fragment_path.as_ref().map(PathBuf::from).or_else(|| {
            paths
                .iter()
                .map(|p| p.join(&u.name))
                .find(|p| p.symlink_metadata().is_ok())
        });
        if let Some(path) = path {
            match read_config(&path) {
                Ok(text) => {
                    let (wanted, incomplete) = parse::install_hints(&text);
                    for target in &wanted {
                        s.relations.push(relation(
                            target,
                            &u.name,
                            "Wants",
                            "install_hint",
                            format!("{}: [Install] WantedBy (not effective)", path.display()),
                        ));
                    }
                    u.install_wanted_by = wanted;
                    u.config_notes.push(format!("Read only [Install] WantedBy from {}; fragment-only disk hint, not merged with drop-ins or enablement proof.", path.display()));
                    if incomplete {
                        s.warn(
                            "install-hints",
                            Some(&u.name),
                            "Unsupported specifier, quoting or incomplete continuation omitted.",
                        );
                    }
                }
                Err(e) => s.warn(
                    "install-hints",
                    Some(&u.name),
                    format!("{}: {e}", path.display()),
                ),
            }
        } else {
            s.warn(
                "install-hints",
                Some(&u.name),
                "Unit fragment not found in known system unit paths.",
            );
        }
    }
    s.diagnostic("disk-hints", "partial", "Best effort top-level .wants/.requires links and fragment-only WantedBy; not an effective merged configuration parser");
}
/// `unit_paths` can be injected to keep fixture tests entirely within a temp directory.
pub fn collect(r: &mut impl Runner, unit_paths: Option<Vec<PathBuf>>) -> Snapshot {
    let mut s = Snapshot::empty();
    s.metadata.collected_at_unix_ms = unix_ms();
    s.metadata.boot_id = boot_id();
    s.metadata.systemd_version = command(r, &mut s, "version", "systemctl", &["--version"])
        .and_then(|v| v.lines().next().map(str::to_owned));
    let mut units = BTreeMap::new();
    let loaded = get_inventory(r, &mut s, false);
    let installed = get_inventory(r, &mut s, true);
    for entry in loaded.iter().take(MAX_UNITS) {
        let (name, state) = (&entry.name, &entry.state);
        let u = units
            .entry(name.clone())
            .or_insert_with(|| Unit::named(name));
        u.loaded = true;
        u.unresolved = false;
        u.load_state = Some(state.clone());
        u.active_state = entry.active_state.clone();
        u.sub_state = entry.sub_state.clone();
        u.description = entry.description.clone();
    }
    for entry in installed.iter().take(MAX_UNITS) {
        let (name, state) = (&entry.name, &entry.state);
        let u = units
            .entry(name.clone())
            .or_insert_with(|| Unit::named(name));
        u.installed = true;
        u.unresolved = false;
        u.unit_file_state = Some(state.clone());
        u.config_notes.push("Installed inventory entry; runtime properties are queried only for units already loaded, to avoid loading inactive units for inspection.".into());
    }
    if loaded.len() > MAX_UNITS || installed.len() > MAX_UNITS {
        s.warn(
            "inventory",
            None,
            "Inventory truncated at 50,000 entries per source.",
        );
    }
    let properties = format!(
        "--property={},{},{},{},{}",
        parse::BASE_PROPERTIES,
        RELATION_KINDS.join(","),
        parse::COMMON_RUNTIME_PROPERTIES.join(","),
        parse::SERVICE_PROPERTIES.join(","),
        parse::MOUNT_PROPERTIES.join(",")
    );
    for batch in loaded
        .chunks(SHOW_BATCH)
        .take(MAX_UNITS.div_ceil(SHOW_BATCH))
    {
        let mut args = vec!["show", "--no-pager", "--all", &properties, "--"];
        args.extend(batch.iter().map(|entry| entry.name.as_str()));
        match r.run("systemctl", &args) {
            Ok(text) => {
                let rows = parse::properties(&text);
                let mut seen = BTreeSet::new();
                for row in rows {
                    if let Some(names) = row.get("Names") {
                        seen.extend(names.split_whitespace().map(str::to_owned));
                    }
                    if let Some(id) = row.get("Id") {
                        seen.insert(id.clone());
                    }
                    apply_properties(&mut s, &mut units, row, r);
                }
                for entry in batch {
                    let name = &entry.name;
                    if !seen.contains(name) {
                        s.warn("properties", Some(name), "No property record returned; unit may have disappeared during collection.");
                    }
                }
                s.diagnostic(
                    "properties-batch",
                    "ok",
                    format!("{} requested loaded units", batch.len()),
                );
            }
            Err(e) => {
                s.diagnostic("properties-batch", "unavailable", e.to_string());
                for entry in batch {
                    let name = &entry.name;
                    if batch.len() > 1 && !r.exhausted() {
                        let single = ["show", "--no-pager", "--all", &properties, "--", name];
                        if let Ok(text) = r.run("systemctl", &single) {
                            let rows = parse::properties(&text);
                            if !rows.is_empty() {
                                for row in rows {
                                    apply_properties(&mut s, &mut units, row, r);
                                }
                                s.diagnostic(
                                    &format!("properties:{name}"),
                                    "fallback",
                                    "Recovered by individual query after batch failure",
                                );
                                continue;
                            }
                        }
                    }
                    s.warn("properties", Some(name), e.to_string());
                }
            }
        }
    }
    let paths = unit_paths.unwrap_or_else(|| {
        match r.run("systemd-analyze", &["unit-paths"]) {
            Ok(text) => {
                let paths: Vec<_> = text
                    .lines()
                    .filter(|p| p.starts_with('/'))
                    .map(PathBuf::from)
                    .collect();
                if !paths.is_empty() {
                    s.diagnostic("unit-paths", "ok", "systemd-analyze unit-paths");
                    return paths;
                }
                s.warn(
                    "unit-paths",
                    None,
                    "No absolute unit paths returned; using standard system directories.",
                );
            }
            Err(e) => s.warn(
                "unit-paths",
                None,
                format!("{e}; using standard system directories"),
            ),
        }
        FALLBACK_PATHS.iter().map(PathBuf::from).collect()
    });
    disk_hints(&mut s, &mut units, &paths, r);
    // Monotonic manager properties are the version-independent timing fallback.
    // Do not collect plot payloads which may include more than the allowlisted data.
    s.diagnostic("timings", "partial", "Latest boot-monotonic manager properties; plot JSON not collected; full boot/event history unavailable");
    s.relations.sort_by(|a, b| {
        (&a.from, &a.to, &a.kind, &a.evidence, &a.source).cmp(&(
            &b.from,
            &b.to,
            &b.kind,
            &b.evidence,
            &b.source,
        ))
    });
    s.relations.dedup_by(|a, b| {
        a.from == b.from
            && a.to == b.to
            && a.kind == b.kind
            && a.evidence == b.evidence
            && a.source == b.source
    });
    for edge in &s.relations {
        for name in [&edge.from, &edge.to] {
            units
                .entry(name.clone())
                .or_insert_with(|| Unit::named(name));
        }
    }
    s.units = units.into_values().collect();
    s.metadata.boot_id_at_end = boot_id();
    if s.metadata.boot_id != s.metadata.boot_id_at_end {
        s.warn(
            "boot",
            None,
            "Boot ID changed during collection; timestamps cannot be compared safely.",
        );
    }
    if s.metadata.boot_id.is_none() {
        s.warn("boot", None, "Boot ID unavailable; boot context unknown.");
    }
    s.metadata.finished_at_unix_ms = unix_ms();
    s.warn("consistency", None, "Collection is not atomic: manager state, disk files and udev properties were observed at different instants. Origins and complete activation causes are undetermined.");
    s
}
