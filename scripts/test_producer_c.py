# -*- coding: utf-8 -*-
"""
====================================================================
江湖有旅人 · 测试版 C (Test Producer for Instance C · Port 9433)
====================================================================
专供用户单套受控测试与风控防御验证（仅接管实例 C · 端口 9433，绝不触碰实例 A）

核心升级（严格落实用户最新铁律）：
1. 【完整大图出图（拒绝精简阉割）】：100% 保留素材全量图片（8~10张完整原图，逐页复刻）；
2. 【生成大图双重守门（3小时安全线40张/硬顶50张 + 全天安全线180张/硬顶200张）】：
   - 严格维护 generation_quota_ledger.json，以实际产出落地的高清大图为统计基准（不限上传，严格控生成）；
   - 若近 3 小时累计已生成达 40 张，或今日累计已达 180 张，坚决不开辟新笔记，优雅停下等待；
   - 单套冲刺原则：开辟前若未达 40 张，放行完整跑完本套（允许单套冲刺至 45~50 张），落地后入账并停下；
3. 【物理级硬核上传门禁】：通过精准选择器探测真实 blob 缩略图与移除按钮，
   若真实挂载为 0 或平台报限流错误，100% 物理阻断发送指令，绝不空跑纯文本；
4. 【异常素材物理隔离机制】：凡遭遇模型拒答、图片破损或格式冲突的素材，
   直接自动移入【_异常素材（脚本失败隔离）】专属目录，彻底根除双机抢跑死循环！
5. 【会话内连环追问驱动】：首轮上传后，在同一会话内连续追问出图，不频繁开新会话；
6. 【单封面残次品物理熔断】：若出图停滞且大图数 < 4 张，坚决拒绝入库，绝不回写已生产！
====================================================================
"""
import os
import sys
import json
import time
import re
import datetime
import urllib.request
import asyncio
import websockets
import base64
import ctypes
import shutil
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')

# ================= 基础路径配置 =================
PROJECT_ROOT = r"D:\AICode"
MATERIAL_ROOT = os.path.join(PROJECT_ROOT, r"项目推进\projects\江湖有旅人\主项目\01-素材库")
AUTUMN_DIR = os.path.join(MATERIAL_ROOT, r"秋季（9—11月·智能分类）")
ABNORMAL_DIR = os.path.join(MATERIAL_ROOT, r"_异常素材（脚本失败隔离）")
OUTPUT_BASE = os.path.join(PROJECT_ROOT, r"项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）")
DATA_DIR = os.path.join(OUTPUT_BASE, "_作品历史数据")
DB_PATH = os.path.join(DATA_DIR, "作品历史数据库.json")
RUNTIME_DIR = os.path.join(PROJECT_ROOT, r"运行数据\江湖有旅人\内容生产App")
LOG_FILE = os.path.join(RUNTIME_DIR, "test_producer_c.log")
QUOTA_LEDGER_FILE = os.path.join(RUNTIME_DIR, "generation_quota_ledger.json")

CDP_PORT = 9433  # 仅接管实例 C
MAX_3H_GEN_LIMIT = 40      # 3 小时生成大图安全停下阈值（硬顶 50 张）
MAX_DAILY_GEN_LIMIT = 180  # 全天每日生图安全停下阈值（硬顶 200 张，预留 20 张隔离带）

user32 = ctypes.windll.user32
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def log(msg):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [测试版C] {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

def bring_window_topmost():
    try:
        def enum_proc(hwnd, lParam):
            if user32.IsWindowVisible(hwnd):
                length = user32.GetWindowTextLengthW(hwnd)
                if length > 0:
                    buff = ctypes.create_unicode_buffer(length + 1)
                    user32.GetWindowTextW(hwnd, buff, length + 1)
                    title = buff.value
                    if any(k in title for k in ['4333', '实例 C', '9433', 'ChatGPT']):
                        user32.ShowWindow(hwnd, 9)
                        user32.SetForegroundWindow(hwnd)
            return True
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)
        user32.EnumWindows(WNDENUMPROC(enum_proc), 0)
    except Exception:
        pass

