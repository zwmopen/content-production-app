"""Windows WeChat readiness checks for the human-confirmed Moments workflow.

The upstream pyweixin package expects Weixin to be running and logged in before
``Navigator.open_weixin`` is called.  This module owns the small amount of
orchestration around that expectation: start the registered Weixin executable,
click the visible ``进入微信`` control once when present, and wait for the
logged-in main window.  It never enters credentials, reads a QR code, or
clicks the final Moments publish button.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


READY = "READY"
LOGIN_REQUIRED = "LOGIN_REQUIRED"
UNKNOWN = "UNKNOWN"
RENDER_SURFACE_READY = "RENDER_SURFACE_READY"
RENDER_SURFACE_WINDOW_CLASS = "Qt51514QWindowIcon"


def classify_window_class(window_class: str | None) -> str:
    """Map pyweixin's observed UIA class to a stable workflow state."""

    value = str(window_class or "").strip()
    if value == "mmui::MainWindow":
        return READY
    if value == "mmui::LoginWindow":
        return LOGIN_REQUIRED
    return UNKNOWN


@dataclass(frozen=True)
class WeChatReadiness:
    status: str
    handle: int
    launched: bool
    login_button_clicked: bool
    window_class: str = ""
    window_title: str = ""


class WeChatPreflightError(RuntimeError):
    """A bounded, actionable failure before any Moments UI input."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "WECHAT_PREFLIGHT_FAILED",
        launched: bool = False,
        login_button_clicked: bool = False,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.launched = launched
        self.login_button_clicked = login_button_clicked


def _find_wechat_window_handle() -> int:
    import win32gui

    for title in ("微信", "Weixin"):
        handle = int(win32gui.FindWindow("Qt51514QWindowIcon", title) or 0)
        if handle:
            return handle
    return 0


def _raw_render_surface_profile(handle: int) -> tuple[str, str]:
    """Read the native Win32 class/title for a handle already found by Qt.

    pywinauto can expose the inner ``mmui::MainWindow`` class while Win32 still
    reports the real outer Qt render surface.  The publisher must prefer the
    latter when the render-surface adapter is enabled; otherwise a harmless
    transition is misclassified as the deliberately disabled legacy UIA path.
    """

    if not handle:
        return "", ""
    try:
        import win32gui

        return (
            str(win32gui.GetClassName(int(handle)) or ""),
            str(win32gui.GetWindowText(int(handle)) or ""),
        )
    except Exception:
        return "", ""


def _window_class(window: Any) -> str:
    try:
        return str(window.class_name() or "")
    except Exception:
        return ""


def _window_title(window: Any) -> str:
    try:
        method = getattr(window, "window_text", None)
        return str(method() or "") if callable(method) else ""
    except Exception:
        return ""


def render_surface_is_eligible(
    *,
    observed: str,
    allow_render_surface: bool,
    raw_class: str,
    raw_title: str,
) -> bool:
    """Do not treat the login window's Qt shell as the logged-in canvas."""

    return bool(
        allow_render_surface
        and observed != LOGIN_REQUIRED
        and raw_class == RENDER_SURFACE_WINDOW_CLASS
        and raw_title in {"微信", "Weixin"}
    )


def _click_login_button_once(
    window: Any,
    login_window: Any,
    *,
    button_timeout: float = 3.0,
) -> bool:
    """Click the saved-account entry button once, after bringing it forward.

    WeChat's Qt login surface can expose the button through UIA before the
    window has focus.  A bare ``click_input`` is then reported as successful
    but does not enter the saved account.  Focus the native window and the
    button first, wait briefly for the control to materialize, and perform one
    logical click.  If no button is exposed, return ``False`` so the caller
    keeps the bounded human QR/confirmation wait instead of guessing.
    """

    selectors: list[dict[str, Any]] = []
    configured = getattr(login_window, "LoginButton", None)
    if isinstance(configured, dict):
        selectors.append(dict(configured))
    # Keep the adapter usable if pyweixin's language detection returns a
    # localized selector that differs from the actual simplified-Chinese UI.
    for title in ("进入微信", "進入微信", "Enter Weixin"):
        selector = {"control_type": "Button", "title": title}
        if selector not in selectors:
            selectors.append(selector)

    deadline = time.monotonic() + max(0.1, float(button_timeout))
    while time.monotonic() < deadline:
        for selector in selectors:
            try:
                button = window.child_window(**selector)
                if not button.exists(timeout=min(0.25, max(0.05, deadline - time.monotonic()))):
                    continue
                for control in (window, button):
                    for method_name in ("restore", "set_focus"):
                        method = getattr(control, method_name, None)
                        if not callable(method):
                            continue
                        try:
                            method()
                        except Exception:
                            # Focus is best effort; the click still gets one
                            # chance through the exposed UIA control.
                            pass
                button.click_input()
                return True
            except Exception:
                continue
        time.sleep(0.1)
    return False


