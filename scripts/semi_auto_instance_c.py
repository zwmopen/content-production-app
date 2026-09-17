# -*- coding: utf-8 -*-
"""
====================================================================
江湖有旅人 · 应用 C 纯半自动制作脚本 (Semi-Automatic Content Generator)
升级版本：小红书团建拼图大字营销封面轻复刻去重修图师 V3.7
文案协议：江浙沪企业团建三平台文案中枢 V4 (<<<COPY_FORMAT:3>>>)
（账号3 · 端口 9433）

严格落实 7 步纯手动 SOP：
1. 选材与上传 -> 2. 注入 Prompt 1(V3.7复刻+三平台文案规划) -> 3. 人工核对闸口 ->
4. 确认出图(回复1) -> 5. 监控与断流补刀 -> 6. Blob-to-Canvas 无损导出 -> 7. 多平台文案落盘与台账回写
绝无死循环，单套全透明可控！
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
import subprocess
import base64
import shutil

sys.stdout.reconfigure(encoding='utf-8')

# ================= 基础路径配置 =================
BASE_DIR = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）"
DATA_DIR = os.path.join(BASE_DIR, "_作品历史数据")
DB_PATH = os.path.join(DATA_DIR, "作品历史数据库.json")
INVENTORY_PATH = os.path.join(DATA_DIR, "成品库全区域可用库存与缺口盘点总台账.md")
CROSS_PATH = os.path.join(DATA_DIR, "成品与素材对照总台账.md")

RUNTIME_DIR = r"D:\AICode\运行数据\江湖有旅人\内容生产App"
USAGE_LEDGER = os.path.join(RUNTIME_DIR, "shared-material", "防重复账本", "material-usage-ledger.json")
LOG_FILE = os.path.join(RUNTIME_DIR, "semi_auto_instance_c.log")
MATERIAL_ROOT = r"D:\AICode\AI\data\01-团建策划-江湖有旅人\01-素材库\01-精准流量-团建类"
PROMPT_V37_PATH = r"D:\AICode\AI\prompts\小红书团建拼图大字营销封面轻复刻去重修图师_V3.7.md"

PORT = 9433
MASTER_URL = "https://chatgpt.com/c/6a25d73d-d838-83a9-a7f4-a2954b0a50f4"

def log(msg):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except: pass

def send_toast(title, message):
    log(f"[Toast] {title} - {message}")
    ps = f"""
    Add-Type -AssemblyName System.Windows.Forms
    $n = New-Object System.Windows.Forms.NotifyIcon
    $n.Icon = [System.Drawing.SystemIcons]::Information
    $n.BalloonTipTitle = '{title}'
    $n.BalloonTipText = '{message}'
    $n.Visible = $true
    $n.ShowBalloonTip(5000)
    Start-Sleep -Milliseconds 1200
    $n.Dispose()
    """
    try:
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)
    except: pass

def load_ledger():
    if os.path.exists(USAGE_LEDGER):
        try:
            with open(USAGE_LEDGER, "r", encoding="utf-8") as f:
                return json.load(f)
        except: pass
    return {}

def save_ledger(ledger):
    try:
        os.makedirs(os.path.dirname(USAGE_LEDGER), exist_ok=True)
        with open(USAGE_LEDGER, "w", encoding="utf-8") as f:
            json.dump(ledger, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log(f"Failed to save usage ledger: {e}")

def pick_one_material(target_folder=None):
    """
    选材：若用户指定了目录则使用指定的；否则自动挑选 1 组未使用的实拍素材(>=4图，优先8-10图)
    """
    ledger = load_ledger()
    if target_folder and os.path.exists(target_folder):
        imgs = [f for f in os.listdir(target_folder) if f.lower().endswith(('.jpg', '.png', '.jpeg'))]
        if len(imgs) >= 4:
            return target_folder, os.path.basename(target_folder), len(imgs)

    # 自动扫描：优先找 >=8 张未使用的
    for root, dirs, files in os.walk(MATERIAL_ROOT):
        imgs = [f for f in files if f.lower().endswith(('.jpg', '.png', '.jpeg'))]
        if len(imgs) >= 8:
            u_info = ledger.get(root, {})
            if u_info.get("usageCount", 0) == 0:
                return root, os.path.basename(root), len(imgs)

    # 次级扫描：找 >=4 张未使用的
    for root, dirs, files in os.walk(MATERIAL_ROOT):
        imgs = [f for f in files if f.lower().endswith(('.jpg', '.png', '.jpeg'))]
        if len(imgs) >= 4:
            u_info = ledger.get(root, {})
            if u_info.get("usageCount", 0) == 0:
                return root, os.path.basename(root), len(imgs)

    return None, None, 0

def clean_title(folder_name):
    title = folder_name
    title = re.sub(r'^[0-9_\-\.评赞获赞\s]+', '', title)
    title = re.sub(r'[评赞0-9]+', '', title)
    title = re.sub(r'[，。！？\s]+', '', title)
    if len(title) < 4:
        title = "江浙沪高品质团建方案"
    return title[:28]

def detect_region_name(folder_name):
    known_regions = [
        "安吉", "桐庐", "莫干山", "舟山", "千岛湖", "临安", "富阳", "余杭",
        "德清", "长兴", "宜兴", "西山岛", "苏州", "太湖", "嵊泗", "象山",
        "诸暨", "金华", "绍兴", "宁波", "湖州", "无锡", "杭州"
    ]
    for r in known_regions:
        if r in folder_name:
            return r
    return "江浙沪周边"

def load_v37_prompt():
    if os.path.exists(PROMPT_V37_PATH):
        try:
            with open(PROMPT_V37_PATH, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if content:
                    return content
        except: pass
    return """# 小红书团建拼图大字营销封面轻复刻去重修图师 V3.7
