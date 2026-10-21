"""Quota policy for the legacy CDP producer, shared with the workbench ledger.

The limits in this module are local safety lines, not claims about provider
quotas.  When the instance workbench is reachable, its per-account rolling
window is combined with legacy producer events that have not been mirrored to
that account ledger yet.  When it is unavailable, the producer falls back to
its own durable ledger.
"""

from __future__ import annotations

import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, Optional


UPLOAD_WINDOW_SECONDS = 3 * 60 * 60
DEFAULT_UPLOAD_LIMIT = 80
INSTANCE_API_PORTS = {"A": 4331, "B": 4332}


def _positive_int(value: Any, fallback: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return fallback
    return number if number > 0 else fallback


def _nonnegative_int(value: Any, fallback: int = 0) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return fallback
    return max(0, number)


def workbench_api_root(instance_id: str, environ: Optional[Dict[str, str]] = None) -> str:
    env = os.environ if environ is None else environ
    instance = str(instance_id or "").strip().upper()
    configured = str(env.get(f"CONTENT_PRODUCTION_API_ROOT_{instance}", "")).strip()
    if configured:
        return configured.rstrip("/")
    port = INSTANCE_API_PORTS.get(instance)
    return f"http://127.0.0.1:{port}" if port else ""


def _request_json(url: str, timeout: float, data: Optional[dict] = None) -> dict:
    body = None if data is None else json.dumps(data, ensure_ascii=False).encode("utf-8")
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=headers)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=timeout) as response:
        parsed = json.loads(response.read().decode("utf-8", "replace"))
    if not isinstance(parsed, dict):
        raise ValueError("workbench API returned a non-object response")
    return parsed


def read_workbench_quota(
    instance_id: str,
    *,
    api_root: Optional[str] = None,
    timeout: float = 1.0,
) -> Optional[dict]:
    """Read the account bound to this workbench instance and its quota snapshot."""
    root = (api_root or workbench_api_root(instance_id)).rstrip("/")
    if not root:
        return None
    try:
        runtime = _request_json(f"{root}/api/gpt-production/runtime-state", timeout)
        queue = (runtime.get("state") or {}).get("queue") or {}
        account_id = str(queue.get("activeAccountId") or "").strip()
        if not account_id:
            return None
        quota_url = f"{root}/api/gpt-production/quota?account={urllib.parse.quote(account_id)}"
        response = _request_json(quota_url, timeout)
        quota = response.get("quota")
        if not response.get("ok") or not isinstance(quota, dict):
            return None
        if str(quota.get("accountId") or "") != account_id:
            return None
        return {"accountId": account_id, **quota}
    except (OSError, ValueError, urllib.error.URLError, json.JSONDecodeError):
        return None


def record_workbench_quota_event(
    instance_id: str,
    request_id: str,
    kind: str,
    count: int,
    *,
    quota_snapshot: Optional[dict] = None,
    api_root: Optional[str] = None,
    timeout: float = 1.0,
) -> bool:
    """Mirror a confirmed upload/generation event; failure never blocks production."""
    amount = _nonnegative_int(count)
    if not amount or not str(request_id or "").strip() or kind not in ("uploaded", "generated"):
        return False
    snapshot = quota_snapshot or read_workbench_quota(instance_id, api_root=api_root, timeout=timeout)
    account_id = str((snapshot or {}).get("accountId") or "").strip()
    root = (api_root or workbench_api_root(instance_id)).rstrip("/")
    if not account_id or not root:
        return False
    try:
        result = _request_json(
            f"{root}/api/gpt-production/quota-event",
            timeout,
            {"accountId": account_id, "requestId": request_id, "kind": kind, "count": amount},
        )
        return bool(result.get("ok"))
    except (OSError, ValueError, urllib.error.URLError, json.JSONDecodeError):
        return False


def _epoch(record: dict) -> Optional[float]:
    try:
        value = float(record.get("epoch"))
    except (TypeError, ValueError, OverflowError):
        return None
    return value if math.isfinite(value) else None


def _timestamp_epoch(record: dict) -> Optional[float]:
    value = str(record.get("recordedAt") or "").strip()
    if not value:
        return None
    try:
        parsed = value.replace("Z", "+00:00")
        from datetime import datetime

        dt = datetime.fromisoformat(parsed)
        if dt.tzinfo is None:
            # API timestamps are UTC ISO strings. If an old local timestamp is
            # supplied without a zone, treat it as local time conservatively.
            return dt.timestamp()
        return dt.timestamp()
    except (TypeError, ValueError, OverflowError):
        return None


def return_task_to_shared_pool_for_quota(
    production: dict,
    instance_id: str,
    kind: str,
    recorded_at: str,
    *,
    requires_split: bool = False,
) -> dict:
    """Yield on quota without failing the source; permanently oversized batches await splitting."""
    target = production if isinstance(production, dict) else {}
    target["lifecycleState"] = "额度待拆分" if requires_split else "待生产"
    target.pop("lockedBy", None)
    target.pop("lockedAt", None)
    target.pop("cooldownUntil", None)
    target.pop("lastError", None)
    target["quotaYield"] = {
        "instanceId": str(instance_id or ""),
        "kind": str(kind or "local_upload_safety_limit"),
        "recordedAt": str(recorded_at or ""),
    }
    if requires_split:
        target["quotaYield"]["requiresSplit"] = True
    return target


