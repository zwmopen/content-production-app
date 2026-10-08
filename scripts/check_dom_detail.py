import urllib.request
import json
import asyncio
import websockets
import sys

sys.stdout.reconfigure(encoding='utf-8')

async def check():
    tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:9432/json", timeout=5).read())
    chat = next((t for t in tabs if "chatgpt.com" in t.get("url", "")), None)
    if not chat:
        print("No chatgpt tab found")
        return

    async with websockets.connect(chat['webSocketDebuggerUrl'], max_size=25*1024*1024) as ws:
        msg_id = 1
        async def call(method, params=None):
            nonlocal msg_id
            mid = msg_id
            msg_id += 1
            await ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=10.0)
                r = json.loads(raw)
                if r.get("id") == mid:
                    return r

        js = """
        (() => {
            const main = document.querySelector('main');
            const form = document.querySelector('form');
            const conversation = document.querySelector('[class*="conversation"]');
            const messages = Array.from(document.querySelectorAll('[data-message-author-role]')).map(el => ({
                role: el.getAttribute('data-message-author-role'),
                text: el.innerText.slice(0, 300)
            }));
            return {
                title: document.title,
                url: window.location.href,
                hasMain: !!main,
                mainSnippet: main ? main.innerText.slice(0, 800) : null,
                hasForm: !!form,
                formSnippet: form ? form.innerText.slice(0, 300) : null,
                messages
            };
        })()
        """
        res = await call("Runtime.evaluate", {"expression": js, "returnByValue": True})
        print(json.dumps(res.get("result", {}).get("result", {}).get("value"), ensure_ascii=False, indent=2))

if __name__ == '__main__':
    asyncio.run(check())
