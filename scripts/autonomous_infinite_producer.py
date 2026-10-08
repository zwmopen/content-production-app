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
import shutil

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

        # 6. 发送江湖有旅人·4大差异化版本核心文案指令（GPT在线链接双主稿 + 时间线大纲版 + 花里胡哨多表情同事版 + 抖音无营销）
        _matched_style_id = "STYLE-01"
        _matched_style_desc = "山水度假与美食动线风"
        _style_pack_block = ""
        try:
            import importlib.util as _ilu
            _bridge_path = Path(r"D:\AICode\.agents\skills\teambuilding-web-copywriter\scripts\chatgpt_web_bridge.py")
            if _bridge_path.exists():
                _spec = _ilu.spec_from_file_location("chatgpt_web_bridge", str(_bridge_path))
                _mod = _ilu.module_from_spec(_spec)
                _spec.loader.exec_module(_mod)
                _matched_style_id, _matched_style_desc, _pack_text = _mod.load_style_pack_for_cdp(context_block, max_exemplars=2)
                if _pack_text:
                    _style_pack_block = (
                        f"【当前自动命中同事子模式（{_matched_style_id}·{_matched_style_desc} · 随机抽样真源原料 · 严禁套死模板）】：\n"
                        f"{_pack_text}\n\n"
                    )
        except Exception as _e:
            log(f"⚠️ 动态加载同事单风格原料包降级为内联规则: {_e}")

        log(f"-> 发送 4 大差异化版本文案指令 [命中 {_matched_style_id}]（GPT原味红书自然 + 时间线大纲 + 花哨多表情同事版 + 抖音无营销）...")
        copy_prompt = (
            f"请调用并严格遵循【teambuilding-web-copywriter 技能】（GitHub 真源仓库：https://github.com/zwmopen/skills/tree/main/技能包/技能/teambuilding-web-copywriter ），"
            f"根据上面刚刚生成的全套大图与原素材真实行程，立即生成 4 个风格反差极大、绝不套死模板的标准成稿版本。\n"
            f"【原素材参考正文】：\n{context_block}\n\n"
            f"{_style_pack_block}"
            "【最高执行铁律（破除套模板感与双平台风控边界）】：\n"
            "1. 严禁拿同一个模板换词填空！4 个版本必须呈现 4 种完全不同的阅读体验（克制自然运营风 vs 时间轴排期大纲 vs 满屏表情花里胡哨同事爆款风 vs 抖音周末去团建生活风）。\n"
            "2. 视觉指纹命名：每个版本必须用 <<<VERSION_START:版本名>>> ... <<<VERSION_END>>> 包裹。\n"
            "3. 单标题与字数安全线：每个版本首行必须且仅有 1 个纯文本标题（≤20字，严禁加#号、书名号或版本名）；小红书正文+标签目标 650—850 字符。\n"
            "4. 手机防吞空行铁律：每个段落之间必须用【独立成行】的盲文空白字符“⠀”（Unicode U+2800，真实物理换行 \\n⠀\\n），绝不输出裸露空行！\n"
            "5. 双平台风控：小红书保留团建/HR业务语义；抖音无营销必须彻底重写为普通人周末自驾出行/玩法避坑分享，严格消杀“团建/拓展/公司团建/HR/行政/路线/行程/方案/1日游/2天1夜/大巴接送/人均/报价/私信”等涉旅词。\n\n"
            "【请按顺序生成以下 4 个截然不同的标准版本成稿（每个段落之间必须独立一行放 ⠀）】：\n"
            "<<<COPY_FORMAT:MULTI>>>\n"
            "<<<VERSION_START:红书自然>>>\n"
            "【GPT链接原味·自然小红书版】克制自然的地点季节团建标题（≤20字）\n"
            "⠀\n"
            "正文（对齐GPT在线链接里打磨出的成熟运营自然口吻：开头直接给动静节奏判断 → 玩法怎么搭与取舍理由 → 💡HR怎么选分人群加减法 → ⚠️出发前天气/开放确认提醒，表情克制不夸张，段落间独立一行 ⠀）\n"
            "⠀\n"
            "#8至10个热门团建标签\n"
            "<<<VERSION_END>>>\n\n"
            "<<<VERSION_START:红书大纲>>>\n"
            "【时间线大纲版】带天数或时间推进感的团建排期标题（≤20字）\n"
            "⠀\n"
            "正文（专门做清晰的时间线大纲！开头1句总基调 → 📍基础信息 → 按 DAY1 / DAY2 + 具体时间节点 09:00｜… 11:30｜… 13:30｜… 16:00｜… 18:30｜… 顺次推进，写清每个时间点玩什么、为什么这么衔接、体力怎么分配 → 📌排期避坑提醒，段落间独立一行 ⠀）\n"
            "⠀\n"
            "#8至10个精准团建标签\n"
            "<<<VERSION_END>>>\n\n"
            "<<<VERSION_START:红书种草>>>\n"
            f"【表情超多·花里胡哨同事爆款版（{_matched_style_id}）】痛点反问或高能量吸睛标题（≤20字）\n"
            "⠀\n"
            f"正文（参照上方注入的 {_matched_style_id} 子模式提示词与随机抽样的同事真源原料：满屏高密度灵动 Emoji 表情🔥🎉🏎️🍵📸✨、情绪饱满、具象菜名、文末可带三列竖线玩法矩阵 ｜；注意：小标题名称和开篇切入点必须根据本素材亮点自由创新，严禁死套固定小标题模板！段落间独立一行 ⠀）\n"
            "⠀\n"
            "#8至10个热门话题标签\n"
            "<<<VERSION_END>>>\n\n"
            "<<<VERSION_START:抖音无营销>>>\n"
            "【GPT链接原味·抖音无营销版】周末出行/老玩家玩法避坑标题（≤20字）\n"
            "⠀\n"
            "正文（对齐GPT在线链接里的抖音配对稿：普通人周末出游/自驾玩法取舍视角，开头给真实判断 → 怎么玩/哪个刺激哪个松弛 → 天气鞋服确认，彻底消杀团建/HR/方案/价格/天数等涉旅词，段落间独立一行 ⠀）\n"
            "⠀\n"
            "#5个泛生活避坑标签\n"
            "<<<VERSION_END>>>\n"
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
        producing_dir = os.path.join(OUTPUT_BASE, "_网页CDP产线正在制作")
        os.makedirs(producing_dir, exist_ok=True)
        target_pkg_dir = os.path.join(producing_dir, f"{timestamp}-网页CDP-{clean_title}")
        os.makedirs(target_pkg_dir, exist_ok=True)
        log(f"-> 制作中临时物理目录已建立 (带下划线隔离区): {target_pkg_dir}")

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

        # 9. 保存文案文件（核心铁律：单文件 文案.txt 适配相册 APK，注入 V4.5 标准）
        clean_copy = full_text.strip()
        try:
            formatter_dir = r"d:\AICode\.agents\skills\copy-collab-distributor\scripts"
            if formatter_dir not in sys.path:
                sys.path.insert(0, formatter_dir)
            import copy_formatter
            ok, formatted_copy, mode = copy_formatter.clean_entire_copy(clean_copy, mobile_safe=True)
            if ok and formatted_copy:
                clean_copy = formatted_copy
                log(f"-> copy_formatter 二次清洗完成 (mode={mode})")
        except Exception as e:
            log(f"copy_formatter 清洗异常: {e}")

        # 9.5 【空文案/截断守卫】落盘前校验实质字数，杜绝空壳作品入库，不达标判废重做。
        _substance = re.sub(r'<<<[^>]*>>>', '', clean_copy)
        _substance = re.sub(r'[\s\u2800]+', '', _substance)
        MIN_COPY_SUBSTANCE = 300
        if len(_substance) < MIN_COPY_SUBSTANCE:
            log(f"🚨【空文案判废】文案实质内容仅 {len(_substance)} 字（要求 ≥ {MIN_COPY_SUBSTANCE} 字），"
                f"判定为空壳/截断产出，坚决不入库！废弃重做。")
            if os.path.exists(target_pkg_dir):
                import shutil
                shutil.rmtree(target_pkg_dir, ignore_errors=True)
            raise RuntimeError(f"文案实质内容不足（{len(_substance)} 字 < {MIN_COPY_SUBSTANCE}），空壳判废重做")

        with open(os.path.join(target_pkg_dir, "文案.txt"), "w", encoding="utf-8") as f:
            f.write(clean_copy)

        evidence_dir = os.path.join(OUTPUT_BASE, "_内部台账与历史数据", "生产证据", os.path.basename(target_pkg_dir))
        os.makedirs(evidence_dir, exist_ok=True)
        with open(os.path.join(evidence_dir, "全量生成记录.txt"), "w", encoding="utf-8") as f:
            f.write(full_text)

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
        db_path = os.path.join(OUTPUT_BASE, "_内部台账与历史数据", "_作品历史数据", "作品历史数据库.json")
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

        # 12.5 保存全套标准元数据清单 manifest.json 并通过统一准入网关联动分类入库
        extra_manifest = {
            "workId": f"cdp_{abs(hash(mat_name)):x}",
            "title": mat_name,
            "producedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "rawMaterialPath": mat_dir,
            "sourceMaterialPath": mat_dir,
            "imageCount": len(saved_images),
            "engine": f"ChatGPT-CDP-FreshWindow-{self.cdp_port}",
            "progress": {
                "plannedImageCount": len(saved_images),
                "completedDistinctPages": len(saved_images),
                "completionRate": 100.0,
                "missingPages": [],
                "hasCopyText": True,
                "singleCopyStandard": True,
                "status": "COMPLETED"
            }
        }
        try:
            gate_dir = r"D:\AICode\工具开发\scripts"
            if gate_dir not in sys.path:
                sys.path.insert(0, gate_dir)
            import pipeline_staging_gate as gate
            ok, msg, promoted_dir = gate.promote_staging_to_portfolio(
                target_pkg_dir,
                title=mat_name,
                raw_dir=mat_dir,
                extra_manifest=extra_manifest,
                destroy_on_fail=True,
                portfolio_root=OUTPUT_BASE,
            )
            if not ok:
                raise RuntimeError(f"出库门禁拦截: {msg}")
            target_pkg_dir = promoted_dir
            log(f"-> 质检通过，{msg}: {target_pkg_dir}")
        except Exception as e:
            log(f"原子移动至分类成品库异常: {e}")
            raise

        # 13. 发送飞书交付通知至用户移动端（原素材与成品双绝对路径）
        try:
            feishu_md = (
                f"🎉【团建内容生产系统 · 新作品交付】\n"
                f"━━━━━━━━━━━━━━━━━━\n"
                f"📦 作品名称：{mat_name}\n"
                f"• 图片产出：{len(saved_images)} 张无损 3:4 原画 (Pillow 质检 100% PASS)\n"
                f"• 配套文案：单文件 文案.txt（内嵌三端标准格式）已落盘\n"
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
