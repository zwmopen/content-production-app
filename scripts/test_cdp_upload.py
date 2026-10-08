import urllib.request
import json
import asyncio
import websockets
import base64
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

MATERIAL_DIR = Path(r"D:\AICode\项目推进\projects\江湖有旅人\主项目\01-素材库\秋季（9—11月·智能分类）\精准流量\安吉\评0-赞0-9‑11月秋季爆款安吉2天1夜团建方案‼-知旅团建-安吉站")
TEMPLATE_DIR = Path(r"D:\AICode\项目推进\projects\江湖有旅人\主项目\02-模板库\精准流量团建模板\「精准母版·江浙沪·安吉」秋日松弛感2天1夜团建-全图沉浸竖排多页（T87）")

async def test_upload():
    template_files = [str(TEMPLATE_DIR / "模板-P1.png"), str(TEMPLATE_DIR / "模板-P2.png")]
    mat_files = [str(MATERIAL_DIR / f) for f in sorted(os.listdir(MATERIAL_DIR)) if f.lower().endswith(('.jpg', '.png', '.jpeg'))][:4]
    all_files = template_files + mat_files
    print(f"Files to upload ({len(all_files)}):")
    for f in all_files:
        print(f" - {f} (exists: {os.path.exists(f)})")

    tabs = json.loads(urllib.request.urlopen("http://127.0.0.1:9432/json").read())
    chat = next((t for t in tabs if "chatgpt.com" in t.get("url", "")), None)
    if not chat:
        print("No chatgpt tab")
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
                resp = json.loads(await ws.recv())
                if resp.get("id") == mid:
                    return resp

        await call("DOM.enable")
        await call("Page.enable")

        doc = await call("DOM.getDocument", {"depth": 1})
        root = doc.get("result", {}).get("root", {}).get("nodeId", 1)

        # 查找 input
        for sel in ["input[accept*='image']", "input[type='file']", "#_r_b_", "#_r_c_"]:
            res = await call("DOM.querySelector", {"nodeId": root, "selector": sel})
            nid = res.get("result", {}).get("nodeId")
            if nid and nid > 0:
                print(f"Found input via '{sel}', nodeId={nid}")
                res_set = await call("DOM.setFileInputFiles", {"nodeId": nid, "files": all_files})
                print("setFileInputFiles result:", res_set)
                break

        # 触发 change
        await call("Runtime.evaluate", {
            "expression": """(() => {
                const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
                inputs.forEach(inp => {
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                });
            })()"""
        })

        # 等待 4 秒看看
        await asyncio.sleep(4)

        # 检查页面上的附件预览
        chk_res = await call("Runtime.evaluate", {
            "expression": """(() => {
                const imgs = document.querySelectorAll('form img, [role="presentation"] img, [role="group"] img');
                const chips = document.querySelectorAll('[role="group"], [aria-label*="移除"], [aria-label*="Remove"]');
                return {
                    imgCount: imgs.length,
                    chipCount: chips.length,
                    htmlSnippet: document.querySelector('form')?.innerHTML?.slice(0, 500)
                };
            })()""",
            "returnByValue": True
        })
        print("Attachment check:", chk_res.get("result", {}).get("result", {}).get("value"))

        # 截图看看
        snap_res = await call("Page.captureScreenshot", {"format": "jpeg", "quality": 80})
        b64 = snap_res.get("result", {}).get("data")
        if b64:
            with open(r"D:\AICode\工具开发\projects\content-production-app\scripts\test_upload_screen.jpg", "wb") as f:
                f.write(base64.b64decode(b64))
            print("Saved screenshot to scripts/test_upload_screen.jpg")

if __name__ == '__main__':
    asyncio.run(test_upload())
