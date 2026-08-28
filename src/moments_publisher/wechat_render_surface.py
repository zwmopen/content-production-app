"""Version-gated fallback for WeChat's inaccessible Qt render surface.

WeChat 4.1.12.55 can expose a top-level ``Qt51514QWindowIcon`` window while
its actual Moments canvas contains no UI Automation controls.  This module is
deliberately narrow: it uses the currently measured window rectangle, keeps
the standard file picker on UI Automation, verifies the pasted text, and only
returns after a visual signal for the final green ``发表`` button is present.
It never clicks that button.

The normal pyweixin/UIA path remains the first choice.  This adapter is not a
general coordinate automation framework and is rejected when the observed
window class/title does not match the supported local profile.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable


SUPPORTED_WINDOW_CLASS = "Qt51514QWindowIcon"
SUPPORTED_WINDOW_TITLES = {"朋友圈"}
WECHAT_MAIN_TITLES = {"微信", "Weixin"}

# These are ratios of the live window rectangle, not screen coordinates.  They
# are a local profile for the WeChat 4.1.12.55 layout observed on this machine.
# If that layout changes, the bounded adapter fails closed and must be probed
# again rather than silently clicking a different control.
CAMERA_ENTRY_RATIO = (0.185, 0.058)
# WeChat 4.1.12.55 exposes the left navigation as pixels only.  This is a
# version-gated, window-relative profile measured from the live window, not a
# screen coordinate; if the outer window changes, the normal bounded wait
# fails closed and the profile must be re-probed.
MOMENTS_NAV_RATIO = (0.057, 0.44)
# The text editor starts below the top chrome on the current render surface.
# The old Y ratio landed above the actual input band on the current 4.1.12.55
# window and could leave the placeholder untouched.
COMPOSER_TEXT_RATIO = (0.20, 0.12)
COMPOSER_SETTLE_SECONDS = 0.75
COMPOSER_PASTE_ATTEMPTS = 2
PUBLISH_SCAN_X = (0.25, 0.90)
PUBLISH_SCAN_Y = (0.76, 0.98)
# The image grid profile is measured from the same WeChat 4.1.12.55 render
# surface. WeChat keeps three columns but row heights follow the source aspect
# ratios, so rows cannot be located with one fixed Y step. These are only the
# horizontal profile and a bounded scan band; the detector below discovers the
# visible row bands from live pixels and never clicks a tile.
MEDIA_GRID_LEFT = 0.17
MEDIA_GRID_TOP = 0.095
MEDIA_GRID_STEP_X = 0.213
# Kept for offline fixture compatibility; the live detector no longer uses a
# fixed Y step or tile height because source aspect ratios vary by row.
MEDIA_GRID_STEP_Y = 0.173
MEDIA_GRID_TILE_W = 0.205
MEDIA_GRID_TILE_H = 0.165
MEDIA_GRID_SCAN_BOTTOM = 0.84
MEDIA_GRID_ROW_MIN_HEIGHT = 40
MEDIA_GRID_ROW_SMOOTH = 2
MEDIA_GRID_CONTENT_THRESHOLD = 0.08
FILE_DIALOG_TITLES = {"选择文件", "打开文件", "打开", "Open"}
WINDOW_RECOVERY_SETTLE_SECONDS = 0.35


@dataclass(frozen=True)
class RenderSurfaceResult:
    status: str
    final_publish_button_detected: bool
    final_publish_button_clicked: bool = False


class RenderSurfaceError(RuntimeError):
    """A bounded failure while operating the non-UIA WeChat canvas."""

    def __init__(self, message: str, *, code: str = "WECHAT_RENDER_SURFACE_FAILED") -> None:
        super().__init__(message)
        self.code = code


def _windows() -> Iterable[tuple[int, str, str]]:
    import win32gui

    found: list[tuple[int, str, str]] = []

    def collect(handle: int, _extra: Any) -> None:
        try:
            if not win32gui.IsWindowVisible(handle):
                return
            title = str(win32gui.GetWindowText(handle) or "")
            window_class = str(win32gui.GetClassName(handle) or "")
            found.append((int(handle), title, window_class))
        except Exception:
            return

    win32gui.EnumWindows(collect, None)
    return found


def find_moments_window_handle() -> int:
    """Return the visible, supported standalone Moments window, if present."""

    candidates = [
        handle
        for handle, title, window_class in _windows()
        if title in SUPPORTED_WINDOW_TITLES and window_class == SUPPORTED_WINDOW_CLASS
    ]
    return candidates[0] if candidates else 0


def find_wechat_main_window_handle() -> int:
    """Return the visible supported WeChat main render window, if present."""

    candidates = [
        handle
        for handle, title, window_class in _windows()
        if title in WECHAT_MAIN_TITLES and window_class == SUPPORTED_WINDOW_CLASS
    ]
    return candidates[0] if candidates else 0


def _window_rect(handle: int) -> tuple[int, int, int, int]:
    import win32gui

    left, top, right, bottom = tuple(int(value) for value in win32gui.GetWindowRect(handle))
    # On this machine the process and the WeChat render surface both expose
    # the same physical-pixel coordinate space: the raw GetWindowRect matches
    # the pyautogui/ImageGrab screenshot bounds even though the monitor DPI is
    # 144. Do not apply a second DPI scale; that would move clicks off-screen.
    if right - left < 320 or bottom - top < 240:
        raise RenderSurfaceError(
            f"朋友圈窗口尺寸异常：{right - left}x{bottom - top}",
            code="WECHAT_MOMENTS_WINDOW_INVALID_RECT",
        )
    return left, top, right, bottom


def _usable_window_rect(handle: int) -> tuple[int, int, int, int]:
    """Restore/maximize a supported client window before using ratios.

    WeChat can leave its Qt render surface visible in a narrow compact state
    (for example, roughly 295x387).  That surface is not a usable Moments
    canvas for the bounded profile.  Recover it once with the normal Windows
    maximize action, then fail with the real geometry error if it is still too
    small.
    """

    import win32con
    import win32gui

    try:
        return _window_rect(handle)
    except RenderSurfaceError as exc:
        if exc.code != "WECHAT_MOMENTS_WINDOW_INVALID_RECT":
            raise
        win32gui.ShowWindow(handle, win32con.SW_MAXIMIZE)
        time.sleep(WINDOW_RECOVERY_SETTLE_SECONDS)
        try:
            return _window_rect(handle)
        except RenderSurfaceError as retry_exc:
            raise RenderSurfaceError(
                f"微信客户端窗口尺寸异常，已尝试恢复/最大化仍不可用：{retry_exc}",
                code="WECHAT_MOMENTS_WINDOW_INVALID_RECT",
            ) from retry_exc


def _activate(handle: int) -> tuple[int, int, int, int]:
    import win32con
    import win32gui

    win32gui.ShowWindow(handle, win32con.SW_RESTORE)
    rect = _usable_window_rect(handle)
    try:
        win32gui.SetForegroundWindow(handle)
    except Exception as exc:
        # Windows may reject a foreground transfer from a background worker.
        # Give the already-visible window a bounded, window-relative activation
        # fallback; never guess a screen coordinate or click inside the post.
        try:
            win32gui.SetWindowPos(
                handle,
                win32con.HWND_TOP,
                0,
                0,
                0,
                0,
                win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_SHOWWINDOW,
            )
            win32gui.BringWindowToTop(handle)
            time.sleep(0.15)
            win32gui.SetForegroundWindow(handle)
        except Exception:
            try:
                import pyautogui

                rect = _usable_window_rect(handle)
                pyautogui.click(*_point(rect, (0.5, 0.018)))
                time.sleep(0.2)
            except Exception as fallback_exc:
                raise RenderSurfaceError(
                    f"无法把朋友圈窗口置前：{exc}; 兜底激活失败：{fallback_exc}",
                    code="WECHAT_MOMENTS_WINDOW_NOT_FOREGROUND",
                ) from fallback_exc
    return _usable_window_rect(handle)


def _point(rect: tuple[int, int, int, int], ratio: tuple[float, float]) -> tuple[int, int]:
    left, top, right, bottom = rect
    return (
        round(left + (right - left) * ratio[0]),
        round(top + (bottom - top) * ratio[1]),
    )


def _wait_for(predicate: Callable[[], Any], *, timeout: float, description: str) -> Any:
    deadline = time.monotonic() + max(0.5, float(timeout))
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as exc:
            last_error = exc
        time.sleep(0.2)
    detail = f"（{last_error}）" if last_error else ""
    raise RenderSurfaceError(f"等待{description}超时{detail}", code="WECHAT_RENDER_SURFACE_TIMEOUT")


def _file_dialog_candidates() -> list[tuple[int, str, tuple[int, int, int, int]]]:
    """Enumerate visible native file dialogs without ambiguous title lookup."""

    import win32gui

    foreground = int(win32gui.GetForegroundWindow() or 0)
    candidates: list[tuple[int, str, tuple[int, int, int, int]]] = []

    def collect(handle: int, _extra: Any) -> None:
        try:
            if not win32gui.IsWindowVisible(handle) or win32gui.GetClassName(handle) != "#32770":
                return
            title = str(win32gui.GetWindowText(handle) or "").strip()
            if title not in FILE_DIALOG_TITLES:
                return
            candidates.append((int(handle), title, tuple(int(value) for value in win32gui.GetWindowRect(handle))))
        except Exception:
            return

    win32gui.EnumWindows(collect, None)
    candidates.sort(
        key=lambda item: (
            item[0] == foreground,
            max(0, item[2][2] - item[2][0]) * max(0, item[2][3] - item[2][1]),
        ),
        reverse=True,
    )
    return candidates


def _try_open_moments_with_upstream() -> bool:
    """Open Moments through the current render surface, then old UIA as fallback.

    The current WeChat build exposes the main window but not the sidebar
    controls to UI Automation.  A bounded, window-relative click is therefore
    the supported path for this exact render-surface profile.  The upstream
    UIA call remains only as a compatibility fallback for a different build.
    """

    try:
        import pyautogui

        main_handle = find_wechat_main_window_handle()
        if main_handle:
            rect = _activate(main_handle)
            pyautogui.click(*_point(rect, MOMENTS_NAV_RATIO))
            time.sleep(0.35)
            if find_moments_window_handle():
                return True
    except Exception:
        pass

    try:
        from pyweixin import Navigator

        Navigator.open_moments(is_maximize=None, close_weixin=False)
        return bool(find_moments_window_handle())
    except Exception:
        # The caller turns a missing window into a hard, logged failure; no
        # alternative post or asset is selected.
        return False


def _stage_media_for_picker(paths: list[Path]) -> tuple[Path, list[Path]]:
    """Copy the selected media to a short-lived, short-path picker folder.

    The Windows common file dialog truncates a long multi-file value in its
    file-name edit on this local WeChat build.  Passing nine long canonical
    paths therefore silently selected only the first four.  A short staging
    directory keeps the native dialog's multi-selection value below that
    limit while leaving the real library untouched.
    """

    import shutil
    import tempfile

    anchor = paths[0].anchor or None
    stage_root = Path(tempfile.mkdtemp(prefix=".m", dir=anchor))
    staged: list[Path] = []
    try:
        for index, source in enumerate(paths, start=1):
            target = stage_root / f"{index:02d}{source.suffix.lower()}"
            shutil.copy2(source, target)
            staged.append(target)
    except Exception:
        shutil.rmtree(stage_root, ignore_errors=True)
        raise
    return stage_root, staged


def _choose_file(paths: list[Path], *, timeout: float) -> None:
    from pywinauto import Desktop

    # The same native chooser is exposed through UIA on some Windows builds
    # and only through the Win32 backend on this machine. Keep UIA first for
    # the known automation id, then fall back to the real #32770 dialog
    # instead of timing out while a visible chooser is already open.
    desktops = (Desktop(backend="uia"), Desktop(backend="win32"))

    def dialog_or_none() -> Any:
        # A single WeChat click can leave two same-titled native dialogs in
        # the desktop tree.  A title-only pywinauto lookup then raises
        # ElementAmbiguousError and the old polling loop swallowed it until
        # timeout.  Resolve the actual HWND first, and require a file-name
        # Edit control so a stale/empty #32770 window cannot win.
        for handle, _title, _rect in _file_dialog_candidates():
            for desktop in desktops:
                try:
                    dialog = desktop.window(handle=handle)
                    if not dialog.exists(timeout=0.15):
                        continue
                    edit_probe = dialog.child_window(class_name="Edit", found_index=0)
                    if edit_probe.exists(timeout=0.15):
                        return dialog
                except Exception:
                    continue
        return None

    dialog = _wait_for(dialog_or_none, timeout=timeout, description="微信原生文件选择框")
    edit = None
    for kwargs in (
        {"auto_id": "1148", "control_type": "Edit"},
        {"control_type": "Edit", "found_index": 0},
        {"class_name": "Edit", "found_index": 0},
    ):
        try:
            candidate = dialog.child_window(**kwargs)
            if candidate.exists(timeout=0.2):
                edit = candidate
                break
        except Exception:
            continue
    if edit is None:
        raise RenderSurfaceError(
            "文件选择框没有找到文件名输入框，已停止",
            code="WECHAT_FILE_PICKER_EDIT_NOT_FOUND",
        )

    value = " ".join(f'"{path}"' for path in paths) + " "
    setter = getattr(edit, "set_edit_text", None) or getattr(edit, "set_text", None)
    if not callable(setter):
        raise RenderSurfaceError(
            "文件选择框输入框不可写，已停止",
            code="WECHAT_FILE_PICKER_EDIT_NOT_WRITABLE",
        )
    setter(value)

    open_button = None
    for kwargs in (
        {"auto_id": "1", "control_type": "Button"},
        {"title": "打开(O)", "control_type": "Button"},
        {"title": "打开(&O)", "control_type": "Button"},
        {"title": "Open", "control_type": "Button"},
        {"title": "打开(&O)", "class_name": "Button"},
        {"title_re": ".*打开.*", "class_name": "Button"},
    ):
        try:
            candidate = dialog.child_window(**kwargs)
            if candidate.exists(timeout=0.2):
                open_button = candidate
                break
        except Exception:
            continue
    if open_button is None:
        raise RenderSurfaceError(
            "文件选择框没有找到“打开”按钮，已停止",
            code="WECHAT_FILE_PICKER_OPEN_NOT_FOUND",
        )
    open_button.click_input()


def detect_publish_button_visual(
    rect: tuple[int, int, int, int],
    *,
    screenshot: Callable[..., Any] | None = None,
) -> bool:
    """Detect the green publish-button band without OCR or clicking it."""

    if screenshot is None:
        from PIL import ImageGrab

        screenshot = ImageGrab.grab
    left, top, right, bottom = rect
    image = screenshot(bbox=(left, top, right, bottom))
    width, height = image.size
    x0, x1 = round(width * PUBLISH_SCAN_X[0]), round(width * PUBLISH_SCAN_X[1])
    y0, y1 = round(height * PUBLISH_SCAN_Y[0]), round(height * PUBLISH_SCAN_Y[1])
    green_pixels = 0
    green_rows = set()
    for y in range(max(0, y0), min(height, y1)):
        for x in range(max(0, x0), min(width, x1)):
            red, green, blue = image.getpixel((x, y))[:3]
            if green >= 110 and green > red * 1.25 and green > blue * 1.10:
                green_pixels += 1
                green_rows.add(y)
    return green_pixels >= 140 and len(green_rows) >= 6


def _grid_pixel_is_content(pixel: tuple[int, int, int]) -> bool:
    red, green, blue = (int(channel) for channel in pixel[:3])
    brightness = max(red, green, blue)
    return brightness >= 72 or brightness - min(red, green, blue) >= 22


def _detect_media_grid_bands(image: Any) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    """Return variable-height image rows and their three column bounds."""

    width, height = image.size
    column_bounds = [
        (
            round((MEDIA_GRID_LEFT + column * MEDIA_GRID_STEP_X) * width),
            round((MEDIA_GRID_LEFT + column * MEDIA_GRID_STEP_X + MEDIA_GRID_TILE_W) * width),
        )
        for column in range(3)
    ]
    top = max(0, round(MEDIA_GRID_TOP * height))
    bottom = min(height, round(MEDIA_GRID_SCAN_BOTTOM * height))

    def row_activity(y: int) -> int:
        if y < 0 or y >= height:
            return 0
        active = 0
        for left_edge, right_edge in column_bounds:
            for sample_x in range(left_edge + 8, max(left_edge + 9, right_edge - 8), 5):
                if _grid_pixel_is_content(image.getpixel((sample_x, y))):
                    active += 1
        return active

    samples_per_row = sum(
        max(1, len(range(left_edge + 8, max(left_edge + 9, right_edge - 8), 5)))
        for left_edge, right_edge in column_bounds
    )
    activity_threshold = max(4, round(samples_per_row * MEDIA_GRID_CONTENT_THRESHOLD))
    # A sampled fixture or a heavily compressed thumbnail can have dark scan
    # lines. Smooth only a tiny vertical neighbourhood; preserve the real
    # multi-pixel dark seam between two variable-height image rows.
    active_rows = [
        any(
            row_activity(y + delta) >= activity_threshold
            for delta in range(-MEDIA_GRID_ROW_SMOOTH, MEDIA_GRID_ROW_SMOOTH + 1)
        )
        for y in range(top, bottom)
    ]

    bands: list[tuple[int, int]] = []
    start: int | None = None
    for offset, active in enumerate(active_rows + [False]):
        if active and start is None:
            start = offset
        elif not active and start is not None:
            end = offset - 1
            if end - start + 1 >= MEDIA_GRID_ROW_MIN_HEIGHT:
                bands.append((top + start, top + end))
            start = None

    return bands, column_bounds


def detect_media_grid_count(
    rect: tuple[int, int, int, int],
    *,
    screenshot: Callable[..., Any] | None = None,
) -> int:
    """Count visually populated media cells in the local nine-grid profile.

    The Qt surface does not expose thumbnails through UI Automation. The
    detector therefore discovers variable-height rows from pixels and checks
    each column's texture; it does not assume that every source image has the
    same aspect ratio.
    """

    if screenshot is None:
        from PIL import ImageGrab

        screenshot = ImageGrab.grab
    left, top, right, bottom = rect
    image = screenshot(bbox=(left, top, right, bottom))
    bands, column_bounds = _detect_media_grid_bands(image)
    _, height = image.size
    populated = 0
    for band_top, band_bottom in bands[:3]:
        for left_edge, right_edge in column_bounds:
            content = 0
            total = 0
            for sample_y in range(band_top + 4, max(band_top + 5, band_bottom - 3), 5):
                for sample_x in range(left_edge + 8, max(left_edge + 9, right_edge - 8), 5):
                    total += 1
                    content += int(_grid_pixel_is_content(image.getpixel((sample_x, sample_y))))
            if total and content / total >= 0.05:
                populated += 1
    return populated


def detect_composer_text_visual(
    rect: tuple[int, int, int, int],
    *,
    baseline_image: Any | None = None,
    screenshot: Callable[..., Any] | None = None,
) -> bool:
    """Confirm that the composer visibly changed after the text paste.

    This is the bounded fallback for the current WeChat build where the Qt
    canvas accepts paste but ignores Ctrl+C. It compares the editor region
    with a pre-paste screenshot, so a naturally populated image grid cannot
    masquerade as proof that text was accepted. It confirms visible editor
    change, not semantic OCR correctness; the exact source text remains the
    value copied from ``content.txt`` and the final publish is manual.
    """

    if baseline_image is None:
        return False
    if screenshot is None:
        from PIL import ImageGrab

        screenshot = ImageGrab.grab
    left, top, right, bottom = rect
    image = screenshot(bbox=(left, top, right, bottom))
    if image.size != baseline_image.size:
        return False
    width, height = image.size
    x0, x1 = round(width * 0.06), round(width * 0.94)
    y0, y1 = round(height * 0.015), round(height * 0.55)
    changed = 0
    sampled = 0
    for y in range(max(0, y0), min(height, y1), 2):
        for x in range(max(0, x0), min(width, x1), 2):
            before = baseline_image.getpixel((x, y))[:3]
            after = image.getpixel((x, y))[:3]
            delta = sum(abs(int(after[index]) - int(before[index])) for index in range(3))
            changed += int(delta >= 45)
            sampled += 1
    # A short one-line note changes only a small portion of the editor ROI;
    # keep the threshold above caret noise while accepting the current Qt
    # canvas' first visible line of pasted content.
    return sampled > 0 and changed / sampled >= 0.003


def _normalise_text(value: str) -> str:
    return str(value or "").replace("\r\n", "\n")


def _paste_and_verify_text(
    text: str,
    rect: tuple[int, int, int, int],
    *,
    pyautogui: Any,
    pyperclip: Any,
    click: Callable[[int, int], Any] | None = None,
    settle_seconds: float = COMPOSER_SETTLE_SECONDS,
    max_attempts: int = COMPOSER_PASTE_ATTEMPTS,
) -> None:
    """Paste into the render-surface editor and verify the actual editor value.

    The Qt canvas can finish its nine-image re-layout after the editor is
    visually present. A single paste may therefore leave only a caret in the
    editor. This helper permits a bounded focus recovery for the same work
    item, but never changes the selected work or touches the publish button.
    """

    expected = _normalise_text(text)
    if not expected:
        raise RenderSurfaceError("朋友圈文案为空，已停止", code="WECHAT_RENDER_SURFACE_TEXT_EMPTY")
    pyperclip.copy(text)
    if _normalise_text(pyperclip.paste()) != expected:
        raise RenderSurfaceError(
            "系统剪贴板没有正确接收朋友圈文案，已停止",
            code="WECHAT_RENDER_SURFACE_CLIPBOARD_UNAVAILABLE",
        )
    click = click or (lambda x, y: pyautogui.click(x, y))
    attempts = max(1, int(max_attempts))
    last_actual = ""
    from PIL import ImageGrab

    baseline_image = ImageGrab.grab(bbox=rect)
    for attempt in range(attempts):
        click(*_point(rect, COMPOSER_TEXT_RATIO))
        time.sleep(max(0.1, float(settle_seconds)) + attempt * 0.25)
        pyautogui.hotkey("ctrl", "a")
        time.sleep(0.1)
        # Re-seed the clipboard immediately before each paste. The first
        # paste may be consumed by the canvas while it is still re-layouting.
        pyperclip.copy(text)
        pyautogui.hotkey("ctrl", "v")
        time.sleep(0.55 + attempt * 0.25)
        pyautogui.hotkey("ctrl", "a")
        # If the click accidentally landed on a thumbnail or another canvas
        # surface, Ctrl+C may be ignored. Seed a sentinel immediately before
        # the readback so an unchanged clipboard cannot masquerade as proof
        # that the editor accepted the text.
        readback_sentinel = "__moments_readback_sentinel__"
        pyperclip.copy(readback_sentinel)
        pyautogui.hotkey("ctrl", "c")
        time.sleep(0.25)
        last_actual = _normalise_text(pyperclip.paste())
        if last_actual == expected:
            return
        if last_actual == readback_sentinel and detect_composer_text_visual(
            rect,
            baseline_image=baseline_image,
        ):
            # The current Qt canvas visibly reflows the media grid after a
            # paste but does not implement clipboard copy. The visual gate
            # proves the editor is occupied without pretending to have read
            # back text that Windows never returned.
            return
    raise RenderSurfaceError(
        f"朋友圈文案回读不一致：期望 {len(expected)} 字符，实际 {len(last_actual)} 字符；"
        f"已完成 {attempts} 次同一输入框焦点恢复",
        code="WECHAT_RENDER_SURFACE_TEXT_MISMATCH",
    )


def prepare_render_surface_moment(
    text: str,
    media_paths: list[Path],
    *,
    timeout: float = 15.0,
) -> RenderSurfaceResult:
    """Fill a verified Moments render surface and stop before ``发表``."""

    import pyautogui
    import pyperclip

    handle = find_moments_window_handle()
    if not handle:
        _try_open_moments_with_upstream()
        handle = _wait_for(
            find_moments_window_handle,
            timeout=min(timeout, 8.0),
            description="朋友圈窗口",
        )

    stage_root: Path | None = None
    try:
        rect = _activate(handle)
        pyautogui.rightClick(*_point(rect, CAMERA_ENTRY_RATIO))
        pyautogui.press("up", presses=2, interval=0.08)
        pyautogui.press("enter")

        stage_root, picker_paths = _stage_media_for_picker(media_paths)
        _choose_file(picker_paths, timeout=timeout)
        _wait_for(
            lambda: find_moments_window_handle() == handle,
            timeout=timeout,
            description="朋友圈图片加载",
        )
        rect = _activate(handle)
        _wait_for(
            lambda: detect_media_grid_count(rect) == len(media_paths),
            timeout=timeout,
            description=f"朋友圈九宫格 {len(media_paths)} 张图片",
        )
        # With nine images WeChat grows the grid asynchronously.  The window
        # handle returns before the editor has finished re-layout; wait for
        # that normal UI transition before focusing the text editor.
        time.sleep(1.0)

        _paste_and_verify_text(text, rect, pyautogui=pyautogui, pyperclip=pyperclip)
        pyautogui.click(*_point(rect, COMPOSER_TEXT_RATIO))

        rect = _activate(handle)
        if not detect_publish_button_visual(rect):
            raise RenderSurfaceError(
                "已填入内容，但没有检测到朋友圈最终“发表”按钮，已停止",
                code="WECHAT_RENDER_SURFACE_PUBLISH_BUTTON_NOT_DETECTED",
            )
        return RenderSurfaceResult(
            status="PREPARED_FOR_HUMAN_CONFIRM",
            final_publish_button_detected=True,
            final_publish_button_clicked=False,
        )
    finally:
        if stage_root is not None:
            import shutil

            shutil.rmtree(stage_root, ignore_errors=True)


__all__ = [
    "CAMERA_ENTRY_RATIO",
    "MOMENTS_NAV_RATIO",
    "COMPOSER_TEXT_RATIO",
    "COMPOSER_PASTE_ATTEMPTS",
    "COMPOSER_SETTLE_SECONDS",
    "RenderSurfaceError",
    "RenderSurfaceResult",
    "detect_publish_button_visual",
    "detect_media_grid_count",
    "detect_composer_text_visual",
    "find_wechat_main_window_handle",
    "find_moments_window_handle",
    "_normalise_text",
    "_paste_and_verify_text",
    "prepare_render_surface_moment",
]
