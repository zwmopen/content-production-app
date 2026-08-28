"""The intentionally non-publishing WeChat preparation adapter.

The current WeChat 4.1.x path uses the version-gated render surface adapter.
The upstream ``Moments.post_moments`` UIA fallback is deliberately disabled:
its incompatible-window error tells users to enable Narrator, which is an
unwanted global input dependency for this skill. ``confirm_publish`` is
deliberately absent: the only confirmation action remains a human click
followed by ``mark-published``.
"""

from __future__ import annotations

import importlib
import inspect
import json
import os
import traceback
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from moments_library.store import is_viewable_media
from .wechat_preflight import (
    READY,
    RENDER_SURFACE_READY,
    WeChatPreflightError,
    ensure_wechat_ready,
)


@dataclass(frozen=True)
class PrepareResult:
    status: str
    text_length: int
    media_paths: tuple[str, ...]
    final_publish_button_detected: bool
    final_publish_button_clicked: bool = False
    wechat_launched: bool = False
    login_button_clicked: bool = False
    ui_path: str = "wechat-render-surface-v1"


def check_pyweixin_environment() -> dict[str, Any]:
    """Inspect imports/signatures without opening or controlling WeChat."""

    try:
        module = importlib.import_module("pyweixin")
        moments = getattr(module, "Moments", None)
        dump_method = getattr(moments, "dump_friend_posts", None)
        post_method = getattr(moments, "post_moments", None)
        return {
            "available": True,
            "module": getattr(module, "__file__", ""),
            "dump_friend_posts_signature": str(inspect.signature(dump_method)) if dump_method else None,
            "post_moments_signature": str(inspect.signature(post_method)) if post_method else None,
            "note": "仅检查 Python 模块；没有打开微信，也没有执行 UI 操作。",
        }
    except Exception as exc:
        return {
            "available": False,
            "error": repr(exc),
            "note": "仅检查 Python 模块；没有打开微信，也没有执行 UI 操作。",
        }


def _validate(text: str, medias: list[str]) -> list[Path]:
    if not text.strip():
        raise ValueError("文案不能为空")
    if not medias:
        raise ValueError("至少需要一张图片/视频")
    paths = [Path(item).expanduser().resolve() for item in medias]
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"素材文件不存在：{missing}")
    invalid = [str(path) for path in paths if path.is_file() and not is_viewable_media(path)]
    if invalid:
        raise ValueError(f"素材文件未通过图片/视频可见性校验：{invalid}")
    return paths


def _capture_error_screenshot(log_root: Path, prefix: str) -> str | None:
    try:
        import pyautogui

        log_root.mkdir(parents=True, exist_ok=True)
        target = log_root / f"{prefix}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.png"
        pyautogui.screenshot(str(target))
        return str(target)
    except Exception:
        return None


def _write_failure(log_root: Path, stage: str, work_id: str, exc: BaseException) -> Path:
    log_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    screenshot = _capture_error_screenshot(log_root, "publisher-error")
    path = log_root / f"publisher-{stamp}.log"
    path.write_text(
        "stage="
        + stage
        + "\nwork_id="
        + work_id
        + "\nerror="
        + repr(exc)
        + "\nscreenshot="
        + str(screenshot or "not-captured")
        + "\n\n"
        + traceback.format_exc(),
        encoding="utf-8",
        newline="\n",
    )
    return path


def _read_control_text(control: Any) -> str | None:
    """Read a UIA/pywinauto edit value without guessing from screen pixels."""

    for method_name in ("get_value", "window_text"):
        method = getattr(control, method_name, None)
        if not callable(method):
            continue
        try:
            value = method()
        except Exception:
            continue
        if value is not None:
            return str(value).replace("\r\n", "\n")
    return None


def _verify_control_text(control: Any, expected: str) -> None:
    actual = _read_control_text(control)
    if actual is None:
        raise RuntimeError("无法从微信发布文案控件读取已填入内容，已停止以避免误发表")
    if actual != expected.replace("\r\n", "\n"):
        raise RuntimeError(
            f"微信发布文案回读不一致：期望 {len(expected)} 字符，实际 {len(actual)} 字符"
        )


def _find_wechat_window_handle() -> int:
    try:
        import win32gui
    except ImportError as exc:
        raise RuntimeError("缺少 pywin32，无法定位微信主窗口") from exc
    for title in ("微信", "Weixin"):
        handle = int(win32gui.FindWindow("Qt51514QWindowIcon", title) or 0)
        if handle:
            return handle
    return 0


def _require_wechat_window() -> int:
    handle = _find_wechat_window_handle()
    if not handle:
        raise RuntimeError(
            "检测到微信进程但没有可用的 Qt 微信主窗口；请先手动打开并登录 PC 微信，"
            "确认窗口没有被最小化到异常状态或以不同权限运行后再重试"
        )
    return handle


def prepare_moment(
    text: str,
    medias: list[str],
    *,
    dry_run: bool = False,
    work_id: str = "",
    log_root: str | os.PathLike[str] | None = None,
    wechat_start_timeout: float = 20.0,
    wechat_login_timeout: float = 90.0,
    auto_open_wechat: bool = True,
) -> PrepareResult:
    paths = _validate(text, medias)
    if dry_run:
        return PrepareResult(
            status="DRY_RUN_READY",
            text_length=len(text),
            media_paths=tuple(str(path) for path in paths),
            final_publish_button_detected=False,
        )
    stage = "wechat-preflight"
    try:
        readiness = ensure_wechat_ready(
            startup_timeout=wechat_start_timeout,
            login_timeout=wechat_login_timeout,
            auto_start_wechat=auto_open_wechat,
            allow_render_surface=True,
        )
        if readiness.status == RENDER_SURFACE_READY:
            stage = "render-surface-prepare"
            from .wechat_render_surface import prepare_render_surface_moment

            render_result = prepare_render_surface_moment(text, paths)
            return PrepareResult(
                status=render_result.status,
                text_length=len(text),
                media_paths=tuple(str(path) for path in paths),
                final_publish_button_detected=render_result.final_publish_button_detected,
                final_publish_button_clicked=render_result.final_publish_button_clicked,
                wechat_launched=readiness.launched,
                login_button_clicked=readiness.login_button_clicked,
                ui_path="wechat-render-surface-v1",
            )
        if readiness.status == READY:
            raise WeChatPreflightError(
                "检测到旧版 pyweixin UIA 主窗口，但该发布路径已禁用。"
                "为避免触发上游隐含的 Windows 讲述人依赖，当前技能只允许使用版本门控的微信渲染画布；"
                "本次没有打开朋友圈、填图、填文案，也没有点击发表。",
                code="WECHAT_LEGACY_UIA_DISABLED",
                launched=readiness.launched,
                login_button_clicked=readiness.login_button_clicked,
            )
        raise WeChatPreflightError(
            f"微信前置状态不支持朋友圈准备：{readiness.status!r}；"
            "本次没有打开朋友圈、填图、填文案，也没有点击发表。",
            code="WECHAT_UNSUPPORTED_READINESS",
            launched=readiness.launched,
            login_button_clicked=readiness.login_button_clicked,
        )
    except Exception as exc:
        if log_root:
            _write_failure(Path(log_root), stage, work_id, exc)
        raise
