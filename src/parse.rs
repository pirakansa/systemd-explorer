//! Parsers for machine-readable JSON and systemctl's key=value property interface.
use serde_json::Value;
use std::collections::BTreeMap;

pub const RELATION_KINDS: &[&str] = &[
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
    "OnFailure",
    "OnSuccess",
    "PropagatesStopTo",
    "StopPropagatedFrom",
];
pub const TIMESTAMP_PROPERTIES: &[&str] = &[
    "InactiveExitTimestampMonotonic",
    "ActiveEnterTimestampMonotonic",
    "ActiveExitTimestampMonotonic",
    "InactiveEnterTimestampMonotonic",
];
pub const COMMON_RUNTIME_PROPERTIES: &[&str] = &[
    "ConditionResult",
    "AssertResult",
    "ConditionTimestampMonotonic",
    "AssertTimestampMonotonic",
];
pub const SERVICE_PROPERTIES: &[&str] = &[
    "Type",
    "RemainAfterExit",
    "NotifyAccess",
    "Result",
    "ExecMainCode",
    "ExecMainStatus",
];
pub const MOUNT_PROPERTIES: &[&str] = &["Where", "What", "Type", "Result"];
pub const BASE_PROPERTIES: &str = "Id,Names,Description,LoadState,ActiveState,SubState,UnitFileState,FragmentPath,DropInPaths,SourcePath,DefaultDependencies,NeedDaemonReload,SysFSPath,InactiveExitTimestampMonotonic,ActiveEnterTimestampMonotonic,ActiveExitTimestampMonotonic,InactiveEnterTimestampMonotonic";

