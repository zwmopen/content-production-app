"""Collect a bounded friend Moments sample into the local library."""

from __future__ import annotations

import argparse
import json
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

from .store import MomentsLibrary, _safe_name
from .weflow import collect_weflow_friend_posts


def _load_manifest(path: Path) -> list[dict[str, Any]]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []
    return value if isinstance(value, list) else []


def _pyweixin_dump(friend: str, number: int, target_folder: Path) -> list[dict[str, Any]]:
    try:
        from pyweixin import Moments
    except ImportError as exc:
        raise RuntimeError(
            "未找到 pyweixin。明天验证前请按 docs/MOMENTS-LIBRARY-V1.md 安装/配置 pywechat，"
            "不要把 pip 环境问题当成采集成功。"
        ) from exc
    # pyweixin's current source uses `text` for post_moments; its collection
    # API is the documented dump_friend_posts entry point.
    result = Moments.dump_friend_posts(
        friend=friend,
        number=number,
        save_detail=True,
        target_folder=str(target_folder),
        close_weixin=False,
    )
    return result if isinstance(result, list) else []


def collect_friend_posts(
    *,
    friend: str,
    output: str | Path,
    limit: int = 10,
    resume_only: bool = False,
    source: str = "pyweixin",
    wxid: str | None = None,
    api_base: str = "http://127.0.0.1:5031/api/v1",
    api_token: str | None = None,
    full_history: bool = False,
    page_size: int = 500,
    target_month: str | None = None,
) -> dict[str, Any]:
    if not friend.strip():
        raise ValueError("--friend 不能为空")
    if limit <= 0:
        raise ValueError("--limit 必须大于 0")
    if source == "weflow":
        summary = collect_weflow_friend_posts(
            friend=friend,
            wxid=wxid or friend,
            output=output,
            limit=limit,
            api_base=api_base,
            api_token=api_token,
            resume_only=resume_only,
            full_history=full_history,
            page_size=page_size,
            target_month=target_month,
        )
        library = MomentsLibrary(output)
        tag_organization = library.annotate_asset_metadata()
        library.rebuild_index()
        summary["tag_organization"] = tag_organization
        return summary
    if source != "pyweixin":
        raise ValueError(f"unknown collection source: {source}")
    library = MomentsLibrary(output)
    library.ensure_layout()
    payloads: list[dict[str, Any]] = []
    error: BaseException | None = None
    imported = []
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + _safe_name(friend, "friend")
    staging_root = library.staging / run_id / _safe_name(friend, "friend")
    if resume_only:
        friend_name = _safe_name(friend, "friend")
        candidates = sorted(
            [path for path in library.staging.glob(f"*/{friend_name}") if path.is_dir()],
            key=lambda path: str(path),
        )
        for candidate in candidates:
            imported.extend(
                library.import_staged_tree(
                    candidate,
                    source_account=friend,
                    payloads=_load_manifest(candidate.parent / "source-posts.json"),
                )
            )
        tag_organization = library.annotate_asset_metadata()
        library.rebuild_index()
        return {
            "friend": friend,
            "limit": limit,
            "resume_only": True,
            "staging_roots": [str(path) for path in candidates],
            "imported": len(imported),
            "work_ids": [item.work_id for item in imported],
            "deduplicated_or_ignored": 0,
            "error_log_written": False,
            "tag_organization": tag_organization,
        }

    staging_root.mkdir(parents=True, exist_ok=True)
    if not resume_only:
        try:
            payloads = _pyweixin_dump(friend, limit, staging_root)
            (staging_root.parent / "source-posts.json").write_text(
                json.dumps(payloads, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
                newline="\n",
            )
        except BaseException as exc:  # keep already exported detail folders recoverable
            error = exc
            library.write_log(
                f"collect-{run_id}.log",
                "stage=collect\n"
                f"friend={friend}\n"
                f"staging_root={staging_root}\n"
                f"error={exc!r}\n\n{traceback.format_exc()}",
            )
    try:
        imported = library.import_staged_tree(staging_root, source_account=friend, payloads=payloads)
    except BaseException as exc:
        library.write_log(
            f"collect-{run_id}-normalize.log",
            "stage=normalize\n"
            f"friend={friend}\n"
            f"staging_root={staging_root}\n"
            f"error={exc!r}\n\n{traceback.format_exc()}",
        )
        raise RuntimeError(f"作品规范化失败，已保留暂存目录：{staging_root}") from exc
    tag_organization = library.annotate_asset_metadata()
    library.rebuild_index()
    summary = {
        "friend": friend,
        "limit": limit,
        "staging_root": str(staging_root),
        "imported": len(imported),
        "work_ids": [item.work_id for item in imported],
        "deduplicated_or_ignored": max(0, len(payloads) - len(imported)),
        "error_log_written": error is not None,
        "tag_organization": tag_organization,
    }
    if error is not None:
        raise RuntimeError(json.dumps(summary, ensure_ascii=False)) from error
    return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="采集好友朋友圈并写入可恢复的团建朋友圈作品库")
    parser.add_argument("--friend", required=True, help="微信好友备注名/可访问账号")
    parser.add_argument("--output", required=True, help="朋友圈作品库根目录")
    parser.add_argument("--limit", type=int, default=10, help="本轮最多请求多少条，默认 10")
    parser.add_argument(
        "--all",
        dest="full_history",
        action="store_true",
        help="仅限 --source weflow：按 offset 分页采集该账号全部朋友圈",
    )
    parser.add_argument("--page-size", type=int, default=500, help="WeFlow 全量分页大小，默认 500")
    parser.add_argument(
        "--resume-only",
        action="store_true",
        help="导入已完成暂存；WeFlow 的 partial 会通过 HTTP API 重新取 URL/key 后续跑，不打开微信",
    )
    parser.add_argument("--source", choices=("pyweixin", "weflow"), default="pyweixin", help="collection source")
    parser.add_argument("--wxid", help="WeFlow publisher wxid; used with --source weflow")
    parser.add_argument("--api-base", default="http://127.0.0.1:5031/api/v1", help="WeFlow API base")
    parser.add_argument("--api-token", help="WeFlow API token; runtime-only")
    parser.add_argument(
        "--target-month",
        help="仅限 --source weflow：按 YYYY-MM 采集该完整月份，并使用账号级断点继续",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        summary = collect_friend_posts(
            friend=args.friend,
            output=args.output,
            limit=args.limit,
            resume_only=args.resume_only,
            source=args.source,
            wxid=args.wxid,
            api_base=args.api_base,
            api_token=args.api_token,
            full_history=args.full_history,
            page_size=args.page_size,
            target_month=args.target_month,
        )
    except Exception as exc:
        print(f"采集停止：{exc}")
        return 1
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