你现在是我的：「小红书团建拼图大字营销封面轻复刻去重修图师 V3.7」。
我会上传一组小红书团建、露营、烧烤、农庄、小院、户外拓展、周边游、活动项目类图片。
你的任务是：基于我提供的原图，做成适合小红书发布的【团建营销型拼图大字图】。
对每一张原图（单张封面或整套轮播），严格 1:1 复刻其排版结构、构图比例、字体样式与点击感，同时对画面内容执行全方位深度去重。
最终效果：【小红书原生拼图 + 团建营销点击感 + 原版复刻去重】
神形兼备：
1. 遮住图片内容：只看排版比例、字体粗细、黑白描边、色块黄条、标题位置与视觉重心，必须与原图 1:1 像素级高度神似。
2. 露出图片内容：拼图顺序已打乱、序号与内容已解耦、人物全换、静物道具全换、机位微调、无违规引流词、无假 AI 味，彻底通过平台查重与推荐机制。"""

def build_prompt_1(batch_id, title, region_name, img_count):
    v37_rules = load_v37_prompt()
    return f"""{v37_rules}

==================================================
【本次上传素材与执行任务】
批次编号：【{batch_id}】
参考主题：【{region_name}·{title}】
已上传素材图片：共 {img_count} 张实拍高清参考图。

【核心执行要求】：
1. 严格原版复刻：对上传的 {img_count} 张参考图，严格 1:1 复刻其排版结构、构图比例、字体样式与点击感。1 张原图对应 1 张独立 3:4 竖版成品大图，本套共需生成 {img_count} 张独立成品图（P1 封面 + P2~P{img_count} 内页），严禁把多张图拼成一张总图！
2. 深度去重：
   - 拼图分区强制全部离开原坐标（如四宫格 A/B/C/D 必须打乱为 C/A/D/B 等）；
   - 若原图带连续序号（如 NO.1~NO.9、01~09 等），序号保持工整递增（NO.1、NO.2...），但对应的活动项目内容必须强制洗牌对调解耦；
   - 画面中所有人物全量替换（换脸换衣换姿势），生活真实抓拍感，严禁假笑网红脸；
   - 涉及露营、烧烤、围炉煮茶等静物美食与道具重新摆盘；
   - 去除原图所有平台水印、杂乱文字与营销引流词（严禁私信/加微信/报价/咨询等）。
