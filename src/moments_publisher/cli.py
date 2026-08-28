"""CLI for scheduled and manual, human-confirmed Moments preparations."""

from __future__ import annotations

import argparse
import json
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

from moments_library.store import MAX_PUBLISH_MEDIA, MomentsLibrary, is_viewable_media, media_files
from moments_library.catalog import SelectionPolicy, select_ready_work

from .pyweixin_adapter import _write_failure, check_pyweixin_environment, prepare_moment
from .state import PublisherState, exclusive_lock
from .wechat_preflight import WeChatPreflightError


def _failure_record(day: str, work_id: str, error: str, *, source: str = "manual", attempt_id: str = "") -> dict[str, Any]:
    return {
        "status": "FAILED",
        "work_id": work_id,
        "source": source,
        "attempt_id": attempt_id,
        "failed_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "error": error,
    }


def _is_selection_only_failure(record: dict[str, Any] | None) -> bool:
    """Return whether a failed run stopped before locking any work."""

    if not isinstance(record, dict) or str(record.get("status") or "") != "FAILED":
        return False
    if str(record.get("work_id") or "").strip():
        return False
    return str(record.get("stage") or "").strip().lower() == "selection" or str(
        record.get("error") or ""
    ).strip().startswith("选材策略")


def _confirmed_record(prepared_record: dict[str, Any], archived: Any) -> dict[str, Any]:
    """Build the durable confirmation record without losing trigger provenance.

    A scheduled preparation is still a scheduled attempt even though a human
    performs the final click.  A manual preparation remains manual.  Keeping
    the original attempt id also lets ``PublisherState`` replace the prepared
    attempt instead of appending a second, source-less confirmation record.
    """

    return {
        "status": "CONFIRMED_PUBLISHED",
        "work_id": archived.work_id,
        "source": str(prepared_record.get("source") or "manual"),
        "attempt_id": str(prepared_record.get("attempt_id") or ""),
        "confirmed_at": archived.metadata.get("confirmed_published_at"),
        "directory": str(archived.directory),
    }


