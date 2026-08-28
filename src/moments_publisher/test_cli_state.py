import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace

from moments_publisher.cli import _confirmed_record
from moments_publisher.state import PublisherState


class ConfirmedRecordTests(unittest.TestCase):
    def setUp(self):
        self.archived = SimpleNamespace(
            work_id="2026-08-07_001_江湖有旅人团建",
            metadata={"confirmed_published_at": "2026-08-21T07:03:24+00:00"},
            directory=Path(r"D:\朋友圈weflow\used\2026-08-07_001_江湖有旅人团建"),
        )

    def test_preserves_scheduled_provenance_and_attempt_id(self):
        result = _confirmed_record(
            {"source": "scheduled", "attempt_id": "scheduled-attempt-1"},
            self.archived,
        )
        self.assertEqual(result["source"], "scheduled")
        self.assertEqual(result["attempt_id"], "scheduled-attempt-1")

    def test_manual_confirmation_defaults_to_manual(self):
        result = _confirmed_record({}, self.archived)
        self.assertEqual(result["source"], "manual")
        self.assertEqual(result["attempt_id"], "")


class SchedulerCountTests(unittest.TestCase):
    def test_selection_only_failure_does_not_consume_automatic_quota(self):
        with tempfile.TemporaryDirectory() as directory:
            state = PublisherState(Path(directory))
            state.set_record({
                "status": "FAILED",
                "work_id": "",
                "source": "scheduled",
                "stage": "selection",
                "error": "选材策略 anniversary 下没有同时具备 content.txt 和媒体文件的作品",
            }, "2026-08-24")
            self.assertEqual(state.count_attempts("2026-08-24", source="scheduled"), 0)

    def test_manual_confirmation_does_not_consume_scheduled_quota(self):
        state = PublisherState(Path(r"D:\朋友圈weflow"))
        state_record = {
            "attempts": [
                {"status": "FAILED", "source": "scheduled"},
                {"status": "CONFIRMED_PUBLISHED", "source": "manual"},
            ]
        }
        state.save = lambda value: None
        state.load = lambda: {"2026-08-21": state_record}
        self.assertEqual(state.count_attempts("2026-08-21", source="scheduled"), 1)

    def test_confirmation_replaces_same_preparation_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            state = PublisherState(Path(directory))
            prepared = {
                "status": "PREPARED_FOR_HUMAN_CONFIRM",
                "work_id": "work-1",
                "source": "manual",
                "attempt_id": "manual-attempt-1",
            }
            confirmed = {
                "status": "CONFIRMED_PUBLISHED",
                "work_id": "work-1",
                "source": "manual",
                "attempt_id": "manual-attempt-1",
            }
            state.set_record(prepared, "2026-08-22")
            state.set_record(confirmed, "2026-08-22")
            attempts = state.attempts("2026-08-22")
            self.assertEqual(len(attempts), 1)
            self.assertEqual(attempts[0]["status"], "CONFIRMED_PUBLISHED")
            self.assertEqual(state.count_attempts("2026-08-22", source="scheduled"), 0)


if __name__ == "__main__":
    unittest.main()
