"""WeFlow-backed Moments collection.

The WeFlow SNS proxy is useful when it works, but a live installation can
return 502 for every SNS media proxy request even when the original WeChat
media URL is directly readable. This adapter deliberately uses the raw media
URL returned by the local API and keeps the proxy failure out of the
collection critical path.

Secrets are runtime-only: an API token may come from an explicit argument,
``WEFLOW_API_TOKEN``, or the local WeFlow config. It is never written to the
library or diagnostic logs.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .store import MomentsLibrary, _safe_name, is_viewable_media


SHANGHAI_TZ = timezone(timedelta(hours=8))


class WeFlowError(RuntimeError):
    """A bounded, actionable WeFlow collection error."""


def _config_path() -> Path:
    app_data = Path(os.environ.get("APPDATA", Path.home() / "AppData/Roaming"))
    return app_data / "WeFlow" / "WeFlow-config.json"


def _read_runtime_token(explicit: str | None) -> str:
    if explicit and explicit.strip():
        return explicit.strip()
    env_token = os.environ.get("WEFLOW_API_TOKEN", "").strip()
    if env_token:
        return env_token
    path = _config_path()
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise WeFlowError(f"找不到 WeFlow API token 配置：{path}") from exc
    # The current local config may contain an unrelated malformed automation
    # task name, so use a narrow key lookup instead of requiring valid JSON.
    match = re.search(r'"httpApiToken"\s*:\s*"([^"]*)"', raw)
    if not match or not match.group(1).strip():
        raise WeFlowError(f"WeFlow 配置中没有可用 httpApiToken：{path}")
    return match.group(1).strip()


def _api_get(base: str, token: str, path: str, params: dict[str, Any]) -> Any:
    query = urlencode({key: str(value) for key, value in params.items() if value is not None})
    url = f"{base.rstrip('/')}/{path.lstrip('/')}"
    if query:
        url += "?" + query
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "teambuilding-moments-library/1.0",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=30) as response:
            body = response.read()
    except HTTPError as exc:
        detail = exc.read(512).decode("utf-8", errors="replace")
        raise WeFlowError(f"WeFlow API HTTP {exc.code}：{detail[:240]}") from exc
    except (OSError, URLError) as exc:
        raise WeFlowError(f"WeFlow API 请求失败：{exc}") from exc
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise WeFlowError("WeFlow API 返回了无法解析的 JSON") from exc


def _timestamp(value: Any) -> str:
    if value in (None, "", 0):
        return ""
    try:
        number = float(value)
        if number > 10_000_000_000:
            number /= 1000
        return datetime.fromtimestamp(number, tz=timezone.utc).isoformat(timespec="seconds")
    except (TypeError, ValueError, OverflowError, OSError):
        return str(value)


def _parse_datetime(value: Any) -> datetime | None:
    """Parse a source timestamp into a timezone-aware Shanghai datetime."""

    if value in (None, "", 0):
        return None
    try:
        number = float(value)
        if number > 10_000_000_000:
            number /= 1000
        return datetime.fromtimestamp(number, tz=timezone.utc).astimezone(SHANGHAI_TZ)
    except (TypeError, ValueError, OverflowError, OSError):
        pass
    text = str(value).strip().replace("Z", "+00:00")
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed.replace(tzinfo=SHANGHAI_TZ) if parsed.tzinfo is None else parsed.astimezone(SHANGHAI_TZ)


def _post_datetime(post: dict[str, Any]) -> datetime | None:
    return _parse_datetime(post.get("createTime") or post.get("published_at") or post.get("publish_time"))


def _post_source_id(post: dict[str, Any]) -> str:
    return str(post.get("id") or post.get("tid") or "").strip()


def _month_window(target_month: str) -> tuple[datetime, datetime]:
    match = re.fullmatch(r"(\d{4})-(\d{2})", str(target_month or "").strip())
    if not match:
        raise WeFlowError(f"目标月份格式错误，应为 YYYY-MM：{target_month}")
    year, month = int(match.group(1)), int(match.group(2))
    if month < 1 or month > 12:
        raise WeFlowError(f"目标月份无效：{target_month}")
    start = datetime(year, month, 1, tzinfo=SHANGHAI_TZ)
    end = datetime(year + (month == 12), 1 if month == 12 else month + 1, 1, tzinfo=SHANGHAI_TZ)
    return start, end


def _collection_progress_path(output: str | Path) -> Path:
    return Path(output) / "state" / "collection-progress.json"


def _load_collection_progress(output: str | Path) -> dict[str, Any]:
    path = _collection_progress_path(output)
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        value = {}
    if not isinstance(value, dict):
        value = {}
    accounts = value.get("accounts")
    return {"version": 1, "accounts": accounts if isinstance(accounts, dict) else {}}


def _save_collection_progress(output: str | Path, state: dict[str, Any]) -> None:
    path = _collection_progress_path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def _select_posts_for_month(
    posts: list[dict[str, Any]],
    *,
    target_month: str | None,
    progress: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Select the next uncollected time range for one account.

    WeFlow exposes one timeline endpoint rather than a dependable date-range
    query. We therefore page the source metadata, filter locally, and only
    download media for the selected range. The first run falls back to the
    previous complete month. Later runs start at the account's persisted
    ``collection_cursor_at`` and end at the current target-month boundary.
    The source is sorted newest-first before downloading so an interrupted run
    can continue toward older posts.
    """

    if not target_month:
        return posts, {
            "target_month": "",
            "selected": len(posts),
            "excluded_outside_window": 0,
            "undated_excluded": 0,
            "resumed": False,
            "resume_from": "",
        }
    target_start, end = _month_window(target_month)
    previous = progress if progress.get("target_month") == target_month else {}
    stored_cursor = _parse_datetime(progress.get("collection_cursor_at") or progress.get("last_collected_until"))
    if stored_cursor is None and progress.get("status") == "COMPLETED" and progress.get("target_month"):
        # Migrate the 0.19.198 record shape without treating the wall-clock
        # completion timestamp as a publication boundary.
        try:
            _legacy_start, stored_cursor = _month_window(str(progress["target_month"]))
        except WeFlowError:
            stored_cursor = None
    # A completed prior month gives us a durable data-time boundary. Do not
    # use last_collection_at here: it is the wall-clock completion time and
    # could skip posts when a catch-up run happens after the month boundary.
    start = target_start if stored_cursor is None else min(stored_cursor, end)
    resume_from = _parse_datetime(previous.get("oldest_published_at"))
    selected: list[tuple[datetime, dict[str, Any]]] = []
    excluded = 0
    undated = 0
    for post in posts:
        created = _post_datetime(post)
        if created is None:
            undated += 1
            continue
        if not (start <= created < end):
            excluded += 1
            continue
        # The checkpoint is inclusive.  Re-reading the checkpointed post is
        # intentional: the library dedupe makes this safe and avoids missing
        # two posts that share the same second.
        if resume_from is not None and created > resume_from:
            excluded += 1
            continue
        selected.append((created, post))
    selected.sort(key=lambda pair: (pair[0], _post_source_id(pair[1])), reverse=True)
    return [post for _created, post in selected], {
        "target_month": target_month,
        "selected": len(selected),
        "excluded_outside_window": excluded,
        "undated_excluded": undated,
        "resumed": stored_cursor is not None or resume_from is not None,
        "resume_from": (stored_cursor or resume_from).isoformat(timespec="seconds") if (stored_cursor or resume_from) else "",
        "window_start": start.isoformat(timespec="seconds"),
        "window_end": end.isoformat(timespec="seconds"),
    }


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _extension(content_type: str, url: str) -> str:
    mapping = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "video/mp4": ".mp4",
        "video/quicktime": ".mov",
    }
    if content_type.lower() in mapping:
        return mapping[content_type.lower()]
    suffix = Path(url.split("?", 1)[0]).suffix.lower()
    return suffix if suffix in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov"} else ".bin"


