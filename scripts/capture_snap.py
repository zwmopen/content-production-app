import urllib.request
import json
import asyncio
import websockets
import base64
import sys

sys.stdout.reconfigure(encoding='utf-8')

async def capture_snap():
    tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:9432/json", timeout=5).read())
    chat = next((t for t in tabs if "chatgpt.com" in t.get("url", "")), None)
    if not chat:
        print("No tab")
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

        # Enable Page domain
        await call("Page.enable")
        # Capture screenshot
        r = await call("Page.captureScreenshot", {"format": "jpeg", "quality": 85})
        data = r.get("result", {}).get("data")
        if data:
            dest1 = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）\_产线三模式落地对比测试_20261008\02-CDP_B产线_GPT\实机CDP测试_素材安吉+母版T87\03-实机CDP凭证\chatgpt_realtime_screenshot.jpg"
            dest2 = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）\_产线三模式落地对比测试_20261008\02-CDP_B产线_GPT\实机CDP测试_素材安吉+模板T51\03-实机CDP凭证\chatgpt_realtime_screenshot.jpg"
            with open(dest1, "wb") as f:
                f.write(base64.b64decode(data))
            with open(dest2, "wb") as f:
                f.write(base64.b64decode(data))
            print(f"✅ 成功抓取并写入实机截图: {len(data)} 字节")
        else:
            print("❌ 未获取到截图数据")

if __name__ == '__main__':
    try:
        asyncio.run(capture_snap())
    except Exception as e:
        print(f"Capture error: {e}")
