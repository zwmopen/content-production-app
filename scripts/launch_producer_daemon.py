"""Safe launcher for the legacy single-instance producer.

The producer owns ``producer.pid`` and performs the authoritative live-PID
check.  This launcher must never delete or replace that lock before launch.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Callable, Optional


PROJECT_ROOT = Path(r"D:\AICode")
SCRIPT = Path(
    r"D:\AICode\工具开发\projects\content-production-app\scripts\dual_browser_autonomous_producer.py"
)
RUNTIME_DIR = Path(r"D:\AICode\运行数据")
CREATE_NO_WINDOW = 0x08000000


def launch_producer_daemon(
    *,
    script: Path = SCRIPT,
    project_root: Path = PROJECT_ROOT,
    runtime_dir: Path = RUNTIME_DIR,
    python_exe: str = sys.executable,
    popen: Optional[Callable] = None,
):
    """Spawn the producer without mutating its single-instance PID lock."""
    script = Path(script)
    project_root = Path(project_root)
    runtime_dir = Path(runtime_dir)
    if not script.is_file():
        raise FileNotFoundError(f"Producer script not found: {script}")

    runtime_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = runtime_dir / "producer_daemon_stdout.log"
    stderr_path = runtime_dir / "producer_daemon_stderr.log"
    popen = popen or subprocess.Popen

    # Keep both files open through process creation; Popen duplicates the
    # supplied handles for the child.  The PID lock is intentionally untouched.
    with stdout_path.open("a", encoding="utf-8") as log_out, stderr_path.open(
        "a", encoding="utf-8"
    ) as log_err:
        return popen(
            [python_exe, "-u", str(script)],
            cwd=str(project_root),
            stdout=log_out,
            stderr=log_err,
            creationflags=CREATE_NO_WINDOW,
        )


def main() -> int:
    process = launch_producer_daemon()
    print(
        f"Producer process launched with PID {process.pid}; "
        "the producer retains ownership of producer.pid and will exit if another live instance owns it."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
