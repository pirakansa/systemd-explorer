# Snapshot and graph contract

The machine-readable contract is [snapshot.schema.json](snapshot.schema.json) (JSON Schema 2020-12). Rust types live in `src/model.rs`. `schema_version` is currently **1**; optional future fields can be ignored. The viewer validates structural essentials, accepts unknown fields and rejects unknown major schema versions. JSON Schema is the stricter export contract; browser validation is intentionally tolerant of missing nonessential fields.

## Collections

| Field | Meaning |
| --- | --- |
| `metadata` | Collection start/end Unix milliseconds, local `systemctl --version` (the running manager may differ after an upgrade), boot ID before/after, system-manager scope, history disclaimer, per-item diagnostics |
| `units` | Union of loaded inventory, installed inventory and unresolved relation endpoints; unit type is the suffix, including unknown future suffixes |
| `relations` | Directed property records or disk clues, each with `from`, `to`, `kind`, `evidence`, `source`, `confidence`, `origin` |
| `timings` | Latest manager transition properties, with explicit clock, unit, certainty and nullable value |
| `devices` | Manager `SysFSPath` mapping and allowlisted udev properties; exact rule origin undetermined |
| `warnings` | Item, optional unit name and explanation of missing data, uncertainty or collection inconsistency |

Unit fields preserve description, load/active/sub/file states, loaded/installed flags, unresolved flag, fragment/drop-in/source paths, generator-directory clue, `DefaultDependencies`, `NeedDaemonReload`, fragment-only `install_wanted_by` and explanatory `config_notes`. Unknown values use null or empty arrays, not invented inactive/disabled values. Installed units are not loaded for inspection. Aliases returned by property queries are not expanded into extra identity edges.

## Relation semantics

**Effective relationships**, **activation requests**, **ordering constraints**, and **observed times** are separate dimensions. The collector never infers ordering from timestamps or an activation request from `After`.

All arrows retain the original property orientation: a property on **A** naming **B** is **A → B**. Do not reverse `After` to make it look like a chronological dependency. The UI explains the property meaning explicitly:

| Kind | Meaning of A → B |
| --- | --- |
| `Wants`, `Requires` | Activation of A pulls B into a transaction, with differing failure semantics; neither alone implies ordering |
| `BindsTo` | Strong requirement and lifetime coupling; ordering still needs a separate constraint |
| `Upholds` | While A is active, B is kept active as supported by the manager |
| `Requisite` | Checks that B is active; does not start B |
| `After` | If both are in the relevant transaction, A is ordered after B; it does not pull B in |
| `Before` | A is ordered before B; it does not pull B in |
| `PartOf` | Stop/restart propagation from B to A, not a startup requirement |
| `Conflicts` | Exclusion relationship, not an activation request |
| `Triggers`, `TriggeredBy` | Trigger association, not proof of an observed activation event |
| `OnFailure`, `OnSuccess` | Conditional follow-up units, not unconditional startup requests |
| `PropagatesStopTo`, `StopPropagatedFrom` | Stop propagation associations |

Shutdown ordering and specific failure behavior are more nuanced than graph reachability. This is an evidence browser, not a systemd transaction simulator. Inverse properties can coexist (A `Before` B and B `After` A), so two records can represent the same ordering constraint. No topological timeline is synthesized from this graph.

### Evidence and origin

- `effective`: a named property from `systemctl show` of a unit in the loaded inventory. This is the manager's observed relationship, including whatever explicit, default, implicit, generator or runtime sources contributed. **`origin: undetermined`** is intentional; `confidence: observed` confirms the property observation, not a causal attribution.
- `disk_symlink`: a symbolic link directly under a `.wants/` or `.requires/` directory in discovered system unit paths. Source records link path and destination. It may be shadowed, dangling, stale or not yet loaded; it is not asserted to be effective.
- `install_hint`: fragment-only `[Install] WantedBy` interpreted as a potential target → unit `Wants` relation. It indicates installation intent, not enablement or a manager edge. This small parser supports reset assignments and continuations, skips unsupported specifiers/quoting with warnings, and does not merge drop-ins or evaluate full systemd configuration syntax.

Disk layers are dotted and off by default; effective edges are solid except ordering edges, which are dashed. Blue is activation-request coupling, amber is ordering, purple covers checks/propagation/conflicts/triggers and unknown kinds. A fragment under `/run/systemd/generator*` is a positive generator clue only. `SourcePath` and `DefaultDependencies` do not prove the origin of an individual edge. `NeedDaemonReload=yes` adds a warning; false does not guarantee a consistent filesystem observation.

## Time interpretation

Metadata wall times use Unix **milliseconds**. Unit timing values use **microseconds** with `clock: boot_monotonic`; they are not Unix times. `certainty: observed` applies only to a positive, representable timestamp returned by the manager. Zero, missing, invalid and values above JavaScript's safe integer range become null with `certainty: unknown`.

Collected events are `InactiveExitTimestampMonotonic`, `ActiveEnterTimestampMonotonic`, `ActiveExitTimestampMonotonic`, and `InactiveEnterTimestampMonotonic`. These are the latest transitions retained by the manager, possibly from a restart later in this boot; their differences are not universally service execution durations. The viewer only plots comparable, observed active-entry timestamps. Suspended time may differ from wall-clock elapsed time. Negative/pre-userspace boot stages are not reconstructed.

The collector uses manager timestamp properties as its compatibility path on all versions. It does not require `systemd-analyze plot --json=short` and does not collect plot payloads, journals, event history or `systemd-analyze dump`. A boot ID mismatch produces a warning. A matching ID does not make the collection atomic.

## Device information and minimization

`.device` units are queried for `SysFSPath`. Only an observed path under `/sys/` is sent to `udevadm info --query=property --path <path>`. Unit names are not guessed/unescaped into sysfs paths. Allowlisted properties are `SYSTEMD_WANTS`, `SYSTEMD_USER_WANTS`, `SYSTEMD_READY`, `TAGS`, `CURRENT_TAGS`, `DEVPATH`, `SUBSYSTEM`. User-manager wants remain a property hint; they are not system-manager effective edges.

A failed udev query preserves the sysfs mapping and a unit warning. No precise udev rule provenance or event history is inferred. `SYSTEMD_WANTS` alone does not prove that an event caused activation or that `SYSTEMD_READY` was true at that time. No device serial numbers, environment variables, raw journal or full unit contents are exported. Descriptions and paths can still contain private information.
