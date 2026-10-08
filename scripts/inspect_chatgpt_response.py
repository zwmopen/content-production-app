import urllib.request
import json
import asyncio
import websockets
import base64
import sys

sys.stdout.reconfigure(encoding='utf-8')

async def inspect():
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

        # 检查对话文章
        js = """
        (() => {
            const articles = Array.from(document.querySelectorAll('article, [data-message-author-role="assistant"], [data-message-author-role="user"]'));
            const msgs = articles.map(a => ({
                role: a.getAttribute('data-message-author-role') || (a.innerText.includes('产线实机测试') ? 'user' : 'assistant'),
                len: a.innerText.length,
                textSnippet: a.innerText.slice(0, 500),
                fullText: a.innerText,
                imgs: Array.from(a.querySelectorAll('img')).map(i => i.src)
            }));
            const stopBtn = document.querySelector('button[data-testid="stop-button"]');
            return {
                title: document.title,
                url: window.location.href,
                isGenerating: !!stopBtn,
                messageCount: msgs.length,
                messages: msgs
            };
        })()
        """
        res = await call("Runtime.evaluate", {"expression": js, "returnByValue": True})
        val = res.get("result", {}).get("result", {}).get("value")
        print("Conversation state:", json.dumps({k: v for k, v in val.items() if k != "messages"}, ensure_ascii=False, indent=2))
        
        for idx, m in enumerate(val.get("messages", [])):
            print(f"\n--- Message #{idx+1} ({m['role']}, {m['len']} chars, {len(m['imgs'])} images) ---")
            print(m['textSnippet'][:300] + ("..." if len(m['textSnippet']) > 300 else ""))
            
        # 截图保存
        snap_res = await call("Page.captureScreenshot", {"format": "jpeg", "quality": 85})
        b64 = snap_res.get("result", {}).get("data")
        if b64:
            with open(r"D:\AICode\工具开发\projects\content-production-app\scripts\chatgpt_real_result.jpg", "wb") as f:
                f.write(base64.b64decode(b64))
            print("\nSaved screenshot to: scripts/chatgpt_real_result.jpg")

if __name__ == '__main__':
    asyncio.run(inspect())
