import urllib.request
import json
import asyncio
import websockets
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

MATERIAL_DIR = Path(r"D:\AICode\项目推进\projects\江湖有旅人\主项目\01-素材库\秋季（9—11月·智能分类）\精准流量\安吉\评0-赞0-9‑11月秋季爆款安吉2天1夜团建方案‼-知旅团建-安吉站")
TEMPLATE_DIR = Path(r"D:\AICode\项目推进\projects\江湖有旅人\主项目\02-模板库\精准流量团建模板\「精准母版·江浙沪·安吉」秋日松弛感2天1夜团建-全图沉浸竖排多页（T87）")

async def debug_upload():
    template_files = [str(TEMPLATE_DIR / "模板-P1.png"), str(TEMPLATE_DIR / "模板-P2.png")]
    mat_files = [str(MATERIAL_DIR / f) for f in sorted(os.listdir(MATERIAL_DIR)) if f.lower().endswith(('.jpg', '.png', '.jpeg'))][:6]
    all_files = template_files + mat_files
    print(f"Total files: {len(all_files)}", flush=True)

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

        await call("DOM.enable")
        r_doc = await call("DOM.getDocument", {"depth": 1})
        root = r_doc.get("result", {}).get("root", {}).get("nodeId", 1)

        r_q = await call("DOM.querySelector", {"nodeId": root, "selector": "input[accept*='image']"})
        nid = r_q.get("result", {}).get("nodeId")
        print(f"Target file input nodeId: {nid}", flush=True)

        # Set files
        r_set = await call("DOM.setFileInputFiles", {"nodeId": nid, "files": all_files})
        print(f"setFileInputFiles result: {r_set}", flush=True)

        # Trigger events
        await call("Runtime.evaluate", {
            "expression": """(() => {
                const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
                inputs.forEach(inp => {
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    inp.dispatchEvent(new Event('change', { bubbles: true }));
                });
            })()"""
        })
        print("Dispatched input and change events.", flush=True)

        # Wait 3 seconds and check previews
        await asyncio.sleep(3)
        chk = await call("Runtime.evaluate", {
            "expression": """(() => {
                const imgs = document.querySelectorAll('form img, [role="group"] img, [data-testid*="attachment"]');
                const chips = document.querySelectorAll('[aria-label*="移除"], [aria-label*="Remove"], [role="group"]');
                const btn = document.querySelector('button[data-testid="send-button"]');
                return {
                    imgCount: imgs.length,
                    chipCount: chips.length,
                    hasSend: !!btn,
                    sendDisabled: btn ? btn.disabled : null
                };
            })()""",
            "returnByValue": True
        })
        print("Check result:", json.dumps(chk.get("result", {}).get("result", {}).get("value"), ensure_ascii=False, indent=2), flush=True)

if __name__ == '__main__':
    asyncio.run(debug_upload())
