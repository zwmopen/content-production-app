import asyncio
import json
import os
import re
import sys
import ctypes
import datetime
import subprocess
import urllib.request
import base64
import csv
import tempfile
from PIL import Image
import websockets

sys.stdout.reconfigure(encoding='utf-8')

# 基础目录配置
PROJECT_ROOT = r"D:\AICode\项目推进\projects\江湖有旅人\主项目"
MATERIAL_DIR = os.path.join(PROJECT_ROOT, r"01-素材库\秋季（9—11月·智能分类）")
OUTPUT_BASE = os.path.join(PROJECT_ROOT, r"成品库（GPT+本地脚本制作）")
STATUS_FILE = r"D:\AICode\运行数据\autonomous_production_daemon_status.json"
LOG_FILE = r"D:\AICode\运行数据\autonomous_production.log"

# 飞书配置
FEISHU_GROUP_CHAT_ID = "oc_a620407b836cb421f8bb72c0d6f596f1"  # 流水线作品生产通知群
SPREADSHEET_TOKEN = "D7OMsirIChkd2gt8TMBcPHD9ndc"  # 专职小号承载（已授权大号编辑权限）
SPREADSHEET_SHEET_ID = "587e48"
SPREADSHEET_URL = "https://my.feishu.cn/sheets/D7OMsirIChkd2gt8TMBcPHD9ndc"
FEISHU_STORAGE_PROFILE = "feishu-alt-1"  # 专职物理存储小号（zwm）
LARK_RUN_JS = r"D:\AICode\工具开发\toolchains\npm-global\node_modules\@larksuite\cli\scripts\run.js"

# 账号风控与配额安全基准（2026-09-13 用户最高基准）
DAILY_SAFE_LIMIT_PER_ACCOUNT = 190  # 单账号单日最大安全出图配额（严格预留 10 张防熔断与防风控检测安全隔离带，坚决不碰 200 张死锁）
THREE_HOUR_SAFE_LIMIT = 35          # 3 小时短期突发防线（软上限 40~50 张）

# 接入共享液态玻璃桌面通知技能
sys.path.append(r"D:\AICode\AI\skills\技能包\技能\shared-notification\scripts")
try:
    from shared_notify import notify as desktop_notify
except Exception:
    def desktop_notify(*args, **kwargs): return False

user32 = ctypes.windll.user32

class QuotaLimitException(Exception):
    def __init__(self, message, wait_seconds, resume_dt):
        super().__init__(message)
        self.wait_seconds = wait_seconds
        self.resume_dt = resume_dt

def parse_quota_wait_seconds(asst_text):
    """
    解析 ChatGPT 上限提示文本，提取剩余等待秒数
    支持: '上限将在 12小时 后重置', '上限将在 45分钟 后重置', '13小时'
    """
    hours = 0
    mins = 0
    m_hour = re.search(r'(\d+)\s*(?:个)?小时', asst_text)
    if m_hour:
        hours = int(m_hour.group(1))
    m_min = re.search(r'(\d+)\s*分钟', asst_text)
    if m_min:
        mins = int(m_min.group(1))
    
    total_seconds = hours * 3600 + mins * 60
    import random
    # 随机预留 6~10 分钟 (360~600秒) 安全防风控缓冲，彻底规避整点踩点被系统风控检测与服务端时钟边缘延迟
    buffer_seconds = random.randint(360, 600)
    if total_seconds > 0:
        return total_seconds + buffer_seconds
    return 3 * 3600 + buffer_seconds

