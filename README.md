# systemd Explorer

Explore a Linux system's units, activation requests, ordering constraints, configuration clues and observed boot times. You decide where a new service belongs. The tool does not recommend placement or manage units.

The Rust **collector** runs on demand on the Linux machine and exports a versioned JSON snapshot. The **viewer** is plain HTML/CSS/JavaScript: open it on any PC, import the snapshot, and explore without a server or connection to the original machine. It has no CDN, external fonts or network APIs.

## Build and quick start

Requirements: Rust 1.88+ (stable recommended) with a C linker (`build-essential` on Debian), Linux/systemd for collection, and a modern browser for viewing. The Dev Container supplies Rust tooling; Node.js 22+ is needed only for viewer tests, not viewing.

```bash
cargo build --release
./target/release/systemd-explorer collect --output snapshot.json
# Alternatively: cargo run --release -- collect --output snapshot.json
```

Run as an ordinary user. Copy `snapshot.json` and this repository's `viewer/` directory to another PC using your preferred transfer method. Open `viewer/index.html` directly, then select or drop the JSON file. Try the fictional [small](viewer/samples/small.json) or [medium](viewer/samples/medium.json) samples first. Select a unit to expand its neighborhood; the viewer initially draws no full-system edge graph.

**Effective dependencies, activation requests, ordering constraints and observed timestamps are different concepts.** `After=` alone does not start its referenced unit. Disk symlinks and `[Install] WantedBy=` are separately switchable hints and do not prove a current manager relationship. Missing state/history is unknown, not proof that a unit never started.

## Validation and references

```bash
vorbere run check  # rustfmt, clippy, JS syntax, cargo audit (network required)
vorbere run test   # Rust fixtures/mocks and Node built-in tests
vorbere run build # release collector; viewer needs no build
```

Install [vorbere](https://github.com/pirakansa/vorbere) and `cargo install cargo-audit --locked` if outside the Dev Container. The underlying Rust gates are `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test`.

See the [user guide](docs/usage.md), [snapshot and graph contract](docs/snapshot.md), [JSON Schema](docs/snapshot.schema.json), [validation/limitations](docs/validation.md), and [manual amd64/arm64 release guide](docs/releases.md).

Collection is read-only and best effort, with command timeouts and partial-failure diagnostics. It never runs reload/enable/start/stop or exports full unit files, environment variables, credentials, or raw journals. Snapshots still disclose topology, descriptions and paths; inspect them before sharing. Full event history, exact dependency/udev rule attribution, kernel/initramfs tracing, live monitoring, SSH, comparison and automatic placement are outside this MVP.
