import urllib.request
import json
import asyncio
import websockets
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

async def send_followup():
    tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:9432/json", timeout=5).read())
    chat = next((t for t in tabs if "chatgpt.com" in t.get("url", "")), None)
    if not chat:
        print("No chatgpt tab found")
        return

    print(f"Connecting to: {chat['title']} | {chat['url']}")
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

        followup_prompt = """收到，当前会话暂不调用生图工具，请基于刚才已上传的 8 张图片（前2张母版 T87 + 后6张安吉原料），立即执行文案架构落地：
1. 【母版 T87 视觉解析与版式复刻】：详细解析 T87 封面与内页的视觉排版构架，制定 P1-P8 页面视觉排版规范与指令；
2. 【小红书双主稿商业转化文案】：
   - 主稿一：【秋日松弛感·沉浸式团建】（适合发小红书种草，氛围感拉满）；
   - 主稿二：【HR省心首选·高分团建案】（适合发企业号/方案报备，数据清晰、流程严密）；
   - 统一遵循“10人起订 / 20-100人定制”，彻底剔除竞品名企字眼；
   - 严格使用“\\u2800”隐形空行防吞排版规范，确保小红书发布绝对不粘连；
   - 包含详细完整的 2天1夜分时行程节点表与定制服务清单。"""

        # 注入提示词
        js_inject = f"""(() => {{
            const ta = document.querySelector('#prompt-textarea') || document.querySelector('[contenteditable="true"]');
            if (!ta) return false;
            ta.focus();
            const success = document.execCommand('insertText', false, {json.dumps(followup_prompt)});
            if (!success) {{
                ta.innerText = {json.dumps(followup_prompt)};
                ta.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText' }}));
            }}
            return true;
        }})()"""
        r_inj = await call("Runtime.evaluate", {"expression": js_inject, "returnByValue": True})
        print("Injected prompt:", r_inj.get("result", {}).get("result", {}).get("value"))
        await asyncio.sleep(1.5)

        # 点击发送
        js_send = """(() => {
            const sendBtn = document.querySelector('button[data-testid="send-button"]')
                || document.querySelector('button[aria-label*="发送"]')
                || document.querySelector('button[aria-label*="Send"]');
            if (sendBtn && !sendBtn.disabled) {
                sendBtn.click();
                return 'CLICKED_BUTTON';
            }
            return 'NOT_FOUND';
        })()"""
        r_send = await call("Runtime.evaluate", {"expression": js_send, "returnByValue": True})
        print("Send click:", r_send.get("result", {}).get("result", {}).get("value"))

        # 循环监控生成
        print("Monitoring response stream...")
        last_len = 0
        stable_count = 0
        for i in range(75):
            await asyncio.sleep(2)
            js_status = """(() => {
                const stopBtn = document.querySelector('button[data-testid="stop-button"], button[aria-label*="停止"], button[aria-label*="Stop"]');
                const main = document.querySelector('main');
                const text = main ? main.innerText : '';
                return {
                    generating: !!stopBtn,
                    textLength: text.length,
                    snippet: text.slice(-200)
                };
            })()"""
            r_st = await call("Runtime.evaluate", {"expression": js_status, "returnByValue": True})
            val = r_st.get("result", {}).get("result", {}).get("value", {})
            curr_len = val.get("textLength", 0)
            generating = val.get("generating", False)
            print(f"[{i+1}/75] Generating: {generating} | Length: {curr_len} chars")

            if curr_len > 800 and not generating and curr_len == last_len:
                stable_count += 1
                if stable_count >= 2:
                    print("Generation complete and stable!")
                    break
            else:
                stable_count = 0
            last_len = curr_len

        # 提取全文
        js_extract = """(() => {
            const main = document.querySelector('main');
            return main ? main.innerText : '';
        })()"""
        r_ext = await call("Runtime.evaluate", {"expression": js_extract, "returnByValue": True})
        full_text = r_ext.get("result", {}).get("result", {}).get("value", "")
        print(f"Extracted total characters: {len(full_text)}")
        
        with open(r"D:\AICode\工具开发\projects\content-production-app\scripts\chatgpt_output_raw.txt", "w", encoding="utf-8") as f:
            f.write(full_text)
        print("Saved raw output to scripts/chatgpt_output_raw.txt")

if __name__ == '__main__':
    asyncio.run(send_followup())