def assess_upload_budget(
    local_records: Iterable[dict],
    instance_id: str,
    planned_uploads: int,
    *,
    now_epoch: Optional[float] = None,
    workbench_quota: Optional[dict] = None,
    default_limit: int = DEFAULT_UPLOAD_LIMIT,
    window_seconds: int = UPLOAD_WINDOW_SECONDS,
) -> dict:
    """Require the complete attachment batch to fit the account's 3h window."""
    now = time.time() if now_epoch is None else float(now_epoch)
    window = max(1, int(window_seconds))
    request_count = max(0, int(planned_uploads or 0))
    local = []
    for row in local_records or []:
        if str(row.get("instance_id") or "").strip().upper() != str(instance_id or "").strip().upper():
            continue
        epoch = _epoch(row)
        if epoch is None or epoch > now or now - epoch >= window:
            continue
        count = _nonnegative_int(row.get("uploaded_count"))
        if count:
            local.append({"epoch": epoch, "count": count, "requestId": str(row.get("request_id") or "")})

    api_snapshot = workbench_quota if isinstance(workbench_quota, dict) else None
    settings = (api_snapshot or {}).get("settings") or {}
    limit = min(DEFAULT_UPLOAD_LIMIT, _positive_int(settings.get("uploadLimit"), _positive_int(default_limit, DEFAULT_UPLOAD_LIMIT)))
    api_events = []
    api_uploaded_ids = set()
    if api_snapshot:
        for event in api_snapshot.get("events") or []:
            if event.get("kind") != "uploaded":
                continue
            epoch = _timestamp_epoch(event)
            if epoch is None or epoch > now or now - epoch >= window:
                continue
            count = _nonnegative_int(event.get("count"))
            if count:
                request_id = str(event.get("requestId") or "")
                if request_id:
                    api_uploaded_ids.add(request_id)
                api_events.append({"epoch": epoch, "count": count, "requestId": request_id})

    # The workbench ledger is authoritative for its account. Add only legacy
    # producer events not already mirrored by matching request ID.
    local_only = [row for row in local if not row["requestId"] or row["requestId"] not in api_uploaded_ids]
    all_events = api_events + local_only
    used = sum(event["count"] for event in all_events)
    remaining = max(0, limit - used)
    allowed = request_count <= remaining
    impossible_batch = request_count > limit
    needed_free = max(0, used + request_count - limit)
    freed = 0
    wait_until_epoch = 0.0
    if needed_free and not impossible_batch:
        for event in sorted(all_events, key=lambda item: item["epoch"]):
            freed += event["count"]
            if freed >= needed_free:
                wait_until_epoch = event["epoch"] + window
                break
    wait_seconds = max(1, math.ceil(wait_until_epoch - now)) if needed_free and wait_until_epoch else 0
    return {
        "allowed": allowed,
        "impossibleBatch": impossible_batch,
        "instanceId": str(instance_id or "").upper(),
        "plannedUploads": request_count,
        "usedUploads": used,
        "remainingUploads": remaining,
        "uploadLimit": limit,
        "windowSeconds": window,
        "waitSeconds": wait_seconds,
        "nextAvailableEpoch": wait_until_epoch or None,
        "ledgerSource": "workbench+legacy" if api_snapshot else "legacy",
    }


def assess_generation_budget(
    local_records: Iterable[dict],
    instance_id: str,
    planned_generations: int = 1,
    *,
    now_epoch: Optional[float] = None,
    workbench_quota: Optional[dict] = None,
    default_limit: int = 40,
    window_seconds: int = UPLOAD_WINDOW_SECONDS,
) -> dict:
    """Combine account-workbench and legacy per-instance generated-image events."""
    now = time.time() if now_epoch is None else float(now_epoch)
    window = max(1, int(window_seconds))
    request_count = max(0, int(planned_generations or 0))
    local = []
    for row in local_records or []:
        if str(row.get("instance_id") or "").strip().upper() != str(instance_id or "").strip().upper():
            continue
        epoch = _epoch(row)
        if epoch is None or epoch > now or now - epoch >= window:
            continue
        count = _nonnegative_int(row.get("generated_count"))
        if count:
            local.append({"epoch": epoch, "count": count, "requestId": str(row.get("request_id") or "")})

    api_snapshot = workbench_quota if isinstance(workbench_quota, dict) else None
    settings = (api_snapshot or {}).get("settings") or {}
    limit = min(40, _positive_int(settings.get("generationLimit"), _positive_int(default_limit, 40)))
    api_events = []
    api_generated_ids = set()
    if api_snapshot:
        for event in api_snapshot.get("events") or []:
            if event.get("kind") != "generated":
                continue
            epoch = _timestamp_epoch(event)
            if epoch is None or epoch > now or now - epoch >= window:
                continue
            count = _nonnegative_int(event.get("count"))
            if count:
                request_id = str(event.get("requestId") or "")
                if request_id:
                    api_generated_ids.add(request_id)
                api_events.append({"epoch": epoch, "count": count, "requestId": request_id})

    local_only = [row for row in local if not row["requestId"] or row["requestId"] not in api_generated_ids]
    events = api_events + local_only
    used = sum(event["count"] for event in events)
    remaining = max(0, limit - used)
    needed_free = max(0, used + request_count - limit)
    freed = 0
    next_available = 0.0
    if needed_free:
        for event in sorted(events, key=lambda item: item["epoch"]):
            freed += event["count"]
            if freed >= needed_free:
                next_available = event["epoch"] + window
                break
    return {
        "allowed": request_count <= remaining,
        "instanceId": str(instance_id or "").upper(),
        "plannedGenerations": request_count,
        "usedGenerations": used,
        "remainingGenerations": remaining,
        "generationLimit": limit,
        "windowSeconds": window,
        "waitSeconds": max(1, math.ceil(next_available - now)) if needed_free and next_available else 0,
        "nextAvailableEpoch": next_available or None,
        "ledgerSource": "workbench+legacy" if api_snapshot else "legacy",
    }
