import asyncio
import json
import urllib.request
import websockets

async def check():
    res = urllib.request.urlopen('http://127.0.0.1:9432/json/list')
    tabs = json.loads(res.read())
    chat_tab = next((t for t in tabs if 'chatgpt.com' in t.get('url', '')), None)
    if not chat_tab:
        print("No ChatGPT tab found on port 9432")
        return
    ws_url = chat_tab['webSocketDebuggerUrl']
    async with websockets.connect(ws_url) as ws:
        expr = """(() => {
            const modelBtn = document.querySelector('button[aria-label*="模型"], button[aria-label*="Model"], [data-testid*="model-switcher"]');
            const userAvatar = document.querySelector('img[alt*="User"], button[aria-label*="User"], [data-testid="user-menu"]');
            const fileInput = document.querySelector('input[type="file"]');
            return {
                modelBtnText: modelBtn ? modelBtn.innerText : null,
                hasFileInput: !!fileInput,
                userAvatarFound: !!userAvatar
            };
        })()"""
        msg = {'id': 2, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'returnByValue': True}}
        await ws.send(json.dumps(msg))
        resp = await ws.recv()
        data = json.loads(resp)
        print("Model & User Status:", data.get('result', {}).get('result', {}).get('value'))

if __name__ == '__main__':
    asyncio.run(check())
