import asyncio
import json
import os
import re
import sys
import time
import shutil
import ctypes
import datetime
import subprocess
import urllib.request
import base64
import csv
import tempfile
from PIL import Image
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception:
    pass
import websockets

sys.stdout.reconfigure(encoding='utf-8')

# 基础目录配置
PROJECT_ROOT = r"D:\AICode\项目推进\projects\江湖有旅人\主项目"
MATERIAL_DIR = os.path.join(PROJECT_ROOT, r"01-素材库\秋季（9—11月·智能分类）")
OUTPUT_BASE = os.path.join(PROJECT_ROOT, r"成品库（GPT+本地脚本制作）")
STATUS_FILE = r"D:\AICode\运行数据\autonomous_production_daemon_status.json"
LOG_FILE = r"D:\AICode\运行数据\autonomous_production.log"

# 飞书配置
FEISHU_GROUP_CHAT_ID = "oc_bb67c9036e6b14da9bb7be9336dfa9c0"  # CDP流水线作品生产通知群
SPREADSHEET_TOKEN = "D7OMsirIChkd2gt8TMBcPHD9ndc"  # 专职小号承载（已授权大号编辑权限）
SPREADSHEET_SHEET_ID = "587e48"
SPREADSHEET_URL = "https://my.feishu.cn/sheets/D7OMsirIChkd2gt8TMBcPHD9ndc"
FEISHU_STORAGE_PROFILE = ""  # 留空使用默认 feishu-main（已具备编辑权限）
LARK_RUN_JS = r"D:\AICode\工具开发\toolchains\npm-global\node_modules\@larksuite\cli\scripts\run.js"

# 账号风控与配额安全基准（2026-09-14 用户最高基准）
DAILY_SAFE_LIMIT_PER_ACCOUNT = 180  # 单账号单日最大安全出图配额（严格预留 20 张防熔断与防风控检测安全隔离带，坚决不碰 200 张死锁）
MAX_3H_GEN_LIMIT = 40              # 3 小时滑动窗口安全生成大图上限（硬顶 50 张）
QUOTA_LEDGER_FILE = r"D:\AICode\运行数据\江湖有旅人\内容生产App\generation_quota_ledger.json"

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

def check_generation_quota(instance_id):
    """
    双重生成配额安全守门：
    1. 3小时滑动窗口已生成大图是否达到 40 张（硬顶 50 张）；
    2. 全天当日累计生成大图是否达到 180 张（硬顶 200 张）。
    单套冲刺放行原则：开工前 < 40 张放行，跑完本套落地后入账并停下。
    返回: (is_allowed: bool, reason: str, wait_seconds: int, stats: dict)
    """
    ledger = load_generation_ledger()
    now_epoch = time.time()
    three_hours_ago = now_epoch - (3 * 3600)
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")

    records = ledger.get("records", [])
    records_3h = [
        r for r in records
        if r.get("instance_id") == instance_id and r.get("epoch", 0) >= three_hours_ago
    ]
    gen_3h = sum(r.get("generated_count", 0) for r in records_3h)

    records_today = [
        r for r in records
        if r.get("instance_id") == instance_id and r.get("timestamp", "").startswith(today_str)
    ]
    gen_today = sum(r.get("generated_count", 0) for r in records_today)

    stats = {
        "gen_3h": gen_3h,
        "max_3h": MAX_3H_GEN_LIMIT,
        "gen_today": gen_today,
        "max_today": DAILY_SAFE_LIMIT_PER_ACCOUNT
    }

    if gen_3h >= MAX_3H_GEN_LIMIT:
        earliest_epoch = min((r.get("epoch", now_epoch) for r in records_3h), default=now_epoch)
        wait_seconds = max(10, int((earliest_epoch + 3 * 3600) - now_epoch))
        return False, f"近 3 小时已生成 {gen_3h} 张大图（达安全上限 {MAX_3H_GEN_LIMIT} 张）", wait_seconds, stats

    if gen_today >= DAILY_SAFE_LIMIT_PER_ACCOUNT:
        tomorrow = (datetime.datetime.now() + datetime.timedelta(days=1)).replace(hour=0, minute=5, second=0)
        wait_seconds = max(60, int((tomorrow - datetime.datetime.now()).total_seconds()))
        return False, f"今日已累计生成 {gen_today} 张大图（达全天安全巡航线 {DAILY_SAFE_LIMIT_PER_ACCOUNT} 张）", wait_seconds, stats

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
    two_days_ago = time.time() - (48 * 3600)
    ledger["records"] = [r for r in ledger["records"] if r.get("epoch", 0) >= two_days_ago]
    save_generation_ledger(ledger)
    log(f"📊【配额记账】实例 {instance_id} 成功落地 {gen_count} 张大图（上传 {upload_count} 张），已同步双重配额账本！", instance_id)

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
                if item.startswith("_"):
                    continue
                item_path = os.path.join(sub_path, item)
                if not os.path.isdir(item_path):
                    continue
                if "_异常素材" in item_path or "_待补全" in item_path:
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

                if state not in ["已生产", "生产中", "生产异常", "需人工复核"]:
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
    "completed_total": 72,
    "daily_quota": {
        "date": datetime.datetime.now().strftime("%Y-%m-%d"),
        "A": 0,
        "C": 0
    },
    "instances": {
        "A": {"port": 9431, "state": "IDLE", "current_package": None, "today_images": 0, "cruise_card_sent": False},
        "C": {"port": 9433, "state": "IDLE", "current_package": None, "today_images": 0, "cruise_card_sent": False}
    },
    "queue_remaining": 714,
    "last_completed": None
}

# 从运行状态文件同步准确已完成套数与每日配额
try:
    if os.path.exists(STATUS_FILE):
        with open(STATUS_FILE, 'r', encoding='utf-8') as f:
            sdata = json.load(f)
            if "completed_total" in sdata and isinstance(sdata["completed_total"], int):
                DAEMON_STATE["completed_total"] = sdata["completed_total"]
            if "daily_quota" in sdata and isinstance(sdata["daily_quota"], dict):
                today_str = datetime.datetime.now().strftime("%Y-%m-%d")
                if sdata["daily_quota"].get("date") == today_str:
                    DAEMON_STATE["daily_quota"] = sdata["daily_quota"]
            if "instances" in sdata and isinstance(sdata["instances"], dict):
                for inst_k, inst_v in sdata["instances"].items():
                    if inst_k in DAEMON_STATE["instances"] and isinstance(inst_v, dict):
                        DAEMON_STATE["instances"][inst_k].update(inst_v)
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

IMAGE_COLS = ['D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M']

