"""Regression tests for the shared Shanghai calendar used by Moments."""

from __future__ import annotations

import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

from moments_library.clock import today_shanghai
from moments_publisher.state import PublisherState


class MomentsClockTests(unittest.TestCase):
    def test_calendar_date_is_shanghai_date_near_utc_midnight(self) -> None:
        before_midnight = datetime(2026, 8, 18, 15, 59, tzinfo=timezone.utc)
        after_midnight = datetime(2026, 8, 18, 16, 1, tzinfo=timezone.utc)

        self.assertEqual(today_shanghai(before_midnight), date(2026, 8, 18))
        self.assertEqual(today_shanghai(after_midnight), date(2026, 8, 19))

    def test_publisher_state_uses_the_shared_calendar(self) -> None:
        with tempfile.TemporaryDirectory(prefix="moments-clock-") as temp:
            state = PublisherState(Path(temp))
            with patch("moments_publisher.state.today_shanghai", return_value=date(2026, 8, 19)):
                self.assertEqual(state.today(), "2026-08-19")


if __name__ == "__main__":
    unittest.main()
