use std::{fs, time::Duration};
use systemd_explorer::{
    collector::collect,
    command::{CommandError, ProcessRunner, Runner},
    model::Snapshot,
};

struct FixtureRunner {
    calls: Vec<(String, Vec<String>)>,
    fail_show: bool,
    fail_udev: bool,
    fallback: bool,
}
impl Runner for FixtureRunner {
    fn run(&mut self, program: &str, args: &[&str]) -> Result<String, CommandError> {
        self.calls
            .push((program.into(), args.iter().map(|s| s.to_string()).collect()));
        if args.contains(&"--version") {
            return Ok("systemd 257 (fixture)\n+PAM\n".into());
        }
        if args.contains(&"list-units") {
            if self.fallback && args.contains(&"--output=json") {
                return Err(CommandError::Exit("unsupported".into()));
            }
            return Ok(if self.fallback { "demo.service loaded active running description with spaces\nsys-devices-demo.device loaded active plugged demo\n" } else { include_str!("fixtures/loaded.json") }.into());
        }
        if args.contains(&"list-unit-files") {
            return Ok(r#"[{"unit_file":"not-loaded.service","state":"disabled"}]"#.into());
        }
        if args.contains(&"show") {
            return if self.fail_show {
                Err(CommandError::Timeout)
            } else {
                Ok(include_str!("fixtures/show.txt").into())
            };
        }
        if program == "udevadm" {
            return if self.fail_udev {
                Err(CommandError::Exit("permission denied".into()))
            } else {
                Ok("SYSTEMD_WANTS=demo.service\nSYSTEMD_READY=1\nTAGS=:systemd:\nSECRET_TOKEN=must-not-export\nID_SERIAL=private-device-id\n".into())
            };
        }
        Err(CommandError::Budget)
    }
}
fn fixture() -> FixtureRunner {
    FixtureRunner {
        calls: vec![],
        fail_show: false,
        fail_udev: false,
        fallback: false,
    }
}
#[test]
fn effective_disk_and_install_evidence_remain_distinct() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("not-loaded.service"), "[Unit]\nDescription=secret text not exported\n[Service]\nEnvironment=PASSWORD=never-export\n[Install]\nWantedBy=demo.target\n").unwrap();
    fs::create_dir(dir.path().join("demo.target.wants")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(
        "../not-loaded.service",
        dir.path().join("demo.target.wants/not-loaded.service"),
    )
    .unwrap();
    let mut runner = fixture();
    let s = collect(&mut runner, Some(vec![dir.path().into()]));
    let u = s.units.iter().find(|u| u.name == "demo.service").unwrap();
    assert_eq!(u.active_state.as_deref(), Some("active"));
    assert!(u.generator_hint);
    assert_eq!(u.drop_in_paths.len(), 2);
    assert_eq!(u.need_daemon_reload, Some(true));
    let inactive = s
        .units
        .iter()
        .find(|u| u.name == "not-loaded.service")
        .unwrap();
    assert!(inactive.installed && !inactive.loaded);
    assert_eq!(inactive.active_state, None);
    assert_eq!(inactive.install_wanted_by, ["demo.target"]);
    assert!(
        s.units
            .iter()
            .find(|u| u.name == "missing.mount")
            .unwrap()
            .unresolved
    );
    for kind in [
        "Requires",
        "Wants",
        "Requisite",
        "BindsTo",
        "PartOf",
        "Conflicts",
        "After",
        "Before",
        "Upholds",
        "TriggeredBy",
        "Triggers",
    ] {
        assert!(
            s.relations
                .iter()
                .any(|r| r.kind == kind && r.evidence == "effective" && r.origin == "undetermined")
        );
    }
    assert!(s.relations.iter().any(|r| r.evidence == "install_hint"));
    #[cfg(unix)]
    assert!(s.relations.iter().any(|r| r.evidence == "disk_symlink"));
    assert!(
        s.timings
            .iter()
            .any(|t| t.value == Some(1_250_000) && t.clock == "boot_monotonic")
    );
    assert!(
        s.timings
            .iter()
            .any(|t| t.value.is_none() && t.certainty == "unknown")
    );
    assert_eq!(s.devices[0].properties["SYSTEMD_WANTS"], "demo.service");
    let json = serde_json::to_string(&s).unwrap();
    for secret in [
        "must-not-export",
        "private-device-id",
        "PASSWORD",
        "secret text not exported",
    ] {
        assert!(!json.contains(secret));
    }
    for (_, args) in &runner.calls {
        assert!(
            !args
                .iter()
                .any(|a| ["start", "stop", "enable", "daemon-reload"].contains(&a.as_str()))
        );
        if args.contains(&"show".to_string()) {
            assert!(!args.contains(&"not-loaded.service".to_string()));
        }
    }
    let mut value = serde_json::to_value(&s).unwrap();
    value["future_field"] = serde_json::json!({"unknown":true});
    let decoded: Snapshot = serde_json::from_value(value).unwrap();
    assert_eq!(decoded.schema_version, 1);
}
#[test]
fn partial_failure_preserves_inventory_observations() {
    let dir = tempfile::tempdir().unwrap();
    let mut runner = fixture();
    runner.fail_show = true;
    runner.fallback = true;
    let s = collect(&mut runner, Some(vec![dir.path().into()]));
    assert_eq!(s.units.len(), 3);
    assert_eq!(
        s.units
            .iter()
            .find(|u| u.name == "demo.service")
            .unwrap()
            .active_state
            .as_deref(),
        Some("active")
    );
    assert!(
        s.warnings
            .iter()
            .any(|w| w.item == "properties" && w.unit.as_deref() == Some("demo.service"))
    );
    assert!(
        s.metadata
            .diagnostics
            .iter()
            .any(|d| d.status == "fallback")
    );
}
#[test]
fn udev_permission_failure_keeps_sysfs_mapping() {
    let dir = tempfile::tempdir().unwrap();
    let mut runner = fixture();
    runner.fail_udev = true;
    let s = collect(&mut runner, Some(vec![dir.path().into()]));
    assert_eq!(s.devices.len(), 1);
    assert!(s.devices[0].properties.is_empty());
    assert!(s.warnings.iter().any(|w| w.item == "udev"));
}
#[test]
fn exhausted_budget_still_produces_valid_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let mut runner = ProcessRunner::new(Duration::ZERO, Duration::ZERO);
    let s = collect(&mut runner, Some(vec![dir.path().into()]));
    assert!(s.units.is_empty());
    assert!(s.warnings.len() >= 3);
    assert!(serde_json::to_string(&s).is_ok());
}
#[test]
fn cli_rejects_invalid_arguments_and_never_overwrites() {
    let bin = env!("CARGO_BIN_EXE_systemd-explorer");
    assert!(
        !std::process::Command::new(bin)
            .args(["collect", "--timeout-seconds", "0"])
            .output()
            .unwrap()
            .status
            .success()
    );
    assert!(
        !std::process::Command::new(bin)
            .arg("start")
            .output()
            .unwrap()
            .status
            .success()
    );
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("existing.json");
    fs::write(&path, "original").unwrap();
    assert!(
        !std::process::Command::new(bin)
            .args(["collect", "--output"])
            .arg(&path)
            .output()
            .unwrap()
            .status
            .success()
    );
    assert_eq!(fs::read_to_string(path).unwrap(), "original");
}