def prepare_today(
    library_root: str | Path,
    *,
    dry_run: bool = True,
    retry_failed: bool = False,
    policy: SelectionPolicy = "anniversary",
    work_id: str = "",
    wechat_start_timeout: float = 20.0,
    wechat_login_timeout: float = 90.0,
    auto_open_wechat: bool = True,
    source: str = "manual",
    daily_auto_limit: int = 1,
) -> int:
    library = MomentsLibrary(library_root)
    library.ensure_layout()
    state = PublisherState(library.root)
    day = state.today()
    source = "scheduled" if source == "scheduled" else "manual"
    daily_auto_limit = max(1, min(20, int(daily_auto_limit or 1)))
    current = state.record(day)
    if current and current.get("status") == "PREPARING":
        print(json.dumps({"blocked": True, "reason": "今天已经处理过或正在处理中", "record": current}, ensure_ascii=False, indent=2))
        return 2
    if source == "scheduled" and state.count_attempts(day, source="scheduled") >= daily_auto_limit:
        print(json.dumps({
            "blocked": True,
            "reason": f"今日自动准备额度已用完（{daily_auto_limit} 条）；手动入口仍可继续准备",
            "daily_auto_limit": daily_auto_limit,
            "record": current,
        }, ensure_ascii=False, indent=2))
        return 2
    if (
        source == "scheduled"
        and current
        and current.get("status") == "FAILED"
        and not retry_failed
        and not _is_selection_only_failure(current)
    ):
        print(json.dumps({"blocked": True, "reason": "今天已有失败记录，拒绝自动重试；需人工确认后显式加 --retry-failed", "record": current}, ensure_ascii=False, indent=2))
        return 2
    if current and current.get("status") == "WAITING_FOR_HUMAN_LOGIN":
        waiting_work_id = str(current.get("work_id", ""))
        if not work_id or work_id != waiting_work_id:
            print(json.dumps({
                "blocked": True,
                "reason": "今天有作品正在等待人工完成微信登录；只能继续同一条作品，不会换下一条",
                "record": current,
            }, ensure_ascii=False, indent=2))
            return 2
    if current and current.get("status") == "QUEUED" and current.get("recovered_from") == "PREPARING":
        recovered_work_id = str(current.get("work_id", ""))
        if not work_id or work_id != recovered_work_id:
            print(json.dumps({
                "blocked": True,
                "reason": "今天有一条从中断 PREPARING 恢复的作品；只能继续同一条作品，不会自动换下一条",
                "record": current,
            }, ensure_ascii=False, indent=2))
            return 2
    if current and current.get("status") == "FAILED" and retry_failed and not work_id:
        failed_work_id = str(current.get("work_id", ""))
        failed_path = library.ready / failed_work_id
        try:
            work = library.load_work(failed_path)
        except Exception as exc:
            print(json.dumps({"blocked": True, "reason": f"FAILED 原作品已无法恢复：{exc}"}, ensure_ascii=False, indent=2))
            return 1
    elif work_id:
        selected_path = library.ready / str(work_id).strip()
        if selected_path.parent != library.ready or not selected_path.is_dir():
            print(json.dumps({"blocked": True, "reason": "指定的朋友圈作品不在 ready 目录中", "work_id": work_id}, ensure_ascii=False, indent=2))
            return 2
        try:
            work = library.load_work(selected_path)
        except Exception as exc:
            print(json.dumps({"blocked": True, "reason": f"指定作品无法读取：{exc}", "work_id": work_id}, ensure_ascii=False, indent=2))
            return 2
        selected_status = str(work.metadata.get("status", "QUEUED"))
        can_retry_same_failed_work = bool(
            retry_failed
            and current
            and current.get("status") == "FAILED"
            and str(current.get("work_id", "")) == str(work_id).strip()
            and selected_status == "FAILED"
        )
        if selected_status != "QUEUED" and not can_retry_same_failed_work:
            print(json.dumps({
                "blocked": True,
                "reason": f"指定作品当前状态为 {selected_status}，只允许 QUEUED 作品进入准备流程",
                "work_id": work.work_id,
            }, ensure_ascii=False, indent=2))
            return 2
    else:
        ready = select_ready_work(library, policy=policy)
        work = ready[0] if ready else None
    if work is None:
        if dry_run:
            print(json.dumps({
                "dry_run": True,
                "status": "NO_MATCHING_WORK",
                "selection_policy": policy,
                "reason": "智能回退没有找到历史素材，也没有今年可用作品",
                "wechat_ui": "not_probed",
            }, ensure_ascii=False, indent=2))
            return 0
        with exclusive_lock(state.lock_path):
            record = _failure_record(day, "", f"选材策略 {policy} 下没有同时具备 content.txt 和媒体文件的作品", source=source)
            record.update({
                "stage": "selection",
                "wechat_preflight": "NOT_STARTED",
                "wechat_launched": False,
                "login_button_clicked": False,
                "next_action": "补充可发布作品，或由人工明确切换选材规则后再触发",
            })
            state.set_record(record, day)
            state.append_history({"date": day, "event": "prepare_failed", "reason": record["error"]})
        print(json.dumps(record, ensure_ascii=False, indent=2))
        return 1

    # Re-scan the committed directory at publish time.  This keeps the
    # nine-image guard truthful if a human added or removed media after the
    # original import instead of trusting a stale metadata list.
    media_paths = [str(path) for path in media_files(work.directory)]
    if len(media_paths) > MAX_PUBLISH_MEDIA:
        error = f"微信朋友圈单条最多 {MAX_PUBLISH_MEDIA} 张图片，当前作品有 {len(media_paths)} 张；不会自动裁剪或换下一条"
        record = _failure_record(day, work.work_id, error, source=source)
        if dry_run:
            print(json.dumps({
                "dry_run": True,
                "status": "BLOCKED_MEDIA_LIMIT",
                "work_id": work.work_id,
                "media_count": len(media_paths),
                "max_media": MAX_PUBLISH_MEDIA,
                "error": error,
                "wechat_ui": "not_probed",
            }, ensure_ascii=False, indent=2))
            return 1
        with exclusive_lock(state.lock_path):
            library.update_status(work.work_id, "FAILED", failed_date=day, failure_log=str(library.logs))
            state.set_record(record, day)
            state.append_history({"date": day, "event": "prepare_failed", "work_id": work.work_id, "error": error})
            library.write_log(f"prepare-{day}-{work.work_id}.log", f"stage=media-limit\n{error}\n")
        print(json.dumps({"record": record, "log_dir": str(library.logs)}, ensure_ascii=False, indent=2))
        return 1
    invalid_media_paths = [path for path in media_paths if not is_viewable_media(Path(path))]
    if invalid_media_paths:
        error = "媒体文件未通过可见性校验：" + ", ".join(invalid_media_paths)
        record = _failure_record(day, work.work_id, error, source=source)
        if dry_run:
            print(json.dumps({
                "dry_run": True,
                "status": "BLOCKED_INVALID_MEDIA",
                "work_id": work.work_id,
                "invalid_media_paths": invalid_media_paths,
                "wechat_ui": "not_probed",
            }, ensure_ascii=False, indent=2))
            return 1
        with exclusive_lock(state.lock_path):
            library.update_status(work.work_id, "FAILED", failed_date=day, failure_log=str(library.logs))
            state.set_record(record, day)
            state.append_history({"date": day, "event": "prepare_failed", "work_id": work.work_id, "error": error})
            library.write_log(f"prepare-{day}-{work.work_id}.log", f"stage=media-validation\n{error}\n")
        print(json.dumps({"record": record, "log_dir": str(library.logs)}, ensure_ascii=False, indent=2))
        return 1
    plan = {
        "date": day,
        "selection_policy": policy,
        "work_id": work.work_id,
        "directory": str(work.directory),
        "text_path": str(work.directory / "content.txt"),
        "text_length": len(work.text),
        "media_count": len(media_paths),
        "max_media": MAX_PUBLISH_MEDIA,
        "media_paths": media_paths,
        "steps": ["打开微信朋友圈", "打开发表朋友圈界面", "添加图片", "填入文案", "停在最终发表前"],
        "final_publish_button": "never clicked by V1",
    }
    if dry_run:
        plan["dry_run"] = True
        plan["wechat_ui"] = "not_probed"
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 0

    with exclusive_lock(state.lock_path):
        current = state.record(day)
        if current and current.get("status") == "PREPARING":
            print(json.dumps({"blocked": True, "reason": "今天已经准备过", "record": current}, ensure_ascii=False, indent=2))
            return 2
        if source == "scheduled" and state.count_attempts(day, source="scheduled") >= daily_auto_limit:
            print(json.dumps({
                "blocked": True,
                "reason": f"今日自动准备额度已用完（{daily_auto_limit} 条）；手动入口仍可继续准备",
                "daily_auto_limit": daily_auto_limit,
                "record": current,
            }, ensure_ascii=False, indent=2))
            return 2
        attempt_id = f"{day}:{source}:{work.work_id}:{datetime.now().astimezone().strftime('%H%M%S%f')}"
        attempt_context = {"source": source, "attempt_id": attempt_id}
        library.update_status(work.work_id, "PREPARING", preparing_date=day)
        state.set_record({"status": "PREPARING", "work_id": work.work_id, **attempt_context, "started_at": datetime.now().astimezone().isoformat(timespec="seconds")}, day)
        try:
            result = prepare_moment(
                work.text,
                media_paths,
                dry_run=False,
                work_id=work.work_id,
                log_root=library.logs,
                wechat_start_timeout=wechat_start_timeout,
                wechat_login_timeout=wechat_login_timeout,
                auto_open_wechat=auto_open_wechat,
            )
            contract_errors: list[str] = []
            if result.status != "PREPARED_FOR_HUMAN_CONFIRM":
                contract_errors.append(f"适配器返回状态 {result.status!r}")
            if not result.final_publish_button_detected:
                contract_errors.append("没有检测到最终发表按钮")
            if result.final_publish_button_clicked:
                contract_errors.append("适配器报告最终发表按钮已被点击；程序不会判断是否已发表，请人工核对")
            if result.text_length != len(work.text):
                contract_errors.append(
                    f"文案长度回读不一致：期望 {len(work.text)}，实际 {result.text_length}"
                )
            if contract_errors:
                raise RuntimeError("发布准备契约校验失败：" + "；".join(contract_errors))
        except WeChatPreflightError as exc:
            error_text = f"[{exc.code}] {exc}\n\n{traceback.format_exc()}"
            if exc.code in {"WAITING_FOR_HUMAN_LOGIN", "WECHAT_MANUAL_REQUIRED"}:
                library.update_status(work.work_id, "QUEUED", waiting_for_login_date=day)
                record = {
                    "status": "WAITING_FOR_HUMAN_LOGIN",
                    "work_id": work.work_id,
                    **attempt_context,
                    "waiting_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                    "error_code": exc.code,
                    "error": error_text,
                    "wechat_launched": exc.launched,
                    "login_button_clicked": exc.login_button_clicked,
                }
                state.set_record(record, day)
                state.append_history({
                    "date": day,
                    "event": "waiting_for_human_login" if exc.code == "WAITING_FOR_HUMAN_LOGIN" else "waiting_for_manual_wechat",
                    "work_id": work.work_id,
                    "error": str(exc),
                })
                print(json.dumps({"record": record, "log_dir": str(library.logs)}, ensure_ascii=False, indent=2))
                return 3
            record = _failure_record(day, work.work_id, error_text, source=source, attempt_id=attempt_id)
            library.update_status(work.work_id, "FAILED", failed_date=day, failure_log=str(library.logs))
            state.set_record(record, day)
            state.append_history({"date": day, "event": "prepare_failed", "work_id": work.work_id, "error": str(exc)})
            print(json.dumps({"record": record, "log_dir": str(library.logs)}, ensure_ascii=False, indent=2))
            return 1
        except Exception as exc:
            error_text = f"{exc}\n\n{traceback.format_exc()}"
            record = _failure_record(day, work.work_id, error_text, source=source, attempt_id=attempt_id)
            library.update_status(work.work_id, "FAILED", failed_date=day, failure_log=str(library.logs))
            state.set_record(record, day)
            state.append_history({"date": day, "event": "prepare_failed", "work_id": work.work_id, "error": str(exc)})
            print(json.dumps({"record": record, "log_dir": str(library.logs)}, ensure_ascii=False, indent=2))
            return 1
        record = {
            "status": "PREPARED_FOR_HUMAN_CONFIRM",
            "work_id": work.work_id,
            **attempt_context,
            "prepared_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "text_length": result.text_length,
            "media_paths": list(result.media_paths),
            "final_publish_button_clicked": result.final_publish_button_clicked,
            "ui_path": result.ui_path,
        }
        library.update_status(work.work_id, "PREPARED_FOR_HUMAN_CONFIRM", prepared_date=day)
        state.set_record(record, day)
        state.append_history({"date": day, "event": "prepared_for_human_confirm", "work_id": work.work_id})
    print(json.dumps(record, ensure_ascii=False, indent=2))
    return 0


