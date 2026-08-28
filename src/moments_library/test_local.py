"""Offline smoke tests for the Moments V1 building blocks.

These tests deliberately do not import or drive WeChat. The live UI path is
reserved for the manual test session described in the project handoff.
"""

from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date
from pathlib import Path
from unittest.mock import patch

from moments_library.collect import collect_friend_posts
from moments_library.catalog import select_ready_work
from moments_library.store import MomentsLibrary, ensure_asset_metadata
from moments_library.weflow import WeFlowError, _select_posts_for_month
from moments_publisher.cli import doctor_state, mark_published, prepare_today, recover_preparing
from moments_publisher.pyweixin_adapter import (
    PrepareResult,
    _require_wechat_window,
    _verify_control_text,
    prepare_moment,
)
from moments_publisher.state import PublisherState
from moments_publisher.wechat_preflight import (
    LOGIN_REQUIRED,
    RENDER_SURFACE_READY,
    READY,
    UNKNOWN,
    WeChatReadiness,
    WeChatPreflightError,
    classify_window_class,
    ensure_wechat_ready,
)
from moments_publisher.wechat_render_surface import (
    MEDIA_GRID_LEFT,
    MEDIA_GRID_STEP_X,
    MEDIA_GRID_STEP_Y,
    MEDIA_GRID_TILE_H,
    MEDIA_GRID_TILE_W,
    MEDIA_GRID_TOP,
    detect_media_grid_count,
    detect_publish_button_visual,
)


def _write_staged_post(parent: Path, index: int, text: str) -> Path:
    post = parent / str(index)
    post.mkdir(parents=True, exist_ok=True)
    (post / "content.txt").write_text(text, encoding="utf-8")
    (post / "01.jpg").write_bytes(b"\xff\xd8\xff\xe0" + bytes(16) + b"\xff\xd9")
    return post


