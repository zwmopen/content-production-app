import urllib.request
import json
import asyncio
import websockets
import sys

sys.stdout.reconfigure(encoding='utf-8')

async def test_prompt():
    tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:9432/json", timeout=5).read())
    chat = next((t for t in tabs if "chatgpt.com" in t.get("url", "")), None)
    if not chat:
        print("No chat tab", flush=True)
        return

    async with websockets.connect(chat['webSocketDebuggerUrl'], max_size=20*1024*1024) as ws:
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

        test_text = "【测试提示词】请针对已上传的安吉素材与母版，分析视觉亮点与排版构架。"

        js = f"""
        (() => {{
            const ta = document.querySelector('#prompt-textarea') || document.querySelector('[contenteditable="true"]');
            if (!ta) return {{ success: false, reason: 'No editor found' }};
            ta.focus();
            
            // 使用 document.execCommand('insertText') 完美兼容 ProseMirror / Lexical
            const success = document.execCommand('insertText', false, {json.dumps(test_text)});
            if (!success) {{
                ta.innerText = {json.dumps(test_text)};
                ta.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText' }}));
            }}
            
            // 检查发送按钮
            const sendBtn = document.querySelector('button[data-testid="send-button"]')
                || document.querySelector('button[aria-label*="发送"]')
                || document.querySelector('button[aria-label*="Send"]');
            
            return {{
                success: true,
                editorText: ta.innerText,
                hasSendBtn: !!sendBtn,
                sendDisabled: sendBtn ? sendBtn.disabled : null
            }};
        }})()
        """
        r = await call("Runtime.evaluate", {"expression": js, "returnByValue": True})
        print("Prompt injection result:", json.dumps(r.get("result", {}).get("result", {}).get("value"), ensure_ascii=False, indent=2), flush=True)

if __name__ == '__main__':
    asyncio.run(test_prompt())