3. 业务与地域锁定：锁定为【江浙沪＋企业团建＋10人起接】。

【三平台文案输出协议（COPY_FORMAT:3）】：
请在出图计划之前，先输出完整的三平台成稿，严格使用 <<<COPY_FORMAT:3>>> 机器协议，格式如下：
<<<COPY_FORMAT:3>>>
<<<XHS_START>>>
[单标题，不带任何编号或备选]

[小红书第1版成稿：自然种草与真实体验版，短段落、真实生活抓拍感、真实避坑]

#江浙沪团建 #企业团建 #[地点]团建 #[玩法]团建 ...（末尾固定输出 8-12 个精准话题标签）
<<<XHS_END>>>
<<<XHS_2_START>>>
[单标题]

# [主标题]
> 专为HR/行政打造的企业号大纲方案版

【基础信息】
▫️ 适合人数：10人起接（企业团队/部门定制）
▫️ 行程天数：2天1夜（或根据素材提炼）
▫️ 目的地：{region_name}
▫️ 建议预算：人均参考（有真实价格写真实价格，无价格删价格）

【行程特色亮点】
▫️ [真实提炼亮点1]
▫️ [真实提炼亮点2]
▫️ [真实提炼亮点3]

【建议行程安排】
[真实提炼的时刻表动线或 DAY1-2 排期]

【贴心避坑指南】
[真实提炼的避坑建议或出行Tips]

留下【团建+人数】获取专属定制方案

#江浙沪团建 #企业团建 #团建方案 #团建策划 #[地点]团建（5-10个话题标签）
<<<XHS_2_END>>>
<<<DOUYIN_START>>>
[单标题]

[抖音完整成稿：去营销目的地攻略/避坑玩法版。纯攻略玩法分享，绝不出现价格、报价、费用、10人起接、定制、咨询、联系我们等任何商业/交易/服务承接词汇]

#江浙沪周边游 #目的地旅游攻略 #[玩法]攻略 ...（末尾固定输出 5 个相关话题标签）
<<<DOUYIN_END>>>