class MomentsLibraryLocalTests(unittest.TestCase):
    def test_weflow_month_selection_uses_previous_month_and_account_watermark(self) -> None:
        posts = [
            {"id": "aug-03", "createTime": "2026-08-20T09:00:00+08:00"},
            {"id": "sep-01", "createTime": "2026-09-01T09:00:00+08:00"},
            {"id": "aug-02", "createTime": "2026-08-10T09:00:00+08:00"},
            {"id": "jul-01", "createTime": "2026-07-31T09:00:00+08:00"},
            {"id": "aug-01", "createTime": "2026-08-01T09:00:00+08:00"},
        ]

        selected, first = _select_posts_for_month(posts, target_month="2026-08", progress={})
        self.assertEqual([item["id"] for item in selected], ["aug-03", "aug-02", "aug-01"])
        self.assertEqual(first["selected"], 3)
        self.assertFalse(first["resumed"])

        resumed, second = _select_posts_for_month(
            posts,
            target_month="2026-08",
            progress={
                "target_month": "2026-08",
                "oldest_published_at": "2026-08-10T01:00:00+00:00",
            },
        )
        self.assertEqual([item["id"] for item in resumed], ["aug-02", "aug-01"])
        self.assertTrue(second["resumed"])

    def test_weflow_month_selection_continues_from_completed_account_cursor(self) -> None:
        posts = [
            {"id": "oct-01", "createTime": "2026-10-02T09:00:00+08:00"},
            {"id": "sep-02", "createTime": "2026-09-20T09:00:00+08:00"},
            {"id": "sep-01", "createTime": "2026-09-01T09:00:00+08:00"},
            {"id": "aug-31", "createTime": "2026-08-31T09:00:00+08:00"},
        ]

        selected, result = _select_posts_for_month(
            posts,
            target_month="2026-10",
            progress={
                "target_month": "2026-09",
                "status": "COMPLETED",
                "collection_cursor_at": "2026-09-01T00:00:00+08:00",
            },
        )

        self.assertEqual([item["id"] for item in selected], ["oct-01", "sep-02", "sep-01"])
        self.assertEqual(result["window_start"], "2026-09-01T00:00:00+08:00")
        self.assertEqual(result["window_end"], "2026-11-01T00:00:00+08:00")
        self.assertTrue(result["resumed"])

        seeded, seeded_result = _select_posts_for_month(
            posts,
            target_month="2026-10",
            progress={
                "target_month": "2026-10",
                "status": "COMPLETED",
                "collection_cursor_at": "2026-09-20T09:00:00+08:00",
                "oldest_published_at": "",
            },
        )
        self.assertEqual([item["id"] for item in seeded], ["oct-01", "sep-02"])
        self.assertTrue(seeded_result["resumed"])

        completed, repeat = _select_posts_for_month(
            posts,
            target_month="2026-10",
            progress={
                "target_month": "2026-10",
                "status": "COMPLETED",
                "collection_cursor_at": "2026-11-01T00:00:00+08:00",
            },
        )
        self.assertEqual(completed, [])
        self.assertEqual(repeat["selected"], 0)

    def test_import_deduplicates_and_moves_confirmed_work(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-library-") as temp:
            root = Path(temp)
            library = MomentsLibrary(root / "library")
            staging = root / "staging"
            post = _write_staged_post(staging, 0, "安吉团建第一条原始文案")

            first = library.import_staged_post(
                post,
                source_account="老微信好友",
                published_at="2025-01-02 10:00:00",
            )
            duplicate = library.import_staged_post(
                post,
                source_account="老微信好友",
                published_at="2025-01-02 10:00:00",
            )

            self.assertIsNotNone(first)
            self.assertIsNone(duplicate)
            assert first is not None
            self.assertEqual(len(library.list_ready()), 1)
            self.assertEqual(
                (library.ready / first.work_id / "content.txt").read_text(
                    encoding="utf-8"
                ),
                "安吉团建第一条原始文案",
            )
            asset = json.loads((library.ready / first.work_id / "asset.json").read_text(encoding="utf-8"))
            self.assertEqual(asset["tags"], ["2025年", "1月", "冬季", "安吉", "团建"])
            self.assertEqual(asset["place"], "安吉")
            self.assertEqual(asset["activity_type"], "团建")
            self.assertEqual(asset["year"], 2025)

            library.update_status(first.work_id, "PREPARED_FOR_HUMAN_CONFIRM")
            self.assertEqual(library.list_ready(), [])
            library.mark_confirmed_published(first.work_id)

            self.assertTrue((library.used / first.work_id / "metadata.json").exists())
            metadata = json.loads(
                (library.used / first.work_id / "metadata.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(metadata["status"], "CONFIRMED_PUBLISHED")
            asset = json.loads((library.used / first.work_id / "asset.json").read_text(encoding="utf-8"))
            self.assertEqual(asset["usage_count"], 1)
            self.assertTrue(asset["last_used_at"])
            self.assertEqual(metadata["usage_count"], 1)

            # Repeating the human confirmation is safe and must not count the
            # same publication twice.
            library.mark_confirmed_published(first.work_id)
            repeated_asset = json.loads((library.used / first.work_id / "asset.json").read_text(encoding="utf-8"))
            self.assertEqual(repeated_asset["usage_count"], 1)

    def test_resume_only_imports_staged_posts_without_pyweixin(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-resume-") as temp:
            library_root = Path(temp) / "library"
            batch = library_root / "raw" / ".pyweixin" / "batch-1"
            _write_staged_post(batch / "老微信好友", 0, "安吉断点继续的原始文案")
            (batch / "source-posts.json").write_text(
                json.dumps(
                    [{"published_at": "2025-01-03 09:00:00", "source_id": "old-0"}],
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            summary = collect_friend_posts(
                friend="老微信好友",
                output=library_root,
                limit=10,
                resume_only=True,
            )
            repeated = collect_friend_posts(
                friend="老微信好友",
                output=library_root,
                limit=10,
                resume_only=True,
            )

            self.assertEqual(summary["imported"], 1)
            self.assertEqual(repeated["imported"], 0)
            self.assertGreaterEqual(summary["tag_organization"]["scanned"], 1)
            tagged_asset = json.loads(
                (library_root / "ready" / summary["work_ids"][0] / "asset.json").read_text(encoding="utf-8")
            )
            self.assertIn("安吉", tagged_asset.get("tags", []))
            self.assertEqual(len(MomentsLibrary(library_root).list_ready()), 1)

    def test_weflow_resume_only_finishes_a_partial_post(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-weflow-resume-") as temp:
            library_root = Path(temp) / "library"
            partial = (
                library_root
                / "raw"
                / ".weflow"
                / "batch-1"
                / "老微信好友"
                / "001_post-1.partial"
            )
            partial.mkdir(parents=True, exist_ok=True)
            (partial / "content.txt").write_text("断点中的朋友圈文案", encoding="utf-8")
            (partial / "01.enc").write_bytes(b"encrypted")

            post = {
                "id": "post-1",
                "contentDesc": "断点中的朋友圈文案",
                "createTime": 1735894800,
                "media": [{"url": "https://example.invalid/media", "key": "12345678901234567890"}],
            }
            decrypted = {"ok": True, "bytes": 6, "sha256": "a" * 64}
            def fake_decrypt(items: list[dict[str, str]]) -> list[dict[str, object]]:
                for item in items:
                    Path(item["output"]).write_bytes(b"\xff\xd8\xff\xe0" + bytes(16) + b"\xff\xd9")
                return [decrypted for _item in items]

            with patch("moments_library.weflow._read_runtime_token", return_value="runtime-token"), patch(
                "moments_library.weflow._fetch_timeline", return_value=[post]
            ), patch(
                "moments_library.weflow._decrypt_many_with_weflow_wasm", side_effect=fake_decrypt
            ):
                summary = collect_friend_posts(
                    friend="老微信好友",
                    wxid="wxid-test",
                    output=library_root,
                    limit=1,
                    resume_only=True,
                    source="weflow",
                    api_token="runtime-token",
                )

            self.assertEqual(summary["resumed_partials"], 1)
            self.assertEqual(summary["imported"], 1)
            self.assertFalse(partial.exists())
            self.assertTrue((partial.with_suffix("") / ".complete").exists())
            self.assertEqual(len(MomentsLibrary(library_root).list_ready()), 1)

    def test_publisher_state_accepts_utf8_bom(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-state-bom-") as temp:
            root = Path(temp)
            state = PublisherState(root)
            state.path.parent.mkdir(parents=True, exist_ok=True)
            state.path.write_text(
                '\ufeff{"2026-08-14":{"status":"PREPARED_FOR_HUMAN_CONFIRM"}}',
                encoding="utf-8",
            )

            record = state.record("2026-08-14")

            self.assertIsNotNone(record)
            self.assertEqual(record["status"], "PREPARED_FOR_HUMAN_CONFIRM")

    def test_library_keeps_configured_path_without_resolving_a_link_target(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-configured-root-") as temp:
            configured = Path(temp) / "library"
            library = MomentsLibrary(configured)

            self.assertEqual(library.root, configured.absolute())
            self.assertEqual(library.resolved_root, configured.resolve())

    def test_recover_preparing_requires_exact_work_and_is_audited(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-recover-preparing-") as temp:
            root = Path(temp) / "library"
            library = MomentsLibrary(root)
            item = library.import_staged_post(
                _write_staged_post(Path(temp) / "staging", 0, "恢复同一条作品"),
                source_account="作品库",
                published_at="2026-08-15 10:00:00",
            )
            assert item is not None
            library.update_status(item.work_id, "PREPARING", preparing_date=date.today().isoformat())
            publisher_state = PublisherState(root)
            publisher_state.set_record({"status": "PREPARING", "work_id": item.work_id}, date.today().isoformat())

            output = io.StringIO()
            with redirect_stdout(output):
                result = recover_preparing(
                    root,
                    work_id=item.work_id,
                    reason="隔离测试确认微信准备进程已中断",
                    confirm_interrupted=True,
                )

            self.assertEqual(result, 0)
            recovered = publisher_state.record(date.today().isoformat())
            self.assertEqual(recovered["status"], "QUEUED")
            self.assertEqual(recovered["recovered_from"], "PREPARING")
            self.assertEqual(library.load_work(library.ready / item.work_id).status, "QUEUED")
            history = (root / "state" / "publisher-history.jsonl").read_text(encoding="utf-8")
            self.assertIn("preparing_recovered", history)
            self.assertIn("隔离测试确认微信准备进程已中断", history)

            self.assertEqual(prepare_today(root, dry_run=True, policy="all"), 2)
            self.assertEqual(prepare_today(root, dry_run=True, policy="all", work_id=item.work_id), 0)

    def test_manual_prepare_can_follow_scheduled_and_auto_quota_is_general(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-multi-slot-") as temp:
            root = Path(temp) / "library"
            library = MomentsLibrary(root)
            first = library.import_staged_post(
                _write_staged_post(Path(temp) / "staging", 0, "自动准备的一条"),
                source_account="作品库",
                published_at="2025-01-07 11:00:00",
            )
            second = library.import_staged_post(
                _write_staged_post(Path(temp) / "staging", 1, "手动追加的一条"),
                source_account="作品库",
                published_at="2025-01-08 11:00:00",
            )
            assert first is not None and second is not None
            results = [
                PrepareResult(
                    status="PREPARED_FOR_HUMAN_CONFIRM",
                    text_length=len("自动准备的一条"),
                    media_paths=(str(library.ready / first.work_id / "01.jpg"),),
                    final_publish_button_detected=True,
                    final_publish_button_clicked=False,
                ),
                PrepareResult(
                    status="PREPARED_FOR_HUMAN_CONFIRM",
                    text_length=len("手动追加的一条"),
                    media_paths=(str(library.ready / second.work_id / "01.jpg"),),
                    final_publish_button_detected=True,
                    final_publish_button_clicked=False,
                ),
            ]
            with patch("moments_publisher.cli.prepare_moment", side_effect=results):
                self.assertEqual(
                    prepare_today(root, dry_run=False, policy="all", source="scheduled", daily_auto_limit=2),
                    0,
                )
                self.assertEqual(
                    prepare_today(root, dry_run=False, policy="all", source="manual"),
                    0,
                )

            attempts = PublisherState(root).attempts(date.today().isoformat())
            self.assertEqual(len(attempts), 2)
            self.assertEqual([attempt["source"] for attempt in attempts], ["scheduled", "manual"])
            self.assertEqual(PublisherState(root).count_attempts(date.today().isoformat(), source="scheduled"), 1)

    def test_scheduled_prepare_respects_configured_daily_auto_limit(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-auto-quota-") as temp:
            root = Path(temp) / "library"
            state = PublisherState(root)
            day = date.today().isoformat()
            state.set_record({"status": "CONFIRMED_PUBLISHED", "work_id": "scheduled-a", "source": "scheduled", "attempt_id": "a"}, day)
            state.set_record({"status": "CONFIRMED_PUBLISHED", "work_id": "scheduled-b", "source": "scheduled", "attempt_id": "b"}, day)

            output = io.StringIO()
            with redirect_stdout(output):
                result = prepare_today(root, dry_run=True, policy="all", source="scheduled", daily_auto_limit=2)

            self.assertEqual(result, 2)
            payload = json.loads(output.getvalue())
            self.assertEqual(payload["daily_auto_limit"], 2)
            self.assertIn("手动入口仍可继续准备", payload["reason"])

    def test_recover_preparing_refuses_a_prepared_record(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-recover-prepared-") as temp:
            root = Path(temp) / "library"
            library = MomentsLibrary(root)
            item = library.import_staged_post(
                _write_staged_post(Path(temp) / "staging", 0, "已经准备好的作品"),
                source_account="作品库",
                published_at="2026-08-15 10:00:00",
            )
            assert item is not None
            library.update_status(item.work_id, "PREPARED_FOR_HUMAN_CONFIRM")
            publisher_state = PublisherState(root)
            publisher_state.set_record(
                {"status": "PREPARED_FOR_HUMAN_CONFIRM", "work_id": item.work_id},
                date.today().isoformat(),
            )

            self.assertEqual(
                recover_preparing(
                    root,
                    work_id=item.work_id,
                    reason="不应改写已准备记录",
                    confirm_interrupted=True,
                ),
                2,
            )
            self.assertEqual(
                publisher_state.record(date.today().isoformat())["status"],
                "PREPARED_FOR_HUMAN_CONFIRM",
            )

    def test_doctor_state_is_read_only_and_reports_configured_and_resolved_paths(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-doctor-state-") as temp:
            root = Path(temp) / "library"
            output = io.StringIO()
            with redirect_stdout(output):
                result = doctor_state(root)

            self.assertEqual(result, 0)
            payload = json.loads(output.getvalue())
            self.assertEqual(payload["library_root"], str(root.absolute()))
            self.assertEqual(payload["resolved_library_root"], str(root.resolve()))
            self.assertFalse(payload["lock_present"])
            self.assertFalse(root.exists())

    def test_weflow_resume_failure_writes_a_traceback_log(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-weflow-resume-failure-") as temp:
            library_root = Path(temp) / "library"
            partial = (
                library_root
                / "raw"
                / ".weflow"
                / "batch-1"
                / "老微信好友"
                / "001_missing.partial"
            )
            partial.mkdir(parents=True, exist_ok=True)
            (partial / "content.txt").write_text("待恢复", encoding="utf-8")
            (partial / "01.enc").write_bytes(b"encrypted")

            with patch("moments_library.weflow._read_runtime_token", return_value="runtime-token"), patch(
                "moments_library.weflow._fetch_timeline", return_value=[]
            ):
                with self.assertRaises(WeFlowError):
                    collect_friend_posts(
                        friend="老微信好友",
                        wxid="wxid-secret-not-for-log",
                        output=library_root,
                        limit=1,
                        resume_only=True,
                        source="weflow",
                        api_token="runtime-token",
                    )

            logs = list((library_root / "logs").glob("resume-weflow-*.log"))
            self.assertEqual(len(logs), 1)
            log_text = logs[0].read_text(encoding="utf-8")
            self.assertIn("stage=weflow-resume", log_text)
            self.assertIn("wxid_present=True", log_text)
            self.assertNotIn("wxid-secret-not-for-log", log_text)

    def test_prepare_and_confirm_flow_is_gated_by_state(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-publisher-") as temp:
            root = Path(temp) / "library"
            library = MomentsLibrary(root)
            post = _write_staged_post(Path(temp) / "staging", 0, "今天准备发布的原始文案")
            item = library.import_staged_post(
                post,
                source_account="作品库",
                published_at="2025-01-04 11:00:00",
            )
            assert item is not None

            with patch(
                "moments_publisher.cli.prepare_moment",
                return_value=PrepareResult(
                    status="PREPARED_FOR_HUMAN_CONFIRM",
                    text_length=len("今天准备发布的原始文案"),
                    media_paths=(str(library.ready / item.work_id / "01.jpg"),),
                    final_publish_button_detected=True,
                    final_publish_button_clicked=False,
                ),
            ):
                output = io.StringIO()
                with redirect_stdout(output):
                    result = prepare_today(root, dry_run=False, policy="all")

            self.assertEqual(result, 0)
            self.assertIn("PREPARED_FOR_HUMAN_CONFIRM", output.getvalue())
            self.assertEqual(
                library.load_work(library.ready / item.work_id).metadata["status"],
                "PREPARED_FOR_HUMAN_CONFIRM",
            )

            self.assertEqual(mark_published(root), 0)
            state = json.loads(
                (root / "state" / "publisher-state.json").read_text(encoding="utf-8")
            )
            self.assertEqual(state[date.today().isoformat()]["status"], "CONFIRMED_PUBLISHED")
            self.assertTrue((root / "used" / item.work_id).exists())
            # The confirmed record is history, not a manual lock.  If there
            # is no queued second work, the normal result is simply no match.
            self.assertEqual(prepare_today(root, dry_run=True, policy="all"), 0)

    def test_prepare_moment_dry_run_never_clicks_publish(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-dry-run-") as temp:
            media = Path(temp) / "01.jpg"
            media.write_bytes(b"\xff\xd8\xff\xe0" + bytes(16) + b"\xff\xd9")
            result = prepare_moment(
                text="只做本地准备",
                medias=[media],
                dry_run=True,
            )

            self.assertEqual(result.status, "DRY_RUN_READY")
            self.assertFalse(result.final_publish_button_clicked)

    def test_prepare_today_blocks_more_than_nine_media_before_ui(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-media-limit-") as temp:
            root = Path(temp) / "library"
            post = _write_staged_post(Path(temp) / "staging", 0, "超过九张的作品不应进入微信")
            for index in range(2, 11):
                (post / f"{index:02d}.jpg").write_bytes(b"\xff\xd8\xff\xe0" + bytes(16) + b"\xff\xd9")
            library = MomentsLibrary(root)
            item = library.import_staged_post(
                post,
                source_account="作品库",
                published_at="2025-01-06 11:00:00",
            )
            assert item is not None

            output = io.StringIO()
            with redirect_stdout(output):
                result = prepare_today(root, dry_run=True, policy="all")

            self.assertEqual(result, 1)
            payload = json.loads(output.getvalue())
            self.assertEqual(payload["status"], "BLOCKED_MEDIA_LIMIT")
            self.assertEqual(payload["media_count"], 10)
            self.assertEqual(payload["max_media"], 9)
            self.assertEqual(payload["wechat_ui"], "not_probed")

    def test_prepare_moment_text_verification_fails_closed(self) -> None:
        class FakeEdit:
            def __init__(self, value: str):
                self.value = value

            def window_text(self) -> str:
                return self.value

        _verify_control_text(FakeEdit("已填入文案"), "已填入文案")
        with self.assertRaisesRegex(RuntimeError, "回读不一致"):
            _verify_control_text(FakeEdit("另一段文案"), "已填入文案")

    def test_prepare_moment_rejects_encrypted_bytes_with_image_suffix(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-invalid-media-") as temp:
            encrypted = Path(temp) / "01.jpg"
            encrypted.write_bytes(b"encrypted-bytes")

            with self.assertRaisesRegex(ValueError, "可见性校验"):
                prepare_moment("不可上传坏文件", [str(encrypted)], dry_run=True)

    def test_prepare_moment_reports_missing_wechat_window_before_uia(self) -> None:
        with patch("moments_publisher.pyweixin_adapter._find_wechat_window_handle", return_value=0):
            with self.assertRaisesRegex(RuntimeError, "没有可用的 Qt 微信主窗口"):
                _require_wechat_window()

    def test_prepare_today_rejects_adapter_that_reports_a_publish_click(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-publisher-contract-") as temp:
            root = Path(temp) / "library"
            library = MomentsLibrary(root)
            post = _write_staged_post(Path(temp) / "staging", 0, "禁止误发表")
            item = library.import_staged_post(
                post,
                source_account="作品库",
                published_at="2025-01-05 11:00:00",
            )
            assert item is not None

            with patch(
                "moments_publisher.cli.prepare_moment",
                return_value=PrepareResult(
                    status="PREPARED_FOR_HUMAN_CONFIRM",
                    text_length=len("禁止误发表"),
                    media_paths=(str(library.ready / item.work_id / "01.jpg"),),
                    final_publish_button_detected=True,
                    final_publish_button_clicked=True,
                ),
            ):
                result = prepare_today(root, dry_run=False, policy="all")

            self.assertEqual(result, 1)
            metadata = json.loads(
                (library.ready / item.work_id / "metadata.json").read_text(encoding="utf-8")
            )
            self.assertEqual(metadata["status"], "FAILED")

    def test_wechat_preflight_classifies_login_and_ready_windows(self) -> None:
        self.assertEqual(classify_window_class("mmui::LoginWindow"), LOGIN_REQUIRED)
        self.assertEqual(classify_window_class("mmui::MainWindow"), READY)
        self.assertEqual(classify_window_class(""), UNKNOWN)

    def test_wechat_preflight_allows_only_the_known_render_surface_profile(self) -> None:
        class FakeWindow:
            def window_text(self) -> str:
                return "微信"

            def class_name(self) -> str:
                return "Qt51514QWindowIcon"

        with patch("pyweixin.WeChatTools.Tools.is_weixin_running", return_value=True), patch(
            "moments_publisher.wechat_preflight._find_wechat_window_handle", return_value=100
        ), patch("pyweixin.WeChatAuto.desktop.window", return_value=FakeWindow()):
            readiness = ensure_wechat_ready(
                startup_timeout=1,
                login_timeout=1,
                poll_interval=0.1,
                allow_render_surface=True,
            )

        self.assertEqual(readiness.status, RENDER_SURFACE_READY)
        self.assertEqual(readiness.window_class, "Qt51514QWindowIcon")

    def test_wechat_preflight_waits_through_login_to_main_class_transition(self) -> None:
        class FakeWindow:
            def __init__(self, class_name: str) -> None:
                self._class_name = class_name

            def window_text(self) -> str:
                return "微信"

            def class_name(self) -> str:
                return self._class_name

        legacy_window = FakeWindow("mmui::MainWindow")
        render_window = FakeWindow("Qt51514QWindowIcon")
        with patch("pyweixin.WeChatTools.Tools.is_weixin_running", return_value=True), patch(
            "moments_publisher.wechat_preflight._find_wechat_window_handle", return_value=100
        ), patch(
            "pyweixin.WeChatAuto.desktop.window", side_effect=[legacy_window, render_window]
        ), patch(
            "moments_publisher.wechat_preflight._raw_render_surface_profile",
            side_effect=[("", ""), ("Qt51514QWindowIcon", "微信")],
        ), patch("moments_publisher.wechat_preflight.time.sleep"):
            readiness = ensure_wechat_ready(
                startup_timeout=2,
                login_timeout=1,
                poll_interval=0.1,
                allow_render_surface=True,
            )

        self.assertEqual(readiness.status, RENDER_SURFACE_READY)
        self.assertEqual(readiness.window_class, "Qt51514QWindowIcon")

    def test_wechat_preflight_prefers_native_render_surface_over_inner_uia_class(self) -> None:
        class FakeWindow:
            def window_text(self) -> str:
                return "微信"

            def class_name(self) -> str:
                return "mmui::MainWindow"

        with patch("pyweixin.WeChatTools.Tools.is_weixin_running", return_value=True), patch(
            "moments_publisher.wechat_preflight._find_wechat_window_handle", return_value=100
        ), patch("pyweixin.WeChatAuto.desktop.window", return_value=FakeWindow()), patch(
            "moments_publisher.wechat_preflight._raw_render_surface_profile",
            return_value=("Qt51514QWindowIcon", "微信"),
        ):
            readiness = ensure_wechat_ready(
                startup_timeout=1,
                login_timeout=1,
                poll_interval=0.1,
                allow_render_surface=True,
            )

        self.assertEqual(readiness.status, RENDER_SURFACE_READY)
        self.assertEqual(readiness.window_class, "Qt51514QWindowIcon")

    def test_legacy_pyweixin_uia_path_is_disabled_without_invoking_narrator_fallback(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-legacy-uia-") as temp:
            post = _write_staged_post(Path(temp) / "staging", 0, "旧 UIA 不应继续执行")
            readiness = WeChatReadiness(
                status=READY,
                handle=100,
                launched=False,
                login_button_clicked=False,
                window_class="mmui::MainWindow",
                window_title="微信",
            )
            with patch(
                "moments_publisher.pyweixin_adapter.ensure_wechat_ready",
                return_value=readiness,
            ), patch("pyweixin.WeChatTools.Navigator.open_moments", create=True) as open_moments:
                with self.assertRaises(WeChatPreflightError) as caught:
                    prepare_moment(
                        "旧 UIA 不应继续执行",
                        [str(post / "01.jpg")],
                        dry_run=False,
                    )

            self.assertEqual(caught.exception.code, "WECHAT_LEGACY_UIA_DISABLED")
            self.assertIn("讲述人", str(caught.exception))
            open_moments.assert_not_called()

    def test_render_surface_publish_visual_gate_is_fail_closed(self) -> None:
        class FakeImage:
            size = (100, 100)

            def __init__(self, green: bool) -> None:
                self.green = green

            def getpixel(self, point: tuple[int, int]) -> tuple[int, int, int]:
                x, y = point
                if self.green and 25 <= x <= 80 and 78 <= y <= 96:
                    return (35, 185, 92)
                return (40, 40, 40)

        self.assertTrue(detect_publish_button_visual((0, 0, 100, 100), screenshot=lambda **_kwargs: FakeImage(True)))
        self.assertFalse(detect_publish_button_visual((0, 0, 100, 100), screenshot=lambda **_kwargs: FakeImage(False)))

    def test_render_surface_media_grid_gate_distinguishes_four_from_nine(self) -> None:
        from PIL import Image

        width, height = 682, 851

        def fake_grid(count: int) -> Image.Image:
            image = Image.new("RGB", (width, height), (30, 30, 30))
            for index in range(count):
                row, column = divmod(index, 3)
                x = round((MEDIA_GRID_LEFT + column * MEDIA_GRID_STEP_X) * width)
                y = round((MEDIA_GRID_TOP + row * MEDIA_GRID_STEP_Y) * height)
                tile_width = round(MEDIA_GRID_TILE_W * width)
                tile_height = round(MEDIA_GRID_TILE_H * height)
                for sample_y in range(y + 8, y + tile_height - 8, 4):
                    for sample_x in range(x + 8, x + tile_width - 8, 4):
                        image.putpixel(
                            (sample_x, sample_y),
                            ((sample_x * 3) % 255, (sample_y * 5) % 255, (sample_x + sample_y) % 255),
                        )
            return image

        rect = (0, 0, width, height)
        self.assertEqual(detect_media_grid_count(rect, screenshot=lambda **_kwargs: fake_grid(4)), 4)
        self.assertEqual(detect_media_grid_count(rect, screenshot=lambda **_kwargs: fake_grid(9)), 9)

    def test_wechat_preflight_starts_process_clicks_login_once_and_reaches_main_window(self) -> None:
        class FakeLoginButton:
            def __init__(self) -> None:
                self.clicks = 0

            def exists(self, timeout: float = 0.0) -> bool:
                return True

            def click_input(self) -> None:
                self.clicks += 1

        class FakeWindow:
            def __init__(self, class_name: str, button: FakeLoginButton | None = None) -> None:
                self._class_name = class_name
                self.button = button

            def class_name(self) -> str:
                return self._class_name

            def child_window(self, **_kwargs: object) -> FakeLoginButton:
                assert self.button is not None
                return self.button

        login_button = FakeLoginButton()
        login_window = FakeWindow("mmui::LoginWindow", login_button)
        main_window = FakeWindow("mmui::MainWindow")
        with patch("pyweixin.WeChatTools.Tools.is_weixin_running", side_effect=[False, True, True]), patch(
            "pyweixin.WeChatTools.Tools.where_weixin", return_value=str(Path(__file__).resolve()),
        ), patch("moments_publisher.wechat_preflight.os.startfile"), patch(
            "moments_publisher.wechat_preflight._find_wechat_window_handle", side_effect=[100, 101],
        ), patch(
            "pyweixin.WeChatAuto.desktop.window", side_effect=[login_window, main_window],
        ), patch("moments_publisher.wechat_preflight.time.sleep"):
            readiness = ensure_wechat_ready(startup_timeout=1, login_timeout=1, poll_interval=0.1)

        self.assertEqual(readiness.status, READY)
        self.assertTrue(readiness.launched)
        self.assertTrue(readiness.login_button_clicked)
        self.assertEqual(login_button.clicks, 1)

    def test_prepare_waits_for_human_login_without_consuming_the_work(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-login-wait-") as temp:
            root = Path(temp) / "library"
            library = MomentsLibrary(root)
            post = _write_staged_post(Path(temp) / "staging", 0, "登录完成后继续准备")
            item = library.import_staged_post(
                post,
                source_account="作品库",
                published_at="2026-08-14 11:00:00",
            )
            assert item is not None

            with patch(
                "moments_publisher.cli.prepare_moment",
                side_effect=WeChatPreflightError(
                    "请扫码登录",
                    code="WAITING_FOR_HUMAN_LOGIN",
                    launched=True,
                    login_button_clicked=True,
                ),
            ):
                result = prepare_today(root, dry_run=False, policy="all")

            self.assertEqual(result, 3)
            self.assertEqual(library.load_work(library.ready / item.work_id).status, "QUEUED")
            waiting = PublisherState(root).record(date.today().isoformat())
            self.assertEqual(waiting["status"], "WAITING_FOR_HUMAN_LOGIN")

            with patch(
                "moments_publisher.cli.prepare_moment",
                return_value=PrepareResult(
                    status="PREPARED_FOR_HUMAN_CONFIRM",
                    text_length=len("登录完成后继续准备"),
                    media_paths=(str(library.ready / item.work_id / "01.jpg"),),
                    final_publish_button_detected=True,
                    final_publish_button_clicked=False,
                    wechat_launched=False,
                    login_button_clicked=False,
                ),
            ):
                resumed = prepare_today(root, dry_run=False, work_id=item.work_id, policy="all")

            self.assertEqual(resumed, 0)
            self.assertEqual(
                PublisherState(root).record(date.today().isoformat())["status"],
                "PREPARED_FOR_HUMAN_CONFIRM",
            )

    def test_date_selection_prefers_current_year_and_anniversary_month_fallback(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-selection-") as temp:
            library = MomentsLibrary(Path(temp) / "library")
            staging = Path(temp) / "staging"
            old = _write_staged_post(staging, 0, "去年")
            current = _write_staged_post(staging, 1, "今年")
            old_item = library.import_staged_post(old, source_account="作品库", published_at="2025-08-14 10:00:00")
            current_item = library.import_staged_post(current, source_account="作品库", published_at="2026-08-13 10:00:00")
            assert old_item is not None and current_item is not None
            self.assertEqual(
                [item.work_id for item in select_ready_work(library, on_date=date(2026, 8, 14), policy="current-year")],
                [current_item.work_id],
            )
            self.assertEqual(
                [item.work_id for item in select_ready_work(library, on_date=date(2026, 8, 14), policy="anniversary")],
                [old_item.work_id],
            )
            same_month = _write_staged_post(staging, 2, "历史同月")
            same_month_item = library.import_staged_post(
                same_month,
                source_account="作品库",
                published_at="2025-08-26 10:00:00",
            )
            assert same_month_item is not None
            full_month = _write_staged_post(staging, 3, "历史同月九宫格")
            for image_index in range(2, 10):
                (full_month / f"{image_index:02d}.jpg").write_bytes(b"\xff\xd8\xff\xe0" + bytes(16) + b"\xff\xd9")
            full_month_item = library.import_staged_post(
                full_month,
                source_account="作品库",
                published_at="2025-08-27 10:00:00",
            )
            assert full_month_item is not None
            anniversary_items = select_ready_work(library, on_date=date(2026, 8, 28), policy="anniversary")
            self.assertEqual(
                {item.work_id for item in anniversary_items},
                {same_month_item.work_id, full_month_item.work_id, old_item.work_id},
            )
            older_month = _write_staged_post(staging, 5, "更早历史同月")
            older_month_item = library.import_staged_post(
                older_month,
                source_account="作品库",
                published_at="2024-08-25 10:00:00",
            )
            assert older_month_item is not None
            anniversary_after_older = select_ready_work(library, on_date=date(2026, 8, 28), policy="anniversary")
            self.assertEqual(
                {item.work_id for item in anniversary_after_older},
                {same_month_item.work_id, full_month_item.work_id, old_item.work_id},
            )
            self.assertEqual(
                [item.work_id for item in anniversary_after_older],
                [item.work_id for item in select_ready_work(library, on_date=date(2026, 8, 28), policy="anniversary")],
            )
            historical_old = _write_staged_post(staging, 4, "更早的去年今天")
            historical_old_item = library.import_staged_post(
                historical_old,
                source_account="作品库",
                published_at="2024-08-14 10:00:00",
            )
            assert historical_old_item is not None
            historical_items = select_ready_work(library, on_date=date(2026, 8, 14), policy="historical-day")
            self.assertEqual(
                {item.work_id for item in historical_items},
                {old_item.work_id, historical_old_item.work_id},
            )
            self.assertEqual(
                [item.work_id for item in select_ready_work(library, on_date=date(2026, 8, 14), policy="last-year-day")],
                [old_item.work_id],
            )
            random_items = select_ready_work(library, on_date=date(2026, 8, 14), policy="random")
            self.assertEqual([item.work_id for item in random_items], [current_item.work_id])
            self.assertEqual(
                ensure_asset_metadata(library.ready / current_item.work_id)[0]["selection_enabled"],
                True,
            )

    def test_anniversary_uses_current_year_only_after_historical_month_is_exhausted(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-selection-current-year-") as temp:
            library = MomentsLibrary(Path(temp) / "library")
            staging = Path(temp) / "staging"
            current = _write_staged_post(staging, 0, "今年兜底")
            current_item = library.import_staged_post(
                current,
                source_account="作品库",
                published_at="2026-08-05 10:00:00",
            )
            assert current_item is not None
            selected = select_ready_work(
                library,
                on_date=date(2026, 8, 24),
                policy="anniversary",
            )
            self.assertEqual([item.work_id for item in selected], [current_item.work_id])

            strict = select_ready_work(
                library,
                on_date=date(2026, 8, 24),
                policy="last-year-day",
            )
            self.assertEqual(strict, [])


if __name__ == "__main__":
    unittest.main()