def mark_published(library_root: str | Path) -> int:
    library = MomentsLibrary(library_root)
    library.ensure_layout()
    state = PublisherState(library.root)
    day = state.today()
    with exclusive_lock(state.lock_path):
        record = state.record(day)
        if not record or record.get("status") != "PREPARED_FOR_HUMAN_CONFIRM":
            print(json.dumps({"blocked": True, "reason": "今天没有等待人工确认的作品", "record": record}, ensure_ascii=False, indent=2))
            return 2
        work_id = str(record.get("work_id", ""))
        try:
            archived = library.mark_confirmed_published(work_id)
        except Exception as exc:
            error_text = f"{exc}\n\n{traceback.format_exc()}"
            failed = _failure_record(day, work_id, error_text)
            _write_failure(library.logs, "mark_published", work_id, exc)
            state.set_record(failed, day)
            state.append_history({"date": day, "event": "mark_published_failed", "work_id": work_id, "error": str(exc)})
            print(json.dumps({"record": failed, "log_dir": str(library.logs)}, ensure_ascii=False, indent=2))
            return 1
        confirmed = _confirmed_record(record, archived)
        state.set_record(confirmed, day)
        state.append_history({"date": day, "event": "confirmed_published", "work_id": work_id})
    print(json.dumps(confirmed, ensure_ascii=False, indent=2))
    return 0