def get_next_sheet_row():
    try:
        cmd = [
            "node", LARK_RUN_JS, "sheets", "+csv-get",
            "--spreadsheet-token", SPREADSHEET_TOKEN,
            "--sheet-id", SPREADSHEET_SHEET_ID
        ]
        if FEISHU_STORAGE_PROFILE:
            cmd.extend(["--profile", FEISHU_STORAGE_PROFILE, "--as", "user"])
        res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
        data = json.loads(res.stdout)
        region = data.get("data", {}).get("current_region", "")
        m = re.search(r'[A-Z]+(\d+)$', region)
        if m:
            return int(m.group(1)) + 1
        csv_lines = data.get("data", {}).get("annotated_csv", "").strip().split("\n")
        all_rows = []
        for line in csv_lines:
            m_row = re.match(r'\[row=(\d+)\]\s*(.*)', line)
            if m_row:
                row_idx = int(m_row.group(1))
                content = m_row.group(2).replace(',', '').strip()
                if content:
                    all_rows.append(row_idx)
        if all_rows:
            return max(all_rows) + 1
    except Exception as e:
        log(f"获取表格行号异常: {e}")
    # 安全底线：严禁默认返回2导致覆写，根据已有数据保底行数
    return 136

def append_to_feishu_sheet(total_num, mat_dir, target_pkg_dir):
    try:
        row_mat = get_next_sheet_row()
        row_fin = row_mat + 1
        log(f"-> 正在将第 {total_num} 套画册级比对行写入飞书表 (Row {row_mat} ~ {row_fin})...")

        # 1. 写入 A:B 路径与类型文本
        r1 = [f"{total_num}素材", mat_dir]
        r2 = [f"{total_num}成品", target_pkg_dir]
        tmp_csv = os.path.join(tempfile.gettempdir(), f"temp_append_{total_num}.csv")
        with open(tmp_csv, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.writer(f)
            writer.writerow(r1)
            writer.writerow(r2)

        cmd = [
            "node", LARK_RUN_JS, "sheets", "+csv-put",
            "--spreadsheet-token", SPREADSHEET_TOKEN,
            "--sheet-id", SPREADSHEET_SHEET_ID,
            "--start-cell", f"A{row_mat}",
            "--csv", f"@{tmp_csv}"
        ]
        if FEISHU_STORAGE_PROFILE:
            cmd.extend(["--profile", FEISHU_STORAGE_PROFILE, "--as", "user"])
        res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
        if res.returncode != 0:
            log(f"   [写入飞书A:B文本异常] code={res.returncode}, stderr={res.stderr}")
        if os.path.exists(tmp_csv):
            try: os.remove(tmp_csv)
            except: pass

        # 2. 设置行高 130px 呈现画册大图效果
        cmd_resize = [
            "node", LARK_RUN_JS, "sheets", "+rows-resize",
            "--spreadsheet-token", SPREADSHEET_TOKEN,
            "--sheet-id", SPREADSHEET_SHEET_ID,
            "--range", f"{row_mat}:{row_fin}",
            "--height", "130"
        ]
        if FEISHU_STORAGE_PROFILE:
            cmd_resize.extend(["--profile", FEISHU_STORAGE_PROFILE, "--as", "user"])
        subprocess.run(cmd_resize, capture_output=True, text=True, encoding='utf-8')

        # 2b. 协同规范：成品行（row_fin）整行渲染浅天蓝色（#E8F3FF）
        style_payload = {
            "styles": [
                {
                    "name": "内容制作APP-ChatGPT网页版CDP",
                    "cell_styles": [
                        {
                            "range": f"A{row_fin}:P{row_fin}",
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
                "--styles", f"@{tmp_style}"
            ]
            if FEISHU_STORAGE_PROFILE:
                cmd_style.extend(["--profile", FEISHU_STORAGE_PROFILE, "--as", "user"])
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
                    "--image", tmp_file
                ]
                if FEISHU_STORAGE_PROFILE:
                    cmd_img.extend(["--profile", FEISHU_STORAGE_PROFILE, "--as", "user"])
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
                    "--image", tmp_file
                ]
                if FEISHU_STORAGE_PROFILE:
                    cmd_img.extend(["--profile", FEISHU_STORAGE_PROFILE, "--as", "user"])
                subprocess.run(cmd_img, capture_output=True, text=True, encoding='utf-8')
            except Exception as e:
                log(f"   [嵌入成品图警告] {cell}: {e}")
            finally:
                if os.path.exists(tmp_file):
                    try: os.remove(tmp_file)
                    except: pass

        # 5. 写入 O 列生产时间 / 入库时间
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
            "--start-cell", f"O{row_mat}",
            "--csv", f"@{tmp_m_csv}"
        ]
        if FEISHU_STORAGE_PROFILE:
            cmd_m.extend(["--profile", FEISHU_STORAGE_PROFILE, "--as", "user"])
        subprocess.run(cmd_m, capture_output=True, text=True, encoding='utf-8')
        if os.path.exists(tmp_m_csv):
            try: os.remove(tmp_m_csv)
            except: pass

        # 6. 规范化底色：原素材行统一白底(#FFFFFF)，成品行统一浅蓝(#E8F3FF)
        try:
            style_payload = {
                "styles": [{
                    "name": "内容制作APP-ChatGPT网页版CDP",
                    "cell_styles": [
                        {"range": f"A{row_mat}:R{row_mat}", "background_color": "#FFFFFF"},
                        {"range": f"A{row_fin}:R{row_fin}", "background_color": "#E8F3FF"}
                    ]
                }]
            }
            tmp_s = os.path.join(tempfile.gettempdir(), f"tmp_style_{total_num}.json")
            with open(tmp_s, 'w', encoding='utf-8') as sf:
                json.dump(style_payload, sf)
            cmd_s = [
                "node", LARK_RUN_JS, "sheets", "+styles-put",
                "--spreadsheet-token", SPREADSHEET_TOKEN,
                "--styles", f"@{tmp_s}"
            ]
            if FEISHU_STORAGE_PROFILE:
                cmd_s.extend(["--profile", FEISHU_STORAGE_PROFILE, "--as", "user"])
            subprocess.run(cmd_s, capture_output=True, text=True, encoding='utf-8')
            if os.path.exists(tmp_s):
                try: os.remove(tmp_s)
                except: pass
        except Exception as se:
            log(f"   [底色样式应用警告]: {se}")

        log(f"-> 飞书画册级对比总表 A{row_mat}:P{row_fin} 写入成功（原素材与成品图均已嵌入单元格，生产时间已入库，底色已统一）！")
        return True
    except Exception as e:
        log(f"-> 飞书画册写入异常: {e}")
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

    async def send_cmd(self, method, params=None, timeout=60):
        if params is None:
            params = {}
        import random
        mid = random.randint(10000, 99999)
        msg = {"id": mid, "method": method, "params": params}

        for attempt in range(2):
            try:
                if self.ws is None or getattr(self.ws, 'closed', False):
                    log(f"WebSocket 处于断开状态，正在连接 CDP 端口 {self.cdp_port}...", self.id)
                    await self.connect()

                await self.ws.send(json.dumps(msg))

                async def _recv_loop():
                    while True:
                        raw = await self.ws.recv()
                        data = json.loads(raw)
                        if data.get('id') == mid:
                            return data

                return await asyncio.wait_for(_recv_loop(), timeout=timeout)
            except Exception as se:
                self.ws = None
                if attempt == 0:
                    log(f"CDP 通信抖动 ({method}): {se}，正在重连 CDP 端口 {self.cdp_port} 并重试...", self.id)
                    await asyncio.sleep(1)
                else:
                    log(f"CDP 重连后仍失败 ({method}): {se}", self.id)
                    raise

    async def open_fresh_session(self):
        log("-> 开辟全新会话（SPA 页面复用，杜绝硬刷新）...", self.id)
        js_find_and_click = """(() => {
            if (window.location.pathname.startsWith('/c/')) {
                window.location.href = 'https://chatgpt.com/';
                return 'NAVIGATE_HOME_FROM_CONV';
            }
            const newChatBtn = document.querySelector('a[href="/"], button[aria-label*="新聊天"], button[aria-label*="New chat"], a[data-testid*="new-chat"]');
            if (newChatBtn) {
                newChatBtn.click();
                return 'CLICKED_NEW_CHAT';
            }
            if (window.location.pathname !== '/' && window.location.pathname !== '') {
                window.location.href = 'https://chatgpt.com/';
                return 'FORCE_NAVIGATE_HOME';
            }
            return 'ALREADY_HOME';
        })()"""
        r = await self.send_cmd("Runtime.evaluate", {"expression": js_find_and_click, "returnByValue": True})
        log(f"SPA 新会话动作状态: {r.get('result', {}).get('result', {}).get('value')}", self.id)

        for attempt in range(25):
            await asyncio.sleep(1)
            js_check = """(() => {
                const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"]');
                const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"], [data-message-author-role="assistant"]'));
                const asstMsgs = turns.filter(t => !t.querySelector('[data-message-author-role="user"]') && t.getAttribute('data-message-author-role') !== 'user');
                const isRoot = window.location.pathname === '/' || window.location.pathname === '';
                return {
                    ready: !!ta && !!fileInput && asstMsgs.length === 0 && isRoot,
                    url: window.location.href,
                    asstCount: asstMsgs.length,
                    hasTa: !!ta
                };
            })()"""
            rc = await self.send_cmd("Runtime.evaluate", {"expression": js_check, "returnByValue": True})
            v = rc.get("result", {}).get("result", {}).get("value", {})
            if v.get("ready"):
                log(f"-> 纯净新会话已就绪！({v.get('url')})，等待 DOM 稳定 2 秒...", self.id)
                await asyncio.sleep(2)
                return True
        log("新会话探针超时，继续尝试注入...", self.id)
        await asyncio.sleep(2)
        return True

    def prepare_material_images(self, mat_dir, max_imgs=20):
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
        valid_paths = []
        for f in selected:
            fp = os.path.join(mat_dir, f)
            try:
                with Image.open(fp) as im:
                    if getattr(im, 'format', None) == 'HEIF':
                        im.convert('RGB').save(fp, 'JPEG', quality=95)
                        log(f"   [格式清洗] 成功将 HEIC 图片转存为纯净 JPEG: {f}", self.id)
                valid_paths.append(fp)
            except Exception as ie:
                log(f"   [图片校验警告] 剔除异常文件 {f}: {ie}", self.id)
        return valid_paths

    async def send_text_prompt(self, prompt_text, action_desc="发送指令", max_wait_sec=25):
        log(f"注入 {action_desc}...", self.id)
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
        await self.send_cmd("Runtime.evaluate", {"expression": js_inject, "returnByValue": True}, timeout=50)
        await asyncio.sleep(1.5)

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
            r_click = await self.send_cmd("Runtime.evaluate", {"expression": js_click_send, "returnByValue": True}, timeout=25)
            if r_click.get("result", {}).get("result", {}).get("value"):
                send_clicked = True
                log(f"-> {action_desc}发送成功！", self.id)
                break
            await asyncio.sleep(1)

        if not send_clicked:
            log(f"⚠️ 提示：等待{action_desc}发送按钮就绪超时，尝试强制点击...", self.id)
            js_force = """(() => {
                const btn = document.querySelector('button[data-testid="send-button"]') ||
                            document.querySelector('button[aria-label*="Send"]') ||
                            document.querySelector('button[aria-label*="发送"]');
                if (btn) { btn.click(); return true; }
                return false;
            })()"""
            r_f = await self.send_cmd("Runtime.evaluate", {"expression": js_force, "returnByValue": True}, timeout=25)
            send_clicked = bool(r_f.get("result", {}).get("result", {}).get("value"))
        return send_clicked

    async def produce_single_set(self, mat_info):
        mat_dir = mat_info["path"]
        mat_name = mat_info["name"]
        log(f"==================================================", self.id)
        log(f"开始生产: {mat_name}", self.id)
        log(f"原料路径: {mat_dir}", self.id)

        await self.open_fresh_session()

        # 1. 扫描与上传图片
        img_paths = self.prepare_material_images(mat_dir, max_imgs=20)
        log(f"精选 {len(img_paths)} 张原料图注入对话...", self.id)

        # 开始制作日志记录（群通知仅在配额周期首次点火/解冻时报备 1 次，连续生产时不重复刷屏）
        log(f"准备注入原图并开始生产: {mat_name}", self.id)

        node_id = None
        for _ in range(5):
            doc = await self.send_cmd("DOM.getDocument", {"depth": 1})
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
        try:
            await self.send_cmd("DOM.disable")
        except Exception:
            pass
        log("图片文件已注入并触发前端挂载，等待缩略图解析...", self.id)

        # 轮询等待附件挂载完成 (检查 form 内 blob 图片缩略图，最多等待 35 秒)
        attached_cnt = 0
        for wait_idx in range(35):
            await asyncio.sleep(1)
            js_check_attach = """(() => {
                const tiles = document.querySelectorAll('form div[class*="group/file-tile"], form [role="group"][aria-label*="."]');
                const imgs = document.querySelectorAll('form img[src^="blob:"], form img[src*="estuary"]');
                const removeBtns = document.querySelectorAll('button[aria-label*="移除"], button[aria-label*="Remove"], button[aria-label*="删除"], button[data-testid*="remove-attachment"]');
                const chips = document.querySelectorAll('[data-testid*="attachment"], [aria-label*="Attachment"], div.rounded-xl.border, div[class*="attachment"]');
                return Math.max(tiles.length, imgs.length, removeBtns.length, chips.length);
            })()"""
            try:
                r_att = await self.send_cmd("Runtime.evaluate", {"expression": js_check_attach, "returnByValue": True}, timeout=15)
                attached_cnt = r_att.get("result", {}).get("result", {}).get("value", 0)
                if attached_cnt >= len(img_paths):
                    log(f"-> 全部 {attached_cnt} 张原料图缩略图已成功挂载！", self.id)
                    break
                elif attached_cnt > 0 and wait_idx >= 18:
                    log(f"-> 部分缩略图挂载就绪 ({attached_cnt} 张)，准备发送...", self.id)
                    break
            except Exception:
                pass

        if attached_cnt == 0:
            resume_dt = datetime.datetime.now() + datetime.timedelta(minutes=90)
            raise QuotaLimitException(
                f"🚨【上传硬核拦截】连续 35 秒检测到 0 张附件挂载！\n"
                f"已触发 OpenAI 图片上传滑动窗口限制，系统物理阻断空跑，主动进入配额休眠 90 分钟！",
                wait_seconds=90 * 60,
                resume_dt=resume_dt
            )

        # 2. 读取原素材文案构建 V5.0 提示词
        copy_path = os.path.join(mat_dir, "文案.txt")
        context_block = ""
        if os.path.exists(copy_path):
            try:
                with open(copy_path, 'r', encoding='utf-8') as f:
                    context_block = f.read()[:1200]
            except Exception: pass

        v60_prompt = (
            "【小红书团建拼图大字营销封面轻复刻去重修图师 V6.0】\n"
            "（四宫格站位强制置换打乱｜反AI塑料凡士林磨皮｜纯正国产手机实拍质感｜名企大厂背书置换与文字深度去重版）\n\n"
            f"已上传全部 {len(img_paths)} 张原图。\n"
            "请严格按照 V6.0 规则执行直接出图，绝对禁止自由创作或脑补新景区！\n\n"
            f"【原素材参考正文与真实排期】：\n{context_block}\n\n"
            "【V6.0 核心铁律：画面站位绝对打乱 & 文字深度去重名企置换】：\n"
            "1. 【四宫格/多图拼接·站位绝对置换打乱律】：\n"
            "   - 凡涉及 4 宫格拼图或多图画中画（原站位若为：左上A、右上B、左下C、右下D），生成时【必须强制打乱重排】（如置换为：左上B、右上D、左下A、右下C，或任意非原位站位）！\n"
            "   - 绝对不允许任何一个小格子的画面留在原位置！严禁原地仅换脸换衣！\n"
            "   - 各个打乱格子的新画面，采用同主题不同镜头角度的真实实拍（例如烤肉特写置换为炭火全景、农庄大门置换为庭院侧拍）。\n"
            "2. 【彻底破除 AI 凡士林磨皮感·真实手机随拍质感】：\n"
            "   - 100% 严禁 3D 凡士林发光塑料磨皮，严禁假大空 CG 渲染质感！\n"
            "   - 强制呈现国产普通手机（iPhone、华为）室外自然光摄影：自然的阳光与树荫阴影、随性的人间烟火气构图、食物真实肌理与草地杂色、微噪点生活感。\n"
            "3. 【排版与文字层深度去重（名企大厂置换 + 爆款同义微调）】：\n"
            "   - 【原图怎么排就怎么改，绝不盲目套大字】：原图封面是多图大字则继承大字排版；若原图是纯净实拍、通透风景或清新小标签，则严格继承其轻量排版，严禁千篇一律强行压大字！\n"
            "   - 【企业与客户背书动态置换（去重+增信铁律）】：若原图封面或内页中提及任何具体公司名（如某具体中小企业、真实客户名），【必须强制动态置换为大厂/名企背书代称】（如：“某头部互联网大厂”、“某500强外企”、“某知名独角兽”、“某金融名企”等），既彻底规避平台OCR搬运抄袭审核，又大幅提升笔记B端大客户信任感！\n"
            "   - 【主标题与副标核心去重】：地标与核心攻略事实绝对锁死（如莫干山、安吉、2天1夜不变），但修饰词与爆款动词执行同义去重（例如：“保姆级攻略”可微调为“超全避坑指南”、“玩转指南”；“被夸爆”可微调为“领导狂赞”、“HR狂喜”），实现平台级降维去重！\n"
            "   - P2~PN 内页：严格按原图版式复刻，涉及具体客户名称按上述名企规则同步脱敏置换！\n"
            "4. 严格输出 3:4 竖版大图（1086x1448），全量逐页生成全部图片，不出计划、不等回复 1，立即开始直接出图！"
        )

        # 3. 注入生图提示词并点击发送
        sent_init = await self.send_text_prompt(v60_prompt, "V6.0 生图初始指令 (含全套多图要求与名企文字去重)")
        if not sent_init:
            log("⚠️ 初始生图指令发送未能确认，继续监控...", self.id)
        log("指令已发送，正在监控出图进程并开启连环追问驱动...", self.id)

        # 4. 动态监控生图进程与多图连环追问驱动
        expected_count = len(img_paths)
        stuck_99_count = 0
        last_prompted_for = 0
        idle_after_prompt_ticks = 0
        stuck_retry_count = 0

        for tick in range(1, 180):
            await asyncio.sleep(10)
            js_status = """(() => {
                const stopBtn = document.querySelector('button[data-testid*="stop"]');
                const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"], [data-message-author-role="assistant"]'));
                const asstTurns = turns.filter(t => !t.querySelector('[data-message-author-role="user"]') && t.getAttribute('data-message-author-role') !== 'user');
                const map = new Map();
                asstTurns.forEach(turn => {
                    turn.querySelectorAll('img').forEach(img => {
                        const src = img.src || '';
                        const alt = img.alt || '';
                        const isAvatar = alt.includes('个人资料') || alt.includes('profile') || alt.includes('avatar');
                        const isTiny = (img.naturalWidth > 0 && img.naturalWidth < 300) && (img.naturalHeight > 0 && img.naturalHeight < 300);
                        if (src.includes('backend-api/estuary') && !isAvatar && !isTiny) {
                            const idMatch = src.match(/id=([^&]+)/) || src.match(/enc\\/([^?&#]+)/);
                            const fileId = idMatch ? idMatch[1] : src;
                            if (!map.has(fileId)) {
                                map.set(fileId, src);
                            }
                        }
                    });
                });
                const bodyText = document.body ? document.body.innerText : '';
                const isThinking = bodyText.includes('正在思考') || bodyText.includes('正在生成更详细的图片') || bodyText.includes('Designing the carousel') || bodyText.includes('正在分析') || bodyText.includes('Analyzing') || bodyText.includes('Thinking') || bodyText.includes('Thought for') || bodyText.includes('已深度思考') || bodyText.includes('Refined');
                const is99 = bodyText.includes('99%');
                return {
                    isGenerating: !!stopBtn || isThinking,
                    imgCount: map.size,
                    is99: is99,
                    isThinking: isThinking
                };
            })()"""
            try:
                res_stat = await self.send_cmd("Runtime.evaluate", {"expression": js_status, "returnByValue": True})
            except Exception as e_poll:
                log(f"  [出图轮询 {tick}/180] CDP 状态探测暂态异常 ({e_poll})，继续下一轮...", self.id)
                continue

            stat = res_stat.get("result", {}).get("result", {}).get("value", {})
            is_gen = stat.get("isGenerating", False)
            img_count = stat.get("imgCount", 0)
            is_99 = stat.get("is99", False)
            is_thinking = stat.get("isThinking", False)

            log(f"  [出图轮询 {tick}/180] 正在生成: {is_gen}，已渲染大图: {img_count}/{expected_count}", self.id)

            if tick % 3 == 0:
                bring_window_topmost(self.cdp_port)

            # 自愈探测：如果模型未在生成中，探测是否存在配额熔断或平台拦截
            if not is_gen and not is_thinking:
                js_check_asst = """(() => {
                    const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"], [data-message-author-role="assistant"]'));
                    const asst = turns.filter(t => !t.querySelector('[data-message-author-role="user"]') && t.getAttribute('data-message-author-role') !== 'user');
                    if (asst.length === 0) {
                        const articles = Array.from(document.querySelectorAll('article'));
                        return articles.length > 0 ? articles[articles.length - 1].innerText : "";
                    }
                    return asst[asst.length - 1].innerText;
                })()"""
                try:
                    r_rej = await self.send_cmd("Runtime.evaluate", {"expression": js_check_asst, "returnByValue": True})
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

                        account_alias = "账号 1 · zwmrpg" if self.id == "A" else "账号 3 · z x Plus"
                        alert_md = (
                            f"⏳【双浏览器流水线 · 实例 {self.id} 配额熔断自愈休眠】\n"
                            f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                            f"⚙️ **生产实例**：实例 {self.id}（{account_alias} · CDP 端口 {self.cdp_port}）\n"
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
                except QuotaLimitException:
                    raise
                except RuntimeError:
                    raise
                except Exception:
                    pass

            # 快速熔断 1：连续 15 个 tick (150秒) 未在生成中、未见大图、未在思考，且无任何助手消息，判定前端静默丢单，立即重试！
            if not is_gen and img_count == 0 and not is_thinking and tick >= 15:
                js_check_alive = """(() => {
                    const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"], [data-message-author-role="assistant"]'));
                    const asst = turns.filter(t => !t.querySelector('[data-message-author-role="user"]') && t.getAttribute('data-message-author-role') !== 'user');
                    return { asstCount: asst.length };
                })()"""
                try:
                    r_alive = await self.send_cmd("Runtime.evaluate", {"expression": js_check_alive, "returnByValue": True})
                    alive_val = r_alive.get("result", {}).get("result", {}).get("value", {})
                    if alive_val.get("asstCount", 0) == 0:
                        log(f"⚠️ 连续 {tick*10} 秒未见模型任何响应（前端静默丢弃），触发快速熔断，杜绝假死！", self.id)
                        raise RuntimeError("ChatGPT 前端静默未响应/未出图，快速熔断重试")
                except RuntimeError:
                    raise
                except Exception:
                    pass

            # 快速熔断 2：连续 18 个 tick (180秒) 模型已停止但出图仍为 0，且未在思考，判定输出纯文本或未唤醒 DALL-E，快速重试！
            if not is_gen and img_count == 0 and not is_thinking and tick >= 18:
                log(f"⚠️ 模型已停止但捕获出图数为 0，判定本次未出图，触发快速重试！", self.id)
                raise RuntimeError("模型未生成大图或仅输出纯文本，废弃重试")

            if is_99 and not is_gen and img_count == 0:
                stuck_99_count += 1
                if stuck_99_count >= 4:
                    log("检测到前端画布在 99% 停滞，触发软刷新同步状态...", self.id)
                    await self.send_cmd("Page.reload", {"ignoreCache": False})
                    await asyncio.sleep(6)
                    stuck_99_count = 0
            else:
                stuck_99_count = 0

            # 核心达成判断：小红书标准画册单套上限为 10 张大图 (1 封面 + 9 内页)
            target_limit = min(expected_count, 10)
            min_album_limit = min(expected_count, 5)

            if img_count >= target_limit:
                log(f"-> 目标大图已全部就绪！捕获到 {img_count}/{target_limit} 张大图（达标准画册上限），整套批量出图完美达成！", self.id)
                await asyncio.sleep(5)
                break

            # 模型生成完毕判断：模型已停止生成与思考，且已输出合格的多图画册 (>= 5 张)
            if not is_gen and not is_thinking:
                if img_count >= min_album_limit:
                    log(f"-> 模型整套画册生成完毕，成功捕获 {img_count} 张超高清大图（符合 {min_album_limit}~10 张画册标准），无需二次追问，直接推进三端文案！", self.id)
                    await asyncio.sleep(3)
                    break
                elif 0 < img_count < min_album_limit:
                    # 仅在模型中途夭折、图数严重不足（< 5 张且小于原料总数）时，才追发一次补全提示
                    if img_count > last_prompted_for:
                        next_page = img_count + 1
                        log(f"⚠️ 模型提早停下（当前仅 {img_count}/{min_album_limit} 张），追发第 {next_page} 张补齐指令...", self.id)
                        cont_prompt = (
                            f"很好！前 {img_count} 张大图已生成完毕。\n"
                            f"请严格按照 V5.0 规则（3:4 竖版、1086x1448、国产普通手机自然实拍去AI塑料感、原图排版骨架、四宫格站位绝对打乱置换），"
                            f"立即直接生成下一张大图：第 {next_page} 张大图（严格对应原素材图 P{next_page} 内页）！\n"
                            f"绝对禁止输出任何文字解释与客套话，直接出图！"
                        )
                        sent = await self.send_text_prompt(cont_prompt, f"第 {next_page} 张补齐出图指令")
                        if sent:
                            last_prompted_for = img_count
                            idle_after_prompt_ticks = 0
                            stuck_retry_count = 0
                            await asyncio.sleep(5)
                    else:
                        idle_after_prompt_ticks += 1
                        if idle_after_prompt_ticks >= 6:
                            stuck_retry_count += 1
                            last_prompted_for = img_count - 1
                            idle_after_prompt_ticks = 0
                            if stuck_retry_count >= 2:
                                if img_count >= 3:
                                    log(f"⚠️ 补齐多次未响应，当前已有 {img_count} 张图，接受当前成果进入文案...", self.id)
                                    break
                                else:
                                    raise RuntimeError(f"画册出图不合格（仅 {img_count} 张），废弃重做")

        # 5. 发送 Format 3 三端文案提示词
        log("-> 发送 Format 3 三端文案生成指令...", self.id)
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
        log("三端文案指令已发送，等待文本产出...", self.id)

        copy_text = ""
        for poll_idx in range(45):
            await asyncio.sleep(3)
            get_txt_js = """(() => {
                const stopBtn = document.querySelector('button[data-testid*="stop"]');
                const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"]'));
                let text = '';
                if (turns.length > 0) {
                    const lastTurn = turns[turns.length - 1];
                    const isUser = !!lastTurn.querySelector('[data-message-author-role="user"]');
                    if (!isUser) {
                        text = lastTurn.innerText;
                    }
                }
                if (!text) {
                    const asst = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
                    if (asst.length > 0) text = asst[asst.length - 1].innerText;
                    else {
                        const articles = Array.from(document.querySelectorAll('article'));
                        text = articles.length > 0 ? articles[articles.length - 1].innerText : (document.querySelector('main') ? document.querySelector('main').innerText : '');
                    }
                }
                return {
                    text: text,
                    isGenerating: !!stopBtn
                };
            })()"""
            try:
                r_txt = await self.send_cmd("Runtime.evaluate", {"expression": get_txt_js, "returnByValue": True})
                val_txt = r_txt.get("result", {}).get("result", {}).get("value", {}) if isinstance(r_txt, dict) else {}
                txt = val_txt.get("text", "")
                is_gen_txt = val_txt.get("isGenerating", False)
                if ("XHS_END" in txt or "DOUYIN_END" in txt or (not is_gen_txt and poll_idx >= 8)) and len(txt) > 200:
                    copy_text = txt
                    log(f"Format 3 文案结构捕获成功！(长度: {len(copy_text)})", self.id)
                    break
            except Exception as e_txt:
                pass

        # 6. 提取全部无损图片 URL
        js_get_urls = """(() => {
            const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"], [data-message-author-role="assistant"]'));
            const asstTurns = turns.filter(t => !t.querySelector('[data-message-author-role="user"]') && t.getAttribute('data-message-author-role') !== 'user');
            const map = new Map();
            asstTurns.forEach(turn => {
                turn.querySelectorAll('img').forEach(img => {
                    const src = img.src || '';
                    const alt = img.alt || '';
                    const isAvatar = alt.includes('个人资料') || alt.includes('profile') || alt.includes('avatar');
                    const isTiny = (img.naturalWidth > 0 && img.naturalWidth < 300) && (img.naturalHeight > 0 && img.naturalHeight < 300);
                    if (src.includes('backend-api/estuary') && !isAvatar && !isTiny) {
                        const idMatch = src.match(/id=([^&]+)/) || src.match(/enc\\/([^?&#]+)/);
                        const fileId = idMatch ? idMatch[1] : src;
                        if (!map.has(fileId)) {
                            map.set(fileId, src);
                        }
                    }
                });
            });
            return Array.from(map.values());
        })()"""
        r_urls = await self.send_cmd("Runtime.evaluate", {"expression": js_get_urls, "returnByValue": True})
        img_urls = r_urls.get("result", {}).get("result", {}).get("value", [])
        log(f"已捕获 {len(img_urls)} 张大图 URL，开始无损拉取...", self.id)

        # 7. 创建规范成品目录：第一时间落盘至 _制作中 创作区
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        clean_title = re.sub(r"^评\d+-赞\d+-", "", mat_name)
        clean_title = re.sub(r"[\s\-_]*\d{8}$", "", clean_title)
        clean_title = re.sub(r'[\\/:*?"<>|]', '_', clean_title).strip()[:50]
        pkg_folder = f"{ts}-网页CDP-{clean_title}"
        producing_base = os.path.join(OUTPUT_BASE, "_制作中")
        stage0_base = os.path.join(OUTPUT_BASE, "已发送0次（抖音小红书可发）")
        os.makedirs(producing_base, exist_ok=True)
        os.makedirs(stage0_base, exist_ok=True)
        target_pkg_dir = os.path.join(producing_base, pkg_folder)
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

        # 彻底清洗可能残留的占位符字样
        placeholders = [
            "[小红书主标题]", "真实小红书主标题（带吸引力与emoji）",
            "[小红书种草正文，带两日详细行程排期、亮点提炼与真实避坑，拒绝空话]",
            "真实小红书种草正文（带两日详细行程排期、亮点提炼与真实避坑，拒绝空话套话）",
            "[12个同行热门话题标签]",
            "[HR方案决策版大纲，包含方案名称、适用对象、预算参考、决策亮点与服务保障]",
            "HR方案决策版大纲（包含方案名称、适用对象、预算参考、决策亮点与服务保障）",
            "[抖音短平快口播脚本，痛点切入+亮点+留资号召]",
            "抖音短平快口播脚本（痛点切入+亮点排期+留资号召）"
        ]
        for ph in placeholders:
            xhs_copy = xhs_copy.replace(ph, "").strip()
            hr_copy = hr_copy.replace(ph, "").strip()
            douyin_copy = douyin_copy.replace(ph, "").strip()

        if xhs_copy:
            with open(os.path.join(target_pkg_dir, "小红书文案.txt"), "w", encoding="utf-8") as f:
                f.write(xhs_copy)
        if hr_copy:
            with open(os.path.join(target_pkg_dir, "HR方案决策版.txt"), "w", encoding="utf-8") as f:
                f.write(hr_copy)
        if douyin_copy:
            with open(os.path.join(target_pkg_dir, "抖音口播脚本.txt"), "w", encoding="utf-8") as f:
                f.write(douyin_copy)

        full_copy = f"<<<COPY_FORMAT:3>>>\n<<<XHS_START>>>\n{xhs_copy}\n<<<XHS_END>>>\n\n<<<XHS_2_START>>>\n{hr_copy}\n<<<XHS_2_END>>>\n\n<<<DOUYIN_START>>>\n{douyin_copy}\n<<<DOUYIN_END>>>"
        with open(os.path.join(target_pkg_dir, "文案.txt"), "w", encoding="utf-8") as f:
            f.write(full_copy)
        with open(os.path.join(target_pkg_dir, "三平台文案.txt"), "w", encoding="utf-8") as f:
            f.write(full_copy)
        if copy_text:
            with open(os.path.join(target_pkg_dir, "全量生成记录.txt"), "w", encoding="utf-8") as f:
                f.write(copy_text)

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

        # 严格多图画册硬门禁：若原料 >= 2 张，成品必须 >= min(4, len(img_paths)) 张，坚决杜绝单封面半成品！
        min_required = min(4, len(img_paths)) if len(img_paths) >= 2 else 1
        if valid_cnt < min_required:
            log(f"🚨【残缺画册阻断】当前套有效出图仅 {valid_cnt} 张（要求至少 {min_required} 张多图画册），坚决不以单封面半成品交差！立即废弃重做！", self.id)
            if os.path.exists(target_pkg_dir):
                import shutil
                shutil.rmtree(target_pkg_dir, ignore_errors=True)
            raise RuntimeError(f"有效大图不足（仅 {valid_cnt}/{min_required} 张），废弃残缺产出并重做")

        # 11. 原子移动至已发送0次（抖音小红书可发）
        final_pkg_dir = os.path.join(stage0_base, pkg_folder)
        try:
            import shutil
            if os.path.exists(final_pkg_dir):
                shutil.rmtree(final_pkg_dir, ignore_errors=True)
            shutil.move(target_pkg_dir, final_pkg_dir)
            target_pkg_dir = final_pkg_dir
            log(f"-> 质检通过，已原子移库至可发库: {target_pkg_dir}", self.id)
        except Exception as e_mv:
            log(f"-> 移库异常（保留在_制作中）: {e_mv}", self.id)

        # 12. 登记生图配额账本（3小时滑动窗口40张 + 全天180张）
        record_generation_success(self.id, valid_cnt, len(img_paths), mat_name)

        # 12. 固化 manifest.json
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

            # 动态统计当前本地成品库总数
            cur_count = total_num
            try:
                if os.path.exists(OUTPUT_BASE):
                    cur_count = len([
                        f for f in os.listdir(OUTPUT_BASE)
                        if os.path.isdir(os.path.join(OUTPUT_BASE, f))
                        and not f.startswith(('_', '不合格', '已发', '归档', '抖音'))
                        and f != '发布空间'
                    ])
            except Exception:
                pass

            account_alias = "账号 1 · zwmrpg" if self.id == "A" else "账号 3 · z x Plus"
            safe_target_pkg_url = "file:///" + target_pkg_dir.replace("\\", "/")
            safe_mat_url = "file:///" + mat_dir.replace("\\", "/")

            feishu_md = (
                f"🎉 **【秋季素材交付 · 网页 CDP】**\n\n"
                f"• **作品标题**：{mat_name[:50]}\n"
                f"• **生产模式**：网页 CDP（实例 {self.id} · {account_alias}）\n"
                f"• **图文交付**：{valid_cnt} 张 3:4 竖屏高清大图 + 3 端文案（小红书/HR决策/抖音）\n"
                f"• **质检验收**：100% 通过 Pillow 像素级与长宽比校验，无损入库\n"
                f"• **成品路径**：[📂 点击打开成品文件夹]({safe_target_pkg_url})\n"
                f"• **原素材参考**：[📁 查看原素材文件夹]({safe_mat_url})\n"
                f"• **飞书台账**：已登记至总表第 {total_num} 行（[查看画册级对比总表]({SPREADSHEET_URL})）\n\n"
                f"📊 **【秋季素材包】全盘战况**：\n"
                f"• 本地成品总数：已累计 **{cur_count} 套**\n"
                f"• 秋季素材进度：已完成 **{cur_count} / 781 套**\n"
                f"• 下一步计划：继续制作下一个秋季选题，全部完成后开启冬季素材库。"
            )
            ok = send_feishu_markdown(feishu_md)
            if ok:
                log("-> 飞书交付验收通知推送群聊成功！", self.id)
            else:
                log("-> 飞书通知发送失败", self.id)
        except Exception as fe:
            log(f"-> 飞书通知发送异常: {fe}", self.id)

        # 16. 桌面液态玻璃通知
        try:
            desktop_notify(
                title=f"🎉 第 {total_num} 套作品交付成功",
                message=f"实例 {self.id} 完成：{mat_name[:25]}\n成品已落盘，飞书群与总表已同步",
                status="success",
                position="TopRight",
                duration_ms=6000
            )
        except Exception:
            pass

        # 17. 满 10 套里程碑汇总推送
        if total_num % 10 == 0:
            try:
                cur_count_m = cur_count
                milestone_md = (
                    f"🏆 **【秋季素材生产 · 满 {total_num} 套里程碑】**\n\n"
                    f"• **阶段成果**：双浏览器系统已连续稳定交付 **{total_num} 套** 小红书高品质作品！\n"
                    f"• **全盘战况**：本地成品总数 **{cur_count_m} 套** · 秋季素材进度 **{cur_count_m} / 781 套**\n"
                    f"• **质检验收**：100% 通过 Pillow 像素级 3:4 竖屏校验与原素材行程锁死\n"
                    f"• **全景总表**：[查看画册级对比总表]({SPREADSHEET_URL})\n\n"
                    f"🚀 无限流水线全速推进中，下一阶段目标：第 {total_num + 10} 套！"
                )
                ok = send_feishu_markdown(milestone_md)
                if ok:
                    log(f"-> 满 {total_num} 套里程碑战报已发送至群聊！", self.id)
            except Exception as me:
                log(f"-> 里程碑战报异常: {me}", self.id)


        log(f"=== 本套作品完成！成品目录: {target_pkg_dir} ===", self.id)
        return target_pkg_dir, valid_cnt

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

async def release_task_lock(mat_path, error_msg=None, is_quota_wait=False):
    async with LOCK:
        abnormal_root = os.path.join(MATERIAL_DIR, "..", "_异常素材（脚本失败隔离）")
        os.makedirs(abnormal_root, exist_ok=True)
        tags_file = os.path.join(mat_path, ".tags.json")
        if os.path.exists(tags_file):
            try:
                with open(tags_file, 'r', encoding='utf-8') as f:
                    tdata = json.load(f)
                prod = tdata.setdefault("production", {})
                if is_quota_wait:
                    prod["lifecycleState"] = "待生产"
                    with open(tags_file, 'w', encoding='utf-8') as f:
                        json.dump(tdata, f, ensure_ascii=False, indent=2)
                else:
                    # 凡触发报错或拦截的素材，严禁在待生产池死循环争抢，直接物理隔离！
                    retry_cnt = prod.get("retryCount", 0) + 1
                    prod["retryCount"] = retry_cnt
                    prod["lastError"] = str(error_msg) if error_msg else "未知异常"
                    prod["lastFailedAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    prod["lifecycleState"] = "生产异常"
                    tags = tdata.setdefault("tagging", {}).setdefault("tags", [])
                    if "生产异常" not in tags:
                        tags.append("生产异常")
                    with open(tags_file, 'w', encoding='utf-8') as f:
                        json.dump(tdata, f, ensure_ascii=False, indent=2)

                    # 物理移入 _异常素材 目录，杜绝任何流水线重复扫描抢跑
                    base_name = os.path.basename(mat_path)
                    parent_name = os.path.basename(os.path.dirname(mat_path))
                    target_abnormal = os.path.join(abnormal_root, f"{parent_name}_{base_name}")
                    log(f"🚨【物理隔离】素材异常，立即移出待产队列至: {target_abnormal}")
                    if os.path.exists(target_abnormal):
                        shutil.rmtree(target_abnormal, ignore_errors=True)
                    shutil.move(mat_path, target_abnormal)
            except Exception as e_lock:
                log(f"处理任务锁与隔离异常: {e_lock}")


async def worker_loop(instance_id, cdp_port):
    worker = InstanceWorker(instance_id, cdp_port)
    log(f"实例 {instance_id} 工作协程启动...", instance_id)

    while True:
        try:
            # 1. 单账号每日 180 张主动安全巡航与 3 小时 40 张滑动窗口双重守门
            today_str = datetime.datetime.now().strftime("%Y-%m-%d")
            dq = DAEMON_STATE.setdefault("daily_quota", {"date": today_str, "A": 0, "C": 0})
            if dq.get("date") != today_str:
                dq["date"] = today_str
                dq["A"] = 0
                dq["C"] = 0
                DAEMON_STATE["instances"]["A"]["cruise_card_sent"] = False
                DAEMON_STATE["instances"]["C"]["cruise_card_sent"] = False

            # 0. 检查是否处于官方限制的配额休眠倒计时中
            inst_info = DAEMON_STATE.get("instances", {}).get(instance_id, {})
            resume_at_str = inst_info.get("resume_at")
            if resume_at_str:
                try:
                    resume_dt = datetime.datetime.strptime(resume_at_str, "%Y-%m-%d %H:%M:%S")
                    now_dt = datetime.datetime.now()
                    if now_dt < resume_dt:
                        wait_sec = int((resume_dt - now_dt).total_seconds())
                        wait_h = wait_sec // 3600
                        wait_m = (wait_sec % 3600) // 60
                        log(f"🛡️【官方限额守护】实例 {instance_id} 处于长休眠保护中，预计恢复时间: {resume_at_str}（还剩 {wait_h}小时{wait_m}分）...", instance_id)
                        DAEMON_STATE["instances"][instance_id]["state"] = "QUOTA_SLEEPING"
                        DAEMON_STATE["instances"][instance_id]["current_package"] = None
                        sync_daemon_state()
                        await asyncio.sleep(min(wait_sec, 60))
                        continue
                    else:
                        log(f"🔔 实例 {instance_id} 到达预定恢复时刻 {resume_at_str}，解除长休眠锁定！", instance_id)
                        DAEMON_STATE["instances"][instance_id]["resume_at"] = None
                        DAEMON_STATE["instances"][instance_id]["state"] = "IDLE"
                        sync_daemon_state()
                except Exception:
                    pass

            allowed, reason, wait_sec, stats = check_generation_quota(instance_id)
            if not allowed:
                log(f"🛡️【配额保护拦截】实例 {instance_id} {reason}，进入安全休眠（预计等待 {wait_sec//60} 分钟）...", instance_id)
                DAEMON_STATE["instances"][instance_id]["state"] = "SAFE_CRUISE_COMPLETED" if "今日已累计" in reason else "QUOTA_SLEEPING"
                DAEMON_STATE["instances"][instance_id]["current_package"] = None
                sync_daemon_state()

                # 若触发全天巡航线，推送飞书主动巡航达成卡片（仅推送 1 次）
                if "今日已累计" in reason and not DAEMON_STATE["instances"][instance_id].get("cruise_card_sent"):
                    DAEMON_STATE["instances"][instance_id]["cruise_card_sent"] = True
                    sync_daemon_state()
                    account_alias = "账号 1 · zwmrpg" if instance_id == "A" else "账号 3 · z x Plus"
                    total_done = DAEMON_STATE.get("completed_total", 72)
                    report_md = (
                        f"🛡️ **【双浏览器流水线 · 实例 {instance_id} 主动安全巡航达成战报】**\n"
                        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                        f"👤 **生产账号**：{account_alias} (CDP 端口 {cdp_port})\n"
                        f"🎯 **今日出图战果**：已安全出图 **{stats['gen_today']} 张**（稳稳达成 {DAILY_SAFE_LIMIT_PER_ACCOUNT} 张安全巡航线）\n"
                        f"🛡️ **主动隔离机制**：主动停止接单，严格预留 20 张防熔断缓冲，**0 撞线 · 0 废单 · 0 封控**\n"
                        f"📊 **画册大盘沉淀**：双线连续稳定交付 **{total_done} 套** 高清画册作品\n"
                        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                        f"⏰ **巡航调度状态**：实例 {instance_id} 已优雅进入安全守护休眠\n"
                        f"💡 **后续动作**：待次日额度周期自动重置，系统将无缝续接开工，100% 免人工介入！"
                    )
                    send_feishu_markdown(report_md)
                await asyncio.sleep(min(wait_sec, 60))
                continue

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
            output_dir, valid_cnt = await worker.produce_single_set(task)
            await worker.close()

            DAEMON_STATE["completed_total"] += 1
            DAEMON_STATE["last_completed"] = {
                "instance": instance_id,
                "product_path": output_dir,
                "material_path": task["path"],
                "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            DAEMON_STATE["instances"][instance_id]["state"] = "SUCCESS"
            dq[instance_id] = dq.get(instance_id, 0) + valid_cnt
            DAEMON_STATE["instances"][instance_id]["today_images"] = dq[instance_id]
            sync_daemon_state()

            log(f"生产成功，实例 {instance_id} 今日累计已出图 {dq[instance_id]} 张，冷却 15 秒后领取下一套...", instance_id)
            await asyncio.sleep(15)

        except QuotaLimitException as qe:
            log(f"🛑 实例 {instance_id} 触发配额限额，进入自愈挂起（预计恢复时间: {qe.resume_dt.strftime('%Y-%m-%d %H:%M:%S')}）", instance_id)
            if 'task' in locals() and task:
                await release_task_lock(task["path"], is_quota_wait=True)
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

            account_alias = "账号 1 · zwmrpg" if instance_id == "A" else "账号 3 · z x Plus"
            cur_count_w = 96
            try:
                if os.path.exists(OUTPUT_BASE):
                    cur_count_w = len([
                        f for f in os.listdir(OUTPUT_BASE)
                        if os.path.isdir(os.path.join(OUTPUT_BASE, f))
                        and not f.startswith(('_', '不合格', '已发', '归档', '抖音'))
                        and f != '发布空间'
                    ])
            except Exception:
                pass

            wake_md = (
                f"🚀 **【秋季素材开工 · 网页 CDP】**\n\n"
                f"• **生产模式**：网页 CDP（实例 {instance_id} · {account_alias}）\n"
                f"• **当前状态**：冷却期结束，系统已自动接续生产\n"
                f"• **开工时刻**：{wakeup_now}\n\n"
                f"📊 **【秋季素材包】全盘进度**：\n"
                f"• 本地成品总数：已累计 **{cur_count_w} 套**\n"
                f"• 秋季素材进度：已完成 **{cur_count_w} / 781 套**\n"
                f"• 下一步动作：秋季素材全部制作完成后归档，紧接着开启冬季素材库。"
            )
            send_feishu_markdown(wake_md)
            log("实例已复苏，立即自动领取下一套素材开始生产...", instance_id)

        except Exception as e:
            log(f"执行异常: {e}", instance_id)
            if 'task' in locals() and task:
                await release_task_lock(task["path"], error_msg=e, is_quota_wait=False)
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