def _weflow_wasm_dir() -> Path:
    configured = os.environ.get("WEFLOW_WASM_DIR", "").strip()
    candidates = [Path(configured)] if configured else []
    program_files = os.environ.get("ProgramFiles", "C:/Program Files")
    candidates.extend(
        [
            Path(program_files) / "WeFlow" / "resources" / "assets" / "wasm",
            Path("D:/Program Files/WeFlow/resources/assets/wasm"),
        ]
    )
    for candidate in candidates:
        if (candidate / "wasm_video_decode.js").is_file() and (candidate / "wasm_video_decode.wasm").is_file():
            return candidate
    raise WeFlowError("找不到 WeFlow 随附的 WASM 解密模块；可用 WEFLOW_WASM_DIR 指定目录")


def _decrypt_many_with_weflow_wasm(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not items:
        return []
    node = shutil.which("node")
    if not node:
        raise WeFlowError("找不到 node，无法调用 WeFlow WASM 解密模块")
    helper = Path(__file__).with_name("weflow_wasm_decrypt.js")
    if not helper.is_file():
        raise WeFlowError(f"缺少 WeFlow WASM 解密 helper：{helper}")
    normalized_items = []
    for item in items:
        key_text = str(item.get("key") or "").strip()
        if not key_text or not re.fullmatch(r"\d+", key_text):
            raise WeFlowError("朋友圈媒体缺少可用的精确数字解密 key")
        normalized_items.append(
            {
                "input": str(item["input"]),
                "output": str(item["output"]),
                "key": key_text,
            }
        )
    payload = json.dumps({"items": normalized_items}, ensure_ascii=False)
    try:
        completed = subprocess.run(
            [node, str(helper), str(_weflow_wasm_dir())],
            input=payload,
            encoding="utf-8",
            text=True,
            capture_output=True,
            timeout=90,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise WeFlowError(f"调用 WeFlow WASM 解密失败：{exc}") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or "").strip().splitlines()[-1:] or ["未知错误"]
        raise WeFlowError(f"WeFlow WASM 解密进程失败：{detail[0][:240]}")
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise WeFlowError("WeFlow WASM 解密 helper 返回了无法解析的结果") from exc
    results = result.get("results")
    if not isinstance(results, list) or len(results) != len(normalized_items):
        raise WeFlowError("WeFlow WASM 解密 helper 返回数量异常")
    return results


def _decrypt_with_weflow_wasm(encrypted: Path, output: Path, key: Any) -> dict[str, Any]:
    item = _decrypt_many_with_weflow_wasm(
        [{"input": str(encrypted), "output": str(output), "key": key}]
    )[0]
    if not item.get("ok"):
        raise WeFlowError(str(item.get("error") or "WeFlow WASM 未产生可识别图片"))
    return {"bytes": item.get("bytes", 0), "sha256": item.get("sha256", "")}


def _download_raw_media_payload(url: str, destination: Path, *, key: Any) -> dict[str, Any]:
    request = Request(
        url,
        headers={"Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", "User-Agent": "Mozilla/5.0"},
        method="GET",
    )
    try:
        with urlopen(request, timeout=30) as response:
            data = response.read()
            content_type = response.headers.get_content_type() or "application/octet-stream"
    except HTTPError as exc:
        raise WeFlowError(f"原始朋友圈媒体 HTTP {exc.code}") from exc
    except (OSError, URLError) as exc:
        raise WeFlowError(f"原始朋友圈媒体下载失败：{exc}") from exc
    if not data:
        raise WeFlowError("原始朋友圈媒体返回空文件")
    if not (content_type.startswith("image/") or content_type.startswith("video/")):
        raise WeFlowError(f"原始朋友圈媒体类型异常：{content_type}")
    encrypted_path = destination.with_suffix(".enc")
    encrypted_path.write_bytes(data)
    final_path = destination.with_suffix(_extension(content_type, url))
    return {
        "input": str(encrypted_path),
        "output": str(final_path),
        "key": key,
        "file": final_path.name,
        "content_type": content_type,
        "encrypted_file": encrypted_path.name,
        "encrypted_bytes": len(data),
        "encrypted_sha256": _sha256_bytes(data),
    }


def _download_raw_media(url: str, destination: Path, *, key: Any) -> dict[str, Any]:
    pending = _download_raw_media_payload(url, destination, key=key)
    decrypted = _decrypt_with_weflow_wasm(Path(pending["input"]), Path(pending["output"]), key)
    return {
        "file": pending["file"],
        "bytes": decrypted["bytes"],
        "sha256": decrypted["sha256"],
        "content_type": pending["content_type"],
        "encrypted_file": pending["encrypted_file"],
        "encrypted_bytes": pending["encrypted_bytes"],
        "encrypted_sha256": pending["encrypted_sha256"],
        "decryption": "weflow_wasm_wxisaac64",
    }


def _post_text(post: dict[str, Any]) -> str:
    value = post.get("contentDesc")
    if value in (None, ""):
        value = post.get("content", "")
    return str(value or "")


def _write_manifest(path: Path, entries: list[dict[str, Any]]) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def _safe_source_payload(post: dict[str, Any], media: list[dict[str, Any]], *, wxid: str, friend: str) -> dict[str, Any]:
    """Keep useful provenance without persisting expiring URL/key/token values."""
    safe_media = []
    for index, item in enumerate(media, start=1):
        safe_media.append(
            {
                "index": index,
                "md5": item.get("md5", ""),
                "key_length": len(str(item.get("key", ""))),
                "token_length": len(str(item.get("token", ""))),
                "encIdx": item.get("encIdx"),
            }
        )
    return {
        "source": "weflow",
        "wxid": wxid,
        "friend_display_name": friend,
        "source_id": str(post.get("id") or post.get("tid") or ""),
        "tid": str(post.get("tid") or ""),
        "id": str(post.get("id") or ""),
        "username": str(post.get("username") or ""),
        "nickname": str(post.get("nickname") or ""),
        "createTime": post.get("createTime"),
        "published_at": _timestamp(post.get("createTime")),
        "type": post.get("type"),
        "location": post.get("location"),
        "likes": post.get("likes") if isinstance(post.get("likes"), list) else [],
        "comments": post.get("comments") if isinstance(post.get("comments"), list) else [],
        "media": safe_media,
    }


def _complete_dirs(staging_root: Path) -> list[Path]:
    if not staging_root.is_dir():
        return []
    return sorted(
        [
            path
            for path in staging_root.iterdir()
            if path.is_dir() and not path.name.startswith(".") and not path.name.endswith(".partial")
            and (path / ".complete").is_file()
        ],
        key=lambda path: path.name,
    )


def _partial_source_id(path: Path) -> str:
    name = path.name.removesuffix(".partial")
    _index, separator, source_id = name.partition("_")
    return source_id if separator else ""


def _partial_position(path: Path) -> int:
    prefix, _separator, _source_id = path.name.removesuffix(".partial").partition("_")
    try:
        return int(prefix)
    except ValueError:
        return 0


def _resume_weflow_partial(
    detail: Path,
    *,
    post: dict[str, Any],
    wxid: str,
    friend: str,
) -> tuple[Path, dict[str, Any]]:
    """Finish one WeFlow partial directory without discarding existing bytes."""

    media = post.get("media") if isinstance(post.get("media"), list) else []
    if not media:
        raise WeFlowError(f"中断条目没有媒体记录，无法恢复：{detail.name}")
    content = _post_text(post)
    (detail / "content.txt").write_text(content, encoding="utf-8")
    pending_media: list[dict[str, Any]] = []
    for media_index, media_value in enumerate(media, start=1):
        if not isinstance(media_value, dict):
            raise WeFlowError(f"中断条目第 {media_index} 个媒体记录异常：{detail.name}")
        raw_url = str(media_value.get("url") or "").strip()
        if not raw_url:
            raise WeFlowError(f"中断条目第 {media_index} 个媒体缺少原始 URL：{detail.name}")
        encrypted = detail / f"{media_index:02d}.enc"
        output = detail / f"{media_index:02d}{_extension('image/jpeg', raw_url)}"
        if not encrypted.is_file():
            pending_media.append(
                _download_raw_media_payload(raw_url, detail / f"{media_index:02d}", key=media_value.get("key"))
            )
        else:
            pending_media.append(
                {
                    "input": str(encrypted),
                    "output": str(output),
                    "key": media_value.get("key"),
                    "file": output.name,
                    "content_type": "image/jpeg",
                    "encrypted_file": encrypted.name,
                    "encrypted_bytes": encrypted.stat().st_size,
                    "encrypted_sha256": _sha256_bytes(encrypted.read_bytes()),
                }
            )
    decrypt_results = _decrypt_many_with_weflow_wasm(
        [
            {"input": item["input"], "output": item["output"], "key": item["key"]}
            for item in pending_media
        ]
    )
    if len(decrypt_results) != len(pending_media):
        raise WeFlowError(f"中断条目解密结果数量异常：{detail.name}")
    source_payload = _safe_source_payload(post, media, wxid=wxid, friend=friend)
    source_payload["post_text"] = content
    for media_index, (pending, decrypted) in enumerate(zip(pending_media, decrypt_results), start=1):
        if not decrypted.get("ok"):
            raise WeFlowError(
                f"中断条目第 {media_index} 个媒体解密失败："
                f"{decrypted.get('error') or '未知错误'}"
            )
        output_path = Path(str(pending["output"]))
        if not output_path.is_file() or not is_viewable_media(output_path):
            raise WeFlowError(f"中断条目第 {media_index} 个媒体未通过可见性校验：{output_path.name}")
        source_payload["media"][media_index - 1].update(
            {
                "file": pending["file"],
                "bytes": decrypted.get("bytes", 0),
                "sha256": decrypted.get("sha256", ""),
                "content_type": pending["content_type"],
                "encrypted_file": pending["encrypted_file"],
                "encrypted_bytes": pending["encrypted_bytes"],
                "encrypted_sha256": pending["encrypted_sha256"],
                "decryption": "weflow_wasm_wxisaac64",
            }
        )
    (detail / "source.json").write_text(
        json.dumps(source_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (detail / ".complete").write_text("ok\n", encoding="utf-8")
    final = detail.with_suffix("")
    if final.exists():
        raise WeFlowError(f"中断条目的目标目录已存在，拒绝覆盖：{final}")
    detail.rename(final)
    return final, source_payload


def resume_weflow_staging(
    *,
    friend: str,
    output: str | Path,
    api_base: str = "http://127.0.0.1:5031/api/v1",
    wxid: str | None = None,
    api_token: str | None = None,
    limit: int = 10,
    full_history: bool = False,
    page_size: int = 500,
) -> dict[str, Any]:
    library = MomentsLibrary(output)
    library.ensure_layout()
    root = library.raw / ".weflow"
    candidates = sorted(
        [path / _safe_name(friend, "friend") for path in root.glob("*") if path.is_dir()],
        key=lambda path: str(path),
    )
    imported = []
    partials = []
    for candidate in candidates:
        for detail in _complete_dirs(candidate):
            source_payload = json.loads((detail / "source.json").read_text(encoding="utf-8"))
            item = library.import_staged_post(
                detail,
                source_account=friend,
                published_at=str(source_payload.get("published_at", "")),
                source_payload=source_payload,
            )
            if item:
                imported.append(item)
        partials.extend(path for path in candidate.glob("*.partial") if path.is_dir())

    resumed_partials = 0
    if partials:
        if not wxid or not wxid.strip():
            raise WeFlowError("发现 WeFlow 中断条目；恢复它需要 --wxid 以重新读取当前媒体 URL/key")
        token = _read_runtime_token(api_token)
        fetch_limit = max(limit, max((_partial_position(path) for path in partials), default=limit))
        posts = _fetch_timeline(
            api_base=api_base,
            token=token,
            wxid=wxid,
            limit=fetch_limit,
            full_history=full_history,
            page_size=page_size,
        )
        by_source_id = {
            str(post.get("id") or post.get("tid") or "").strip(): post
            for post in posts
            if isinstance(post, dict) and str(post.get("id") or post.get("tid") or "").strip()
        }
        for partial in sorted(partials, key=lambda path: str(path)):
            source_id = _partial_source_id(partial)
            post = by_source_id.get(source_id)
            if not post:
                raise WeFlowError(
                    f"找不到中断条目对应的当前朋友圈：{partial.name}；已停止，不会跳过或换下一条"
                )
            detail, source_payload = _resume_weflow_partial(
                partial,
                post=post,
                wxid=wxid,
                friend=friend,
            )
            item = library.import_staged_post(
                detail,
                source_account=friend,
                published_at=str(source_payload.get("published_at", "")),
                source_payload=source_payload,
            )
            if item:
                imported.append(item)
            resumed_partials += 1
    library.rebuild_index()
    return {
        "source": "weflow",
        "friend": friend,
        "resume_only": True,
        "staging_roots": [str(path) for path in candidates if path.is_dir()],
        "imported": len(imported),
        "work_ids": [item.work_id for item in imported],
        "resumed_partials": resumed_partials,
        "partial_pending": len(partials) - resumed_partials,
    }


def _fetch_timeline(
    *,
    api_base: str,
    token: str,
    wxid: str,
    limit: int,
    full_history: bool,
    page_size: int,
) -> list[dict[str, Any]]:
    """Fetch one bounded sample or every page exposed by the WeFlow proxy."""
    if not full_history:
        response = _api_get(
            api_base,
            token,
            "/sns/timeline",
            {"limit": limit, "offset": 0, "media": 1, "replace": 0, "inline": 0, "usernames": wxid},
        )
        posts = response.get("timeline") if isinstance(response, dict) else None
        if not isinstance(posts, list):
            raise WeFlowError("WeFlow 时间线返回中没有 timeline 数组")
        return [post for post in posts[:limit] if isinstance(post, dict)]

    posts: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    offset = 0
    while True:
        response = _api_get(
            api_base,
            token,
            "/sns/timeline",
            {
                "limit": page_size,
                "offset": offset,
                "media": 1,
                "replace": 0,
                "inline": 0,
                "usernames": wxid,
            },
        )
        page = response.get("timeline") if isinstance(response, dict) else None
        if not isinstance(page, list):
            raise WeFlowError("WeFlow 时间线分页返回中没有 timeline 数组")
        if not page:
            break

        new_page: list[dict[str, Any]] = []
        for page_index, post in enumerate(page):
            if not isinstance(post, dict):
                raise WeFlowError(f"全量分页第 {offset + page_index + 1} 条朋友圈不是对象")
            source_id = str(post.get("id") or post.get("tid") or "").strip()
            if source_id and source_id in seen_ids:
                continue
            if source_id:
                seen_ids.add(source_id)
            new_page.append(post)
        if not new_page:
            raise WeFlowError(
                f"WeFlow 分页没有前进：offset={offset}、page_size={page_size}；已停止以避免重复采集"
            )
        posts.extend(new_page)
        if len(page) < page_size:
            break
        offset += len(page)
    return posts


def collect_weflow_friend_posts(
    *,
    friend: str,
    wxid: str,
    output: str | Path,
    limit: int = 10,
    api_base: str = "http://127.0.0.1:5031/api/v1",
    api_token: str | None = None,
    resume_only: bool = False,
    full_history: bool = False,
    page_size: int = 500,
    target_month: str | None = None,
) -> dict[str, Any]:
    if not wxid.strip():
        raise ValueError("WeFlow 采集必须提供 --wxid")
    if limit <= 0:
        raise ValueError("--limit 必须大于 0")
    if page_size <= 0:
        raise ValueError("--page-size 必须大于 0")
    library = MomentsLibrary(output)
    library.ensure_layout()
    if resume_only:
        resume_run_id = datetime.now().strftime("%Y%m%d-%H%M%S-%f") + "-resume-" + _safe_name(friend, "friend")
        try:
            return resume_weflow_staging(
                friend=friend,
                output=output,
                api_base=api_base,
                wxid=wxid,
                api_token=api_token,
                limit=limit,
                full_history=full_history,
                page_size=page_size,
            )
        except BaseException as exc:
            log_name = f"resume-weflow-{resume_run_id}.log"
            library.write_log(
                log_name,
                "stage=weflow-resume\n"
                f"friend={friend}\nwxid_present={bool(wxid and wxid.strip())}\n"
                f"limit={limit}\nfull_history={full_history}\npage_size={page_size}\n"
                f"error={exc!r}\n\n{traceback.format_exc()}",
            )
            if isinstance(exc, WeFlowError):
                raise WeFlowError(f"WeFlow 断点恢复停止；日志：{library.logs / log_name}") from exc
            raise WeFlowError(f"WeFlow 断点恢复异常；日志：{library.logs / log_name}") from exc
    token = _read_runtime_token(api_token)
    posts = _fetch_timeline(
        api_base=api_base,
        token=token,
        wxid=wxid,
        limit=limit,
        full_history=full_history,
        page_size=page_size,
    )
    source_posts_count = len(posts)
    progress_state = _load_collection_progress(output)
    progress_key = wxid.strip()
    previous_progress = progress_state["accounts"].get(progress_key, {})
    posts, selection = _select_posts_for_month(
        posts,
        target_month=target_month,
        progress=previous_progress if isinstance(previous_progress, dict) else {},
    )
    progress_record: dict[str, Any] | None = None
    if target_month:
        previous_record = previous_progress if isinstance(previous_progress, dict) else {}
        same_window = previous_record.get("target_month") == target_month
        progress_record = {
            **previous_record,
            "friend": friend,
            "wxid": wxid,
            "target_month": target_month,
            "status": "RUNNING",
            "run_started_at": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
            "received_source_posts": source_posts_count,
            "selected_posts": selection["selected"],
            "excluded_outside_window": selection["excluded_outside_window"],
            "undated_excluded": selection["undated_excluded"],
            "resumed": selection["resumed"],
            "resume_from": selection["resume_from"],
            "collection_window_start": selection["window_start"],
            "collection_window_end": selection["window_end"],
        }
        if not same_window:
            progress_record["processed_count"] = 0
            progress_record["last_processed_source_id"] = ""
            progress_record["oldest_published_at"] = ""
            progress_record["oldest_source_id"] = ""
        progress_record.setdefault("collection_cursor_at", "")
        progress_state["accounts"][progress_key] = progress_record
        _save_collection_progress(output, progress_state)
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S-%f") + "-" + _safe_name(friend, "friend")
    staging_root = library.raw / ".weflow" / run_id / _safe_name(friend, "friend")
    staging_root.mkdir(parents=True, exist_ok=True)
    manifest_path = staging_root.parent / "source-posts.json"
    manifest: list[dict[str, Any]] = []
    imported = []
    try:
        for index, post_value in enumerate(posts, start=1):
            if not isinstance(post_value, dict):
                raise WeFlowError(f"第 {index} 条朋友圈不是对象")
            media = post_value.get("media") if isinstance(post_value.get("media"), list) else []
            source_payload = _safe_source_payload(post_value, media, wxid=wxid, friend=friend)
            source_payload["post_text"] = _post_text(post_value)
            partial = staging_root / f"{index:03d}_{_safe_name(source_payload['source_id'], 'post')}.partial"
            detail = staging_root / f"{index:03d}_{_safe_name(source_payload['source_id'], 'post')}"
            if partial.exists():
                shutil.rmtree(partial)
            partial.mkdir(parents=True, exist_ok=True)
            (partial / "content.txt").write_text(_post_text(post_value), encoding="utf-8")
            pending_media: list[dict[str, Any]] = []
            for media_index, media_value in enumerate(media, start=1):
                if not isinstance(media_value, dict):
                    raise WeFlowError(f"第 {index} 条朋友圈第 {media_index} 个媒体记录异常")
                raw_url = str(media_value.get("url") or "").strip()
                if not raw_url:
                    raise WeFlowError(f"第 {index} 条朋友圈第 {media_index} 个媒体缺少原始 URL")
                pending_media.append(
                    _download_raw_media_payload(
                        raw_url,
                        partial / f"{media_index:02d}",
                        key=media_value.get("key"),
                    )
                )
            decrypt_results = _decrypt_many_with_weflow_wasm(
                [
                    {"input": item["input"], "output": item["output"], "key": item["key"]}
                    for item in pending_media
                ]
            )
            for media_index, (pending, decrypted) in enumerate(zip(pending_media, decrypt_results), start=1):
                if not decrypted.get("ok"):
                    raise WeFlowError(
                        f"第 {index} 条朋友圈第 {media_index} 个媒体解密失败："
                        f"{decrypted.get('error') or '未知错误'}"
                    )
                source_payload["media"][media_index - 1].update(
                    {
                        "file": pending["file"],
                        "bytes": decrypted.get("bytes", 0),
                        "sha256": decrypted.get("sha256", ""),
                        "content_type": pending["content_type"],
                        "encrypted_file": pending["encrypted_file"],
                        "encrypted_bytes": pending["encrypted_bytes"],
                        "encrypted_sha256": pending["encrypted_sha256"],
                        "decryption": "weflow_wasm_wxisaac64",
                    }
                )
            (partial / "source.json").write_text(
                json.dumps(source_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            (partial / ".complete").write_text("ok\n", encoding="utf-8")
            partial.rename(detail)
            item = library.import_staged_post(
                detail,
                source_account=friend,
                published_at=str(source_payload.get("published_at", "")),
                source_payload=source_payload,
            )
            entry = dict(source_payload)
            entry["status"] = "DEDUPLICATED" if item is None else "IMPORTED"
            entry["work_id"] = item.work_id if item else ""
            manifest.append(entry)
            _write_manifest(manifest_path, manifest)
            if item:
                imported.append(item)
            if progress_record is not None:
                created = _post_datetime(post_value)
                progress_record["processed_count"] = int(progress_record.get("processed_count", 0) or 0) + 1
                progress_record["last_processed_source_id"] = _post_source_id(post_value)
                if created:
                    created_text = created.isoformat(timespec="seconds")
                    current_oldest = _parse_datetime(progress_record.get("oldest_published_at"))
                    if current_oldest is None or created < current_oldest:
                        progress_record["oldest_published_at"] = created_text
                        progress_record["oldest_source_id"] = _post_source_id(post_value)
                progress_state["accounts"][progress_key] = progress_record
                _save_collection_progress(output, progress_state)
    except BaseException as exc:
        if progress_record is not None:
            progress_record["status"] = "FAILED"
            progress_record["failed_at"] = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")
            progress_record["error"] = str(exc)[:1600]
            progress_state["accounts"][progress_key] = progress_record
            _save_collection_progress(output, progress_state)
        failed_at = len(manifest) + 1
        log_name = f"collect-weflow-{run_id}.log"
        library.write_log(
            log_name,
                "stage=weflow-raw-collection\n"
                f"friend={friend}\nwxid_present={bool(wxid.strip())}\nlimit={limit}\nfull_history={full_history}\n"
                f"page_size={page_size}\n"
                f"target_month={target_month or ''}\n"
                f"selected={selection['selected']}\n"
                f"staging_root={staging_root}\nfailed_at={failed_at}\n"
            f"error={exc!r}\n\n{traceback.format_exc()}",
        )
        raise WeFlowError(
            f"WeFlow 采集在第 {failed_at} 条停止；已导入 {len(imported)} 条，"
            f"断点：{_collection_progress_path(output)}；日志：{library.logs / log_name}"
        ) from exc
    if progress_record is not None:
        progress_record["status"] = "COMPLETED"
        progress_record["completed_at"] = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")
        progress_record["last_collection_at"] = progress_record["completed_at"]
        # Advance only after the complete selected range is durable. This is
        # the account's next collection boundary; failed runs keep the old
        # cursor and can safely replay into the library's dedupe check.
        progress_record["collection_cursor_at"] = selection["window_end"]
        progress_record["last_collected_until"] = selection["window_end"]
        progress_record["error"] = ""
        progress_state["accounts"][progress_key] = progress_record
        _save_collection_progress(output, progress_state)
    return {
        "source": "weflow",
        "friend": friend,
        "wxid": wxid,
        "limit": limit,
        "full_history": full_history,
        "page_size": page_size,
        "received": source_posts_count,
        "selected": selection["selected"],
        "excluded_outside_window": selection["excluded_outside_window"],
        "undated_excluded": selection["undated_excluded"],
        "target_month": target_month or "",
        "resumed": selection["resumed"],
        "resume_from": selection["resume_from"],
        "imported": len(imported),
        "deduplicated_or_ignored": len(posts) - len(imported),
        "staging_root": str(staging_root),
        "manifest": str(manifest_path),
        "work_ids": [item.work_id for item in imported],
    }


__all__ = ["WeFlowError", "collect_weflow_friend_posts", "resume_weflow_staging"]
