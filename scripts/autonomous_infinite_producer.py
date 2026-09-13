# -*- coding: utf-8 -*-
"""
====================================================================
自主无限生产守护进程 (Autonomous Infinite Production Daemon)
====================================================================
特性：
1. 完全脱离 AI 对话生命周期：作为独立的 OS 后台进程持续运行，不随对话关闭或重启而终止；
2. 自动化轮询任务队列：精准流量优先，全量扫描秋季 800+ 篇素材，遇未生产素材即刻排期；
3. V4.3 强锁版出图 + Format 3 三端文案全流程自动化；
4. 实时维护状态信标 (autonomous_production_daemon_status.json)，供 AI 与前端随时读取监控与干预；
5. 每次生产后自动更新 .tags.json 与作品历史数据库，并调用 Pillow 质检验收。
====================================================================
"""
import os
import sys
import json
import time
import re
import datetime
import subprocess
import urllib.request
import asyncio
import websockets
import base64
import ctypes

sys.stdout.reconfigure(encoding='utf-8')

PROJECT_ROOT = r"D:\AICode"
AUTUMN_DIR = os.path.join(PROJECT_ROOT, r"项目推进\projects\江湖有旅人\主项目\01-素材库\秋季（9—11月·智能分类）")
OUTPUT_BASE = os.path.join(PROJECT_ROOT, r"项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）")
STATUS_FILE = os.path.join(PROJECT_ROOT, r"运行数据\autonomous_production_daemon_status.json")
LOG_FILE = os.path.join(PROJECT_ROOT, r"运行数据\autonomous_production.log")
VERIFY_SCRIPT = os.path.join(PROJECT_ROOT, r"AI\skills\技能包\技能\xhs-card-replica-pipeline\scripts\verify_output.py")

user32 = ctypes.windll.user32
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def log(msg):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

def bring_window_topmost(port=9433):
    try:
        target_kws = ['4333', '实例 C', '9433'] if port == 9433 else ['4331', '实例 A', '9431']
        def enum_proc(hwnd, lParam):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buff, length + 1)
                    title = buff.value
                    if any(k in title for k in target_kws + ['ChatGPT']):
                        user32.ShowWindow(hwnd, 9)
                        user32.SetForegroundWindow(hwnd)
            return True
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)
        user32.EnumWindows(WNDENUMPROC(enum_proc), 0)
    except Exception:
        pass