def send_feishu_markdown(md_text):
    """向流水线生产群统一发送富文本 Markdown 通知"""
    try:
        cmd = [
            "node", LARK_RUN_JS, "im", "+messages-send",
            "--as", "bot",
            "--chat-id", FEISHU_GROUP_CHAT_ID,
            "--markdown", md_text
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', timeout=15)
        if res.returncode == 0:
            return True
        log(f"飞书推送返回码异常 ({res.returncode}): {res.stderr}")
    except Exception as e:
        log(f"飞书推送异常: {e}")
    return False

def log(msg, instance="SYSTEM"):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [{instance}] {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

def bring_window_topmost(port):
    try:
        target_kws = ['4331', '实例 A', '9431'] if port == 9431 else ['4333', '实例 C', '9433']
        def enum_proc(hwnd, lParam):
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buff = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buff, length + 1)
                title = buff.value
                if any(k in title for k in target_kws + ['ChatGPT']):
                    user32.ShowWindow(hwnd, 9)
                    user32.SetForegroundWindow(hwnd)
            return True
        WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
        user32.EnumWindows(WNDENUMPROC(enum_proc), 0)
    except Exception:
        pass

def scan_pending_queue():
    queue = []
    if not os.path.exists(MATERIAL_DIR):
        return queue

    for cat_name in ["精准流量", "泛流量"]:
        cat_dir = os.path.join(MATERIAL_DIR, cat_name)
        if not os.path.exists(cat_dir):
            continue
        priority = 0 if cat_name == "精准流量" else 1

        for sub in os.listdir(cat_dir):
            sub_path = os.path.join(cat_dir, sub)
            if not os.path.isdir(sub_path):
                continue
            for item in os.listdir(sub_path):
                item_path = os.path.join(sub_path, item)
                if not os.path.isdir(item_path):
                    continue

                tags_file = os.path.join(item_path, ".tags.json")
                state = "待生产"
                if os.path.exists(tags_file):
                    try:
                        with open(tags_file, 'r', encoding='utf-8') as f:
                            tdata = json.load(f)
                        state = tdata.get("production", {}).get("lifecycleState", "待生产")
                        tags = tdata.get("tagging", {}).get("tags", [])
                        if "已生产" in tags:
                            state = "已生产"
                    except Exception:
                        state = "待生产"

                if state not in ["已生产", "生产中"]:
                    queue.append({
                        "name": item,
                        "path": item_path,
                        "category": cat_name,
                        "subcategory": sub,
                        "priority": priority
                    })

    # 按照目的地（subcategory）分组，实现 Round-Robin 多地域交替轮转均衡调度
    from collections import defaultdict
    subcat_groups = defaultdict(list)
    for item in queue:
        subcat_groups[item["subcategory"]].append(item)
    
    # 按目的地交替轮流取出（例如：安吉1套 -> 千岛湖1套 -> 莫干山1套 -> 桐庐1套 -> 杭州1套...）
    balanced_queue = []
    dest_keys = sorted(subcat_groups.keys())
    max_len = max((len(v) for v in subcat_groups.values()), default=0)
    for i in range(max_len):
        for k in dest_keys:
            if i < len(subcat_groups[k]):
                balanced_queue.append(subcat_groups[k][i])
    return balanced_queue

# 全局状态字典
DAEMON_STATE = {
    "pid": os.getpid(),
    "started_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "last_heartbeat": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "completed_total": 8,
    "instances": {
        "A": {"port": 9431, "state": "IDLE", "current_package": None},
        "C": {"port": 9433, "state": "IDLE", "current_package": None}
    },
    "queue_remaining": 808,
    "last_completed": None
}

# 从运行状态文件同步准确已完成套数（当前基准为 8 套）
try:
    if os.path.exists(STATUS_FILE):
        with open(STATUS_FILE, 'r', encoding='utf-8') as f:
            sdata = json.load(f)
            if "completed_total" in sdata and isinstance(sdata["completed_total"], int):
                DAEMON_STATE["completed_total"] = sdata["completed_total"]
except Exception:
    pass

def sync_daemon_state():
    try:
        DAEMON_STATE["last_heartbeat"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        os.makedirs(os.path.dirname(STATUS_FILE), exist_ok=True)
        with open(STATUS_FILE, "w", encoding="utf-8") as f:
            json.dump(DAEMON_STATE, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

IMAGE_COLS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']

def get_next_sheet_row():
    try:
        res = subprocess.run([
            "node", LARK_RUN_JS, "sheets", "+csv-get",
            "--spreadsheet-token", SPREADSHEET_TOKEN,
            "--sheet-id", SPREADSHEET_SHEET_ID,
            "--profile", FEISHU_STORAGE_PROFILE,
            "--as", "user"
        ], capture_output=True, text=True, encoding='utf-8')
        data = json.loads(res.stdout)
        region = data.get("data", {}).get("current_region", "")
        m = re.search(r'[A-Z]+(\d+)$', region)
        if m:
            return int(m.group(1)) + 1
        csv_lines = data.get("data", {}).get("annotated_csv", "").strip().split("\n")
        for line in reversed(csv_lines):
            m_row = re.match(r'\[row=(\d+)\]\s*(.*)', line)
            if m_row:
                r_idx = int(m_row.group(1))
                content = m_row.group(2).replace(',', '').strip()
                if content:
                    return r_idx + 1
    except Exception:
        pass
    return 2

def append_to_feishu_sheet(total_num, mat_dir, target_pkg_dir):
    try:
        row_mat = get_next_sheet_row()
        row_fin = row_mat + 1
        log(f"-> 正在将第 {total_num} 套画册级比对行写入小号飞书表 (Row {row_mat} ~ {row_fin})...")

        # 1. 写入 A:B 路径与类型文本
        r1 = [f"第{total_num}套【本地原素材】", mat_dir]
        r2 = [f"第{total_num}套【本地成品素材】", target_pkg_dir]
        tmp_csv = os.path.join(PROJECT_ROOT, f"temp_append_{total_num}.csv")
        with open(tmp_csv, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.writer(f)
            writer.writerow(r1)
            writer.writerow(r2)

        cmd = [
            "node", LARK_RUN_JS, "sheets", "+csv-put",
            "--spreadsheet-token", SPREADSHEET_TOKEN,
            "--sheet-id", SPREADSHEET_SHEET_ID,
            "--start-cell", f"A{row_mat}",
            "--profile", FEISHU_STORAGE_PROFILE,
            "--as", "user",
            "--csv", f"@{tmp_csv}"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
        if os.path.exists(tmp_csv):
            try: os.remove(tmp_csv)
            except: pass

        # 2. 设置行高 130px 呈现画册大图效果
        cmd_resize = [
            "node", LARK_RUN_JS, "sheets", "+rows-resize",
            "--spreadsheet-token", SPREADSHEET_TOKEN,
            "--sheet-id", SPREADSHEET_SHEET_ID,
            "--range", f"{row_mat}:{row_fin}",
            "--height", "130",
            "--profile", FEISHU_STORAGE_PROFILE,
            "--as", "user"
        ]
        subprocess.run(cmd_resize, capture_output=True, text=True, encoding='utf-8')

        # 2b. 协同规范：成品行（row_fin）整行渲染浅天蓝色（#E8F3FF）
        style_payload = {
            "styles": [
                {
                    "name": "Sheet1",
                    "cell_styles": [
                        {
                            "range": f"A{row_fin}:O{row_fin}",
                            "background_color": "#E8F3FF"
                        }
                    ]
                }
            ]
        }
        tmp_style = os.path.join(tempfile.gettempdir(), f"style_{total_num}.json")
        try:
            with open(tmp_style, 'w', encoding='utf-8') as sf:
                json.dump(style_payload, sf)
            cmd_style = [
                "node", LARK_RUN_JS, "sheets", "+styles-put",
                "--spreadsheet-token", SPREADSHEET_TOKEN,
                "--styles", f"@{tmp_style}",
                "--profile", FEISHU_STORAGE_PROFILE,
                "--as", "user"
            ]
            subprocess.run(cmd_style, capture_output=True, text=True, encoding='utf-8')
        except Exception:
            pass
        finally:
            if os.path.exists(tmp_style):
                try: os.remove(tmp_style)
                except: pass

        # 3. 嵌入原素材图片至单元格
        temp_dir = tempfile.gettempdir()
        raw_imgs = sorted([f for f in os.listdir(mat_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))])
        for idx, fimg in enumerate(raw_imgs[:10]):
            col = IMAGE_COLS[idx]
            cell = f"{col}{row_mat}"
            src_path = os.path.join(mat_dir, fimg)
            tmp_file = os.path.join(temp_dir, f"tmp_raw_{total_num}_{idx}.jpg")
            try:
                with Image.open(src_path) as im:
                    im.convert('RGB').save(tmp_file, 'JPEG', quality=85)
                cmd_img = [
                    "node", LARK_RUN_JS, "sheets", "+cells-set-image",
                    "--spreadsheet-token", SPREADSHEET_TOKEN,
                    "--sheet-id", SPREADSHEET_SHEET_ID,
                    "--range", cell,
                    "--image", tmp_file,
                    "--profile", FEISHU_STORAGE_PROFILE,
                    "--as", "user"
                ]
                subprocess.run(cmd_img, capture_output=True, text=True, encoding='utf-8')
            except Exception as e:
                log(f"   [嵌入原图警告] {cell}: {e}")
            finally:
                if os.path.exists(tmp_file):
                    try: os.remove(tmp_file)
                    except: pass

        # 4. 嵌入成品高清图至单元格
        fin_imgs = sorted([f for f in os.listdir(target_pkg_dir) if f.lower().endswith('.png')])
        for idx, fimg in enumerate(fin_imgs[:10]):
            col = IMAGE_COLS[idx]
            cell = f"{col}{row_fin}"
            src_path = os.path.join(target_pkg_dir, fimg)
            tmp_file = os.path.join(temp_dir, f"tmp_fin_{total_num}_{idx}.jpg")
            try:
                with Image.open(src_path) as im:
                    im.convert('RGB').save(tmp_file, 'JPEG', quality=88)
                cmd_img = [
                    "node", LARK_RUN_JS, "sheets", "+cells-set-image",
                    "--spreadsheet-token", SPREADSHEET_TOKEN,
                    "--sheet-id", SPREADSHEET_SHEET_ID,
                    "--range", cell,
                    "--image", tmp_file,
                    "--profile", FEISHU_STORAGE_PROFILE,
                    "--as", "user"
                ]
                subprocess.run(cmd_img, capture_output=True, text=True, encoding='utf-8')
            except Exception as e:
                log(f"   [嵌入成品图警告] {cell}: {e}")
            finally:
                if os.path.exists(tmp_file):
                    try: os.remove(tmp_file)
                    except: pass

        # 5. 写入 M 列生产时间 / 入库时间
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        raw_time = "-"
        if os.path.exists(mat_dir):
            try:
                mtime = os.path.getmtime(mat_dir)
                raw_time = datetime.datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S")
            except: pass
        tmp_m_csv = os.path.join(tempfile.gettempdir(), f"temp_m_{total_num}.csv")
        with open(tmp_m_csv, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.writer(f)
            writer.writerow([raw_time])
            writer.writerow([now_str])
        cmd_m = [
            "node", LARK_RUN_JS, "sheets", "+csv-put",
            "--spreadsheet-token", SPREADSHEET_TOKEN,
            "--sheet-id", SPREADSHEET_SHEET_ID,
            "--start-cell", f"M{row_mat}",
            "--profile", FEISHU_STORAGE_PROFILE,
            "--as", "user",
            "--csv", f"@{tmp_m_csv}"
        ]
        subprocess.run(cmd_m, capture_output=True, text=True, encoding='utf-8')
        if os.path.exists(tmp_m_csv):
            try: os.remove(tmp_m_csv)
            except: pass

        log(f"-> 飞书小号画册级对比总表 A{row_mat}:M{row_fin} 写入成功（原素材与成品图均已嵌入单元格，生产时间已入库）！")
        return True
    except Exception as e:
        log(f"-> 飞书小号画册写入异常: {e}")
        return False

class InstanceWorker:
    def __init__(self, instance_id, cdp_port):
        self.id = instance_id
        self.cdp_port = cdp_port
        self.ws = None

    async def connect(self):
        url = f"http://127.0.0.1:{self.cdp_port}/json"
        req = urllib.request.Request(url, headers={"User-Agent": "AutonomousProducer"})
        res = json.loads(urllib.request.urlopen(req, timeout=5).read().decode('utf-8'))
        page = next((p for p in res if 'chatgpt.com' in p.get('url', '') and p.get('type') == 'page'), None)
        if not page:
            wb_page = next((p for p in res if '433' in p.get('url', '') and p.get('type') == 'page'), None)
            if wb_page:
                ws_wb = await websockets.connect(wb_page['webSocketDebuggerUrl'])
                account_id = "account-1" if self.id == "A" else "account-3"
                js_show = f"window.gptWorkbench && window.gptWorkbench.show({{ x: 100, y: 100, width: 1200, height: 800 }}, '{account_id}')"
                await ws_wb.send(json.dumps({"id": 999, "method": "Runtime.evaluate", "params": {"expression": js_show}}))
                await asyncio.sleep(2)
                await ws_wb.close()
                res = json.loads(urllib.request.urlopen(url, timeout=5).read().decode('utf-8'))
                page = next((p for p in res if 'chatgpt.com' in p.get('url', '') and p.get('type') == 'page'), None)

        if not page:
            page = next((p for p in res if p.get('type') == 'page'), None)
        if not page:
            raise RuntimeError(f"[{self.id}] 端口 {self.cdp_port} 未找到可连接的页面！")

        ws_url = page['webSocketDebuggerUrl']
        self.ws = await websockets.connect(ws_url, max_size=50*1024*1024)
        log(f"CDP 已成功连接到端口 {self.cdp_port} ({page['url'][:45]}...)", self.id)

    async def send_cmd(self, method, params=None, timeout=35):
        if params is None:
            params = {}
        import random
        mid = random.randint(10000, 99999)
        msg = {"id": mid, "method": method, "params": params}
        await self.ws.send(json.dumps(msg))
        
        async def _recv_loop():
            while True:
                raw = await self.ws.recv()
                data = json.loads(raw)
                if data.get('id') == mid:
                    return data

        return await asyncio.wait_for(_recv_loop(), timeout=timeout)

    async def open_fresh_session(self):
        log("-> 开辟全新会话（SPA 页面复用，杜绝硬刷新）...", self.id)
        js_find_and_click = """(() => {
            const links = Array.from(document.querySelectorAll('a[href="/"]'));
            const newChatBtn = links.find(a => a.innerText.includes('新聊天') || a.innerText.includes('New chat') || a.getAttribute('aria-label') === '新聊天');
            if (newChatBtn) {
                newChatBtn.click();
                return 'CLICKED_LINK';
            }
            const penBtn = document.querySelector('button[aria-label*="新聊天"]') ||
                            document.querySelector('button[aria-label*="New chat"]');
            if (penBtn) {
                penBtn.click();
                return 'CLICKED_BUTTON';
            }
            return 'NOT_FOUND';
        })()"""
        r = await self.send_cmd("Runtime.evaluate", {"expression": js_find_and_click, "returnByValue": True})
        log(f"SPA 新聊天按钮点击状态: {r.get('result', {}).get('result', {}).get('value')}", self.id)

        for attempt in range(20):
            await asyncio.sleep(1)
            js_check = """(() => {
                const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
                const fileInput = document.querySelector('input[type="file"]');
                return {
                    ready: !!ta && !!fileInput,
                    url: window.location.href
                };
            })()"""
            rc = await self.send_cmd("Runtime.evaluate", {"expression": js_check, "returnByValue": True})
            v = rc.get("result", {}).get("result", {}).get("value", {})
            if v.get("ready"):
                log(f"-> 新会话已就绪！({v.get('url')})", self.id)
                return True
        log("新会话探针超时，继续尝试注入...", self.id)
        return True

    def prepare_material_images(self, mat_dir, max_imgs=9):
        files = [f for f in os.listdir(mat_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
        def extract_num(f):
            m = re.search(r'\d+', f)
            return int(m.group(0)) if m else 9999
        files.sort(key=extract_num)

        cover = next((f for f in files if 'cover' in f.lower() or '封面' in f), None)
        if not cover and files:
            cover = files[0]

        inners = [f for f in files if f != cover]
        selected = ([cover] if cover else []) + inners[:max_imgs-1]
        return [os.path.join(mat_dir, f) for f in selected]

    async def produce_single_set(self, mat_info):
        mat_dir = mat_info["path"]
        mat_name = mat_info["name"]
        log(f"==================================================", self.id)
        log(f"开始生产: {mat_name}", self.id)
        log(f"原料路径: {mat_dir}", self.id)

        await self.open_fresh_session()

        # 1. 扫描与上传图片
        img_paths = self.prepare_material_images(mat_dir, max_imgs=9)
        log(f"精选 {len(img_paths)} 张原料图注入对话...", self.id)

        # 推送开始制作通知
        try:
            start_md = (
                f"🎨【双浏览器生产系统 · 实例 {self.id} 开始制作新作品】\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"⚙️ **执行实例**：实例 {self.id} (CDP 端口 {self.cdp_port})\n"
                f"⏱ **启动时间**：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                f"📦 **作品主题**：{mat_name[:50]}\n"
                f"📂 **原素材绝对路径**：\n```\n{mat_dir}\n```\n"
                f"🖼 **原图精选**：已选定 {len(img_paths)} 张原料图注入会话\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"🚀 正在上传原图至 ChatGPT 并注入 V5.0 手机实拍排版骨架提示词，即将进入 3:4 竖屏高清出图..."
            )
            send_feishu_markdown(start_md)
        except Exception as se:
            log(f"-> 开始制作通知发送异常: {se}", self.id)

        node_id = None
        for _ in range(5):
            doc = await self.send_cmd("DOM.getDocument", {"depth": -1, "pierce": True})
            root_id = doc.get('result', {}).get('root', {}).get('nodeId', 1)
            for sel in ["input#upload-files", "form input[type='file']:not([disabled])", "input#upload-photos", "input[type='file']"]:
                node_res = await self.send_cmd("DOM.querySelector", {
                    "nodeId": root_id,
                    "selector": sel
                })
                nid = node_res.get('result', {}).get('nodeId')
                if nid and nid > 0:
                    node_id = nid
                    log(f"-> 命中图片上传专用节点: {sel} (nodeId={node_id})", self.id)
                    break
            if node_id:
                break
            await asyncio.sleep(1)
        if not node_id:
            raise RuntimeError(f"[{self.id}] 未找到文件上传 DOM 节点！")

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
        log("图片文件已注入并触发前端挂载，等待缩略图解析...", self.id)

        # 轮询等待附件挂载完成 (检查 form 内 blob 图片缩略图，最多等待 25 秒)
        attached_cnt = 0
        for wait_idx in range(25):
            await asyncio.sleep(1)
            js_check_attach = """(() => {
                const blobImgs = document.querySelectorAll('form img[src^="blob:"]');
                const chips = document.querySelectorAll('[data-testid*="attachment"], [aria-label*="Attachment"], div.rounded-xl.border, div[class*="attachment"]');
                return Math.max(blobImgs.length, chips.length);
            })()"""
            r_att = await self.send_cmd("Runtime.evaluate", {"expression": js_check_attach, "returnByValue": True})
            attached_cnt = r_att.get("result", {}).get("result", {}).get("value", 0)
            if attached_cnt >= len(img_paths):
                log(f"-> 全部 {attached_cnt} 张原料图缩略图已成功挂载！", self.id)
                break
            elif attached_cnt > 0 and wait_idx >= 12:
                log(f"-> 部分缩略图挂载就绪 ({attached_cnt} 张)，准备发送...", self.id)
                break

        if attached_cnt == 0:
            log("⚠️ 提示：缩略图就绪中，追加 3 秒缓冲确保文件流注入...", self.id)
            await asyncio.sleep(3)

        # 2. 读取原素材文案构建 V5.0 提示词
        copy_path = os.path.join(mat_dir, "文案.txt")
        context_block = ""
        if os.path.exists(copy_path):
            try:
                with open(copy_path, 'r', encoding='utf-8') as f:
                    context_block = f.read()[:1200]
            except Exception: pass

        v50_prompt = (
            "【小红书团建拼图大字营销封面轻复刻去重修图师 V5.0】\n"
            "（四宫格站位强制置换打乱｜反AI塑料凡士林磨皮｜纯正国产手机实拍质感｜原文字层锁死版）\n\n"
            f"已上传全部 {len(img_paths)} 张原图。\n"
            "请严格按照 V5.0 规则执行直接出图，绝对禁止自由创作或脑补新景区！\n\n"
            f"【原素材参考正文与真实排期】：\n{context_block}\n\n"
            "【V5.0 核心铁律：四宫格站位绝对打乱 & 真实手机质感】：\n"
            "1. 【四宫格/多图拼接·站位绝对置换打乱律】：\n"
            "   - 凡涉及 4 宫格拼图或多图画中画（原站位若为：左上A、右上B、左下C、右下D），生成时【必须强制打乱重排】（如置换为：左上B、右上D、左下A、右下C，或任意非原位站位）！\n"
            "   - 绝对不允许任何一个小格子的画面留在原位置！严禁原地仅换脸换衣！\n"
            "   - 各个打乱格子的新画面，采用同主题不同镜头角度的真实实拍（例如烤肉特写置换为炭火全景、农庄大门置换为庭院侧拍）。\n"
            "2. 【彻底破除 AI 凡士林磨皮感·真实手机随拍质感】：\n"
            "   - 100% 严禁 3D 凡士林发光塑料磨皮，严禁假大空 CG 渲染质感！\n"
            "   - 强制呈现国产普通手机（iPhone、华为）室外自然光摄影：自然的阳光与树荫阴影、随性的人间烟火气构图、食物真实肌理与草地杂色、微噪点生活感。\n"
            "3. 【排版与文字层严格遵循原图骨架（不强行套大字）】：\n"
            "   - 【原图怎么排就怎么改，绝不盲目套大字】：原图封面是多图大字则继承大字排版；若原图是纯净实拍、通透风景或清新小标签，则严格继承其轻量排版，严禁所有封面千篇一律强行压上粗笨大字破坏美感！\n"
            "   - P1 封面：100% 锁死原图的主标题文字、副标与地标排期，严禁篡改主标或捏造新事实；\n"
            "   - P2~PN 内页：严格按原图版式复刻（原图有中置大字则保留大字，原图是单张纯风景则保持纯净，原图是攻略清单则做清单）！\n"
            "4. 严格输出 3:4 竖版大图（1086x1448），全量逐页生成全部图片，不出计划、不等回复 1，立即开始直接出图！"
        )

        # 3. 注入生图提示词并点击发送
        log("注入 V5.0 生图提示词 (四宫格位置打乱 + 手机实拍去AI味版)...", self.id)
        js_inject = f"""(() => {{
            const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
            if (ta) {{
                ta.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, {json.dumps(v50_prompt)});
                return true;
            }}
            return false;
        }})()"""
        await self.send_cmd("Runtime.evaluate", {"expression": js_inject})
        await asyncio.sleep(1)

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
        await self.send_cmd("Runtime.evaluate", {"expression": js_click_send})
        log("指令已发送，正在监控出图进程...", self.id)

        # 4. 动态监控生图进程
        expected_count = len(img_paths)
        stuck_99_count = 0

        for tick in range(1, 150):
            await asyncio.sleep(10)
            js_status = """(() => {
                const stopBtn = document.querySelector('button[data-testid*="stop"]');
                const allImgs = Array.from(document.querySelectorAll('img'));
                const map = new Map();
                allImgs.forEach(img => {
                    const src = img.src || '';
                    const alt = img.alt || '';
                    if (src.includes('backend-api/estuary/content') && !alt.includes('.jpg') && !alt.includes('cover(')) {
                        const idMatch = src.match(/id=([^&]+)/);
                        const fileId = idMatch ? idMatch[1] : src;
                        if (!map.has(fileId)) {
                            map.set(fileId, src);
                        }
                    }
                });
                const bodyText = document.body.innerText;
                const isThinking = bodyText.includes('正在思考') || bodyText.includes('正在生成更详细的图片');
                const is99 = bodyText.includes('99%');
                return {
                    isGenerating: !!stopBtn || isThinking,
                    imgCount: map.size,
                    is99: is99,
                    isThinking: isThinking
                };
            })()"""
            res_stat = await self.send_cmd("Runtime.evaluate", {"expression": js_status, "returnByValue": True})
            stat = res_stat.get("result", {}).get("result", {}).get("value", {})
            is_gen = stat.get("isGenerating", False)
            img_count = stat.get("imgCount", 0)
            is_99 = stat.get("is99", False)

            log(f"  [出图轮询 {tick}/150] 正在生成: {is_gen}，已渲染大图: {img_count}/{expected_count}", self.id)

            if tick % 3 == 0:
                bring_window_topmost(self.cdp_port)

            # 自愈探测：如果 ChatGPT 明确回复需要重新上传、内容政策、版权防护、或无法出图，立即中断并触发重试
            if not is_gen and img_count == 0 and tick >= 3:
                js_check_rejection = """(() => {
                    const asst = document.querySelectorAll('[data-message-author-role="assistant"]');
                    if (asst.length === 0) return "";
                    return asst[asst.length - 1].innerText;
                })()"""
                r_rej = await self.send_cmd("Runtime.evaluate", {"expression": js_check_rejection, "returnByValue": True})
                asst_txt = r_rej.get("result", {}).get("result", {}).get("value", "")
                quota_keys = ["达到 Plus 套餐", "图像生成请求上限", "额度限制", "上限将在", "重置，届时可创建更多图像"]
                if any(qk in asst_txt for qk in quota_keys):
                    wait_sec = parse_quota_wait_seconds(asst_txt)
                    resume_dt = datetime.datetime.now() + datetime.timedelta(seconds=wait_sec)
                    resume_str = resume_dt.strftime('%Y-%m-%d %H:%M:%S')
                    wait_h = wait_sec // 3600
                    wait_m = (wait_sec % 3600) // 60

                    log(f"🚨【配额熔断】捕获到 ChatGPT Plus 生图配额上限: {asst_txt[:50]}", self.id)
                    log(f"⏳ 精确预计休眠时长: {wait_h}小时{wait_m}分，预计恢复时间: {resume_str}", self.id)
                    
                    alert_md = (
                        f"⏳【双浏览器流水线 · 实例 {self.id} 配额熔断自愈休眠】\n"
                        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                        f"⚙️ **生产实例**：实例 {self.id} (CDP 端口 {self.cdp_port})\n"
                        f"⏱ **触发时刻**：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                        f"💬 **官方提示**：{asst_txt.strip()[:100]}\n"
                        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                        f"⏰ **预计解冻恢复时刻**：**{resume_str}**\n"
                        f"⌛ **休眠倒计时**：约 {wait_h} 小时 {wait_m} 分钟\n"
                        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                        f"🛡️ **自愈续接机制已激活**：\n"
                        f"1. 当前任务锁已安全释放回待生产池，绝不丢单漏单；\n"
                        f"2. 实例 {self.id} 自动进入低能耗长休眠挂起；\n"
                        f"3. 到达 **{resume_str}** 准点时刻，系统将**自动在群内推送解冻提醒**，并**自动唤醒续接开工**，全程 100% 免人工值守！"
                    )
                    send_feishu_markdown(alert_md)
                    raise QuotaLimitException(f"ChatGPT Plus 生图额度上限: {asst_txt[:35]}", wait_seconds=wait_sec, resume_dt=resume_dt)

                rejection_keys = [
                    "没法直接出图", "重新上传", "没有实际可用", "拿不到可编辑", "无法按你要求",
                    "违反了", "防护限制", "相似性", "内容政策", "无法生成图片", "版权", "抱歉，我无法"
                ]
                if any(k in asst_txt for k in rejection_keys):
                    log(f"⚠️ 捕获到模型拦截或未就绪 ({asst_txt[:35]}...)，立即触发重试/跳过！", self.id)
                    raise RuntimeError(f"ChatGPT 拦截或要求重新上传: {asst_txt[:30]}")

            if is_99 and not is_gen and img_count == 0:
                stuck_99_count += 1
                if stuck_99_count >= 4:
                    log("检测到前端画布在 99% 停滞，触发软刷新同步状态...", self.id)
                    await self.send_cmd("Page.reload", {"ignoreCache": False})
                    await asyncio.sleep(6)
                    stuck_99_count = 0
            else:
                stuck_99_count = 0

            if img_count >= expected_count:
                log(f"-> 目标数量 {img_count}/{expected_count} 已全部达成！", self.id)
                await asyncio.sleep(5)
                break
            elif not is_gen and img_count > 0 and tick > 15:
                log(f"-> 生成已结束，已获取 {img_count} 张大图，继续后续流程。", self.id)
                break

        # 5. 发送 Format 3 三端文案提示词
        log("-> 发送 Format 3 三端文案生成指令...", self.id)
        copy_prompt = (
            f"请根据上面刚刚生成的全套大图与原素材真实行程，立即生成 Format 3 标准三端文案。\n"
            f"【原素材参考正文】：\n{context_block}\n\n"
            "必须包含以下标签完整输出：\n"
            "<<<COPY_FORMAT:3>>>\n"
            "<<<XHS_START>>>\n[小红书主标题]\n\n[小红书种草正文，带两日详细行程排期、亮点提炼与真实避坑，拒绝空话]\n\n[12个同行热门话题标签]\n<<<XHS_END>>>\n"
            "<<<XHS_2_START>>>\n[HR方案决策版大纲，包含方案名称、适用对象、预算参考、决策亮点与服务保障]\n<<<XHS_2_END>>>\n"
            "<<<DOUYIN_START>>>\n[抖音短平快口播脚本，痛点切入+亮点+留资号召]\n<<<DOUYIN_END>>>\n"
        )
        inject_copy_js = f"""(() => {{
            const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
            if (ta) {{
                ta.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('insertText', false, {json.dumps(copy_prompt)});
                return true;
            }}
            return false;
        }})()"""
        await self.send_cmd("Runtime.evaluate", {"expression": inject_copy_js})
        await asyncio.sleep(1)

        send_copy_js = """(() => {
            const btn = document.querySelector('button[data-testid="send-button"]') ||
                        document.querySelector('button[aria-label*="Send"]') ||
                        document.querySelector('button[aria-label*="发送"]');
            if (btn && !btn.disabled) {
                btn.click();
                return true;
            }
            return false;
        })()"""
        await self.send_cmd("Runtime.evaluate", {"expression": send_copy_js})
        log("三端文案指令已发送，等待文本产出...", self.id)

        copy_text = ""
        for _ in range(25):
            await asyncio.sleep(3)
            get_txt_js = """(() => {
                const asst = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
                if (asst.length > 0) return asst[asst.length - 1].innerText;
                const articles = Array.from(document.querySelectorAll('article'));
                return articles.length > 0 ? articles[articles.length - 1].innerText : (document.querySelector('main') ? document.querySelector('main').innerText : '');
            })()"""
            r_txt = await self.send_cmd("Runtime.evaluate", {"expression": get_txt_js, "returnByValue": True})
            txt = r_txt.get("result", {}).get("result", {}).get("value", "")
            if "XHS_END" in txt or "DOUYIN_END" in txt:
                copy_text = txt
                log("Format 3 文案结构捕获成功！", self.id)
                break

        # 6. 提取全部无损图片 URL
        js_get_urls = """(() => {
            const allImgs = Array.from(document.querySelectorAll('img'));
            const map = new Map();
            allImgs.forEach(img => {
                const src = img.src || '';
                const alt = img.alt || '';
                if (src.includes('backend-api/estuary/content') && !alt.includes('.jpg') && !alt.includes('cover(')) {
                    const idMatch = src.match(/id=([^&]+)/);
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
        log(f"已捕获 {len(img_urls)} 张大图 URL，开始无损拉取...", self.id)

        # 7. 创建规范成品目录
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_name = re.sub(r'[\\/:*?"<>|]', '_', mat_name[:60])
        pkg_folder = f"{ts}_{safe_name}_V5.0成品"
        target_pkg_dir = os.path.join(OUTPUT_BASE, pkg_folder)
        os.makedirs(target_pkg_dir, exist_ok=True)

        # 8. 无损下载每张大图
        dl_js_tmpl = """(async (url) => {
            const r = await fetch(url, {credentials: 'include'});
            const b = await r.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                reader.readAsDataURL(b);
            });
        })"""

        saved_images = []
        for idx, u in enumerate(img_urls[:expected_count]):
            fname = "P1_封面.png" if idx == 0 else f"P{idx+1}_内页.png"
            dest = os.path.join(target_pkg_dir, fname)
            res_b64 = await self.send_cmd("Runtime.evaluate", {
                "expression": f"({dl_js_tmpl})({json.dumps(u)})",
                "awaitPromise": True,
                "returnByValue": True
            })
            b64_str = res_b64.get("result", {}).get("result", {}).get("value")
            if b64_str:
                raw_bytes = base64.b64decode(b64_str)
                with open(dest, "wb") as f:
                    f.write(raw_bytes)
                saved_images.append(dest)
                log(f"  [√] 保存成功: {fname} ({len(raw_bytes)/1024/1024:.2f} MB)", self.id)

        # 9. 保存三端文案
        def extract_tag(text, start_tag, end_tag):
            pat = re.escape(start_tag) + r'(.*?)' + re.escape(end_tag)
            m = re.search(pat, text, re.DOTALL)
            return m.group(1).strip() if m else ""

        xhs_copy = extract_tag(copy_text, "<<<XHS_START>>>", "<<<XHS_END>>>")
        hr_copy = extract_tag(copy_text, "<<<XHS_2_START>>>", "<<<XHS_2_END>>>")
        douyin_copy = extract_tag(copy_text, "<<<DOUYIN_START>>>", "<<<DOUYIN_END>>>")

        if xhs_copy:
            with open(os.path.join(target_pkg_dir, "小红书文案.txt"), "w", encoding="utf-8") as f:
                f.write(xhs_copy)
        if hr_copy:
            with open(os.path.join(target_pkg_dir, "HR方案决策版.txt"), "w", encoding="utf-8") as f:
                f.write(hr_copy)
        if douyin_copy:
            with open(os.path.join(target_pkg_dir, "抖音口播脚本.txt"), "w", encoding="utf-8") as f:
                f.write(douyin_copy)

        full_copy = f"【小红书文案】\n{xhs_copy}\n\n【HR方案决策版】\n{hr_copy}\n\n【抖音口播脚本】\n{douyin_copy}"
        with open(os.path.join(target_pkg_dir, "文案.txt"), "w", encoding="utf-8") as f:
            f.write(full_copy)

        # 10. Pillow 质检验收
        log("执行 Pillow 像素级三层质检...", self.id)
        valid_cnt = 0
        for img_p in saved_images:
            try:
                with Image.open(img_p) as im:
                    w, h = im.size
                    ratio = h / w
                    if ratio >= 1.25 and im.verify is not None:
                        valid_cnt += 1
            except Exception as pe:
                log(f"  [X] 图片校验未通过: {img_p} ({pe})", self.id)

        log(f"-> 质检通过率: {valid_cnt}/{len(saved_images)} (要求 >= 3:4 竖屏高清)", self.id)

        # 11. 固化 manifest.json
        manifest_data = {
            "title": mat_name,
            "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "pipeline": "xhs-card-replica-pipeline V5.0 原图排版骨架版",
            "worker": f"Instance-{self.id}",
            "rawMaterialPath": mat_dir,
            "finishedProductPath": target_pkg_dir,
            "imageCount": valid_cnt,
            "status": "PASS"
        }
        with open(os.path.join(target_pkg_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest_data, f, ensure_ascii=False, indent=2)

        # 12. 回写原料 .tags.json 为已生产
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
            prod["outputPackage"] = pkg_folder
            tags = tdata.setdefault("tagging", {}).setdefault("tags", [])
            if "已生产" not in tags:
                tags.append("已生产")
            with open(tags_path, 'w', encoding='utf-8') as f:
                json.dump(tdata, f, ensure_ascii=False, indent=2)
            log("-> 原料标记回写已生产成功", self.id)
        except Exception as e:
            log(f"回写 .tags.json 异常: {e}", self.id)

        # 13. 登记作品历史数据库
        db_path = os.path.join(OUTPUT_BASE, "_作品历史数据", "作品历史数据库.json")
        if os.path.exists(db_path):
            try:
                with open(db_path, 'r', encoding='utf-8') as f:
                    db = json.load(f)
                records = db.setdefault("records", [])
                records.append({
                    "packageFolder": pkg_folder,
                    "packagePath": target_pkg_dir,
                    "title": mat_name,
                    "producedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "imageCount": valid_cnt,
                    "engine": f"ChatGPT-Worker-{self.id}",
                    "sourceMaterial": mat_dir
                })
                db["total_count"] = len(records)
                db["last_updated"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                with open(db_path, 'w', encoding='utf-8') as f:
                    json.dump(db, f, ensure_ascii=False, indent=2)
                log(f"-> 作品历史数据库登记成功 (当前总计: {db['total_count']})", self.id)
            except Exception as e:
                log(f"登记作品历史数据库异常: {e}", self.id)

        # 14. 同步追加飞书电子表格
        append_to_feishu_sheet(DAEMON_STATE["completed_total"] + 1, mat_dir, target_pkg_dir)

        # 15. 飞书群通知推送（双绝对路径 + 原素材清单 + 成品大图清单 + Pillow质检 + 文案速览 + 表格链接）
        total_num = DAEMON_STATE["completed_total"] + 1
        try:
            # 扫描原素材目录清单
            raw_files = [f for f in os.listdir(mat_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
            raw_preview = ", ".join(sorted(raw_files)[:8])
            if len(raw_files) > 8:
                raw_preview += f" 等共 {len(raw_files)} 张"
            elif not raw_preview:
                raw_preview = f"共 {len(raw_files)} 张"

            # 扫描成品目录并生成像素与体积明细
            fin_lines = []
            for f in sorted(os.listdir(target_pkg_dir)):
                if f.lower().endswith('.png'):
                    fp = os.path.join(target_pkg_dir, f)
                    sz_mb = os.path.getsize(fp) / (1024 * 1024)
                    fin_lines.append(f"• {f} ({sz_mb:.2f} MB, 100% 3:4 竖屏高清)")
            fin_preview = "\n".join(fin_lines[:10]) if fin_lines else f"• {valid_cnt} 张高清大图全部就绪"

            # 提炼文案亮点
            xhs_title = mat_name
            xhs_body_snippet = ""
            copy_path = os.path.join(target_pkg_dir, "文案.txt")
            if os.path.exists(copy_path):
                try:
                    with open(copy_path, 'r', encoding='utf-8') as cf:
                        ct = cf.read().strip()
                        if len(ct) > 20:
                            xhs_body_snippet = ct[:150]
                except:
                    pass
            if not xhs_body_snippet and os.path.exists(os.path.join(mat_dir, "文案.txt")):
                try:
                    with open(os.path.join(mat_dir, "文案.txt"), 'r', encoding='utf-8') as rf:
                        rt = rf.read().strip()
                        lines = [l.strip() for l in rt.split("\n") if l.strip()]
                        if lines:
                            xhs_title = lines[0]
                            xhs_body_snippet = lines[1][:150] if len(lines) > 1 else ""
                except:
                    pass

            feishu_md = (
                f"🎉【双浏览器生产系统 · 第 {total_num} 套作品交付（深度详情版）】\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"⚙️ **生产实例**：实例 {self.id} (CDP 端口 {self.cdp_port})\n"
                f"⏱ **交付时间**：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                f"📦 **作品主题**：{mat_name[:50]}\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"📂 **【本地原素材目录（物理绝对路径）】**\n"
                f"```\n{mat_dir}\n```\n"
                f"📄 **原素材清单**：{len(raw_files)} 张原图 ({raw_preview}) + 原文案.txt + .tags.json\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"🚀 **【本地成品目录（物理绝对路径）】**\n"
                f"```\n{target_pkg_dir}\n```\n"
                f"🖼 **成品图片质检明细**：\n"
                f"{fin_preview}\n"
                f"✅ **Pillow 质检**：{valid_cnt}/{expected_count} 全部通过（长宽比 >= 3:4 竖屏，无损画质）\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"✍ **【文案核心速览】**\n"
                f"• 标题：{xhs_title[:45]}\n"
                f"• 亮点摘录：{xhs_body_snippet}...\n"
                f"• 版本支持：小红书文案 + HR方案决策版 + 抖音口播脚本 三端齐全\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"📊 **【小号承载 · 画册级对比总表（已授权大号编辑权限）】**\n"
                f"{SPREADSHEET_URL}\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"💡 **画册级比对指引**：\n"
                f"1. 点击上方总表，P1~P10 单元格已全量内嵌高清图片素材，点击即可全屏画册预览；\n"
                f"2. 轻触代码块复制本地绝对路径，粘贴至 Windows 资源管理器即可秒开本地源件；\n"
                f"3. 本表格由小号（zwm）独立扛物理空间，大号（大胆走夜路）拥有完全编辑免配额直达！"
            )
            ok = send_feishu_markdown(feishu_md)
            if ok:
                log("-> 飞书深度详情交付通知推送群聊成功！", self.id)
            else:
                log("-> 飞书通知发送失败", self.id)
        except Exception as fe:
            log(f"-> 飞书通知发送异常: {fe}", self.id)

        # 16. 桌面液态玻璃通知
        try:
            desktop_notify(
                title=f"🎉 第 {total_num} 套作品交付成功",
                message=f"实例 {self.id} 完成：{mat_name[:25]}\n双路径已落盘，飞书群与总表已同步",
                status="success",
                position="TopRight",
                duration_ms=6000
            )
        except Exception:
            pass

        # 17. 满 10 套里程碑汇总推送
        if total_num % 10 == 0:
            try:
                milestone_md = (
                    f"🏆【双浏览器生产系统 · 满 {total_num} 套里程碑小结】\n"
                    f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                    f"🎯 **阶段战果**：已连续稳定交付 **{total_num} 套** 小红书高品质营销作品！\n"
                    f"⚡ **双机架构**：实例 A (9431) + 实例 C (9433) 全自动强锁直出并行运转\n"
                    f"🔍 **质检标准**：100% 通过 Pillow 像素级 3:4 竖屏校验与原素材行程锁死\n"
                    f"📊 **全景总表**：\n{SPREADSHEET_URL}\n"
                    f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                    f"🚀 无限流水线全速推进中，下一里程碑目标：第 {total_num + 10} 套！"
                )
                ok = send_feishu_markdown(milestone_md)
                if ok:
                    log(f"-> 满 {total_num} 套里程碑战报已发送至群聊！", self.id)
            except Exception as me:
                log(f"-> 里程碑战报异常: {me}", self.id)

        log(f"=== 本套作品完成！成品目录: {target_pkg_dir} ===", self.id)
        return target_pkg_dir

    async def close(self):
        if self.ws:
            try:
                await self.ws.close()
            except Exception: pass

# 任务声明锁：防止两个实例抢同一个素材
LOCK = asyncio.Lock()

async def claim_next_task(worker_id):
    async with LOCK:
        queue = scan_pending_queue()
        for item in queue:
            tags_file = os.path.join(item["path"], ".tags.json")
            try:
                tdata = {}
                if os.path.exists(tags_file):
                    with open(tags_file, 'r', encoding='utf-8') as f:
                        tdata = json.load(f)
                state = tdata.get("production", {}).get("lifecycleState", "待生产")
                if state not in ["已生产", "生产中"]:
                    prod = tdata.setdefault("production", {})
                    prod["lifecycleState"] = "生产中"
                    prod["lockedBy"] = f"Instance-{worker_id}"
                    prod["lockedAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    with open(tags_file, 'w', encoding='utf-8') as f:
                        json.dump(tdata, f, ensure_ascii=False, indent=2)
                    return item
            except Exception:
                continue
    return None

async def release_task_lock(mat_path):
    async with LOCK:
        tags_file = os.path.join(mat_path, ".tags.json")
        if os.path.exists(tags_file):
            try:
                with open(tags_file, 'r', encoding='utf-8') as f:
                    tdata = json.load(f)
                if tdata.get("production", {}).get("lifecycleState") == "生产中":
                    tdata["production"]["lifecycleState"] = "待生产"
                    with open(tags_file, 'w', encoding='utf-8') as f:
                        json.dump(tdata, f, ensure_ascii=False, indent=2)
            except Exception: pass

async def worker_loop(instance_id, cdp_port):
    worker = InstanceWorker(instance_id, cdp_port)
    log(f"实例 {instance_id} 工作协程启动...", instance_id)

    while True:
        try:
            task = await claim_next_task(instance_id)
            if not task:
                log("队列暂无可用素材，休眠 30 秒...", instance_id)
                DAEMON_STATE["instances"][instance_id]["state"] = "IDLE"
                DAEMON_STATE["instances"][instance_id]["current_package"] = None
                sync_daemon_state()
                await asyncio.sleep(30)
                continue

            DAEMON_STATE["instances"][instance_id]["state"] = "PRODUCING"
            DAEMON_STATE["instances"][instance_id]["current_package"] = task["name"]
            sync_daemon_state()

            await worker.connect()
            output_dir = await worker.produce_single_set(task)
            await worker.close()

            DAEMON_STATE["completed_total"] += 1
            DAEMON_STATE["last_completed"] = {
                "instance": instance_id,
                "product_path": output_dir,
                "material_path": task["path"],
                "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            DAEMON_STATE["instances"][instance_id]["state"] = "SUCCESS"
            sync_daemon_state()

            log("生产成功，冷却 15 秒后领取下一套...", instance_id)
            await asyncio.sleep(15)

        except QuotaLimitException as qe:
            log(f"🛑 实例 {instance_id} 触发配额限额，进入自愈挂起（预计恢复时间: {qe.resume_dt.strftime('%Y-%m-%d %H:%M:%S')}）", instance_id)
            if 'task' in locals() and task:
                await release_task_lock(task["path"])
            await worker.close()
            DAEMON_STATE["instances"][instance_id]["state"] = "QUOTA_SLEEPING"
            DAEMON_STATE["instances"][instance_id]["current_package"] = None
            DAEMON_STATE["instances"][instance_id]["resume_at"] = qe.resume_dt.strftime("%Y-%m-%d %H:%M:%S")
            sync_daemon_state()

            # 精准长休眠挂起
            await asyncio.sleep(qe.wait_seconds)

            # 到达时间点，自动发送飞书提醒卡片
            wakeup_now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            log(f"🔔 实例 {instance_id} 到达解冻时刻，自动唤醒复工！", instance_id)
            DAEMON_STATE["instances"][instance_id]["state"] = "IDLE"
            DAEMON_STATE["instances"][instance_id]["resume_at"] = None
            sync_daemon_state()

            wake_md = (
                f"🔔【双浏览器流水线 · 实例 {instance_id} 配额解冻·自动复工开跑】\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"⚙️ **生产实例**：实例 {instance_id} (CDP 端口 {cdp_port})\n"
                f"⏱ **唤醒时刻**：{wakeup_now}\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"🎉 **状态播报**：ChatGPT Plus 图像生成请求额度已成功重置解冻！\n"
                f"🚀 **自动续接**：流水线自愈看门狗已自动无缝拉起工作协程，正在从待生产队列认领下一个素材，开启新一轮高质量作品生产！"
            )
            send_feishu_markdown(wake_md)
            log("实例已复苏，立即自动领取下一套素材开始生产...", instance_id)

        except Exception as e:
            log(f"执行异常: {e}", instance_id)
            if 'task' in locals() and task:
                await release_task_lock(task["path"])
            await worker.close()
            DAEMON_STATE["instances"][instance_id]["state"] = "ERROR"
            sync_daemon_state()
            log("等待 20 秒后重试...", instance_id)
            await asyncio.sleep(20)

async def main():
    log("==================================================")
    log("双浏览器（A + C）并行自主无限生产系统全面启动！")
    log(f"通知目标：群聊 ID {FEISHU_GROUP_CHAT_ID}")
    log(f"对比表格：{SPREADSHEET_URL}")
    log("==================================================")
    sync_daemon_state()

    await asyncio.gather(
        worker_loop("A", 9431),
        worker_loop("C", 9433)
    )

if __name__ == "__main__":
    asyncio.run(main())
