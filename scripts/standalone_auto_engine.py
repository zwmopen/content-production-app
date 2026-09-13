# -*- coding: utf-8 -*-
"""
====================================================================
江湖有旅人 · 脱机全自动万套生产守护引擎 (Standalone Autonomous Production Daemon)
彻底脱离 AI 对话与客户端网络波动，作为 Windows 原生后台服务自主永续轮候生产。
====================================================================
"""
import os
import sys
import json
import time
import base64
import re
import datetime
import urllib.request
import asyncio
import websockets
import subprocess

sys.stdout.reconfigure(encoding='utf-8')

# ================= 基础路径配置 =================
BASE_DIR = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）"
DATA_DIR = os.path.join(BASE_DIR, "_作品历史数据")
DB_PATH = os.path.join(DATA_DIR, "作品历史数据库.json")
INVENTORY_PATH = os.path.join(DATA_DIR, "成品库全区域可用库存与缺口盘点总台账.md")
CROSS_PATH = os.path.join(DATA_DIR, "成品与素材对照总台账.md")
PLAN_PATH = os.path.join(DATA_DIR, "全区域无限自主生产排期与执行总计划.md")

RUNTIME_DIR = r"D:\AICode\运行数据\江湖有旅人\内容生产App"
USAGE_LEDGER = os.path.join(RUNTIME_DIR, "shared-material", "防重复账本", "material-usage-ledger.json")
STATUS_FILE = os.path.join(RUNTIME_DIR, "engine_status.json")
PRIORITY_QUEUE_FILE = os.path.join(RUNTIME_DIR, "priority_queue.json")
LOG_FILE = os.path.join(RUNTIME_DIR, "engine.log")

LARK_CLI = r"D:\AICode\工具开发\toolchains\npm-global\lark-cli.cmd"
CHAT_ID = "oc_4b71dccb1eabd19b1e5d4ef8e9a971e0"
MATERIAL_ROOT = r"D:\AICode\AI\data\01-团建策划-江湖有旅人\01-素材库\01-精准流量-团建类"

TARGET_CARDS = 8

# 双机实例定义
INSTANCES = {
    'A': {
        'port': 9431,
        'account': '账号1 (zwmrpg)',
        'master_id': '6a9f78aa-0348-83e8-867d-0a81d56244e1',
        'master_name': '「精准母版·团建方案」茶园路线节点封面 × 绿标手写拼图模板',
        'style': 'green_tea_route'
    },
    'C': {
        'port': 9433,
        'account': '账号3 (z x Plus)',
        'master_id': '6a25d73d-d838-83a9-a7f4-a2954b0a50f4',
        'master_name': '「浅紫信息清单封面 × 无白边四宫格民宿模板」',
        'style': 'purple_list_quad'
    }
}

# 区域轮候优先级与前缀映射
REGIONS_CONFIG = [
    {'name': '07-上海周边', 'prefix': 'SH'},
    {'name': '08-宁波',     'prefix': 'NB'},
    {'name': '09-舟山',     'prefix': 'ZS'},
    {'name': '12-宜兴溧阳', 'prefix': 'YX'},
    {'name': '10-金华义乌', 'prefix': 'JH'},
    {'name': '11-南京周边', 'prefix': 'NJ'},
    {'name': '13-绍兴周边', 'prefix': 'SX'},
    {'name': '14-特色拓展地', 'prefix': 'TS'},
    # 超额扩容阶梯全区域
    {'name': '01-安吉',     'prefix': 'AJ'},
    {'name': '02-莫干山',   'prefix': 'MG'},
    {'name': '03-千岛湖',   'prefix': 'QD'},
    {'name': '04-桐庐',     'prefix': 'TL'},
    {'name': '05-杭州周边', 'prefix': 'HZ'},
    {'name': '06-苏州周边', 'prefix': 'S'},
]

# 运行时全局状态缓存
ENGINE_STATE = {
    'started_at': datetime.datetime.now().isoformat(),
    'uptime_seconds': 0,
    'workers': {
        'A': {'status': 'IDLE', 'task': None, 'cardCount': 0, 'step': 'ready', 'elapsed': 0},
        'C': {'status': 'IDLE', 'task': None, 'cardCount': 0, 'step': 'ready', 'elapsed': 0}
    },
    'total_stock': 83,
    'total_gap': 77,
    'stock_rate': '51.9%',
    'completed_this_session': 0,
    'last_toast': None,
    'last_report': None
}

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
    ENGINE_STATE['last_toast'] = f"{title}: {message}"
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
    except Exception as e:
        log(f"Failed to send toast: {e}")