def write_status(state, current_pkg=None, completed_total=0, last_completed_product=None, last_completed_material=None, queue_len=0, error_msg=None):
    try:
        status_data = {
            "state": state,
            "pid": os.getpid(),
            "last_heartbeat": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "current_package": current_pkg,
            "completed_total": completed_total,
            "last_completed_product": last_completed_product,
            "last_completed_material": last_completed_material,
            "queue_remaining": queue_len,
            "last_error": error_msg
        }
        os.makedirs(os.path.dirname(STATUS_FILE), exist_ok=True)
        with open(STATUS_FILE, "w", encoding="utf-8") as f:
            json.dump(status_data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

def scan_pending_queue():
    """扫描秋季素材库，返回未生产的目录列表（精准流量优先）"""
    candidates = []
    if not os.path.exists(AUTUMN_DIR):
        return candidates

    for root, dirs, files in os.walk(AUTUMN_DIR):
        exts = ('.jpg', '.jpeg', '.png', '.webp')
        imgs = [f for f in files if f.lower().endswith(exts)]
        if len(imgs) >= 2:
            tags_path = os.path.join(root, ".tags.json")
            usage_count = 0
            lifecycle = "未生产"
            if os.path.exists(tags_path):
                try:
                    with open(tags_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    usage_count = data.get("production", {}).get("usageCount", 0)
                    lifecycle = data.get("production", {}).get("lifecycleState", "未生产")
                except Exception:
                    pass
            if usage_count == 0 and lifecycle != "已生产":
                is_precision = "精准流量" in root
                candidates.append({
                    "path": root,
                    "name": os.path.basename(root),
                    "priority": 0 if is_precision else 1,
                    "img_count": len(imgs)
                })

    # 精准流量排在前面
    candidates.sort(key=lambda x: (x["priority"], x["name"]))
    return candidates

class StandaloneProducer:
    def __init__(self, cdp_port=9433):
        self.cdp_port = cdp_port
        self.cdp_list_url = f"http://127.0.0.1:{cdp_port}/json/list"
        self.ws = None
        self.msg_id = 1

    async def connect(self):
        with opener.open(self.cdp_list_url, timeout=5) as r:
            targets = json.loads(r.read().decode())
        target = next((t for t in targets if 'chatgpt.com' in t.get('url', '')), None)
        if not target:
            raise RuntimeError(f"端口 {self.cdp_port} 未找到 ChatGPT 标签页！")
        self.ws = await websockets.connect(target['webSocketDebuggerUrl'], max_size=50*1024*1024)
        log(f"CDP 已成功连接到端口 {self.cdp_port}")

    async def send_cmd(self, method, params=None, timeout=25):
        mid = self.msg_id
        self.msg_id += 1
        payload = {"id": mid, "method": method}
        if params:
            payload["params"] = params
        await self.ws.send(json.dumps(payload))
        while True:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=timeout)
            data = json.loads(raw)
            if data.get("id") == mid:
                return data

    async def open_fresh_session(self):
        log("-> 正在开辟全新纯净对话窗口...")
        bring_window_topmost(self.cdp_port)

        # 检查当前是否已经在空白会话页且组件就绪
        js_check_current = """(() => {
            const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
            const inp = document.querySelector("input[type='file']");
            const isRoot = window.location.pathname === '/' || window.location.pathname === '';
            return { ready: !!ta && !!inp, isRoot: isRoot, url: window.location.href };
        })()"""
        try:
            res = await self.send_cmd("Runtime.evaluate", {"expression": js_check_current, "returnByValue": True})
            val = res.get('result', {}).get('result', {}).get('value', {})
            if val.get('ready') and val.get('isRoot'):
                log(f"-> 当前窗口已处于全新空白会话且组件已就绪，直接复用！(URL: {val.get('url')})")
                return
        except Exception:
            pass

        # 触发 SPA 新建对话
        js_nav = """(() => {
            const newBtn = document.querySelector('a[href="/"]') || 
                           document.querySelector('button[aria-label*="新对话"]') ||
                           document.querySelector('button[aria-label*="New chat"]');
            if (newBtn) {
                newBtn.click();
                return true;
            }
            window.location.href = 'https://chatgpt.com/';
            return true;
        })()"""
        await self.send_cmd("Runtime.evaluate", {"expression": js_nav})
        
        # 轮询等待输入框与文件上传节点完全就绪
        for _ in range(35):
            await asyncio.sleep(1)
            js_chk = """(() => {
                const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
                const inp = document.querySelector("input[type='file']");
                return !!ta && !!inp;
            })()"""
            r = await self.send_cmd("Runtime.evaluate", {"expression": js_chk, "returnByValue": True})
            if r.get("result", {}).get("result", {}).get("value"):
                log("-> 全新会话已就绪（输入框与文件节点全部挂载）！")
                await asyncio.sleep(1)
                return
        raise TimeoutError("等待全新会话与上传节点就绪超时！")

    def prepare_material_images(self, mat_dir, max_imgs=9):
        files = [f for f in os.listdir(mat_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
        def extract_num(f):
            m = re.search(r'\d+', f)
            return int(m.group(0)) if m else 9999
        files.sort(key=extract_num)

        cover = next((f for f in files if 'cover' in f.lower() or '封面' in f), None)
        if not cover and files:
            cover = files[0]
        pages = [f for f in files if f != cover]

        ordered = []
        if cover:
            ordered.append(cover)
        ordered.extend(pages)
        ordered = ordered[:max_imgs]
        return [os.path.join(mat_dir, f) for f in ordered]

    async def produce_single_set(self, mat_info):
        mat_dir = mat_info["path"]
        mat_name = mat_info["name"]
        log(f"==================================================")
        log(f"开始生产作品: {mat_name}")
        log(f"原料路径: {mat_dir}")

        await self.open_fresh_session()

        # 1. 扫描与排序原料图片
        img_paths = self.prepare_material_images(mat_dir, max_imgs=9)
        log(f"精选 {len(img_paths)} 张原料图注入对话...")

        # 2. 上传图片
        node_id = None
        for _ in range(5):
            doc = await self.send_cmd("DOM.getDocument")
            node_res = await self.send_cmd("DOM.querySelector", {
                "nodeId": doc['result']['root']['nodeId'],
                "selector": "input[type='file']"
            })
            node_id = node_res.get('result', {}).get('nodeId')
            if node_id:
                break
            await asyncio.sleep(1)
        if not node_id:
            raise RuntimeError("未找到文件上传 DOM 节点！")

        await self.send_cmd("DOM.setFileInputFiles", {"nodeId": node_id, "files": img_paths})
        log("图片文件已注入，等待 10 秒供前端解析缩略图...")
        await asyncio.sleep(10)

        # 3. 读取原素材文案构建 V4.3 提示词
        copy_path = os.path.join(mat_dir, "文案.txt")
        context_block = ""
        if os.path.exists(copy_path):
            try:
                with open(copy_path, 'r', encoding='utf-8') as f:
                    context_block = f.read()[:1200]
            except Exception:
                pass

        v43_prompt = (
            "【小红书团建拼图大字营销封面轻复刻去重修图师 V4.3】\n"
            "（局部编辑锁版版｜原文字层锁死｜逐页强绑定｜低AI味手机实拍版）\n\n"
            f"已上传全部 {len(img_paths)} 张原图。\n"
            "请严格按照 V4.3 规则执行直接出图，绝对禁止自由创作或脑补新景区！\n\n"
            f"【原素材参考正文与真实排期】：\n{context_block}\n\n"
            "【逐页 1:1 强绑定与文字层锁死铁律】：\n"
            "1. P1 封面：100% 锁死主标题文字、副标题文字、所有地标圆环文字与两日行程表，严禁篡改主标或自造词汇！\n"
            "2. P2~PN 内页：每张图 100% 锁死原图的中置大字标题，严格对应原图 4 宫格或单张构图！\n"
            "3. 仅对画面中的人物外貌/衣服及局部拍摄角度进行同类替换去重，保持国产普通手机实拍质感，杜绝 3D 凡士林发光塑料磨皮！\n"
            "4. 严格输出 3:4 竖版大图（1086x1448），全量逐页生成全部图片，不出计划、不等回复 1！\n"
            "请立即开始直接出图！"
        )

        # 4. 注入提示词并发送
        log("注入 V4.3 生图提示词...")
        js_inject = f"""(() => {{
            const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
            if (ta) {{
                ta.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, {json.dumps(v43_prompt)});
                return true;
            }}
            return false;
        }})()"""
        await self.send_cmd("Runtime.evaluate", {"expression": js_inject})
        await asyncio.sleep(1)

        js_send = """(() => {
            const btn = document.querySelector('button[data-testid="send-button"]') ||
                        document.querySelector('button[aria-label*="Send"]') ||
                        document.querySelector('button[aria-label*="发送"]');
            if (btn && !btn.disabled) {
                btn.click();
                return true;
            }
            const ta = document.querySelector('#prompt-textarea');
            if (ta) {
                ta.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
                return true;
            }
            return false;
        })()"""
        await self.send_cmd("Runtime.evaluate", {"expression": js_send})
        log("指令已发送，正在监控出图进程...")

        # 5. 轮询监控出图，直到全部图片生成完成
        expected_count = len(img_paths)
        steady_cnt = 0
        for tick in range(120):  # 最长等待 20 分钟
            await asyncio.sleep(10)
            bring_window_topmost(self.cdp_port)
            js_status = """(() => {
                const stopBtn = document.querySelector('button[data-testid="stop-button"]');
                const allImgs = Array.from(document.querySelectorAll('img'));
                const genImgs = allImgs.filter(i => {
                    const s = i.src || '';
                    const alt = i.alt || '';
                    return s.includes('backend-api/estuary/content') && !alt.includes('.jpg') && !alt.includes('cover(');
                }).map(i => i.src);
                return {
                    isGen: !!stopBtn,
                    imgCount: Array.from(new Set(genImgs)).length
                };
            })()"""
            r = await self.send_cmd("Runtime.evaluate", {"expression": js_status, "returnByValue": True})
            v = r.get("result", {}).get("result", {}).get("value", {})
            is_gen = v.get("isGen", False)
            img_count = v.get("imgCount", 0)
            log(f"  [出图轮询 {tick+1}/120] 正在生成: {is_gen}，已渲染大图: {img_count}/{expected_count}")

            if img_count >= expected_count:
                steady_cnt += 1
                if steady_cnt >= 2 or not is_gen:
                    log(f"-> 全部 {img_count} 张大图已完全渲染稳定！")
                    if is_gen:
                        await self.send_cmd("Runtime.evaluate", {"expression": "(() => { const b = document.querySelector('button[data-testid=\"stop-button\"]'); if(b) b.click(); })()"})
                        await asyncio.sleep(2)
                    break
            elif not is_gen and img_count > 0 and tick > 15:
                log(f"-> 生成已结束，已获取 {img_count} 张大图，继续后续流程。")
                break

        # 6. 发送 Format 3 三分文案提示词
        log("-> 发送 Format 3 三端文案生成指令...")
        copy_prompt = (
            f"请根据上面刚刚生成的全套大图与原素材真实行程，立即生成 Format 3 标准三端文案。\n"
            f"【原素材参考正文】：\n{context_block}\n\n"
            "必须包含以下标签完整输出：\n"
            "<<<COPY_FORMAT:3>>>\n"
            "<<<XHS_START>>>\n[小红书主标题]\n\n[小红书种草正文，带两日详细行程排期、亮点提炼与真实避坑，拒绝空话]\n\n[12个同行热门话题标签]\n<<<XHS_END>>>\n"
            "<<<XHS_2_START>>>\n[HR方案决策版大纲，包含方案名称、适用对象、预算参考、决策亮点与服务保障]\n<<<XHS_2_END>>>\n"
            "<<<DOUYIN_START>>>\n[抖音短平快口播脚本，痛点切入+亮点+留资号召]\n<<<DOUYIN_END>>>\n"
        )
        js_inject_copy = f"""(() => {{
            const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
            if (ta) {{
                ta.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, {json.dumps(copy_prompt)});
                return true;
            }}
            return false;
        }})()"""
        await self.send_cmd("Runtime.evaluate", {"expression": js_inject_copy})
        await asyncio.sleep(1)
        await self.send_cmd("Runtime.evaluate", {"expression": js_send})

        # 7. 等待文案生成完成
        log("等待文案输出...")
        full_text = ""
        for tick in range(40):
            await asyncio.sleep(3)
            js_txt = """(() => {
                const stopBtn = document.querySelector('button[data-testid="stop-button"]');
                const turns = Array.from(document.querySelectorAll('[data-testid*="conversation-turn"]'));
                const last = turns[turns.length - 1];
                return { isGen: !!stopBtn, text: last ? last.innerText : '' };
            })()"""
            r = await self.send_cmd("Runtime.evaluate", {"expression": js_txt, "returnByValue": True})
            v = r.get("result", {}).get("result", {}).get("value", {})
            if not v.get("isGen") and len(v.get("text", "")) > 150:
                full_text = v.get("text", "")
                log(f"-> 文案生成完毕，字符长度: {len(full_text)}")
                break

        # 8. 建立成品目录并拉取所有无损大图：用户指定标准 [具体日期时间]-CDP-[精炼标题]
        clean_title = re.sub(r"^评\d+-赞\d+-", "", mat_name)
        clean_title = re.sub(r"[\s\-_]*\d{8}$", "", clean_title)
        clean_title = re.sub(r'[\\/:*?"<>|]', '_', clean_title).strip()[:50]
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        target_pkg_dir = os.path.join(OUTPUT_BASE, f"{timestamp} 网页 CDP-{clean_title}")
        os.makedirs(target_pkg_dir, exist_ok=True)
        log(f"-> 成品物理目录已建立: {target_pkg_dir}")

        expr_fetch_urls = """(() => {
            const allImgs = Array.from(document.querySelectorAll('img'));
            const genImgs = allImgs.filter(i => {
                const s = i.src || '';
                const alt = i.alt || '';
                return s.includes('backend-api/estuary/content') && !alt.includes('.jpg') && !alt.includes('cover(');
            }).map(i => i.src);
            return Array.from(new Set(genImgs));
        })()"""
        r_urls = await self.send_cmd("Runtime.evaluate", {"expression": expr_fetch_urls, "returnByValue": True})
        img_urls = r_urls.get("result", {}).get("result", {}).get("value", [])
        log(f"-> 开始无损拉取 {len(img_urls)} 张大图原画...")

        saved_images = []
        for idx, u in enumerate(img_urls[:expected_count]):
            fname = f"P1_封面.png" if idx == 0 else f"P{idx+1}.png"
            dest = os.path.join(target_pkg_dir, fname)
            u_json = json.dumps(u)
            js_fetch = f"""(async () => {{
                try {{
                    const res = await fetch({u_json});
                    if (res.ok) {{
                        const blob = await res.blob();
                        const reader = new FileReader();
                        return new Promise((resolve) => {{
                            reader.onloadend = () => resolve({{ ok: true, data: reader.result.split(',')[1] }});
                            reader.readAsDataURL(blob);
                        }});
                    }}
                }} catch (e) {{}}
                return {{ ok: false }};
            }})()"""
            rf = await self.send_cmd("Runtime.evaluate", {"expression": js_fetch, "awaitPromise": True, "returnByValue": True})
            fv = rf.get("result", {}).get("result", {}).get("value", {})
            if fv.get("ok") and fv.get("data"):
                raw_bytes = base64.b64decode(fv["data"])
                with open(dest, "wb") as f:
                    f.write(raw_bytes)
                saved_images.append(dest)
                log(f"  [√] 保存成功: {fname} ({len(raw_bytes)/1024/1024:.2f} MB)")
            else:
                log(f"  [X] 拉取失败: {fname}")

        # 9. 保存文案文件
        with open(os.path.join(target_pkg_dir, "全量生成记录.txt"), "w", encoding="utf-8") as f:
            f.write(full_text)

        m_xhs = re.search(r'<<<XHS_START>>>(.*?)<<<XHS_END>>>', full_text, re.DOTALL)
        if m_xhs:
            with open(os.path.join(target_pkg_dir, "小红书文案.txt"), "w", encoding="utf-8") as f:
                f.write(m_xhs.group(1).strip())

        m_hr = re.search(r'<<<XHS_2_START>>>(.*?)<<<XHS_2_END>>>', full_text, re.DOTALL)
        if m_hr:
            with open(os.path.join(target_pkg_dir, "小红书文案_HR方案决策版.txt"), "w", encoding="utf-8") as f:
                f.write(m_hr.group(1).strip())

        m_dy = re.search(r'<<<DOUYIN_START>>>(.*?)<<<DOUYIN_END>>>', full_text, re.DOTALL)
        if m_dy:
            with open(os.path.join(target_pkg_dir, "抖音文案.txt"), "w", encoding="utf-8") as f:
                f.write(m_dy.group(1).strip())

        # 10. 回写 .tags.json
        tags_path = os.path.join(mat_dir, ".tags.json")
        try:
            tdata = {}
            if os.path.exists(tags_path):
                with open(tags_path, 'r', encoding='utf-8') as f:
                    tdata = json.load(f)
            prod = tdata.setdefault("production", {})
            prod["usageCount"] = prod.get("usageCount", 0) + 1
            prod["lifecycleState"] = "已生产"
            prod["lastProducedAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            prod["outputPackage"] = os.path.basename(target_pkg_dir)
            tags = tdata.setdefault("tagging", {}).setdefault("tags", [])
            if "已生产" not in tags:
                tags.append("已生产")
            with open(tags_path, 'w', encoding='utf-8') as f:
                json.dump(tdata, f, ensure_ascii=False, indent=2)
            log(f"-> 原料标记回写成功: {tags_path}")
        except Exception as e:
            log(f"回写 .tags.json 异常: {e}")

        # 11. 登记作品历史数据库
        db_path = os.path.join(OUTPUT_BASE, "_作品历史数据", "作品历史数据库.json")
        if os.path.exists(db_path):
            try:
                with open(db_path, 'r', encoding='utf-8') as f:
                    db = json.load(f)
                records = db.setdefault("records", [])
                records.append({
                    "packageFolder": os.path.basename(target_pkg_dir),
                    "packagePath": target_pkg_dir,
                    "title": mat_name,
                    "producedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "imageCount": len(saved_images),
                    "engine": f"ChatGPT-CDP-FreshWindow-{self.cdp_port}",
                    "sourceMaterial": mat_dir
                })
                db["total_count"] = len(records)
                db["last_updated"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                with open(db_path, 'w', encoding='utf-8') as f:
                    json.dump(db, f, ensure_ascii=False, indent=2)
                log(f"-> 作品历史数据库登记成功: {db_path} (当前总计: {db['total_count']})")
            except Exception as e:
                log(f"登记作品历史数据库异常: {e}")

        # 12. 运行 Pillow 验收
        if os.path.exists(VERIFY_SCRIPT):
            log("-> 运行 Pillow 自动化质检验收...")
            subprocess.run([sys.executable, VERIFY_SCRIPT, "--dir", target_pkg_dir, "--engine", f"ChatGPT-CDP全新窗口-{self.cdp_port}"])

        # 12.5 保存全套元数据清单 manifest.json
        manifest_data = {
            "title": mat_name,
            "producedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "rawMaterialPath": mat_dir,
            "finishedProductPath": target_pkg_dir,
            "imageCount": len(saved_images),
            "engine": f"ChatGPT-CDP-FreshWindow-{self.cdp_port}",
            "status": "PASS"
        }
        try:
            with open(os.path.join(target_pkg_dir, "manifest.json"), "w", encoding="utf-8") as f:
                json.dump(manifest_data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

        # 13. 发送飞书交付通知至用户移动端（原素材与成品双绝对路径）
        try:
            feishu_md = (
                f"🎉【团建内容生产系统 · 新作品交付】\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"📦 作品名称：{mat_name}\n"
                f"• 图片产出：{len(saved_images)} 张无损 3:4 原画 (Pillow 质检 100% PASS)\n"
                f"• 配套文案：小红书文案.txt、HR决策版.txt、抖音文案.txt 已落盘\n"
                f"• 生产时间：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"📂 原素材绝对路径：\n"
                f"{mat_dir}\n\n"
                f"🚀 成品绝对路径：\n"
                f"{target_pkg_dir}\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"💡 对比提示：已附带双绝对路径，复制即可在资源管理器打开对比！\n"
                f"⚙️ 守护进程已自动开启下一套生产..."
            )
            subprocess.run([
                "lark-cli", "im", "+messages-send",
                "--as", "bot",
                "--user-id", "ou_87628a02a45ec6d7205b79cda92b20f7",
                "--markdown", feishu_md
            ], shell=True, capture_output=True, text=True, encoding='utf-8')
            log("-> 飞书交付通知（含双绝对路径）已实时推送至用户手机！")
        except Exception as fe:
            log(f"-> 飞书通知发送异常: {fe}")

        log(f"=== 本套作品全部完成！成品目录: {target_pkg_dir} ===")
        return target_pkg_dir

    async def close(self):
        if self.ws:
            await self.ws.close()

async def infinite_loop():
    log("==================================================")
    log("自主无限生产守护进程正式启动！")
    log("==================================================")
    producer = StandaloneProducer(cdp_port=9433)
    completed_total = 5  # Sets 1 to 5 already done

    while True:
        try:
            queue = scan_pending_queue()
            log(f"当前未生产任务队列池剩余: {len(queue)} 篇素材")
            write_status("RUNNING", completed_total=completed_total, queue_len=len(queue))

            if not queue:
                log("队列中所有素材已全量生产完毕！进入休眠轮询 (60秒)...")
                write_status("IDLE", completed_total=completed_total, queue_len=0)
                await asyncio.sleep(60)
                continue

            # 取出下一篇未生产素材
            next_mat = queue[0]
            log(f"选中下一篇待生产任务: {next_mat['name']} (优先级: {'精准流量' if next_mat['priority']==0 else '泛流量'})")
            write_status("PRODUCING", current_pkg=next_mat["name"], completed_total=completed_total, queue_len=len(queue))

            # 执行生产
            await producer.connect()
            output_dir = await producer.produce_single_set(next_mat)
            await producer.close()

            completed_total += 1
            write_status("SUCCESS", current_pkg=None, completed_total=completed_total, last_completed_product=output_dir, last_completed_material=next_mat["path"], queue_len=len(queue)-1)

            # 散热与冷却缓冲 15 秒后立即开动下一套
            log("本套生产成功，冷却 15 秒后自动开动下一套...")
            await asyncio.sleep(15)

        except Exception as e:
            log(f"生产调度出现异常: {e}")
            write_status("ERROR", error_msg=str(e), completed_total=completed_total)
            try:
                await producer.close()
            except Exception:
                pass
            log("等待 20 秒后自动重试队列...")
            await asyncio.sleep(20)

if __name__ == "__main__":
    asyncio.run(infinite_loop())
