"""Date-aware cataloging and selection for the local Moments library."""

from __future__ import annotations

import argparse
import json
import random
from datetime import date, datetime
from pathlib import Path
from typing import Literal

from .clock import today_shanghai
from .store import MomentsLibrary, WorkItem, parse_published_at


SelectionPolicy = Literal[
    "current-year",
    "last-year-day",
    "historical-day",
    "last-year-month",
    "anniversary",
    "random",
    "all",
]


def _asset_enabled(work: WorkItem) -> bool:
    asset_path = work.directory / "asset.json"
    if not asset_path.is_file():
        return True
    try:
        value = json.loads(asset_path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return False
    return value.get("selection_enabled", True) is not False if isinstance(value, dict) else False


def select_ready_work(
    library: MomentsLibrary,
    *,
    on_date: date | None = None,
    policy: SelectionPolicy = "anniversary",
) -> list[WorkItem]:
    """Return eligible works in a stable order.

    ``anniversary`` is the default automatic rule. It checks the previous
    year's exact month/day, then falls back within the previous year/month and
    finally the historical same month, then a current-year queued work as a
    last-resort fallback. ``last-year-day`` remains strict and
    only checks the previous year's exact month/day. ``historical-day`` broadens
    that date to older years and chooses a stable random year for the day.

    ``anniversary`` is an explicit smart fallback.  It uses a stable daily
    random choice after the exact-date match is unavailable:

    1. the previous year's exact month/day;
    2. a random post from the previous year's month;
    3. a random historical post in the same month, if the previous year's
       month has no usable work.

    If no historical same-month work exists, the final fallback uses the most
    recent eligible current-year work. This keeps the daily publisher moving
    when the historical archive is exhausted while retaining an explicit
    smart-fallback policy; strict policies never cross their own date scope.
    """

    if policy not in {
        "current-year",
        "last-year-day",
        "historical-day",
        "last-year-month",
        "anniversary",
        "random",
        "all",
    }:
        raise ValueError(f"未知选材策略: {policy}")
    target = on_date or today_shanghai()
    eligible: list[tuple[datetime, WorkItem]] = []
    for work in library.list_ready(repair=False):
        if not _asset_enabled(work):
            continue
        published = parse_published_at(work.published_at, work.work_id)
        if published is None:
            continue
        if published.date() > target:
            continue
        eligible.append((published, work))

    fallback_random = False
    if policy in {"current-year", "random"}:
        candidates = [pair for pair in eligible if pair[0].year == target.year]
        candidates.sort(key=lambda pair: (pair[0], pair[1].work_id))
    elif policy == "last-year-day":
        candidates = [
            pair
            for pair in eligible
            if pair[0].year == target.year - 1
            and pair[0].month == target.month
            and pair[0].day == target.day
        ]
        candidates.sort(key=lambda pair: (pair[0], pair[1].work_id))
    elif policy == "historical-day":
        candidates = [
            pair
            for pair in eligible
            if pair[0].year < target.year
            and pair[0].month == target.month
            and pair[0].day == target.day
        ]
        candidates.sort(key=lambda pair: (pair[0], pair[1].work_id))
    elif policy == "last-year-month":
        candidates = [
            pair
            for pair in eligible
            if pair[0].year == target.year - 1 and pair[0].month == target.month
        ]
        candidates.sort(
            key=lambda pair: (
                abs(pair[0].day - target.day),
                -min(len(pair[1].media_files), 9),
                pair[0],
                pair[1].work_id,
            )
        )
    elif policy == "all":
        candidates = sorted(eligible, key=lambda pair: (pair[0], pair[1].work_id))
    else:
        exact_last_year = [
            pair for pair in eligible
            if pair[0].year == target.year - 1
            and pair[0].month == target.month
            and pair[0].day == target.day
        ]
        if exact_last_year:
            candidates = sorted(exact_last_year, key=lambda pair: (pair[0], pair[1].work_id))
        else:
            last_year_month = [
                pair for pair in eligible
                if pair[0].year == target.year - 1
                and pair[0].month == target.month
            ]
            if last_year_month:
                candidates = sorted(last_year_month, key=lambda pair: (pair[0], pair[1].work_id))
                fallback_random = True
            else:
                candidates = [
                    pair for pair in eligible
                    if pair[0].year < target.year and pair[0].month == target.month
                ]
                if candidates:
                    candidates.sort(key=lambda pair: (pair[0], pair[1].work_id))
                    fallback_random = True
                else:
                    # Historical material can be exhausted or already moved
                    # to used/. The smart rule must still be useful for the
                    # daily queue, so use a queued current-year work only as
                    # its final fallback. Keep this out of strict policies.
                    candidates = [pair for pair in eligible if pair[0].year == target.year]
                    candidates.sort(key=lambda pair: (-pair[0].timestamp(), pair[1].work_id))
    if policy in {"random", "historical-day"} or fallback_random:
        # Keep a stable choice for the whole Shanghai day.  This makes
        # previews and repeated reads predictable without making the rule
        # another source of persisted state.
        random.Random(f"{target.isoformat()}:{policy}:fallback").shuffle(candidates)
    return [work for _, work in candidates]


def annotate_library(library_root: str | Path) -> dict[str, int]:
    return MomentsLibrary(library_root).annotate_asset_metadata()


def _parse_date(value: str | None) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date() if value else today_shanghai()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="管理朋友圈作品的标签元数据和日期选材")
    parser.add_argument("--library", required=True, help="朋友圈作品库根目录")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("annotate", help="为现有作品补齐或更新 asset.json")
    list_parser = subparsers.add_parser("list", help="按日期策略列出可用作品")
    list_parser.add_argument(
        "--policy",
        choices=("current-year", "last-year-day", "historical-day", "last-year-month", "anniversary", "random", "all"),
        default="anniversary",
    )
    list_parser.add_argument("--date", dest="target_date", help="测试指定日期，格式 YYYY-MM-DD")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    library = MomentsLibrary(args.library)
    library.ensure_layout()
    if args.command == "annotate":
        print(json.dumps(annotate_library(args.library), ensure_ascii=False, indent=2))
        return 0
    items = select_ready_work(library, on_date=_parse_date(args.target_date), policy=args.policy)
    print(json.dumps(
        {
            "policy": args.policy,
            "date": _parse_date(args.target_date).isoformat(),
            "count": len(items),
            "items": [
                {
                    "work_id": item.work_id,
                    "published_at": item.published_at,
                    "text_path": str(item.directory / "content.txt"),
                    "media_count": len(item.media_files),
                    "directory": str(item.directory),
                }
                for item in items
            ],
        },
        ensure_ascii=False,
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