def send_feishu(title, text):
    if not os.path.exists(LARK_CLI):
        log("lark-cli not found, skipping feishu.")
        return False
    try:
        cmd = [LARK_CLI, "im", "+messages-send", "--chat-id", CHAT_ID, "--markdown", f"**{title}**\n\n{text}", "--format", "json"]
        res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', shell=True)
        log(f"[Feishu] Sent notification: code={res.returncode}")
        return res.returncode == 0
    except Exception as e:
        log(f"Failed to send Feishu: {e}")
        return False

# ================= 状态与台账管理 =================
def load_usage_ledger():
    if os.path.exists(USAGE_LEDGER):
        try:
            with open(USAGE_LEDGER, "r", encoding="utf-8") as f:
                return json.load(f)
        except: pass
    return {}

def save_usage_ledger(ledger):
    try:
        os.makedirs(os.path.dirname(USAGE_LEDGER), exist_ok=True)
        with open(USAGE_LEDGER, "w", encoding="utf-8") as f:
            json.dump(ledger, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log(f"Failed to save usage ledger: {e}")

def get_region_counts():
    counts = {}
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            for e in data.get("entries", []):
                bid = e.get("batch", "")
                for reg in REGIONS_CONFIG:
                    if bid.startswith(reg['prefix']):
                        counts[reg['name']] = counts.get(reg['name'], 0) + 1
        except Exception as e:
            log(f"Failed to read DB counts: {e}")
    return counts

def find_next_job(worker_id):
    """
    自驱动调度器：
    1. 优先读取 priority_queue.json（支持用户通过 AI 随时插入最高优先级生产任务）
    2. 无插单时，按万套无限阶梯轮候（以 10 套为一轮基线，完成则自动进入 +10 扩容）
    3. 严格遵循 0次优先，图片张数 >= 8
    4. 自动锁定避免双机冲突
    """
    # 1. 插单优先
    if os.path.exists(PRIORITY_QUEUE_FILE):
        try:
            with open(PRIORITY_QUEUE_FILE, "r", encoding="utf-8") as f:
                p_queue = json.load(f)
            if p_queue and len(p_queue) > 0:
                item = p_queue.pop(0)
                with open(PRIORITY_QUEUE_FILE, "w", encoding="utf-8") as f:
                    json.dump(p_queue, f, ensure_ascii=False, indent=2)
                log(f"[Scheduler-{worker_id}] ⚡ 优先消费用户插单: {item.get('title', item.get('folder_name'))}")
                return item
        except: pass

    # 2. 无限阶梯轮候
    ledger = load_usage_ledger()
    counts = get_region_counts()

    # 计算当前所处的轮次（10套/轮，20套/轮...）
    round_num = 1
    while round_num <= 1000:
        target_per_region = round_num * 10
        candidate_regions = []
        for reg in REGIONS_CONFIG[:8]:
            cur_cnt = counts.get(reg['name'], 0)
            if cur_cnt < target_per_region:
                candidate_regions.append((cur_cnt, reg))

        if not candidate_regions:
            for reg in REGIONS_CONFIG[8:]:
                cur_cnt = counts.get(reg['name'], 0)
                if cur_cnt < target_per_region:
                    candidate_regions.append((cur_cnt, reg))

        if not candidate_regions:
            round_num += 1
            continue

        candidate_regions.sort(key=lambda x: x[0])

        for cur_cnt, reg in candidate_regions:
            rpath = os.path.join(MATERIAL_ROOT, reg['name'])
            if not os.path.exists(rpath): continue

            cands = []
            for root, dirs, files in os.walk(rpath):
                imgs = [f for f in files if f.lower().endswith(('.jpg', '.png', '.jpeg'))]
                if len(imgs) >= 8:
                    u_info = ledger.get(root, {})
                    u_cnt = u_info.get("usageCount", 0)
                    is_locked = u_info.get("status") == "in_progress"
                    if u_cnt == 0 and not is_locked:
                        cands.append((len(imgs), root, os.path.basename(root)))

            if cands:
                cands.sort(key=lambda x: -x[0])
                chosen_img_cnt, chosen_path, chosen_name = cands[0]
                batch_num = cur_cnt + 1
                batch_id = f"{reg['prefix']}{batch_num:02d}"

                if chosen_path not in ledger:
                    ledger[chosen_path] = {}
                ledger[chosen_path]["status"] = "in_progress"
                ledger[chosen_path]["worker"] = worker_id
                ledger[chosen_path]["locked_at"] = datetime.datetime.now().isoformat()
                save_usage_ledger(ledger)

                log(f"[Scheduler-{worker_id}] 🎯 选中素材 [{batch_id}·第{round_num}轮]: {chosen_name} ({chosen_img_cnt}图)")
                return {
                    'batch': batch_id,
                    'region': reg['name'],
                    'material_path': chosen_path,
                    'folder_name': chosen_name,
                    'round': round_num
                }

        round_num += 1

    return None

def clean_title_and_tags(folder_name, region_name):
    title = folder_name
    title = re.sub(r'^[0-9_\-\.评赞获赞\s]+', '', title)
    title = re.sub(r'[评赞0-9]+', '', title)
    title = re.sub(r'[，。！？\s]+', '', title)
    if len(title) < 6:
        title = f"{region_name.split('-')[-1]}高端特色团队定制方案"
    clean_region = region_name.split('-')[-1]
    tags = [f"{clean_region}团建", "公司团建", "部门团建", "团建方案", "江浙沪团建", "HR抄作业"]
    return title[:28], tags

def build_prompt_and_copy(job, instance_config):
    folder_name = job['folder_name']
    region_name = job['region']
    batch_id = job['batch']
    title, tags = clean_title_and_tags(folder_name, region_name)
    style = instance_config['style']

    if style == 'green_tea_route':
        prompt = f"""【{batch_id}·{title}·立即出图】
本次已上传 9 张实景高清参考图，主题为【{region_name}·{title}】。
文案概要：
江浙沪公司团建宝藏目的地！{region_name}特色深度定制团建全攻略！独栋私密包场+特色美食飨宴+王牌户外项目+夜间狂欢轰趴，人均高性价比全包，老板同事都夸爆，HR直接抄作业！

【出图与文案要求】：
1. 完整读取本次上传的实拍参考图，提取核心风景、独栋场地、特色餐饮与团队玩乐视觉；
2. 严格遵循本母版视觉系统（茶园路线节点封面 × 绿标手写拼图模板，突出清新绿标、手写质感点缀、路线节点清晰、去除杂乱水印与文字）；
3. 请立即逐张输出 P1 到 P8 的全部 8 张独立高清大图（每张均为 3:4 竖版独立单图，切勿拼在一张图内！）：
   - P1_封面：路线节点封面（主标题：{title}，绿标手写标签标注王牌亮点）；
   - P2：玩法亮点与实景拼图（特色场地、自然风光、地道美食、团队互动）；
   - P3：私密独栋包场/特色住宿环境展示；
   - P4：特色饕餮大餐与地道风味美食特写；
   - P5：王牌户外体验/团建拓展高光瞬间；
   - P6：夜间狂欢/星空篝火/炭火BBQ与音乐轰趴；
   - P7：2天1夜/1日游舒适时间线排期表（几点集合、几点游玩、晚间轰趴一目了然）；
   - P8：公司团建一站式定制保障，评论区留【人数+天数】秒发专属定制PDF方案与阶梯报价。
4. 输出完整小红书双端文案（严格使用<<<COPY_FORMAT:2>>>与<<<XHS_START>>>格式，包含标题、正文与黄金标签）。"""

    else:
        prompt = f"""【{batch_id}·{title}·立即出图】
本次已上传 9 张实景高清参考图，主题为【{region_name}·{title}】。
文案概要：
江浙沪团建天花板！{region_name}深度慢度假团建全攻略！独栋私密民宿包栋+特色盛宴+自然治愈轻户外+星空民谣轰趴，人均超高性价比，老板带头夸，HR直接抄作业！

【出图与文案要求】：
1. 完整读取本次上传的素材图片，提取原生态实景大图、四宫格细节对比与自然风光；
2. 严格遵循本母版视觉系统（浅紫信息清单封面 × 无白边四宫格民宿模板，突出信息清单式排版、四宫格细节对比、清新浅紫标签，去除水印与杂乱文字）；
3. 请立即逐张输出 P1 到 P8 的全部 8 张独立高清大图（每张均为 3:4 竖版独立单图，切勿拼在一张图内！）：
   - P1_封面：信息清单封面（主标题：{title}，浅紫标签标注核心特色）；
   - P2：玩法亮点与四宫格细节对比实拍；
   - P3：私密独栋空间与自然风光大景；
   - P4：地道风味盛宴与特色美食诱人特写；
   - P5：户外探索打卡与团队轻松漫游；
   - P6：夜幕降临星空BBQ与私密音乐轰趴之夜；
   - P7：超舒适时间线行程排期表；
   - P8：一站式定制保障服务，评论区留【人数+天数】秒发专属定制PDF方案。
4. 输出完整小红书双端文案（严格使用<<<COPY_FORMAT:2>>>与<<<XHS_START>>>格式，包含标题、正文与黄金标签）。"""

    copy_text = f"""<<<COPY_FORMAT:2>>>
<<<XHS_START>>>
标题：{title}🏡被全公司夸爆的神仙团建方案直接抄
 
正文：
逃离城市喧嚣！去{region_name}来一场彻底治愈所有内卷的团队outing！
独栋私密整栋包场🏡+特色美食吃到爽🍲+王牌户外互动体验🎯+星空炭火BBQ轰趴🍖！
人均亲民吃住游全包，老板带头夸，员工全员发朋友圈炫耀！
 
📍【方案基本信息】
▪️ 目的地：浙江/江浙沪·{region_name}
▪️ 适用人数：15-100人（年轻化团队/部门团建/企业中高层outing）
▪️ 活动时长：1日高性价比精选游 / 2天1夜休闲慢度假
▪️ 参考预算：人均280-580元全包（场地+大巴+特色正餐+户外门票+烧烤+全额意外险）
 
🔥【4大王牌玩法亮点】
1️⃣ 私密独栋包场空间🏡：超大公区、KTV桌游、草坪露营、私密不被打扰！
2️⃣ 特色地道舌尖盛宴🍲：当地农家特色土菜/现捞海鲜，鲜掉眉毛！
3️⃣ 多巴胺户外轻互动🎯：趣味飞盘、山地越野、草坪破冰，秒热场不尴尬！
4️⃣ 晚间星空炭火BBQ🍖：坐在星空下吹晚风，烤肉滋滋冒油，啤酒民谣治愈一切！
 
📅【2天1夜经典行程参考】
DAY 1：
✨ 09:00-11:00｜专车大巴直达目的地，欢声笑语破冰出发
✨ 11:30-13:00｜品尝当地地道特色风味午宴
✨ 13:30-16:30｜王牌户外趣味互动 / 景区轻徒步打卡拍照
✨ 17:00-18:00｜入住特色独栋空间，稍作休整
✨ 18:00-20:30｜草坪炭火星空烧烤BBQ + 音乐民谣狂欢之夜
✨ 20:30-深夜｜独栋轰趴自由畅玩，狼人杀德州桌游通宵局！
DAY 2：
✨ 08:30-09:30｜睡到自然醒，享用元气早餐
✨ 09:30-11:30｜原生态古镇漫步 / 拍照打卡自由采风
✨ 12:00-13:00｜品尝庆功特色午宴
✨ 13:30-满载惬意舒适返程！
 
💡【一站式定制保障服务】
▫️ 专属团建策划师1对1对接，行程餐标随心调整
▫️ 专业领队跟团主持，全程单反摄影跟拍大片
▫️ 赠送每人保额80万旅游人身意外险
 
📩 想要完整方案与详细报价明细：
👉 评论区留【人数+天数】，秒发专属定制PDF方案！
 
标签：
{' '.join(['#' + t for t in tags])}
<<<XHS_END>>>"""

    return title, prompt, copy_text, tags

# ================= CDP 驱动内核 =================
async def dispatch_task(worker_id, job):
    cfg = INSTANCES[worker_id]
    port = cfg['port']
    material_path = job['material_path']
    title, prompt, copy_text, tags = build_prompt_and_copy(job, cfg)

    all_files = sorted([os.path.join(material_path, f) for f in os.listdir(material_path) if f.lower().endswith(('.jpg', '.png', '.jpeg'))])[:10]
    log(f"[{worker_id}] 正在上传 {len(all_files)} 张素材图片...")

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    tabs = json.loads(opener.open(f"http://127.0.0.1:{port}/json/list").read().decode('utf-8'))
    tab = [t for t in tabs if 'chatgpt.com' in t.get('url', '')][0]

    async with websockets.connect(tab['webSocketDebuggerUrl'], max_size=100*1024*1024) as ws:
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
        log(f"[{worker_id}] 文件已上传，等待 6 秒就位...")
        await asyncio.sleep(6)

        await ws.send(json.dumps({'id': 5, 'method': 'Runtime.evaluate', 'params': {'expression': """(() => { const b = document.querySelector('button[aria-label="关闭"]'); if (b) b.click(); })()"""}}))
        await ws.recv()

        p_json = json.dumps(prompt)
        js_input = f"""(() => {{
            const ta = document.querySelector('#prompt-textarea');
            if (!ta) return false;
            ta.focus();
            ta.innerHTML = '<p>' + {p_json} + '</p>';
            ta.dispatchEvent(new Event('input', {{ bubbles: true }}));
            return true;
        }})()"""
        await ws.send(json.dumps({'id': 6, 'method': 'Runtime.evaluate', 'params': {'expression': js_input, 'returnByValue': True}}))
        await ws.recv()
        await asyncio.sleep(2)

        js_send = """(() => {
            const btn = document.querySelector('#composer-submit-button, button[data-testid="send-button"]');
            if (btn && !btn.disabled) { btn.click(); return true; }
            return false;
        })()"""
        await ws.send(json.dumps({'id': 7, 'method': 'Runtime.evaluate', 'params': {'expression': js_send, 'returnByValue': True}}))
        await ws.recv()
        log(f"[{worker_id}] 🚀 任务派单成功！进入全自主出图监控期...")

    job['title'] = title
    job['copy_text'] = copy_text
    job['tags'] = tags
    job['dispatched_at'] = datetime.datetime.now().isoformat()
    return job

async def monitor_and_export(worker_id, job):
    cfg = INSTANCES[worker_id]
    port = cfg['port']
    log(f"[{worker_id}] 正在轮询检测卡片生成状态...")

    start_t = time.time()
    for cycle in range(180): # 最长等待 30 分钟
        await asyncio.sleep(10)
        elapsed = int(time.time() - start_t)
        ENGINE_STATE['workers'][worker_id]['elapsed'] = elapsed

        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            tabs = json.loads(opener.open(f"http://127.0.0.1:{port}/json/list").read().decode('utf-8'))
            tab = [t for t in tabs if 'chatgpt.com' in t.get('url', '')][0]

            async with websockets.connect(tab['webSocketDebuggerUrl'], max_size=50*1024*1024) as ws:
                js_check = """(() => {
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
                            unique.push({ fid, src: i.src });
                        }
                    }
                    const stopBtn = document.querySelector('button[aria-label="停止生成"], button[data-testid="stop-button"]');
                    const text = lastTurn ? lastTurn.innerText : '';
                    return {
                        isGenerating: !!stopBtn,
                        count: unique.length,
                        hasWait1: text.includes('回复 1') || text.includes('回复1') || text.includes('输入 1') || text.includes('输入1')
                    };
                })()"""
                await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': js_check, 'returnByValue': True}}))
                raw = await ws.recv()
                val = json.loads(raw).get('result', {}).get('result', {}).get('value', {})
                is_gen = val.get('isGenerating', False)
                cnt = val.get('count', 0)
                has_w1 = val.get('hasWait1', False)

                ENGINE_STATE['workers'][worker_id]['cardCount'] = cnt
                ENGINE_STATE['workers'][worker_id]['isGenerating'] = is_gen
                log(f"[{worker_id}][{elapsed}s] 状态: isGen={is_gen}, cards={cnt}/{TARGET_CARDS}")

                if has_w1 and not is_gen:
                    log(f"[{worker_id}] 🤖 检测到等待回复 1，自动注入推进指令...")
                    js_1 = """(() => {
                        const ta = document.querySelector('#prompt-textarea');
                        if (ta) {
                            ta.innerHTML = '<p>1请立即调用生图工具，逐张生成 P1 到 P8 全部 8 张 3:4 竖版独立高清卡片大图（每张均为独立出图，切勿拼图），并输出小红书完整文案！</p>';
                            ta.dispatchEvent(new Event('input', { bubbles: true }));
                            setTimeout(() => {
                                const btn = document.querySelector('#composer-submit-button, button[data-testid="send-button"]');
                                if (btn && !btn.disabled) btn.click();
                            }, 500);
                        }
                    })()"""
                    await ws.send(json.dumps({'id': 2, 'method': 'Runtime.evaluate', 'params': {'expression': js_1}}))
                    await ws.recv()
                    await asyncio.sleep(5)
                    continue

                if cnt >= TARGET_CARDS and not is_gen:
                    log(f"[{worker_id}] ✨ 全部 {cnt} 张卡片渲染完毕！开始使用 Blob-to-Canvas 无损极速导出...")
                    break
        except Exception as e:
            log(f"[{worker_id}] 轮询捕获异常 (短连接自愈重试): {e}")

    await export_cards(worker_id, job)

async def export_cards(worker_id, job):
    cfg = INSTANCES[worker_id]
    port = cfg['port']
    now_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    dest_name = f"{now_str}_{job['title']}"
    dest_path = os.path.join(BASE_DIR, dest_name)
    os.makedirs(dest_path, exist_ok=True)
    ENGINE_STATE['workers'][worker_id]['step'] = 'exporting'

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    tabs = json.loads(opener.open(f"http://127.0.0.1:{port}/json/list").read().decode('utf-8'))
    tab = [t for t in tabs if 'chatgpt.com' in t.get('url', '')][0]

    async with websockets.connect(tab['webSocketDebuggerUrl'], max_size=100*1024*1024) as ws:
        js_get = """(() => {
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
                    unique.push({ fid, src: i.src });
                }
            }
            return unique;
        })()"""
        await ws.send(json.dumps({'id': 100, 'method': 'Runtime.evaluate', 'params': {'expression': js_get, 'returnByValue': True}}))
        raw = await ws.recv()
        cards = json.loads(raw).get('result', {}).get('result', {}).get('value', [])
        log(f"[{worker_id}] 捕获到 {len(cards)} 张卡片，开始逐张转码...")

        exported = []
        for idx in range(min(TARGET_CARDS, len(cards))):
            c = cards[idx]
            name = "P1_封面.png" if idx == 0 else f"P{idx+1}.png"
            p_dest = os.path.join(dest_path, name)

            js_convert = f"""(async () => {{
                try {{
                    const resp = await fetch({json.dumps(c['src'])});
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
                    const b64 = canvas.toDataURL('image/png').split(',')[1];
                    return {{ ok: true, w: canvas.width, h: canvas.height, b64: b64 }};
                }} catch (e) {{
                    return {{ ok: false, err: e.message }};
                }}
            }})()"""
            await ws.send(json.dumps({'id': 200 + idx, 'method': 'Runtime.evaluate', 'params': {'expression': js_convert, 'awaitPromise': True, 'returnByValue': True}}))
            raw_exp = await ws.recv()
            res = json.loads(raw_exp).get('result', {}).get('result', {}).get('value', {})
            if res.get('ok') and res.get('b64'):
                img_bytes = base64.b64decode(res['b64'])
                with open(p_dest, 'wb') as f:
                    f.write(img_bytes)
                sz_mb = len(img_bytes) / (1024*1024)
                log(f"  [{worker_id}] -> 成功导出 {name} ({res['w']}x{res['h']}, {sz_mb:.2f} MB)")
                exported.append((name, sz_mb))
            else:
                log(f"  [{worker_id}] -> 导出失败 {name}: {res.get('err')}")

    with open(os.path.join(dest_path, "小红书文案.txt"), "w", encoding="utf-8") as f:
        f.write(job['copy_text'])

    tags_data = {
        "batch": job['batch'],
        "title": job['title'],
        "account": cfg['account'],
        "master": cfg['master_name'],
        "branch_url": f"https://chatgpt.com/c/{cfg['master_id']}",
        "tags": job['tags']
    }
    with open(os.path.join(dest_path, "作品标签.json"), "w", encoding="utf-8") as f:
        json.dump(tags_data, f, ensure_ascii=False, indent=2)

    with open(os.path.join(dest_path, "会话追踪.txt"), "w", encoding="utf-8") as f:
        f.write(f"会话分支: https://chatgpt.com/c/{cfg['master_id']}\n账号: {cfg['account']}\n执行时间: {datetime.datetime.now().isoformat()}\n生成卡片: {len(exported)} 张\n")

    total_sz_mb = sum([s for n, s in exported])
    await sync_ledgers_after_harvest(worker_id, job, dest_name, len(exported), total_sz_mb)

async def sync_ledgers_after_harvest(worker_id, job, dest_name, card_count, total_sz_mb):
    cfg = INSTANCES[worker_id]
    batch_id = job['batch']
    title = job['title']
    mat_path = job['material_path']
    region_name = job['region']

    # 1. 解除锁定并累加
    ledger = load_usage_ledger()
    if mat_path not in ledger:
        ledger[mat_path] = {}
    ledger[mat_path]["status"] = "available"
    ledger[mat_path]["usageCount"] = ledger[mat_path].get("usageCount", 0) + 1
    ledger[mat_path]["lastUsed"] = datetime.datetime.now().isoformat()
    ledger[mat_path]["lastProduct"] = dest_name
    save_usage_ledger(ledger)

    # 2. 更新本地 .tags.json
    try:
        mt_file = os.path.join(mat_path, ".tags.json")
        mt = json.load(open(mt_file, "r", encoding="utf-8")) if os.path.exists(mt_file) else {}
        mt["usageCount"] = mt.get("usageCount", 0) + 1
        mt["lastUsed"] = datetime.datetime.now().isoformat()
        json.dump(mt, open(mt_file, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    except: pass

    # 3. 写入作品数据库
    try:
        with open(DB_PATH, "r", encoding="utf-8") as f:
            db = json.load(f)
        new_entry = {
            "batch": batch_id,
            "title": title,
            "dir_name": dest_name,
            "region": region_name,
            "category": f"{region_name}/特色定制",
            "date": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "account": cfg['account'],
            "master_template": cfg['master_name'],
            "cards_count": card_count,
            "total_size_mb": round(total_sz_mb, 2),
            "source_material": mat_path,
            "branch_url": f"https://chatgpt.com/c/{cfg['master_id']}",
            "tags": job['tags']
        }
        db["entries"].append(new_entry)
        db["total_count"] = len(db["entries"])
        db["last_updated"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(DB_PATH, "w", encoding="utf-8") as f:
            json.dump(db, f, ensure_ascii=False, indent=2)
        log(f"[{worker_id}] 数据库已回写！当前大盘总入库: {len(db['entries'])}")
    except Exception as e:
        log(f"[{worker_id}] 数据库写入失败: {e}")

    # 4. 更新盘点表与对照表
    try:
        counts = get_region_counts()
        total_stock = sum(counts.values())
        total_gap = sum([max(0, 10 - counts.get(r['name'], 0)) for r in REGIONS_CONFIG[:8]])
        total_rate = (total_stock / 160.0) * 100

        ENGINE_STATE['total_stock'] = total_stock
        ENGINE_STATE['total_gap'] = total_gap
        ENGINE_STATE['stock_rate'] = f"{total_rate:.1f}%"
        ENGINE_STATE['completed_this_session'] += 1

        if os.path.exists(CROSS_PATH):
            with open(CROSS_PATH, "r", encoding="utf-8") as f:
                cross_txt = f.read()
            dest_url = os.path.join(BASE_DIR, dest_name).replace("\\", "/")
            mat_url = mat_path.replace("\\", "/")
            new_row = f"| {batch_id} | [{title}](file:///{dest_url}) | {card_count}P ({total_sz_mb:.2f} MB) | [{job['folder_name']}](file:///{mat_url}) (9图) | {cfg['account']} | {cfg['master_name']} | {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')} |\n"
            if f"| {batch_id} |" not in cross_txt:
                cross_txt += "\n" + new_row
                with open(CROSS_PATH, "w", encoding="utf-8") as f:
                    f.write(cross_txt)
                log(f"[{worker_id}] 对照总台账已同步！")
    except Exception as e:
        log(f"[{worker_id}] 台账同步失败: {e}")

    # 5. 触发即时桌面气泡
    toast_title = f"🎉 生产完成: {batch_id} {title[:16]}"
    toast_body = f"8P纯原画无损落盘 ({total_sz_mb:.1f} MB)！\n当前全库现货: {ENGINE_STATE['total_stock']} 套 (达标率 {ENGINE_STATE['stock_rate']})！"
    send_toast(toast_title, toast_body)

# ================= 永续工作者循环 =================
async def worker_loop(worker_id):
    log(f"[Worker-{worker_id}] 🚀 工作线程已启动，进入 7x24 无限轮候生产循环...")
    while True:
        try:
            ENGINE_STATE['workers'][worker_id]['status'] = 'IDLE'
            ENGINE_STATE['workers'][worker_id]['step'] = 'picking_material'

            job = find_next_job(worker_id)
            if not job:
                log(f"[Worker-{worker_id}] 暂无可产出素材，休眠 30 秒后重试...")
                await asyncio.sleep(30)
                continue

            ENGINE_STATE['workers'][worker_id]['status'] = 'PRODUCING'
            ENGINE_STATE['workers'][worker_id]['task'] = f"{job['batch']} {job['folder_name'][:20]}"
            ENGINE_STATE['workers'][worker_id]['step'] = 'dispatching'

            dispatched_job = await dispatch_task(worker_id, job)

            ENGINE_STATE['workers'][worker_id]['step'] = 'monitoring'
            await monitor_and_export(worker_id, dispatched_job)

            log(f"[Worker-{worker_id}] ✅ 任务 {job['batch']} 完整生命周期收官！立即无缝衔接下一套...")
            await asyncio.sleep(5)

        except Exception as e:
            log(f"[Worker-{worker_id}] ⚠️ 循环执行异常: {e}，将在 15 秒后自愈重试...")
            await asyncio.sleep(15)

# ================= 定时双报与状态守护 =================
async def report_daemon():
    log("[ReportDaemon] ⏰ 定时双报守护线程已启动 (早报10:15 / 晚报19:30)...")
    last_reported_minute = None

    while True:
        await asyncio.sleep(15)
        now = datetime.datetime.now()
        cur_hm = now.strftime("%H:%M")

        if cur_hm in ["10:15", "19:30"] and cur_hm != last_reported_minute:
            last_reported_minute = cur_hm
            report_type = "早报" if cur_hm == "10:15" else "晚报"
            log(f"[ReportDaemon] 触发【{report_type}】自动汇总与发送...")

            try:
                counts = get_region_counts()
                total_stock = sum(counts.values())
                total_gap = sum([max(0, 10 - counts.get(r['name'], 0)) for r in REGIONS_CONFIG[:8]])
                rate = (total_stock / 160.0) * 100

                title = f"📢 江湖有旅人·内容生产自主流水线【{report_type}】"
                content = f"""**统计时段**：{cur_hm} 全天候产出报告
**全库现货总库存**：{total_stock} 套（纯无损 8P 高清原画）
**基线保障总缺口**：{total_gap} 套
**基线综合达标率**：{rate:.1f}%

**各攻坚大区实时盘点**：
"""
                for reg in REGIONS_CONFIG[:8]:
                    c = counts.get(reg['name'], 0)
                    g = max(0, 10 - c)
                    status_icon = "✅ 收官" if g == 0 else "🚨 攻坚"
                    content += f"- {status_icon} **{reg['name']}**：已产 {c}/10 套（缺口 {g} 套）\n"

                content += f"\n**运行守护机制**：脱机会话独立常驻守护引擎正常运行，双机并发自主轮候中。"

                send_feishu(title, content)
                send_toast(title, f"全库现货突破 {total_stock} 套，达标率 {rate:.1f}%！报告已同步至飞书群！")
                ENGINE_STATE['last_report'] = f"{cur_hm} {report_type}"

            except Exception as e:
                log(f"[ReportDaemon] 定时报告发送失败: {e}")

async def status_writer():
    while True:
        try:
            now = datetime.datetime.now()
            start_dt = datetime.datetime.fromisoformat(ENGINE_STATE['started_at'])
            ENGINE_STATE['uptime_seconds'] = int((now - start_dt).total_seconds())

            os.makedirs(os.path.dirname(STATUS_FILE), exist_ok=True)
            with open(STATUS_FILE, "w", encoding="utf-8") as f:
                json.dump(ENGINE_STATE, f, ensure_ascii=False, indent=2)
        except: pass
        await asyncio.sleep(5)

# ================= 引擎入口 =================
async def main():
    log("====================================================================")
    log("  江湖有旅人 · 脱机全自动万套生产守护引擎 (Autonomous Production Daemon)  ")
    log("  双机并发调度 (Port 9431 & 9433) · 无限任务阶梯扩容 · 彻底脱离 AI 会话  ")
    log("====================================================================")

    await asyncio.gather(
        worker_loop('A'),
        worker_loop('C'),
        report_daemon(),
        status_writer()
    )

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("引擎已由用户手动中止。")
