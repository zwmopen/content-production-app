import asyncio
import json
import websockets

async def check_user():
    ws_url = 'ws://127.0.0.1:9432/devtools/page/899EE5E6E8C151FFAE1AB10A0DF03209'
    async with websockets.connect(ws_url) as ws:
        js_sess = "fetch('/api/auth/session').then(r => r.json()).catch(e => ({ error: e.message }))"
        await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': js_sess, 'awaitPromise': True, 'returnByValue': True}}))
        res_sess = json.loads(await ws.recv())
        user_data = res_sess.get('result', {}).get('result', {}).get('value', {})
        print("Target 1 Auth Session:")
        print(json.dumps(user_data, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    asyncio.run(check_user())