# ================= 生成配额双重守门体系（3小时滑动窗口40张 + 全天180张） =================
def load_generation_ledger():
    if os.path.exists(QUOTA_LEDGER_FILE):
        try:
            with open(QUOTA_LEDGER_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {"records": []}

def save_generation_ledger(ledger):
    try:
        os.makedirs(os.path.dirname(QUOTA_LEDGER_FILE), exist_ok=True)
        with open(QUOTA_LEDGER_FILE, 'w', encoding='utf-8') as f:
            json.dump(ledger, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log(f"保存生图配额账本异常: {e}")

def check_generation_quota(instance_id="C"):
    """
    双重生成配额安全守门：
    1. 3小时滑动窗口已生成大图是否达到 40 张（硬顶 50 张）；
    2. 全天当日累计生成大图是否达到 180 张（硬顶 200 张）。
    返回: (is_allowed: bool, reason: str, wait_seconds: int, stats: dict)
    """
    ledger = load_generation_ledger()
    now_epoch = time.time()
    three_hours_ago = now_epoch - (3 * 3600)
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")

    records = ledger.get("records", [])
    # 1. 过滤近 3 小时内该实例的生成记录
    records_3h = [
        r for r in records
        if r.get("instance_id") == instance_id and r.get("epoch", 0) >= three_hours_ago
    ]
    gen_3h = sum(r.get("generated_count", 0) for r in records_3h)

    # 2. 过滤今日该实例的生成记录
    records_today = [
        r for r in records
        if r.get("instance_id") == instance_id and r.get("timestamp", "").startswith(today_str)
    ]
    gen_today = sum(r.get("generated_count", 0) for r in records_today)

    stats = {
        "gen_3h": gen_3h,
        "max_3h": MAX_3H_GEN_LIMIT,
        "gen_today": gen_today,
        "max_today": MAX_DAILY_GEN_LIMIT
    }

    # 检查 3 小时窗口
    if gen_3h >= MAX_3H_GEN_LIMIT:
        earliest_epoch = min((r.get("epoch", now_epoch) for r in records_3h), default=now_epoch)
        wait_seconds = max(10, int((earliest_epoch + 3 * 3600) - now_epoch))
        return False, f"近 3 小时已生成 {gen_3h} 张大图（达安全上限 {MAX_3H_GEN_LIMIT} 张）", wait_seconds, stats

    # 检查全天窗口
    if gen_today >= MAX_DAILY_GEN_LIMIT:
        # 等到次日凌晨
        tomorrow = (datetime.datetime.now() + datetime.timedelta(days=1)).replace(hour=0, minute=5, second=0)
        wait_seconds = max(60, int((tomorrow - datetime.datetime.now()).total_seconds()))
        return False, f"今日已累计生成 {gen_today} 张大图（达全天安全巡航线 {MAX_DAILY_GEN_LIMIT} 张）", wait_seconds, stats

    return True, "放行开工", 0, stats

def record_generation_success(instance_id, gen_count, upload_count, mat_name):
    """记录一次成功的完整作品落地"""
    ledger = load_generation_ledger()
    now_dt = datetime.datetime.now()
    ledger.setdefault("records", []).append({
        "instance_id": instance_id,
        "timestamp": now_dt.strftime("%Y-%m-%d %H:%M:%S"),
        "epoch": time.time(),
        "generated_count": gen_count,
        "uploaded_count": upload_count,
        "material_name": mat_name
    })
    # 清理 48 小时前的陈旧数据
    two_days_ago = time.time() - (48 * 3600)
    ledger["records"] = [r for r in ledger["records"] if r.get("epoch", 0) >= two_days_ago]
    save_generation_ledger(ledger)
    log(f"📊【配额记账】实例 {instance_id} 成功落地 {gen_count} 张大图（上传 {upload_count} 张），已同步双重配额账本！")

# ================= 异常素材物理隔离 =================
def isolate_abnormal_material(mat_dir, reason="模型拒答或上传异常"):
    """将问题素材彻底移出生产目录，移入 _异常素材（脚本失败隔离）"""
    try:
        os.makedirs(ABNORMAL_DIR, exist_ok=True)
        base_name = os.path.basename(mat_dir)
        parent_name = os.path.basename(os.path.dirname(mat_dir))
        dest_dir = os.path.join(ABNORMAL_DIR, f"{parent_name}_{base_name}")

        log(f"🚨【物理隔离触发】正在将异常素材移出生产队列: {base_name}")
        log(f"   原因: {reason}")
        log(f"   目标隔离目录: {dest_dir}")

        if os.path.exists(dest_dir):
            shutil.rmtree(dest_dir, ignore_errors=True)
        shutil.move(mat_dir, dest_dir)

        # 更新 .tags.json
        tags_file = os.path.join(dest_dir, ".tags.json")
        if os.path.exists(tags_file):
            with open(tags_file, 'r', encoding='utf-8') as f:
                tdata = json.load(f)
            tdata.setdefault("production", {})["lifecycleState"] = "生产异常"
            tdata["production"]["failureReason"] = reason
            tdata["production"]["isolatedAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            tags = tdata.setdefault("tagging", {}).setdefault("tags", [])
            if "生产异常" not in tags:
                tags.append("生产异常")
            with open(tags_file, 'w', encoding='utf-8') as f:
                json.dump(tdata, f, ensure_ascii=False, indent=2)

        log("✅ 素材已成功物理隔离，队列彻底净化，永不再产生抢跑死循环！")
        return dest_dir
    except Exception as e:
        log(f"隔离素材异常: {e}")
        return None

def pick_test_material(specified_path=None):
    """挑选供测试的素材（若指定则使用指定，否则挑选 1 套未生产的秋季素材）"""
    if specified_path and os.path.exists(specified_path):
        imgs = [f for f in os.listdir(specified_path) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
        if len(imgs) >= 3:
            return {"name": os.path.basename(specified_path), "path": specified_path, "count": len(imgs)}

    for root, dirs, files in os.walk(AUTUMN_DIR):
        if "_异常素材" in root or "_待补全" in root:
            continue
        imgs = [f for f in files if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
        if 5 <= len(imgs) <= 20:
            tags_file = os.path.join(root, ".tags.json")
            state = "待生产"
            if os.path.exists(tags_file):
                try:
                    with open(tags_file, "r", encoding="utf-8") as f:
                        d = json.load(f)
                    state = d.get("production", {}).get("lifecycleState", "待生产")
                    tags = d.get("tagging", {}).get("tags", [])
                    if "已生产" in tags or "生产异常" in tags:
                        state = "已排除"
                except Exception:
                    pass
            if state in ["待生产", "未生产"]:
                return {"name": os.path.basename(root), "path": root, "count": len(imgs)}

    return None

class TestProducerC:
    def __init__(self, port=CDP_PORT):
        self.port = port
        self.cdp_list_url = f"http://127.0.0.1:{port}/json/list"
        self.ws = None
        self.msg_id = 1

    async def connect(self):
        log(f"正在探测端口 {self.port} 的 CDP 调试端点...")
        try:
            with opener.open(self.cdp_list_url, timeout=5) as r:
                targets = json.loads(r.read().decode())
        except Exception as e:
            raise RuntimeError(f"无法连接到端口 {self.port}，请确认 Chrome 实例 C 是否已启动: {e}")

        page = next((t for t in targets if 'chatgpt.com' in t.get('url', '') and t.get('type') == 'page'), None)
        if not page:
            raise RuntimeError(f"端口 {self.port} 未找到已打开 ChatGPT 的网页！")

        self.ws = await websockets.connect(page['webSocketDebuggerUrl'], max_size=60*1024*1024)
        log(f"✅ CDP 连接成功！当前页面: {page['url']}")

    async def send_cmd(self, method, params=None, timeout=35):
        mid = self.msg_id
        self.msg_id += 1
        payload = {"id": mid, "method": method, "params": params or {}}
        await self.ws.send(json.dumps(payload))
        while True:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=timeout)
            data = json.loads(raw)
            if data.get("id") == mid:
                return data

    async def prepare_clean_session(self):
        """确保会话处于准备就绪状态（若已有残留对话则平滑点开新会话）"""
        log("检查当前会话窗口状态...")
        bring_window_topmost()

        js_check = """(() => {
            const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
            const inp = document.querySelector("input[type='file']");
            const assts = document.querySelectorAll('[data-message-author-role="assistant"]');
            const isBlank = window.location.pathname === '/' || assts.length === 0;
            // 清理可能残留的附件图
            const removeBtns = document.querySelectorAll('button[aria-label*="移除"], button[aria-label*="Remove"], button[aria-label*="删除"], button[data-testid*="remove-attachment"]');
            removeBtns.forEach(b => b.click());
            return { ready: !!ta && !!inp, isBlank: isBlank, url: window.location.href };
        })()"""
        r = await self.send_cmd("Runtime.evaluate", {"expression": js_check, "returnByValue": True})
        v = r.get("result", {}).get("result", {}).get("value", {})

        if v.get("ready") and v.get("isBlank"):
            log("-> 当前会话已是全新空白窗口，组件完整就绪，直接复用！")
            return

        log("-> 当前窗口有历史对话，正在触发平滑新建会话...")
        js_click_new = """(() => {
            const links = Array.from(document.querySelectorAll('a[href="/"]'));
            const newChatBtn = links.find(a => a.innerText.includes('新聊天') || a.innerText.includes('New chat') || a.getAttribute('aria-label') === '新聊天');
            if (newChatBtn) { newChatBtn.click(); return 'CLICKED_LINK'; }
            const penBtn = document.querySelector('button[aria-label*="新聊天"]') || document.querySelector('button[aria-label*="New chat"]');
            if (penBtn) { penBtn.click(); return 'CLICKED_BUTTON'; }
            window.location.href = 'https://chatgpt.com/';
            return 'NAVIGATED';
        })()"""
        await self.send_cmd("Runtime.evaluate", {"expression": js_click_new})

        for attempt in range(25):
            await asyncio.sleep(1)
            rc = await self.send_cmd("Runtime.evaluate", {"expression": js_check, "returnByValue": True})
            vc = rc.get("result", {}).get("result", {}).get("value", {})
            if vc.get("ready"):
                log("-> 全新会话已就绪！")
                await asyncio.sleep(1)
                return
        raise TimeoutError("等待全新会话就绪超时！")

    def prepare_full_material_images(self, mat_dir, max_count=20):
        """
        【完整原图提取（支持 5~20 张画册级作品）】
        提取素材全量有效图片（封面 1 张 + 全部内页，最高 20 张完整大图）
        """
        files = [f for f in os.listdir(mat_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
        def extract_num(f):
            m = re.search(r'\d+', f)
            return int(m.group(0)) if m else 9999
        files.sort(key=extract_num)

        cover = next((f for f in files if 'cover' in f.lower() or '封面' in f), None)
        if not cover and files:
            cover = files[0]

        inners = [f for f in files if f != cover]
        selected = ([cover] if cover else []) + inners
        selected = selected[:max_count]

        valid_paths = []
        for f in selected:
            fp = os.path.join(mat_dir, f)
            try:
                with Image.open(fp) as im:
                    fmt = getattr(im, 'format', '')
                    if fmt == 'HEIF' or fp.lower().endswith(('.heic', '.heif')):
                        im.convert('RGB').save(fp, 'JPEG', quality=95)
                        log(f"   [格式清洗] 成功将 HEIC 图片转存为标准 JPEG: {f}")
                valid_paths.append(fp)
            except Exception as e:
                log(f"⚠️ 剔除破损图片文件 {f}: {e}")
        return valid_paths

    async def upload_with_strict_gate(self, img_paths):
        """
        【物理级硬核上传门禁】
        精准检测 file-tile、blob: / estuary/content 缩略图与移除按钮。
        若 35 秒内真实挂载为 0 或平台报限流错误，100% 物理阻断，绝不发送生图指令！
        """
        log(f"【上传门禁】向对话框注入 {len(img_paths)} 张完整原料图...")
        node_id = None
        for _ in range(5):
            doc = await self.send_cmd("DOM.getDocument", {"depth": -1, "pierce": True})
            root_id = doc.get('result', {}).get('root', {}).get('nodeId', 1)
            for sel in ["input#upload-files", "form input[type='file']:not([disabled])", "input[type='file']"]:
                node_res = await self.send_cmd("DOM.querySelector", {"nodeId": root_id, "selector": sel})
                nid = node_res.get('result', {}).get('nodeId')
                if nid and nid > 0:
                    node_id = nid
                    break
            if node_id:
                break
            await asyncio.sleep(1)

        if not node_id:
            raise RuntimeError("❌ 未找到文件上传 DOM 节点！")

        await self.send_cmd("DOM.setFileInputFiles", {"nodeId": node_id, "files": img_paths})
        js_dispatch = """(() => {
            const inp = document.querySelector('input#upload-files') || document.querySelector('form input[type="file"]:not([disabled])');
            if (inp) {
                inp.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                inp.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                return true;
            }
            return false;
        })()"""
        await self.send_cmd("Runtime.evaluate", {"expression": js_dispatch})

        log("文件注入已触发，正在进行缩略图真实挂载探测（物理门禁审核中）...")
        attached_count = 0
        has_error = False
        error_text = ""

        for sec in range(1, 35):
            await asyncio.sleep(1)
            js_audit = """(() => {
                const tiles = Array.from(document.querySelectorAll('form div[class*="group/file-tile"], form [role="group"][aria-label*="."]'));
                const imgs = Array.from(document.querySelectorAll('form img[src^="blob:"], form img[src*="estuary/content"]'));
                const removeBtns = Array.from(document.querySelectorAll('button[aria-label*="移除"], button[aria-label*="Remove"], button[aria-label*="删除"], button[data-testid*="remove-attachment"]'));
                const alerts = Array.from(document.querySelectorAll('[role="alert"], div[class*="error"], div[class*="danger"]'));
                const errText = alerts.map(a => a.innerText).join(' ');
                
                return {
                    tileCount: tiles.length,
                    imgCount: imgs.length,
                    removeCount: removeBtns.length,
                    errorDetected: errText.includes('上传失败') || errText.includes('Upload failed') || errText.includes('超出') || errText.includes('too large'),
                    errorMsg: errText.slice(0, 100)
                };
            })()"""
            r = await self.send_cmd("Runtime.evaluate", {"expression": js_audit, "returnByValue": True})
            v = r.get("result", {}).get("result", {}).get("value", {})
            real_cnt = max(v.get("tileCount", 0), v.get("imgCount", 0), v.get("removeCount", 0))
            if v.get("errorDetected"):
                has_error = True
                error_text = v.get("errorMsg")
                break

            if real_cnt >= len(img_paths):
                attached_count = real_cnt
                log(f"✅【门禁放行】全部 {attached_count}/{len(img_paths)} 张原图已 100% 成功挂载为真实附件！")
                break
            elif real_cnt >= min(len(img_paths), 5) and sec >= 12:
                attached_count = real_cnt
                log(f"✅【门禁放行】已有 {attached_count} 张原图挂载就绪（满足画册级多图标准），放行出图！")
                break

        if has_error:
            raise RuntimeError(f"🚨 触发平台上传报错/风控: {error_text}！坚决阻断发送，停止空跑！")

        if attached_count == 0:
            raise RuntimeError(
                f"🚨【上传硬核拦截】连续 35 秒检测到 0 张附件挂载！\n"
                f"已触发 OpenAI 图片上传滑动窗口限制（3小时配额耗尽）或前端静默丢弃！\n"
                f"系统已 100% 物理阻断发送指令，杜绝无图纯文本空跑，绝不产出单封面残次品！"
            )

        return attached_count

    async def send_text_prompt(self, prompt_text, action_desc="发送指令", max_wait_sec=20):
        log(f"注入 {action_desc}...")
        js_inject = f"""(() => {{
            const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
            if (ta) {{
                ta.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, {json.dumps(prompt_text)});
                return true;
            }}
            return false;
        }})()"""
        await self.send_cmd("Runtime.evaluate", {"expression": js_inject, "returnByValue": True})
        await asyncio.sleep(1)

        send_clicked = False
        for _ in range(max_wait_sec):
            js_click_send = """(() => {
                const btn = document.querySelector('button[data-testid="send-button"]') ||
                            document.querySelector('button[aria-label*="Send"]') ||
                            document.querySelector('button[aria-label*="发送"]');
                if (btn && !btn.disabled) {
                    btn.click();
                    return true;
                }
                return false;
            })()"""
            r_click = await self.send_cmd("Runtime.evaluate", {"expression": js_click_send, "returnByValue": True})
            if r_click.get("result", {}).get("result", {}).get("value"):
                send_clicked = True
                log(f"-> {action_desc} 点击发送成功！")
                break
            await asyncio.sleep(1)

        if not send_clicked:
            js_enter = """(() => {
                const ta = document.querySelector('#prompt-textarea');
                if (ta) {
                    ta.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
                    return true;
                }
                return false;
            })()"""
            await self.send_cmd("Runtime.evaluate", {"expression": js_enter})
            log(f"-> {action_desc} 回车兜底发送！")

    async def monitor_and_chain_prompt(self, expected_count):
        """
        出图监控与连环追问驱动
        若停滞在 1 张图且无法追问出图，严厉触发熔断，杜绝残次品
        """
        log(f"正在监控出图进程（期望出图数: {expected_count} 张，画册底线 >= 3 张）...")
        last_prompted_for = 0
        idle_ticks = 0
        retry_stuck = 0

        for tick in range(1, 160):
            await asyncio.sleep(10)
            bring_window_topmost()

            js_status = """(() => {
                const stopBtn = document.querySelector('button[data-testid*="stop"]');
                const userMsgs = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
                const userImgSrcs = new Set();
                userMsgs.forEach(m => {
                    m.querySelectorAll('img').forEach(i => userImgSrcs.add(i.src));
                });

                const allImgs = Array.from(document.querySelectorAll('img'));
                const map = new Map();
                allImgs.forEach(img => {
                    const src = img.src || '';
                    const alt = img.alt || '';
                    const isAvatar = alt.includes('个人资料') || alt.includes('profile') || alt.includes('avatar');
                    const isRawUpload = alt.includes('.jpg') || alt.includes('.jpeg') || userImgSrcs.has(src);
                    const isTiny = (img.naturalWidth > 0 && img.naturalWidth < 300) && (img.naturalHeight > 0 && img.naturalHeight < 300);
                    const isGeneratedHD = img.naturalWidth >= 500 || img.naturalHeight >= 500;
                    if (src.includes('backend-api/estuary') && !isAvatar && !isRawUpload && !isTiny && isGeneratedHD) {
                        const idMatch = src.match(/id=([^&]+)/) || src.match(/enc\\/([^?&#]+)/);
                        const fileId = idMatch ? idMatch[1] : src;
                        if (!map.has(fileId)) {
                            map.set(fileId, src);
                        }
                    }
                });
                const bodyText = document.body.innerText;
                const isThinking = bodyText.includes('正在思考') || bodyText.includes('正在生成更详细的图片') || bodyText.includes('Designing the carousel');
                const assts = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
                const lastAsstText = assts.length > 0 ? assts[assts.length - 1].innerText : '';
                const modalEl = document.querySelector('[role="dialog"]') || document.querySelector('[role="alert"]');
                const modalText = modalEl ? modalEl.innerText : '';
                return {
                    isGenerating: !!stopBtn || isThinking,
                    imgCount: map.size,
                    lastAsstText: (lastAsstText + ' ' + modalText).slice(0, 200)
                };
            })()"""
            r_stat = await self.send_cmd("Runtime.evaluate", {"expression": js_status, "returnByValue": True})
            stat = r_stat.get("result", {}).get("result", {}).get("value", {})
            is_gen = stat.get("isGenerating", False)
            img_count = stat.get("imgCount", 0)
            last_txt = stat.get("lastAsstText", "")

            log(f"  [出图轮询 {tick}/160] 正在生成: {is_gen} | 当前已渲染大图: {img_count}/{expected_count}")

            # 1. 检查助手或弹窗是否报拒答/未收到图
            rejection_keywords = ["没有收到", "重新发上来", "无法按你要求", "没有已暂存", "没法直接出图", "重新上传", "未检测到已上传"]
            if any(k in last_txt for k in rejection_keywords):
                raise RuntimeError(f"🚨 ChatGPT 拒答拦截（未收到图片原料）: {last_txt[:40]}")

            # 2. 检查配额熔断（包含弹窗提示）
            quota_keywords = ["达到 Plus 套餐", "图像生成请求上限", "额度限制", "上限将在", "reached the image generation limit"]
            if any(k in last_txt for k in quota_keywords):
                raise RuntimeError(f"🚨 触发官方生图配额上限: {last_txt[:40]}")

            # 3. 达成全部目标
            if img_count >= expected_count:
                log(f"🎉 全部目标数量 {img_count}/{expected_count} 张已 100% 达成！")
                await asyncio.sleep(3)
                return img_count

            # 4. 连环追问驱动：如果模型停下了但还没达到期望张数
            if not is_gen and 0 < img_count < expected_count:
                if img_count > last_prompted_for:
                    next_page = img_count + 1
                    log(f"🔄【连环追问】当前已出 {img_count} 张，模型本轮已停下，同会话自动追发第 {next_page} 张指令！")
                    cont_prompt = (
                        f"很好！前 {img_count} 张大图已生成完毕。\n"
                        f"请严格按照 V5.0 规则（3:4 竖版、1086x1448、国产普通手机自然实拍去AI塑料感、原图排版骨架、四宫格站位绝对打乱置换），"
                        f"立即直接生成下一张大图：第 {next_page} 张大图（严格对应原素材图 P{next_page} 内页）！\n"
                        f"绝对禁止输出任何文字解释与客套话，直接出图！"
                    )
                    await self.send_text_prompt(cont_prompt, f"追问第 {next_page} 张指令")
                    last_prompted_for = img_count
                    idle_ticks = 0
                    retry_stuck = 0
                    await asyncio.sleep(5)
                else:
                    idle_ticks += 1
                    if idle_ticks >= 6:  # 追问后 60 秒依然没有启动
                        retry_stuck += 1
                        log(f"⚠️ 追发后 60 秒未见新出图 (重试 {retry_stuck}/3 次)...")
                        idle_ticks = 0
                        last_prompted_for = img_count - 1
                        if retry_stuck >= 3:
                            if img_count >= 4:
                                log(f"⚠️ 虽未达满配 {expected_count} 张，但已稳定生成 {img_count} 张多图画册（满足 >=4 张高品质标准），放行入库！")
                                return img_count
                            else:
                                raise RuntimeError(
                                    f"🚨【残次多图硬核拦截】出图停滞且仅产出 {img_count} 张图（不足 4 张多图画册标准）！\n"
                                    f"坚决拒绝单封面半成品入库，立即熔断！"
                                )

        if img_count < 4:
            raise RuntimeError(f"🚨 超时结束且出图数仅为 {img_count} 张（不合格单封面），拒绝入库！")
        return img_count

    async def generate_format3_copy(self, context_block):
        log("-> 发送 Format 3 三端文案生成指令...")
        copy_prompt = (
            f"请根据上面刚刚生成的全套大图与原素材真实行程，立即生成 Format 3 标准三端文案。\n"
            f"【原素材参考正文】：\n{context_block}\n\n"
            "【输出铁律】：\n"
            "1. 必须基于原素材真实行程和细节直接写出具体文案，严禁输出任何形如 [小红书主标题]、[小红书种草正文] 的中括号占位符，必须直接替换为真实创作的标题和内容！\n"
            "2. 必须包含以下标签完整输出：\n"
            "<<<COPY_FORMAT:3>>>\n"
            "<<<XHS_START>>>\n"
            "真实小红书主标题（带吸引力与emoji）\n\n"
            "真实小红书种草正文（带两日详细行程排期、亮点提炼与真实避坑，拒绝空话套话）\n\n"
            "#江浙沪周边游 #上海团建 #杭州团建 #秋日赏秋 #团建好去处 #户外徒步 #小众旅行地 #HR团建方案 #周末去哪儿 #江浙沪小众自驾 #公司团建策划 #秋游路线\n"
            "<<<XHS_END>>>\n"
            "<<<XHS_2_START>>>\n"
            "HR方案决策版大纲（包含方案名称、适用对象、预算参考、决策亮点与服务保障）\n"
            "<<<XHS_2_END>>>\n"
            "<<<DOUYIN_START>>>\n"
            "抖音短平快口播脚本（痛点切入+亮点排期+留资号召）\n"
            "<<<DOUYIN_END>>>\n"
        )
        await self.send_text_prompt(copy_prompt, "Format 3 三端文案指令", max_wait_sec=15)

        log("等待三端文案输出完成...")
        copy_text = ""
        for _ in range(30):
            await asyncio.sleep(3)
            get_txt_js = """(() => {
                const asst = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
                if (asst.length > 0) return asst[asst.length - 1].innerText;
                return '';
            })()"""
            r_txt = await self.send_cmd("Runtime.evaluate", {"expression": get_txt_js, "returnByValue": True})
            txt = r_txt.get("result", {}).get("result", {}).get("value", "")
            if "XHS_END" in txt or "DOUYIN_END" in txt:
                copy_text = txt
                log("✅ Format 3 文案结构捕获成功！")
                break
        return copy_text

    async def download_and_verify(self, target_pkg_dir, expected_count):
        log(f"-> 提取无损图片 URL 并下载至成品目录: {target_pkg_dir}")
        os.makedirs(target_pkg_dir, exist_ok=True)

        js_get_urls = """(() => {
            const userMsgs = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
            const userImgSrcs = new Set();
            userMsgs.forEach(m => {
                m.querySelectorAll('img').forEach(i => userImgSrcs.add(i.src));
            });

            const allImgs = Array.from(document.querySelectorAll('img'));
            const map = new Map();
            allImgs.forEach(img => {
                const src = img.src || '';
                const alt = img.alt || '';
                const isAvatar = alt.includes('个人资料') || alt.includes('profile') || alt.includes('avatar');
                const isRawUpload = alt.includes('.jpg') || alt.includes('.jpeg') || userImgSrcs.has(src);
                const isTiny = (img.naturalWidth > 0 && img.naturalWidth < 300) && (img.naturalHeight > 0 && img.naturalHeight < 300);
                const isGeneratedHD = img.naturalWidth >= 500 || img.naturalHeight >= 500;
                if (src.includes('backend-api/estuary') && !isAvatar && !isRawUpload && !isTiny && isGeneratedHD) {
                    const idMatch = src.match(/id=([^&]+)/) || src.match(/enc\\/([^?&#]+)/);
                    const fileId = idMatch ? idMatch[1] : src;
                    if (!map.has(fileId)) {
                        map.set(fileId, src);
                    }
                }
            });
            return Array.from(map.values());
        })()"""
        r_urls = await self.send_cmd("Runtime.evaluate", {"expression": js_get_urls, "returnByValue": True})
        img_urls = r_urls.get("result", {}).get("result", {}).get("value", [])

        if len(img_urls) < 4:
            raise RuntimeError(f"拉取大图 URL 数量不足（仅 {len(img_urls)} 张），拉取中断！")

        saved_files = []
        for idx, u in enumerate(img_urls[:expected_count]):
            fname = "P1_封面.png" if idx == 0 else f"P{idx+1}.png"
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
                saved_files.append(dest)
                log(f"  [√] 成功落地: {fname} ({len(raw_bytes)/1024/1024:.2f} MB)")
            else:
                log(f"  [X] 下载失败: {fname}")

        # Pillow 物理质检
        valid_cnt = 0
        for f in saved_files:
            try:
                with Image.open(f) as im:
                    w, h = im.size
                    if w >= 800 and h >= 1000:
                        valid_cnt += 1
            except Exception:
                pass

        log(f"Pillow 像素质检通过率: {valid_cnt}/{len(saved_files)} (要求高清竖版大图)")
        if valid_cnt < 4:
            raise RuntimeError(f"🚨 有效大图不足 4 张，质检未通过！")
        return saved_files

    async def run_single_test(self, mat_info):
        mat_dir = mat_info["path"]
        mat_name = mat_info["name"]

        log("=" * 65)
        log(f"🚀 开始单套完整图测试生产: {mat_name}")
        log(f"📂 原料目录: {mat_dir}")
        log("=" * 65)

        # 1. 检查双重生图配额安全预算（3小时滑动窗口40张 + 全天180张）
        allowed, reason, wait_sec, stats = check_generation_quota("C")
        log(f"🛡️【生成配额守门检查】近3小时大图: {stats['gen_3h']}/{MAX_3H_GEN_LIMIT} 张 | 今日累计: {stats['gen_today']}/{MAX_DAILY_GEN_LIMIT} 张")
        if not allowed:
            raise RuntimeError(
                f"🛑【生成配额安全保护拦截】{reason}！\n"
                f"建议等待约 {wait_sec//60} 分钟，待滑动窗口释放后再开启新笔记，杜绝触碰官方风控熔断线！"
            )

        # 2. 连接与准备全新会话
        await self.connect()
        await self.prepare_clean_session()

        # 3. 提取完整原图（支持 5~20 张画册级大图，拒绝阉割！）
        full_imgs = self.prepare_full_material_images(mat_dir, max_count=20)
        log(f"已提取全量 {len(full_imgs)} 张原图进行 100% 完整复刻:")
        for i, p in enumerate(full_imgs):
            log(f"   [{i+1}] {os.path.basename(p)}")

        # 4. 严格物理上传门禁
        try:
            attached_cnt = await self.upload_with_strict_gate(full_imgs)
        except Exception as ue:
            log(f"❌ 上传阶段异常: {ue}")
            isolate_abnormal_material(mat_dir, reason=f"上传门禁未通过: {ue}")
            raise

        # 5. 构建 V5.0 提示词
        copy_path = os.path.join(mat_dir, "文案.txt")
        context_block = ""
        if os.path.exists(copy_path):
            try:
                with open(copy_path, 'r', encoding='utf-8') as f:
                    context_block = f.read()[:1200]
            except Exception:
                pass

        v50_prompt = (
            "【小红书团建拼图大字营销封面轻复刻去重修图师 V5.0】\n"
            "（四宫格站位强制置换打乱｜反AI塑料凡士林磨皮｜纯正国产手机实拍质感｜原文字层锁死版）\n\n"
            f"已成功上传全部 {attached_cnt} 张原图。\n"
            "请严格按照 V5.0 规则执行直接出图，绝对禁止自由创作或脑补新景区！\n\n"
            f"【原素材参考正文与真实排期】：\n{context_block}\n\n"
            "【V5.0 核心铁律：四宫格站位绝对打乱 & 真实手机质感】：\n"
            "1. 【四宫格/多图拼接·站位绝对置换打乱律】：\n"
            "   - 凡涉及 4 宫格拼图或多图画中画（原站位若为：左上A、右上B、左下C、右下D），生成时【必须强制打乱重排】（如置换为：左上B、右上D、左下A、右下C，或任意非原位站位）！\n"
            "   - 绝对不允许任何一个小格子的画面留在原位置！严禁原地仅换脸换衣！\n"
            "2. 【彻底破除 AI 凡士林磨皮感·真实手机随拍质感】：\n"
            "   - 100% 严禁 3D 凡士林发光塑料磨皮，严禁假大空 CG 渲染质感！\n"
            "   - 强制呈现国产普通手机（iPhone、华为）室外自然光摄影：自然的阳光与树荫阴影、食物真实肌理、生活感噪点。\n"
            "3. 【排版与文字层严格遵循原图骨架】：\n"
            "   - 原图是多图大字则继承大字排版；若原图是纯净实拍或小清新，则继承清新排版，严禁千篇一律强行压大字！\n"
            "   - P1 封面：100% 锁死主标题文字、副标与排期；P2~PN 内页严格按原图版式复刻！\n"
            "4. 严格输出 3:4 竖版大图（1086x1448），逐页生成，不出计划、不等回复 1，立即开始直接出图！"
        )

        # 6. 注入提示词并发送
        await self.send_text_prompt(v50_prompt, "V5.0 初始多图生图指令")

        # 7. 出图监控与连环追问
        try:
            final_img_cnt = await self.monitor_and_chain_prompt(expected_count=attached_cnt)
        except Exception as ge:
            log(f"❌ 出图阶段异常: {ge}")
            isolate_abnormal_material(mat_dir, reason=f"模型出图异常: {ge}")
            raise

        # 8. 生成三端文案
        copy_text = await self.generate_format3_copy(context_block)

        # 9. 第一时间落地至 _制作中 创作区
        clean_title = re.sub(r"^评\d+-赞\d+-", "", mat_name)
        clean_title = re.sub(r"[\s\-_]*\d{8}$", "", clean_title)
        clean_title = re.sub(r'[\\/:*?"<>|]', '_', clean_title).strip()[:40]
        ts_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        folder_name = f"{ts_str}-网页CDP-{clean_title}"
        producing_base = os.path.join(OUTPUT_BASE, "_制作中")
        stage0_base = os.path.join(OUTPUT_BASE, "已发送0次（抖音小红书可发）")
        os.makedirs(producing_base, exist_ok=True)
        os.makedirs(stage0_base, exist_ok=True)
        target_dir = os.path.join(producing_base, folder_name)

        saved_files = await self.download_and_verify(target_dir, expected_count=final_img_cnt)

        # 10. 记录作品大图落地成功（同步 3小时滑动窗口40张 + 全天180张 双重配额账本）
        record_generation_success("C", len(saved_files), attached_cnt, mat_name)

        # 11. 保存标准单文件文案与全量记录
        with open(os.path.join(target_dir, "文案.txt"), "w", encoding="utf-8") as f:
            f.write(copy_text)
        with open(os.path.join(target_dir, "三平台文案.txt"), "w", encoding="utf-8") as f:
            f.write(copy_text)
        with open(os.path.join(target_dir, "全量生成记录.txt"), "w", encoding="utf-8") as f:
            f.write(copy_text)

        # 12. 固化 manifest.json
        manifest_data = {
            "title": mat_name,
            "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "pipeline": "xhs-card-replica-pipeline V5.0 原图排版骨架版",
            "worker": "Instance-C",
            "rawMaterialPath": mat_dir,
            "imageCount": len(saved_files),
            "plannedImageCount": attached_cnt,
            "status": "PASS"
        }
        with open(os.path.join(target_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest_data, f, ensure_ascii=False, indent=2)

        # 13. 验真门禁通过，原子移动至 已发送0次（抖音小红书可发）
        final_target_dir = os.path.join(stage0_base, folder_name)
        try:
            import shutil
            if os.path.exists(final_target_dir):
                shutil.rmtree(final_target_dir, ignore_errors=True)
            shutil.move(target_dir, final_target_dir)
            target_dir = final_target_dir
            log(f"-> 质检验收通过，已原子移库至可发库: {target_dir}")
        except Exception as e_mv:
            log(f"-> 移库异常（保留在_制作中）: {e_mv}")

        # 14. 回写 tags.json 标记
        tags_path = os.path.join(mat_dir, ".tags.json")
        try:
            tdata = {}
            if os.path.exists(tags_path):
                with open(tags_path, 'r', encoding='utf-8') as f:
                    tdata = json.load(f)
            tdata.setdefault("production", {})["lifecycleState"] = "已生产"
            tdata["production"]["usageCount"] = tdata["production"].get("usageCount", 0) + 1
            tdata["production"]["lastProducedAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            tdata["production"]["lastProductPath"] = target_dir
            tags = tdata.setdefault("tagging", {}).setdefault("tags", [])
            if "已生产" not in tags:
                tags.append("已生产")
            with open(tags_path, 'w', encoding='utf-8') as f:
                json.dump(tdata, f, ensure_ascii=False, indent=2)
            log("-> 原素材 .tags.json 已安全回写已生产状态")
        except Exception as e:
            log(f"回写 tags.json 异常: {e}")

        log("=" * 65)
        log(f"🎉【测试完成】单套完整多图画册生产验收通过！")
        log(f"📁 成品目录: {target_dir}")
        log(f"🖼️ 实收大图: {len(saved_files)} 张 (100% 高清画册)")
        log("=" * 65)

async def main():
    import argparse
    parser = argparse.ArgumentParser(description="测试版 C 单套/连续多图生产器 (仅接管实例 C · 端口 9433)")
    parser.add_argument("--dir", type=str, default=None, help="指定测试素材的完整物理路径")
    parser.add_argument("--loop", action="store_true", help="开启自主连续生产模式（受控循环推进新素材）")
    args = parser.parse_args()

    producer = TestProducerC(port=CDP_PORT)

    if not args.loop:
        # 单套受控测试模式
        mat = pick_test_material(args.dir)
        if not mat:
            log("❌ 未找到可测试的素材目录！")
            return
        try:
            await producer.run_single_test(mat)
        except Exception as e:
            log(f"❌ 测试过程中断: {e}")
    else:
        # 自主连续生产模式 (仅管实例 C，严格执行 3小时40张 + 全天180张 守门)
        log("🚀【自主连续生产模式启动】仅管实例 C (端口 9433)，将受控持续推进新素材...")
        while True:
            try:
                # 1. 检查双重生图配额
                allowed, reason, wait_sec, stats = check_generation_quota("C")
                if not allowed:
                    log(f"🛡️【配额守门挂起】{reason}，休眠等待中（倒计时约 {wait_sec//60} 分钟）...")
                    await asyncio.sleep(min(wait_sec, 60))
                    continue

                # 2. 挑选下一套未生产素材
                mat = pick_test_material()
                if not mat:
                    log("队列暂无可用新素材，休眠 30 秒后重试...")
                    await asyncio.sleep(30)
                    continue

                # 3. 生产单套
                await producer.run_single_test(mat)

                log("冷却 15 秒后继续推进下一套新素材...")
                await asyncio.sleep(15)

            except Exception as e:
                log(f"⚠️ 本套生产异常中断: {e}，冷却 10 秒后继续下一套...")
                await asyncio.sleep(10)

if __name__ == "__main__":
    asyncio.run(main())
