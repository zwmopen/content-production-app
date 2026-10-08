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
        const imgs = Array.from(document.querySelectorAll('img')).map(i => ({
            src: (i.currentSrc || i.src || ''),
            w: i.naturalWidth,
            h: i.naturalHeight,
            alt: (i.alt || '')
        }));
        return {
            text: text,
            imgs: imgs
        };
    })()"""
    await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': js, 'returnByValue': True}}))
    data = json.loads(await ws.recv())
    val = data.get('result', {}).get('result', {}).get('value', {})
    
    with open('d:/AICode/工具开发/projects/content-production-app/tests/migration_output/page_text.txt', 'w', encoding='utf-8') as f:
        f.write(val.get('text', ''))
        
    with open('d:/AICode/工具开发/projects/content-production-app/tests/migration_output/page_imgs.json', 'w', encoding='utf-8') as f:
        json.dump(val.get('imgs', []), f, ensure_ascii=False, indent=2)
        
    print("SAVED_OK")
    await ws.close()

if __name__ == '__main__':
    asyncio.run(inspect())
