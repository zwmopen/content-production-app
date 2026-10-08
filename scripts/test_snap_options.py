import urllib.request
import json
import asyncio
import websockets
import base64
import sys

sys.stdout.reconfigure(encoding='utf-8')

async def test_snap_options():
    tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:9432/json", timeout=5).read())
    chat = next((t for t in tabs if "chatgpt.com" in t.get("url", "")), None)
    if not chat:
        print("No chatgpt tab")
        return

    async with websockets.connect(chat['webSocketDebuggerUrl'], max_size=25*1024*1024) as ws:
        msg_id = 1
        async def call(method, params=None, timeout=5.0):
            nonlocal msg_id
            mid = msg_id
            msg_id += 1
            payload = {"id": mid, "method": method}
            if params: payload["params"] = params
            await ws.send(json.dumps(payload))
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                resp = json.loads(raw)
                if resp.get("id") == mid:
                    return resp

        # Try Runtime.evaluate first to read title and articles
        r = await call("Runtime.evaluate", {
            "expression": """(() => {
                const articles = Array.from(document.querySelectorAll('article, [data-message-author-role]'));
                return {
                    title: document.title,
                    url: window.location.href,
                    articlesCount: articles.length,
                    texts: articles.map(a => a.innerText.slice(0, 150))
                };
            })()""",
            "returnByValue": True
        })
        print("Evaluate result:", json.dumps(r.get("result", {}).get("result", {}).get("value"), ensure_ascii=False, indent=2))

        # Try captureScreenshot with fromSurface=False
        try:
            r2 = await call("Page.captureScreenshot", {"format": "jpeg", "quality": 80, "fromSurface": False}, timeout=5.0)
            data = r2.get("result", {}).get("data")
            print(f"Screenshot fromSurface=False success: {len(data) if data else 0} bytes")
        except Exception as e:
            print(f"fromSurface=False failed: {e}")

if __name__ == '__main__':
    asyncio.run(test_snap_options())
