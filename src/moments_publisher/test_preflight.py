import unittest
from pathlib import Path

from moments_publisher.wechat_preflight import (
    LOGIN_REQUIRED,
    RENDER_SURFACE_WINDOW_CLASS,
    _click_login_button_once,
    render_surface_is_eligible,
)


class _FakeLoginButton:
    def __init__(self, events):
        self.events = events

    def exists(self, timeout=0.0):
        self.events.append(("exists", timeout))
        return True

    def set_focus(self):
        self.events.append("button_focus")

    def click_input(self):
        self.events.append("click")


class _FakeLoginWindow:
    LoginButton = {"control_type": "Button", "title": "进入微信"}


class _FakeWindow:
    def __init__(self, events):
        self.events = events
        self.button = _FakeLoginButton(events)

    def child_window(self, **selector):
        self.events.append(("selector", selector))
        return self.button

    def restore(self):
        self.events.append("restore")

    def set_focus(self):
        self.events.append("window_focus")


class PreflightTests(unittest.TestCase):
    def test_login_window_qt_shell_is_not_accepted_as_render_surface(self):
        self.assertFalse(
            render_surface_is_eligible(
                observed=LOGIN_REQUIRED,
                allow_render_surface=True,
                raw_class=RENDER_SURFACE_WINDOW_CLASS,
                raw_title="微信",
            )
        )

    def test_logged_in_qt_shell_is_accepted_as_render_surface(self):
        self.assertTrue(
            render_surface_is_eligible(
                observed="UNKNOWN",
                allow_render_surface=True,
                raw_class=RENDER_SURFACE_WINDOW_CLASS,
                raw_title="微信",
            )
        )

    def test_preflight_source_keeps_login_gate_before_qt_surface_gate(self):
        source = Path(__file__).with_name("wechat_preflight.py").read_text(encoding="utf-8")
        self.assertIn("observed != LOGIN_REQUIRED", source)

    def test_saved_login_entry_focuses_window_before_single_click(self):
        events = []
        clicked = _click_login_button_once(
            _FakeWindow(events),
            _FakeLoginWindow(),
            button_timeout=0.2,
        )
        self.assertTrue(clicked)
        self.assertIn("window_focus", events)
        self.assertIn("button_focus", events)
        self.assertEqual(events.count("click"), 1)

    def test_missing_login_button_keeps_human_wait_boundary(self):
        class NoButtonWindow(_FakeWindow):
            def child_window(self, **selector):
                class MissingButton:
                    def exists(self, timeout=0.0):
                        return False

                return MissingButton()

        self.assertFalse(
            _click_login_button_once(
                NoButtonWindow([]),
                _FakeLoginWindow(),
                button_timeout=0.1,
            )
        )
