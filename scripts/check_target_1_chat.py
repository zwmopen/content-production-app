import asyncio
import json
import websockets

async def check():
    ws_url = 'ws://127.0.0.1:9432/devtools/page/899EE5E6E8C151FFAE1AB10A0DF03209'
    async with websockets.connect(ws_url) as ws:
        js = "JSON.stringify({ url: location.href, title: document.title, text: document.body ? document.body.innerText.slice(-600) : '' })"
        await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': js, 'returnByValue': True}}))
        res = json.loads(await ws.recv())
        val = res.get('result', {}).get('result', {}).get('value')
        print(val)

if __name__ == "__main__":
    asyncio.run(check())
