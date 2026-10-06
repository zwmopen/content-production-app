import asyncio
import json
import os
import re
import sys
import time
import random
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
# [2026-09-26 新增] 全局人工急停开关（可复用能力）
#   只要该文件存在且未过期，所有实例协程立刻挂起：不领料、不上传、不提交，
#   但进程保持存活（守护不会重拉），便于人工整理 ChatGPT 会话 / 做删除操作。
#   文件格式：HALT=1 / EXPIRES=yyyy-MM-dd HH:mm:ss / REASON=xxx
HALT_FLAG_FILE = r"D:\AICode\运行数据\production_halt.flag"
AUTUMN_C_TASKS_FILE = os.path.join(
    PROJECT_ROOT,
    r"04-技能库\运行记录\秋季四路并发任务\AUTUMN-C_tasks.json"
)
# [2026-09-28 修] 成品库 V5.1 架构重整（12:10）把在役账本归档进 _内部台账与历史数据，
# 旧根路径已不存在 → 每次启动「AUTUMN-C 对账失败」。改为新家优先、老路径兜底。
_AUTUMN_C_PROGRESS_NEW = os.path.join(OUTPUT_BASE, "_内部台账与历史数据", "_progress_AUTUMN_C.json")
AUTUMN_C_PROGRESS_FILE = (
    _AUTUMN_C_PROGRESS_NEW
    if os.path.exists(_AUTUMN_C_PROGRESS_NEW)
    else os.path.join(OUTPUT_BASE, "_progress_AUTUMN_C.json")
)

# 【2026-09-27 修·附件判据全面失效 = 产线零产出 + 好素材被批量误隔离的元凶】
# 旧判据（只认 `form img[src^="blob:"]` 与 `button[aria-label*="移除文件"]`）在新版 UI 上
# **两条同时归零**。CDP 实测铁证（00:44）：页面里 `form img` 有整整 10 张缩略图、
# `[aria-label*="移除"]` 有 11 个，而四条旧判据全部返回 0 ——
# 于是「上传 10 张 → 判 0 张 → 空发送闸门拦下 → 整套判失败 → 素材被物理隔离」，
# 一套接一套地把好素材搬进隔离区，产线永远出不了图。
# 新判据：①form 内真图（按 src 长度与类型剔除 icon）；②各 file input 的 files 总数；
# ③附件 tile；④任何"移除/Remove/删除文件"类 aria-label（只作有无佐证，不参与取大，
# 避免把 11 个无关按钮当成 11 张图）。
_JS_COUNT_ATTACH = """(() => {
    const imgs = Array.from(document.querySelectorAll('form img')).filter(i => {
        const s = i.getAttribute('src') || '';
        if (!s || s.length < 20) return false;
        if (s.indexOf('svg') === 0 || s.indexOf('data:image/svg') === 0) return false;
        return true;
    });
    const tiles = document.querySelectorAll('form [role="group"][aria-label*="."]');
    const inps = Array.from(document.querySelectorAll('input[type="file"]'));
    const fileCount = inps.reduce((a, i) => a + (i.files ? i.files.length : 0), 0);
    const removeLike = document.querySelectorAll(
        '[aria-label*="移除文件"], [aria-label*="Remove file"], [aria-label*="移除"], [aria-label*="Remove"]');
    const raw = Math.max(imgs.length, tiles.length, fileCount);
    return raw > 0 ? raw : (removeLike.length > 0 ? 1 : 0);
})()"""

# 飞书配置
FEISHU_GROUP_CHAT_ID = "oc_a620407b836cb421f8bb72c0d6f596f1"  # 飞书作品流水线作品生产通知群
# 【2026-09-24 新增】运维状态专群（用户拍板："运维状态全迁过去，流水线群只留成品交付与生产战报"）
# 走这个群：配额熔断 / 复工解冻 / 复工探额复查 / 异常隔离告警
FEISHU_OPS_CHAT_ID = "oc_079f4782ac3edf699a3be2d4118bb8fa"     # 网页CDP状态检测群
SPREADSHEET_TOKEN = "D7OMsirIChkd2gt8TMBcPHD9ndc"  # 专职小号承载（已授权大号编辑权限）
SPREADSHEET_SHEET_ID = "pVD1I4"
SPREADSHEET_URL = "https://my.feishu.cn/sheets/D7OMsirIChkd2gt8TMBcPHD9ndc?sheet=pVD1I4"
FEISHU_STORAGE_PROFILE = "feishu-main"
LARK_RUN_JS = r"D:\AICode\工具开发\toolchains\npm-global\node_modules\@larksuite\cli\scripts\run.js"

# 账号风控与配额安全基准（2026-09-14 用户最高基准）
# 【2026-09-22 用户口径最终确认】单账号安全线：
#   · 官方日上限 ≈ 200 张/账号 → 本地做到 180 张即停（留 20 张余量）
#   · 3 小时滑动窗口安全线 40 张/账号
#   两个账号官方额度相互独立 → 各自独立计数、互不影响（按实例配置）。
#   真正的硬顶是「官方临时上限」：撞上后由官方限额守护按官方给出的重置时刻长休眠，
#   休眠期间本地不再尝试出图 —— 这是预期行为，不是故障。
#   历史实测（仅作背景参考，不作为阈值依据）：A 单日 51 张曾撞官方上限（封约 7h）；
#   B 单日 122 张曾撞上限（封约 3h8m）。
DAILY_SAFE_LIMIT_PER_ACCOUNT = 180  # 兜底默认值（未单独配置的实例使用）
# 按实例配置的全天安全巡航线（如需给某账号单独收紧，只改这里）
DAILY_SAFE_LIMIT_BY_INSTANCE = {
    "A": 180,
    "B": 180,
}
MAX_3H_GEN_LIMIT = 40              # 3 小时滑动窗口安全生成大图上限（硬顶 50 张）—— 兜底默认值
# 按实例配置的 3 小时滑窗安全上限
MAX_3H_GEN_LIMIT_BY_INSTANCE = {"A": 40, "B": 40}


def max_3h_limit_for(instance_id):
    """返回该实例的 3 小时滑窗安全上限（未配置则用默认值）。"""
    return MAX_3H_GEN_LIMIT_BY_INSTANCE.get(str(instance_id).upper(), MAX_3H_GEN_LIMIT)


def daily_limit_for(instance_id):
    """返回该实例的全天安全巡航线（两个账号官方额度独立，故按实例配置）。"""
    return DAILY_SAFE_LIMIT_BY_INSTANCE.get(str(instance_id).upper(), DAILY_SAFE_LIMIT_PER_ACCOUNT)



QUOTA_LEDGER_FILE = r"D:\AICode\运行数据\江湖有旅人\内容生产App\generation_quota_ledger.json"

# 接入共享液态玻璃桌面通知技能
sys.path.append(r"D:\AICode\AI\skills\技能包\技能\shared-notification\scripts")
try:
    from shared_notify import notify as desktop_notify
except Exception:
    def desktop_notify(*args, **kwargs): return False

# 接入文案落盘出口守卫（2026-09-21）
# 背景：copy_formatter.clean_entire_copy 有两条静默降级路径（ok=False / 抛异常），
#      旧代码在这两种情况下会把「客户端原文」直接落盘 ⇒ `标题：/正文：/话题：`
#      标签、Tab 假空行、被压平的长段逐字进成品库，再原样下发到手机剪贴板。
#      守卫在落盘前再兜一次，并在真源失效时打可 grep 的硬告警。
_GUARD_DIR = os.path.dirname(os.path.abspath(__file__))
if _GUARD_DIR not in sys.path:
    sys.path.insert(0, _GUARD_DIR)
try:
    from copy_output_guard import guard_copy_output, MAX_COPY_LINE_LEN
except Exception as _guard_ie:
    MAX_COPY_LINE_LEN = 300

    def guard_copy_output(text, tag=""):
        return True, text, {"reason": f"guard module unavailable: {_guard_ie}"}

user32 = ctypes.windll.user32

class QuotaLimitException(Exception):
    def __init__(self, message, wait_seconds, resume_dt):
        super().__init__(message)
        self.wait_seconds = wait_seconds
        self.resume_dt = resume_dt


class ModelDegradedException(QuotaLimitException):
    """【2026-09-27 新增·模型产出降级/错乱】

    与 QuotaLimitException 的区别：
      · QuotaLimitException = 官方额度上限（服务端说的，有明确重置时刻）
      · ModelDegradedException = 模型自己出问题（用户判据）：
          ① 出图严重不足：计划 10 张只出 3 张、甚至 1 张 —— 正常模型不会这样；
          ② 出图阶段却输出大量文字 —— 用户明确判定："我让出图就只该出图，
             出图顺带出文案/其他文字，就是大模型错乱了，这时候需要休息"。

    为什么继承 QuotaLimitException：
      直接复用既有「永不物理隔离素材 + 实例精确休眠 + 推运维群」的自愈路径。
      历史上素材被误隔离的教训太痛 —— 模型出问题时素材是无辜的，绝不能陪葬。
    """
    def __init__(self, message, wait_seconds=1800, resume_dt=None, kind="short_output"):
        # 必须保证 resume_dt 非空：主循环捕获处会直接 qe.resume_dt.strftime(...)，
        # 传 None 会在熔断路径上二次崩溃（反而让素材无人释放）。
        if resume_dt is None:
            resume_dt = datetime.datetime.now() + datetime.timedelta(seconds=int(wait_seconds or 1800))
        super().__init__(message, wait_seconds, resume_dt)
        self.kind = kind


# 产出质量反向识别阈值（可由用户按实际观感调整）
DEGRADE_MIN_RATIO = 0.6      # 出图数 / 计划数 低于此比例 → 判定模型产出能力降级
DEGRADE_COOLDOWN_SEC = 1800  # 判定降级后实例休息时长（默认 30 分钟）
TALKATIVE_TEXT_LIMIT = 2500  # 出图阶段模型"话痨"字数上限：超过即判定错乱

def extract_quota_signals(asst_text):
    """
    【2026-09-24 修】从配额提示文本中提取「等待秒数」候选，返回 (best_seconds, debug)。

    历史事故（实测 2026-09-14 ~ 09-24 全量日志复盘）：
      抓到的文本完整时（含"上限将在 X小时 后重置"），解析一直是对的
      （13小时→13h09m、6小时→6h08m、7小时→7h08m、11小时→11h08m 全部命中）；
      而抓到的文本被截断（只到"…图像生成请求上限"）时，正则一个数字都抓不到，
      直接回落硬编码兜底 3 小时 —— 实测 3小时06分 / 3小时08分 / 3小时09分 全是兜底值。
      截断原因是：撞限提示是流式写出来的，主脑在"你已达到 Plus 套餐的图像生成请求上限"
      刚出现时就判定撞限，此时"上限将在 X小时 后重置"还没写出来。
      → 休眠严重偏短 → 复工时官方额度其实还没回 → 立刻二次撞限（"一天连撞 4 次"的真因）。

    解析优先级（取所有候选的最大值，宁晚不早）：
      ① 「请在 HH:MM 后重试」—— 页面独立额度条上的**绝对时钟**，最权威、最精确
         （兼容官方中文的重复字 bug："请在在 12:21后重试"）
      ② 「上限将在 X小时Y分钟 后重置」—— 模型消息里的相对时长，必须带"后重置"锚点
      ③ 兜底：文本里任意 X小时 / X分钟（旧行为，仅在无锚点时用）
    """
    now = datetime.datetime.now()
    debug = {"clock": None, "clock_sec": 0, "clock_expired": None,
             "hour_min": None, "raw_hours": None, "raw_mins": None}
    cands = []

    # ① 绝对时钟（最权威）—— 但**只在它指向未来时才算数**
    m_clock = re.search(r'请\s*在\s*在?\s*(\d{1,2})\s*[:：]\s*(\d{2})\s*后重试', asst_text)
    if not m_clock:
        # 【2026-09-25 修】英文额度条的绝对时钟："Please try again after 12:21."
        m_clock = re.search(r'(?:try again\s*)?after\s+(\d{1,2})\s*[:：]\s*(\d{2})', asst_text, re.IGNORECASE)
    if m_clock:
        hh = int(m_clock.group(1))
        mm = int(m_clock.group(2))
        if 0 <= hh <= 23 and 0 <= mm <= 59:
            target = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
            sec = int((target - now).total_seconds())
            if sec > 0:
                debug["clock"] = target.strftime("%Y-%m-%d %H:%M")
                debug["clock_sec"] = sec
                cands.append(sec)
            else:
                # 【2026-09-24 二次修·重大事故复盘】时钟"已过"绝不能顺延到明天。
                # 额度条只在**发生请求**时才会被刷新；到点探额时页面是空闲的，读到的往往是
                # 上一次撞限时留下的旧文案（陈旧渲染）。
                # 实测事故：B 官方复位 12:21，12:45 探针仍读到「请在 12:21后重试」+「上限将在 5小时 后重置」
                # （后者是 07:21 写的旧文）。旧逻辑在此顺手 +1 天 → 把复工推到**次日 12:35**，
                # 白白睡掉 23 小时 50 分。
                # 正确处置：丢弃该候选（绝不 +1 天），并记录 clock_expired，由探针判「已过期 → 放行」。
                debug["clock_expired"] = target.strftime("%Y-%m-%d %H:%M")

    # ② 「上限将在 X小时Y分钟 后重置」
    m_hm = re.search(r'(\d+)\s*(?:个)?小时\s*(?:(\d+)\s*分钟)?\s*后重置', asst_text)
    if not m_hm:
        # 【2026-09-25 修】英文相对时长："Your limit will reset in 5 hours" / "Try again in 2 hours 30 minutes"
        m_hm = re.search(r'\b(?:resets?|retry|again)[^\n]{0,60}?\bin\s+(\d+)\s*hours?\s*(?:and\s*(\d+)\s*minutes?)?',
                         asst_text, re.IGNORECASE)
        if m_hm and not m_hm.group(2):
            # "in 30 minutes"（纯分钟）单独兜
            m_en_m = re.search(r'\b(?:resets?|retry|again)[^\n]{0,60}?\bin\s+(\d+)\s*minutes?', asst_text, re.IGNORECASE)
            if m_en_m:
                debug["hour_min"] = "0小时%d分(EN)" % int(m_en_m.group(1))
                cands.append(int(m_en_m.group(1)) * 60)
                m_hm = None  # 已按纯分钟计入，跳过小时分支
    if m_hm:
        h = int(m_hm.group(1))
        mi = int(m_hm.group(2) or 0)
        debug["hour_min"] = "%d小时%d分" % (h, mi)
        cands.append(h * 3600 + mi * 60)
    else:
        m_m = re.search(r'(\d+)\s*分钟\s*后重置', asst_text)
        if m_m:
            mi = int(m_m.group(1))
            debug["hour_min"] = "0小时%d分" % mi
            cands.append(mi * 60)

    # ③ 无锚点兜底（保留旧行为，避免极端情况下完全解析不出）
    if not cands:
        m_h = re.search(r'(\d+)\s*(?:个)?小时', asst_text) or re.search(r'(\d+)\s*hours?\b', asst_text, re.IGNORECASE)
        m_mi = re.search(r'(\d+)\s*分钟', asst_text) or re.search(r'(\d+)\s*minutes?\b', asst_text, re.IGNORECASE)
        h = int(m_h.group(1)) if m_h else 0
        mi = int(m_mi.group(1)) if m_mi else 0
        debug["raw_hours"] = h
        debug["raw_mins"] = mi
        if h or mi:
            cands.append(h * 3600 + mi * 60)

    return (max(cands) if cands else 0), debug


def parse_quota_wait_seconds(asst_text):
    """
    解析 ChatGPT 上限提示文本，提取剩余等待秒数（含 30~60 分钟安全防风控缓冲）。
    解析策略见 extract_quota_signals 的文档字符串。
    """
    import random
    base_seconds, _dbg = extract_quota_signals(asst_text)
    # 随机预留 30~60 分钟 (1800~3600秒) 安全防风控缓冲，像真人一样叠加一段「多余恢复时间」，
    # 彻底规避整点踩点被系统风控检测、服务端时钟边缘延迟，以及滚动回血「只回一撮」的复工即打光问题。
    buffer_seconds = random.randint(1800, 3600)
    if base_seconds > 0:
        return base_seconds + buffer_seconds
    # 解析不出任何信号时才回落到兜底（此时已在检测侧等过消息写完，正常不会走到）
    return 3 * 3600 + buffer_seconds

def soft_rate_limit_wait_seconds():
    """
    【2026-09-25 修·用户指令】"Too many requests" 是**瞬时节流**（429 类软限流），
    不是 Plus 生图硬额度（那种按小时熔断）。用户明确口径：遇到就轻冷却 20~30 分钟再续跑，
    绝不套用 3 小时级的重型熔断休眠。
    """
    import random
    return random.randint(1200, 1800)


def is_soft_rate_limit_only(text):
    """判定限流文本是否为纯 "Too many requests" 软节流（无硬额度/复位时钟语义）。"""
    low = (text or "").lower()
    if "too many requests" not in low:
        return False
    hard_marks = ("达到 plus", "图像生成请求上限", "图片生成次数已用完", "usage limit",
                  "you've reached", "you have reached", "后重置", "reset in", "后重试")
    return not any(k in low for k in hard_marks)


def compute_quota_backoff_wait(base_wait_seconds, hit_count):
    """
    【2026-09-24 修】加码从「乘法放大」改为「温和线性递增」。

    为什么改：原 ×2 / ×3 / ×4 是在一条**错误基线**上推出的结论。当时 parse 因抓取截断
    一直回落硬编码 3 小时兜底，比官方真实复位点短得多，于是表现为「按算出的时间复工，
    额度只回一撮、立刻再撞限」，被误归因为"滚动恢复特性"并用乘法去补。
    2026-09-24 揪出真因后，乘法加码的副作用暴露得非常严重（实测）：
      · 实例 B：官方权威复位点 12:21（页面"请在 12:21后重试" + 官方"5小时"），却被排到 18:13 → 白等 5h52m
      · 实例 A：官方权威复位点 20:47（滚动 24 小时窗口），却被排到 17:05 → 早醒 3h42m，醒来必再撞
    现在 extract_quota_signals 已能拿到官方权威复位点（且自带 30~60 分钟缓冲），
    重复撞限只需叠加一小段冗余即可：每多撞一次 +20 分钟，叠加部分封顶 +60 分钟。
    """
    try:
        hit = int(hit_count or 1)
    except Exception:
        hit = 1
    extra = max(0, hit - 1) * 1200          # 第 2 次起每次再 +20 分钟
    extra = min(extra, 3600)                 # 叠加部分封顶 +60 分钟
    return int(base_wait_seconds) + extra

def sanitized_proxy_env():
    """
    【2026-09-24 二次修】返回一份「已摘掉全部代理变量」的环境副本，供 lark-cli 等子进程使用。

    为什么从"改指 7890"改成"整个摘掉"：
      前一版把 7897 硬编码改写成 7890，但**代理端口本身是会变的**——2026-09-24 下午实测
      7897 又活了过来（用户侧 Clash 配置变动），当天 15:25 主脑重启时进程环境里赫然带着
      HTTP_PROXY/HTTPS_PROXY=7897。硬编码任何一个端口都是在跟用户的代理配置赌博。
      而本机事实是：①飞书 open.feishu.cn 是**境内直连**（实测无代理 HTTP 400 = 网络可达）；
      ②主脑进程内所有 HTTP 只有 127.0.0.1 的 CDP（本身就是直连）；
      ③图片下载走 CDP 在页面内完成，不经过 Python 网络栈。
      所以把代理变量整个摘掉既正确又不怕端口漂移。
    """
    env = os.environ.copy()
    for k in ("ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"):
        env.pop(k, None)
    return env


def send_feishu_markdown(md_text, chat_id=None):
    """向指定飞书群发送 Card 2.0 通知。
    chat_id 为空时发「作品流水线群」（成品交付 / 生产战报）；
    运维状态类（配额熔断 / 复工 / 探额复查 / 隔离告警）请显式传 FEISHU_OPS_CHAT_ID。
    """
    try:
        card_content = json.dumps({
            "schema": "2.0",
            "config": {"wide_screen_mode": True, "update_multi": True},
            "body": {
                "elements": [
                    {"tag": "markdown", "content": md_text}
                ]
            }
        }, ensure_ascii=False)
        cmd = [
            "node", LARK_RUN_JS, "im", "+messages-send",
            "--profile", FEISHU_STORAGE_PROFILE,
            "--as", "user",
            "--chat-id", chat_id or FEISHU_GROUP_CHAT_ID,
            "--msg-type", "interactive",
            "--content", card_content,
            "--format", "json"
        ]
        # [2026-09-24 修] 显式注入「摘掉代理」的环境：lark-cli 曾被死代理 7897 掐断，静默哑火
        res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8',
                             timeout=25, env=sanitized_proxy_env())
        if res.returncode != 0:
            # 兜底重试一次：万一本机网络确实需要代理，用原样环境再试一次（不回归老行为）
            res2 = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', timeout=25)
            if res2.returncode == 0:
                return True
            res = res2
        if res.returncode == 0:
            return True
        err = (res.stderr or "") + (res.stdout or "")
        log(f"飞书推送返回码异常 ({res.returncode}): {err.strip()[:400]}")
    except Exception as e:
        log(f"飞书推送异常: {e}")
    return False

def read_halt_flag():
    """[2026-09-26 新增] 读取全局人工急停开关。
    返回 (是否挂起, 原因, 到期时间字符串)。文件不存在 / 已过期 → 不挂起。
    用途：人工要整理 ChatGPT 会话、删垃圾会话、手动用号时，
    一键让所有产线"停手但不停线"（进程存活 → 守护不会重拉），避免边删边被塞新任务。
    """
    try:
        if not os.path.exists(HALT_FLAG_FILE):
            return False, "", ""
        with open(HALT_FLAG_FILE, "r", encoding="utf-8", errors="ignore") as f:
            txt = f.read()
        kv = {}
        for ln in txt.splitlines():
            if "=" in ln:
                k, v = ln.split("=", 1)
                kv[k.strip().upper()] = v.strip()
        if kv.get("HALT", "") != "1":
            return False, "", ""
        exp = kv.get("EXPIRES", "")
        if exp:
            try:
                if datetime.datetime.now() >= datetime.datetime.strptime(exp, "%Y-%m-%d %H:%M:%S"):
                    return False, "", exp
            except Exception:
                pass
        return True, kv.get("REASON", "人工急停"), exp
    except Exception:
        return False, "", ""

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

# ================= 生产节拍埋点（2026-09-26 新增） =================
# 用户诉求：把「什么时候点的发送 / 点完之后多久出字 / 中间等了多久才点下一次发送」
# 全部详详细细写进日志，用来事后判断节奏是快了还是慢了、卡在哪一段。
# 主日志是给人看的流水，这里额外落一份结构化 JSONL，方便直接统计间隔分布。
TRACE_FILE = r"D:\AICode\运行数据\production_trace.jsonl"