#[test]
fn failed_batch_recovers_individual_units() {
    struct DisappearingBatch(FixtureRunner);
    impl Runner for DisappearingBatch {
        fn run(&mut self, program: &str, args: &[&str]) -> Result<String, CommandError> {
            if args.first() == Some(&"show") {
                let names: Vec<_> = args.iter().skip_while(|a| **a != "--").skip(1).collect();
                if names.len() > 1 {
                    return Err(CommandError::Exit("one unit disappeared".into()));
                }
                return Ok(include_str!("fixtures/show.txt")
                    .split("\n\n")
                    .find(|block| block.starts_with(&format!("Id={}\n", names[0])))
                    .unwrap()
                    .to_owned());
            }
            self.0.run(program, args)
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let mut r = DisappearingBatch(fixture());
    let s = collect(&mut r, Some(vec![dir.path().into()]));
    assert!(
        s.units
            .iter()
            .any(|u| u.name == "demo.service" && u.fragment_path.is_some())
    );
    assert_eq!(s.devices.len(), 1);
    assert_eq!(
        s.metadata
            .diagnostics
            .iter()
            .filter(|d| d.item.starts_with("properties:") && d.status == "fallback")
            .count(),
        2
    );
}

#[test]
fn samples_follow_the_rust_contract() {
    for json in [
        include_str!("../viewer/samples/small.json"),
        include_str!("../viewer/samples/medium.json"),
    ] {
        let s: Snapshot = serde_json::from_str(json).unwrap();
        assert_eq!(s.schema_version, 1);
        assert!(!s.units.is_empty());
        assert!(s.units.iter().any(|u| u.unit_type == "device"));
        assert!(s.relations.iter().any(|r| r.kind == "After"));
    }
}
