"""Regression checks for the CDP producer desktop-focus policy."""

from pathlib import Path


PRODUCER = Path(__file__).with_name("dual_browser_autonomous_producer.py")


def main() -> None:
    source = PRODUCER.read_text(encoding="utf-8")

    assert "def keep_window_background" in source
    assert "keep_window_background(self.cdp_port)" in source
    assert "def bring_window_topmost" not in source
    assert "SetForegroundWindow" not in source
    assert "ShowWindow(hwnd, 9)" not in source
    compile(source, str(PRODUCER), "exec")
    print("PASS: CDP producer never raises or focuses a desktop window")


if __name__ == "__main__":
    main()