def trace(inst, event, **kw):
    rec = {
        "ts": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "epoch": round(time.time(), 3),
        "inst": inst,
        "event": event,
    }
    rec.update(kw)
    try:
        os.makedirs(os.path.dirname(TRACE_FILE), exist_ok=True)
        with open(TRACE_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass
    # 同时进主日志，保证 tail -f 的时候能直接看到节拍
    extra = " ".join(f"{k}={v}" for k, v in kw.items())
    log(f"⏱ 埋点 {event}" + (f" | {extra}" if extra else ""), inst)

# ================= 产线停机信号（2026-09-26 新增） =================
# 命中任意一条 = 平台侧已经明确表态（配额/风控/登录态/内容违规），
# 这时继续并发发消息只会加重风控，必须立刻停掉「这一条」产线并告警。
STOP_SIGNALS = {
    "配额用尽": ["hit your limit", "rate limit", "limit reached", "too many requests",
                 "达到上限", "已达上限", " quotas", "try again later"],
    "登录态失效": ["auth/login", "log in to continue", "session expired", "重新登录",
                   "please log in", "unauthorized"],
    "真人验证风控": ["verify you are human", "just a moment", "cf-challenge", "cloudflare",
                     "unusual activity", "checking your browser"],
    "账号异常": ["deactivated", "your account has been", "violated our", "已被停用", "账号异常"],
    "内容违规": ["content policy", "内容政策", "violates our policies", "can't generate"],
}
# 同一套素材生命周期内，页面软重载最多只允许 1 次（多了既浪费时间又加重风控）
RELOAD_MAX_PER_ITEM = 1
# 连续空转超过这个秒数（无出图、无出字）才允许动用那唯一一次重载
IDLE_RELOAD_AFTER_SEC = 240
# 上传类失败后的重试等待区间（比提交节流闸短，避免纯等待浪费；配额类另有 resume_at）
UPLOAD_FAIL_WAIT_RANGE = (60, 120)

# ================= 常驻内存守护（2026-09-26 新增） =================
# 背景：本机 16GB 物理内存，白天几十个客户端一起跑，可用内存长期只剩几百 MB。
# 一旦见底，ChatGPT 渲染进程主线程会被系统拖住 -> CDP Runtime.evaluate 超时 ->
# 主脑误判成"上传失败/环境抖动" -> 重试 -> 更吃内存，恶性循环。
# 用户要求：**系统卡顿时由脚本自己触发内存释放，不能等人来点**。
# 分级处置（全程写 memory_guard.log，可事后复盘）：
#   一级 可用 < 900MB：对每个 ChatGPT 页面下发 HeapProfiler.collectGarbage 强制回收
#                      （纯 GC，不重载页面、不掉登录态、不中断当前生成）
#   二级 可用 < 600MB：额外关闭实例里多余的页面 target（只保留 ChatGPT 主页面）
#   三级 可用 < 350MB：飞书告警（30 分钟限频一次），提示人工介入
# 阈值口径（用户 2026-09-26 拍板）：
#   可用 ≥ 2500MB   → 安全
#   可用 1000~2500MB → 注意
#   可用 <  1000MB  → 危险
MEM_GUARD_LOG = r"D:\AICode\运行数据\memory_guard.log"
MEM_L1_MB = 2500   # 低于此 = 注意档：强制 GC
MEM_L2_MB = 1000   # 低于此 = 危险档：GC + 关多余页面 + 飞书告警
MEM_L3_MB = 600    # 低于此 = 极危档：额外高频告警
MEM_CHECK_INTERVAL = 60
MEM_LAST_FEISHU = {"ts": 0.0}

def mem_free_mb():
    """返回 (已用物理内存 MB, 可用物理内存 MB, 占用率%)；失败返回 (None, None, None)
    注意顺序：**第一个是已用，第二个是可用**，与用户看日志的习惯保持一致。"""
    try:
        import ctypes as _ct

        class _MS(_ct.Structure):
            _fields_ = [('dwLength', _ct.c_ulong), ('dwMemoryLoad', _ct.c_ulong),
                        ('ullTotalPhys', _ct.c_ulonglong), ('ullAvailPhys', _ct.c_ulonglong),
                        ('ullTotalPageFile', _ct.c_ulonglong), ('ullAvailPageFile', _ct.c_ulonglong),
                        ('ullTotalVirtual', _ct.c_ulonglong), ('ullAvailVirtual', _ct.c_ulonglong),
                        ('ullAvailExtendedVirtual', _ct.c_ulonglong)]
        m = _MS()
        m.dwLength = _ct.sizeof(_MS)
        _ct.windll.kernel32.GlobalMemoryStatusEx(_ct.byref(m))
        total_mb = int(m.ullTotalPhys / 1024 / 1024)
        avail_mb = int(m.ullAvailPhys / 1024 / 1024)
        return total_mb - avail_mb, avail_mb, int(m.dwMemoryLoad)
    except Exception:
        return None, None, None

def mem_fmt(used_mb, avail_mb, load_pct):
    """统一日志口径：已用在前、可用在后"""
    return f"已用 {used_mb}MB / 可用 {avail_mb}MB（占用 {load_pct}%）"

def mem_top_procs(n=6):
    """用 tasklist 聚合出占内存最高的 n 个进程名（只做记录，不做任何杀进程动作）"""
    try:
        import subprocess as _sp
        import collections as _co
        out = _sp.run(['tasklist', '/FO', 'CSV', '/NH'], capture_output=True, text=True, errors='ignore').stdout
        agg = _co.defaultdict(int)
        for line in out.strip().splitlines():
            parts = [p.strip('"') for p in line.split('","')]
            if len(parts) >= 5:
                try:
                    agg[parts[0]] += int(parts[4].replace(',', '').replace(' K', '').strip())
                except Exception:
                    pass
        top = sorted(agg.items(), key=lambda x: -x[1])[:n]
        return "、".join(f"{k} {v//1024}MB" for k, v in top)
    except Exception:
        return "统计失败"

def mem_guard_log(msg):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    try:
        os.makedirs(os.path.dirname(MEM_GUARD_LOG), exist_ok=True)
        with open(MEM_GUARD_LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass
    log(f"🧠 {msg}", "MEM")

async def _cdp_force_gc(ws_url, tag):
    """对单个页面强制 GC（HeapProfiler.collectGarbage）：不重载、不掉登录态"""
    try:
        async with websockets.connect(ws_url, max_size=10 * 1024 * 1024, open_timeout=8) as ws:
            await ws.send(json.dumps({"id": 1, "method": "HeapProfiler.enable"}))
            await ws.send(json.dumps({"id": 2, "method": "HeapProfiler.collectGarbage"}))
            end = time.time() + 10
            while time.time() < end:
                raw = await asyncio.wait_for(ws.recv(), timeout=5)
                if json.loads(raw).get("id") == 2:
                    return True
    except Exception as e:
        mem_guard_log(f"    · {tag} GC 失败：{str(e)[:60]}")
        return False
    return False

async def _cdp_close_extra_pages(browser_ws_url, keep_keyword="chatgpt.com"):
    """关掉实例里除了 ChatGPT 主页面之外的多余页面（二级降载用）"""
    closed = 0
    try:
        async with websockets.connect(browser_ws_url, max_size=10 * 1024 * 1024, open_timeout=8) as ws:
            await ws.send(json.dumps({"id": 1, "method": "Target.getTargets"}))
            infos = []
            end = time.time() + 8
            while time.time() < end:
                raw = await asyncio.wait_for(ws.recv(), timeout=4)
                d = json.loads(raw)
                if d.get("id") == 1:
                    infos = d.get("result", {}).get("targetInfos", [])
                    break
            for t in infos:
                if t.get("type") == "page" and keep_keyword not in (t.get("url") or ""):
                    tid = t.get("targetId")
                    if tid:
                        await ws.send(json.dumps({"id": 900, "method": "Target.closeTarget", "params": {"targetId": tid}}))
                        closed += 1
    except Exception as e:
        mem_guard_log(f"    · 关闭多余页面异常：{str(e)[:60]}")
    return closed

async def memory_guard_loop(ports=(("A", 9431), ("B", 9432))):
    """常驻协程：每 60 秒巡检一次，按可用内存分级自动释放"""
    mem_guard_log(f"🟢 内存守护已启动｜档位：安全≥{MEM_L1_MB}MB可用 / 注意{MEM_L2_MB}~{MEM_L1_MB}MB / "
                  f"危险<{MEM_L2_MB}MB / 极危<{MEM_L3_MB}MB｜巡检间隔 {MEM_CHECK_INTERVAL}s｜"
                  f"处置手段只有强制 GC 与关多余页面，绝不碰登录态、绝不杀进程")
    while True:
        try:
            used_mb, avail_mb, load_pct = mem_free_mb()
            if avail_mb is None:
                await asyncio.sleep(MEM_CHECK_INTERVAL)
                continue
            top = mem_top_procs(6)
            snap = mem_fmt(used_mb, avail_mb, load_pct)
            if avail_mb >= MEM_L1_MB:
                mem_guard_log(f"🟢 安全：{snap}｜ Top: {top}")
            elif avail_mb >= MEM_L2_MB:
                mem_guard_log(f"🟡 注意（可用 <{MEM_L1_MB}MB）：{snap} → 对 ChatGPT 页面强制 GC｜ Top: {top}")
                for inst, port in ports:
                    try:
                        import urllib.request as _u
                        op = _urllib_opener()
                        res = json.loads(op.open(f"http://127.0.0.1:{port}/json/list", timeout=5).read().decode())
                        for t in res:
                            if t.get("type") == "page" and "chatgpt.com" in (t.get("url") or ""):
                                ok = await _cdp_force_gc(t["webSocketDebuggerUrl"], f"实例{inst}")
                                mem_guard_log(f"    · 实例{inst} GC {'完成' if ok else '未响应'}")
                    except Exception as e:
                        mem_guard_log(f"    · 实例{inst} GC 跳过（{str(e)[:50]}）")
                await asyncio.sleep(20)
                u2, a2, l2 = mem_free_mb()
                mem_guard_log(f"    · GC 后复测：{mem_fmt(u2, a2, l2)}")
            elif avail_mb >= MEM_L3_MB:
                mem_guard_log(f"🔴 危险（可用 <{MEM_L2_MB}MB）：{snap} → 强制 GC｜ Top: {top}")
                # 【2026-09-26 事故后废弃·绝不关页面】
                # 早期版本在这里会关闭"多余页面"，实测把产线实例自己的 UI 宿主页和
                # ChatGPT 页一起关没了（9431/9432 页面列表变 []，Target.createTarget 直接
                # Not supported，实例彻底空壳，只能重启 Electron）。
                # 教训：内存守护**只做 GC**，绝不关页面。腾内存的责任不在脚本。
                for inst, port in ports:
                    try:
                        op = _urllib_opener()
                        res = json.loads(op.open(f"http://127.0.0.1:{port}/json/list", timeout=8).read().decode())
                        for t in res:
                            if t.get("type") == "page" and "chatgpt.com" in (t.get("url") or ""):
                                await _cdp_force_gc(t["webSocketDebuggerUrl"], f"实例{inst}")
                    except Exception as e:
                        mem_guard_log(f"    · 实例{inst} GC 跳过（{str(e)[:50]}）")
                await asyncio.sleep(20)
                u2, a2, l2 = mem_free_mb()
                mem_guard_log(f"    · 处置后复测：{mem_fmt(u2, a2, l2)}")
            else:
                # 【极危档也必须动手】可用 < 600MB 时 ChatGPT 渲染进程连 WebSocket 握手都会超时，
                # 只告警不释放等于坐视产线全废。这里把 GC + 关多余页面照做一遍，做完再告警。
                mem_guard_log(f"🚨 极危（可用 <{MEM_L3_MB}MB）：{snap} → 强制 GC + 告警｜ Top: {top}")
                for inst, port in ports:
                    try:
                        op = _urllib_opener()
                        res = json.loads(op.open(f"http://127.0.0.1:{port}/json/list", timeout=8).read().decode())
                        for t in res:
                            if t.get("type") == "page" and "chatgpt.com" in (t.get("url") or ""):
                                await _cdp_force_gc(t["webSocketDebuggerUrl"], f"实例{inst}")
                    except Exception as e:
                        mem_guard_log(f"    · 实例{inst} 极危处置跳过（{str(e)[:50]}）")
                await asyncio.sleep(15)
                u2, a2, l2 = mem_free_mb()
                mem_guard_log(f"    · 极危处置后复测：{mem_fmt(u2, a2, l2)}")
                if time.time() - MEM_LAST_FEISHU["ts"] > 1800:
                    MEM_LAST_FEISHU["ts"] = time.time()
                    try:
                        send_feishu_markdown(
                            f"🔴【内存枯竭告警 · 内容产线】\n"
                            f"━━━━━━━━━━━━━━━━━━━━━━\n"
                            f"💾 **内存**：已用 {used_mb}MB / 可用 {avail_mb}MB（占用 {load_pct}%）\n"
                            f"📉 **档位**：危险档（可用 < {MEM_L2_MB}MB）\n"
                            f"⏱ **时刻**：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                            f"📊 **占用前列**：{top}\n"
                            f"🤖 **脚本已自动执行**：页面强制 GC + 关闭多余页面\n"
                            f"💡 **仍需人工**：请自行关闭不用的客户端（Edge/剪映/微信/远控等），\n"
                            f"    脚本不会、也不该替你杀进程。",
                            FEISHU_OPS_CHAT_ID)
                    except Exception:
                        pass
        except Exception as e:
            mem_guard_log(f"巡检异常：{str(e)[:80]}")
        await asyncio.sleep(MEM_CHECK_INTERVAL)

def _urllib_opener():
    """本机 CDP 端口必须绕开进程代理，否则 127.0.0.1 也会被代理吃掉"""
    import urllib.request as _u
    return _u.build_opener(_u.ProxyHandler({}))

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
    双重生成配额安全守门（按实例独立配置，两个账号官方额度互不影响）：
    1. 3小时滑动窗口已生成大图是否达到该实例安全上限（现网 A=40 / B=40，见
       MAX_3H_GEN_LIMIT_BY_INSTANCE；官方硬顶约 50 张，本地取 40 留缓冲）；
    2. 全天当日累计生成大图是否达到该实例安全巡航线（DAILY_SAFE_LIMIT_BY_INSTANCE，
       现网 A=180 / B=180；官方约 200 张/账号，本地留 20 张缓冲）。
    判据数据源：生图配额账本 generation_quota_ledger.json 的 generated_count 求和；
    状态文件里的 today_images 仅供展示、存在滞后，不得作为守门判据。
    单套冲刺放行原则：开工前未达上限即放行，跑完本套落地后入账并停下。
    返回: (is_allowed: bool, reason: str, wait_seconds: int, stats: dict)
    """
    limit_3h = max_3h_limit_for(instance_id)
    limit_today = daily_limit_for(instance_id)
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
        "max_3h": limit_3h,
        "gen_today": gen_today,
        "max_today": limit_today
    }

    if gen_3h >= limit_3h:
        earliest_epoch = min((r.get("epoch", now_epoch) for r in records_3h), default=now_epoch)
        wait_seconds = max(10, int((earliest_epoch + 3 * 3600) - now_epoch))
        return False, f"近 3 小时已生成 {gen_3h} 张大图（达该实例安全上限 {limit_3h} 张）", wait_seconds, stats

    if gen_today >= limit_today:
        tomorrow = (datetime.datetime.now() + datetime.timedelta(days=1)).replace(hour=0, minute=5, second=0)
        wait_seconds = max(60, int((tomorrow - datetime.datetime.now()).total_seconds()))
        return False, f"今日已累计生成 {gen_today} 张大图（达该实例全天安全巡航线 {limit_today} 张）", wait_seconds, stats

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

def keep_window_background(port):
    """Keep CDP production independent from desktop focus and z-order.

    CDP can drive a renderer while its Electron window is backgrounded.  The
    The previous implementation changed desktop window state every few
    polling cycles, repeatedly stealing the user's focus and making the
    production UI appear to block mouse input.  Deliberately do nothing here;
    this hook remains as a cheap compatibility point for the existing loop.
    """
    return False

def load_autumn_c_paths():
    """Return the exact AUTUMN-C source-path allowlist; fail closed on missing/invalid input."""
    try:
        with open(AUTUMN_C_TASKS_FILE, 'r', encoding='utf-8') as f:
            payload = json.load(f)
        tasks = payload.get("tasks", []) if isinstance(payload, dict) else payload
        paths = set()
        for task in tasks:
            source_path = task.get("path") or task.get("sourcePath")
            if source_path:
                paths.add(os.path.normcase(os.path.normpath(source_path)).rstrip("\\/"))
        return paths
    except Exception as e:
        log(f"AUTUMN-C 任务白名单读取失败，安全停止跨批次扫描: {e}")
        return set()

def update_autumn_c_progress(task, status, output_path=None, image_count=0, error=None):
    """Update only the AUTUMN-C independent ledger after a real client outcome."""
    try:
        with open(AUTUMN_C_PROGRESS_FILE, 'r', encoding='utf-8') as f:
            payload = json.load(f)
        items = payload.setdefault("items", [])
        source_path = task.get("path", "")
        norm_source = os.path.normcase(os.path.normpath(source_path)).rstrip("\\/")
        target = None
        for item in items:
            candidate = item.get("sourcePath", "")
            if candidate and os.path.normcase(os.path.normpath(candidate)).rstrip("\\/") == norm_source:
                target = item
                break
        if target is None:
            # 允许首次处理清单内的新任务落账，但仍拒绝清单外的未知路径。
            task_meta = None
            try:
                with open(AUTUMN_C_TASKS_FILE, 'r', encoding='utf-8') as tf:
                    task_payload = json.load(tf)
                task_list = task_payload.get("tasks", []) if isinstance(task_payload, dict) else task_payload
                for pos, candidate_task in enumerate(task_list, 1):
                    candidate_path = candidate_task.get("path") or candidate_task.get("sourcePath")
                    if candidate_path and os.path.normcase(os.path.normpath(candidate_path)).rstrip("\\/") == norm_source:
                        task_meta = candidate_task
                        task_meta.setdefault("index", pos)
                        break
            except Exception as meta_error:
                log(f"AUTUMN-C 清单元数据读取失败: {meta_error}")
            if task_meta is None:
                log(f"AUTUMN-C 独立账本未找到任务，拒绝新增未知记录: {source_path}")
                return False
            existing_indices = [
                int(item.get("index")) for item in items
                if str(item.get("index", "")).isdigit()
            ]
            target = {
                "index": (max(existing_indices) + 1) if existing_indices else 1,
                "taskIndex": task_meta.get("index"),
                "name": task_meta.get("name", task.get("name", "")),
                "sourcePath": source_path,
                "status": "pending",
                "outputPath": None,
                "imageCount": 0
            }
            items.append(target)
        target.update({
            "index": target.get("index"),
            "name": task.get("name", target.get("name", "")),
            "sourcePath": source_path,
            "status": status,
            "outputPath": output_path,
            "imageCount": image_count,
            "completedAt": datetime.datetime.now().astimezone().isoformat()
        })
        target["productionMode"] = "客户端模式（直接对话框）"
        if error:
            target["error"] = str(error)
        elif "error" in target:
            target.pop("error", None)
        payload["updatedAt"] = datetime.datetime.now().astimezone().isoformat()
        tmp_path = AUTUMN_C_PROGRESS_FILE + ".tmp"
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, AUTUMN_C_PROGRESS_FILE)
        log(f"AUTUMN-C 独立账本已回写: index={target.get('index')} status={status}")
        return True
    except Exception as e:
        log(f"AUTUMN-C 独立账本回写失败: {e}")
        return False

def reconcile_missing_autumn_c_tasks():
    """Record known AUTUMN-C source paths that are absent locally, without queuing them."""
    try:
        with open(AUTUMN_C_TASKS_FILE, 'r', encoding='utf-8') as tf:
            task_payload = json.load(tf)
        task_list = task_payload.get("tasks", []) if isinstance(task_payload, dict) else task_payload
        with open(AUTUMN_C_PROGRESS_FILE, 'r', encoding='utf-8') as pf:
            progress_payload = json.load(pf)
        items = progress_payload.setdefault("items", [])
        by_path = {}
        for item in items:
            candidate = item.get("sourcePath", "")
            if candidate:
                by_path[os.path.normcase(os.path.normpath(candidate)).rstrip("\\/")] = item
        changed = False
        now = datetime.datetime.now().astimezone().isoformat()
        existing_indices = [
            int(item.get("index")) for item in items
            if str(item.get("index", "")).isdigit()
            and not str(item.get("error", "")).startswith("source_missing:")
        ]
        next_missing_index = (max(existing_indices) + 1) if existing_indices else 1
        # 历史运行账本的 index 是处理序号；给本轮新增的缺失记录重新编号，避免与历史序号冲突。
        for item in items:
            if str(item.get("error", "")).startswith("source_missing:"):
                if item.get("index") != next_missing_index:
                    item["index"] = next_missing_index
                    changed = True
                next_missing_index += 1
        for pos, task in enumerate(task_list, 1):
            source_path = task.get("path") or task.get("sourcePath")
            if not source_path or os.path.isdir(source_path):
                continue
            norm_source = os.path.normcase(os.path.normpath(source_path)).rstrip("\\/")
            target = by_path.get(norm_source)
            if target is not None and target.get("status") in {"success", "failed", "skipped"}:
                continue
            if target is None:
                target = {
                    "index": next_missing_index,
                    "taskIndex": task.get("index", pos),
                    "name": task.get("name", os.path.basename(source_path)),
                    "sourcePath": source_path
                }
                items.append(target)
                by_path[norm_source] = target
                next_missing_index += 1
            elif not target.get("taskIndex"):
                target["taskIndex"] = task.get("index", pos)
                changed = True
            target.update({
                "index": target.get("index", next_missing_index),
                "taskIndex": task.get("index", target.get("taskIndex", pos)),
                "name": task.get("name", target.get("name", os.path.basename(source_path))),
                "sourcePath": source_path,
                "status": "failed",
                "outputPath": None,
                "imageCount": 0,
                "completedAt": now,
                "productionMode": "客户端模式（直接对话框）",
                "error": "source_missing: AUTUMN-C 权威任务清单路径在本地不存在"
            })
            changed = True
        if changed:
            progress_payload["updatedAt"] = now
            tmp_path = AUTUMN_C_PROGRESS_FILE + ".tmp"
            with open(tmp_path, 'w', encoding='utf-8') as pf:
                json.dump(progress_payload, pf, ensure_ascii=False, indent=2)
            os.replace(tmp_path, AUTUMN_C_PROGRESS_FILE)
            log("AUTUMN-C 缺失原料已记为 failed，并从生产队列排除")
    except Exception as e:
        log(f"AUTUMN-C 缺失原料对账失败: {e}")

def reconcile_stale_autumn_c_locks(max_age_minutes=30):
    """Release old A/C locks only when both local workers have no active package."""
    try:
        if any(DAEMON_STATE.get("instances", {}).get(k, {}).get("current_package") for k in DAEMON_STATE.get("instances", {})):
            return
        with open(AUTUMN_C_TASKS_FILE, 'r', encoding='utf-8') as tf:
            task_payload = json.load(tf)
        task_list = task_payload.get("tasks", []) if isinstance(task_payload, dict) else task_payload
        now = datetime.datetime.now()
        released = 0
        for task in task_list:
            source_path = task.get("path") or task.get("sourcePath")
            if not source_path or not os.path.isdir(source_path):
                continue
            tags_file = os.path.join(source_path, ".tags.json")
            if not os.path.exists(tags_file):
                continue
            try:
                with open(tags_file, 'r', encoding='utf-8') as tf:
                    tag_data = json.load(tf)
                prod = tag_data.setdefault("production", {})
                if prod.get("lifecycleState") != "生产中" or prod.get("lockedBy") not in {"Instance-A", "Instance-B", "Instance-C"}:
                    continue
                locked_at = datetime.datetime.strptime(str(prod.get("lockedAt")), "%Y-%m-%d %H:%M:%S")
                if (now - locked_at).total_seconds() < max_age_minutes * 60:
                    continue
                prod["lifecycleState"] = "待生产"
                prod.pop("lockedBy", None)
                prod.pop("lockedAt", None)
                tmp_tags = tags_file + ".tmp"
                with open(tmp_tags, 'w', encoding='utf-8') as tf:
                    json.dump(tag_data, tf, ensure_ascii=False, indent=2)
                os.replace(tmp_tags, tags_file)
                released += 1
            except Exception as one_error:
                log(f"AUTUMN-C stale lock 清理失败: {source_path} ({one_error})")
        if released:
            log(f"AUTUMN-C 已释放 {released} 条超过 {max_age_minutes} 分钟的 stale lock")
    except Exception as e:
        log(f"AUTUMN-C stale lock 对账失败: {e}")

def reconcile_success_output_integrity():
    """Re-audit historical success records and repair stale paths or reopen invalid work."""
    try:
        with open(AUTUMN_C_PROGRESS_FILE, 'r', encoding='utf-8') as pf:
            progress_payload = json.load(pf)
        with open(AUTUMN_C_TASKS_FILE, 'r', encoding='utf-8') as tf:
            task_payload = json.load(tf)
        task_list = task_payload.get("tasks", []) if isinstance(task_payload, dict) else task_payload
        task_by_path = {}
        for pos, task in enumerate(task_list, 1):
            source_path = task.get("path") or task.get("sourcePath")
            if source_path:
                task_by_path[os.path.normcase(os.path.normpath(source_path)).rstrip("\\/")] = task

        # 旧批次曾在归档移动后没有回写 outputPath；按叶名称建立只读候选索引。
        output_dirs_by_leaf = {}
        for base, dirs, _files in os.walk(OUTPUT_BASE):
            dirs[:] = [d for d in dirs if d not in {"_制作中", "待制作待补全"}]
            for dirname in dirs:
                output_dirs_by_leaf.setdefault(dirname, []).append(os.path.join(base, dirname))

        changed = False
        repaired = 0
        invalidated = 0
        now = datetime.datetime.now().astimezone().isoformat()
        for item in progress_payload.get("items", []):
            if item.get("status") != "success":
                continue
            output_path = item.get("outputPath") or ""
            actual_path = output_path if os.path.isdir(output_path) else ""
            if not actual_path:
                leaf = os.path.basename(output_path.rstrip("\\/"))
                candidates = output_dirs_by_leaf.get(leaf, [])
                if candidates:
                    actual_path = candidates[0]
                    item["outputPath"] = actual_path
                    repaired += 1
                    changed = True

            problems = []
            if not actual_path or not os.path.isdir(actual_path):
                problems.append("output_missing")
            else:
                image_names = [
                    name for name in os.listdir(actual_path)
                    if name.startswith("P") and name.lower().endswith(".png")
                ]
                if len(image_names) < 3:
                    problems.append(f"image_count:{len(image_names)}")
                for image_name in image_names:
                    try:
                        with Image.open(os.path.join(actual_path, image_name)) as image:
                            if image.size != (1086, 1448):
                                problems.append(f"bad_size:{image_name}:{image.size}")
                                break
                    except Exception:
                        problems.append(f"bad_image:{image_name}")
                        break
                if not os.path.isfile(os.path.join(actual_path, "manifest.json")):
                    problems.append("manifest_missing")
                copy_path = os.path.join(actual_path, "三平台文案.txt")
                if not os.path.isfile(copy_path):
                    problems.append("copy_missing")
                else:
                    try:
                        with open(copy_path, 'r', encoding='utf-8', errors='ignore') as cf:
                            if "<<<COPY_FORMAT:3>>>" not in cf.read():
                                problems.append("copy_marker_missing")
                    except Exception:
                        problems.append("copy_unreadable")

            if not problems:
                continue

            invalidated += 1
            item.update({
                "status": "failed",
                "outputPath": None,
                "imageCount": 0,
                "completedAt": now,
                "productionMode": "客户端模式（直接对话框）",
                "error": "output_reaudit_failed: " + "; ".join(problems)
            })
            source_path = item.get("sourcePath", "")
            source_key = os.path.normcase(os.path.normpath(source_path)).rstrip("\\/") if source_path else ""
            if source_key and os.path.isdir(source_path):
                tags_file = os.path.join(source_path, ".tags.json")
                try:
                    with open(tags_file, 'r', encoding='utf-8') as sf:
                        tag_data = json.load(sf)
                    production = tag_data.setdefault("production", {})
                    if production.get("lifecycleState") == "已生产":
                        production["lifecycleState"] = "待生产"
                        production["lastError"] = "output_reaudit_failed: 成品未通过本地完整性验收"
                        production["lastFailedAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        for key in ("outputDirectory", "productionAt", "feishuSync"):
                            production.pop(key, None)
                        tags = tag_data.setdefault("tagging", {}).setdefault("tags", [])
                        while "已生产" in tags:
                            tags.remove("已生产")
                        tmp_tags = tags_file + ".tmp"
                        with open(tmp_tags, 'w', encoding='utf-8') as sf:
                            json.dump(tag_data, sf, ensure_ascii=False, indent=2)
                        os.replace(tmp_tags, tags_file)
                except Exception as tag_error:
                    log(f"AUTUMN-C 成品失效后源标签回退失败: {source_path} ({tag_error})")
            changed = True

        if changed:
            progress_payload["updatedAt"] = now
            tmp_progress = AUTUMN_C_PROGRESS_FILE + ".tmp"
            with open(tmp_progress, 'w', encoding='utf-8') as pf:
                json.dump(progress_payload, pf, ensure_ascii=False, indent=2)
            os.replace(tmp_progress, AUTUMN_C_PROGRESS_FILE)
        if repaired or invalidated:
            log(f"AUTUMN-C 成品完整性对账：修正移动路径 {repaired} 条，降级无效 success {invalidated} 条")
    except Exception as e:
        log(f"AUTUMN-C 成品完整性对账失败: {e}")

# 【2026-09-27 新增·僵尸锁自动释放】
# 根因：主脑被强杀 / 崩溃 / CDP 断连时不会走到 release_task_lock，素材被打上
# lifecycleState="生产中" 后**永久无人认领** —— 实测 09-26 一天堆积 15 条僵尸
# （最早 11:13，最晚 23:43，全是当天被中断的生产），它们既不在队列里也不报错，
# 是「队列明明还有货、产线却饿死」的隐形元凶。
STALE_LOCK_MINUTES = 45
_LAST_STALE_SCAN = {"ts": 0.0}

def release_stale_production_locks(max_age_min=STALE_LOCK_MINUTES):
    """把超时未释放的「生产中」锁复位为「待生产」。只读为主，仅在判定为孤儿时才写。"""
    # 节流：全量扫 180 条 tags 有成本，10 分钟最多跑一次
    if time.time() - _LAST_STALE_SCAN["ts"] < 600:
        return 0
    _LAST_STALE_SCAN["ts"] = time.time()
    try:
        with open(AUTUMN_C_TASKS_FILE, 'r', encoding='utf-8') as tf:
            payload = json.load(tf)
        tasks = payload.get("tasks", []) if isinstance(payload, dict) else payload
    except Exception as e:
        log(f"孤儿锁巡检读取清单元失败: {e}")
        return 0

    now = datetime.datetime.now()
    freed = 0
    for t in tasks:
        p = t.get("path") or t.get("sourcePath")
        if not p or not os.path.isdir(p):
            continue
        tags_file = os.path.join(p, ".tags.json")
        if not os.path.exists(tags_file):
            continue
        try:
            with open(tags_file, 'r', encoding='utf-8') as f:
                td = json.load(f)
        except Exception:
            continue
        prod = td.get("production") or {}
        if prod.get("lifecycleState") != "生产中":
            continue
        locked_at = prod.get("lockedAt")
        stale = True
        if locked_at:
            try:
                lt = datetime.datetime.strptime(str(locked_at), "%Y-%m-%d %H:%M:%S")
                stale = (now - lt).total_seconds() > max_age_min * 60
            except Exception:
                stale = True
        if not stale:
            continue
        prod["lifecycleState"] = "待生产"
        prod["lockedBy"] = None
        prod["lockedAt"] = None
        prod["lastError"] = f"孤儿锁自动复位 {now.strftime('%Y-%m-%d %H:%M:%S')}（原锁 {locked_at}）"
        try:
            with open(tags_file, 'w', encoding='utf-8') as f:
                json.dump(td, f, ensure_ascii=False, indent=2)
            freed += 1
        except Exception as e:
            log(f"孤儿锁复位写入失败 {p}: {e}")
    if freed:
        log(f"🧹 已复位 {freed} 条超时孤儿锁（>{max_age_min} 分钟未释放）→ 回到待生产队列")
    return freed

def scan_pending_queue():
    import random
    from collections import defaultdict

    queue = []
    emergency_queue = []
    seen_paths = set()
    allowed_paths = load_autumn_c_paths()
    if not allowed_paths:
        return []
    reconcile_missing_autumn_c_tasks()

    # 1. 优先挂载紧急插队任务池（AUTUMN_EMERGENCY_TASKS.json），实现插队置顶
    # [2026-09-28 修] 该目录已被成品库重整归档进 _内部台账与历史数据，新家优先、老路径兜底
    emergency_file = os.path.join(OUTPUT_BASE, "_内部台账与历史数据", "_生产计划与排产参考", "AUTUMN_EMERGENCY_TASKS.json")
    if not os.path.exists(emergency_file):
        emergency_file = os.path.join(OUTPUT_BASE, "_生产计划与排产参考", "AUTUMN_EMERGENCY_TASKS.json")
    if os.path.exists(emergency_file):
        try:
            with open(emergency_file, 'r', encoding='utf-8') as ef:
                em_data = json.load(ef)
            em_tasks = em_data.get("tasks", [])
            for em in em_tasks:
                em_path = em.get("path")
                if not em_path or not os.path.isdir(em_path):
                    continue
                norm_p = os.path.normcase(os.path.normpath(em_path)).rstrip("\\/")
                if norm_p not in allowed_paths:
                    continue
                if norm_p in seen_paths:
                    continue

                tags_file = os.path.join(em_path, ".tags.json")
                state = "待生产"
                if os.path.exists(tags_file):
                    try:
                        with open(tags_file, 'r', encoding='utf-8') as tf:
                            tdata = json.load(tf)
                        state = tdata.get("production", {}).get("lifecycleState", "待生产")
                        tags = tdata.get("tagging", {}).get("tags", [])
                        if "已生产" in tags:
                            state = "已生产"
                    except Exception:
                        state = "待生产"

                if state not in ["已生产", "生产中", "生产异常", "需人工复核"]:
                    seen_paths.add(norm_p)
                    emergency_queue.append({
                        "name": em.get("name", os.path.basename(em_path)),
                        "path": em_path,
                        "category": em.get("traffic_type", "泛流量"),
                        "subcategory": em.get("destination", "紧急插队"),
                        "priority": -1,  # 顶级优先级
                        "is_emergency": True
                    })
        except Exception as e_em:
            log(f"读取紧急排产池异常: {e_em}")

    if not os.path.exists(MATERIAL_DIR):
        return emergency_queue

    # 2. 扫描常规素材库池（排除已在插队池中的任务与异常素材）
    # 【2026-09-26 双根扫描】素材库层级重排后存在两代目录并存：
    #   旧家 = MATERIAL_DIR（秋季智能分类）下的 精准流量/泛流量
    #   新家 = 01-素材库 根下的 精准流量/泛流量（AUTUMN-C 白名单重映射后的落点）
    # 只扫旧家会导致新家 79+ 条可产素材永远不可见（实例 B 空转根因）。
    # 白名单闸门仍然兜底，扩大扫描面不会乱领批次外素材。
    _LIB_ROOT = os.path.dirname(MATERIAL_DIR)
    _scan_roots = []
    for _r in (MATERIAL_DIR, _LIB_ROOT):
        if os.path.isdir(_r) and _r not in _scan_roots:
            _scan_roots.append(_r)
    # 【2026-09-27 修·队列饿死的真凶】实测白名单里 63 条"待生产"素材，旧的两层扫描根
    # （秋季分类目录 + 库根）只够得到 4 条，其余 59 条散落在
    #   01-素材库\夏季（6—8月·智能分类）\泛流量\...
    #   01-素材库\冬季（12—2月·智能分类）\精准流量\...
    #   01-素材库\四季通用（全年·无季节限制）\泛流量\...
    # 这些是「库根 / 季节分类 / 精准流量|泛流量 / 目的地 / 素材」的四层结构，
    # 而旧扫描根只拼到「根/精准流量」两层 → 永远够不到 → A/B 双线一起空转报"队列暂无可用素材"。
    # 处置：把库根下每个非下划线开头的子目录也纳入扫描根。白名单闸门仍然兜底，
    # 只会多扫到「本来就在 AUTUMN-C 清单里」的料，不会越界领批次外素材。
    try:
        for _sub in os.listdir(_LIB_ROOT):
            if _sub.startswith("_"):
                continue  # _垃圾素材隔离区 等治理区一律不产
            _sp = os.path.join(_LIB_ROOT, _sub)
            if os.path.isdir(_sp) and _sp not in _scan_roots:
                _scan_roots.append(_sp)
    except Exception as _e_sub:
        log(f"扫描根扩展异常（不阻断，用原有两层根）: {_e_sub}")
    seen_root_cat = set()
    for _root in _scan_roots:
     for cat_name in ["精准流量", "泛流量"]:
        cat_dir = os.path.join(_root, cat_name)
        if not os.path.exists(cat_dir):
            continue
        cat_key = os.path.normcase(os.path.normpath(cat_dir))
        if cat_key in seen_root_cat:
            continue
        seen_root_cat.add(cat_key)
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

                norm_p = os.path.normcase(os.path.normpath(item_path)).rstrip("\\/")
                if norm_p not in allowed_paths:
                    continue
                if norm_p in seen_paths:
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
                        "priority": priority,
                        "is_emergency": False
                    })

    # 3. 按照目的地（subcategory）分组，实现真随机 + 平均交替轮转调度（打破字母排序死板）
    subcat_groups = defaultdict(list)
    for item in queue:
        subcat_groups[item["subcategory"]].append(item)
    
    # 每个目的地内部的素材打乱随机，消除固定头部扎堆
    for k in subcat_groups:
        random.shuffle(subcat_groups[k])

    # 目的地轮流抽取：每轮打乱抽取顺序，真正做到地域间平均且随机轮动
    balanced_queue = []
    dest_keys = list(subcat_groups.keys())
    max_len = max((len(v) for v in subcat_groups.values()), default=0)
    for i in range(max_len):
        round_dest_order = list(dest_keys)
        random.shuffle(round_dest_order)
        for k in round_dest_order:
            if i < len(subcat_groups[k]):
                balanced_queue.append(subcat_groups[k][i])

    # 4. 组装最终任务队列：紧急插队清单置顶！做完插队任务后无缝转入常规真随机平均轮转
    final_queue = emergency_queue + balanced_queue
    return final_queue

def get_account_alias(instance_id):
    mapping = {
        "A": "账号 1 · zwmrpg",
        "B": "账号 2 · orlandocardozo706",
        "C": "账号 3 · z x Plus",
        "D": "账号 4 · embrace.ping"
    }
    return mapping.get(instance_id, f"实例 {instance_id}")

def get_pipeline_info(instance_id):
    iid = str(instance_id).strip().upper()
    mapping = {
        "A": {
            "pipeline": "网页CDP-A-zwmrpg",
            "account": "zwmrpg",
            "worker": "Instance-A"
        },
        "B": {
            "pipeline": "网页CDP-B-orlandocardozo706",
            "account": "orlandocardozo706",
            "worker": "Instance-B"
        },
        "C": {
            "pipeline": "网页CDP-C-zxplus",
            "account": "zxplus",
            "worker": "Instance-C"
        },
        "D": {
            "pipeline": "网页CDP-D-embraceping",
            "account": "embraceping",
            "worker": "Instance-D"
        }
    }
    return mapping.get(iid, {
        "pipeline": f"网页CDP-{iid}",
        "account": f"account-{iid}",
        "worker": f"Instance-{iid}"
    })

# 全局状态字典
# 【2026-09-26 新增】每实例「连续失败」熔断：
# 单套失败已有 retryCount<3 / clientFailCount<8 的素材级限制，但缺少"产线级"保护 ——
# 根因没修好时会连续多套用同一种方式失败，把额度白白烧掉（09-26 晚上连烧多套的教训）。
# 连续失败达到上限即整条产线冷却并推飞书告警，成功一套立即清零。
INSTANCE_FAIL_STREAK = {}
FAIL_STREAK_LIMIT = 3          # 连续失败上限（同一实例）
FAIL_STREAK_COOLDOWN = 1800    # 触发熔断后该产线冷却 30 分钟

DAEMON_STATE = {

    "pid": os.getpid(),
    "started_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "last_heartbeat": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "completed_total": 72,
    "daily_quota": {
        "date": datetime.datetime.now().strftime("%Y-%m-%d"),
        "A": 0,
        "B": 0,
        "C": 0
    },
    "instances": {
        "A": {"port": 9431, "state": "IDLE", "current_package": None, "today_images": 0, "cruise_card_sent": False},
        "B": {"port": 9432, "state": "IDLE", "current_package": None, "today_images": 0, "cruise_card_sent": False},
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
    # 【2026-09-25 修·"成品白扔"元凶之一】原实现取不到行号时**硬编码 return 136**。
    # 实测该表已经到 587 行（read 回 A1:DM587），136 行早就被占用 → 随后的
    # csv-put --allow-overwrite=false 必然返回非 0 → append_to_feishu_sheet 抛错
    # → 上层把「图已出好 + 文案已写好 + Pillow 质检已通过」的整套成品判 failed，
    # 重试 3 次后连素材一起隔离。全天日志里 "获取表格行号异常 + 飞书行占位失败 code=4"
    # 这个组合出现 22 次，等于白扔 22 套成品。
    # 现改为：取不到行号就抛异常，交给上层按「飞书待补登」降级，绝不猜一个假行号去覆写。
    raise RuntimeError("飞书表格行号获取失败（读表返回空或结构异常），拒绝猜测行号以免覆写他人数据")


def verify_feishu_row_ownership(row, expected_label, expected_path):
    """在每次图片上传前复核双行所有权，防止并发实例把图片写进别人的行。"""
    cmd = [
        "node", LARK_RUN_JS, "sheets", "+cells-get",
        "--spreadsheet-token", SPREADSHEET_TOKEN,
        "--sheet-id", SPREADSHEET_SHEET_ID,
        "--range", f"A{row}:B{row}",
        "--format", "json"
    ]
    if FEISHU_STORAGE_PROFILE:
        cmd.extend(["--profile", FEISHU_STORAGE_PROFILE, "--as", "user"])
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=30)
    if res.returncode != 0:
        raise RuntimeError(f"飞书所有权回读失败 row={row}: {res.stderr[-300:]}")
    try:
        payload = json.loads(res.stdout)
        cells = payload["data"]["ranges"][0]["cells"][0]
        actual_label = cells[0].get("value") or ""
        actual_path = cells[1].get("value") or ""
    except Exception as exc:
        raise RuntimeError(f"飞书所有权回读结构异常 row={row}: {exc}")
    if actual_label != expected_label or actual_path != expected_path:
        raise RuntimeError(
            f"飞书所有权冲突 row={row}: expected=({expected_label},{expected_path}) "
            f"actual=({actual_label},{actual_path})"
        )
    return payload.get("data", {}).get("revision")


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
            "--csv", f"@{tmp_csv}",
            "--allow-overwrite=false"
        ]
        if FEISHU_STORAGE_PROFILE:
            cmd.extend(["--profile", FEISHU_STORAGE_PROFILE, "--as", "user"])
        res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
        if res.returncode != 0:
            if os.path.exists(tmp_csv):
                try: os.remove(tmp_csv)
                except: pass
            raise RuntimeError(f"飞书行占位失败（可能发生并发冲突）: code={res.returncode}, stderr={res.stderr[-500:]}")
        if os.path.exists(tmp_csv):
            try: os.remove(tmp_csv)
            except: pass

        # 预留后立即回读一次，随后每个图片格上传前都会再次核对所有权。
        verify_feishu_row_ownership(row_mat, r1[0], r1[1])
        verify_feishu_row_ownership(row_fin, r2[0], r2[1])

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
            verify_feishu_row_ownership(row_mat, r1[0], r1[1])
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
                res_img = subprocess.run(cmd_img, capture_output=True, text=True, encoding='utf-8')
                if res_img.returncode != 0:
                    raise RuntimeError(f"原素材图片上传失败 {cell}: {res_img.stderr[-300:]}")
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
            verify_feishu_row_ownership(row_fin, r2[0], r2[1])
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
                res_img = subprocess.run(cmd_img, capture_output=True, text=True, encoding='utf-8')
                if res_img.returncode != 0:
                    raise RuntimeError(f"成品图片上传失败 {cell}: {res_img.stderr[-300:]}")
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
            "--csv", f"@{tmp_m_csv}",
            "--allow-overwrite=false"
        ]
        if FEISHU_STORAGE_PROFILE:
            cmd_m.extend(["--profile", FEISHU_STORAGE_PROFILE, "--as", "user"])
        res_m = subprocess.run(cmd_m, capture_output=True, text=True, encoding='utf-8')
        if res_m.returncode != 0:
            if os.path.exists(tmp_m_csv):
                try: os.remove(tmp_m_csv)
                except: pass
            raise RuntimeError(f"飞书时间列写入失败: code={res_m.returncode}, stderr={res_m.stderr[-500:]}")
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
        return True, row_mat, row_fin
    except Exception as e:
        log(f"-> 飞书画册写入异常: {e}")
        return False, None, None

class InstanceWorker:
    def __init__(self, instance_id, cdp_port):
        self.id = instance_id
        self.cdp_port = cdp_port
        self.ws = None
        # 节拍埋点用：上一次「点发送」的绝对时间戳（算两次发送之间的真实间隔）
        self._last_send_ts = 0.0
        # 本套素材已用掉的页面软重载次数（上限 RELOAD_MAX_PER_ITEM，多了不许再刷）
        self._reload_used = 0

    async def connect(self):
        url = f"http://127.0.0.1:{self.cdp_port}/json"
        req = urllib.request.Request(url, headers={"User-Agent": "AutonomousProducer"})
        res = json.loads(urllib.request.urlopen(req, timeout=5).read().decode('utf-8'))
        
        # 智能过滤：优先寻找正常登录状态的 ChatGPT 页面，排除 /auth/login 与未登录的“开始使用”页，严格排除 assistant-overlay
        valid_pages = [p for p in res if 'chatgpt.com' in p.get('url', '') 
                       and p.get('type') == 'page' 
                       and 'assistant-overlay' not in p.get('url', '')
                       and 'auth/login' not in p.get('url', '')
                       and '开始使用' not in p.get('title', '')]
        if valid_pages:
            page = next((p for p in valid_pages if '/c/' in p.get('url', '')), valid_pages[0])
        else:
            page = None

        if not page:
            wb_page = next((p for p in res if '433' in p.get('url', '') and 'assistant-overlay' not in p.get('url', '') and p.get('type') == 'page'), None)
            if wb_page:
                ws_wb = await websockets.connect(wb_page['webSocketDebuggerUrl'])
                account_mapping = {"A": "account-1", "B": "account-2", "C": "account-3", "D": "account-4"}
                account_id = account_mapping.get(self.id, "account-1")
                js_show = f"window.gptWorkbench && window.gptWorkbench.show({{ x: 100, y: 100, width: 1200, height: 800 }}, '{account_id}')"
                await ws_wb.send(json.dumps({"id": 999, "method": "Runtime.evaluate", "params": {"expression": js_show}}))
                await asyncio.sleep(2)
                await ws_wb.close()
                res = json.loads(urllib.request.urlopen(url, timeout=5).read().decode('utf-8'))
                valid_pages = [p for p in res if 'chatgpt.com' in p.get('url', '') 
                               and p.get('type') == 'page' 
                               and 'assistant-overlay' not in p.get('url', '')
                               and 'auth/login' not in p.get('url', '')
                               and '开始使用' not in p.get('title', '')]
                if valid_pages:
                    page = next((p for p in valid_pages if '/c/' in p.get('url', '')), valid_pages[0])
                else:
                    page = next((p for p in res if 'chatgpt.com' in p.get('url', '') and 'assistant-overlay' not in p.get('url', '') and p.get('type') == 'page'), None)

        if not page:
            page = next((p for p in res if p.get('type') == 'page' and 'assistant-overlay' not in p.get('url', '') and 'chatgpt.com' in p.get('url', '')), None)
        if not page:
            raise RuntimeError(f"[{self.id}] 端口 {self.cdp_port} 未找到可连接的 ChatGPT 页面！")

        if 'auth/login' in page.get('url', '') or '开始使用' in page.get('title', ''):
            raise RuntimeError(f"[{self.id}] ChatGPT 当前处于未登录状态 ({page.get('url')})，请先登录该账号后再开工！")

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

    async def _page_generating_state(self):
        """返回 (是否真在生成, main 文本长度)。只看 main 尾部，避免历史消息里的旧文案误判。"""
        try:
            _rc = await self.send_cmd("Runtime.evaluate", {"expression": """(() => {
                const t = (document.querySelector('main')?.innerText || '');
                const tail = t.slice(-300);
                const stopBtn = Boolean(document.querySelector('button[data-testid="stop-button"], button[aria-label*="停止"], button[aria-label*="Stop"]'));
                const streaming = Boolean(document.querySelector('.result-streaming, [data-testid*="streaming"], [class*="streaming"]'));
                const sketching = /正在勾勒草图|正在生成|Generating|思考中|草图\s*\d+%/i.test(tail);
                return {gen: stopBtn || streaming || sketching, mainLen: t.length};
            })()""", "returnByValue": True}, timeout=15)
            v = _rc.get("result", {}).get("result", {}).get("value", {}) or {}
            return bool(v.get("gen")), int(v.get("mainLen") or 0)
        except Exception:
            return False, 0

    async def wait_until_idle(self, max_wait_sec=300, reason=""):
        """【2026-09-27 新增】等到页面**真的不再生成**再往下走。

        实测 02:01 A 线事故：出图轮询已判定「9/9 全部就绪」并进入文案阶段，
        但页面仍在「正在勾勒草图 55%」——此时注入文案指令，DOM 写得进去（1706 字）、
        Lexical EditorState 却收不到，四种通道全部点不亮发送按钮，文案环节整段空转。
        这就是「明明清空了、paste 也显示成功，按钮就是不亮」的真正原因之一。
        """
        deadline = time.time() + max_wait_sec
        last_len = None
        stable = 0
        waited = 0
        while time.time() < deadline:
            gen, ml = await self._page_generating_state()
            if not gen:
                if last_len is not None and ml == last_len:
                    stable += 1
                    if stable >= 2:
                        if waited > 0:
                            log(f"✅ 页面已完全空闲（{reason}，额外等待 {waited} 秒，文本停止增长）", self.id)
                        return True
                else:
                    stable = 0
            else:
                stable = 0
                if waited == 0 or waited % 60 == 0:
                    log(f"⏳ {reason}：页面仍在生成中，等待它彻底落地后再继续（已等 {waited} 秒）...", self.id)
            last_len = ml
            await asyncio.sleep(10)
            waited += 10
        log(f"⚠️ {reason}：等待页面空闲超时（{max_wait_sec} 秒），按异常放行", self.id)
        return False

    async def open_fresh_session(self):
        log("-> 开辟全新会话（SPA 页面复用，杜绝硬刷新）...", self.id)

        # 【2026-09-26 新增·用户拍板的循环步骤闸门】开新对话之前，必须先等本账号这条产线
        # 上一段产出彻底停下来。用户定义的正确循环是：
        #   (a) 发一套图的提示词 → 等图生成完；
        #   (b) 图出完再发文案提示词 → 等文案生成完；
        #   (c) 图 + 文案一起落进成品库；
        #   (d) 然后才开新对话，上传下一套素材。
        # 中间"等待产出"的那段就是天然冷却期，绝不能图还没落地就去开下一套 ——
        # 那正是触发风控（图变慢、冷却变长、质量变差）的节奏。
        # 注意：A/B/C 各实例是互相独立的产线，这里只卡"本实例自己"的上一段，不跨实例互等。
        _idle_deadline = time.time() + 600   # 最多等 10 分钟，超时则放行并告警
        _pending_since = None                # 编辑框残留计时起点（用于防死锁）
        # 【2026-09-27 修·「生成中」假阳性把产线白锁 15 分钟】
        # 旧判据只要页面上有 aria-label="停止" 的按钮就算"生成中"。实测实例 A 的 composer 区
        # 常驻这样一个按钮（class=...button-composer...），即便编辑框空空、页面毫无输出
        # 也会被判成"生成中" → 新会话永远开不出来，产线从 00:07 起整段卡死。
        # 真生成的硬证据是：(1) button[data-testid="stop-button"] 存在；
        # (2) .result-streaming 一类流式标记存在。
        # 只有 aria-label 命中而两者皆无时，用「main 文本是否在增长」做二次佐证：
        # 连续 45 秒长度不变 → 判定 UI 残留假阳性，立即放行。
        _gen_stall_since = None
        _last_main_len = None
        _gen_released = False
        while time.time() < _idle_deadline:
            try:
                _rc = await self.send_cmd("Runtime.evaluate", {"expression": """(() => {
                    const genLabel = Boolean(document.querySelector('[data-testid*="stop"], button[aria-label*="停止"], button[aria-label*="Stop"]'));
                    const stopBtn = Boolean(document.querySelector('button[data-testid="stop-button"]'));
                    const streaming = Boolean(document.querySelector('.result-streaming, [data-testid*="streaming"], [class*="streaming"]'));
                    const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"][role="textbox"]') || document.querySelector('[role="textbox"]') || document.querySelector('textarea');
                    const pending = ((ta?.innerText || ta?.value || '').trim().length > 0);
                    const mainLen = (document.querySelector('main')?.innerText || '').length;
                    return {genLabel: genLabel, stopBtn: stopBtn, streaming: streaming, pending: pending, mainLen: mainLen};
                })()""", "returnByValue": True}, timeout=15)
                _st = _rc.get("result", {}).get("result", {}).get("value", {})
            except Exception:
                _st = {}
            _real_generating = bool(_st.get("stopBtn") or _st.get("streaming"))
            if _st.get("genLabel") and not _real_generating and not _gen_released:
                _ml = _st.get("mainLen") or 0
                if _last_main_len is not None and _ml == _last_main_len:
                    if _gen_stall_since is None:
                        _gen_stall_since = time.time()
                else:
                    _gen_stall_since = None
                _last_main_len = _ml
                if _gen_stall_since and (time.time() - _gen_stall_since) > 45:
                    log("⚠️「停止」按钮在，但页面文本已 45 秒零增长且无流式标记 → "
                        "判定为 composer 区 UI 残留（假阳性），不再空等，放行开新会话", self.id)
                    _gen_released = True
            _generating = _real_generating or (bool(_st.get("genLabel")) and not _gen_released)
            if not _generating and not _st.get("pending", False):
                break

            # 【防死锁 2026-09-26】编辑框残留（上一段注入失败留下的半截提示词）不会被任何人清空，
            # 如果只干等就会在这里空转。判定：只要「没在生成」且残留已挂超过 45 秒，
            # 就由脚本自己把编辑框清干净再放行（残留文本作废，本轮会重新注入完整提示词）。
            if (not _generating) and _st.get("pending", False):
                if _pending_since is None:
                    _pending_since = time.time()
                elif time.time() - _pending_since > 45:
                    log("🧹 编辑框残留文本已挂 45 秒且并未在生成，判定为上一段注入失败残留，主动清空后放行", self.id)
                    try:
                        await self.send_cmd("Runtime.evaluate", {"expression": """(() => {
                            const ta = document.querySelector('#prompt-textarea') ||
                                       document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                                       document.querySelector('[role="textbox"]') || document.querySelector('textarea');
                            if (!ta) return false;
                            ta.focus();
                            const sel = window.getSelection();
                            const range = document.createRange();
                            range.selectNodeContents(ta);
                            sel.removeAllRanges(); sel.addRange(range);
                            document.execCommand('delete');
                            ta.dispatchEvent(new Event('input', {bubbles: true}));
                            return true;
                        })()""", "returnByValue": True}, timeout=15)
                    except Exception:
                        pass
                    await asyncio.sleep(2)
                    break
            else:
                _pending_since = None

            log(f"⏳ 本产线上一段产出仍在进行（真生成={_real_generating}｜编辑框待发={_st.get('pending')}），"
                f"按循环步骤等它完全落地后再开新对话...", self.id)
            await asyncio.sleep(5)
        else:
            log("⚠️ 等待上一段产出落地超过 10 分钟仍未停止，按异常处理放行（请人工核查该会话）", self.id)
        
        for attempt in range(35):
            js_status = """(() => {
                const isConv = window.location.pathname.startsWith('/c/');
                const isRoot = window.location.pathname === '/' || window.location.pathname === '';
            const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"][role="textbox"]') || document.querySelector('[role="textbox"]') || document.querySelector('textarea');
                const fileInput = document.querySelector('input[type="file"]') || document.querySelector('input#upload-files');
                const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"], [data-message-author-role="assistant"]'));
                return {
                    isConv,
                    isRoot,
                    ready: isRoot && !!ta && turns.length === 0,
                    url: window.location.href,
                    hasTa: !!ta,
                    hasFileInput: !!fileInput,
                    turnCount: turns.length
                };
            })()"""
            rc = await self.send_cmd("Runtime.evaluate", {"expression": js_status, "returnByValue": True})
            v = rc.get("result", {}).get("result", {}).get("value", {})
            
            if v.get("ready"):
                log(f"-> 纯净新会话已就绪！({v.get('url')})，等待 DOM 稳定 2 秒...", self.id)
                await asyncio.sleep(2)
                # 【关键防御】强制清除残留附件：上一套熔断/切换后富文本框可能挂着旧附件
                js_clear_attachments = """(() => {
                    const removeBtns = Array.from(document.querySelectorAll(
                        'button[aria-label*="移除"], button[aria-label*="Remove"], button[aria-label*="删除"], button[data-testid*="remove-attachment"]'
                    ));
                    removeBtns.forEach(btn => { try { btn.click(); } catch(e) {} });
                    return removeBtns.length;
                })()"""
                try:
                    r_clear = await self.send_cmd("Runtime.evaluate", {"expression": js_clear_attachments, "returnByValue": True}, timeout=10)
                    cleared = r_clear.get("result", {}).get("result", {}).get("value", 0)
                    if cleared > 0:
                        log(f"-> ⚠️ 清除残留附件 {cleared} 个（防止旧附件叠加进新素材）", self.id)
                        await asyncio.sleep(1)
                except Exception:
                    pass
                # 【2026-09-26 新增】每套开始时把推理强度设为「高」（用户要求，平台默认是「中」）。
                # 控件路径：composer 旁 button[aria-label*="选择 ChatGPT 模型"] -> Radix 菜单 ->
                # [role="slider"] 强度滑块（aria-valuenow: 0=低 1=中 2=高），聚焦后 trusted
                # ArrowRight 推到 2。失败不阻断生产。
                try:
                    js_open_effort = """(() => {
                        const b = document.querySelector('button[aria-label*="选择 ChatGPT 模型"]');
                        if (!b) return 'no-btn';
                        if (b.getAttribute('aria-expanded') !== 'true') b.click();
                        return 'opened';
                    })()"""
                    await self.send_cmd("Runtime.evaluate", {"expression": js_open_effort, "returnByValue": True}, timeout=10)
                    await asyncio.sleep(1.0)
                    js_focus_slider = """(() => {
                        const w = document.querySelector('[data-radix-popper-content-wrapper]');
                        const s = w && w.querySelector('[role="slider"]');
                        if (!s) return 'no-slider';
                        s.focus();
                        return s.getAttribute('aria-valuenow');
                    })()"""
                    r_f = await self.send_cmd("Runtime.evaluate", {"expression": js_focus_slider, "returnByValue": True}, timeout=10)
                    _now_eff = str(r_f.get("result", {}).get("result", {}).get("value", ""))
                    if _now_eff.isdigit() and int(_now_eff) < 2:
                        for _ in range(2):
                            await self.send_cmd("Input.dispatchKeyEvent", {"type": "keyDown", "key": "ArrowRight", "code": "ArrowRight", "windowsVirtualKeyCode": 39, "nativeVirtualKeyCode": 39}, timeout=10)
                            await self.send_cmd("Input.dispatchKeyEvent", {"type": "keyUp", "key": "ArrowRight", "code": "ArrowRight", "windowsVirtualKeyCode": 39, "nativeVirtualKeyCode": 39}, timeout=10)
                            await asyncio.sleep(0.5)
                            _r_c = await self.send_cmd("Runtime.evaluate", {"expression": "(()=>{const w=document.querySelector('[data-radix-popper-content-wrapper]');const s=w&&w.querySelector('[role=\"slider\"]');return s?s.getAttribute('aria-valuenow'):'2';})()", "returnByValue": True}, timeout=10)
                            if str(_r_c.get("result", {}).get("result", {}).get("value", "2")) == "2":
                                break
                        log("-> 推理强度已设为「高」", self.id)
                    elif _now_eff == "2":
                        log("-> 推理强度已是「高」，无需调整", self.id)
                    for _k_esc in ("keyDown", "keyUp"):
                        try:
                            await self.send_cmd("Input.dispatchKeyEvent", {"type": _k_esc, "key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27, "nativeVirtualKeyCode": 27}, timeout=10)
                        except Exception:
                            break
                    await asyncio.sleep(0.5)
                except Exception as _e_eff:
                    log(f"⚠️ 推理强度设置失败（不阻断）: {_e_eff}", self.id)
                return True

            # 如果在会话中或者非根路径，触发返回首页操作
            if v.get("isConv") or not v.get("isRoot"):
                if attempt % 5 == 0:
                    log(f"当前处于历史会话 ({v.get('url')})，执行物理导航回主页...", self.id)
                    try:
                        await self.send_cmd("Page.navigate", {"url": "https://chatgpt.com/"})
                    except Exception as ne:
                        log(f"CDP 导航指令抖动: {ne}", self.id)
            else:
                if attempt % 5 == 0:
                    await self.send_cmd("Runtime.evaluate", {
                        "expression": """(() => {
                            const btn = document.querySelector('a[href="/"], button[aria-label*="新聊天"], button[aria-label*="New chat"], a[data-testid*="new-chat"]');
                            if (btn) btn.click();
                        })()""",
                        "returnByValue": False
                    })
            await asyncio.sleep(1)

        log("新会话探针初次等待超时，执行终极 Page.navigate 强力重置...", self.id)
        await self.send_cmd("Page.navigate", {"url": "https://chatgpt.com/"})
        await asyncio.sleep(4)
        return True

    def prepare_material_images(self, mat_dir, max_imgs=10):
        files = [f for f in os.listdir(mat_dir) if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp'))]
        def extract_num(f):
            m = re.search(r'\d+', f)
            return int(m.group(0)) if m else 9999
        files.sort(key=extract_num)

        cover = next((f for f in files if 'cover' in f.lower() or '封面' in f), None)
        if not cover and files:
            cover = files[0]

        inners = [f for f in files if f != cover]
        # Web-CDP 硬上限 10 张：封面 1 张 + 内页最多 9 张，避免客户端超出画册规格
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

    async def send_text_prompt(self, prompt_text, action_desc="发送指令", max_wait_sec=25, require_attachment=False):
        # require_attachment=True 表示「这一次发送必须已经挂着上传好的素材」——
        # 用户铁律：没上传就点发送 = 发出一条空指令，模型无米下锅、白烧额度、还会制造假提交。
        # 这里在「点发送之前」做硬校验，附件数为 0 就直接拒绝，绝不让按钮被点下去。
        # 【2026-09-26 修·节奏风控】提交节流闸（实例级）：距本实例上次提交不足 150~240 秒
        # 就强制等待。目标节奏：上一套完全落地（图+文案）后才提交下一套，
        # 杜绝单账号高频提交（OC Card 341 次/天）触发平台风控。
        try:
            _gate = getattr(self, "_submit_gate", None)
            if _gate is None:
                _gate = {"ts": 0.0}
                self._submit_gate = _gate
            _wait = _gate["ts"] + random.randint(150, 240) - time.time()
            if _wait > 0:
                log(f"🚦 提交节流：距本实例上次提交不足冷却期，等待 {int(_wait)} 秒（保证上一套完全落地后再发下一套）", self.id)
                await asyncio.sleep(_wait)
        except Exception as _e_gate:
            log(f"⚠️ 提交节流闸异常（不阻断）: {_e_gate}", self.id)
        log(f"注入 {action_desc}...", self.id)
        # [2026-09-23 修] 注入前必须先等页面停止生成。
        # 模型仍在输出时渲染线程繁忙，Input.insertText 会超时并连带把 CDP WebSocket 拖断，
        # 实测文案阶段高频失败就是它： "CDP 通信抖动 (Input.insertText)" -> 重连后仍失败 -> 整套判废。
        # 这里轮询"停止生成"按钮是否消失，最多等 90 秒；超时或探测异常都不阻断，交回原有流程。
        try:
            js_generating = (
                "Boolean(document.querySelector('[data-testid*=\"stop\"], "
                "button[aria-label*=\"停止\"], button[aria-label*=\"Stop\"]'))"
            )
            for _ in range(60):
                r_gen = await self.send_cmd(
                    "Runtime.evaluate",
                    {"expression": js_generating, "returnByValue": True},
                    timeout=15,
                )
                if not r_gen.get("result", {}).get("result", {}).get("value", False):
                    break
                await asyncio.sleep(2)
            else:
                log("⚠️ 页面停止按钮 120 秒未自动消失，主动点击停止按钮以释放编辑框...", self.id)
                await self.send_cmd("Runtime.evaluate", {"expression": """(() => {
                    const sb = document.querySelector('button[aria-label*="停止"], button[aria-label*="Stop"], [data-testid*="stop"]');
                    if (sb) sb.click();
                    return !!sb;
                })()""", "returnByValue": True}, timeout=10)
                await asyncio.sleep(3)
        except Exception:
            pass
        # 关键兼容修复：不要只派发合成 ClipboardEvent。
        # 新版 ChatGPT 编辑框可能只更新可见 DOM，不更新 React 状态，导致按钮看似可点但消息没有真正提交。
        # 先用 execCommand 写入可见编辑框，再走表单原生 requestSubmit；这是当前网页端能稳定确认 user turn 的路径。
        #
        # 【2026-09-25 修·composer 定位】新版前端的真 composer 是 DIV#prompt-textarea.ProseMirror
        # （contenteditable=true / role=textbox）；页面上唯一的 <textarea> 是 0×0 的
        # wcDTda_fallbackTextarea（ProseMirror 的隐藏兜底），选中它 focus 无效。
        # 原组合选择器走的是「文档序第一个匹配」，一旦 <textarea> 排在前面就挑错元素；
        # 这里改成显式 || 链，语义确定。
        _JS_FIND_COMPOSER = """const _c = document.querySelector('#prompt-textarea')
            || document.querySelector('div[contenteditable="true"][role="textbox"]')
            || document.querySelector('[role="textbox"]')
            || document.querySelector('textarea');"""
        # 【2026-09-26 修·清空编辑框会把刚上传的附件一起删掉】
        # 原实现无条件 selectAll + delete：在 composer 上执行会把**已挂载的附件 chip 一并删除**。
        # 后果极隐蔽 —— 上传阶段明明确认挂载 8 张，注入提示词后附件数变 0，
        # 空发送闸门正确地把这次点发送拦了下来（它是对的），但整套因此作废，
        # 于是产线永远停在「上传→ 注入 → 附件没了 → 判失败 → 重走上传」的死循环。
        # 改法：**有附件时绝不整体清空**，只把光标移到末尾；确实没有附件时才清残留文本。
        # 【2026-09-27 二次加固·本套已确认挂过附件时，连"清空"这条路都不许走】
        # 即便探测器这一瞬间数出 0，只要上传阶段真真切切挂载过（self._attached_count > 0），
        # 整体 selectAll+delete 就是**把已挂好的图全删掉**（实测 00:22 上传 9 张 → 发送前 0 张），
        # 空发送闸门随后正确地拦下来，整套作废，产线进入"上传→注入→附件没了→重走"的死循环。
        # 宁可留着 1 个字的残留文本（后面 execCommand 会追加/覆盖），也绝不动附件 chip。
        # 【2026-09-27 补·保护只在"生图阶段"开，文案阶段必须允许清空】
        # 文案阶段不需要带附件（图早已发出），但 self._attached_count 还留着上一轮的 10，
        # 于是保护误开 → 编辑框里上一轮的残留文本没被清掉 → paste 虽写进 DOM（1706 字）
        # 却因 EditorState 收不到干净内容而点不亮发送按钮 → 四通道全废、文案环节空转。
        # （实测 00:56 A 线：DOM 5320 字 vs 目标 1695 字，按钮始终不可用。）
        _keep_attached = bool(int(getattr(self, "_attached_count", 0) or 0) > 0) and require_attachment
        js_prepare = """(() => {
            %s
            if (!_c) return {ok: false, reason: 'composer_not_found'};
            const _nAtt = %s;
            _c.focus();
            if (_nAtt > 0 || %s) {
                const _sel = window.getSelection();
                if (_sel && _c.lastChild) {
                    const _r = document.createRange();
                    _r.selectNodeContents(_c);
                    _r.collapse(false);
                    _sel.removeAllRanges();
                    _sel.addRange(_r);
                }
                return {ok: true, tag: _c.tagName, cleared: false, attached: _nAtt, guarded: %s};
            }
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
            return {ok: true, tag: _c.tagName, cleared: true, attached: 0, guarded: false};
        })()""" % (_JS_FIND_COMPOSER,
                   _JS_COUNT_ATTACH,
                   "true" if _keep_attached else "false",
                   "true" if _keep_attached else "false")
        r_prepare = await self.send_cmd("Runtime.evaluate", {"expression": js_prepare, "returnByValue": True}, timeout=30)
        prep = r_prepare.get("result", {}).get("result", {}).get("value", {})
        if not prep.get("ok"):
            log(f"⚠️ {action_desc}失败：{prep.get('reason', '编辑框不可用')}", self.id)
            return False
        # 打点：注入准备阶段看到的附件数，便于定位"上传后附件消失"到底发生在哪一步
        log(f"🔎 注入准备：探测附件 {prep.get('attached')} 个（清空={prep.get('cleared')}，"
            f"附件保护={'开' if prep.get('guarded') else '关'}）", self.id)

        # 【2026-09-25 修·注入链换血（A/B 整夜零产出的又一真凶）】
        # 原实现用 CDP 原生 Input.insertText 分块写入，块大小从 2000 调到 600 两次都没治本。
        # 实测（实例 9431 / 2026-09-25 07:55）证明根因不是文本长度，而是「窗口没有 OS 焦点」：
        #   document.hasFocus() = false 时
        #     Input.insertText('X')            -> 5011ms 超时（1 个字符！）
        #     Input.insertText(600 字块)       -> 30005ms 超时
        #     Emulation.setFocusEmulationEnabled(true) 能让 hasFocus 变 true，但 insertText 依旧超时
        #   document.execCommand('insertText', false, chunk) 完全不受影响：
        #     14451 字 / 15 块 / 每块 6~29ms / 总耗时 1197ms，
        #     #prompt-textarea.innerText 正常增长，发送按钮如期点亮（disabled=false）
        # 无人值守的夜里窗口必然失焦 -> 旧链路必然挂死 -> 日志「CDP 通信抖动 (Input.insertText)」
        # -> 重连后仍失败 -> 整套判 failed + 素材被物理隔离。
        # 现在整条注入链改走 execCommand，彻底摆脱 OS 焦点依赖与 CDP Input 域。
        # 【2026-09-26 三次换血·灰度版 Lexical 不认 execCommand】11:28 实测决定性证据：
        # execCommand('insertText','hi') 后 DOM 里有字，但 send-button 不出现（按钮由 Lexical
        # EditorState 驱动）-> 框架状态仍为空 -> 一切 click/Enter 都按空输入处理 -> 假提交。
        # 新首选注入链 = 剪贴板粘贴（与真人复制粘贴同管道，编辑器原生支持）：
        #   Browser.grantPermissions 授权剪贴板 -> navigator.clipboard.writeText 写全文
        #   -> 聚焦编辑框 -> Input.dispatchKeyEvent trusted Ctrl+V 粘贴。
        # 粘贴事件走编辑器原生 beforeinput(clipboard) 处理，Lexical 必然感知。
        # 失败才回退旧 execCommand 分块链。
        # 【2026-09-26 四次换血·用 paste 事件直喂 Lexical】20:05 实测决定性证据：
        # execCommand 注入 12944 字后 DOM 长度自检通过（13474），button.click 也执行了，
        # 但 userTurns 始终 0 —— 消息压根没进对话。DOM 有字 ≠ EditorState 有字。
        # 剪贴板那条路（navigator.clipboard + trusted Ctrl+V）在本机实测写不进去。
        # 改走页面内合成 paste 事件：DataTransfer + ClipboardEvent，Lexical 的
        # PASTE_COMMAND 原生处理这条管道，EditorState 才会真正更新。
        # 判据不再是"DOM 长度"，而是 **send-button 是否 enabled**（由 EditorState 驱动）。
        _paste_ok = False
        try:
            _js_paste_evt = """(() => {
                %s
                if (!_c) return {ok: false, reason: 'no_composer'};
                _c.focus();
                const dt = new DataTransfer();
                dt.setData('text/plain', %s);
                const ev = new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true});
                _c.dispatchEvent(ev);
                const domLen = ((_c.innerText !== undefined ? _c.innerText : _c.value) || '').length;
                // 【2026-09-26 决定性修复】旧判据只认 data-testid="send-button"，
                // 而灰度版 UI 上这个 testid **根本不存在**（真实按钮是 aria-label*="发送"）。
                // 后果：文本明明写进 DOM 了，btnFound 恒为 False → 三通道全判失败 →
                // 「三种注入通道都没能让 EditorState 收到内容」→ 整套作废、换新会话重来。
                // 一天几百次空转大半由此而来。这里换成与提交一致的完整选择器链。
                const btn = document.querySelector('button[data-testid="send-button"]')
                         || document.querySelector('button[aria-label*="Send"]')
                         || document.querySelector('button[aria-label*="发送"]')
                         || document.querySelector('button.composer-submit-btn');
                return {ok: true, domLen: domLen, btnFound: !!btn, btnEnabled: btn ? !btn.disabled : null};
            })()""" % (_JS_FIND_COMPOSER,
                        json.dumps(prompt_text, ensure_ascii=False).replace('\u2028', '\\u2028').replace('\u2029', '\\u2029'))
            _r_pe = await self.send_cmd("Runtime.evaluate", {"expression": _js_paste_evt, "returnByValue": True}, timeout=60)
            _pe = _r_pe.get("result", {}).get("result", {}).get("value", {})
            # 【2026-09-26 二次修·判据必须是 DOM 长度】
            # 只认 btnEnabled 会误判：实测出现「DOM 只有 1 字，send-button 却是 enabled」的情况
            # （编辑器为空时按钮也可能是启用态），于是把 paste 判成成功、跳过后面真正能写进去的
            # execCommand 链，结果整套卡在 1 个字上。判据回归事实：编辑框里真有那么多字才算数。
            _need_dom = max(30, int(len(prompt_text) * 0.5))
            if isinstance(_pe, dict) and int(_pe.get("domLen", 0) or 0) >= _need_dom:
                _paste_ok = True
                log(f"-> paste 事件注入成功（DOM {_pe.get('domLen')} / 目标 {len(prompt_text)} 字，内容已真实写入）", self.id)
            else:
                log(f"⚠️ paste 事件注入后编辑框仅 {(_pe or {}).get('domLen')} 字（目标 {len(prompt_text)}），"
                    f"内容没进去，继续尝试剪贴板链", self.id)
        except Exception as _e_pe:
            log(f"⚠️ paste 事件注入异常: {str(_e_pe)[:120]}，继续尝试剪贴板链", self.id)
        if not _paste_ok:
            try:
                await self.send_cmd("Browser.grantPermissions", {"permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"]}, timeout=10)
                _js_clip = """(async () => {
                const t = %s;
                await navigator.clipboard.writeText(t);
                return (await navigator.clipboard.readText()).length;
            })()""" % json.dumps(prompt_text, ensure_ascii=False).replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
                _r_clip = await self.send_cmd("Runtime.evaluate", {"expression": _js_clip, "returnByValue": True, "awaitPromise": True}, timeout=20)
                _clip_len = _r_clip.get("result", {}).get("result", {}).get("value", -1)
                if _clip_len and _clip_len >= len(prompt_text) - 10:
                    # 聚焦编辑框 + trusted Ctrl+V
                    await self.send_cmd("Runtime.evaluate", {"expression": _JS_FIND_COMPOSER + " if (_c) { _c.focus(); }", "returnByValue": True}, timeout=10)
                    await self.send_cmd("Input.dispatchKeyEvent", {"type": "keyDown", "modifiers": 2, "key": "v", "code": "KeyV", "windowsVirtualKeyCode": 86, "nativeVirtualKeyCode": 86}, timeout=10)
                    await self.send_cmd("Input.dispatchKeyEvent", {"type": "keyUp", "modifiers": 2, "key": "v", "code": "KeyV", "windowsVirtualKeyCode": 86, "nativeVirtualKeyCode": 86}, timeout=10)
                    await asyncio.sleep(1.5)
                    # 粘贴后自检：编辑框长度必须接近目标（说明框架真收下了）
                    _r_pv = await self.send_cmd("Runtime.evaluate", {"expression": """(() => {
                    %s
                    return _c ? (((_c.innerText !== undefined ? _c.innerText : _c.value) || '').length) : -1;
                })()""" % _JS_FIND_COMPOSER, "returnByValue": True}, timeout=15)
                    _pv_len = _r_pv.get("result", {}).get("result", {}).get("value", -1)
                    if _pv_len is not None and _pv_len >= max(30, int(len(prompt_text) * 0.5)):
                        _paste_ok = True
                        log(f"-> 剪贴板粘贴注入成功（编辑框 {_pv_len} / 目标 {len(prompt_text)}）", self.id)
                    else:
                        log(f"⚠️ 剪贴板粘贴后编辑框长度异常（{_pv_len} / {len(prompt_text)}），回退 execCommand 链", self.id)
                else:
                    log(f"⚠️ 剪贴板写入异常（len={_clip_len}），回退 execCommand 链", self.id)
            except Exception as _e_paste:
                log(f"⚠️ 剪贴板粘贴链异常: {_e_paste}，回退 execCommand 链", self.id)
        # 【2026-09-26 六次换血·检测真源换血】20:55 决定性实验：
        # 清掉残留附件 -> execCommand 注入"请只回复两个字：收到" -> 点 button[aria-label*="发送"]
        # -> main 里真的出现了「你说：… / ChatGPT 说：收到」，模型正常回复。
        # 但同一时刻 [data-message-author-role] / [data-testid^="conversation-turn"] / article 全部为 0！
        # 结论：**这套选择器在新版 UI 上已全部失效**，主脑因此永远看到"0 条用户消息"，
        # 把每一次真·提交都判成假提交 —— 补发空 Enter -> 仍"失败" -> 整套作废换新会话重来。
        # 一天 341 次生产启动、侧边栏几十个会话同时"在生成"、被风控，全是从这一个失效判据长出来的。
        # 真源改用 main.innerText 长度（实验实测 19 -> 66 增长可靠）+ 会话 URL 变化。
        # 【2026-09-27 修·提交基线被编辑器长度污染】
        # 旧写法直接量 main.innerText.length，而编辑框本身就在 main 里：
        # 提交后「编辑框清空(-14574)」与「用户消息上屏(+14062)」互相抵消，净增长是**负数**(-512)，
        # 永远达不到 _need(prompt 的 20%)。首条生图指令还能靠「URL 从 / 变 /c/xxx」蒙对一次，
        # 同会话内的第二条（V4.5 文案指令）URL 不再变化 → 100% 判「未获网页提交确认」。
        # 现改为克隆 main 后剔除表单/输入区，只量真正「已上屏的会话内容」。
        _JS_TURN_BASE = """(() => {
            const m = document.querySelector('main');
            let len = 0;
            if (m) {
                const clone = m.cloneNode(true);
                clone.querySelectorAll('form, textarea, [contenteditable="true"], [data-testid*="composer"]')
                     .forEach(n => { try { n.remove(); } catch (e) {} });
                len = (clone.innerText || clone.textContent || '').length;
            }
            return {mainLen: len, url: location.href};
        })()"""

        async def _turn_baseline():
            try:
                _r = await self.send_cmd("Runtime.evaluate", {"expression": _JS_TURN_BASE, "returnByValue": True}, timeout=15)
                _v = _r.get("result", {}).get("result", {}).get("value", {}) or {}
                return int(_v.get("mainLen", 0) or 0), str(_v.get("url", "") or "")
            except Exception:
                return 0, ""

        if _paste_ok:
            await asyncio.sleep(0.6)
            baseline_user_count, baseline_url = await _turn_baseline()
            # 直接跳过旧注入链：把剩余分块数清零
            _total_chunks = 0
            _inject_ok = True
        _INJECT_CHUNK = 1000
        _total_chunks = 0 if _paste_ok else (len(prompt_text) + _INJECT_CHUNK - 1) // _INJECT_CHUNK
        _inject_ok = True
        for _csi in range(_total_chunks):
            chunk = prompt_text[_csi * _INJECT_CHUNK:(_csi + 1) * _INJECT_CHUNK]
            _chunk_js = json.dumps(chunk, ensure_ascii=False).replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
            _js_ins = """(() => {
                %s
                if (!_c) return -1;
                _c.focus();
                const _ok = document.execCommand('insertText', false, %s);
                return _ok ? (((_c.innerText !== undefined ? _c.innerText : _c.value) || '').length) : -1;
            })()""" % (_JS_FIND_COMPOSER, _chunk_js)
            _len_ins = -1
            try:
                _r_ins = await self.send_cmd("Runtime.evaluate", {"expression": _js_ins, "returnByValue": True}, timeout=30)
                _len_ins = _r_ins.get("result", {}).get("result", {}).get("value", -1)
            except Exception as _e_ins:
                log(f"⚠️ execCommand 注入第 {_csi + 1}/{_total_chunks} 块异常: {_e_ins}", self.id)
            if _len_ins is None or _len_ins < 0:
                # 兜底：极端情况下退回 CDP 原生 insertText（窗口有焦点的场景仍可用）
                log(f"⚠️ execCommand 注入第 {_csi + 1}/{_total_chunks} 块返回异常，回退 CDP Input.insertText", self.id)
                try:
                    await self.send_cmd("Input.insertText", {"text": chunk}, timeout=30)
                except Exception as _e_fb:
                    _inject_ok = False
                    log(f"🚨 注入链双双失败（块 {_csi + 1}/{_total_chunks}）: {_e_fb}", self.id)
                    break
            await asyncio.sleep(0.06)
        if not _inject_ok:
            log(f"⚠️ {action_desc}失败：注入链不可用，拒绝提交", self.id)
            return False
        # 【2026-09-26 五次换血·提交前 EditorState 同步修复】
        # 黄金判据：**send-button 是否出现且可用** —— 编辑框真有内容时它才渲染（空则根本不渲染）。
        # execCommand / paste 事件 / 剪贴板三条路实测都只写进 DOM，Lexical EditorState 仍空
        # （20:16 实测：domLen=1、btnFound=False），此时 click 或 form.requestSubmit 都只提交一条
        # 空消息：编辑框被清空、消息进不了对话 —— 这就是「userTurns 始终 0」的假提交出口。
        # 提交前逐级把内容真正喂进 EditorState，全失败就干脆不提交，不白烧额度、不制造假提交。
        _js_text_full = json.dumps(prompt_text, ensure_ascii=False).replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')

        async def _editor_state_ready():
            _js = """(() => {
                %s
                if (!_c) return {found: false};
                // 同 1920 行的决定性修复：必须认 aria-label*="发送"，只认 testid 会恒判失败
                const b = document.querySelector('button[data-testid="send-button"]')
                       || document.querySelector('button[aria-label*="Send"]')
                       || document.querySelector('button[aria-label*="发送"]')
                       || document.querySelector('button.composer-submit-btn');
                return {found: true, btnFound: !!b, btnEnabled: b ? !b.disabled : false,
                        domLen: ((_c.innerText !== undefined ? _c.innerText : _c.value) || '').length};
            })()""" % _JS_FIND_COMPOSER
            try:
                _r = await self.send_cmd("Runtime.evaluate", {"expression": _js, "returnByValue": True}, timeout=15)
                return _r.get("result", {}).get("result", {}).get("value", {}) or {}
            except Exception:
                return {}

        _st = await _editor_state_ready()
        if _st.get("found") and not _st.get("btnEnabled"):
            log(f"⚠️ 提交前自检：send-button 不可用（DOM 已有 {_st.get('domLen')} 字）= Lexical EditorState 为空，"
                f"先用 beforeinput 通道把全文真正喂进去...", self.id)
            try:
                await self.send_cmd("Runtime.evaluate", {"expression": """(() => {
                    %s
                    if (!_c) return -1;
                    _c.focus();
                    const sel = window.getSelection();
                    if (sel && _c.firstChild) { const rg = document.createRange(); rg.selectNodeContents(_c); rg.collapse(false); sel.removeAllRanges(); sel.addRange(rg); }
                    _c.dispatchEvent(new InputEvent('beforeinput', {inputType: 'insertText', data: %s, bubbles: true, cancelable: true}));
                    _c.dispatchEvent(new InputEvent('input', {inputType: 'insertText', data: %s, bubbles: true}));
                    return 1;
                })()""" % (_JS_FIND_COMPOSER, _js_text_full, _js_text_full), "returnByValue": True}, timeout=60)
                await asyncio.sleep(1.5)
            except Exception as _e_bi:
                log(f"⚠️ beforeinput 注入异常: {str(_e_bi)[:100]}", self.id)
            _st = await _editor_state_ready()

        if _st.get("found") and not _st.get("btnEnabled"):
            log("⚠️ beforeinput 仍未让按钮可用，改用 CDP 原生 Input.insertText 分块重写（浏览器 trusted 输入）...", self.id)
            try:
                # 同上：有附件时绝不整体清空，否则重写文本前就把素材删没了
                await self.send_cmd("Runtime.evaluate", {"expression": _JS_FIND_COMPOSER +
                    " if (_c) { _c.focus(); const _rb=document.querySelectorAll('button[aria-label*=\"移除文件\"], button[aria-label*=\"Remove file\"]');"
                    " const _im=document.querySelectorAll('form img[src^=\"blob:\"]');"
                    " if (Math.max(_rb.length, _im.length) === 0) { const _sel=window.getSelection(); if (_sel) { const _rg=document.createRange(); _rg.selectNodeContents(_c); _sel.removeAllRanges(); _sel.addRange(_rg); } document.execCommand('delete', false, null); } }",
                    "returnByValue": True}, timeout=15)

                for _i in range(0, len(prompt_text), 500):
                    await self.send_cmd("Input.insertText", {"text": prompt_text[_i:_i + 500]}, timeout=30)
                await asyncio.sleep(1.5)
            except Exception as _e_it:
                log(f"⚠️ Input.insertText 失败: {str(_e_it)[:100]}", self.id)
            _st = await _editor_state_ready()

        if _st.get("found") and not _st.get("btnEnabled"):
            # 【2026-09-26 补·第四条通道 = execCommand 分块重写】
            # 决定性证据（23:46 实测）：图阶段 14063 字走的就是 execCommand 分块链，
            # 按钮被点亮、消息真的发了出去、出图 7/7 全部就绪；
            # 而文案阶段 paste 虽然把字写进了 DOM（2416 字），Lexical 就是不认，按钮始终不亮。
            # 原代码在三通道失败后直接放弃提交 —— 等于把唯一实测有效的那条路排除在外，
            # 于是"图出完了、文案发不出去"，整套还是废。这里补上 execCommand 兜底。
            log("⚠️ 前三通道未点亮按钮，改用 execCommand 分块重写（图阶段实测唯一有效的通道）...", self.id)
            try:
                await self.send_cmd("Runtime.evaluate", {"expression": _JS_FIND_COMPOSER +
                    " if (_c) { _c.focus(); const _rb=document.querySelectorAll('button[aria-label*=\"移除文件\"], button[aria-label*=\"Remove file\"]');"
                    " const _im=document.querySelectorAll('form img[src^=\"blob:\"]');"
                    " if (Math.max(_rb.length, _im.length) === 0) { const _sel=window.getSelection(); if (_sel) { const _rg=document.createRange(); _rg.selectNodeContents(_c); _sel.removeAllRanges(); _sel.addRange(_rg); } document.execCommand('delete', false, null); } }",
                    "returnByValue": True}, timeout=15)

                for _i in range(0, len(prompt_text), 1000):
                    _ck = json.dumps(prompt_text[_i:_i + 1000], ensure_ascii=False).replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
                    await self.send_cmd("Runtime.evaluate", {"expression": """(() => {
                        %s
                        if (!_c) return -1;
                        _c.focus();
                        const _ok = document.execCommand('insertText', false, %s);
                        return _ok ? (((_c.innerText !== undefined ? _c.innerText : _c.value) || '').length) : -1;
                    })()""" % (_JS_FIND_COMPOSER, _ck), "returnByValue": True}, timeout=30)
                await asyncio.sleep(1.5)
            except Exception as _e_ec:
                log(f"⚠️ execCommand 重写异常: {str(_e_ec)[:100]}", self.id)
            for _wait_ready in range(6):
                _st = await _editor_state_ready()
                if _st.get("btnEnabled"):
                    break
                try:
                    await self.send_cmd("Runtime.evaluate", {"expression": """(() => {
                        %s
                        if (_c) {
                            _c.focus();
                            document.execCommand('insertText', false, ' ');
                            document.execCommand('delete', false, null);
                        }
                    })()""" % _JS_FIND_COMPOSER, "returnByValue": True}, timeout=10)
                except Exception:
                    pass
                await asyncio.sleep(0.8)

        if _st.get("found") and not _st.get("btnEnabled"):
            log(f"🚨 四种注入通道都没能让 EditorState 收到内容（DOM {_st.get('domLen')} 字），"
                f"放弃本次提交：不烧额度、不制造假提交", self.id)
            return False
        if _st.get("found") and _st.get("btnEnabled"):
            log(f"-> EditorState 同步校验通过（send-button 已启用，DOM {_st.get('domLen')} 字）", self.id)
        # 注入自检：编辑框里必须真的有内容，否则拒绝进入提交阶段（避免静默丢单）
        try:
            _r_v = await self.send_cmd("Runtime.evaluate", {"expression": """(() => {
                %s
                return _c ? (((_c.innerText !== undefined ? _c.innerText : _c.value) || '').length) : -1;
            })()""" % _JS_FIND_COMPOSER, "returnByValue": True}, timeout=15)
            _v_len = _r_v.get("result", {}).get("result", {}).get("value", -1)
            log(f"-> {action_desc}注入自检：编辑框实际长度 {_v_len} / 目标 {len(prompt_text)}", self.id)
            if _v_len is not None and 0 <= _v_len < max(30, int(len(prompt_text) * 0.5)):
                log(f"⚠️ {action_desc}失败：编辑框内容明显不足，拒绝提交", self.id)
                return False
        except Exception:
            pass
        await asyncio.sleep(0.6)

        # 【2026-09-26 新增·空发送硬闸门】点发送之前的最后一道关：
        # 附件没挂上就不许点。宁可整套判失败重来，也不发一条没有素材的空指令。
        if require_attachment:
            # 判据统一走 _JS_COUNT_ATTACH（见文件头 2026-09-27 说明：旧判据在新版 UI 上恒为 0）
            _js_att = _JS_COUNT_ATTACH
            # 【2026-09-26 修·别把「探测失败」当成「没有附件」】
            # 首版：一次 CDP 探测异常就把 _att_n 置 -1，而 -1 <= 0 会直接触发拦截。
            # 实测后果：明明刚确认挂载了 10 张，只因 Runtime.evaluate 抖动一下就被判"没上传"，
            # 整套作废重走上传 —— 用防守 bug 制造了新的失败。
            # 改法：①探测失败重试 3 次；②三次都失败时，若本套上传阶段已确认挂载过，
            # 以「已确认挂载数」为准放行（那是有据可查的事实，比一次抖动可信）。
            _att_n = -1
            for _att_try in range(3):
                try:
                    _r_att = await self.send_cmd("Runtime.evaluate", {"expression": _js_att, "returnByValue": True}, timeout=15)
                    _av = _r_att.get("result", {}).get("result", {}).get("value", -1)
                    _att_n = int(_av) if _av is not None else -1
                    if _att_n >= 0:
                        break
                except Exception:
                    _att_n = -1
                await asyncio.sleep(2)
            trace(self.id, "pre_send_attachment_check", attached=_att_n, required=True, action=action_desc)
            _known_attached = int(getattr(self, "_attached_count", 0) or 0)
            if _att_n < 0 and _known_attached > 0:
                log(f"⚠️ 发送前附件探测 3 次均失败（CDP 抖动），但本套上传阶段已确认挂载 {_known_attached} 张，"
                    f"以已确认数为准放行（拒绝发送只会白白作废一套）", self.id)
                _att_n = _known_attached
            if _att_n <= 0:
                log(f"🚨 【空发送拦截】{action_desc}前探测到附件数={_att_n}，素材没挂上就绝不点发送 —— 本次判失败，重走上传", self.id)
                return False

        baseline_user_count, baseline_url = await _turn_baseline()
        # 【2026-09-26 修·灰度版前端「假提交」】新版 ChatGPT 前端（09-24 起灰度）对程序化提交的处理变了：
        # 编辑框 DOM 里明明有内容（注入自检通过、按钮已点亮），但前端框架状态没同步 ->
        # btn.click() 按空输入处理，消息被静默丢弃，随后编辑框被清空 ->
        # 旧确认逻辑把 empty=True 误判为「已发送」（日志：确认提交 user_turns=0）->
        # 模型零响应 -> 150 秒熔断 -> 3 次重试全烧额度 -> 素材误隔离。
        # 实测影响面：09-25 单日 30 套「文案 0 字空壳」+ 10 套「未获提交确认」全部由此而来；
        # 09-26 上午 A/B 连环「停止生成 0 图（助手消息数=0）」同源。
        # 修复：①click 前派发 InputEvent 促发框架同步；②确认判据收紧：纯 empty 不再算成功，
        # 必须 user turn 增长或正在生成；③识别到假提交（empty 且消息未进会话）自动换 Enter 键补发。
        js_submit = """(() => {
            const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"][role="textbox"]') || document.querySelector('[role="textbox"]') || document.querySelector('textarea');
            try {
                if (ta) {
                    // execCommand 是注入链同款通道：新版 Lexical 编辑器监听 beforeinput，
                    // execCommand 触发的合成 beforeinput 能进它的 EditorState（实测注入有效）。
                    // 提交前补一个空格，把「框架真实持有完整内容」的状态压实，防止 click 按空输入处理。
                    ta.focus();
                    // 光标移到内容末尾再插入，避免插到中间
                    const sel = window.getSelection();
                    if (sel && ta.lastChild) {
                        const range = document.createRange();
                        range.selectNodeContents(ta);
                        range.collapse(false);
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                    document.execCommand('insertText', false, ' ');
                    ta.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: ' '}));
                }
            } catch (e) {}
            const btn = document.querySelector('button[data-testid="send-button"]') ||
                        document.querySelector('button[aria-label*="Send"]') ||
                        document.querySelector('button[aria-label*="发送"]') ||
                        document.querySelector('button.composer-submit-btn');
            if (btn && !btn.disabled) {
                btn.click();
                return {ok: true, method: 'button.click+inputSync'};
            }
            if (btn && btn.disabled) {
                // 按钮存在但被禁用 = Lexical EditorState 认为编辑框是空的（DOM 有字也不算）。
                // 此时 requestSubmit/click 只会送出一条空消息：编辑框被清空、消息却进不了对话，
                // 正是 09-26 晚上「userTurns 始终 0 + 干等出图轮询 180 次」的假提交元凶。宁可不发。
                return {ok: false, reason: 'send_button_disabled(editorstate_empty)'};
            }
            const form = ta?.closest('form');
            if (form) { form.requestSubmit(); return {ok: true, method: 'form.requestSubmit'}; }
            return {ok: false, reason: 'submit_control_not_found'};
        })()"""
        # Enter 键补发（假提交后使用；走 keydown 管道，绕过按钮点击路径）
        js_submit_enter = """(() => {
            const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"][role="textbox"]') || document.querySelector('[role="textbox"]') || document.querySelector('textarea');
            if (!ta) return {ok: false, reason: 'composer_not_found'};
            try {
                ta.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true}));
                return {ok: true, method: 'enter.keydown'};
            } catch (e) { return {ok: false, reason: 'enter_failed: ' + e.message}; }
        })()"""
        r_submit = await self.send_cmd("Runtime.evaluate", {"expression": js_submit, "returnByValue": True}, timeout=20)
        submitted = r_submit.get("result", {}).get("result", {}).get("value", {})
        if not submitted.get("ok"):
            log(f"⚠️ {action_desc}提交失败：{submitted.get('reason', '未知原因')}", self.id)
            return False
        log(f"-> {action_desc}已执行网页原生提交（{submitted.get('method')}），等待 user turn...", self.id)
        # 【节拍埋点】点发送的精确时刻 + 距本实例上一次点发送的间隔
        _send_click_at = time.time()
        _gap_prev = round(_send_click_at - self._last_send_ts, 1) if self._last_send_ts else None
        self._last_send_ts = _send_click_at
        trace(self.id, "send_click", action=action_desc, method=submitted.get("method"),
              prompt_len=len(prompt_text), gap_since_prev_send_s=_gap_prev)
        # 提交动作已实际发生：刷新节流闸时间戳（无论后续确认成败，本次节奏已消耗）
        try:
            _gate = getattr(self, "_submit_gate", None)
            if _gate is not None:
                _gate["ts"] = time.time()
        except Exception:
            pass

        # 提交动作必须被网页确认：用户消息 turn 出现，或进入生成态。
        # 【2026-09-26 收紧】纯「编辑框清空」不再算成功——灰度版前端丢消息时也会清空编辑框，
        # empty 且 user turn 不增长 = 假提交；此时自动换 Enter 键补发一次，再观察 10 秒。
        confirmed_ok = False
        _enter_retry_used = False
        _suspect_rounds = 0
        _gen_streak = 0          # 「已清空 + 生成中」连续持续的轮数
        _GEN_STREAK_NEED = 8     # 需连续 8 秒仍处于生成态，才相信模型真的在跑
        _first_token_at = None   # 首次「页面开始出字」的时刻（算首字延迟）
        for _ in range(75):
            _snip_js = json.dumps((prompt_text or "").strip()[:60], ensure_ascii=False)
            js_confirm = """(() => {
                const ta = document.querySelector('#prompt-textarea') || document.querySelector('div[contenteditable="true"][role="textbox"]') || document.querySelector('[role="textbox"]') || document.querySelector('textarea');
                const text = (ta?.innerText || ta?.value || '').trim();
                const users = document.querySelectorAll('[data-message-author-role="user"]').length;
                const generating = Boolean(document.querySelector('[data-testid*="stop"], button[aria-label*="停止"], button[aria-label*="Stop"]'));
                const m = document.querySelector('main');
                // 【2026-09-27 修·同上】只量「已上屏的会话内容」，剔除编辑框自身的长度贡献。
                // 并额外用指令前 60 字做片段命中：即便前端把长消息折叠显示、长度增长不明显，
                // 只要这段指令真的作为用户消息上了屏就能确认（编辑框已被剔除，不会自命中）。
                let mainLen = 0, snippetFound = false;
                if (m) {
                    const clone = m.cloneNode(true);
                    clone.querySelectorAll('form, textarea, [contenteditable="true"], [data-testid*="composer"]')
                         .forEach(n => { try { n.remove(); } catch (e) {} });
                    const ct = clone.innerText || clone.textContent || '';
                    mainLen = ct.length;
                    const snip = %s;
                    if (snip) {
                        const cleanCt = ct.replace(/\s+/g, ' ');
                        const cleanSnip = String(snip).replace(/\s+/g, ' ').trim();
                        if (cleanSnip && cleanSnip.length >= 10) {
                            snippetFound = cleanCt.indexOf(cleanSnip.slice(0, 30)) >= 0;
                        } else if (cleanSnip) {
                            snippetFound = cleanCt.indexOf(cleanSnip) >= 0;
                        }
                    }
                }
                return {empty: text.length === 0, mainLen: mainLen,
                        url: location.href, generating: generating, snippetFound: snippetFound};
            })()""" % _snip_js
            r_confirm = await self.send_cmd("Runtime.evaluate", {"expression": js_confirm, "returnByValue": True}, timeout=15)
            confirmed = r_confirm.get("result", {}).get("result", {}).get("value", {})
            # 【2026-09-26 六次换血·判据换真源】
            # 旧判据 `users > baseline`（[data-message-author-role="user"]）在新版 UI 上恒为 0 ——
            # 20:55 决定性实验已证明：消息真的发了、模型真的回了（main 里能看到「你说：/ChatGPT 说：」），
            # 而这套选择器一个数都数不出来。于是每一次真提交都被判成假提交。
            # 真源 = main.innerText 长度增长（实验实测 19 → 66），辅以会话 URL 从 / 变为 /c/xxx。
            _main_now = int(confirmed.get("mainLen", 0) or 0)
            _url_now = str(confirmed.get("url", "") or "")
            _growth = _main_now - baseline_user_count
            # 【节拍埋点】首字延迟：从点发送到页面文本第一次开始变长
            if _first_token_at is None and _growth > 0:
                _first_token_at = time.time()
                trace(self.id, "first_token", action=action_desc,
                      latency_s=round(_first_token_at - _send_click_at, 1), growth=_growth)
            _need = max(50, int(len(prompt_text) * 0.2))
            # 【2026-09-27 修】补第三条确认通道：编辑框已清空 + 指令片段确实出现在会话正文里。
            # 这是同会话内第二条指令（文案指令）唯一可靠的证据 —— 长度增长与 URL 变化在这都用不上。
            # 【2026-10-05 补】生成态（generating）且已有文本流式输出（_growth >= 10）作为可靠提交确认。
            if _growth >= _need or (_url_now and _url_now != baseline_url and _main_now > 20) \
                    or (confirmed.get("empty", False) and confirmed.get("snippetFound", False)) \
                    or (confirmed.get("generating", False) and _growth >= 10):
                log(f"-> {action_desc}已由网页确认提交（真源：会话正文 {baseline_user_count} → {_main_now}，"
                    f"增长 {_growth} 字；片段命中={confirmed.get('snippetFound', False)}；"
                    f"生成中={confirmed.get('generating', False)}）", self.id)
                confirmed_ok = True
                break
            # 生成态只作参考，不再单独作为成功判据：
            # 实测存在「闪 1 秒就消失」的假生成态（页面其实是空会话），据此判成功会干等 30 分钟。
            # 补发仅在「内容还留在编辑框里」时才有意义：那时按 Enter 才有东西可发。
            # 若编辑框已被清空（消息被前端吞掉），再按 Enter 发出去的是一条空消息，
            # 永远救不回来 —— 这正是历史上"补发 trusted Enter 后仍失败"的原因。
            # 那种情况直接判失败，由上层换新会话重来（旧会话是空的，不会造成堆积）。
            _suspect_rounds += 1
            if _suspect_rounds >= 3 and not _enter_retry_used \
                    and not confirmed.get("empty", False):
                _enter_retry_used = True
                log(f"⚠️ {action_desc}疑似假提交（{_suspect_rounds * 1}s 内 user turn 未出现，编辑框状态 {confirmed}），改发 trusted Enter...", self.id)
                try:
                    await self.send_cmd("Runtime.evaluate", {"expression": _JS_FIND_COMPOSER + " if (_c) { _c.focus(); }", "returnByValue": True}, timeout=10)
                    await self.send_cmd("Input.dispatchKeyEvent", {"type": "keyDown", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13, "text": "\r"}, timeout=10)
                    await self.send_cmd("Input.dispatchKeyEvent", {"type": "keyUp", "key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13}, timeout=10)
                    log(f"-> trusted Enter 已发送（keyDown+keyUp）", self.id)
                except Exception as _e_tr:
                    log(f"⚠️ trusted Enter 补发失败: {_e_tr}，回退 synthetic Enter", self.id)
                    try:
                        await self.send_cmd("Runtime.evaluate", {"expression": js_submit_enter, "returnByValue": True}, timeout=15)
                    except Exception:
                        pass
            # 给足 30 秒观察窗：正常情况 user turn 3~10 秒内必现；等不到就是真没发出去。
            if _suspect_rounds >= 30:
                break
            await asyncio.sleep(1)

        if not confirmed_ok:
            log(f"⚠️ {action_desc}未获网页提交确认（含 trusted Enter 补发后仍失败），拒绝进入等待出图阶段", self.id)
            return False
        return True

    async def produce_single_set(self, mat_info):
        mat_dir = mat_info["path"]
        mat_name = mat_info["name"]
        log(f"==================================================", self.id)
        log(f"开始生产: {mat_name}", self.id)
        log(f"原料路径: {mat_dir}", self.id)
        # 【节拍埋点】每套素材的起点；同时重置本套的页面软重载额度（最多 RELOAD_MAX_PER_ITEM 次）
        self._set_t0 = time.time()
        self._reload_used = 0
        self._attached_count = 0   # 每套重置，避免拿上一套的挂载数当本套的凭据
        trace(self.id, "set_start", mat=mat_name[:40])

        await self.open_fresh_session()

        # 1. 扫描与上传图片（Web-CDP 硬上限 10 张，和本地生产计划一致）
        img_paths = self.prepare_material_images(mat_dir, max_imgs=10)
        log(f"精选 {len(img_paths)} 张原料图注入对话...", self.id)

        # 开始制作日志记录（群通知仅在配额周期首次点火/解冻时报备 1 次，连续生产时不重复刷屏）
        log(f"准备注入原图并开始生产: {mat_name}", self.id)

        # 【2026-09-25 修·「附件仅挂载 2/N 张」真根因（CDP 实测取证）】
        # 新版前端把 1 个 file input 拆成 5 个：
        #   input#upload-photos (accept=image/*)  ← 活通道：setFileInputFiles 500ms 内即渲染缩略图
        #   input#upload-media / #upload-media-files / #upload-camera
        #   input#upload-files                    ← 死通道：包在 <div class="hidden"> 内，
        #                                            注进去的文件长期躺在 .files 里，前端零渲染
        # 原代码首选 input#upload-files：实测 20 秒才返回、附件 0 张 ->
        # 「移除文件N」按钮 0 个 -> 计数被静态的 button[aria-label*="删除"]=2 顶上去 ->
        # 日志永远「仅挂载 2/N」-> 60% 门槛判死 -> 好素材被物理隔离（09-25 已误伤多套）。
        _upload_sel_order = [
            "input#upload-photos",
            "input#upload-media",
            "input#upload-media-files",
            "input#upload-camera",
            "form input[type='file'][accept*='image']",
            "input#upload-files",
            "form input[type='file']:not([disabled])",
            "input[type='file']",
        ]

        # 【2026-09-25 修·计数器去污染】原实现里混了 button[aria-label*="删除"]，
        # 它在页面上是 2 个与附件无关的静态按钮，恒返回 2 —— 正是日志里那个假的「2 张」。
        # 【2026-09-27 修】旧判据（blob: 缩略图 + "移除文件" 按钮）在新版 UI 上双双归零，
        # 详见文件头 _JS_COUNT_ATTACH 的说明。这里与发送前探测统一改用新判据。
        js_check_attach = _JS_COUNT_ATTACH

        async def _probe_attached():
            try:
                _r = await self.send_cmd("Runtime.evaluate", {"expression": js_check_attach, "returnByValue": True}, timeout=15)
                return int(_r.get("result", {}).get("result", {}).get("value", 0) or 0)
            except Exception:
                return -1

        # 【2026-09-25 新增·防串料】SPA 导航不会重建 file input，上一套任务残留在
        # input#upload-files 里的文件会一直挂着，下次注入时被前端一并吃掉
        # （CDP 实测：往 upload-photos 注 3 张 → 页面却渲染出 12 个缩略图，其中 9 个是残留）。
        # 注入前先点掉草稿区「移除文件N」按钮并清空各 input 的 value。
        try:
            _cleared = await self.send_cmd("Runtime.evaluate", {"expression": """(() => {
                const btns = Array.from(document.querySelectorAll('button[aria-label*="移除文件"], button[aria-label*="Remove file"]'));
                btns.forEach(b => { try { b.click(); } catch (e) {} });
                Array.from(document.querySelectorAll('input[type="file"]')).forEach(i => { try { i.value = ''; } catch (e) {} });
                return btns.length;
            })()""", "returnByValue": True}, timeout=15)
            _cl = _cleared.get("result", {}).get("result", {}).get("value", 0) or 0
            if _cl:
                log(f"🧹 注入前清理上一套残留附件 {_cl} 个（防止串料）", self.id)
                await asyncio.sleep(1.5)
        except Exception:
            pass

        # 【2026-09-26 修·清空编辑框必须发生在「上传附件之前」】
        # 注入提示词那一步不能整体清空（会把刚上传的附件 chip 一起删掉，实测附件数 8 → 0），
        # 可不清空又会留着上一套的残文（实测 DOM 28919 ≈ 目标 14047 的两倍，两次内容叠加）。
        # 正确时机就是这里：附件还没上传，编辑框里只有文本，selectAll+delete 是安全的。
        try:
            await self.send_cmd("Runtime.evaluate", {"expression": """(() => {
                const _c = document.querySelector('#prompt-textarea')
                    || document.querySelector('div[contenteditable="true"][role="textbox"]')
                    || document.querySelector('[role="textbox"]')
                    || document.querySelector('textarea');
                if (!_c) return false;
                _c.focus();
                document.execCommand('selectAll', false, null);
                document.execCommand('delete', false, null);
                return true;
            })()""", "returnByValue": True}, timeout=15)
            log("🧹 上传前已清空编辑框残留文本（此刻无附件，清空安全）", self.id)
            await asyncio.sleep(0.8)
        except Exception:
            pass

        _cands = []
        _seen_nids = set()
        for _round in range(15):
            try:
                _doc = await self.send_cmd("DOM.getDocument", {"depth": 1})
                _root = _doc.get('result', {}).get('root', {}).get('nodeId', 1)
            except Exception:
                _root = 1
            for _sel in _upload_sel_order:
                try:
                    _nr = await self.send_cmd("DOM.querySelector", {"nodeId": _root, "selector": _sel})
                except Exception:
                    continue
                _nid = _nr.get('result', {}).get('nodeId')
                if _nid and _nid > 0 and _nid not in _seen_nids:
                    _seen_nids.add(_nid)
                    _cands.append((_sel, _nid))
            if _cands:
                break
            await asyncio.sleep(1)
        if not _cands:
            raise RuntimeError(f"[{self.id}] 未找到文件上传 DOM 节点！")
        log(f"-> 上传候选通道 {len(_cands)} 个: " + ", ".join(s for s, _ in _cands), self.id)

        js_dispatch_generic = """(() => {
            const inp = document.querySelector('form input[type="file"]:not([disabled])');
            if (!inp) return false;
            inp.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            return true;
        })()"""

        node_id = None
        _used_sel = None
        _used_el_id = ""
        _attached_seen = 0
        for _sel, _nid in _cands:
            _el_id = _sel.split('#')[-1] if _sel.startswith('input#') else ''
            _t0 = time.time()
            try:
                await self.send_cmd("DOM.setFileInputFiles", {"nodeId": _nid, "files": img_paths}, timeout=25)
            except Exception as _e_set:
                log(f"-> 通道 {_sel} 注入异常（{_e_set}），换下一个通道", self.id)
                continue
            _ms = int((time.time() - _t0) * 1000)
            _js_disp = ("""(() => {
                const i = document.getElementById('%s');
                if (!i) return false;
                i.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                i.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                return true;
            })()""" % _el_id) if _el_id else js_dispatch_generic
            try:
                await self.send_cmd("Runtime.evaluate", {"expression": _js_disp}, timeout=15)
            except Exception:
                pass
            # 只认「缩略图真的出现」：注入后盯 8 秒
            _hit = 0
            _w = 0
            for _w in range(8):
                await asyncio.sleep(1)
                _hit = await _probe_attached()
                if _hit > 0:
                    break
            log(f"-> 通道 {_sel} 注入 {_ms}ms，{_w + 1} 秒后附件计数 = {_hit}", self.id)
            if _hit > 0:
                node_id = _nid
                _used_sel = _sel
                _used_el_id = _el_id
                _attached_seen = _hit
                break
            log(f"⚠️ 通道 {_sel} 无缩略图产出（前端未接收），换下一个通道", self.id)
        if not node_id:
            raise RuntimeError(
                f"客户端附件挂载失败（0/{len(img_paths)}），所有上传通道均无缩略图产出，未提交生图提示词"
            )
        log(f"-> 采用上传通道: {_used_sel}（已挂载 {_attached_seen} 张）", self.id)
        try:
            await self.send_cmd("DOM.disable")
        except Exception:
            pass
        log("图片文件已注入并触发前端挂载，继续等待剩余缩略图解析...", self.id)

        # 轮询等待附件挂载完成
        # 【2026-09-24 修】原为「最多 15 秒」，且只要 attached_cnt > 0 且等够 8 秒就直接放行。
        # 实测证据：10 张原图注入后第 9 秒只解析出 2 张就提交（日志「挂载就绪 (2 张)」），
        # 模型拿不到完整原图 -> 只回 7 个字（"当前这条对话里"）-> 主脑数不到大图 -> 熔断/隔离。
        # 反向对照：挂载计数 10/11 的那几套能正常出图（4/5 张）。这是当晚 A 全线产废的直接原因。
        # 现在改为：等待上限 45 秒；部分挂载时周期性重注入；未达最低门槛一律拒绝提交。
        attached_cnt = _attached_seen
        _need_cnt = len(img_paths)
        _last_reinject_idx = -99
        _js_disp_used = ("""(() => {
            const i = document.getElementById('%s');
            if (!i) return false;
            i.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            i.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            return true;
        })()""" % _used_el_id) if _used_el_id else js_dispatch_generic
        for wait_idx in range(45):
            await asyncio.sleep(1)
            try:
                attached_cnt = await _probe_attached()
                if attached_cnt < 0:
                    attached_cnt = 0
                if attached_cnt >= _need_cnt:
                    log(f"-> 全部 {attached_cnt} 张原料图缩略图/文件已成功挂载！", self.id)
                    break
                # 【2026-09-24 修】原逻辑此处为「attached_cnt > 0 and wait_idx >= 8 -> 放行」，
                # 那正是把「只挂上 2/10 张」当成就绪放行的元凶。现改为绝不早放行：
                # 部分挂载时每 12 秒重注入一次，逼前端继续解析剩余文件。
                if attached_cnt > 0 and (wait_idx - _last_reinject_idx) >= 12:
                    _last_reinject_idx = wait_idx
                    try:
                        await self.send_cmd("DOM.setFileInputFiles", {"nodeId": node_id, "files": img_paths})
                        await self.send_cmd("Runtime.evaluate", {"expression": _js_disp_used})
                        log(f"-> 附件仅挂载 {attached_cnt}/{_need_cnt} 张，已重注入并继续等待解析...", self.id)
                    except Exception as _e_reinj:
                        log(f"附件重注入失败: {_e_reinj}", self.id)
            except Exception:
                pass

        # 客户端偶发出现“文件已注入但前端没有挂载”的竞态；挂载为 0 时在已确认的通道上重试一次，
        # 未确认附件前绝不提交生图提示词。
        if attached_cnt == 0 and img_paths:
            log("⚠️ 首轮附件挂载计数为 0，在已确认通道上执行原生上传重试，暂不提交提示词...", self.id)
            try:
                await self.send_cmd("DOM.setFileInputFiles", {"nodeId": node_id, "files": img_paths})
                await self.send_cmd("Runtime.evaluate", {"expression": _js_disp_used})
                for retry_idx in range(12):
                    await asyncio.sleep(1)
                    attached_cnt = await _probe_attached()
                    if attached_cnt < 0:
                        attached_cnt = 0
                    if attached_cnt > 0:
                        log(f"-> 客户端上传重试已挂载 {attached_cnt} 张附件。", self.id)
                        break
            except Exception as upload_retry_error:
                log(f"⚠️ 客户端上传重试异常: {upload_retry_error}", self.id)

        # 【2026-09-24 新增】最低挂载门槛（60%）：低于门槛一律拒绝提交，宁可不做也不产残缺品。
        # 原逻辑只要 attached_cnt > 0 就往下走，2/10 张也照发，等同于批量制造废品。
        if img_paths:
            _min_need = max(1, int(len(img_paths) * 0.6))
            if attached_cnt == 0:
                raise RuntimeError(f"客户端附件挂载失败（0/{len(img_paths)}），未提交生图提示词")
            if attached_cnt < _min_need:
                raise RuntimeError(
                    f"客户端附件仅挂载 {attached_cnt}/{len(img_paths)} 张（低于最低门槛 {_min_need}），"
                    f"拒绝提交以避免产物残缺"
                )

        log(f"-> 附件处理完毕 (挂载计数: {attached_cnt})，进入提示词注入流程...", self.id)
        # 记下本套「已确认挂载数」，供发送前的空发送闸门在 CDP 抖动时作为可信依据
        self._attached_count = int(attached_cnt or 0)
        # 【节拍埋点】上传阶段耗时（从本套开始到附件挂完），用于判断"上传"这一段是否变慢
        try:
            trace(self.id, "upload_done", elapsed_s=round(time.time() - getattr(self, "_set_t0", time.time()), 1),
                  attached=attached_cnt, expected=len(img_paths))
        except Exception:
            pass

        # 2. 读取原素材文案构建 V5.0 提示词
        copy_path = os.path.join(mat_dir, "文案.txt")
        context_block = ""
        if os.path.exists(copy_path):
            try:
                with open(copy_path, 'r', encoding='utf-8') as f:
                    context_block = f.read()[:1200]
            except Exception: pass

        # 3. 动态加载 2.8 万字真源超级提示词（全量直接出图完整版 + V6.0 站位打乱与名企置换）
        master_prompt_path = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\04-技能库\内容生产提示词\5.0复刻提示词_全量直接出图版.md"
        base_rule = ""
        if os.path.exists(master_prompt_path):
            try:
                with open(master_prompt_path, 'r', encoding='utf-8') as mf:
                    base_rule = mf.read()
            except Exception as me:
                log(f"⚠️ 读取主项目真源提示词异常: {me}", self.id)

        plan_excerpt = ""
        plan_path = mat_info.get("planPath")
        if plan_path and os.path.exists(plan_path):
            try:
                with open(plan_path, "r", encoding="utf-8") as pf:
                    plan_excerpt = pf.read()[:3500]
            except Exception:
                plan_excerpt = ""

        v6_header = (
            "【小红书团建拼图大字营销封面轻复刻去重修图师 V6.0·全量直接出图版】\n"
            "（四宫格站位强制置换打乱｜反AI塑料凡士林磨皮｜纯正国产手机实拍质感｜名企大厂背书置换与文字深度去重版）\n\n"
            f"已上传全部 {len(img_paths)} 张原图。\n"
            "本套已先完成本地素材读取与 production_plan.md 计划审核；以下计划是本轮唯一执行依据：\n"
            f"{plan_excerpt}\n\n"
            "请严格按照 V6.0 规则执行直接出图，绝对禁止自由创作或脑补新景区！\n\n"
            f"【原素材参考正文与真实排期】：\n{context_block}\n\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            "【V6.0 核心增量铁律：画面站位绝对打乱 & 文字深度去重名企置换】：\n"
            "1. 【四宫格/多图拼接·站位绝对置换打乱律】：\n"
            "   - 凡涉及 4 宫格拼图或多图画中画（原站位若为：左上A、右上B、左下C、右下D），生成时【必须强制打乱重排】（如置换为：左上B、右上D、左下A、右下C，或任意非原位站位）！\n"
            "   - 绝对不允许任何一个小格子的画面留在原位置！严禁原地仅换脸换衣！\n"
            "   - 各个打乱格子的新画面，采用同主题不同镜头角度的真实实拍（例如烤肉特写置换为炭火全景、农庄大门置换为庭院侧拍）。\n"
            "2. 【排版与文字层深度去重（名企大厂置换 + 爆款同义微调）】：\n"
            "   - 【原图怎么排就怎么改，绝不盲目套大字】：原图封面是多图大字则继承大字排版；若原图是纯净实拍、通透风景或清新小标签，则严格继承其轻量排版，严禁千篇一律强行压大字！\n"
            "   - 【企业与客户背书动态置换（去重+增信铁律）】：若原图封面或内页中提及任何具体公司名（如某具体中小企业、真实客户名），【必须强制动态置换为大厂/名企背书代称】（如：“某头部互联网大厂”、“某500强外企”、“某知名独角兽”、“某金融名企”等），既彻底规避平台OCR搬运抄袭审核，又大幅提升笔记B端大客户信任感！\n"
            "   - 【主标题与副标核心去重】：地标与核心攻略事实绝对锁死（如莫干山、安吉、2天1夜不变），但修饰词与爆款动词执行同义去重（例如：“保姆级攻略”微调为“超全避坑指南”、“玩转指南”；“被夸爆”微调为“领导狂赞”、“HR狂喜”），实现平台级降维去重！\n"
            "   - P2~PN 内页：严格按原图版式复刻，涉及具体客户名称按上述名企规则同步脱敏置换！\n"
            "3. 严格按本地 production_plan.md 页序执行，输出 3:4 竖版大图（1086x1448）；不在网页端重复输出计划、不等回复 1，计划审核通过后立即开始直接出图！\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            "【以下为必须 100% 严格执行的完整轻复刻修图与真实现场摄影增强法则体系】：\n"
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
        )
        if base_rule:
            v60_prompt = v6_header + base_rule
        else:
            v60_prompt = v6_header

        # 3. 注入生图提示词并点击发送
        # 【空发送铁律】这一次必须有素材挂在执行框上才许点发送（require_attachment=True）
        sent_init = await self.send_text_prompt(v60_prompt, f"V6.0 超级真源生图指令 (完整篇幅: {len(v60_prompt)} 字)",
                                                require_attachment=True)
        if not sent_init:
            raise RuntimeError("初始生图指令未获网页提交确认，拒绝进入出图轮询")
        log("指令已发送，正在监控出图进程并开启连环追问驱动...", self.id)

        # 4. 动态监控生图进程与多图连环追问驱动
        expected_count = len(img_paths)
        stuck_99_count = 0
        last_prompted_for = 0
        idle_after_prompt_ticks = 0
        stuck_retry_count = 0
        # 在发送文案中枢前保留一份生成图 URL 快照；客户端提交下一条文字后，
        # 页面可能只保留最后一张图片节点，不能让回收阶段把整套误判成单图。
        pre_copy_img_urls = []

        for tick in range(1, 180):
            await asyncio.sleep(10)
            js_status = """(() => {
                const stopBtn = document.querySelector('button[data-testid*="stop"]') ||
                                document.querySelector('button[aria-label*="停止"]') ||
                                document.querySelector('button[aria-label*="Stop"]');
                // 【2026-09-26 换真源】旧代码先把图片限定在
                // [data-testid^="conversation-turn-"] / [data-message-author-role="assistant"] 容器里找，
                // 而这两个容器选择器在新版 UI 上已全部失效（实测数出 0 个），
                // 于是"图明明出来了却一张都数不到" -> 判「停止生成但未返回大图」-> 熔断作废。
                // 现在直接全页扫描 img，用渲染尺寸>=300 排除头像与图标，不再依赖任何容器选择器。
                const map = new Map();
                document.querySelectorAll('img').forEach(img => {
                    const src = img.src || '';
                    const alt = img.alt || '';
                    if (alt.includes('个人资料') || alt.includes('profile') || alt.includes('avatar')) return;
                    const w = img.naturalWidth || img.clientWidth || 0;
                    const h = img.naturalHeight || img.clientHeight || 0;
                    if (w < 300 || h < 300) return;
                    const isGenSrc = src.includes('estuary') || src.includes('oaiusercontent') ||
                                     src.includes('fileservice') || src.startsWith('blob:');
                    if (!isGenSrc) return;
                    const idMatch = src.match(/id=([^&]+)/) || src.match(/enc\/([^?&#]+)/);
                    const fileId = idMatch ? idMatch[1] : src;
                    if (!map.has(fileId)) {
                        map.set(fileId, src);
                    }
                });
                const bodyText = document.body ? document.body.innerText : '';
                const isThinking = bodyText.includes('正在思考') || bodyText.includes('正在生成更详细的图片') || bodyText.includes('Designing the carousel') || bodyText.includes('正在分析') || bodyText.includes('Analyzing') || bodyText.includes('Thinking') || bodyText.includes('Thought for') || bodyText.includes('已深度思考') || bodyText.includes('Refined');
                const is99 = bodyText.includes('99%');
                return {
                    isGenerating: !!stopBtn || isThinking,
                    imgCount: map.size,
                    imgUrls: Array.from(map.values()),
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
            poll_img_urls = stat.get("imgUrls", []) or []
            if len(poll_img_urls) > len(pre_copy_img_urls):
                pre_copy_img_urls = poll_img_urls
            is_99 = stat.get("is99", False)
            is_thinking = stat.get("isThinking", False)

            log(f"  [出图轮询 {tick}/180] 正在生成: {is_gen}，已渲染大图: {img_count}/{expected_count}", self.id)

            if tick % 3 == 0:
                keep_window_background(self.cdp_port)

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

                    # 【2026-09-25 修】补英文限流提示识别：ChatGPT 有时直接回英文
                    # "Too many requests"（而非中文额度条），此前主脑认不出 → 不进冷却 → 反复判废重做。
                    _asst_low = asst_txt.lower()
                    quota_keys = ["达到 Plus 套餐", "图像生成请求上限", "额度限制", "上限将在", "重置，届时可创建更多图像",
                                  "Too many requests", "too many requests", "usage limit", "you've reached", "you have reached"]
                    if any(qk in asst_txt for qk in quota_keys):
                        # [2026-09-24 修] 撞限提示是流式写出来的：主脑常在
                        # 「你已达到 Plus 套餐的图像生成请求上限」这一句刚出现时就判定撞限，
                        # 而后面那句「上限将在 X小时 后重置」还没写出来 → 正则一个数字都抓不到
                        # → 回落硬编码 3 小时兜底 → 休眠严重偏短 → 复工即二次撞限。
                        # 先等这条消息写稳定（出现"后重置/后重试"，或长度连续两次不变）再解析，最多 75 秒。
                        try:
                            last_len = -1
                            for _ in range(25):
                                _low = asst_txt.lower()
                                if ("后重置" in asst_txt) or ("后重试" in asst_txt) \
                                        or ("reset" in _low) or ("try again" in _low):
                                    break
                                if len(asst_txt) == last_len and len(asst_txt) >= 25:
                                    break
                                last_len = len(asst_txt)
                                await asyncio.sleep(3)
                                r_w = await self.send_cmd("Runtime.evaluate", {"expression": js_check_asst, "returnByValue": True}, timeout=15)
                                asst_txt = r_w.get("result", {}).get("result", {}).get("value", "") or asst_txt
                        except Exception:
                            pass

                        # [2026-09-24 修] 官方**最权威**的复位信号在独立的额度条里，不在助手消息内：
                        # 「你现在的图片生成次数已用完。请在 12:21后重试。」（绝对时钟）
                        # 单独读一次 DOM 并合并进待解析文本，保证 A 这种助手消息被截断的场景也能拿到准确复位点。
                        try:
                            js_banner = """(() => {
                                const hits = [];
                                document.querySelectorAll('span,p,h3,div').forEach(el => {
                                    if (el.children.length > 0) return;
                                    const t = (el.innerText || '').trim();
                                    if (t && t.length < 120 && /图片生成次数已用完|后重试|后重置|too many requests|try again|usage limit/i.test(t)) hits.push(t);
                                });
                                return hits.slice(0, 6).join('\\n');
                            })()"""
                            r_b = await self.send_cmd("Runtime.evaluate", {"expression": js_banner, "returnByValue": True}, timeout=15)
                            banner_txt = r_b.get("result", {}).get("result", {}).get("value", "") or ""
                        except Exception:
                            banner_txt = ""
                        quota_txt = (asst_txt + "\n" + banner_txt).strip()

                        base_sec, dbg = extract_quota_signals(quota_txt)
                        wait_sec = parse_quota_wait_seconds(quota_txt)
                        # 【2026-09-25 修·用户指令】纯 "Too many requests" 软节流 → 轻冷却 20~30 分钟，不进重型熔断
                        if is_soft_rate_limit_only(quota_txt):
                            wait_sec = soft_rate_limit_wait_seconds()
                            log(f"⏳【软节流】识别到瞬时限流 Too many requests，轻冷却 {wait_sec // 60} 分钟后续跑（不套用小时级熔断）", self.id)

                        # [2026-09-24 修] 撞限计数改为「按自然日自愈重置」：此前只靠 daily_quota.date 变更时归零，
                        # 一旦 date 提前变成今天而 hits 没跟着归零，加码系数就会虚高
                        # （实测 09-24 02:30 实例 A 被记成"本日第 4 次"，其中 3 次其实是 09-23 的）。
                        today_key = datetime.datetime.now().strftime("%Y-%m-%d")
                        inst_node = DAEMON_STATE.setdefault("instances", {}).setdefault(self.id, {})
                        if inst_node.get("quota_hits_date") != today_key:
                            inst_node["quota_hits_date"] = today_key
                            inst_node["quota_hits_today"] = 0
                        prev_hits = int(inst_node.get("quota_hits_today") or 0)
                        hits_after = prev_hits + 1
                        wait_sec = compute_quota_backoff_wait(wait_sec, hits_after)
                        # 【2026-09-25 修·用户指令】软节流最终定值锁死 20~30 分钟（加码只对硬额度有意义）
                        if is_soft_rate_limit_only(quota_txt):
                            wait_sec = soft_rate_limit_wait_seconds()
                        resume_dt = datetime.datetime.now() + datetime.timedelta(seconds=wait_sec)
                        resume_str = resume_dt.strftime('%Y-%m-%d %H:%M:%S')
                        wait_h = wait_sec // 3600
                        wait_m = (wait_sec % 3600) // 60

                        # 留全量痕迹：以前只记前 50 字，正是这个截断掩盖了"抓到的是半截消息"这个真因
                        log(f"🚨【配额熔断】官方提示原文({len(quota_txt)}字): {quota_txt[:220].replace(chr(10), ' | ')}", self.id)
                        log(f"🧮 解析依据: 权威时钟={dbg['clock'] or '—'} / 官方时长={dbg['hour_min'] or '—'} / 无锚点兜底={dbg['raw_hours']}时{dbg['raw_mins']}分 → 基础等待 {int(base_sec)//60} 分钟", self.id)
                        if hits_after > 1:
                            log(f"🔁 本日第 {hits_after} 次撞限，休眠已叠加 {min(max(0, hits_after-1)*20, 60)} 分钟冗余", self.id)
                        log(f"⏳ 精确预计休眠时长: {wait_h}小时{wait_m}分，预计恢复时间: {resume_str}", self.id)

                        account_alias = get_account_alias(self.id)
                        backoff_note = (
                            f"\n🔁 **重复撞限冗余**：本日第 {hits_after} 次撞限，已在官方复位点上叠加 {min(max(0, hits_after-1)*20, 60)} 分钟冗余。"
                            if hits_after > 1 else ""
                        )
                        parse_note = (
                            f"📐 **解析依据**：权威时钟 **{dbg['clock'] or '未取到'}**"
                            f" ／ 官方时长 **{dbg['hour_min'] or '未取到'}**"
                            f" ／ 基础等待 {int(base_sec)//60} 分钟\n"
                        )
                        alert_md = (
                            f"⏳【双浏览器流水线 · 实例 {self.id} 配额熔断自愈休眠】\n"
                            f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                            f"⚙️ **生产实例**：实例 {self.id}（{account_alias} · CDP 端口 {self.cdp_port}）\n"
                            f"⏱ **触发时刻**：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                            f"💬 **官方提示**：{quota_txt.strip()[:160]}\n"
                            f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                            f"{parse_note}"
                            f"⏰ **预计解冻恢复时刻**：**{resume_str}**\n"
                            f"⌛ **休眠倒计时**：约 {wait_h} 小时 {wait_m} 分钟\n"
                            f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                            f"🛡️ **自愈续接机制已激活**：\n"
                            f"1. 当前任务锁已安全释放回待生产池，绝不丢单漏单；\n"
                            f"2. 实例 {self.id} 自动进入低能耗长休眠挂起；\n"
                            f"3. 到达 **{resume_str}** 准点时刻，系统将**自动在群内推送解冻提醒**，并**自动唤醒续接开工**，全程 100% 免人工值守！"
                            f"{backoff_note}"
                        )
                        send_feishu_markdown(alert_md, FEISHU_OPS_CHAT_ID)
                        raise QuotaLimitException(f"ChatGPT Plus 生图额度上限: {quota_txt[:35]}", wait_seconds=wait_sec, resume_dt=resume_dt)

                    rejection_keys = [
                        "没法直接出图", "重新上传", "没有实际可用", "拿不到可编辑", "无法按你要求",
                        "违反了", "防护限制", "相似性", "内容政策", "无法生成图片", "版权", "抱歉，我无法",
                        "图片生成受限", "图像额度已用完", "图片生成次数已用完", "达到 Free 套", "升级套餐以继续"
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
                    log(f"⚠️ 连续 {tick*10} 秒网页已停止生成但仍为 0 图（助手消息数={alive_val.get('asstCount', 0)}），触发快速熔断！", self.id)
                    raise RuntimeError("ChatGPT 网页停止生成但未返回大图，快速熔断重试")
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
                    # 【2026-09-27 新增·反向识别①：出图数量不足即判定模型降级】
                    # 旧逻辑只要 >= min_album_limit(5) 就"接受成果"，于是计划 10 张只出 5 张（50%）
                    # 也能过关进文案 —— 用户判定："只产出几张，明显是模型出问题了，应该直接停止"。
                    _ratio_now = (img_count / target_limit) if target_limit else 0
                    if _ratio_now < DEGRADE_MIN_RATIO:
                        raise ModelDegradedException(
                            f"出图严重不足：计划 {target_limit} 张、实际仅 {img_count} 张"
                            f"（达成率 {_ratio_now:.0%} < {DEGRADE_MIN_RATIO:.0%}），判定模型产出能力降级",
                            wait_seconds=DEGRADE_COOLDOWN_SEC, kind="short_output")
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
                                # 【2026-09-27 新增·反向识别①（补齐失败后的兜底判定）】
                                # 旧逻辑 img_count >= 3 就"接受当前成果" —— 计划 10 张只出 3 张（30%）
                                # 也算过关，正是用户看到的"只产出几张照片"的垃圾来源。
                                _ratio_end = (img_count / target_limit) if target_limit else 0
                                if _ratio_end < DEGRADE_MIN_RATIO:
                                    raise ModelDegradedException(
                                        f"补齐多次无响应且出图严重不足：计划 {target_limit} 张、实际 {img_count} 张"
                                        f"（达成率 {_ratio_end:.0%}），判定模型产出能力降级",
                                        wait_seconds=DEGRADE_COOLDOWN_SEC, kind="short_output")
                                log(f"⚠️ 补齐多次未响应，当前已有 {img_count}/{target_limit} 张图"
                                    f"（达成率 {_ratio_end:.0%}），接受当前成果进入文案...", self.id)
                                break

        # 【2026-09-27 修·别把文案指令撞在"图还没画完"的枪口上】
        # 「9/9 就绪」只是抓到了 9 张大图 URL，模型往往还在继续收尾（实测仍在勾勒草图 55%），
        # 此时注入文案必然点不亮发送按钮 → 四通道全废 → 文案空转 → 整套判废。
        # 先等页面真正空闲，再发文案指令。
        await self.wait_until_idle(max_wait_sec=300, reason="出图收尾")

        # 【2026-09-27 新增·反向识别②：出图阶段"话痨/吐文案" = 模型错乱】
        # 用户判据原文："正常我让出图，那就只出图。如果出图它也顺带出文案、出其他文字，
        # 那就是大模型出问题了。这时候就需要休息休息。"
        # 检测手法：生图指令里 <<<VERSION_START 最多只出现 1 次（仅作为格式说明举例），
        # 若页面上出现 >= 3 组 <<<VERSION_START…<<<VERSION_END>>>，说明模型真把整套文案提前吐了。
        # 命中即让实例休息，绝不把错乱产出当成品、也绝不隔离素材。
        try:
            _rt = await self.send_cmd("Runtime.evaluate", {"expression": """(() => {
                const m = document.querySelector('main');
                const t = m ? (m.innerText || '') : '';
                return {vs: (t.match(/<<<VERSION_START/g) || []).length,
                        ve: (t.match(/<<<VERSION_END>>>/g) || []).length};
            })()""", "returnByValue": True}, timeout=15)
            _tv = (_rt.get("result", {}).get("result", {}).get("value", {}) or {})
            _vs = int(_tv.get("vs", 0) or 0)
            _ve = int(_tv.get("ve", 0) or 0)
            if _vs >= 3 and _ve >= 3:
                raise ModelDegradedException(
                    f"出图阶段模型顺带吐出整套文案（检测到 {_vs} 组 VERSION 块 / {_ve} 个结束标记），"
                    f"判定模型指令遵循错乱", wait_seconds=DEGRADE_COOLDOWN_SEC, kind="talkative")
        except ModelDegradedException:
            raise
        except Exception:
            pass

        # 5. 发送多版本文案中枢 V4.5 指令（11 大排版视觉指纹标准）
        log("-> 发送多版本文案中枢 V4.5 指令（11 大排版视觉指纹标准）...", self.id)
        copy_prompt = (
            f"请根据上面刚刚生成的全套大图与原素材真实行程，立即生成【多版本文案中枢 V4.5】全套标准成稿。\n"
            f"【原素材参考正文】：\n{context_block}\n\n"
            "【最高执行铁律】：\n"
            "1. 坚决杜绝干瘪公文垃圾：严禁出现“方案名称：/适用对象：/预算参考：”等体制内申报公文腔，必须是小红书野生高赞爆款感！\n"
            "2. 视觉指纹命名（严格最多 4 个纯汉字按钮名）：\n"
            "   每个版本必须用 <<<VERSION_START:最多4字版本名>>> ... <<<VERSION_END>>> 包裹。\n"
            "3. 单标题铁律：每个版本首行必须且仅有 1 个纯文本标题，严禁加 # 号、严禁包裹大中文括号【】、严禁任何序号！\n"
            "4. 防吞空行铁律：段落之间空行必须填入不可见盲文空格“⠀”（Unicode U+2800，格式为 \\n⠀\\n），绝不输出裸露 \\n\\n！\n"
            "5. 抖音避坑版绝对去商业化：定位纯个人自驾/生活探索经验，绝无“团建/组织/方案/路线/报价”等涉旅敏感词！\n"
            "6. 严防末尾截断：每一版必须完整展开并以单行话题标签结尾，紧跟 <<<VERSION_END>>>，严禁半句断尾！\n\n"
            "【请生成以下 11 个排版视觉指纹版本成稿】：\n"
            "<<<COPY_FORMAT:MULTI>>>\n"
            "<<<VERSION_START:数字爆款>>>\n"
            "真实大厂回购爆款主标题（带吸引力与emoji）\n"
            "正文（1️⃣2️⃣3️⃣ 大数字键帽 + ‼️ + 💯 轰炸，痛点切入，节奏极快）\n"
            "#热门话题标签\n"
            "<<<VERSION_END>>>\n\n"
            "<<<VERSION_START:分天动线>>>\n"
            "海岛度假慢调漫步主标题\n"
            "正文（𝗗𝗔𝗬❶ 𝗗𝗔𝗬❷ 加粗西文 + 🔅 🔹 🔸 几何圆圈动线，松弛不赶路）\n"
            "#热门话题标签\n"
            "<<<VERSION_END>>>\n\n"
            "<<<VERSION_START:三箭头体>>>\n"
            "大自然森系吸氧主标题\n"
            "正文（- 》》》 招牌三箭头 + ✅ 双勾 + 治愈自然Emoji符号清单）\n"
            "#热门话题标签\n"
            "<<<VERSION_END>>>\n\n"
            "<<<VERSION_START:杂志长条>>>\n"
            "杂志级画册选型指南主标题\n"
            "正文（—— 🌿【企划】—— 长横线装饰条 + 01 ｜ 空间美学配置）\n"
            "#热门话题标签\n"
            "<<<VERSION_END>>>\n\n"
            "<<<VERSION_START:时间轴体>>>\n"
            "秋日轻奢慢节奏日程主标题\n"
            "正文（08:30 | 竖线精准时间颗粒度行程，优雅松弛）\n"
            "#热门话题标签\n"
            "<<<VERSION_END>>>\n\n"
            "<<<VERSION_START:原生种草>>>\n"
            "真实博主亲历自用劝退主标题\n"
            "正文（第一人称口语化，真实体验避坑，零广告套路感）\n"
            "#热门话题标签\n"
            "<<<VERSION_END>>>\n\n"
            "<<<VERSION_START:决策矩阵>>>\n"
            "HR向上汇报横向比选主标题\n"
            "正文（📊 横向维度比对、适合/不适合团队分析、选型建议）\n"
            "#热门话题标签\n"
            "<<<VERSION_END>>>\n\n"
            "<<<VERSION_START:货架明细>>>\n"
            "预算清晰拆解防超标主标题\n"
            "正文（📦 模块化费用清单：大巴/门票/餐饮/住宿人均透明列式）\n"
            "#热门话题标签\n"
            "<<<VERSION_END>>>\n\n"
            "<<<VERSION_START:包院私享>>>\n"
            "独栋私密小院沉浸研讨主标题\n"
            "正文（山野院落、高管复盘、星空夜话，私密高端体验）\n"
            "#热门话题标签\n"
            "<<<VERSION_END>>>\n\n"
            "<<<VERSION_START:案例背书>>>\n"
            "名企实操落地全记录主标题\n"
            "正文（真实团队案例复盘，高满意度与无加班焦虑背书）\n"
            "#热门话题标签\n"
            "<<<VERSION_END>>>\n\n"
            "<<<VERSION_START:抖音避坑>>>\n"
            "纯个人自驾生活避坑短卡主标题\n"
            "正文（去商业去涉旅敏感词，口语化纯经验避坑与装备建议）\n"
            "#5个生活类标签\n"
            "<<<VERSION_END>>>\n"
        )
        sent_copy = await self.send_text_prompt(copy_prompt, "V4.5 多版本文案指令", max_wait_sec=25)
        if not sent_copy:
            log("🚨 文案指令首次提交未获网页确认，等待 3 秒后重试一次发送...", self.id)
            await asyncio.sleep(3)
            sent_copy = await self.send_text_prompt(copy_prompt, "V4.5 多版本文案指令（重试）", max_wait_sec=25)
        if not sent_copy:
            log("🚨 文案指令重试后仍未获提交确认，坚决拒绝假抓取用户提问，终止本次以防误产空壳", self.id)
            raise RuntimeError("文案指令无法提交至 ChatGPT 编辑框")
        log("多版本文案指令已发送，等待文本产出...", self.id)

        # 【2026-09-23 修复·旧 VERSION_END 污染】记录"文案指令提交瞬间"的页面基线。
        # 之后 get_txt_js 只取该基线之后新增的文本，避免把出图阶段残留的 VERSION_END 当成新文案
        # （现象：抓取 16583 字看似成功，copy_formatter 洗完只剩 134 字 -> 空壳判废）。
        try:
            # 【2026-09-25 修·composer 自污染】新版 ChatGPT 的输入框（ProseMirror）本身就在 <main> 内，
            # 直接取 main.innerText 会把「输入框里还没发出去的草稿」算成助手产出。
            # 实测事故：08:52 B 实例抓到「...继续。上一轮回复已被中断...」这 111 字，正是我们注入的追问原文，
            # 一旦里面含 VERSION_START 就会被误判为文案。这里统一改为「克隆 main 后剔除表单/富文本输入区」再取文本。
            # 【2026-09-27 修·抓取基线增加「尾部锚点 + 版本块指纹」】
            # 原基线只记一个 mainLen 数字，抓取时用 full.slice(mainLen) 按长度切。
            # 实测新 UI 会做虚拟滚动 / 节点回收（日志里那句「回收阶段页面节点已收缩」），
            # 早期消息节点被卸载后 main.innerText 会**变短**，slice(mainLen) 恒为空字符串 →
            # 文案明明已经写完（实测 A 实例 main 尾部 11 个 <<<VERSION_START>>> 全在），
            # 抓取长度却一直是 0 → 空壳判废 → 素材重做甚至物理隔离。这是近期全线零产出的真根因。
            # 现基线额外记录：①末尾 120 字锚点；②当前所有 <<<VERSION_START…VERSION_END>>> 块的指纹。
            js_baseline = r"""(() => {
                const m = document.querySelector('main');
                let len = 0, full = '';
                if (m) {
                    const clone = m.cloneNode(true);
                    clone.querySelectorAll('form, textarea, [contenteditable="true"], [data-testid*="composer"], [data-message-author-role="user"]')
                         .forEach(n => { try { n.remove(); } catch (e) {} });
                    full = clone.innerText || clone.textContent || '';
                    len = full.length;
                }
                const _h = (s) => {
                    let h = 5381;
                    for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; }
                    return 'h' + h.toString(16) + '_' + s.length;
                };
                const _blocks = (t) => {
                    const re = /<<<VERSION_START:\s*([^>\n]{1,24})\s*>>>([\s\S]*?)<<<VERSION_END>>>/g;
                    const out = []; let mm;
                    while ((mm = re.exec(t))) { out.push(mm[0]); }
                    return out;
                };
                window.__copyBaseline = {
                    mainLen: len,
                    asstCount: document.querySelectorAll('[data-message-author-role="assistant"]').length,
                    tail: full.slice(-120),
                    blockHashes: _blocks(full).map(_h)
                };
                return {mainLen: len, asstCount: window.__copyBaseline.asstCount,
                        blocks: window.__copyBaseline.blockHashes.length};
            })()"""
            r_base = await self.send_cmd("Runtime.evaluate", {"expression": js_baseline, "returnByValue": True}, timeout=15)
            bv = r_base.get("result", {}).get("result", {}).get("value", {}) or {}
            log(f"📏 文案抓取基线已记录: mainLen={bv.get('mainLen', 0)} asstCount={bv.get('asstCount', 0)}", self.id)
        except Exception as _be:
            log(f"⚠️ 文案抓取基线记录失败（退化为全量抓取）: {_be}", self.id)

        # 【2026-09-23 修复·文案抓取全废根因】旧版 get_txt_js 依赖
        # `[data-testid^="conversation-turn-"]` 的最后一个 turn 且「非 user」即取 innerText，
        # 但新版 ChatGPT 引入了 `collapsible-user-message` 折叠结构 + 长回复可能被折叠，
        # 导致「图能出、文案却 100% 抓空」，60 次轮询静默空转、一条日志都不打。
        # 修复：①抓取改为「从后往前找最后一个 assistant 消息」并兼容折叠结构；②每轮打诊断日志，
        # 记录 turns 数 / 抓取长度 / 是否含 VERSION，让空转可一眼定位；③对空抓取也打日志，不再静默。
        copy_text = ""
        # 【2026-09-24 新增】记录轮询中「最后一次非空抓取」的原文，供轮询失败后做归类：
        # 是「官方配额拒绝」（应走配额自愈、绝不隔离）还是「真的抓不到产出」（才考虑判废）。
        # 起因：实测 09-24 02:23 宁波素材，抓取全程卡在 22 字的官方短通知上，
        # 下游却按「0 字空壳」判废并物理隔离 —— 素材白丢。
        _last_poll_txt = ""
        # 【2026-09-25 修·文案环节"永远抓不到"的真根因】原窗口 60 次 × 3 秒 = 180 秒。
        # 两份实测对照（同一条 A 产线、同一套代码）：
        #   成功样本 09-24 01:55:20 提交 → 01:57:42 抓到，耗时 142 秒 / 第 46 轮（勉强赶上）
        #   失败样本 09-25 06:58:38 提交 → 07:01:41 判死时 isGenerating = **True**，模型明明还在写
        # 结论：模型没失败，是**窗口太短被强行判死**。11 版长文案在「15135 字生图指令 + 10 张原图」
        # 的重上下文里，生成耗时会在 140~300 秒之间浮动；09-25 全天 6 次文案环节的末态原文
        # 分别是 3 字「思考中」、15~23 字「<<<COPY_FORMAT:MULTI>>>」（格式头刚吐出来就被截断），
        # 全部是"没给够时间"，没有一次是真的写不出来。
        # 现改为：窗口 200 × 3 秒 = 600 秒（10 分钟），且**以生成状态判活**：
        #   · isGenerating = True            → 它还在写就一直等，绝不按时间判死
        #   · 已停止生成 + 连续 45 秒无新内容 → 才认定真失败，提前认输（不空等 10 分钟）
        _COPY_MAX_POLL = 200
        # 【2026-09-25 重写】原为 15 轮(45 秒)且入口条件是「已停止生成」，实测该条件在本故障下永不成立。
        # 现以「内容零增长」为唯一判据。
        # 【2026-09-28 修·整夜零产出的真根因】原值 20 轮 = 60 秒，实测**每一套文案都在约 57 秒被判死**
        # （日志：`判定文案流已断：连续 60 秒零增长…已等待约 57 秒`）。
        # 但本文件上文注释自己写着：11 版长文案在「15135 字生图指令 + 10 张原图」的
        # 重上下文里，生成耗时在 **140~300 秒**浮动 —— 60 秒的判活窗口连模型的思考期都覆盖不了，
        # 于是「出图 5/5 成功 → 文案 0 字判废 → 不入库」，09-27 整夜 0 套成品。
        # 现放宽到 60 轮 = 180 秒零增长才判死：既能覆盖思考期与正常停顿，
        # 又仍在 _COPY_MAX_POLL(200 轮 / 600 秒) 的总窗口内，真断流也不会空耗太久。
        _STALL_LIMIT = 60
        _stall_rounds = 0
        _peak_len = 0
        for poll_idx in range(_COPY_MAX_POLL):
            await asyncio.sleep(3)
            get_txt_js = r"""(() => {
                // 【2026-09-27 修·「生成中」判据必须排除 composer 常驻按钮】
                // 旧判据 button[aria-label*="停止"] 会命中 composer 区那个常驻停止按钮，
                // 实测它永远在页面上 → isGenerating 恒 True → 下游 `if(has_ve && !isGen)` 收工条件永不成立，
                // 抓到完整 11 版文案也不肯收工，一路空转到 200 轮判废。
                // 真生成的硬证据只有：data-testid="stop-button" / 流式标记 / 图像生成 loading 板。
                const stopHard = document.querySelector('button[data-testid="stop-button"]');
                const streaming = document.querySelector('.result-streaming, [class*="streaming"], [data-testid*="streaming"]');
                const imgLoading = document.querySelector('[data-testid*="image-gen-loading"], [data-testid*="loading-game-board"]');
                const isGen = !!stopHard || !!streaming || !!imgLoading;
                // 【2026-09-23 二次修复·文案抓到 26 字壳】上一版策略「优先取最后一个 assistant 消息」有缺陷：
                // 新版 ChatGPT 里，[data-message-author-role="assistant"] 命中的最后一个节点，往往是
                // 文案指令之前模型对图片的短确认（如「好的，我来生成」26 字），非空但非真文案。
                // 因为非空，`if(!text)` 回退分支永不触发，导致抓取一直卡在 26 字壳上（实测 14:30 判废）。
                // 而 14:01/14:11 两次成功恰是 assistant-node 抓空后回退 main 才成功（src=main，12000+ 字）。
                // 修复：同时取 main 全量与最后一个 assistant，优先选「含 VERSION_END」的那份；
                // 都不含则选更长的（main 全量天然更长，且含完整文案），彻底告别 26 字壳卡死。
                let candidates = [];
                // [2026-09-23 三次修复·旧 VERSION_END 污染] 出图阶段 main 里已经存在 VERSION_END，
                // 直接抓全量会把「上一阶段的旧文案」当成「本次 V4.5 新文案」，asst=0 时尤其致命
                // （实测：抓取 16583 字看着很美，copy_formatter 洗完只剩 134 字 -> 空壳判废）。
                // 这里以文案指令提交瞬间记录的基线为界，只取之后新增的内容。
                const base = window.__copyBaseline || {mainLen: 0, asstCount: 0};
                const asst = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
                if (asst.length > 0 && asst.length <= base.asstCount) {
                    // 新一轮文案尚未产生独立的 assistant 消息节点，模型仍在思考中，绝不提前抓取或误抓用户提问
                    return {isGen: true, text: '', src: 'waiting-assistant', len: 0, has_ve: false};
                }
                const a = asst.length > 0 ? (asst[asst.length - 1].innerText || '') : '';

                if (a) candidates.push({src: 'assistant-node', text: a});
                const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"]'));
                for (let i = turns.length - 1; i >= 0; i--) {
                    const isUser = !!turns[i].querySelector('[data-message-author-role="user"]');
                    if (!isUser) {
                        const t = turns[i].innerText || '';
                        if (t) { candidates.push({src: 'turn-' + i, text: t}); break; }
                    }
                }
                const mainEl = document.querySelector('main');
                if (mainEl) {
                    // 【2026-09-25 修·composer 自污染 + 2026-10-05 修·用户提问示例污染】与基线同口径：克隆后剔除表单/输入区与用户提问
                    const clone = mainEl.cloneNode(true);
                    clone.querySelectorAll('form, textarea, [contenteditable="true"], [data-testid*="composer"], [data-message-author-role="user"]')
                         .forEach(n => { try { n.remove(); } catch (e) {} });
                    const full = clone.innerText || clone.textContent || '';
                    const m = full.slice(base.mainLen);
                    if (m) candidates.push({src: 'main', text: m});

                    // 【2026-09-27 修·两条不依赖「长度」的抓取通道】
                    // slice(base.mainLen) 在虚拟滚动回收节点后恒为空（main 文本会变短），
                    // 这里补两条更抗造的通道：
                    //   ① 块差分：把当前所有 <<<VERSION_START…VERSION_END>>> 块与基线指纹比对，
                    //      只留下基线里没有的新块 —— 既能抗节点回收，又能天然剔除上一阶段的旧文案。
                    //   ② 锚点：用基线记录的末尾 120 字在全文里定位，取其后的内容。
                    const _h2 = (s) => {
                        let h = 5381;
                        for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; }
                        return 'h' + h.toString(16) + '_' + s.length;
                    };
                    const _baseSet = new Set(base.blockHashes || []);
                    const _re = /<<<VERSION_START:\s*([^>\n]{1,24})\s*>>>([\s\S]*?)<<<VERSION_END>>>/g;
                    const _fresh = [];
                    let _mm;
                    while ((_mm = _re.exec(full))) {
                        if (!_baseSet.has(_h2(_mm[0]))) { _fresh.push(_mm[0]); }
                    }
                    if (_fresh.length) { candidates.push({src: 'blocks-diff', text: _fresh.join('\n\n')}); }
                    const _tail = base.tail || '';
                    if (_tail) {
                        const _i = full.indexOf(_tail);
                        if (_i >= 0 && _i + _tail.length < full.length) {
                            candidates.push({src: 'anchor', text: full.slice(_i + _tail.length)});
                        }
                    }
                }
                // 先修复各候选的前缀残缺
                for (const c of candidates) {
                    if (c && c.text) {
                        if (/^ION_START:/.test(c.text)) c.text = '<<<VERS' + c.text;
                        else if (/^VERSION_START:/.test(c.text)) c.text = '<<<' + c.text;
                        else if (/^RSION_START:/.test(c.text)) c.text = '<<<VE' + c.text;
                    }
                }
                // 选优：优先取 blocks-diff（结构最纯且完整）；若无则取含 VERSION_END 中最长的一份
                let pick = null;
                for (const c of candidates) {
                    if (c.src === 'blocks-diff' && (c.text.includes('VERSION_END') || c.text.includes('DOUYIN_END'))) {
                        pick = c; break;
                    }
                }
                if (!pick) {
                    for (const c of candidates) {
                        if (c.text.includes('VERSION_END') || c.text.includes('DOUYIN_END')) {
                            if (!pick || c.text.length > pick.text.length) { pick = c; }
                        }
                    }
                }
                if (!pick) {
                    for (const c of candidates) {
                        if (!pick || c.text.length > pick.text.length) { pick = c; }
                    }
                }
                const text = pick ? pick.text : '';
                const src = pick ? pick.src : 'none';
                return {
                    text: text,
                    isGenerating: isGen,
                    src: src,
                    asstCount: asst.length,
                    turnCount: turns.length,
                    hasVersionEnd: text.includes('VERSION_END') || text.includes('DOUYIN_END'),
                    hasVersionStart: text.includes('VERSION_START')
                };
            })()"""
            try:
                r_txt = await self.send_cmd("Runtime.evaluate", {"expression": get_txt_js, "returnByValue": True})
                val_txt = r_txt.get("result", {}).get("result", {}).get("value", {}) if isinstance(r_txt, dict) else {}
                txt = val_txt.get("text", "")
                is_gen_txt = val_txt.get("isGenerating", False)
                src = val_txt.get("src", "?")
                asst_cnt = val_txt.get("asstCount", 0)
                turn_cnt = val_txt.get("turnCount", 0)
                has_ve = val_txt.get("hasVersionEnd", False)
                if txt:
                    _last_poll_txt = txt

                # 【诊断日志】每轮记录一次抓取状态，杜绝静默空转（每 10 轮打一次，避免刷屏）
                if poll_idx % 10 == 0 or has_ve:
                    log(f"⏳ 文案轮询 [{poll_idx}/{_COPY_MAX_POLL}] src={src} turns={turn_cnt} asst={asst_cnt} "
                        f"抓取长度={len(txt)} 含VERSION_END={has_ve} 生成中={is_gen_txt} 停滞{_stall_rounds}/{_STALL_LIMIT}", self.id)
                    # 【2026-09-24 新增】抓到的是短文本时，直接把原文打出来 ——
                    # 只有长度（如"抓取长度=22"）根本判断不出那 22 字是配额拒绝还是模型短确认。
                    if txt and len(txt) < 200:
                        log(f"   └ 短文本原文: {txt.replace(chr(10), ' ')[:120]}", self.id)

                # 【2026-09-25 修】原为 poll_idx >= 10（30 秒后才接受），窗口拉长后放宽到 >= 3，
                # 避免"模型 3 秒就写完了"这种快样本被无谓闲置；基线机制仍负责挡旧残留。
                # 【2026-09-25 重写·「流已断」判定（本故障的唯一止血点）】
                # 现改为**内容级判活，完全不依赖任何按钮状态**：
                #   · 抓取长度比历史峰值增长 > 4 字 → 流还活着，停滞计数清零
                #   · 连续 _STALL_LIMIT 轮零增长 → 判定「流已断」，立即收工交给上层重试/熔断
                if len(txt) > _peak_len + 4:
                    _peak_len = len(txt)
                    _stall_rounds = 0
                else:
                    _stall_rounds += 1

                # 【2026-10-05 深度升级·杜绝中途早退与UI免责声明残缺】
                # 只有当：
                # 1. 包含 VERSION_END，且没有处于未闭合版本块中间（未闭合判据：VERSION_START 数量 > VERSION_END 数量）；
                # 2. 且已完成全部 3 个标准版本（或包含“抖音避坑”），或者确实已经连续 10 轮零增长停滞；
                # 3. 且 (前端明确停止回答 或 停滞 >= 10 轮)。
                _has_open_block = txt.count('<<<VERSION_START:') > txt.count('<<<VERSION_END>>>')
                _has_complete_v3 = (txt.count('<<<VERSION_END>>>') >= 3 or '<<<VERSION_START:抖音避坑>>>' in txt)
                _ready_to_seal = (not _has_open_block) and (_has_complete_v3 or _stall_rounds >= 10)
                if (has_ve) and _ready_to_seal and ((not is_gen_txt) or _stall_rounds >= 10) and poll_idx >= 3 and len(txt) > 200:
                    # 【2026-09-22 修复·文案三病之二】「实质产出校验」：剔除全部 <<<>>> 标记与空白后，
                    # 若实质正文仍不足 MIN_COPY_SUBSTANCE(300) 字，说明抓到的是模板壳/指令回显，绝不当作文案。
                    _probe_substance = re.sub(r'<<<[^>]*>>>', '', txt)
                    _probe_substance = re.sub(r'[\s\u2800]+', '', _probe_substance)
                    if len(_probe_substance) >= 300:
                        copy_text = txt
                        log(f"V4.5 多版本文案结构捕获成功！(长度: {len(copy_text)}, 实质 {len(_probe_substance)} 字, src={src})", self.id)
                        break
                    else:
                        log(f"⏳ 文案捕获疑似抓到指令模板/占位壳（实质仅 {len(_probe_substance)} 字），继续等待真实产出...", self.id)

                if (not copy_text) and poll_idx >= 6 and _stall_rounds >= _STALL_LIMIT:
                    log(f"⚠️ 判定文案流已断：连续 {_STALL_LIMIT * 3} 秒零增长"
                        f"（末态仅 {len(txt)} 字 / 峰值 {_peak_len} 字 / 前端仍显示生成中={is_gen_txt}），"
                        f"提前结束轮询（已等待约 {poll_idx * 3} 秒），不再空耗至 {_COPY_MAX_POLL * 3} 秒", self.id)
                    break
            except Exception as e_txt:
                log(f"⚠️ 文案轮询异常 [{poll_idx}]: {e_txt}", self.id)

        if not copy_text:
            # 【2026-09-24 新增】先把最后一次抓到的原文落进日志（此前只记长度，
            # 导致「抓到的是官方配额拒绝短通知」这个真因被完全掩盖）。
            _qt = (_last_poll_txt or "").strip()
            log(f"🚨 文案轮询结束（上限 {_COPY_MAX_POLL} 次 / {_COPY_MAX_POLL * 3} 秒，实际约 {poll_idx * 3} 秒）"
                f"仍未捕获到含 VERSION_END 的真实产出，copy_text 为空，将触发判废重做", self.id)
            log(f"🔎 最后一次抓取原文（{len(_qt)} 字）: {_qt[:160].replace(chr(10), ' | ') or '（完全为空）'}", self.id)

            # 【2026-09-24 修·素材白丢】文案阶段撞官方配额时，模型回的是「你已达到 Plus 套餐的图像生成请求上限」
            # 这类 20~30 字的拒绝通知，它**不是素材缺陷**，但会被下游按「0 字空壳」判废 → 3 次重试后物理隔离，
            # 白白丢掉素材（实测 09-24 02:23 宁波素材即为此因）。
            # 这里识别出配额语义就直接抛配额异常，复用既有的「永不隔离 + 精确休眠 + 推运维群」自愈路径。
            # 安全边界：只对**短文本**（< 200 字）做配额归类，避免把正常长文案误判成撞限。
            _QUOTA_COPY_KEYS = (
                "达到 Plus 套餐", "达到 Free 套", "图像生成请求上限", "图片生成次数已用完",
                "额度限制", "上限将在", "重置，届时可创建更多图像", "后重试", "后重置",
                # 【2026-09-25 修】英文限流提示（"Too many requests" 常在文案/出图阶段瞬时出现）
                "Too many requests", "too many requests", "usage limit", "you've reached", "you have reached",
            )
            if _qt and len(_qt) < 200 and any(_k in _qt for _k in _QUOTA_COPY_KEYS):
                _base, _dbg = extract_quota_signals(_qt)
                _wait = parse_quota_wait_seconds(_qt)
                # 【2026-09-25 修·用户指令】纯 "Too many requests" 软节流 → 轻冷却 20~30 分钟
                if is_soft_rate_limit_only(_qt):
                    _wait = soft_rate_limit_wait_seconds()
                    log(f"⏳【软节流·文案阶段】Too many requests → 轻冷却 {_wait // 60} 分钟后续跑", self.id)
                _today = datetime.datetime.now().strftime("%Y-%m-%d")
                _node = DAEMON_STATE.setdefault("instances", {}).setdefault(self.id, {})
                if _node.get("quota_hits_date") != _today:
                    _node["quota_hits_date"] = _today
                    _node["quota_hits_today"] = 0
                _hits = int(_node.get("quota_hits_today") or 0) + 1
                _wait = compute_quota_backoff_wait(_wait, _hits)
                # 软节流在加码之后最终定值（加码只对硬额度有意义，软节流锁死在 20~30 分钟）
                if is_soft_rate_limit_only(_qt):
                    _wait = soft_rate_limit_wait_seconds()
                _rdt = datetime.datetime.now() + datetime.timedelta(seconds=_wait)
                log(f"🛑【文案阶段配额熔断】官方拒绝原文: {_qt[:160]}", self.id)
                log(f"🧮 解析: 权威时钟={_dbg['clock'] or '—'} / 官方时长={_dbg['hour_min'] or '—'} "
                    f"/ 无锚点兜底={_dbg['raw_hours']}时{_dbg['raw_mins']}分 → 休眠 {_wait // 3600}小时{(_wait % 3600) // 60}分 "
                    f"→ 预计恢复 {_rdt.strftime('%Y-%m-%d %H:%M:%S')}", self.id)
                log("🛡️ 该失败已归类为「配额耗尽」：任务锁按配额豁免释放（永不隔离），素材安全退回待生产池", self.id)
                raise QuotaLimitException(
                    f"文案阶段官方配额上限: {_qt[:35]}", wait_seconds=_wait, resume_dt=_rdt)

        # 6. 提取全部无损图片 URL
        js_get_urls = """(() => {
            // 回收阶段必须和出图轮询使用同一套“全页面生成图”探测。
            // 文案回复后，conversation-turn 可能同时包含 user/assistant 子节点，
            // 旧的助手子树筛选会把已经生成好的图片全部过滤掉，造成 0 图误判。
            const userMsgs = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
            const userImgSrcs = new Set();
            userMsgs.forEach(m => m.querySelectorAll('img').forEach(i => userImgSrcs.add(i.currentSrc || i.src || '')));
            const allImgs = Array.from(document.querySelectorAll('img'));
            const map = new Map();
            allImgs.forEach(img => {
                const src = img.currentSrc || img.src || '';
                const alt = img.alt || '';
                const isAvatar = alt.includes('个人资料') || alt.includes('profile') || alt.includes('avatar');
                const isRawUpload = alt.includes('.jpg') || alt.includes('.jpeg') || alt.includes('.png') || userImgSrcs.has(src);
                const w = img.naturalWidth || img.width || 0;
                const h = img.naturalHeight || img.height || 0;
                const isTiny = w > 0 && h > 0 && w < 300 && h < 300;
                // 生成图可能已被缩放展示，但仍然是 public_content/enc 资源；
                // 不以助手节点或固定尺寸作硬依赖。
                const isGeneratedResource = src.includes('/backend-api/estuary/') &&
                    !isAvatar && !isRawUpload && !isTiny &&
                    (w >= 500 || h >= 500 || src.includes('/public_content/enc/'));
                if (isGeneratedResource) {
                    const idMatch = src.match(/id=([^&]+)/) || src.match(/enc\\/([^?&#]+)/);
                    const fileId = idMatch ? idMatch[1] : src;
                    if (!map.has(fileId)) map.set(fileId, src);
                }
            });
            return Array.from(map.values());
        })()"""
        r_urls = await self.send_cmd("Runtime.evaluate", {"expression": js_get_urls, "returnByValue": True})
        img_urls = r_urls.get("result", {}).get("result", {}).get("value", [])
        if len(img_urls) < min(4, expected_count):
            # 页面图片懒加载/文案回复切换期间再读一次，避免把客户端已完成的图误判为失败。
            await asyncio.sleep(3)
            r_urls_retry = await self.send_cmd("Runtime.evaluate", {"expression": js_get_urls, "returnByValue": True})
            img_urls_retry = r_urls_retry.get("result", {}).get("result", {}).get("value", [])
            if len(img_urls_retry) > len(img_urls):
                img_urls = img_urls_retry
        if len(pre_copy_img_urls) > len(img_urls):
            log(f"回收阶段页面节点已收缩，采用出图轮询阶段保存的 {len(pre_copy_img_urls)} 张 URL 快照", self.id)
            img_urls = pre_copy_img_urls
        log(f"已捕获 {len(img_urls)} 张大图 URL，开始无损拉取...", self.id)

        # 7. 创建规范成品目录：第一时间落盘至 待制作待补全 创作区
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        clean_title = re.sub(r"^评\d+-赞\d+-", "", mat_name)
        clean_title = re.sub(r"[\s\-_]*\d{8}$", "", clean_title)
        clean_title = re.sub(r'[\\/:*?"<>|]', '_', clean_title).strip()[:50]
        pipe_info = get_pipeline_info(self.id)
        pkg_folder = f"{ts}-{pipe_info['pipeline']}-{clean_title}"
        # 用户确认的客户端模式第一落点：待制作待补全；未闭环作品留在此处可断点续接。
        producing_base = os.path.join(OUTPUT_BASE, "待制作待补全")
        os.makedirs(producing_base, exist_ok=True)
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

        # 9. 保存多版本/三端文案（支持 V4.5 11大排版指纹版本与 Format 3 向上兼容）
        # 剥离 UI 尾部免责声明与异常前缀
        _UI_FOOTERS = [
            r'ChatGPT\s*可能会出错[。，\.]*请核查重要信息[。，\.]*',
            r'最新一条回复',
            r'内容由\s*AI\s*生成[，。]*仅供参考',
            r'当前素材文件夹[：:][^\n]*',
        ]
        for _pat in _UI_FOOTERS:
            copy_text = re.sub(_pat, '', copy_text, flags=re.IGNORECASE).strip()
        if copy_text.startswith('ION_START:'):
            copy_text = '<<<VERS' + copy_text
        elif copy_text.startswith('VERSION_START:'):
            copy_text = '<<<' + copy_text
        # 如果末尾有未闭合的残缺 block，剔除末尾未闭合的残段
        _last_start = copy_text.rfind('<<<VERSION_START:')
        _last_end = copy_text.rfind('<<<VERSION_END>>>')
        if _last_start > _last_end:
            log(f"✂️ 剔除末尾未闭合的残缺版本块（起始于 {_last_start}，末尾闭合于 {_last_end}）", self.id)
            copy_text = copy_text[:_last_start].strip()

        full_copy = copy_text.strip()
        xhs_copy = ""
        hr_copy = ""
        douyin_copy = ""

        try:
            formatter_dir = r"d:\AICode\.agents\skills\copy-collab-distributor\scripts"
            if formatter_dir not in sys.path:
                sys.path.insert(0, formatter_dir)
            import copy_formatter

            # 截断安全检查
            is_trunc, trunc_reason = copy_formatter.check_truncation(copy_text)
            if is_trunc:
                log(f"⚠️ 【文案截断告警】检测到成稿末尾可能存在截断: {trunc_reason}", self.id)

            ok, formatted_copy, mode = copy_formatter.clean_entire_copy(copy_text, mobile_safe=True)
            if ok and formatted_copy:
                full_copy = formatted_copy
                log(f"✅ copy_formatter 自动二次清洗完成 (mode={mode})，全量注入防吞行盲文空格与单标题", self.id)
            else:
                # 🚨 旧代码在这条分支上静默保留客户端原文 ⇒ 标签外泄根因之一。
                log(f"🚨 【文案清洗未生效】copy_formatter 返回 ok={ok}，改由落盘出口守卫兜底，绝不落盘原文", self.id)
        except Exception as fe:
            log(f"🚨 【文案清洗未生效】copy_formatter 异常（{fe}），改由落盘出口守卫兜底，绝不落盘原文", self.id)

        # V4.5 客户端可能返回 11 个视觉版本（COPY_FORMAT:MULTI），但 AUTUMN-C
        # 对外交付固定只允许三平台 Format 3；先抽取三段标准版本，再落盘和验收。
        if "<<<COPY_FORMAT:3>>>" not in full_copy:
            def _extract_copy_version(text, tag):
                m = re.search(
                    r"<<<VERSION_START:\s*" + re.escape(tag) +
                    r"\s*>>>(.*?)<<<VERSION_END>>>", text, re.DOTALL
                )
                return m.group(1).strip() if m else ""

            _xhs_v3 = _extract_copy_version(full_copy, "原生种草") or _extract_copy_version(full_copy, "数字爆款")
            _hr_v3 = _extract_copy_version(full_copy, "决策矩阵") or _extract_copy_version(full_copy, "货架明细")
            _dy_v3 = _extract_copy_version(full_copy, "抖音避坑")
            if _xhs_v3 and _hr_v3 and _dy_v3:
                full_copy = (
                    "<<<COPY_FORMAT:3>>>\n\n"
                    f"<<<VERSION_START:原生种草>>>\n{_xhs_v3}\n<<<VERSION_END>>>\n\n"
                    f"<<<VERSION_START:决策矩阵>>>\n{_hr_v3}\n<<<VERSION_END>>>\n\n"
                    f"<<<VERSION_START:抖音避坑>>>\n{_dy_v3}\n<<<VERSION_END>>>"
                )
                log("✅ 已将客户端 MULTI 文案收敛为 AUTUMN-C Format 3 三平台交付", self.id)
            else:
                full_copy = full_copy.replace("<<<COPY_FORMAT:MULTI>>>", "<<<COPY_FORMAT:3>>>", 1)
                log("⚠️ MULTI 文案缺少标准版本，已保留主体并补齐 Format 3 标记", self.id)

        # 辅助提取向后兼容的单版本文本
        def extract_v(tag):
            m = re.search(r'<<<VERSION_START:\s*' + re.escape(tag) + r'\s*>>>(.*?)<<<VERSION_END>>>', full_copy, re.DOTALL)
            return m.group(1).strip() if m else ""

        xhs_copy = extract_v("数字爆款") or extract_v("原生种草")
        hr_copy = extract_v("决策矩阵") or extract_v("货架明细")
        douyin_copy = extract_v("抖音避坑")

        if not xhs_copy:
            m_xhs = re.search(r'<<<XHS_START>>>(.*?)<<<XHS_END>>>', full_copy, re.DOTALL)
            if m_xhs: xhs_copy = m_xhs.group(1).strip()
        if not hr_copy:
            m_hr = re.search(r'<<<XHS_2_START>>>(.*?)<<<XHS_2_END>>>', full_copy, re.DOTALL)
            if m_hr: hr_copy = m_hr.group(1).strip()
        if not douyin_copy:
            m_dy = re.search(r'<<<DOUYIN_START>>>(.*?)<<<DOUYIN_END>>>', full_copy, re.DOTALL)
            if m_dy: douyin_copy = m_dy.group(1).strip()

        # 9.5 【空文案/截断守卫】落盘前校验实质字数（剔除全部 <<<...>>> 标记、空白与盲文空格后计字），
        #     杜绝空壳作品入库：不达标即判废，删除半成品并抛错重做，与残缺画册阻断同模式。
        _substance = re.sub(r'<<<[^>]*>>>', '', full_copy)
        _substance = re.sub(r'[\s\u2800]+', '', _substance)
        MIN_COPY_SUBSTANCE = 300
        if len(_substance) < MIN_COPY_SUBSTANCE:
            # 【2026-09-22 修复·文案三病之一】判废必须真阻断，绝不再用本地模板兜底后
            # 静默入库。原实现在此处用「原料摘要拼三平台兜底模板」重新赋值 full_copy，
            # 然后照常走到归档+飞书交付 → 空壳/模板壳成品混进成品库。
            # 正确行为与残缺画册阻断（下方 valid_cnt < min_required 分支）同模式：
            # 删除半成品目录并抛 RuntimeError，交由 worker_loop 的 release_task_lock
            # 走「内容残缺类」标记（文案实质内容不足/文案截断/空壳）最多重试 3 次后隔离。
            log(f"🚨【空文案判废】文案实质内容仅 {len(_substance)} 字（要求 ≥ {MIN_COPY_SUBSTANCE} 字），"
                f"判定为空壳/截断产出，坚决不入库！废弃重做（最多自动重试 3 次后隔离）。", self.id)
            if os.path.exists(target_pkg_dir):
                import shutil
                shutil.rmtree(target_pkg_dir, ignore_errors=True)
            raise RuntimeError(f"文案实质内容不足（仅 {len(_substance)} 字 < {MIN_COPY_SUBSTANCE}），废弃重做")

        # 9.4 【落盘出口守卫】不论真源清洗是否生效，落盘前一律再兜一次：
        #     剥净 `标题：/正文：/话题：` 标签、假空行收敛为单个 U+2800，
        #     并断言实质内容与协议标记都没丢。真源失效时这里是最后一道闸门。
        _g_ok, _g_out, _g_rep = guard_copy_output(full_copy, tag=getattr(self, "id", ""))
        if _g_ok and _g_out:
            if _g_out != full_copy:
                log(f"🛡️ 出口守卫净化：剥离标签 {_g_rep.get('labels_removed', 0)} 处，"
                    f"实质 {_g_rep.get('subst_before')}→{_g_rep.get('subst_after')} 字", self.id)
            full_copy = _g_out
        else:
            log(f"🚨 【出口守卫拒绝】净化会丢内容或协议标记，保留原文入库但必须人工复核: {_g_rep}", self.id)
        if _g_rep.get("long_lines"):
            log(f"🚨 【出口守卫告警】仍有 {_g_rep['long_lines']} 行 ≥{MAX_COPY_LINE_LEN} 字未呼吸分段"
                f"（真源 split_long_paragraph 未生效？）", self.id)
        # 三平台单版本文本同样过闸（它们会各自单独落盘，供手机端按平台取用）
        _g_single = {}
        for _k, _v in (("xhs_copy", xhs_copy), ("hr_copy", hr_copy), ("douyin_copy", douyin_copy)):
            if not _v:
                continue
            _ok, _out, _r = guard_copy_output(_v, tag=f"{getattr(self, 'id', '')}/{_k}")
            if _ok and _out:
                _g_single[_k] = _out
            else:
                log(f"🚨 【出口守卫拒绝】{_k} 净化会丢内容，保留原文但必须人工复核: {_r}", self.id)
        xhs_copy = _g_single.get("xhs_copy", xhs_copy)
        hr_copy = _g_single.get("hr_copy", hr_copy)
        douyin_copy = _g_single.get("douyin_copy", douyin_copy)

        if xhs_copy:
            with open(os.path.join(target_pkg_dir, "小红书文案.txt"), "w", encoding="utf-8") as f:
                f.write(xhs_copy)
        if hr_copy:
            with open(os.path.join(target_pkg_dir, "HR方案决策版.txt"), "w", encoding="utf-8") as f:
                f.write(hr_copy)
        if douyin_copy:
            with open(os.path.join(target_pkg_dir, "抖音口播脚本.txt"), "w", encoding="utf-8") as f:
                f.write(douyin_copy)

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

        # 11. 终稿直接归档至成品库根目录（彻底取消已发送0次子目录）
        final_pkg_dir = os.path.join(OUTPUT_BASE, pkg_folder)

        # 12. 登记生图配额账本（3小时滑动窗口40张 + 全天180张）
        record_generation_success(self.id, valid_cnt, len(img_paths), mat_name)

        # 12. 固化 manifest.json
        manifest_data = {
            "title": mat_name,
            "created_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "pipeline": pipe_info["pipeline"],
            "worker": pipe_info["worker"],
            "account": pipe_info["account"],
            "tags": ["待发送", "小红书可发", "抖音可发"],
            "rawMaterialPath": mat_dir,
            "finishedProductPath": target_pkg_dir,
            "imageCount": valid_cnt,
            "status": "PASS",
            "lifecycleStatus": "IN_PROGRESS"
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
        # [2026-09-28 修] _作品历史数据 已被成品库重整归档进 _内部台账与历史数据，
        # 否则 exists() 守卫会静默跳过登记（每套成品都丢历史记录）。新家优先、老路径兜底。
        db_path = os.path.join(OUTPUT_BASE, "_内部台账与历史数据", "_作品历史数据", "作品历史数据库.json")
        if not os.path.exists(db_path):
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

        # 14. 同步追加飞书电子表格。
        # 【2026-09-25 修·"成品白扔"元凶之二】原逻辑：飞书写入失败 → 直接 raise →
        # 整套「图已出好 + 文案已写好 + Pillow 质检已通过 + 本地作品库已登记」的成品被判 failed，
        # 重试 3 次后连素材一起物理隔离。代价完全不成比例 —— 一个**外部台账**写不进去，
        # 不该销毁本地已经做完的实物。
        # 现改为「降级为待补登」：成品照常计入成功账本并留在成品库，只把飞书登记挂进本地
        # 补登队列（feishu_pending_append.jsonl），同时直接推运维群告警，事后可批量补写。
        feishu_sheet_result = append_to_feishu_sheet(DAEMON_STATE["completed_total"] + 1, mat_dir, target_pkg_dir)
        feishu_sheet_ok = bool(feishu_sheet_result[0]) if isinstance(feishu_sheet_result, tuple) else bool(feishu_sheet_result)
        feishu_row_mat = feishu_sheet_result[1] if isinstance(feishu_sheet_result, tuple) else None
        feishu_row_fin = feishu_sheet_result[2] if isinstance(feishu_sheet_result, tuple) else None
        if not feishu_sheet_ok:
            _pend_path = os.path.join(r"D:\AICode", "运行数据", "feishu_pending_append.jsonl")
            try:
                os.makedirs(os.path.dirname(_pend_path), exist_ok=True)
                with open(_pend_path, "a", encoding="utf-8") as _pfh:
                    _pfh.write(json.dumps({
                        "ts": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "instance": self.id,
                        "total_num": DAEMON_STATE["completed_total"] + 1,
                        "mat_dir": mat_dir,
                        "pkg_dir": target_pkg_dir,
                        "reason": "飞书表格写入失败，降级待补登"
                    }, ensure_ascii=False) + "\n")
                log(f"📝 已挂入飞书待补登队列: {_pend_path}", self.id)
            except Exception as _pe:
                log(f"写入飞书待补登队列失败: {_pe}", self.id)
            log(f"⚠️ 飞书表格登记失败 → 降级为「待补登」，成品照常入库，不再判废丢弃", self.id)
            try:
                send_feishu_markdown(
                    f"⚠️【飞书台账待补登】\n"
                    f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                    f"⚙️ **生产实例**：{self.id}\n"
                    f"⏱ **时刻**：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                    f"📦 **作品**：{mat_name}\n"
                    f"📁 **成品目录**：{target_pkg_dir}\n"
                    f"❗ **原因**：飞书表格写入失败（**作品本身已完成，未丢弃**）\n"
                    f"📝 **补登队列**：{_pend_path}\n"
                    f"💡 本地成品完整可用；补登队列里挂了一条，事后可批量补写飞书表。",
                    FEISHU_OPS_CHAT_ID)
            except Exception as _ne:
                log(f"待补登告警推送失败（不影响成品入库）: {_ne}", self.id)

        # 15. 飞书群通知推送（双绝对路径 + 原素材清单 + 成品大图清单 + Pillow质检 + 文案速览 + 表格链接）
        total_num = DAEMON_STATE["completed_total"] + 1
        feishu_notice_ok = False
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

            account_alias = get_account_alias(self.id)
            safe_target_pkg_url = "file:///" + final_pkg_dir.replace("\\", "/")
            safe_mat_url = "file:///" + mat_dir.replace("\\", "/")
            direct_sheet_url = SPREADSHEET_URL
            if feishu_row_mat and feishu_row_fin:
                direct_sheet_url = f"{SPREADSHEET_URL}&range=A{feishu_row_mat}:V{feishu_row_fin}"

            feishu_md = (
                f"🎉 **【秋季素材交付 · 客户端模式（直接对话框）】**\n\n"
                f"• **作品标题**：{mat_name[:50]}\n"
                f"• **生产模式**：客户端模式（直接对话框）（实例 {self.id} · {account_alias}）\n"
                f"• **图文交付**：{valid_cnt} 张 3:4 竖屏高清大图 + 3 端文案（小红书/HR决策/抖音）\n"
                f"• **质检验收**：100% 通过 Pillow 像素级与长宽比校验，无损入库\n"
                f"• **成品路径**：[📂 点击打开成品文件夹]({safe_target_pkg_url})\n"
                f"• **原素材参考**：[📁 查看原素材文件夹]({safe_mat_url})\n"
                f"• **飞书台账**：已登记第 {feishu_row_mat or '?'}–{feishu_row_fin or '?'} 行（[点击直达本套记录]({direct_sheet_url})）\n\n"
                f"📊 **【秋季素材包】全盘战况**：\n"
                f"• 本地成品总数：已累计 **{cur_count} 套**\n"
                f"• 秋季素材进度：已完成 **{cur_count} / 781 套**\n"
                f"• 下一步计划：继续制作下一个秋季选题，全部完成后开启冬季素材库。"
            )
            ok = send_feishu_markdown(feishu_md)
            feishu_notice_ok = ok
            if ok:
                log("-> 飞书交付验收通知推送群聊成功！", self.id)
            else:
                log("-> 飞书通知发送失败", self.id)
        except Exception as fe:
            log(f"-> 飞书通知发送异常: {fe}", self.id)
        if not feishu_notice_ok:
            raise RuntimeError("飞书群完成通知发送失败，作品保留在制作态并标记 failed")

        # 16. 飞书表格与群通知均成功后，才原子归档直接移入成品库根目录。
        try:
            import shutil
            if os.path.exists(final_pkg_dir):
                shutil.rmtree(final_pkg_dir, ignore_errors=True)
            shutil.move(target_pkg_dir, final_pkg_dir)
            target_pkg_dir = final_pkg_dir
            manifest_data["finishedProductPath"] = target_pkg_dir
            manifest_data["lifecycleStatus"] = "COMPLETED"
            with open(os.path.join(target_pkg_dir, "manifest.json"), "w", encoding="utf-8") as f:
                json.dump(manifest_data, f, ensure_ascii=False, indent=2)
            if feishu_row_fin:
                cmd_path = [
                    "node", LARK_RUN_JS, "sheets", "+cells-set",
                    "--profile", FEISHU_STORAGE_PROFILE, "--as", "user",
                    "--spreadsheet-token", SPREADSHEET_TOKEN,
                    "--sheet-id", SPREADSHEET_SHEET_ID,
                    "--range", f"B{feishu_row_fin}",
                    "--cells", json.dumps([[{"value": target_pkg_dir}]], ensure_ascii=False)
                ]
                subprocess.run(cmd_path, capture_output=True, text=True, encoding="utf-8", timeout=30)
            log(f"-> 飞书闭环完成，已原子归档至成品库根目录: {target_pkg_dir}", self.id)
        except Exception as e_mv:
            raise RuntimeError(f"飞书闭环后归档移动失败: {e_mv}")

        # 16. 桌面液态玻璃通知（静默模式已停用，保持屏幕清静）
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

# 领取任务前的本地计划门禁：先读取素材并落盘计划，再允许客户端上传与生图。
def ensure_autumn_c_production_plan(item):
    mat_path = item["path"]
    mat_name = item.get("name") or os.path.basename(mat_path)
    safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', mat_name).strip()[:110]
    plan_root = os.path.join(OUTPUT_BASE, "待制作待补全")
    plan_dir = os.path.join(
        plan_root,
        f"{datetime.datetime.now().strftime('%Y%m%d')}_网页CDP-AUTUMN-C-{safe_name}"
    )
    os.makedirs(plan_dir, exist_ok=True)
    plan_path = os.path.join(plan_dir, "production_plan.md")
    image_exts = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
    image_files = [
        f for f in os.listdir(mat_path)
        if os.path.isfile(os.path.join(mat_path, f))
        and os.path.splitext(f)[1].lower() in image_exts
    ]
    def natural_key(name):
        return [int(x) if x.isdigit() else x.lower() for x in re.split(r'(\d+)', name)]
    image_files.sort(key=natural_key)
    planned = min(len(image_files), 10)
    copy_preview = ""
    copy_path = os.path.join(mat_path, "文案.txt")
    if os.path.exists(copy_path):
        try:
            with open(copy_path, "r", encoding="utf-8") as cf:
                copy_preview = cf.read()[:1200].strip()
        except Exception:
            copy_preview = "（原文案读取失败，生产时按素材画面与标签补齐）"
    page_lines = []
    for idx, filename in enumerate(image_files[:planned], start=1):
        role = "封面" if idx == 1 else f"内页 {idx - 1}"
        page_lines.append(f"  - P{idx}.png（{role}，参考原图 `{filename}`）")
    plan_text = (
        f"# AUTUMN-C 生产计划｜{mat_name}\n\n"
        f"- 任务 index：{item.get('index', '')}\n"
        f"- 原料路径：`{mat_path}`\n"
        f"- 生产模式：客户端模式（直接对话框），由 Cockpit 在可用的 A/C 客户端实例中自动路由，不固定账号，不调用图片 API。\n"
        f"- 原料图数：{len(image_files)}；计划输出：{planned} 页（客户端模式单套最多 10 页）。\n"
        f"- 生成规格：每页 1086×1448，P1 为封面，文件名 P1.png…P{planned}.png。\n\n"
        "## 页面计划\n" + ("\n".join(page_lines) if page_lines else "（未发现可用原料图，禁止进入生图）") + "\n\n"
        "## 统一视觉与合规门禁\n"
        "- 保持原版式结构、文字层气质、色块和标签位置；照片分区执行无固定点置换。\n"
        "- 彻底换人、换脸、发型、服装、动作、视线、机位与道具，保持自然手机纪实抓拍，拒绝统一看镜头与 HDR 网红脸。\n"
        "- 相邻照片边界必须自然贴合，严禁白线、白缝、白边、透明条、漏缝、发光接缝、空隙或背景露白；发现必须重做该页。\n"
        "- 团队规模统一写“10人起”；删除“私信、加微信、扫码、联系我们”等强导流词。\n"
        "- 文案必须包含 `<<<COPY_FORMAT:3>>>`，涵盖小红书自然攻略版、小红书 HR 决策版、抖音玩法/避坑版。\n\n"
        "## 原素材文案摘要\n" + (copy_preview or "（无文案摘要，按图片与任务标签读取）") + "\n"
    )
    if not os.path.exists(plan_path):
        tmp_path = plan_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as pf:
            pf.write(plan_text)
        os.replace(tmp_path, plan_path)
    return plan_path

# 任务声明锁：防止两个实例抢同一个素材
LOCK = asyncio.Lock()

async def claim_next_task(worker_id):
    async with LOCK:
        # 【2026-09-27 新增】先放生超时孤儿锁，再扫队列，否则僵尸「生产中」永远占位
        try:
            release_stale_production_locks()
        except Exception as _e_sl:
            log(f"孤儿锁巡检异常（不阻断）: {_e_sl}")
        queue = scan_pending_queue()
        DAEMON_STATE["queue_remaining"] = len(queue)
        sync_daemon_state()
        for item in queue:
            tags_file = os.path.join(item["path"], ".tags.json")
            try:
                plan_path = ensure_autumn_c_production_plan(item)
                tdata = {}
                if os.path.exists(tags_file):
                    with open(tags_file, 'r', encoding='utf-8') as f:
                        tdata = json.load(f)
                state = tdata.get("production", {}).get("lifecycleState", "待生产")
                # 【2026-09-26 修·节奏风控】失败退池的素材带 cooldownUntil 冷却期，
                # 冷却期内严禁再次领取提交——否则同一套素材 60~90 秒一轮死循环猛刷
                # （09-26 实测 OC Card 单账号一天 341 次生产启动），直接触发平台风控。
                _cd_until = (tdata.get("production") or {}).get("cooldownUntil")
                if _cd_until:
                    try:
                        if datetime.datetime.now() < datetime.datetime.strptime(str(_cd_until), "%Y-%m-%d %H:%M:%S"):
                            continue
                    except Exception:
                        pass
                if state not in ["已生产", "生产中"]:
                    prod = tdata.setdefault("production", {})
                    prod["lifecycleState"] = "生产中"
                    prod["lockedBy"] = f"Instance-{worker_id}"
                    prod["lockedAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    prod["productionMode"] = "客户端模式（直接对话框）"
                    prod["planPath"] = plan_path
                    with open(tags_file, 'w', encoding='utf-8') as f:
                        json.dump(tdata, f, ensure_ascii=False, indent=2)
                    item["planPath"] = plan_path
                    return item
            except Exception:
                continue
    return None

async def release_task_lock(mat_path, error_msg=None, is_quota_wait=False, instance_id=None):
    async with LOCK:
        abnormal_root = os.path.join(MATERIAL_DIR, "..", "_异常素材（脚本失败隔离）")
        os.makedirs(abnormal_root, exist_ok=True)
        tags_file = os.path.join(mat_path, ".tags.json")
        if os.path.exists(tags_file):
            try:
                with open(tags_file, 'r', encoding='utf-8') as f:
                    tdata = json.load(f)
                prod = tdata.setdefault("production", {})
                error_text = str(error_msg or "")
                prev_retry = prod.get("retryCount", 0)
                transport_markers = (
                    "CDP", "Runtime.evaluate", "evaluate", "WebSocket", "连接失败",
                    # 【2026-09-26 修·措辞对不上导致误隔离】抛出的原文是
                    # 「端口 943X 未找到可连接的 ChatGPT 页面！」，而这里写的是完整短语
                    # 「未找到可连接的页面」，多出 "ChatGPT" 三字 → 匹配不上 → 判为素材缺陷 → 物理隔离。
                    # 实测 09-26 21:05 莫干山素材即因此被误隔离（明明只是 CDP 抖动）。
                    # 改为前缀模糊匹配，任何变体都归为环境类。
                    "未找到可连接", "未获网页提交确认", "静默未响应", "Timeout",
                    "有效大图不足", "拉取大图 URL 数量不足", "未返回大图", "残缺画册阻断",
                    "客户端附件挂载失败", "附件挂载失败",
                    "未找到文件上传 DOM 节点",
                    "Cannot connect", "WinError", "closed",
                    # 【2026-09-22】以下为「内容残缺类」可重试标记：从调用方的
                    # is_connection_error 白名单合并进来，语义不变（最多重试 3 次后隔离）。
                    "文案实质内容不足", "文案截断", "空壳",
                    # 【2026-09-23】飞书表格写入失败（并发冲突 code=4 等）绝不可立刻物理隔离：
                    # 此时大图已保存、文案已入库、作品历史库与配额账本均已记账，
                    # 直接隔离等于把做出来的成品连同素材一起丢弃，且隔离对象还会因索引漂移错配
                    # （实测：A 生产桐庐团建，隔离的却是宁波团建）。
                    # 归入可重试类：最多重试 3 次，给飞书登记留出补救窗口。
                    "飞书表格写入失败"
                )
                # 【2026-09-25 修·「好素材被批量误伤」的元凶】
                # 门槛抛的是「客户端附件仅挂载 2/6 张（低于最低门槛 3），拒绝提交以避免产物残缺」，
                # 而 transport_markers 白名单里只有「客户端附件挂载失败 / 附件挂载失败」这两个精确词，
                # **措辞对不上** → safe_retry=False → 素材被直接物理隔离。
                # 实测 09-25 因此误伤多套好素材（07:03 赏秋、07:41 桐庐…）。
                # 判定：附件挂载不足是**页面/上传通道问题**，与素材质量无关，隔离它解决不了任何问题。
                # 处置：不计入素材重试次数（单独计 clientFailCount），给足 8 次机会后才考虑隔离。
                _CLIENT_ATTACH_MARKERS = ("客户端附件仅挂载", "客户端附件挂载失败", "附件挂载失败")
                if is_quota_wait:
                    # 【2026-09-22 修】官方配额耗尽是账号级临时状态，不是素材缺陷：
                    # 不计入重试次数、永不隔离（冷却结束后同一素材必然能成功）。
                    # 实测误伤：舟山素材因 2 次 CDP 抖动 + 第 3 次配额熔断累计到 3 次被隔离。
                    retry_cnt = prev_retry
                    safe_retry = True
                elif (not error_text.strip()) or any(_m in error_text for _m in (
                        # 页面/CDP 连接类
                        "未找到可连接", "未找到文件上传 DOM 节点",
                        # 传输超时与断连类（实测原文就是 "timed out" / 空串）
                        "timed out", "CDP 重连后仍失败", "Runtime.evaluate",
                        "WebSocket", "断开", "连接失败", "Cannot connect",
                        "WinError", "closed", "端口", "Timeout")):
                    # 【2026-09-26 修·CDP 环境类故障绝不连坐素材】
                    # 「端口未找到可连接的 ChatGPT 页面」纯属浏览器/CDP 侧抖动，与素材好坏毫无关系，
                    # 之前却要跟素材一起累计 retryCount，抖 3 次就把好素材物理隔离（莫干山实测）。
                    # 单独计 envFailCount（跨天重置、给 8 次机会），素材重试次数一律不动。
                    retry_cnt = prev_retry
                    _efc = int(prod.get("envFailCount", 0)) + 1
                    _last_env_date = str(prod.get("lastEnvFailAt", ""))[:10]
                    if _last_env_date and _last_env_date != datetime.datetime.now().strftime("%Y-%m-%d"):
                        _efc = 1
                    prod["envFailCount"] = _efc
                    prod["lastEnvFailAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    safe_retry = _efc < 8
                    log(f"🔌 本次失败归类为「CDP/页面级环境抖动」（第 {_efc} 次）："
                        f"不计素材重试次数、不隔离，素材安全退回待生产池")
                elif any(_m in error_text for _m in _CLIENT_ATTACH_MARKERS):
                    retry_cnt = prev_retry
                    _cfc = int(prod.get("clientFailCount", 0)) + 1
                    # 【2026-09-26 修】clientFailCount 跨天自动清零：页面级故障（如灰度版前端
                    # 提交/上传被吞）可能持续一整天，跨天累计会把同一天内反复失败的素材
                    # 在次日首轮就顶到 8 次上限直接隔离（09-26 12:00~13:00 实测误隔离 30 套）。
                    # 页面故障隔天应重新给满机会，环境恢复后素材自然复产。
                    _last_fail_date = str(prod.get("lastFailedAt", ""))[:10]
                    _today_str = datetime.datetime.now().strftime("%Y-%m-%d")
                    if _last_fail_date and _last_fail_date != _today_str:
                        _cfc = 1
                        log(f"🔄 素材 clientFailCount 跨天重置（上次失败 {_last_fail_date}）", self.id)
                    prod["clientFailCount"] = _cfc
                    safe_retry = _cfc < 8
                    log(f"🧩 本次失败归类为「客户端附件挂载不足」（第 {_cfc} 次）："
                        f"不计素材重试次数、不隔离，素材安全退回待生产池")
                else:
                    retry_cnt = prev_retry + 1
                    safe_retry = (
                        not error_text.strip()
                        or any(marker in error_text for marker in transport_markers)
                        or isinstance(error_msg, (ConnectionError, TimeoutError, OSError))
                    )
                    # 同一素材的客户端/CDP/挂载异常最多自动重试 3 次；超过后立即隔离，
                    # 避免“标记失败但又无限领取同一素材”烧空客户端额度。
                    safe_retry = safe_retry and retry_cnt < 3
                # 【2026-09-27 修·脚本自身的 bug 不该让素材陪葬】
                # 实测：我修判据时漏传一个格式化参数 → "not enough arguments for format string"，
                # 这类**纯脚本层异常**跟素材质量毫无关系，却因不在 transport_markers 白名单里
                # 被当成"素材缺陷" → 好素材被物理搬进隔离区（一晚上已误伤多套，且搬走后
                # 白名单与实际路径错位，人工找回来极麻烦）。
                # 处置：识别出脚本/环境类异常时强制走安全重试，**绝不物理隔离**。
                _script_err_markers = (
                    "not enough arguments", "not all arguments", "Traceback",
                    "TypeError", "SyntaxError", "NameError", "KeyError",
                    "AttributeError", "ValueError", "IndexError",
                    "format string", "IndentationError", "ZeroDivisionError",
                )
                if any(m in error_text for m in _script_err_markers):
                    log(f"🛑 识别为脚本层异常（非素材缺陷），拒绝物理隔离，改走安全重试: {error_text[:80]}")
                    safe_retry = True
                if safe_retry:
                    prod["lifecycleState"] = "待生产"
                    prod.pop("lockedBy", None)
                    prod.pop("lockedAt", None)
                    # 【2026-09-26 修·节奏风控】失败退池一律带 30 分钟冷却：
                    # 保证"上一套完全落地后才提交下一套"的节奏，杜绝同账号
                    # 高频重试触发平台风控（OC Card 341 次/天事故）。
                    prod["cooldownUntil"] = (datetime.datetime.now() + datetime.timedelta(minutes=30)).strftime("%Y-%m-%d %H:%M:%S")
                    prod["retryCount"] = retry_cnt
                    prod["lastError"] = error_text or "网页客户端/CDP 未返回具体错误"
                    prod["lastFailedAt"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    with open(tags_file, 'w', encoding='utf-8') as f:
                        json.dump(tdata, f, ensure_ascii=False, indent=2)
                else:
                    # 凡触发报错或拦截的素材，严禁在待生产池死循环争抢，直接物理隔离！
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

                    # [2026-09-24 新增] 物理隔离此前只写本地日志、从不推送飞书，
                    # 导致素材被移出队列时运维群「零感知」（实测当晚 2 次隔离，群里一条消息都没有）。
                    # 这里补上隔离告警；推送失败绝不影响隔离动作本身。
                    try:
                        _iq = -1
                        try:
                            _iq = len([d for d in os.listdir(abnormal_root)
                                       if os.path.isdir(os.path.join(abnormal_root, d))])
                        except Exception:
                            _iq = -1
                        _err_txt = (str(error_msg)[:160] if error_msg else "未知异常")
                        send_feishu_markdown(
                            f"🚨【双浏览器流水线 · 素材被物理隔离】\n"
                            f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                            f"⚙️ **生产实例**：实例 {instance_id or '未知'}\n"
                            f"⏱ **隔离时刻**：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                            f"📦 **素材**：{parent_name}_{base_name}\n"
                            f"🔁 **本素材状态**：已重试 {retry_cnt} 次后仍失败\n"
                            f"❌ **失败原因**：{_err_txt}\n"
                            f"📁 **去向**：{target_abnormal}\n"
                            f"📊 **隔离区当前积压**：{_iq if _iq >= 0 else '统计失败'} 条\n"
                            f"💡 该素材已移出待生产队列（不会自动回队）。若判定为误隔离，可走素材回队流程手动恢复。",
                            FEISHU_OPS_CHAT_ID)
                    except Exception as _e_qn:
                        log(f"隔离告警推送失败（不影响隔离动作）: {_e_qn}")
            except Exception as e_lock:
                log(f"处理任务锁与隔离异常: {e_lock}")


async def worker_loop(instance_id, cdp_port):
    worker = InstanceWorker(instance_id, cdp_port)
    log(f"实例 {instance_id} 工作协程启动...", instance_id)

    while True:
        # [2026-09-26 新增] 人工急停：开关存在即原地挂起（不领料/不上传/不提交），进程保持存活
        _halt, _halt_reason, _halt_exp = read_halt_flag()
        if _halt:
            try:
                DAEMON_STATE["instances"][instance_id]["state"] = "HALTED"
                DAEMON_STATE["instances"][instance_id]["current_package"] = None
                sync_daemon_state()
            except Exception:
                pass
            log(f"🛑 已挂起（人工急停）：{_halt_reason}（生效至 {_halt_exp or '手动解除'}），本实例不领料不提交，等待开关解除...", instance_id)
            await asyncio.sleep(15)
            continue
        task = None
        try:
            # [2026-09-24 修] today_str 此前在本函数内从未定义（仅在另外两个函数里有局部赋值），
            # 一旦走到这里就是 NameError -> 整个「每日 180 张 / 3 小时 40 张」双重守门被跳过，
            # 于是实例会一路生产到撞官方 Plus 上限为止（表现为一天连撞 4 次限额）。
            # 且该异常会被下方 except 吞掉，日志只留一条"执行异常"，极难定位。
            # 这里每轮循环重新取当天日期，保证跨自然日时日配额能正确归零。
            today_str = datetime.datetime.now().strftime("%Y-%m-%d")
            # 1. 单账号每日 180 张主动安全巡航与 3 小时 40 张滑动窗口双重守门
            dq = DAEMON_STATE.setdefault("daily_quota", {"date": today_str})
            if dq.get("date") != today_str:
                dq["date"] = today_str
                for k in list(dq.keys()):
                    if k != "date":
                        dq[k] = 0
                for inst_k in DAEMON_STATE.get("instances", {}):
                    DAEMON_STATE["instances"][inst_k]["cruise_card_sent"] = False
                    # 官方撞限次数同样按自然日归零（供巡航达成战报如实渲染，不再印死"0 撞线"）
                    DAEMON_STATE["instances"][inst_k]["quota_hits_today"] = 0
            dq.setdefault(instance_id, 0)

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
                        # 【2026-09-26 新增·用户指令】长休眠（≥15 分钟）就把实例关掉省内存，
                        # 到点前 3 分钟自动拉起。同一个 resume_at 只回收一次，避免反复关开。
                        _rc_key = f"{instance_id}|{resume_at_str}"
                        if wait_sec >= COOLDOWN_RECYCLE_MIN_SEC and _rc_key not in INSTANCE_RECYCLED:
                            INSTANCE_RECYCLED.add(_rc_key)
                            await recycle_instance_for_cooldown(instance_id, cdp_port, wait_sec)
                            continue
                        await asyncio.sleep(min(wait_sec, 60))
                        continue
                    else:
                        log(f"🔔 实例 {instance_id} 到达预定恢复时刻 {resume_at_str}，先做复工探额，再决定是否满功率...", instance_id)
                        DAEMON_STATE["instances"][instance_id]["resume_at"] = None
                        DAEMON_STATE["instances"][instance_id]["state"] = "IDLE"
                        sync_daemon_state()

                        # [2026-09-24 新增] 「先探额度再满功率」保险（用户拍板）：
                        # 到点先零消耗读一次官方额度条。若仍在限流 → 按官方提示继续精确休眠，
                        # 彻底根治「醒来即空转烧额度 / 醒来即再撞限」。
                        _still_limited, _probe_sec, _probe_detail = False, 0, ""
                        try:
                            _still_limited, _probe_sec, _probe_detail = await probe_quota_banner(cdp_port)
                        except Exception as _e_probe:
                            _probe_detail = "探针异常(%s)，按放行处理" % str(_e_probe)[:40]

                        if _still_limited:
                            _back = int(_probe_sec) + 900          # 探针结论上再补 15 分钟冗余
                            _rdt = datetime.datetime.now() + datetime.timedelta(seconds=_back)
                            _rstr = _rdt.strftime("%Y-%m-%d %H:%M:%S")
                            DAEMON_STATE["instances"][instance_id]["resume_at"] = _rstr
                            DAEMON_STATE["instances"][instance_id]["state"] = "QUOTA_SLEEPING"
                            sync_daemon_state()
                            log(f"🧪【复工探额】实例 {instance_id} 到点但官方额度条仍限流（{_probe_detail}），"
                                f"继续精确休眠至 {_rstr}", instance_id)
                            try:
                                _alias_p = get_account_alias(instance_id)
                                _rh = _back // 3600
                                _rm = (_back % 3600) // 60
                                send_feishu_markdown(
                                    f"🧪【双浏览器流水线 · 实例 {instance_id} 复工探额：仍在限流，继续休眠】\n"
                                    f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                                    f"⚙️ **生产实例**：实例 {instance_id}（{_alias_p} · CDP 端口 {cdp_port}）\n"
                                    f"⏰ **原定复工时刻**：{resume_at_str}（已到点，但探针否决）\n"
                                    f"🔍 **探针结论**：{_probe_detail}\n"
                                    f"🛡️ **处置**：不消耗任何额度，继续精确休眠至 **{_rstr}**（约 {_rh} 小时 {_rm} 分钟）\n"
                                    f"💡 这就是「先探额度再满功率」保险：避免醒来即空转烧额度、醒来即再撞限。",
                                    FEISHU_OPS_CHAT_ID)
                            except Exception as _e_rc:
                                log(f"复工探额通知推送失败（不影响休眠）: {_e_rc}", instance_id)
                            await asyncio.sleep(min(_back, 60))
                            continue

                        log(f"🔔 实例 {instance_id} 复工探额通过（{_probe_detail}），放开满功率生产！", instance_id)
                        # [2026-09-24 修] 熔断卡片上一直写着"到达准点时刻会自动在群内推送解冻提醒"，
                        # 但这里此前只打了一行本地日志、**从未真正推送** —— 属于模板承诺了、代码没实现。
                        # 现在补齐解冻复工通知（推送失败不影响复工流程）。
                        try:
                            _alias = get_account_alias(instance_id)
                            _inst = DAEMON_STATE["instances"].get(instance_id, {})
                            resume_md = (
                                f"🔔【双浏览器流水线 · 实例 {instance_id} 已解除官方限额休眠，恢复生产】\n"
                                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                                f"⚙️ **生产实例**：实例 {instance_id}（{_alias} · CDP 端口 {cdp_port}）\n"
                                f"⏰ **复活时刻**：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
                                f"📅 **原定解冻时刻**：{resume_at_str}\n"
                                f"🔁 **本日撞限次数**：{int(_inst.get('quota_hits_today') or 0)} 次\n"
                                f"🚀 **当前动作**：已自动唤醒，开始续接待生产任务，全程免人工值守。"
                            )
                            send_feishu_markdown(resume_md, FEISHU_OPS_CHAT_ID)
                        except Exception as _e_resume:
                            log(f"解冻复工通知推送失败（不影响复工）: {_e_resume}", instance_id)
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
                    account_alias = get_account_alias(instance_id)
                    total_done = DAEMON_STATE.get("completed_total", 72)
                    # 【2026-09-22 修】原模板写死「0 撞线 · 0 废单 · 0 封控」，无论当天是否真的
                    # 撞过官方上限都这么印 —— B 实例 12:41 已撞限，15:49 的战报仍宣称 0 撞线，
                    # 属于会永久污染群记录的硬编码。改为按当日实际撞限次数如实渲染。
                    inst_snap = DAEMON_STATE["instances"][instance_id]
                    hits = int(inst_snap.get("quota_hits_today") or 0)
                    # 注：此处 resume_at 必然是空（官方休眠未结束的分支会在上方 continue，走不到这里），
                    # 故不再渲染"最近一次冷却至…"，只报当日实际撞限次数。
                    if hits == 0:
                        quota_line = "本地安全线主动刹车，本日未触及官方额度上限"
                    else:
                        quota_line = (f"⚠️ 本地安全线主动刹车，但**本日已触及官方额度上限 {hits} 次**"
                                      f"（详见本群配额熔断卡片）")
                    report_md = (
                        f"🛡️ **【双浏览器流水线 · 实例 {instance_id} 主动安全巡航达成战报】**\n"
                        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                        f"👤 **生产账号**：{account_alias} (CDP 端口 {cdp_port})\n"
                        f"🎯 **今日出图战果**：已安全出图 **{stats['gen_today']} 张**（该账号全天安全巡航线 {stats['max_today']} 张）\n"
                        f"🛡️ **主动隔离机制**：{quota_line}\n"
                        f"📊 **画册大盘沉淀**：双线连续稳定交付 **{total_done} 套** 高清画册作品\n"
                        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                        f"⏰ **巡航调度状态**：实例 {instance_id} 已优雅进入安全守护休眠\n"
                        f"💡 **后续动作**：待次日额度周期自动重置，系统将无缝续接开工，100% 免人工介入！"
                    )
                    send_feishu_markdown(report_md)
                # 【2026-09-26 新增·用户指令】生图配额休眠（常达数小时）→ 关实例省内存，到点前自动拉起。
                # 同一段休眠（按 10 分钟粒度归并）只回收一次，避免反复关开。
                _qrc_key = f"{instance_id}|genquota|{wait_sec // 600}"
                if wait_sec >= COOLDOWN_RECYCLE_MIN_SEC and _qrc_key not in INSTANCE_RECYCLED:
                    INSTANCE_RECYCLED.add(_qrc_key)
                    await recycle_instance_for_cooldown(instance_id, cdp_port, wait_sec)
                    continue
                await asyncio.sleep(min(wait_sec, 60))
                continue

            await worker.connect()
            task = await claim_next_task(instance_id)
            if not task:
                await worker.close()
                log("队列暂无可用素材，休眠 30 秒...", instance_id)
                DAEMON_STATE["instances"][instance_id]["state"] = "IDLE"
                DAEMON_STATE["instances"][instance_id]["current_package"] = None
                sync_daemon_state()
                await asyncio.sleep(30)
                continue

            DAEMON_STATE["instances"][instance_id]["state"] = "PRODUCING"
            DAEMON_STATE["instances"][instance_id]["current_package"] = task["name"]
            sync_daemon_state()

            output_dir, valid_cnt = await worker.produce_single_set(task)
            await worker.close()
            update_autumn_c_progress(task, "success", output_dir, valid_cnt)

            DAEMON_STATE["completed_total"] += 1
            DAEMON_STATE["last_completed"] = {
                "instance": instance_id,
                "product_path": output_dir,
                "material_path": task["path"],
                "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            # 成功一套 → 该产线的连续失败计数清零
            INSTANCE_FAIL_STREAK[instance_id] = 0
            DAEMON_STATE["instances"][instance_id]["state"] = "SUCCESS"
            dq[instance_id] = dq.get(instance_id, 0) + valid_cnt
            DAEMON_STATE["instances"][instance_id]["today_images"] = dq[instance_id]
            sync_daemon_state()

            log(f"生产成功，实例 {instance_id} 今日累计已出图 {dq[instance_id]} 张，冷却 15 秒后领取下一套...", instance_id)
            await asyncio.sleep(15)

        except QuotaLimitException as qe:
            # 【2026-09-23 修】qe.wait_seconds / qe.resume_dt 已在抛出处按「滚动恢复」递增加码，
            # 此处直接使用加码后的时长与时间点，无需二次处理。
            log(f"🛑 实例 {instance_id} 触发配额限额，进入自愈挂起（预计恢复时间: {qe.resume_dt.strftime('%Y-%m-%d %H:%M:%S')}）", instance_id)
            if 'task' in locals() and task:
                await release_task_lock(task["path"], is_quota_wait=True, instance_id=instance_id)
            await worker.close()
            DAEMON_STATE["instances"][instance_id]["state"] = "QUOTA_SLEEPING"
            DAEMON_STATE["instances"][instance_id]["current_package"] = None
            DAEMON_STATE["instances"][instance_id]["resume_at"] = qe.resume_dt.strftime("%Y-%m-%d %H:%M:%S")
            # 记录当日官方撞限次数（供后续「巡航达成战报」如实渲染；按自然日归零）
            _inst = DAEMON_STATE["instances"][instance_id]
            _inst["quota_hits_today"] = int(_inst.get("quota_hits_today") or 0) + 1
            sync_daemon_state()

            # 精准长休眠挂起
            await asyncio.sleep(qe.wait_seconds)

            # 到达时间点，自动发送飞书提醒卡片
            wakeup_now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            log(f"🔔 实例 {instance_id} 到达解冻时刻，自动唤醒复工！", instance_id)
            DAEMON_STATE["instances"][instance_id]["state"] = "IDLE"
            DAEMON_STATE["instances"][instance_id]["resume_at"] = None
            sync_daemon_state()

            account_alias = get_account_alias(instance_id)
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
                f"🚀 **【秋季素材开工 · 客户端模式（直接对话框）】**\n\n"
                f"• **生产模式**：客户端模式（直接对话框）（实例 {instance_id} · {account_alias}）\n"
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
            if "未登录状态" in str(e):
                log(f"⏸️ 实例 {instance_id} 尚未登录 ChatGPT，已安全挂起静默等待（每 60 秒自动复检），不影响其他在线产线！", instance_id)
                DAEMON_STATE["instances"][instance_id]["state"] = "UNAUTHENTICATED"
                sync_daemon_state()
                await worker.close()
                await asyncio.sleep(60)
                continue
            log(f"执行异常: {e}", instance_id)
            if 'task' in locals() and task:
                # 【2026-09-22 修】原写法把「传输类错误」算成 is_quota_wait=True 再传下去。
                # 在「配额豁免永不隔离」改动之后，这等于让传输类错误也拿到永久豁免：
                # 坏素材会无限重取、烧空官方生图额度，3 次上限这一道安全阀被绕过。
                # 正确做法：only 真·配额耗尽（QuotaLimitException 分支）才传配额豁免；
                # 传输/内容残缺类错误的可重试性由 release_task_lock 内的 transport_markers
                # 判定，且一律仍受「同一素材最多自动重试 3 次」约束。
                update_autumn_c_progress(task, "failed", None, 0, e)
                await release_task_lock(task["path"], error_msg=e, instance_id=instance_id)
            await worker.close()
            DAEMON_STATE["instances"][instance_id]["state"] = "ERROR"
            sync_daemon_state()
            # 【2026-09-26 新增·产线级连续失败熔断】
            # 素材级已有 retryCount<3 / clientFailCount<8，但缺产线级保护：根因没修好时会
            # 连着好几套用同一种方式失败，把额度白烧掉（09-26 晚上连烧多套）。
            # 连续失败达上限 → 整条产线冷却 30 分钟 + 飞书告警，成功一套即清零。
            _streak = int(INSTANCE_FAIL_STREAK.get(instance_id, 0)) + 1
            INSTANCE_FAIL_STREAK[instance_id] = _streak
            if _streak >= FAIL_STREAK_LIMIT:
                INSTANCE_FAIL_STREAK[instance_id] = 0
                _cd_min = FAIL_STREAK_COOLDOWN // 60
                log(f"🚨 实例 {instance_id} 连续失败 {_streak} 套，触发产线熔断："
                    f"冷却 {_cd_min} 分钟并推送告警（末次异常：{str(e)[:120]}）", instance_id)
                try:
                    _alias_f = get_account_alias(instance_id)
                    send_feishu_markdown(
                        f"🚨 **【产线熔断】实例 {instance_id} 连续失败 {_streak} 套**\n"
                        f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                        f"⚙️ **实例**：{instance_id}（{_alias_f}）\n"
                        f"❌ **末次异常**：{str(e)[:200]}\n"
                        f"🛑 **处置**：该产线冷却 {_cd_min} 分钟，避免继续空烧额度\n"
                        f"💡 常见根因：CDP 抖动 / 上传通道异常 / 前端改版导致选择器失效。",
                        FEISHU_OPS_CHAT_ID)
                except Exception:
                    pass
                # 冷却 30 分钟已超过回收阈值：关掉实例把内存还给系统，到点前自动拉起
                await recycle_instance_for_cooldown(instance_id, cdp_port, FAIL_STREAK_COOLDOWN)
                continue
            # 【2026-09-26 修·节奏风控】失败重试间隔 20 秒 → 120~210 秒随机：
            # 同账号高频重提交正是触发风控的节奏（用户实测：上一套未落地第二套已发出）。
            _rw = random.randint(120, 210)
            log(f"等待 {_rw} 秒后重试（节奏风控冷却）...", instance_id)
            await asyncio.sleep(_rw)

# ================= 冷却期回收实例（2026-09-26 新增·用户指令） =================
# 用户诉求：产线进入冷却期（官方限额休眠 / 产线熔断 / 软节流）时，实例还白占着几百 MB~1GB
# 内存和一整串渲染进程。冷却本来就是干等，不如把实例整个关掉，快到点了再拉起来。
# 本机内存焊死不可扩展（联想小新 Pro 16 IAH7，LPDDR5-4800 板载、无插槽），省下的内存是真金白银。
# 安全边界：只关本产线自己的 Electron 实例，绝不碰其它进程；重启走官方 bat（登录态实测保留）。
COOLDOWN_RECYCLE_MIN_SEC = 900    # 冷却 ≥15 分钟才值得关（关+开一次约 1 分钟开销）
COOLDOWN_RESTART_LEAD_SEC = 180   # 冷却结束前 3 分钟提前拉起，留足启动与页面就绪时间
INSTANCE_START_BAT = {
    "A": r"D:\AICode\工具开发\content-production-app-instances\A\launch.bat",
    "B": r"D:\AICode\工具开发\content-production-app-instances\B\launch.bat",
}
INSTANCE_RECYCLED = set()   # 记录已回收过的 (实例, 冷却截止)，避免重复关开
# 【2026-09-27 新增】冷却回收计划的磁盘落盘位置（主脑重启后据此继续履约拉起）
INSTANCE_RECYCLE_STATE_FILE = r"D:\AICode\运行数据\instance_recycle_state.json"

def find_pid_listening(port):
    """找出正在监听指定 CDP 端口的进程 PID（只用于关本产线自己的实例）"""
    try:
        import psutil
        for c in psutil.net_connections(kind='tcp'):
            try:
                if c.laddr and c.laddr.port == port and c.status == psutil.CONN_LISTEN:
                    return c.pid
            except Exception:
                continue
    except Exception:
        pass
    return None

async def wait_instance_ready(cdp_port, timeout=240, instance_id="SYSTEM"):
    """等实例 CDP 起来且 ChatGPT 页面就绪"""
    import urllib.request as _u
    op = _u.build_opener(_u.ProxyHandler({}))
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            res = json.loads(op.open(f"http://127.0.0.1:{cdp_port}/json/list", timeout=5).read().decode())
            if any(t.get("type") == "page" and "chatgpt.com" in (t.get("url") or "") for t in res):
                return True
        except Exception:
            pass
        await asyncio.sleep(5)
    return False

async def recycle_instance_for_cooldown(instance_id, cdp_port, wait_seconds):
    """冷却等待：够长就关闭实例省内存，快到点再自动拉起；短冷却则原样等待。"""
    wait_seconds = int(wait_seconds or 0)
    if wait_seconds < COOLDOWN_RECYCLE_MIN_SEC:
        await asyncio.sleep(wait_seconds)
        return
    mins = wait_seconds // 60
    log(f"♻️【冷却回收】本次冷却 {mins} 分钟（≥{COOLDOWN_RECYCLE_MIN_SEC // 60} 分钟阈值）→ "
        f"关闭实例 {instance_id} 释放内存，冷却结束前 {COOLDOWN_RESTART_LEAD_SEC // 60} 分钟自动拉起", instance_id)
    # 1) 关闭实例
    pid = find_pid_listening(cdp_port)
    if pid:
        try:
            import psutil
            p = psutil.Process(pid)
            p.terminate()
            try:
                p.wait(timeout=15)
            except Exception:
                p.kill()
            log(f"♻️ 实例 {instance_id}（PID {pid}）已关闭，内存已交还系统", instance_id)
        except Exception as e:
            log(f"♻️ 关闭实例 {instance_id} 失败（{str(e)[:60]}），按原样等待", instance_id)
            await asyncio.sleep(wait_seconds)
            return
    else:
        log(f"♻️ 未找到占用端口 {cdp_port} 的进程，跳过关闭", instance_id)
    # 【2026-09-27 修·冷却拉起计划只活在内存里的致命缺陷】
    # 关闭实例后，"到点自动拉起"靠的是本协程的 asyncio.sleep —— 主脑一重启就全部丢失，
    # 被关掉的实例**永远不会再起来**（A 实例 00:22 被回收、主脑一重启就永久停摆）。
    # 修法：把拉起时刻写进磁盘，主脑无论重启多少次都能接着履约。
    try:
        _rs = {}
        if os.path.exists(INSTANCE_RECYCLE_STATE_FILE):
            with open(INSTANCE_RECYCLE_STATE_FILE, "r", encoding="utf-8") as _f:
                _rs = json.load(_f)
        _rs[instance_id] = {
            "resume_at": (datetime.datetime.now() +
                          datetime.timedelta(seconds=int(wait_seconds))).strftime("%Y-%m-%d %H:%M:%S"),
            "cdp_port": cdp_port,
            "reason": f"冷却回收 {mins} 分钟"
        }
        with open(INSTANCE_RECYCLE_STATE_FILE, "w", encoding="utf-8") as _f:
            json.dump(_rs, _f, ensure_ascii=False, indent=2)
    except Exception as _e_rs:
        log(f"♻️ 写入回收计划失败（不影响本次，但重启后可能漏拉起）: {_e_rs}", instance_id)
    # 2) 睡到快到点
    first_sleep = max(5, wait_seconds - COOLDOWN_RESTART_LEAD_SEC)
    await asyncio.sleep(first_sleep)
    # 3) 提前拉起
    bat = INSTANCE_START_BAT.get(instance_id)
    if bat and os.path.exists(bat):
        try:
            subprocess.Popen(f'cmd /c start "" "{bat}"', shell=True, cwd=os.path.dirname(bat))
            log(f"♻️ 已发起实例 {instance_id} 启动（{os.path.basename(bat)}）", instance_id)
        except Exception as e:
            log(f"♻️ 启动实例 {instance_id} 失败（{str(e)[:60]}）", instance_id)
    else:
        log(f"♻️ 缺少实例 {instance_id} 的启动脚本，无法自动拉起（请人工启动）", instance_id)
    ok = await wait_instance_ready(cdp_port, timeout=COOLDOWN_RESTART_LEAD_SEC + 60, instance_id=instance_id)
    if ok:
        log(f"♻️ 实例 {instance_id} 已就绪，冷却正好结束，立即恢复生产", instance_id)
        clear_recycle_state(instance_id)
    else:
        log(f"♻️ 实例 {instance_id} 拉起后未按时就绪，补齐剩余等待时间（生产协程会自行重试）", instance_id)
        await asyncio.sleep(COOLDOWN_RESTART_LEAD_SEC)

def load_recycle_state():
    """读取持久化的「实例冷却回收 + 待拉起」计划。"""
    try:
        if os.path.exists(INSTANCE_RECYCLE_STATE_FILE):
            with open(INSTANCE_RECYCLE_STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}

def clear_recycle_state(instance_id):
    try:
        if os.path.exists(INSTANCE_RECYCLE_STATE_FILE):
            with open(INSTANCE_RECYCLE_STATE_FILE, "r", encoding="utf-8") as f:
                rs = json.load(f)
            if instance_id in rs:
                rs.pop(instance_id)
                with open(INSTANCE_RECYCLE_STATE_FILE, "w", encoding="utf-8") as f:
                    json.dump(rs, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

async def start_instance_by_bat(instance_id):
    """用官方启动脚本拉起实例；成功返回 True。"""
    bat = INSTANCE_START_BAT.get(instance_id)
    if not bat or not os.path.exists(bat):
        log(f"♻️ 缺少实例 {instance_id} 的启动脚本（{bat}），无法自动拉起，请人工启动", instance_id)
        return False
    try:
        subprocess.Popen(f'cmd /c start "" "{bat}"', shell=True, cwd=os.path.dirname(bat))
        log(f"♻️ 已发起实例 {instance_id} 启动（{os.path.basename(bat)}）", instance_id)
        return True
    except Exception as e:
        log(f"♻️ 启动实例 {instance_id} 失败（{str(e)[:60]}）", instance_id)
        return False

async def delayed_revive_worker(instance_id, cdp_port, resume_at_str):
    """【2026-09-27 新增】主脑启动时实例仍在冷却回收期：先等到点 → 拉起 → 接上生产协程。
    没有它，主脑一重启就会把被回收的实例彻底遗忘。"""
    try:
        _dt = datetime.datetime.strptime(str(resume_at_str), "%Y-%m-%d %H:%M:%S")
        secs = (_dt - datetime.datetime.now()).total_seconds()
    except Exception:
        secs = 0
    if secs > 0:
        log(f"⏳ 实例 {instance_id} 处于冷却回收期，计划 {resume_at_str} 自动拉起（还有 {int(secs // 60)} 分钟）",
            instance_id)
        await asyncio.sleep(secs)
    if probe_cdp_port(cdp_port):
        clear_recycle_state(instance_id)
        await worker_loop(instance_id, cdp_port)
        return
    await start_instance_by_bat(instance_id)
    ok = await wait_instance_ready(cdp_port, timeout=300, instance_id=instance_id)
    if ok:
        log(f"✅ 实例 {instance_id} 冷却结束已自动拉起，恢复生产", instance_id)
        clear_recycle_state(instance_id)
        await worker_loop(instance_id, cdp_port)
    else:
        log(f"🚨 实例 {instance_id} 到点后拉起失败，本轮放弃（需人工检查启动脚本）", instance_id)

def probe_cdp_port(port):
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/json/version", headers={"User-Agent": "Probe"})
        with urllib.request.urlopen(req, timeout=5.0) as resp:
            return resp.status == 200
    except Exception:
        return False

async def probe_quota_banner(cdp_port):
    """
    【2026-09-24 新增】复工「先探额度」探针（**零额度消耗**）。

    用户拍板的复工策略：到点不直接满功率开工，先探一次官方额度。
    探针实现选型说明：**不去真的发一张图试水**（那会白白消耗 1 张额度、还会污染成品区），
    而是直接读页面上的官方额度条：
      「你现在的图片生成次数已用完。请在 12:21后重试。」/「上限将在 X小时 后重置」
    若该条仍指向**未来时刻**，说明官方还没放额度 → 按它继续精确休眠；
    若读不到任何限制文案，说明额度已回 → 放行满功率生产。

    返回 (still_limited: bool, wait_seconds: int, detail: str)。
    任何异常都按「放行」处理（探针只是保险，不能反过来卡死产线）。
    """
    js_banner = """(() => {
        const hits = [];
        document.querySelectorAll('span,p,h3,div').forEach(el => {
            if (el.children.length > 0) return;
            const t = (el.innerText || '').trim();
            if (t && t.length < 120 && /图片生成次数已用完|后重试|后重置|too many requests|try again|usage limit/i.test(t)) hits.push(t);
        });
        return hits.slice(0, 6).join('\\n');
    })()"""

    def _list_targets():
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        return json.loads(opener.open('http://127.0.0.1:%d/json/list' % cdp_port, timeout=6).read().decode('utf-8'))

    try:
        lst = await asyncio.get_event_loop().run_in_executor(None, _list_targets)
    except Exception as e:
        return False, 0, "CDP 不可达(%s)，按放行处理" % str(e)[:40]
    targets = [t for t in lst if 'chatgpt.com' in t.get('url', '')]
    if not targets:
        return False, 0, "未找到 chatgpt 页面，按放行处理"

    banner_txt = ""
    try:
        async with websockets.connect(targets[0]['webSocketDebuggerUrl'],
                                      max_size=20 * 1024 * 1024, open_timeout=8) as ws:
            await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                                      "params": {"expression": js_banner, "returnByValue": True}}))
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=8)
                m = json.loads(raw)
                if m.get("id") == 1:
                    banner_txt = m.get("result", {}).get("result", {}).get("value", "") or ""
                    break
    except Exception as e:
        return False, 0, "探针读取失败(%s)，按放行处理" % str(e)[:40]

    sec, dbg = extract_quota_signals(banner_txt)
    # 【2026-09-24 二次修】额度条时钟已过 → 判为陈旧渲染，直接放行试产。
    # 依据：额度条只在"发生请求"时才刷新；到点探额时页面是空闲的，读到的是上一次撞限的旧文案。
    # 若此时仍按旧文案硬睡，就会像 B 那样被罚睡一整天（12:45 被推到次日 12:35）。
    # 放行是安全的：万一额度真没回，模型的拒绝会把额度条**重新渲染成新鲜状态**，
    # 届时解析拿到的是正确的新复位点（不会死循环）。
    if dbg.get("clock_expired"):
        return False, 0, "额度条时钟已过(%s) → 判为陈旧渲染，放行试产 ｜ %s" % (
            dbg["clock_expired"], banner_txt.replace('\n', ' / ')[:70])
    if sec > 0:
        return True, sec, "额度条仍限流：时钟=%s 时长=%s ｜ %s" % (
            dbg.get('clock') or '—', dbg.get('hour_min') or '—', banner_txt.replace('\n', ' / ')[:70])
    return False, 0, "额度条未见限制 ｜ %s" % (banner_txt.replace('\n', ' / ')[:50] or "（无内容）")


async def main():
    my_pid = os.getpid()
    # 【2026-09-26 修·单例改用 PID 锁文件】
    # 遍历进程表的判据在这个环境里根本不可用：Bash/守护的包装进程 cmdline 里也带脚本名，
    # 实测连开 4 次全部"检测到幽灵 PID"自杀退出（报的 PID 事后再查均已消失）。
    # 改用进程锁文件 + PID 存活校验，判据唯一且不会误伤。
    try:
        PID_LOCK_FILE = r"D:\AICode\运行数据\producer.pid"
        os.makedirs(os.path.dirname(PID_LOCK_FILE), exist_ok=True)
        _old = 0
        if os.path.exists(PID_LOCK_FILE):
            try:
                _old = int((open(PID_LOCK_FILE, encoding="utf-8").read() or "0").strip() or 0)
            except Exception:
                _old = 0
        if _old and _old != my_pid:
            try:
                import psutil as _ps
                _alive = _ps.pid_exists(_old) and 'python' in (_ps.Process(_old).name() or '').lower()
            except Exception:
                _alive = False
            if _alive:
                log(f"🚨 检测到已有生产进程在运行 (PID {_old}，来自 {PID_LOCK_FILE})，"
                    f"本进程 (PID {my_pid}) 自动安全退出，避免双进程并发抢占冲突！")
                return
        with open(PID_LOCK_FILE, "w", encoding="utf-8") as _f:
            _f.write(str(my_pid))
        log(f"🔒 进程锁已获取（PID {my_pid} → {PID_LOCK_FILE}）")
    except Exception as _e_lock:
        log(f"⚠️ PID 锁处理异常（不阻断启动）: {_e_lock}")

    log("==================================================")
    log("AUTUMN-C 客户端直接出图模式（你口中的 API 模式）启动（当前可用客户端产线）！")
    log(f"通知目标（成品交付/战报）：群聊 ID {FEISHU_GROUP_CHAT_ID}")
    log(f"通知目标（运维状态/熔断/复工）：群聊 ID {FEISHU_OPS_CHAT_ID}（网页CDP状态检测群）")
    log(f"对比表格：{SPREADSHEET_URL}")
    # [2026-09-24 修] 启动即摘除进程内全部代理变量。
    # 背景：HKCU 曾遗留 ALL_PROXY=http://127.0.0.1:7897（当时死端口），被
    # 计划任务 → 看门狗 → 主脑 → lark-cli 一路继承，飞书推送全部 proxyconnect 失败、静默哑火。
    # 从"改指 7890"升级为"整个摘掉"：代理端口会随用户 Clash 配置漂移（09-24 下午 7897 又活了），
    # 硬编码端口是赌博；而飞书境内直连、CDP 走 127.0.0.1、图片下载走 CDP 页面内，都不需要代理。
    _pf = []
    for _k in ("ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"):
        if os.environ.pop(_k, None) is not None:
            _pf.append(_k)
    if _pf:
        log(f"🔧 代理环境自愈：已摘除进程内代理变量 {', '.join(_pf)}（飞书境内直连 / CDP 走 127.0.0.1 / 图片下载走 CDP，均无需代理）")
    else:
        log("🔧 代理环境自检：无代理变量残留")
    log("==================================================")
    reconcile_missing_autumn_c_tasks()
    reconcile_success_output_integrity()
    reconcile_stale_autumn_c_locks()
    DAEMON_STATE["queue_remaining"] = len(scan_pending_queue())
    sync_daemon_state()

    # 动态检测活跃实例：本批配置 A 与 B 产线协同作业
    candidate_workers = [("A", 9431), ("B", 9432)]
    # 【2026-09-26 用户指令】今天专注 B 实例自动生产；A 账号（zwmrpg）用户要手动使用，
    # A 实例保持在线（守护与端口不动）但主脑不挂载 A 生产协程、不提交任何任务。
    # 解除方法：从本集合移除 "A" 即可恢复双线。
    # 【2026-09-26 21:00 用户指令】A/B 两条产线同时开工，取消 A 的手动模式。
    # 需要重新只跑 B 时，把 "A" 加回这个集合即可。
    # 【2026-10-05 用户指令】AB 两条产线同时持续运转生产，取消 A 独占手动限制，恢复双线自动生产
    MANUAL_ONLY_INSTANCES = set()
    active_tasks = []

    for inst_id, port in candidate_workers:
        if inst_id in MANUAL_ONLY_INSTANCES:
            if probe_cdp_port(port):
                log(f"🖐️ 实例 {inst_id} 已切手动模式（用户指令），主脑跳过挂载，实例保持在线供人工使用。")
            continue
        if probe_cdp_port(port):
            alias = get_account_alias(inst_id)
            log(f"✅ 探测到实例 {inst_id} ({alias}，端口 {port}) 在线就绪，挂载生产协程！")
            active_tasks.append(worker_loop(inst_id, port))
        else:
            _mounted_before = len(active_tasks)
            # 【2026-09-27 修·别把被冷却回收的实例永久遗忘】
            # 旧逻辑：离线就"保持静默跳过"，于是被冷却回收关掉的实例再也没人拉起，
            # 产线从双线直接退化成单线（甚至零线）而没有任何告警。
            # 新逻辑：先看磁盘上的回收计划——到期了就立刻拉起，没到期就挂一个定时拉起协程。
            _rs = load_recycle_state().get(inst_id)
            _resume_at = (_rs or {}).get("resume_at")
            if _resume_at:
                try:
                    _due = datetime.datetime.strptime(str(_resume_at), "%Y-%m-%d %H:%M:%S")
                except Exception:
                    _due = None
                if _due and datetime.datetime.now() >= _due:
                    log(f"♻️ 实例 {inst_id} 的冷却期已于 {_resume_at} 结束，立即自动拉起...", inst_id)
                    await start_instance_by_bat(inst_id)
                    if await wait_instance_ready(port, timeout=300, instance_id=inst_id):
                        clear_recycle_state(inst_id)
                        log(f"✅ 实例 {inst_id} 已就绪，挂载生产协程！", inst_id)
                        active_tasks.append(worker_loop(inst_id, port))
                    else:
                        log(f"🚨 实例 {inst_id} 拉起超时，本轮不挂载（需人工检查）", inst_id)
                else:
                    log(f"⏸️ 实例 {inst_id} 仍在冷却回收期（{_resume_at} 拉起），已挂定时恢复任务。", inst_id)
                    active_tasks.append(delayed_revive_worker(inst_id, port, _resume_at))
            else:
                log(f"⏸️ 实例 {inst_id} (端口 {port}) 未在线或未开 CDP，保持静默跳过。")
            if inst_id in DAEMON_STATE["instances"] and len(active_tasks) == _mounted_before:
                DAEMON_STATE["instances"][inst_id]["state"] = "OFFLINE"

    if not active_tasks:
        log("❌ 未探测到任何可用的 CDP 浏览器实例（请确保至少大号 A 已开启），生产脚本退出。")
        return

    # 常驻内存守护：与生产协程并行，系统卡顿时脚本自己触发 GC / 关多余页面 / 告警
    try:
        active_tasks.append(memory_guard_loop(tuple(candidate_workers)))
        log("🧠 常驻内存守护已挂载（自动 GC + 内存日志，不杀进程）")
    except Exception as _e_mg:
        log(f"⚠️ 内存守护挂载失败（不影响生产）: {_e_mg}")

    log(f"🚀 已激活 {len(active_tasks)} 路生产线程，开始并发作业！")
    await asyncio.gather(*active_tasks)

if __name__ == "__main__":
    asyncio.run(main())
