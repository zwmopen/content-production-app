"""Durable storage for the Moments collection and publishing workflow.

The store deliberately keeps the original pyweixin export under ``raw`` and
creates a normalized, human-readable copy under ``ready``.  A successful
item is committed one item at a time; a later run can rebuild the index from
the directories if the process stopped between two writes.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from uuid import uuid4


WORK_STATUSES = {
    "QUEUED",
    "PREPARING",
    "PREPARED_FOR_HUMAN_CONFIRM",
    "CONFIRMED_PUBLISHED",
    "FAILED",
}

MEDIA_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".bmp",
    ".heic",
    ".mp4",
    ".mov",
    ".m4v",
}
TEXT_FILENAMES = ("content.txt", "文案.txt", "内容.txt", "text.txt")
SCREENSHOT_FILENAMES = {"内容截图.png", "screenshot.png", "content-screenshot.png"}
ASSET_METADATA_FILENAME = "asset.json"
MAX_PUBLISH_MEDIA = 9

PLACE_KEYWORDS = (
    ("富阳", ("富阳",)),
    ("萧山", ("萧山",)),
    ("余杭", ("余杭",)),
    ("象山", ("象山",)),
    ("杭州", ("杭州", "杭州市", "西湖", "余杭", "临平", "萧山", "富阳")),
    ("义乌", ("义乌", "义乌市")),
    ("宁波", ("宁波", "宁波市", "象山", "东钱湖")),
    ("安吉", ("安吉", "安吉县")),
    ("湖州", ("湖州", "湖州市", "莫干山")),
    ("绍兴", ("绍兴", "绍兴市", "柯桥", "上虞")),
    ("嘉兴", ("嘉兴", "嘉兴市", "乌镇")),
    ("上海", ("上海", "上海市")),
    ("苏州", ("苏州", "苏州市")),
    ("千岛湖", ("千岛湖",)),
)

ACTIVITY_KEYWORDS = (
    ("露营", ("露营", "营地", "帐篷")),
    ("漂流", ("漂流", "水上漂")),
    ("户外拓展", ("拓展", "团建拓展", "户外活动")),
    ("真人CS", ("真人CS", "真人cs", "cs对战")),
    ("烧烤", ("烧烤", "BBQ", "bbq")),
    ("骑行", ("骑行", "自行车")),
    ("皮划艇", ("皮划艇", "划船", "桨板")),
    ("年会", ("年会", "周年会")),
    ("景区游玩", ("景区", "古镇", "古村", "游玩")),
    ("团建", ("团建", "团队建设", "企业团建")),
)


def _unique(values: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))


def derive_asset_metadata(text: str, published_at: str, fallback_name: str = "") -> dict[str, Any]:
    """Infer stable, explainable filter fields without rewriting source copy."""

    parsed = parse_published_at(published_at, fallback_name)
    source = f"{fallback_name}\n{text}"
    places = [name for name, keywords in PLACE_KEYWORDS if any(keyword in source for keyword in keywords)]
    activities = [name for name, keywords in ACTIVITY_KEYWORDS if any(keyword in source for keyword in keywords)]
    season = ""
    if parsed:
        season = {12: "冬季", 1: "冬季", 2: "冬季", 3: "春季", 4: "春季", 5: "春季", 6: "夏季", 7: "夏季", 8: "夏季", 9: "秋季", 10: "秋季", 11: "秋季"}[parsed.month]
    year_tag = f"{parsed.year}年" if parsed else ""
    month_tag = f"{parsed.month}月" if parsed else ""
    auto_tags = _unique([year_tag, month_tag, season, *places, *activities])
    return {
        "year": parsed.year if parsed else None,
        "month": parsed.month if parsed else None,
        "day": parsed.day if parsed else None,
        "season": season,
        "place": places[0] if places else "",
        "places": places,
        "activity_type": activities[0] if activities else "团建",
        "activity_types": activities or ["团建"],
        "auto_tags": auto_tags,
    }


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _json_dump(path: Path, value: Any) -> None:
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


def _read_json(path: Path, default: Any = None) -> Any:
    try:
        # PowerShell's UTF-8 writer adds a BOM on some Windows versions.
        # Accept both BOM and BOM-less JSON so a library copied or repaired
        # from Windows tooling remains visible to the publisher.
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default


def _safe_name(value: str, fallback: str = "moments") -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(value or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return (cleaned or fallback)[:100]


def _natural_key(path: Path) -> tuple[Any, ...]:
    return tuple(int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", path.name))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def media_files(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    return sorted(
        [
            item
            for item in folder.iterdir()
            if item.is_file()
            and item.suffix.lower() in MEDIA_EXTENSIONS
            and item.name not in SCREENSHOT_FILENAMES
        ],
        key=_natural_key,
    )


def is_viewable_media(path: Path) -> bool:
    """Reject encrypted bytes masquerading as image/video files."""
    try:
        size = path.stat().st_size
        with path.open("rb") as handle:
            head = handle.read(16)
            if head[:3] == b"\xff\xd8\xff":
                if size < 4:
                    return False
                handle.seek(0)
                return b"\xff\xd9" in handle.read()
            if head[:8] == bytes((137, 80, 78, 71, 13, 10, 26, 10)):
                if size < 20:
                    return False
                handle.seek(-8, os.SEEK_END)
                return handle.read(8) == bytes((73, 69, 78, 68, 174, 66, 96, 130))
            if head[:6] in (b"GIF87a", b"GIF89a"):
                if size < 7:
                    return False
                handle.seek(-1, os.SEEK_END)
                return handle.read(1) == b"\x3b"
            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                return True
            if len(head) >= 8 and head[4:8] == b"ftyp":
                return True
    except (OSError, ValueError):
        return False
    return False


def read_content(folder: Path) -> str:
    for filename in TEXT_FILENAMES:
        path = folder / filename
        if path.is_file():
            return path.read_text(encoding="utf-8", errors="replace")
    return ""


def parse_published_at(value: Any, fallback_name: str = "") -> datetime | None:
    """Parse the source publish time without guessing from file mtime."""

    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 10_000_000_000:
            timestamp /= 1000
        try:
            return datetime.fromtimestamp(timestamp)
        except (OSError, OverflowError, ValueError):
            return None
    text = str(value or "").strip()
    if text:
        normalized = text.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
            return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed
        except ValueError:
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d"):
                try:
                    return datetime.strptime(text, fmt)
                except ValueError:
                    continue
        match = re.search(r"(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)", text)
        if match:
            try:
                return datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)))
            except ValueError:
                return None
    match = re.search(r"^(\d{4})[-_]([01]?\d)[-_]([0-3]?\d)", fallback_name)
    if match:
        try:
            return datetime(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except ValueError:
            return None
    return None


def ensure_asset_metadata(directory: Path, *, now: str | None = None) -> tuple[dict[str, Any], bool]:
    """Create or refresh the user-editable metadata sidecar for one work."""

    source_metadata = _read_json(directory / "metadata.json", {})
    if not source_metadata:
        raise ValueError(f"作品缺少 metadata.json: {directory}")
    asset_path = directory / ASSET_METADATA_FILENAME
    existing = _read_json(asset_path, {})
    if not isinstance(existing, dict):
        existing = {}
    published_at = str(source_metadata.get("published_at", "") or "")
    text = read_content(directory)
    derived = derive_asset_metadata(text, published_at, directory.name)
    asset = dict(existing)
    previous_auto_tags = existing.get("auto_tags") if isinstance(existing.get("auto_tags"), list) else []
    existing_tags = existing.get("tags") if isinstance(existing.get("tags"), list) else []
    manual_tags = [tag for tag in existing_tags if tag not in previous_auto_tags]
    existing_places = existing.get("places") if isinstance(existing.get("places"), list) else []
    existing_activity_types = existing.get("activity_types") if isinstance(existing.get("activity_types"), list) else []
    try:
        usage_count = max(0, int(existing.get("usage_count", 0) or 0))
    except (TypeError, ValueError):
        usage_count = 0
    asset.update(
        {
            "schema_version": 1,
            "work_id": str(source_metadata.get("work_id") or directory.name),
            "published_at": published_at,
            "year": derived["year"],
            "month": derived["month"],
            "day": derived["day"],
            "season": derived["season"],
            "place": str(existing.get("place", "") or derived["place"]),
            "places": _unique([*existing_places, *derived["places"], existing.get("place", "")]),
            "activity_type": str(existing.get("activity_type", "") or derived["activity_type"]),
            "activity_types": _unique([*existing_activity_types, *derived["activity_types"], existing.get("activity_type", "")]),
            "usage_count": usage_count,
            "auto_tags": derived["auto_tags"],
            "tags": _unique([*manual_tags, *derived["auto_tags"]]),
            "category": str(existing.get("category", "") or derived["activity_type"] or "团建"),
            "selection_enabled": bool(existing.get("selection_enabled", True)),
            "notes": str(existing.get("notes", "") or ""),
        }
    )
    if not asset.get("created_at"):
        asset["created_at"] = now or utc_now()
    changed = asset != existing
    if changed:
        asset["updated_at"] = now or utc_now()
        _json_dump(asset_path, asset)
    return asset, changed


def fingerprint_for(
    source_account: str,
    published_at: str,
    text: str,
    media_hashes: Iterable[str],
) -> str:
    payload = {
        "source_account": source_account.strip(),
        "published_at": published_at.strip(),
        "text": text,
        "media_hashes": list(media_hashes),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def content_media_fingerprint(source_account: str, text: str, media_hashes: Iterable[str]) -> str:
    """Fallback key for partial exports where pyweixin returned no timestamp."""

    payload = {
        "source_account": source_account.strip(),
        "text": text,
        "media_hashes": list(media_hashes),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class WorkItem:
    work_id: str
    fingerprint: str
    source_account: str
    published_at: str
    text: str
    media_files: tuple[str, ...]
    directory: Path
    status: str
    metadata: dict[str, Any]


class MomentsLibrary:
    """Filesystem-backed library with explicit raw/ready/used boundaries."""

    def __init__(self, root: str | os.PathLike[str]):
        # Keep the configured spelling (including a Windows junction such as
        # ``D:\朋友圈weflow``) in all newly written manifests and state.  A
        # junction is still followed by normal filesystem operations, while
        # ``resolve()`` would silently replace the user-facing library path
        # with its physical target and make later diagnosis confusing.  The
        # resolved target remains available for callers that need an explicit
        # safety comparison.
        self.root = Path(root).expanduser().absolute()
        self.resolved_root = self.root.resolve()
        self.raw = self.root / "raw"
        self.ready = self.root / "ready"
        self.used = self.root / "used"
        self.state = self.root / "state"
        self.logs = self.root / "logs"
        self.index_path = self.root / "index.jsonl"
        self.staging = self.raw / ".pyweixin"

    def ensure_layout(self) -> None:
        for folder in (self.raw, self.ready, self.used, self.state, self.logs, self.staging):
            folder.mkdir(parents=True, exist_ok=True)

    def _metadata_paths(self) -> list[Path]:
        paths: list[Path] = []
        for base in (self.raw, self.ready, self.used):
            if not base.is_dir():
                continue
            for metadata in base.glob("*/metadata.json"):
                if metadata.parent.name.startswith("."):
                    continue
                paths.append(metadata)
        return paths

    def _preferred_metadata(self) -> dict[str, tuple[Path, dict[str, Any]]]:
        rank = {"raw": 1, "ready": 2, "used": 3}
        preferred: dict[str, tuple[Path, dict[str, Any]]] = {}
        for metadata_path in self._metadata_paths():
            metadata = _read_json(metadata_path, {})
            fingerprint = str(metadata.get("source_id_or_fingerprint", "")).strip()
            if not fingerprint:
                continue
            current = preferred.get(fingerprint)
            current_rank = rank.get(metadata_path.parent.parent.name, 0)
            if current is None or current_rank >= rank.get(current[0].parent.parent.name, 0):
                preferred[fingerprint] = (metadata_path, metadata)
        return preferred

    def rebuild_index(self) -> None:
        self.ensure_layout()
        entries: list[dict[str, Any]] = []
        for fingerprint, (path, metadata) in sorted(self._preferred_metadata().items()):
            entry = {
                "work_id": metadata.get("work_id", path.parent.name),
                "source_account": metadata.get("source_account", ""),
                "published_at": metadata.get("published_at", ""),
                "source_id_or_fingerprint": fingerprint,
                "status": metadata.get("status", "RAW"),
                "directory": str(path.parent),
                "collected_at": metadata.get("collected_at", ""),
                "media_count": metadata.get("media_count", 0),
            }
            entries.append(entry)
        fd, temp_name = tempfile.mkstemp(prefix=".index.", suffix=".tmp", dir=str(self.root))
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                for entry in entries:
                    handle.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temp_name, self.index_path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    def known_fingerprints(self) -> set[str]:
        self.ensure_layout()
        known = set(self._preferred_metadata())
        for _, metadata in self._preferred_metadata().values():
            for key in ("content_media_fingerprint", "dedupe_fingerprint"):
                value = str(metadata.get(key, "")).strip()
                if value:
                    known.add(value)
        return known

    def _next_work_id(self, source_account: str, published_at: str) -> str:
        date_part = re.search(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}", published_at or "")
        if date_part:
            date_token = re.sub(r"/", "-", date_part.group(0))
        else:
            date_token = datetime.now().strftime("%Y-%m-%d")
        existing = {
            path.name
            for base in (self.raw, self.ready, self.used)
            if base.is_dir()
            for path in base.iterdir()
            if path.is_dir() and not path.name.startswith(".")
        }
        number = 1
        while True:
            candidate = f"{date_token}_{number:03d}_{_safe_name(source_account)}"
            if candidate not in existing:
                return candidate
            number += 1

    def _write_work_files(
        self,
        destination: Path,
        content: str,
        media: list[Path],
        metadata: dict[str, Any],
    ) -> None:
        destination.mkdir(parents=True, exist_ok=False)
        (destination / "content.txt").write_text(content, encoding="utf-8", newline="\n")
        normalized_media: list[str] = []
        for index, source in enumerate(media, start=1):
            target_name = f"{index:02d}{source.suffix.lower()}"
            shutil.copy2(source, destination / target_name)
            normalized_media.append(target_name)
        metadata = dict(metadata)
        metadata["media_files"] = normalized_media
        metadata["media_count"] = len(normalized_media)
        _json_dump(destination / "metadata.json", metadata)
        ensure_asset_metadata(destination, now=metadata.get("collected_at"))

    def _repair_ready_from_raw(self) -> int:
        repaired = 0
        for raw_dir in sorted(self.raw.iterdir(), key=_natural_key) if self.raw.is_dir() else []:
            if not raw_dir.is_dir() or raw_dir.name.startswith("."):
                continue
            metadata = _read_json(raw_dir / "metadata.json", {})
            fingerprint = str(metadata.get("source_id_or_fingerprint", "")).strip()
            if not fingerprint or (self.ready / raw_dir.name).exists() or (self.used / raw_dir.name).exists():
                continue
            ready_temp = self.ready / f".{raw_dir.name}.{uuid4().hex}.tmp"
            try:
                shutil.copytree(raw_dir, ready_temp)
                ready_metadata = dict(metadata)
                ready_metadata["status"] = "QUEUED"
                ready_metadata["directory"] = str(self.ready / raw_dir.name)
                _json_dump(ready_temp / "metadata.json", ready_metadata)
                # Windows does not support replacing directories via
                # ``os.replace``.  The temp directory is on the same volume,
                # so a same-volume rename is the durable commit point.
                ready_temp.rename(self.ready / raw_dir.name)
                repaired += 1
            finally:
                if ready_temp.exists():
                    shutil.rmtree(ready_temp, ignore_errors=True)
        return repaired

    def import_staged_post(
        self,
        staging_dir: Path,
        *,
        source_account: str,
        published_at: str = "",
        source_payload: dict[str, Any] | None = None,
    ) -> WorkItem | None:
        """Normalize one pyweixin detail directory, returning None on dedupe."""

        self.ensure_layout()
        content = read_content(staging_dir)
        media = media_files(staging_dir)
        media_hashes = [_sha256(path) for path in media]
        fingerprint = fingerprint_for(source_account, published_at, content, media_hashes)
        fallback_fingerprint = content_media_fingerprint(source_account, content, media_hashes)
        if fingerprint in self.known_fingerprints() or fallback_fingerprint in self.known_fingerprints():
            return None
        work_id = self._next_work_id(source_account, published_at)
        collected_at = utc_now()
        base_metadata: dict[str, Any] = {
            "work_id": work_id,
            "source_account": source_account,
            "published_at": published_at,
            "text": content,
            "source_id_or_fingerprint": fingerprint,
            "content_media_fingerprint": fallback_fingerprint,
            "media_sha256": media_hashes,
            "collected_at": collected_at,
            "status": "RAW",
            "source_raw_folder": str(staging_dir),
            "source_payload": source_payload or {},
        }
        raw_temp = self.raw / f".{work_id}.{uuid4().hex}.tmp"
        raw_final = self.raw / work_id
        ready_temp = self.ready / f".{work_id}.{uuid4().hex}.tmp"
        ready_final = self.ready / work_id
        try:
            self._write_work_files(raw_temp, content, media, base_metadata)
            raw_temp.rename(raw_final)
            # Preserve the normalized media manifest generated by
            # ``_write_work_files``.  Rebuilding this from ``base_metadata``
            # would silently drop ``media_files`` and ``media_count`` from
            # the ready copy even though raw/ remains correct.
            ready_metadata = _read_json(raw_final / "metadata.json", dict(base_metadata))
            ready_metadata["status"] = "QUEUED"
            ready_metadata["directory"] = str(ready_final)
            shutil.copytree(raw_final, ready_temp)
            _json_dump(ready_temp / "metadata.json", ready_metadata)
            ready_temp.rename(ready_final)
            self.rebuild_index()
            return self.load_work(ready_final)
        finally:
            if raw_temp.exists():
                shutil.rmtree(raw_temp, ignore_errors=True)
            if ready_temp.exists():
                shutil.rmtree(ready_temp, ignore_errors=True)

    def import_staged_tree(
        self,
        staging_root: Path,
        *,
        source_account: str,
        payloads: list[dict[str, Any]] | None = None,
    ) -> list[WorkItem]:
        self._repair_ready_from_raw()
        imported: list[WorkItem] = []
        detail_dirs = [path for path in staging_root.rglob("*") if path.is_dir() and (path / "metadata.json").exists() is False]
        # pyweixin creates numbered directories containing 内容.txt and media;
        # only directories with either text or media are eligible details.
        detail_dirs = [path for path in detail_dirs if read_content(path) or media_files(path)]
        detail_dirs.sort(key=lambda path: tuple(path.parts))
        for index, detail_dir in enumerate(detail_dirs):
            payload = payloads[index] if payloads and index < len(payloads) else {}
            published_at = str(
                payload.get("发布时间")
                or payload.get("published_at")
                or payload.get("publish_time")
                or ""
            )
            item = self.import_staged_post(
                detail_dir,
                source_account=source_account,
                published_at=published_at,
                source_payload=payload,
            )
            if item:
                imported.append(item)
        self.rebuild_index()
        return imported

    def list_ready(self, *, repair: bool = True) -> list[WorkItem]:
        if repair:
            self._repair_ready_from_raw()
        items: list[WorkItem] = []
        for directory in sorted(self.ready.iterdir(), key=_natural_key) if self.ready.is_dir() else []:
            if not directory.is_dir() or directory.name.startswith("."):
                continue
            metadata = _read_json(directory / "metadata.json", {})
            if metadata.get("status") not in {"QUEUED", "RAW"}:
                continue
            try:
                item = self.load_work(directory)
            except ValueError:
                continue
            if item.text.strip() and item.media_files:
                items.append(item)
        return items

    def annotate_asset_metadata(self, *, include_raw: bool = True, include_used: bool = True) -> dict[str, int]:
        """Ensure every normalized work has an editable ``asset.json`` sidecar."""

        self.ensure_layout()
        bases = [self.ready]
        if include_raw:
            bases.append(self.raw)
        if include_used:
            bases.append(self.used)
        scanned = created_or_updated = skipped = 0
        for base in bases:
            if not base.is_dir():
                continue
            for directory in sorted(base.iterdir(), key=_natural_key):
                if not directory.is_dir() or directory.name.startswith("."):
                    continue
                if not (directory / "metadata.json").is_file():
                    skipped += 1
                    continue
                scanned += 1
                try:
                    _, changed = ensure_asset_metadata(directory)
                except (OSError, ValueError, TypeError):
                    skipped += 1
                    continue
                created_or_updated += int(changed)
        return {"scanned": scanned, "asset_json_created_or_updated": created_or_updated, "skipped": skipped}

    def load_work(self, directory: Path) -> WorkItem:
        metadata = _read_json(directory / "metadata.json", {})
        if not metadata or not metadata.get("work_id"):
            raise ValueError(f"作品缺少 metadata.json: {directory}")
        content = read_content(directory)
        files = tuple(str(name) for name in metadata.get("media_files", []) if (directory / str(name)).is_file())
        if not files:
            files = tuple(path.name for path in media_files(directory))
        return WorkItem(
            work_id=str(metadata["work_id"]),
            fingerprint=str(metadata.get("source_id_or_fingerprint", "")),
            source_account=str(metadata.get("source_account", "")),
            published_at=str(metadata.get("published_at", "")),
            text=content,
            media_files=files,
            directory=directory,
            status=str(metadata.get("status", "")),
            metadata=metadata,
        )

    def mark_confirmed_published(self, work_id: str, confirmed_at: str | None = None) -> WorkItem:
        self.ensure_layout()
        source = self.ready / work_id
        destination = self.used / work_id
        if not source.exists() and destination.exists():
            metadata = _read_json(destination / "metadata.json", {})
            if metadata.get("status") != "CONFIRMED_PUBLISHED":
                confirmed_at_value = confirmed_at or utc_now()
                metadata["status"] = "CONFIRMED_PUBLISHED"
                metadata["confirmed_published_at"] = confirmed_at_value
                metadata["directory"] = str(destination)
                _json_dump(destination / "metadata.json", metadata)
                asset = self._increment_usage(destination, confirmed_at_value)
                metadata["usage_count"] = asset["usage_count"]
                _json_dump(destination / "metadata.json", metadata)
                self.rebuild_index()
            else:
                # A repeated confirmation is intentionally idempotent.  It
                # may still repair a missing sidecar, but must not count the
                # same publication twice.
                asset, changed = ensure_asset_metadata(destination)
                if asset.get("usage_count", 0) < 1:
                    asset["usage_count"] = 1
                    asset["last_used_at"] = str(metadata.get("confirmed_published_at", "") or utc_now())
                    asset["updated_at"] = asset["last_used_at"]
                    _json_dump(destination / ASSET_METADATA_FILENAME, asset)
                    changed = True
                if changed:
                    self.rebuild_index()
            return self.load_work(destination)
        if not source.is_dir():
            raise FileNotFoundError(f"ready 中找不到作品: {work_id}")
        if destination.exists():
            raise FileExistsError(f"used 中已存在同名作品，拒绝覆盖: {destination}")
        shutil.move(str(source), str(destination))
        metadata = _read_json(destination / "metadata.json", {})
        confirmed_at_value = confirmed_at or utc_now()
        metadata["status"] = "CONFIRMED_PUBLISHED"
        metadata["confirmed_published_at"] = confirmed_at_value
        metadata["directory"] = str(destination)
        _json_dump(destination / "metadata.json", metadata)
        asset = self._increment_usage(destination, confirmed_at_value)
        metadata["usage_count"] = asset["usage_count"]
        _json_dump(destination / "metadata.json", metadata)
        self.rebuild_index()
        return self.load_work(destination)

    def _increment_usage(self, directory: Path, used_at: str) -> dict[str, Any]:
        """Record one confirmed publication without touching source media."""

        asset, _ = ensure_asset_metadata(directory, now=used_at)
        try:
            usage_count = max(0, int(asset.get("usage_count", 0) or 0))
        except (TypeError, ValueError):
            usage_count = 0
        asset["usage_count"] = usage_count + 1
        asset["last_used_at"] = used_at
        asset["updated_at"] = used_at
        _json_dump(directory / ASSET_METADATA_FILENAME, asset)
        return asset

    def update_status(self, work_id: str, status: str, **fields: Any) -> WorkItem:
        if status not in WORK_STATUSES and status not in {"RAW"}:
            raise ValueError(f"未知作品状态: {status}")
        for base in (self.ready, self.used, self.raw):
            directory = base / work_id
            if directory.is_dir():
                metadata = _read_json(directory / "metadata.json", {})
                metadata["status"] = status
                metadata.update(fields)
                _json_dump(directory / "metadata.json", metadata)
                self.rebuild_index()
                return self.load_work(directory)
        raise FileNotFoundError(f"找不到作品: {work_id}")

    def write_log(self, filename: str, text: str) -> Path:
        self.logs.mkdir(parents=True, exist_ok=True)
        path = self.logs / _safe_name(filename, "moments.log")
        path.write_text(text, encoding="utf-8", newline="\n")
        return path
