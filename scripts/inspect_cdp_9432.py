import asyncio
import json
import websockets
import urllib.request
import base64

async def inspect():
    targets = json.loads(urllib.request.urlopen('http://127.0.0.1:9432/json').read().decode())
    for idx, t in enumerate(targets):
        title = t.get("title")
        url = t.get("url")
        ws_url = t.get('webSocketDebuggerUrl')
        print(f"\n--- Target [{idx}] {title} ---")
        print(f"URL: {url}")
        print(f"WS: {ws_url}")
        if not ws_url:
            continue
        try:
            async with websockets.connect(ws_url, timeout=5) as ws:
                # Get location and body text
                expr = "JSON.stringify({ title: document.title, url: location.href, text: document.body ? document.body.innerText.slice(0, 300) : '' })"
                await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': expr}}))
                res = json.loads(await ws.recv())
                val = res.get('result', {}).get('result', {}).get('value')
                print(f"Eval: {val}")

                # Capture CDP screenshot
                await ws.send(json.dumps({'id': 2, 'method': 'Page.captureScreenshot', 'params': {'format': 'jpeg', 'quality': 80}}))
                s_res = json.loads(await ws.recv())
                b64_data = s_res.get('result', {}).get('data')
                if b64_data:
                    out_path = f"D:/AICode/target_{idx}_snap.jpg"
                    with open(out_path, "wb") as f:
                        f.write(base64.b64decode(b64_data))
                    print(f"Screenshot saved to: {out_path}")
        except Exception as e:
            print(f"Error inspecting target {idx}: {e}")

if __name__ == "__main__":
    asyncio.run(inspect())
