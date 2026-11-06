use std::{io::Write, path::PathBuf, time::Duration};
use systemd_explorer::{collector::collect, command::ProcessRunner};

fn main() {
    if let Err(e) = run() {
        eprintln!("systemd-explorer: {e}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let Some(command) = args.next() else {
        return Err("use: systemd-explorer collect --output snapshot.json [--timeout-seconds 120] [--command-timeout-seconds 10]".into());
    };
    if command == "--help" || command == "-h" {
        println!(
            "systemd-explorer collect --output snapshot.json [--timeout-seconds 120] [--command-timeout-seconds 10]\nRead-only system manager inspection. Existing output files are never overwritten. Partial failures are saved as warnings."
        );
        return Ok(());
    }
    if command != "collect" {
        return Err("expected collect subcommand".into());
    }
    let mut output = None;
    let mut budget = 120;
    let mut timeout = 10;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--output" => output = Some(PathBuf::from(args.next().ok_or("missing output path")?)),
            "--timeout-seconds" => budget = args.next().ok_or("missing timeout")?.parse::<u64>()?,
            "--command-timeout-seconds" => {
                timeout = args
                    .next()
                    .ok_or("missing command timeout")?
                    .parse::<u64>()?
            }
            _ => return Err(format!("unknown argument: {arg}").into()),
        }
    }
    if budget == 0 || timeout == 0 || budget > 3600 || timeout > 3600 {
        return Err("timeouts must be between 1 and 3600 seconds".into());
    }
    let output = output.ok_or("--output is required")?;
    if output.exists() {
        return Err("output already exists; choose a new path".into());
    }
    #[cfg(not(target_os = "linux"))]
    return Err("collector requires Linux; viewer works on other operating systems".into());
    #[cfg(target_os = "linux")]
    {
        let mut runner =
            ProcessRunner::new(Duration::from_secs(budget), Duration::from_secs(timeout));
        let snapshot = collect(&mut runner, None);
        let parent = output
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(std::path::Path::new("."));
        let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
        serde_json::to_writer_pretty(&mut tmp, &snapshot)?;
        tmp.write_all(b"\n")?;
        tmp.as_file().sync_all()?;
        tmp.persist_noclobber(&output)?;
        eprintln!(
            "Saved {} units, {} relations, {} warnings to {}",
            snapshot.units.len(),
            snapshot.relations.len(),
            snapshot.warnings.len(),
            output.display()
        );
    }
    Ok(())
}
