"""Small JSON state machine for scheduled and manual Moments preparations."""

from __future__ import annotations

import json
import os
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from moments_library.clock import today_shanghai


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def read_json(path: Path, default: Any) -> Any:
    try:
        # PowerShell and some Windows editors may write UTF-8 JSON with a BOM.
        # State must remain readable after a manual inspection/repair.
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


@contextmanager
def exclusive_lock(path: Path) -> Iterator[None]:
    """Fail closed if another publisher process owns the state lock."""

    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise RuntimeError(f"发现已有发布锁：{path}。请确认没有另一个任务正在操作后再人工处理该锁。") from exc
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps({"pid": os.getpid(), "created_at": utc_now()}, ensure_ascii=False))
        yield
    finally:
        try:
            path.unlink()
        except FileNotFoundError:
            pass


class PublisherState:
    def __init__(self, library_root: Path):
        self.root = library_root
        self.state_dir = library_root / "state"
        self.path = self.state_dir / "publisher-state.json"
        self.history_path = self.state_dir / "publisher-history.jsonl"
        self.lock_path = self.state_dir / "publisher.lock"

    def load(self) -> dict[str, Any]:
        value = read_json(self.path, {})
        return value if isinstance(value, dict) else {}

    def save(self, value: dict[str, Any]) -> None:
        atomic_json(self.path, value)

    def today(self) -> str:
        return today_shanghai().isoformat()

    def record(self, day: str | None = None) -> dict[str, Any] | None:
        return self.load().get(day or self.today())

    @staticmethod
    def _clean_record(record: dict[str, Any]) -> dict[str, Any]:
        clean = dict(record)
        clean.pop("attempts", None)
        return clean

    def attempts(self, day: str | None = None) -> list[dict[str, Any]]:
        """Return the day's preparation attempts, including legacy state.

        The top-level record remains the latest attempt for existing callers.
        Newer state files additionally retain every attempt so a scheduled
        preparation does not make a later manual preparation look like a
        duplicate or erase the audit trail.
        """

        record = self.record(day)
        if not isinstance(record, dict):
            return []
        raw_attempts = record.get("attempts")
        if isinstance(raw_attempts, list):
            attempts = [self._clean_record(item) for item in raw_attempts if isinstance(item, dict)]
            if attempts:
                return attempts
        clean = self._clean_record(record)
        return [clean] if clean.get("status") else []

    def count_attempts(
        self,
        day: str | None = None,
        *,
        source: str = "scheduled",
        statuses: set[str] | None = None,
    ) -> int:
        allowed_statuses = statuses or {
            "PREPARING",
            "PREPARED_FOR_HUMAN_CONFIRM",
            "CONFIRMED_PUBLISHED",
            "FAILED",
            "WAITING_FOR_HUMAN_LOGIN",
        }
        return sum(
            1
            for attempt in self.attempts(day)
            if (str(attempt.get("source") or "scheduled") == source)
            and str(attempt.get("status") or "") in allowed_statuses
            and not self._is_selection_only_failure(attempt)
        )

    @staticmethod
    def _is_selection_only_failure(attempt: dict[str, Any]) -> bool:
        """A missing candidate is not a WeChat preparation attempt.

        It is safe to reconsider this record after the selection rule or
        library changes: no work was locked, no window was opened, and no
        media or text was entered. Real work-specific failures still consume
        the automatic quota and remain fail-stop.
        """

        if str(attempt.get("status") or "") != "FAILED":
            return False
        if str(attempt.get("work_id") or "").strip():
            return False
        stage = str(attempt.get("stage") or "").strip().lower()
        error = str(attempt.get("error") or "").strip()
        return stage == "selection" or error.startswith("选材策略")

    def set_record(self, record: dict[str, Any], day: str | None = None) -> None:
        state = self.load()
        key = day or self.today()
        previous = state.get(key)
        incoming = self._clean_record(record)
        existing_attempts: list[dict[str, Any]] = []
        if isinstance(previous, dict):
            raw_attempts = previous.get("attempts")
            if isinstance(raw_attempts, list):
                existing_attempts = [self._clean_record(item) for item in raw_attempts if isinstance(item, dict)]
            elif previous.get("status"):
                existing_attempts = [self._clean_record(previous)]

        incoming_id = str(incoming.get("attempt_id") or "")
        incoming_work_id = str(incoming.get("work_id") or "")
        replace_index = -1
        if incoming_id:
            replace_index = next(
                (index for index, item in enumerate(existing_attempts)
                 if str(item.get("attempt_id") or "") == incoming_id),
                -1,
            )
        if replace_index < 0 and isinstance(previous, dict):
            previous_work_id = str(previous.get("work_id") or "")
            if incoming_work_id and incoming_work_id == previous_work_id and existing_attempts:
                replace_index = len(existing_attempts) - 1
        if replace_index >= 0:
            existing_attempts[replace_index] = incoming
        elif incoming.get("status"):
            existing_attempts.append(incoming)

        output = dict(incoming)
        if existing_attempts:
            output["attempts"] = existing_attempts
        state[key] = output
        self.save(state)

    def append_history(self, event: dict[str, Any]) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        with self.history_path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps({"recorded_at": utc_now(), **event}, ensure_ascii=False) + "\n")
