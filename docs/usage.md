# User guide

## Collect on the Linux machine

Build with `cargo build --release`, or transfer a compatible compiled binary. Use an ordinary user account:

```bash
systemd-explorer collect --output snapshot.json
systemd-explorer collect --output later.json --timeout-seconds 180 --command-timeout-seconds 5
```

The output path must not already exist. The parent directory must exist and be writable. JSON is serialized into a temporary file in that directory and published without overwriting an existing file. On Unix, the output is owner-readable/writable (0600). The collector writes only its output and temporary capture files; it does not change unit files, enablement or service state. It does not elevate privileges or prompt for credentials.

The default external-command budget is 120 seconds and each command is limited to 10 seconds. Both flags accept 1–3600 seconds. Disk enumeration checks the remaining budget between entries; ordinary filesystem I/O and final normalization/serialization are not a hard real-time deadline. Each command's captured stdout+stderr is bounded to 32 MiB (checked every 20 ms), and individual file reads are limited to 256 KiB. At most 50,000 loaded and 50,000 installed inventory entries are processed. Limits or collection errors produce warnings.

`systemctl`, `systemd-analyze` and `udevadm` must be discoverable through `PATH`. Use a trusted PATH. The collector uses separate argument arrays, never a shell. Collection is limited to the **system manager**, not user managers or remote systems.

Exit status 0 means the snapshot was written, including when collection was partial or unavailable. Check `metadata.diagnostics` and `warnings`, not just the exit code. Invalid arguments, serialization errors and output failures return nonzero. A system without systemd can still yield a diagnostic snapshot with no units.

## Transfer and inspect offline

Copy `snapshot.json` and the entire `viewer/` folder to the viewing PC. No HTTP server, Node.js installation or access to the Linux machine is required. Open `viewer/index.html` directly in a modern desktop browser, then use **Open snapshot** or drag/drop. The viewer uses local file APIs and does not make network requests. The optional documentation link requires copying `docs/` alongside `viewer/`.

1. Read the overview counts and collection diagnostics. Boot ID and collection interval identify context; the snapshot is not atomic.
2. Search by unit name or description, then filter by type or active state. `unknown` includes installed units with no runtime observation and unresolved references. Inventory results are loaded in pages of 100.
3. Select a unit. The graph expands both incoming and outgoing edges to the chosen hop limit (0–4). Drag to pan, scroll or use buttons to zoom, and click nodes or detail buttons to follow references. Inventory filters do not hide other types in the neighborhood.
4. Toggle effective, disk-symlink and installation-hint layers, then individual relation kinds. Colors indicate semantic categories; dotted edges indicate disk evidence. Different relation kinds may connect the same pair; all records and their sources remain available in the details pane, paginated in groups of 100.
5. Inspect paths, reload hints, unassigned origins, device/udev properties, per-unit times and warnings. There is no automatic explanation of the full activation cause.
6. Use the timing list for observed latest active-entry transitions. The first 200 comparable observations are shown; per-unit details include all four collected transition properties. Units with no timestamp are counted as unknown, never as never-started.

The graph is capped at 180 nodes and 800 edges and announces truncation. Narrow the neighborhood or disable layers to inspect dense areas. Names longer than graph labels allow are truncated visually; inventory and details contain the full name. All relationships remain navigable in details regardless of graph visibility limits. The browser input limit is 100 MiB and one million records per top-level collection; very large snapshots can still take time to index.

## Troubleshooting

- **Cannot connect to bus / manager:** verify that the source machine boots systemd as PID 1 and the system bus is accessible. A container without systemd is not a substitute for host collection.
- **JSON inventory unsupported:** the collector detects failure or invalid JSON and falls back to name/load/active/sub columns with locale C and headers/pager/colors disabled. Unit properties still use the `key=value` interface; descriptions are never extracted from the fallback display.
- **Permissions or command missing:** the available inventory is preserved; the affected item is marked unavailable. A failed property batch is retried per unit while budget remains. Do not assume root is necessary.
- **Unit listed as installed with unknown state:** properties are queried only for units already in the loaded inventory. Inspecting an unloaded unit through `systemctl show` can cause it to load, so this collector avoids that query. A unit can disappear between inventory and inspection; collection cannot eliminate this race.
- **Missing timestamps or device mapping:** older versions, garbage-collected units, permission limits and never-observed transitions are possible. Read the diagnostic instead of inferring a cause.
- **Unsupported schema / malformed JSON:** the viewer explains the error and clears stale results. Unknown optional fields in version 1 are accepted; future schema versions are rejected explicitly.
