import urllib.request
import json
import asyncio
import websockets
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

async def wait_complete():
    tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:9432/json", timeout=5).read())
    chat = next((t for t in tabs if "chatgpt.com" in t.get("url", "")), None)
    if not chat:
        print("No chat tab found")
        return

    print(f"Connecting to: {chat['title']}")
    async with websockets.connect(chat['webSocketDebuggerUrl'], max_size=25*1024*1024) as ws:
        msg_id = 1
        async def call(method, params=None):
            nonlocal msg_id
            mid = msg_id
            msg_id += 1
            await ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=20.0)
                r = json.loads(raw)
                if r.get("id") == mid:
                    return r

        print("Monitoring stream till finished...")
        last_len = 0
        stable_count = 0
        for i in range(60):
            await asyncio.sleep(3)
            js = """(() => {
                const stopBtn = document.querySelector('button[data-testid="stop-button"]');
                const articles = Array.from(document.querySelectorAll('article, [data-message-author-role="assistant"]'));
                const lastArticle = articles[articles.length - 1];
                const text = lastArticle ? lastArticle.innerText : (document.querySelector('main')?.innerText || '');
                return {
                    generating: !!stopBtn,
                    textLength: text.length,
                    snippet: text.slice(-200)
                };
            })()"""
            r = await call("Runtime.evaluate", {"expression": js, "returnByValue": True})
            val = r.get("result", {}).get("result", {}).get("value", {})
            curr_len = val.get("textLength", 0)
            generating = val.get("generating", False)
            print(f"[{i+1}/60] Generating: {generating} | Current Length: {curr_len}")

            if curr_len > 1500 and not generating and curr_len == last_len:
                stable_count += 1
                if stable_count >= 2:
                    print("Generation complete and stable!")
                    break
            else:
                stable_count = 0
            last_len = curr_len

        # 提取最后回复完整内容
        js_extract = """(() => {
            const articles = Array.from(document.querySelectorAll('article, [data-message-author-role="assistant"]'));
            const lastArticle = articles[articles.length - 1];
            return lastArticle ? lastArticle.innerText : document.querySelector('main')?.innerText || '';
        })()"""
        r_ext = await call("Runtime.evaluate", {"expression": js_extract, "returnByValue": True})
        resp_text = r_ext.get("result", {}).get("result", {}).get("value", "")
        print(f"Final extracted text length: {len(resp_text)} chars")

        with open(r"D:\AICode\工具开发\projects\content-production-app\scripts\chatgpt_complete_response.txt", "w", encoding="utf-8") as f:
            f.write(resp_text)
        print("Wrote complete response to scripts/chatgpt_complete_response.txt")

if __name__ == '__main__':
    asyncio.run(wait_complete())
