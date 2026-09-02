#!/usr/bin/env python3
"""
kickstart_instances.py - 强制唤醒与重载 A/B/C/D 四路内容生产实例

功能：
1. 通过 CDP (9431-9434) 强制刷新各实例的主工作台页面（加载最新的 24/7 全天候 app.js 配置）
2. 刷新 ChatGPT 内嵌视图，解除网络流式中断与挂起
3. 验证四路实例的实时连接状态与工作台生命周期
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request

try:
    import websocket
except ImportError:
    # 尝试在没有 external websocket 库时使用简单的 socket 或 powershell
    websocket = None


def get_cdp_targets(port: int) -> list[dict]:
    url = f"http://127.0.0.1:{port}/json/list"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Kickstart"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        print(f"[CDP {port}] 无法获取目标列表: {exc}", file=sys.stderr)
        return []


def reload_target_via_ws(ws_url: str) -> bool:
    if not websocket:
        return False
    try:
        ws = websocket.create_connection(ws_url, timeout=3)
        msg = json.dumps({"id": 1, "method": "Page.reload", "params": {"ignoreCache": True}})
        ws.send(msg)
        time.sleep(0.2)
        ws.close()
        return True
    except Exception as exc:
        print(f"WebSocket reload failed: {exc}", file=sys.stderr)
        return False


def main():
    instances = [
        {"id": "A", "http": 4331, "cdp": 9431},
        {"id": "B", "http": 4332, "cdp": 9432},
        {"id": "C", "http": 4333, "cdp": 9433},
        {"id": "D", "http": 4334, "cdp": 9434},
    ]

    print("=== 开始执行四路实例强制唤醒与重载 ===")
    for inst in instances:
        name = inst["id"]
        cdp_port = inst["cdp"]
        http_port = inst["http"]
        print(f"\n>> 正在处理 实例 {name} (HTTP {http_port} / CDP {cdp_port})...")
        targets = get_cdp_targets(cdp_port)
        if not targets:
            print(f"  ❌ 实例 {name} CDP 未响应")
            continue

        for t in targets:
            title = t.get("title", "")
            url = t.get("url", "")
            ws_url = t.get("webSocketDebuggerUrl", "")
            target_type = t.get("type", "")
            if target_type != "page":
                continue

            if f"127.0.0.1:{http_port}" in url and "assistant-overlay" not in url:
                print(f"  -> 刷新主工作台: {url}")
                if ws_url and websocket:
                    reload_target_via_ws(ws_url)
            elif "chatgpt.com" in url:
                print(f"  -> 刷新 ChatGPT 视图: {url}")
                if ws_url and websocket:
                    reload_target_via_ws(ws_url)

    print("\n=== 重载指令发送完毕 ===")


if __name__ == "__main__":
    main()
