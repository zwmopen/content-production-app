import asyncio
import json
import urllib.request
import websockets

async def inspect():
    url = 'http://127.0.0.1:9432/json'
    res = json.loads(urllib.request.urlopen(url, timeout=5).read().decode('utf-8'))
    page = next(p for p in res if 'chatgpt.com' in p.get('url', '') and p.get('type') == 'page')
    ws = await websockets.connect(page['webSocketDebuggerUrl'], max_size=50*1024*1024)
    js = """(() => {
        const m = document.querySelector('main');
        const text = m ? m.innerText : '';
        const allImgs = Array.from(document.querySelectorAll('img')).map(i => ({
            src: (i.currentSrc || i.src || '').slice(0, 100),
            w: i.naturalWidth,
            h: i.naturalHeight,
            alt: (i.alt || '').slice(0, 50)
        }));
        return {
            textTail: text.slice(-2000),
            imgs: allImgs
        };
    })()"""
    await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': js, 'returnByValue': True}}))
    data = json.loads(await ws.recv())
    val = data.get('result', {}).get('result', {}).get('value', {})
    print("===== MAIN TEXT TAIL =====")
    print(val.get('textTail', ''))
    print("===== IMAGES =====")
    for img in val.get('imgs', []):
        print(f"w={img['w']} h={img['h']} alt={img['alt'][:30]} src={img['src'][:100]}")
    await ws.close()

if __name__ == '__main__':
    asyncio.run(inspect())