def ensure_wechat_ready(
    *,
    startup_timeout: float = 20.0,
    login_timeout: float = 90.0,
    poll_interval: float = 0.5,
    auto_start_wechat: bool = True,
    auto_click_login: bool = True,
    allow_render_surface: bool = False,
) -> WeChatReadiness:
    """Start Weixin if needed and wait for a logged-in main window.

    ``login_timeout`` is a human interaction window, not an automation retry
    loop.  Once it expires the caller receives ``WAITING_FOR_HUMAN_LOGIN`` and
    must deliberately invoke the same work item again after login.
    """

    try:
        from pyweixin.WeChatAuto import desktop
        from pyweixin.WeChatTools import Tools
        from pyweixin.Uielements import Login_window
    except Exception as exc:  # pragma: no cover - dependency failure is runtime-only
        raise WeChatPreflightError(
            f"微信前置检查依赖不可用：{exc}",
            code="WECHAT_DEPENDENCY_UNAVAILABLE",
        ) from exc

    startup_timeout = max(1.0, float(startup_timeout))
    login_timeout = max(1.0, float(login_timeout))
    poll_interval = max(0.1, float(poll_interval))
    launched = False
    login_button_clicked = False
    login_seen = False
    last_window_title = ""
    last_window_class = ""
    login_deadline: float | None = None
    legacy_ready_deadline: float | None = None
    startup_deadline = time.monotonic() + startup_timeout

    try:
        if not Tools.is_weixin_running():
            if not auto_start_wechat:
                raise WeChatPreflightError(
                    "朋友圈设置为手动打开微信；请先打开并登录 PC 微信，再重新点击同一条素材。"
                    "本次没有填图、填文案，也没有点击发表。",
                    code="WECHAT_MANUAL_REQUIRED",
                )
            executable = Path(Tools.where_weixin()).expanduser()
            if not executable.is_file():
                raise WeChatPreflightError(
                    f"已找到微信注册信息，但执行文件不存在：{executable}",
                    code="WECHAT_NOT_INSTALLED",
                )
            os.startfile(str(executable))
            launched = True
    except WeChatPreflightError:
        raise
    except Exception as exc:
        raise WeChatPreflightError(
            f"微信未运行且自动启动失败：{exc}",
            code="WECHAT_START_FAILED",
            launched=launched,
        ) from exc

    while True:
        now = time.monotonic()
        handle = 0
        observed = UNKNOWN
        try:
            if Tools.is_weixin_running():
                handle = _find_wechat_window_handle()
                if handle:
                    window = desktop.window(handle=handle)
                    last_window_title = _window_title(window)
                    last_window_class = _window_class(window)
                    observed = classify_window_class(last_window_class)
                    raw_class, raw_title = _raw_render_surface_profile(handle)
                    if render_surface_is_eligible(
                        observed=observed,
                        allow_render_surface=allow_render_surface,
                        raw_class=raw_class,
                        raw_title=raw_title,
                    ):
                        # The native window is authoritative for this version
                        # of WeChat.  UIA may temporarily report its inner
                        # class as mmui::MainWindow, which must not send us to
                        # the disabled pyweixin/Narrator path.
                        return WeChatReadiness(
                            status=RENDER_SURFACE_READY,
                            handle=handle,
                            launched=launched,
                            login_button_clicked=login_button_clicked,
                            window_class=raw_class,
                            window_title=raw_title,
                        )
                    if observed == READY:
                        # During the login-to-main transition this WeChat
                        # build briefly reports mmui::MainWindow through UIA
                        # before settling back to its Qt render surface.  Do
                        # not classify that short transition as a permanent
                        # legacy UIA incompatibility.
                        if allow_render_surface and last_window_class == "mmui::MainWindow":
                            legacy_ready_deadline = legacy_ready_deadline or now + 3.0
                            if now < legacy_ready_deadline:
                                time.sleep(poll_interval)
                                continue
                        legacy_ready_deadline = None
                        return WeChatReadiness(
                            status=READY,
                            handle=handle,
                            launched=launched,
                            login_button_clicked=login_button_clicked,
                            window_class=last_window_class,
                            window_title=last_window_title,
                        )
                    if (
                        allow_render_surface
                        and not login_seen
                        and observed == UNKNOWN
                        and last_window_class == RENDER_SURFACE_WINDOW_CLASS
                        and last_window_title in {"微信", "Weixin"}
                    ):
                        # WeChat 4.1.12.55 exposes only a Qt render surface to
                        # UIA.  The caller may use the separately version-gated
                        # render-surface adapter, which still verifies the
                        # resulting composer and never clicks 发表.
                        return WeChatReadiness(
                            status=RENDER_SURFACE_READY,
                            handle=handle,
                            launched=launched,
                            login_button_clicked=login_button_clicked,
                            window_class=last_window_class,
                            window_title=last_window_title,
                        )
                    legacy_ready_deadline = None
                    if observed == LOGIN_REQUIRED:
                        login_seen = True
                        login_deadline = login_deadline or now + login_timeout
                        if auto_click_login and not login_button_clicked:
                            login_button_clicked = _click_login_button_once(window, Login_window)
            else:
                observed = UNKNOWN
        except WeChatPreflightError:
            raise
        except Exception as exc:
            if login_seen and now < (login_deadline or now):
                # The login window may be rebuilding immediately after the
                # button click; keep the bounded human-login window alive.
                observed = LOGIN_REQUIRED
            else:
                raise WeChatPreflightError(
                    f"微信窗口状态检查失败：{exc}",
                    code="WECHAT_WINDOW_CHECK_FAILED",
                    launched=launched,
                    login_button_clicked=login_button_clicked,
                ) from exc

        if login_seen:
            if now >= (login_deadline or now):
                raise WeChatPreflightError(
                    "微信已打开，但仍未完成登录。请在微信窗口扫码/确认登录后，重新点击同一条素材的发送；"
                    "本次没有填图、填文案，也没有点击发表。",
                    code="WAITING_FOR_HUMAN_LOGIN",
                    launched=launched,
                    login_button_clicked=login_button_clicked,
                )
        elif now >= startup_deadline:
            if handle:
                if last_window_class == "Qt51514QWindowIcon":
                    message = (
                        f"检测到微信窗口“{last_window_title or '微信'}”，但 UI Automation 只暴露外层 "
                        f"{last_window_class}，没有暴露 pyweixin 需要的 mmui::MainWindow 控件树；"
                        "当前微信版本与 pyweixin 控件定位不兼容，本次没有进行朋友圈操作。"
                    )
                    code = "WECHAT_UIA_OUTER_WINDOW_ONLY"
                else:
                    message = (
                        "检测到微信进程，但没有识别到可操作的主窗口。请确认微信已正常显示、"
                        "当前 Windows 用户权限一致，并检查 UI Automation/辅助功能状态。"
                    )
                    code = "WECHAT_WINDOW_NOT_ACCESSIBLE"
            else:
                message = "微信启动超时，未找到微信主窗口；本次没有进行任何朋友圈操作。"
                code = "WECHAT_WINDOW_NOT_FOUND"
            raise WeChatPreflightError(
                message,
                code=code,
                launched=launched,
                login_button_clicked=login_button_clicked,
            )
        time.sleep(poll_interval)
