import ast
import json
import threading
import unittest
import warnings
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from production_quota_policy import (
    assess_upload_budget,
    assess_generation_budget,
    read_workbench_quota,
    record_workbench_quota_event,
    return_task_to_shared_pool_for_quota,
)


class ProductionQuotaPolicyTests(unittest.TestCase):
    def test_mounted_uploads_are_recorded_before_prompt_submission(self):
        producer = Path(__file__).with_name("dual_browser_autonomous_producer.py")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            tree = ast.parse(producer.read_text(encoding="utf-8"))
        upload_calls = [
            node for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "record_upload_success"
        ]
        initial_prompt_calls = [
            node for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "send_text_prompt"
            and node.args
            and isinstance(node.args[0], ast.Name)
            and node.args[0].id == "final_prompt"
        ]
        complete_batch_checks = [
            node for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "is_complete_attachment_batch"
            and len(node.args) == 2
            and isinstance(node.args[0], ast.Attribute)
            and isinstance(node.args[0].value, ast.Name)
            and node.args[0].value.id == "self"
            and node.args[0].attr == "_attached_count"
            and isinstance(node.args[1], ast.Name)
            and node.args[1].id == "_expected_count"
        ]
        self.assertEqual(len(upload_calls), 1)
        self.assertEqual(len(initial_prompt_calls), 1)
        self.assertEqual(len(complete_batch_checks), 1)
        self.assertLess(upload_calls[0].lineno, initial_prompt_calls[0].lineno)
        self.assertLess(upload_calls[0].lineno, complete_batch_checks[0].lineno)
        self.assertLess(complete_batch_checks[0].lineno, initial_prompt_calls[0].lineno)
        self.assertIsInstance(upload_calls[0].args[1], ast.Attribute)
        self.assertEqual(upload_calls[0].args[1].attr, "_attached_count")

    def test_complete_batch_must_fit_and_rolling_expiry_releases_budget(self):
        now = 1_800_000_000.0
        records = [{"instance_id": "B", "epoch": now - 60, "uploaded_count": 75}]
        blocked = assess_upload_budget(records, "B", 6, now_epoch=now)
        self.assertFalse(blocked["allowed"])
        self.assertEqual(blocked["usedUploads"], 75)
        self.assertEqual(blocked["remainingUploads"], 5)
        self.assertEqual(blocked["waitSeconds"], 10_740)

        allowed = assess_upload_budget(records, "B", 5, now_epoch=now)
        self.assertTrue(allowed["allowed"])
        self.assertEqual(allowed["remainingUploads"], 5)

    def test_upload_budget_is_instance_scoped(self):
        now = 1_800_000_000.0
        records = [{"instance_id": "A", "epoch": now - 1, "uploaded_count": 80}]
        self.assertFalse(assess_upload_budget(records, "A", 1, now_epoch=now)["allowed"])
        self.assertTrue(assess_upload_budget(records, "B", 80, now_epoch=now)["allowed"])

    def test_quota_yield_releases_shared_task_without_failure_or_cooldown(self):
        production = {
            "lifecycleState": "生产中",
            "lockedBy": "Instance-B",
            "lockedAt": "2026-10-09 12:00:00",
            "cooldownUntil": "2026-10-09 12:30:00",
            "lastError": "old unrelated failure",
            "retryCount": 2,
        }
        result = return_task_to_shared_pool_for_quota(
            production, "B", "local_upload_safety_limit", "2026-10-09 12:01:00",
        )
        self.assertEqual(result["lifecycleState"], "待生产")
        self.assertNotIn("lockedBy", result)
        self.assertNotIn("lockedAt", result)
        self.assertNotIn("cooldownUntil", result)
        self.assertNotIn("lastError", result)
        self.assertEqual(result["retryCount"], 2)
        self.assertEqual(result["quotaYield"]["instanceId"], "B")

    def test_impossible_single_batch_is_parked_for_splitting(self):
        decision = assess_upload_budget([], "B", 81, now_epoch=1_800_000_000)
        self.assertFalse(decision["allowed"])
        self.assertTrue(decision["impossibleBatch"])
        self.assertEqual(decision["waitSeconds"], 0)

        production = return_task_to_shared_pool_for_quota(
            {"lifecycleState": "生产中", "lockedBy": "Instance-B"},
            "B", "local_upload_safety_limit", "2026-10-09 12:01:00", requires_split=True,
        )
        self.assertEqual(production["lifecycleState"], "额度待拆分")
        self.assertTrue(production["quotaYield"]["requiresSplit"])

        producer = Path(__file__).with_name("dual_browser_autonomous_producer.py")
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            tree = ast.parse(producer.read_text(encoding="utf-8"))
        split_guards = [
            node for node in ast.walk(tree)
            if isinstance(node, ast.If)
            and isinstance(node.test, ast.Compare)
            and isinstance(node.test.left, ast.Name)
            and node.test.left.id == "state"
            and len(node.test.comparators) == 1
            and isinstance(node.test.comparators[0], ast.Constant)
            and node.test.comparators[0].value == "额度待拆分"
            and any(isinstance(child, ast.Continue) for child in ast.walk(node))
        ]
        self.assertEqual(len(split_guards), 1)

    def test_generation_budget_merges_account_events_without_double_counting(self):
        now = 1_800_000_000.0
        event_time = datetime.fromtimestamp(now - 60, tz=timezone.utc).isoformat().replace("+00:00", "Z")
        local = [
            {"instance_id": "B", "epoch": now - 60, "generated_count": 35, "request_id": "same"},
            {"instance_id": "B", "epoch": now - 30, "generated_count": 5, "request_id": "local-only"},
        ]
        snapshot = {
            "accountId": "account-2",
            "settings": {"generationLimit": 45},
            "events": [{"kind": "generated", "count": 35, "requestId": "same", "recordedAt": event_time}],
        }
        result = assess_generation_budget(local, "B", 1, now_epoch=now, workbench_quota=snapshot)
        self.assertEqual(result["usedGenerations"], 40)
        self.assertEqual(result["generationLimit"], 40)
        self.assertEqual(result["waitSeconds"], 10_740)
        self.assertFalse(result["allowed"])

    def test_workbench_events_and_unmirrored_legacy_events_are_combined_once(self):
        now = 1_800_000_000.0
        mirrored_iso = datetime.fromtimestamp(now - 100, tz=timezone.utc).isoformat().replace("+00:00", "Z")
        workbench_iso = datetime.fromtimestamp(now - 40, tz=timezone.utc).isoformat().replace("+00:00", "Z")
        records = [
            {"instance_id": "B", "epoch": now - 100, "uploaded_count": 20, "request_id": "mirrored"},
            {"instance_id": "B", "epoch": now - 50, "uploaded_count": 15, "request_id": "legacy-only"},
        ]
        snapshot = {
            "accountId": "account-2",
            "settings": {"uploadLimit": 80, "generationLimit": 45, "windowHours": 3},
            "events": [
                {"kind": "uploaded", "count": 20, "requestId": "mirrored", "recordedAt": mirrored_iso},
                {"kind": "uploaded", "count": 30, "requestId": "workbench-only", "recordedAt": workbench_iso},
            ],
        }
        result = assess_upload_budget(records, "B", 16, now_epoch=now, workbench_quota=snapshot)
        self.assertEqual(result["usedUploads"], 65)
        self.assertEqual(result["remainingUploads"], 15)
        self.assertFalse(result["allowed"])

    def test_legacy_fallback_is_used_when_workbench_snapshot_is_unavailable(self):
        now = 1_800_000_000.0
        result = assess_upload_budget(
            [{"instance_id": "B", "epoch": now - 1, "uploaded_count": 79}],
            "B",
            2,
            now_epoch=now,
            workbench_quota=None,
        )
        self.assertFalse(result["allowed"])
        self.assertEqual(result["ledgerSource"], "legacy")

    def test_workbench_bridge_discovers_assigned_account_and_posts_idempotent_event(self):
        observed = {"post": None}

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == "/api/gpt-production/runtime-state":
                    value = {"ok": True, "state": {"queue": {"activeAccountId": "account-2"}}}
                elif self.path == "/api/gpt-production/quota?account=account-2":
                    value = {
                        "ok": True,
                        "quota": {
                            "accountId": "account-2",
                            "settings": {"uploadLimit": 80},
                            "uploaded": 0,
                            "generated": 0,
                            "events": [],
                        },
                    }
                else:
                    self.send_error(404)
                    return
                body = json.dumps(value).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                observed["post"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                body = json.dumps({"ok": True}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        root = f"http://127.0.0.1:{server.server_port}"
        try:
            snapshot = read_workbench_quota("B", api_root=root)
            self.assertEqual(snapshot["accountId"], "account-2")
            ok = record_workbench_quota_event(
                "B", "cdp:B:test-attempt", "uploaded", 8,
                quota_snapshot=snapshot, api_root=root,
            )
            self.assertTrue(ok)
            self.assertEqual(observed["post"], {
                "accountId": "account-2",
                "requestId": "cdp:B:test-attempt",
                "kind": "uploaded",
                "count": 8,
            })
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=1)


if __name__ == "__main__":
    unittest.main()
