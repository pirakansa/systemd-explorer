//! Bounded, shell-free, read-only command transport.
use std::{
    fs::File,
    io::Read,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use thiserror::Error;

const MAX_OUTPUT: u64 = 32 * 1024 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(20);
#[derive(Debug, Error)]
pub enum CommandError {
    #[error("command unavailable or I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("command timed out")]
    Timeout,
    #[error("command output exceeded 32 MiB")]
    OutputLimit,
    #[error("command exited unsuccessfully ({0}); unavailable feature, bus or permissions")]
    Exit(String),
    #[error("collection time budget exhausted")]
    Budget,
}
pub trait Runner {
    fn run(&mut self, program: &str, args: &[&str]) -> Result<String, CommandError>;
    fn exhausted(&self) -> bool {
        false
    }
}
pub struct ProcessRunner {
    deadline: Instant,
    command_timeout: Duration,
}
impl ProcessRunner {
    pub fn new(budget: Duration, command_timeout: Duration) -> Self {
        Self {
            deadline: Instant::now() + budget,
            command_timeout,
        }
    }
}
impl Runner for ProcessRunner {
    fn exhausted(&self) -> bool {
        Instant::now() >= self.deadline
    }
    fn run(&mut self, program: &str, args: &[&str]) -> Result<String, CommandError> {
        let remaining = self
            .deadline
            .checked_duration_since(Instant::now())
            .ok_or(CommandError::Budget)?;
        // Files avoid pipe deadlocks and inherited pipe handles on timeout.
        let dir = tempfile::tempdir()?;
        let output = dir.path().join("stdout");
        let errors = dir.path().join("stderr");
        let mut child = Command::new(program)
            .args(args)
            .env("LC_ALL", "C")
            .env("SYSTEMD_COLORS", "0")
            .env("SYSTEMD_PAGER", "")
            .env("SYSTEMD_ASK_PASSWORD", "0")
            .stdin(Stdio::null())
            .stdout(File::create(&output)?)
            .stderr(File::create(&errors)?)
            .spawn()?;
        let started = Instant::now();
        loop {
            let too_large =
                std::fs::metadata(&output)?.len() + std::fs::metadata(&errors)?.len() > MAX_OUTPUT;
            let timeout = started.elapsed() >= self.command_timeout.min(remaining);
            if too_large || timeout {
                let _ = child.kill();
                let _ = child.wait();
                return Err(if too_large {
                    CommandError::OutputLimit
                } else {
                    CommandError::Timeout
                });
            }
            if let Some(status) = child.try_wait()? {
                if !status.success() {
                    return Err(CommandError::Exit(status.to_string()));
                }
                let mut bytes = Vec::new();
                File::open(&output)?
                    .take(MAX_OUTPUT + 1)
                    .read_to_end(&mut bytes)?;
                if bytes.len() as u64 > MAX_OUTPUT {
                    return Err(CommandError::OutputLimit);
                }
                return Ok(String::from_utf8_lossy(&bytes).into_owned());
            }
            thread::sleep(POLL_INTERVAL);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unavailable_and_budget_are_errors() {
        let mut r = ProcessRunner::new(Duration::from_secs(2), Duration::from_secs(1));
        assert!(matches!(
            r.run("/nonexistent/systemd-explorer-test", &[]),
            Err(CommandError::Io(_))
        ));
        let mut r = ProcessRunner::new(Duration::ZERO, Duration::ZERO);
        assert!(matches!(r.run("unused", &[]), Err(CommandError::Budget)));
    }
    #[test]
    fn timeout_and_output_capture() {
        let mut r = ProcessRunner::new(Duration::from_secs(3), Duration::from_millis(60));
        assert!(matches!(r.run("sleep", &["2"]), Err(CommandError::Timeout)));
        assert_eq!(
            r.run("printf", &["%s", "literal;$(no-shell)"]).unwrap(),
            "literal;$(no-shell)"
        );
    }
    #[test]
    fn nonzero_exit_and_output_limit_are_reported() {
        let mut r = ProcessRunner::new(Duration::from_secs(5), Duration::from_secs(2));
        assert!(matches!(r.run("false", &[]), Err(CommandError::Exit(_))));
        assert!(matches!(
            r.run("head", &["-c", "33554433", "/dev/zero"]),
            Err(CommandError::OutputLimit)
        ));
    }
}
