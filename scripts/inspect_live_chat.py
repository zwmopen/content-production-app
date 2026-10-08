import asyncio
import json
import urllib.request
import websockets
import sys

sys.stdout.reconfigure(encoding='utf-8')

async def main():
    tabs = json.loads(urllib.request.urlopen('http://127.0.0.1:9432/json').read())
    chat_tab = next(t for t in tabs if 'chatgpt.com' in t.get('url', ''))
    async with websockets.connect(chat_tab['webSocketDebuggerUrl']) as ws:
        js = """
        (() => {
            const ta = document.querySelector('#prompt-textarea');
            const ce = document.querySelector('[contenteditable="true"]');
            const inputs = Array.from(document.querySelectorAll('input')).map(i => i.type + '#' + i.id);
            const title = document.title;
            const h1 = document.querySelector('h1') ? document.querySelector('h1').innerText : null;
            const bodySnippet = document.body ? document.body.innerText.slice(0, 500) : '';
            return { title, h1, hasTa: !!ta, hasCe: !!ce, inputs, bodySnippet };
        })()
        """
        await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': js, 'returnByValue': True}}))
        res = json.loads(await ws.recv())
        val = res.get('result', {}).get('result', {}).get('value')
        print(json.dumps(val, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    asyncio.run(main())
