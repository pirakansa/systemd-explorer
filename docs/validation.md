# Validation and implementation limits

## Automated validation performed in the implementation environment

- `cargo fmt --check`: passed after formatting the final generator-path change.
- `cargo clippy --all-targets -- -D warnings`: passed.
- `vorbere run test`: passed with Node.js added to this environment's PATH; 14 Rust tests and 10 Node tests. The first attempt could not find Node; a locally installed VS Code Node.js 24 runtime was then used. CI provisions Node.js 22 explicitly.
- `vorbere run build`: passed, producing `target/release/systemd-explorer`.
- `node --check viewer/core.js` and `node --check viewer/app.js`: passed.
- `git diff --check`: passed.
- Release CLI collection in this container wrote a version 1 snapshot to a temporary directory; the viewer's core validator accepted it, output permissions were 0600, and the diagnostic snapshot preserved 8 reference nodes / 6 disk symlink hints / 7 warnings. These are **not** manager-effective relationships.
- The initial offline check failed because no local advisory database was available. During final integration, the default `vorbere run check` fetched the RustSec advisory database and crates.io index and passed, including `cargo audit` with no vulnerability findings.

Before implementation, the required `vorbere` check/test/build tasks failed because the empty repository had no task configuration. The configuration and real tasks are now present. The full default `vorbere run check` subsequently passed before PR creation. Dependencies were added using `cargo add --offline` from the local crate cache.

Rust tests exercise property/JSON parsing, root mount names (`-.mount`), path quoting/UTF-8, install resets/continuations, effective versus disk evidence, unresolved references, timestamp nullability, generator and reload clues, allowlisted udev data, missing commands, permissions, failed-batch recovery, exhausted budgets, real subprocess timeout/output caps, safe literal argument passing, CLI argument errors, no-overwrite behavior and fixture compatibility.

Node tests cover schema-version rejection, unknown fields, malformed structure, empty imports, unknown references, cycles, directional N-hop traversal, evidence filtering, node/edge caps, semantic categories, unknown timestamps and filters. A small DOM harness additionally exercises local-file import, selection/navigation, controls, stale-data clearing, empty-state messaging, truncation and cross-boot timeline suppression. This harness does not verify actual browser rendering, Content Security Policy or file-origin behavior.

## Remaining environment-dependent acceptance checks

The manual release workflow adds four Node tests. Including graph filter coverage, the current suite contains 15 Rust tests and 37 Node tests. The graph tests cover request categories, active/unknown states, retained focus nodes, traversal stopping at hidden units, filtering before size caps, combined controls, restored kind selections and preserved inventory/detail access. Direct-list tests additionally cover property orientation, evidence/source preservation, self-references, unknown states, high-fanout pagination beyond graph caps, full-list search, click navigation, shared filters, empty results, stale-data clearing and view switching. Global timeline tests additionally cover all transition kinds, unknown/foreign-clock timestamps, time-only unresolved references, range boundaries, type folding, 10,000-unit viewport selection, full-list search, range brushing/zoom, navigation, missing-data rows and stale/cross-boot clearing. Local release checks also exercised actual Cargo metadata (`0.1.0` → `v0.1.0`), parsed every workflow Bash block with `bash -n`, verified the main-branch guard, packaged the existing amd64 executable with the offline viewer in a temporary directory, and verified its checksum. `actionlint 1.7.12` passed for both GitHub workflows. Hosted ARM64 execution, tag creation and publication have not been performed locally. See [the release guide](releases.md).

This container has no `systemctl`, `udevadm`, browser or systemd PID 1. Therefore **real manager collection and real-browser end-to-end acceptance have not been demonstrated**. Do not interpret fixture success or disk-only collection as satisfying that criterion.

On a Linux machine booted with systemd, as an ordinary user:

```bash
./target/release/systemd-explorer collect --output /tmp/explorer-acceptance.json
```

Use a new output path for every run. Confirm diagnostics include successful loaded/installed inventory and property batches; confirm the exported units have real active/load states and `effective` relations. Compare a few chosen units' allowlisted properties against `systemctl show` without modifying them. Verify access-denied or unsupported udev queries remain warnings with other data preserved.

Copy the JSON and `viewer/` to another PC and disconnect networking. Open `viewer/index.html` in a desktop browser. Import by selection and drop, search service/target/device/mount/socket units, follow incoming/outgoing relations, toggle layers, change hops, pan/zoom, inspect path/device details and unknown times. Also import both fictional samples, malformed JSON, an empty snapshot and an unsupported version. Verify the developer network panel shows no external requests. A genuine collector snapshot is intentionally not committed.

## Deliberate limits

- System manager only; not user managers, remote hosts or a transaction simulator.
- Collection is an interval of observations, not an atomic manager/filesystem/udev transaction.
- Only already-loaded inventory entries receive runtime queries, minimizing inspection-induced loading; units can still disappear during collection.
- Disk hints cover top-level symlink directories and fragment-only WantedBy, not full configuration precedence, template/specifier expansion or drop-in merging.
- Origins of effective edges remain undetermined. DefaultDependencies, generator paths and SourcePath are clues, not individual-edge attribution.
- Timings are latest manager transition observations, not complete boot history. No plot-JSON feature is required: property timestamps are the compatibility path on all versions.
- Sysfs mapping requires an observed SysFSPath. Exact udev rule provenance and event history are unavailable.
- Commands are bounded; filesystem budget checks are cooperative, not cancellation of a blocked filesystem operation. The process is not sandboxed against a hostile local filesystem or untrusted PATH.
- Graph/list/timeline limits and truncation are explicit. Rendering of parallel graph edges may overlap; details preserve every collected record.

Runtime-detail tests cover service type/result/exit properties, absent evaluation timestamps, mount source/point/type fields, type-specific allowlisting, sensitive source omission and legacy snapshot rendering. These fields still require verification against a real systemd manager; fixtures do not establish platform compatibility.

Task-workspace DOM tests cover empty import guidance, mutually exclusive views, retained timeline ranges, collapsed technical observations, hardware path search, cross-workspace selection and invalid-import clearing. Context tests cover preserved partial cycle/depth/queue paths and explicit hardware node/edge omissions. Actual browser rendering and responsive layout remain unverified in this container.

Evidence-priority tests cover order-independent contact selection, direct-first caps, target-hub exclusion, witnessed indirect paths, sysfs aliases and unknown paths, condition summary semantics and the clamped boot-window shortcut. Read-only inspection of a local snapshot also confirmed stable contact selection after reversing relation order and grouping of observed sysfs aliases. No private snapshot contents are committed.