pub fn properties(input: &str) -> Vec<BTreeMap<String, String>> {
    input
        .split("\n\n")
        .filter_map(|block| {
            let map: BTreeMap<_, _> = block
                .lines()
                .filter_map(|line| line.split_once('='))
                .map(|(k, v)| (k.to_owned(), v.to_owned()))
                .collect();
            map.contains_key("Id").then_some(map)
        })
        .collect()
}
pub fn valid_unit(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && name.contains('.')
        && name
            .bytes()
            .all(|c| c.is_ascii_graphic() && c != b'/' && c != b'"' && c != b'\'')
}
#[derive(Debug)]
pub struct InventoryEntry {
    pub name: String,
    pub state: String,
    pub active_state: Option<String>,
    pub sub_state: Option<String>,
    pub description: Option<String>,
}
/// The fallback reads only name/load/active/sub columns, never descriptions.
pub fn inventory(input: &str, installed: bool, json: bool) -> Result<Vec<InventoryEntry>, String> {
    let mut rows = vec![];
    if json {
        let value: Value = serde_json::from_str(input).map_err(|e| e.to_string())?;
        for row in value.as_array().ok_or("inventory is not an array")? {
            let string = |key| row.get(key).and_then(Value::as_str).map(str::to_owned);
            let name =
                string(if installed { "unit_file" } else { "unit" }).ok_or("missing unit name")?;
            if !valid_unit(&name) {
                return Err("invalid inventory unit name".into());
            }
            rows.push(InventoryEntry {
                name,
                state: string(if installed { "state" } else { "load" }).unwrap_or("unknown".into()),
                active_state: string("active"),
                sub_state: string("sub"),
                description: string("description"),
            });
        }
    } else {
        for line in input.lines().filter(|l| !l.trim().is_empty()) {
            let mut fields = line.split_whitespace();
            let name = fields.next().ok_or("missing name")?;
            let state = fields.next().ok_or("missing state")?;
            if !valid_unit(name) {
                return Err("unrecognized fallback inventory format".into());
            }
            let (active_state, sub_state) = if installed {
                (None, None)
            } else {
                (
                    Some(fields.next().ok_or("missing active state")?.into()),
                    Some(fields.next().ok_or("missing sub state")?.into()),
                )
            };
            rows.push(InventoryEntry {
                name: name.into(),
                state: state.into(),
                active_state,
                sub_state,
                description: None,
            });
        }
    }
    Ok(rows)
}
/// Parse only the requested Install directives; raw file content is never stored.
/// These are disk hints, not effective manager relationships.
pub fn install_hints(input: &str) -> (Vec<String>, bool) {
    let mut in_install = false;
    let mut wanted = vec![];
    let mut incomplete = false;
    let mut pending = String::new();
    for line in input.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(part) = line.strip_suffix('\\') {
            pending.push_str(part);
            pending.push(' ');
            continue;
        }
        pending.push_str(line);
        let logical = pending.trim();
        if logical.starts_with('[') {
            in_install = logical == "[Install]";
        } else if in_install
            && let Some((key, value)) = logical.split_once('=')
            && key.trim() == "WantedBy"
        {
            if value.trim().is_empty() {
                wanted.clear();
            } else {
                for name in value.split_whitespace() {
                    if valid_unit(name) && !name.contains('%') && !name.contains('"') {
                        wanted.push(name.into());
                    } else {
                        incomplete = true;
                    }
                }
            }
        }
        pending.clear();
    }
    (wanted, incomplete || !pending.is_empty())
}
/// Split quoted paths without invoking a shell. Unknown escapes are retained.
pub fn path_words(input: &str) -> Vec<String> {
    let mut words = vec![];
    let mut word = Vec::new();
    let mut quote = None;
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' | '\'' if quote == Some(c) => quote = None,
            '"' | '\'' if quote.is_none() => quote = Some(c),
            c if c.is_whitespace() && quote.is_none() => {
                if !word.is_empty() {
                    words.push(String::from_utf8_lossy(&word).into_owned());
                    word.clear();
                }
            }
            '\\' => match chars.next() {
                Some('x') => {
                    let a = chars.next();
                    let b = chars.next();
                    if let (Some(a), Some(b)) = (a, b) {
                        if let Ok(byte) = u8::from_str_radix(&format!("{a}{b}"), 16) {
                            word.push(byte);
                        } else {
                            word.extend_from_slice(format!("\\x{a}{b}").as_bytes());
                        }
                    } else {
                        word.extend_from_slice(b"\\x");
                        if let Some(a) = a {
                            word.extend_from_slice(a.to_string().as_bytes());
                        }
                    }
                }
                Some('s') => word.push(b' '),
                Some(c @ ('\\' | '"' | '\'' | ' ')) => word.push(c as u8),
                Some(c) => {
                    word.push(b'\\');
                    word.extend_from_slice(c.to_string().as_bytes());
                }
                None => word.push(b'\\'),
            },
            _ => word.extend_from_slice(c.to_string().as_bytes()),
        }
    }
    if !word.is_empty() {
        words.push(String::from_utf8_lossy(&word).into_owned());
    }
    words
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn property_values_can_contain_equals_and_empty_values() {
        let rows =
            properties("Id=a.service\nDescription=a=b\nAfter=\n\nId=b.target\nLoadState=loaded\n");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["Description"], "a=b");
        assert_eq!(rows[0]["After"], "");
    }
    #[test]
    fn inventories_and_malformed_data() {
        assert_eq!(
            inventory(
                r#"[{"unit_file":"a.service","state":"disabled","future":true}]"#,
                true,
                true
            )
            .unwrap()[0]
                .state,
            "disabled"
        );
        assert!(inventory("{}", false, true).is_err());
        assert!(inventory("header text", false, false).is_err());
        assert!(inventory(r#"[{"unit":"bad/name.service"}]"#, false, true).is_err());
        assert!(valid_unit("-.mount"));
        assert!(inventory(r#"[{"unit":"-.mount","load":"loaded"}]"#, false, true).is_ok());
    }
    #[test]
    fn install_is_not_runtime_and_handles_resets() {
        let (hints, incomplete) = install_hints(
            "[Unit]\nWantedBy=wrong.target\n[Install]\nWantedBy=old.target\nWantedBy=\nWantedBy=one.target \\\n two.target %i.target\n",
        );
        assert_eq!(hints, ["one.target", "two.target"]);
        assert!(incomplete);
    }
    #[test]
    fn path_quoting() {
        assert_eq!(
            path_words(r#"/a.conf "/b c.conf" /d\x20e.conf"#),
            ["/a.conf", "/b c.conf", "/d e.conf"]
        );
        assert_eq!(path_words(r"/caf\xc3\xa9.conf"), ["/café.conf"]);
        assert_eq!(path_words(r"/incomplete\x4"), [r"/incomplete\x4"]);
    }
}
