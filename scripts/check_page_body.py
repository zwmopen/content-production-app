import urllib.request
import json
import asyncio
import websockets
import base64
import sys

sys.stdout.reconfigure(encoding='utf-8')

async def check_body():
    tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:9432/json", timeout=5).read())
    chat = next((t for t in tabs if "chatgpt.com" in t.get("url", "")), None)
    if not chat:
        print("No chatgpt tab found")
        return
    print(f"Connecting to: {chat['title']} | {chat['url']}")
    
    async with websockets.connect(chat['webSocketDebuggerUrl'], max_size=25*1024*1024) as ws:
        msg_id = 1
        async def call(method, params=None):
            nonlocal msg_id
            mid = msg_id
            msg_id += 1
            payload = {"id": mid, "method": method}
            if params: payload["params"] = params
            await ws.send(json.dumps(payload))
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=15.0)
                resp = json.loads(raw)
                if resp.get("id") == mid:
                    return resp

        # 1. Page enable
        await call("Page.enable")
        
        # 2. 截屏
        snap_res = await call("Page.captureScreenshot", {"format": "jpeg", "quality": 85})
        b64 = snap_res.get("result", {}).get("data")
        if b64:
            with open(r"D:\AICode\工具开发\projects\content-production-app\scripts\chatgpt_real_screen.jpg", "wb") as f:
                f.write(base64.b64decode(b64))
            print("Screenshot saved to scripts/chatgpt_real_screen.jpg")
            
        # 3. 检查页面文本
        body_res = await call("Runtime.evaluate", {
            "expression": """(() => {
                const ta = document.querySelector('#prompt-textarea') || document.querySelector('[contenteditable="true"]');
                return {
                    url: window.location.href,
                    title: document.title,
                    bodySnippet: document.body.innerText.slice(0, 1000),
                    taText: ta ? ta.innerText : null
                };
            })()""",
            "returnByValue": True
        })
        val = body_res.get("result", {}).get("result", {}).get("value")
        print("Page state snippet:", json.dumps(val, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    asyncio.run(check_body())
