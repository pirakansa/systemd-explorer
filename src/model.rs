//! Versioned snapshot contract. Effective relationships, activation requests,
//! ordering constraints and observed timestamps are distinct concepts.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub schema_version: u32,
    pub metadata: Metadata,
    pub units: Vec<Unit>,
    pub relations: Vec<Relation>,
    pub timings: Vec<Timing>,
    pub devices: Vec<Device>,
    pub warnings: Vec<Warning>,
}
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Metadata {
    pub collected_at_unix_ms: u64,
    pub finished_at_unix_ms: u64,
    pub systemd_version: Option<String>,
    pub boot_id: Option<String>,
    pub boot_id_at_end: Option<String>,
    pub scope: String,
    pub history: String,
    pub diagnostics: Vec<Diagnostic>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Diagnostic {
    pub item: String,
    pub status: String,
    pub detail: String,
}
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Unit {
    pub name: String,
    pub unit_type: String,
    pub description: Option<String>,
    pub load_state: Option<String>,
    pub active_state: Option<String>,
    pub sub_state: Option<String>,
    pub unit_file_state: Option<String>,
    pub loaded: bool,
    pub installed: bool,
    pub unresolved: bool,
    pub fragment_path: Option<String>,
    pub drop_in_paths: Vec<String>,
    pub source_path: Option<String>,
    pub generator_hint: bool,
    pub default_dependencies: Option<bool>,
    pub need_daemon_reload: Option<bool>,
    pub install_wanted_by: Vec<String>,
    pub config_notes: Vec<String>,
    /// Allowlisted manager properties; missing values remain unknown.
    #[serde(default)]
    pub runtime_properties: BTreeMap<String, String>,
}
impl Unit {
    pub fn named(name: &str) -> Self {
        Self {
            name: name.into(),
            unit_type: name.rsplit_once('.').map_or("unknown", |(_, t)| t).into(),
            unresolved: true,
            ..Self::default()
        }
    }
}
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Relation {
    pub from: String,
    pub to: String,
    pub kind: String,
    pub evidence: String,
    pub source: String,
    pub confidence: String,
    pub origin: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Timing {
    pub unit: String,
    pub event: String,
    pub value: Option<u64>,
    pub clock: String,
    pub unit_of_time: String,
    pub certainty: String,
    pub source: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Device {
    pub unit: String,
    pub sysfs_path: String,
    pub properties: BTreeMap<String, String>,
    pub source: String,
    pub rule_origin: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct Warning {
    pub item: String,
    pub unit: Option<String>,
    pub message: String,
}
impl Snapshot {
    pub fn empty() -> Self {
        Self {
            schema_version: 1,
            metadata: Metadata {
                scope: "system".into(),
                history: "Latest manager timestamps only; not a complete boot or event history. Missing timestamps are unknown, not evidence of no activation.".into(),
                ..Metadata::default()
            },
            units: vec![], relations: vec![], timings: vec![], devices: vec![], warnings: vec![],
        }
    }
    pub fn warn(&mut self, item: &str, unit: Option<&str>, message: impl Into<String>) {
        self.warnings.push(Warning {
            item: item.into(),
            unit: unit.map(Into::into),
            message: message.into(),
        });
    }
    pub fn diagnostic(&mut self, item: &str, status: &str, detail: impl Into<String>) {
        self.metadata.diagnostics.push(Diagnostic {
            item: item.into(),
            status: status.into(),
            detail: detail.into(),
        });
    }
}