def recover_preparing(
    library_root: str | Path,
    *,
    work_id: str,
    reason: str,
    confirm_interrupted: bool = False,
) -> int:
    """Manually release one interrupted PREPARING record.

    This is deliberately narrow: it cannot touch a prepared or confirmed
    record, requires the exact work id, requires an explicit confirmation flag,
    and fails while another publisher process still owns the lock.
    """

    library = MomentsLibrary(library_root)
    library.ensure_layout()
    state = PublisherState(library.root)
    day = state.today()
    clean_work_id = str(work_id or "").strip()
    clean_reason = str(reason or "").strip()
    if not confirm_interrupted:
        print(json.dumps({
            "blocked": True,
            "reason": "恢复 PREPARING 必须显式提供 --confirm-interrupted；程序不会猜测微信窗口是否仍在运行",
        }, ensure_ascii=False, indent=2))
        return 2
    if not clean_work_id or not clean_reason:
        print(json.dumps({
            "blocked": True,
            "reason": "恢复 PREPARING 需要精确 work_id 和人工原因",
        }, ensure_ascii=False, indent=2))
        return 2

    with exclusive_lock(state.lock_path):
        record = state.record(day)
        if not record or record.get("status") != "PREPARING":
            print(json.dumps({
                "blocked": True,
                "reason": "今天没有可恢复的 PREPARING 记录；已准备或已确认状态不会被恢复命令改写",
                "record": record,
            }, ensure_ascii=False, indent=2))
            return 2
        if str(record.get("work_id", "")) != clean_work_id:
            print(json.dumps({
                "blocked": True,
                "reason": "work_id 与今天的 PREPARING 记录不一致，拒绝操作",
                "record": record,
                "work_id": clean_work_id,
            }, ensure_ascii=False, indent=2))
            return 2
        try:
            work = library.load_work(library.ready / clean_work_id)
        except Exception as exc:
            print(json.dumps({
                "blocked": True,
                "reason": f"ready 原作品无法读取，拒绝恢复：{exc}",
                "work_id": clean_work_id,
            }, ensure_ascii=False, indent=2))
            return 2
        if work.status != "PREPARING":
            print(json.dumps({
                "blocked": True,
                "reason": f"ready 原作品当前状态为 {work.status}，不是 PREPARING，拒绝恢复",
                "work_id": clean_work_id,
            }, ensure_ascii=False, indent=2))
            return 2
        recovered_at = datetime.now().astimezone().isoformat(timespec="seconds")
        library.update_status(
            clean_work_id,
            "QUEUED",
            recovered_from="PREPARING",
            recovered_at=recovered_at,
            recovery_reason=clean_reason,
        )
        recovered = {
            "status": "QUEUED",
            "work_id": clean_work_id,
            "recovered_from": "PREPARING",
            "recovered_at": recovered_at,
            "recovery_reason": clean_reason,
        }
        state.set_record(recovered, day)
        state.append_history({
            "date": day,
            "event": "preparing_recovered",
            "work_id": clean_work_id,
            "reason": clean_reason,
        })
    print(json.dumps(recovered, ensure_ascii=False, indent=2))
    return 0


