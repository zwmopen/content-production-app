"""Calendar helpers shared by the Moments scheduler and Python publisher.

The Electron scheduler already uses Asia/Shanghai.  Keep the Python side on
the same fixed UTC+08:00 calendar so a machine configured to another timezone
cannot split one publishing day into two different state/selection dates.
China does not observe daylight saving time, so a fixed offset avoids adding a
runtime tzdata dependency on Windows.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone


SHANGHAI_TIMEZONE = timezone(timedelta(hours=8), "Asia/Shanghai")


def now_shanghai(value: datetime | None = None) -> datetime:
    """Return an aware datetime expressed in the Shanghai timezone."""

    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(SHANGHAI_TIMEZONE)


def today_shanghai(value: datetime | None = None) -> date:
    """Return the calendar date used by all daily Moments decisions."""

    return now_shanghai(value).date()