【出图前规划与闸口】：
在输出三平台文案后，输出 P1 到 P{img_count} 的逐页复刻与去重出图计划（说明每页版式、锁定视觉、主标题、换位方案、序号对调映射表、换人换物方案）。
【关键铁律】：本轮请绝对不要直接调用生图工具！请在计划结尾明确提示：“请核对以上文案与出图计划，确认无误后请回复【1】，我将立即开始逐张渲染 P1 到 P{img_count} 独立 3:4 高清大图。”"""

def build_prompt_2(target_cards):
    return f"1。已确认文案与出图计划！请立即调用生图工具，逐张生成 P1 到 P{target_cards} 的全部 {target_cards} 张 3:4 独立高清卡片大图（每张均为竖版单图，切勿拼图），开始逐张生成！"

def build_nudge_prompt(done_count, target_cards):
    return f"已收到前 {done_count} 张卡片（P1~P{done_count}）。请继续调用生图工具，逐张生成剩余的 P{done_count+1} 到 P{target_cards} 独立高清卡片大图，不要停顿，直至全部完成！"

def parse_and_save_copy(copy_text, dest_dir):
    """
    保存文案五大件：
    - 文案.txt (完整机器协议原文)
    - 小红书文案.txt (第1版 自然种草与真实体验版)
    - 小红书文案_HR方案决策版.txt (第2版 HR方案大纲/决策版)
    - 抖音文案.txt (去营销目的地攻略/避坑版)
    """
    clean_raw = str(copy_text or "").strip()
    with open(os.path.join(dest_dir, "文案.txt"), "w", encoding="utf-8") as f:
        f.write(clean_raw)

    saved_sections = []
    if "<<<COPY_FORMAT:3>>>" in clean_raw or "<<<XHS_2_START>>>" in clean_raw:
        # Format 3
        m_xhs = re.search(r'<<<XHS_START>>>(.*?)<<<XHS_END>>>', clean_raw, re.DOTALL)
        if m_xhs:
            xhs_text = m_xhs.group(1).strip()
            with open(os.path.join(dest_dir, "小红书文案.txt"), "w", encoding="utf-8") as f:
                f.write(xhs_text)
            saved_sections.append("小红书文案.txt")

        m_xhs2 = re.search(r'<<<XHS_2_START>>>(.*?)<<<XHS_2_END>>>', clean_raw, re.DOTALL)
        if m_xhs2:
            xhs2_text = m_xhs2.group(1).strip()
            with open(os.path.join(dest_dir, "小红书文案_HR方案决策版.txt"), "w", encoding="utf-8") as f:
                f.write(xhs2_text)
            saved_sections.append("小红书文案_HR方案决策版.txt")

        m_dy = re.search(r'<<<DOUYIN_START>>>(.*?)<<<DOUYIN_END>>>', clean_raw, re.DOTALL)
        if m_dy:
            dy_text = m_dy.group(1).strip()
            with open(os.path.join(dest_dir, "抖音文案.txt"), "w", encoding="utf-8") as f:
                f.write(dy_text)
            saved_sections.append("抖音文案.txt")

    elif "<<<COPY_FORMAT:2>>>" in clean_raw:
        # Format 2
        m_xhs = re.search(r'<<<XHS_START>>>(.*?)<<<XHS_END>>>', clean_raw, re.DOTALL)
        if m_xhs:
            xhs_text = m_xhs.group(1).strip()
            with open(os.path.join(dest_dir, "小红书文案.txt"), "w", encoding="utf-8") as f:
                f.write(xhs_text)
            saved_sections.append("小红书文案.txt")

        m_dy = re.search(r'<<<DOUYIN_START>>>(.*?)<<<DOUYIN_END>>>', clean_raw, re.DOTALL)
        if m_dy:
            dy_text = m_dy.group(1).strip()
            with open(os.path.join(dest_dir, "抖音文案.txt"), "w", encoding="utf-8") as f:
                f.write(dy_text)
            saved_sections.append("抖音文案.txt")
    else:
        # Fallback
        with open(os.path.join(dest_dir, "小红书文案.txt"), "w", encoding="utf-8") as f:
            f.write(clean_raw)
        saved_sections.append("小红书文案.txt(直接成稿)")

    log(f"  ✓ 文案已成功保存: {', '.join(saved_sections)} 及 文案.txt")
    return saved_sections

async def connect_chatgpt_tab():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        tabs_raw = opener.open(f"http://127.0.0.1:{PORT}/json/list").read().decode('utf-8')
        tabs = json.loads(tabs_raw)
    except Exception as e:
        log(f"无法连接端口 {PORT}，请确认 Chrome/Electron 调试模式已开启！错误: {e}")
        return None, None

    chat_tabs = [t for t in tabs if 'chatgpt.com' in t.get('url', '')]
    if not chat_tabs:
        log("未找到 ChatGPT 标签页！")
        return None, None

    tab = chat_tabs[0]
    return tab['webSocketDebuggerUrl'], tab['url']

async def run_semi_auto_flow(specified_material=None, interactive=True):
    print("=" * 65)
    print("  🍇 江湖有旅人 · 应用 C 纯半自动流水线 (账号3 · 端口 9433)")
    print("  模式：小红书团建拼图大字营销封面轻复刻去重修图师 V3.7")
    print("  文案：江浙沪企业团建三平台文案中枢 V4 (Format 3)")
    print("=" * 65)

    # 步骤 0 & 1：连接与选材
    ws_url, tab_url = await connect_chatgpt_tab()
    if not ws_url:
        return False

    mat_path, folder_name, img_count = pick_one_material(specified_material)
    if not mat_path:
        log("未找到可用的素材包（需 >=4 张且未制作过）！")
        return False

    title = clean_title(folder_name)
    region_name = detect_region_name(folder_name)
    batch_id = datetime.datetime.now().strftime("C%m%d_%H%M")

    # 获取要上传的图片列表（最多10张）
    all_files = sorted([
        os.path.join(mat_path, f) for f in os.listdir(mat_path)
        if f.lower().endswith(('.jpg', '.png', '.jpeg'))
    ])[:10]
    target_cards = len(all_files)

    log(f"【步骤 1 选料就绪】")
    log(f"  素材路径: {mat_path}")
    log(f"  素材名称: {folder_name} (原图 {img_count} 张，本次取 {target_cards} 张)")
    log(f"  提炼标题: {title}")
    log(f"  目的地/区域: {region_name}")
    log(f"  批次编号: {batch_id}")
    log(f"  目标成图数: {target_cards} 张 3:4 独立图 (P1~P{target_cards})")

    # 上传素材
    log(f"正在上传 {len(all_files)} 张素材至 ChatGPT 网页输入框...")
    async with websockets.connect(ws_url, max_size=100*1024*1024) as ws:
        await ws.send(json.dumps({'id': 1, 'method': 'DOM.enable'}))
        await ws.recv()

        await ws.send(json.dumps({'id': 2, 'method': 'Runtime.evaluate', 'params': {'expression': "document.querySelector('input[type=\"file\"]')"}}))
        r2 = json.loads(await ws.recv())
        obj_id = r2.get('result', {}).get('result', {}).get('objectId')

        await ws.send(json.dumps({'id': 3, 'method': 'DOM.requestNode', 'params': {'objectId': obj_id}}))
        r3 = json.loads(await ws.recv())
        node_id = r3.get('result', {}).get('nodeId')

        await ws.send(json.dumps({'id': 4, 'method': 'DOM.setFileInputFiles', 'params': {'nodeId': node_id, 'files': all_files}}))
        await ws.recv()
        log(f"文件已选定，等待 {min(8, 2 + len(all_files))} 秒渲染缩略图...")
        await asyncio.sleep(min(8, 2 + len(all_files)))

        # 步骤 2：注入第 1 轮指令 (Prompt 1)
        p1 = build_prompt_1(batch_id, title, region_name, target_cards)
        log("【步骤 2 发送第 1 轮提示词：V3.7 复刻规划与三平台文案中枢 V4 注入】")
        p1_json = json.dumps(p1)
        js_input = f"""(() => {{
            const ta = document.querySelector('#prompt-textarea');
            if (!ta) return false;
            ta.focus();
            ta.innerHTML = '<p>' + {p1_json} + '</p>';
            ta.dispatchEvent(new Event('input', {{ bubbles: true }}));
            return true;
        }})()"""
        await ws.send(json.dumps({'id': 5, 'method': 'Runtime.evaluate', 'params': {'expression': js_input, 'returnByValue': True}}))
        await ws.recv()
        await asyncio.sleep(2)

        # 点击发送
        js_send = """(() => {
            const btn = document.querySelector('#composer-submit-button, button[data-testid="send-button"]');
            if (btn && !btn.disabled) { btn.click(); return true; }
            return false;
        })()"""
        await ws.send(json.dumps({'id': 6, 'method': 'Runtime.evaluate', 'params': {'expression': js_send, 'returnByValue': True}}))
        await ws.recv()
        log("🚀 第 1 轮指令已发送！正在等待 ChatGPT 输出三平台文案与出图计划...")

    # 等待 Prompt 1 响应完毕
    for _ in range(40):
        await asyncio.sleep(4)
        async with websockets.connect(ws_url, max_size=50*1024*1024) as ws:
            js_chk = """(() => {
                const stopBtn = document.querySelector('[data-testid="stop-button"]');
                const sendBtn = document.querySelector('button[data-testid="send-button"]');
                return { isGenerating: !!stopBtn, hasSend: !!sendBtn };
            })()"""
            await ws.send(json.dumps({'id': 10, 'method': 'Runtime.evaluate', 'params': {'expression': js_chk, 'returnByValue': True}}))
            r = json.loads(await ws.recv())
            val = r.get('result', {}).get('result', {}).get('value', {})
            if not val.get('isGenerating') and val.get('hasSend'):
                log("ChatGPT 已完成第 1 轮输出！")
                break

    # 抓取 Prompt 1 生成的文案
    captured_copy_text = ""
    async with websockets.connect(ws_url, max_size=50*1024*1024) as ws:
        js_get_copy = """(() => {
            const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"]'));
            for (let i = turns.length - 1; i >= 0; i--) {
                const turn = turns[i];
                const text = turn.innerText || "";
                if (text.includes('<<<COPY_FORMAT:') || text.includes('<<<XHS_START>>>')) {
                    return text;
                }
            }
            if (turns.length > 0) {
                return turns[turns.length - 1].innerText || "";
            }
            return "";
        })()"""
        await ws.send(json.dumps({'id': 15, 'method': 'Runtime.evaluate', 'params': {'expression': js_get_copy, 'returnByValue': True}}))
        r = json.loads(await ws.recv())
        captured_copy_text = r.get('result', {}).get('result', {}).get('value', '')

    # 步骤 3：人工审查与分镜核对闸口
    log("\n" + "="*55)
    log("【步骤 3 人工审查闸口】")
    log(f"请在浏览器中核对 ChatGPT 生成的三平台文案与 P1~P{target_cards} 出图计划。")
    log("核对重点：")
    log("  1. 三平台文案是否包含 XHS第1版 / XHS第2版(HR方案) / 抖音版；")
    log("  2. 出图计划是否为 1:1 原版复刻、拼图分区打乱、NO.1~NO.9 序号内容解耦；")
    log(f"  3. 确认无误后，准备发送口令【1】开始逐张渲染 P1 到 P{target_cards} 高清大图。")
    log("="*55 + "\n")

    if interactive:
        try:
            choice = input(f"👉 请核对计划！输入 [1] 或按回车确认出图 ({target_cards}张)，输入 [Q] 退出: ").strip()
            if choice.lower() == 'q':
                log("用户取消操作，脚本退出。")
                return False
        except:
            pass

    # 步骤 4：发送第 2 轮指令 (Prompt 2)
    log(f"【步骤 4 发送出图口令：1】(目标 {target_cards} 张)")
    p2 = build_prompt_2(target_cards)
    async with websockets.connect(ws_url, max_size=50*1024*1024) as ws:
        p2_json = json.dumps(p2)
        js_input2 = f"""(() => {{
            const ta = document.querySelector('#prompt-textarea');
            if (!ta) return false;
            ta.focus();
            ta.innerHTML = '<p>' + {p2_json} + '</p>';
            ta.dispatchEvent(new Event('input', {{ bubbles: true }}));
            return true;
        }})()"""
        await ws.send(json.dumps({'id': 20, 'method': 'Runtime.evaluate', 'params': {'expression': js_input2, 'returnByValue': True}}))
        await ws.recv()
        await asyncio.sleep(1)

        js_send2 = """(() => {
            const btn = document.querySelector('#composer-submit-button, button[data-testid="send-button"]');
            if (btn && !btn.disabled) { btn.click(); return true; }
            return false;
        })()"""
        await ws.send(json.dumps({'id': 21, 'method': 'Runtime.evaluate', 'params': {'expression': js_send2, 'returnByValue': True}}))
        await ws.recv()
        log("🚀 出图指令已发送！进入逐张生图监控与质量验收期...")

    # 步骤 5：出图监控与卡顿“补刀”
    final_cards = []
    for cycle in range(120): # 最多监控 20 分钟
        await asyncio.sleep(10)
        async with websockets.connect(ws_url, max_size=50*1024*1024) as ws:
            js_mon = """(() => {
                const stopBtn = document.querySelector('[data-testid="stop-button"]');
                const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"]'));
                const lastTurn = turns[turns.length - 1];
                const imgs = lastTurn ? Array.from(lastTurn.querySelectorAll('img')).filter(i => (i.src || '').includes('file_')) : [];
                const unique = [];
                const seen = new Set();
                for (const i of imgs) {
                    const m = (i.src || '').match(/id=([a-zA-Z0-9_]+)/);
                    const fid = m ? m[1] : i.src;
                    if (!seen.has(fid)) {
                        seen.add(fid);
                        unique.push({ fid: fid, src: i.src });
                    }
                }
                // Also check if copy text is updated in the last turn
                let latestCopy = "";
                for (let i = turns.length - 1; i >= 0; i--) {
                    const t = turns[i].innerText || "";
                    if (t.includes('<<<COPY_FORMAT:') || t.includes('<<<XHS_START>>>')) {
                        latestCopy = t;
                        break;
                    }
                }
                return { isGenerating: !!stopBtn, cardCount: unique.length, cards: unique, copyText: latestCopy };
            })()"""
            await ws.send(json.dumps({'id': 30, 'method': 'Runtime.evaluate', 'params': {'expression': js_mon, 'returnByValue': True}}))
            r = json.loads(await ws.recv())
            val = r.get('result', {}).get('result', {}).get('value', {})
            is_gen = val.get('isGenerating', False)
            cur_count = val.get('cardCount', 0)
            cards = val.get('cards', [])
            if val.get('copyText'):
                captured_copy_text = val.get('copyText')

            log(f"[{cycle*10}s] 正在生成... 当前可见卡片: {cur_count}/{target_cards} (isGenerating: {is_gen})")

            if cur_count >= target_cards:
                log(f"🎉 目标 {target_cards} 张卡片已全部渲染完毕！")
                final_cards = cards[:target_cards]
                break

            # 判定卡顿并触发补刀
            if not is_gen and cur_count < target_cards and cycle >= 6 and cur_count > 0:
                log(f"⚠️ 检测到生图暂停在第 {cur_count} 张！正在发送步骤 5 补刀词...")
                nudge = build_nudge_prompt(cur_count, target_cards)
                nudge_json = json.dumps(nudge)
                js_nudge = f"""(() => {{
                    const ta = document.querySelector('#prompt-textarea');
                    if (!ta) return false;
                    ta.focus();
                    ta.innerHTML = '<p>' + {nudge_json} + '</p>';
                    ta.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    const btn = document.querySelector('#composer-submit-button, button[data-testid="send-button"]');
                    if (btn && !btn.disabled) {{ btn.click(); return true; }}
                    return false;
                }})()"""
                await ws.send(json.dumps({'id': 31, 'method': 'Runtime.evaluate', 'params': {'expression': js_nudge, 'returnByValue': True}}))
                await ws.recv()
                await asyncio.sleep(5)

    if len(final_cards) < target_cards:
        log(f"未在规定时间内出满 {target_cards} 张图（当前 {len(final_cards)} 张），拒绝无脑打包残次品！请在浏览器手动核查。")
        return False

    # 步骤 6：Blob-to-Canvas 导出无损大图与入库（落盘至 _制作中）
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    producing_dir = os.path.join(BASE_DIR, "_制作中")
    os.makedirs(producing_dir, exist_ok=True)
    dest_dir = os.path.join(producing_dir, f"{timestamp}_{title}")
    os.makedirs(dest_dir, exist_ok=True)
    log(f"【步骤 6 纯无损原画导出】制作中暂存至: {dest_dir}")

    async with websockets.connect(ws_url, max_size=100*1024*1024) as ws:
        for idx, card in enumerate(final_cards):
            card_num = idx + 1
            file_name = "P1_封面.png" if card_num == 1 else f"P{card_num}.png"
            out_file = os.path.join(dest_dir, file_name)
            src_json = json.dumps(card['src'])
            js_export = f"""(async () => {{
                try {{
                    const resp = await fetch({src_json});
                    const blob = await resp.blob();
                    const objUrl = URL.createObjectURL(blob);
                    const img = new Image();
                    img.src = objUrl;
                    await img.decode();
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth || 1086;
                    canvas.height = img.naturalHeight || 1448;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    URL.revokeObjectURL(objUrl);
                    return canvas.toDataURL('image/png').split(',')[1];
                }} catch (e) {{
                    return null;
                }}
            }})()"""
            await ws.send(json.dumps({'id': 40 + idx, 'method': 'Runtime.evaluate', 'params': {'expression': js_export, 'awaitPromise': True, 'returnByValue': True}}))
            r = json.loads(await ws.recv())
            b64_data = r.get('result', {}).get('result', {}).get('value')
            if b64_data:
                img_bytes = base64.b64decode(b64_data)
                with open(out_file, "wb") as f:
                    f.write(img_bytes)
                log(f"  ✓ 成功无损落盘: {file_name} ({len(img_bytes)/(1024*1024):.2f} MB)")
            else:
                log(f"  ✕ 导出失败: {file_name}")

    # 步骤 6.2：保存多平台文案
    log(f"【步骤 6.2 多平台文案落盘】")
    parse_and_save_copy(captured_copy_text, dest_dir)

    # 写入作品标签.json 与 会话追踪.txt
    with open(os.path.join(dest_dir, "作品标签.json"), "w", encoding="utf-8") as f:
        json.dump({
            "batch": batch_id,
            "title": title,
            "region": region_name,
            "account": "账号3 (z x Plus)",
            "master_name": "「小红书团建拼图大字营销封面轻复刻去重修图师 V3.7」",
            "prompt_version": "V3.7",
            "copy_protocol": "COPY_FORMAT:3",
            "card_count": target_cards,
            "master_url": MASTER_URL,
            "branch_url": tab_url,
            "created_at": datetime.datetime.now().isoformat()
        }, f, ensure_ascii=False, indent=2)

    with open(os.path.join(dest_dir, "会话追踪.txt"), "w", encoding="utf-8") as f:
        f.write(f"会话分支: {tab_url}\n执行账号: 账号3 (z x Plus)\n生成卡片数: {len(final_cards)}\n归档目录: {dest_dir}\n复刻提示词版本: V3.7\n文案协议版本: COPY_FORMAT:3\n完成时间: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")

    # 步骤 7：台账回写与防重复
    ledger = load_ledger()
    if mat_path not in ledger: ledger[mat_path] = {}
    ledger[mat_path]["usageCount"] = ledger[mat_path].get("usageCount", 0) + 1
    ledger[mat_path]["status"] = "completed"
    ledger[mat_path]["last_used_at"] = datetime.datetime.now().isoformat()
    ledger[mat_path]["last_product_dir"] = dest_dir
    save_ledger(ledger)

    # 步骤 8：原子流转至 已发送0次（抖音小红书可发）
    stage0_base = os.path.join(BASE_DIR, "已发送0次（抖音小红书可发）")
    os.makedirs(stage0_base, exist_ok=True)
    final_pkg_dir = os.path.join(stage0_base, os.path.basename(dest_dir))
    try:
        shutil.move(dest_dir, final_pkg_dir)
        dest_dir = final_pkg_dir
        log(f"-> 质检合格，已原子流转至可发库存: {dest_dir}")
    except Exception as e:
        log(f"原子移动至已发送0次异常: {e}")

    send_toast("🎉 应用 C 半自动交付成功", f"{title} ({len(final_cards)}P 原版复刻无损原画 + 三平台文案已落盘)")
    log(f"🎉【全部工序圆满闭环】单套高品质方案已成功落盘！\n")
    return True

if __name__ == "__main__":
    asyncio.run(run_semi_auto_flow())