def doctor_state(library_root: str | Path) -> int:
    """Read publisher state and lock information without changing anything."""

    library = MomentsLibrary(library_root)
    state = PublisherState(library.root)
    record = state.record()
    work_id = str(record.get("work_id", "")) if isinstance(record, dict) else ""
    work_status = ""
    if work_id:
        try:
            work_status = library.load_work(library.ready / work_id).status
        except Exception as exc:
            work_status = f"UNREADABLE: {exc}"
    print(json.dumps({
        "ok": True,
        "date": state.today(),
        "library_root": str(library.root),
        "resolved_library_root": str(library.resolved_root),
        "state_path": str(state.path),
        "lock_path": str(state.lock_path),
        "lock_present": state.lock_path.exists(),
        "record": record,
        "ready_work_status": work_status,
        "recovery": "recover-preparing --confirm-interrupted --work-id ... --reason ...",
    }, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="团建朋友圈每日半自动发布器：只准备，不自动点击发表")
    parser.add_argument("--library", required=True, help="朋友圈作品库根目录")
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare = subparsers.add_parser("prepare-today", help="按自动额度或手动入口准备朋友圈")
    prepare.add_argument("--dry-run", action="store_true", help="只输出选择结果，不打开微信、不写状态（默认）")
    prepare.add_argument("--live", action="store_true", help="显式允许打开微信并准备到人工发表前")
    prepare.add_argument("--retry-failed", action="store_true", help="人工确认后显式重试今天的 FAILED 记录")
    prepare.add_argument("--work-id", default="", help="指定 ready 目录中的作品；面板发送时使用，不会自动换下一条")
    prepare.add_argument("--wechat-start-timeout", type=float, default=20.0, help="等待微信进程/窗口出现的秒数")
    prepare.add_argument("--wechat-login-timeout", type=float, default=90.0, help="等待人工完成微信登录的秒数")
    prepare.add_argument("--manual-wechat", action="store_true", help="不自动启动微信；要求用户先手动打开微信")
    prepare.add_argument("--source", choices=("manual", "scheduled"), default="manual", help="调用来源；定时触发受每日自动额度限制，手动触发可追加")
    prepare.add_argument("--daily-auto-limit", type=int, default=1, help="每日自动准备条数，范围 1-20")
    prepare.add_argument(
        "--policy",
        choices=("current-year", "last-year-day", "historical-day", "last-year-month", "anniversary", "random", "all"),
        default="anniversary",
        help="选材策略：今年素材、去年今天、往年今天随机一年、去年本月、智能回退、随机挑选今年素材、全部历史素材",
    )
    subparsers.add_parser("mark-published", help="用户手动点击发表后，将今日作品归档")
    subparsers.add_parser("doctor", help="只检查 pyweixin 模块，不打开微信")
    recover = subparsers.add_parser("recover-preparing", help="人工确认中断后，仅恢复同一条 PREPARING 作品")
    recover.add_argument("--work-id", required=True, help="今天 PREPARING 记录中的精确作品 ID")
    recover.add_argument("--reason", required=True, help="人工说明为什么确认当前准备流程已中断")
    recover.add_argument("--confirm-interrupted", action="store_true", help="确认微信准备流程已中断且不再运行")
    subparsers.add_parser("doctor-state", help="只读取今日发布状态、作品状态和锁，不修改文件")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "prepare-today":
        return prepare_today(
            args.library,
            dry_run=not args.live,
            retry_failed=args.retry_failed,
            policy=args.policy,
            work_id=args.work_id,
            wechat_start_timeout=args.wechat_start_timeout,
            wechat_login_timeout=args.wechat_login_timeout,
            auto_open_wechat=not args.manual_wechat,
            source=args.source,
            daily_auto_limit=args.daily_auto_limit,
        )
    if args.command == "mark-published":
        return mark_published(args.library)
    if args.command == "doctor":
        print(json.dumps(check_pyweixin_environment(), ensure_ascii=False, indent=2))
        return 0
    if args.command == "recover-preparing":
        return recover_preparing(
            args.library,
            work_id=args.work_id,
            reason=args.reason,
            confirm_interrupted=args.confirm_interrupted,
        )
    if args.command == "doctor-state":
        return doctor_state(args.library)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
