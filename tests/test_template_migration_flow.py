import asyncio
import json
import os
import re
import sys
import time
import base64
import urllib.request
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')

# 添加 scripts 目录到 sys.path 以复用 InstanceWorker
SCRIPTS_DIR = r"D:\AICode\工具开发\projects\content-production-app\scripts"
if SCRIPTS_DIR not in sys.path:
    sys.path.append(SCRIPTS_DIR)

from dual_browser_autonomous_producer import InstanceWorker, _JS_COUNT_ATTACH

# 配置路径
TEMPLATE_IMG = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\04-技能库\参考库\Codex_API团建参考母版原创库\covers\REF-COVER-004.png"
MATERIAL_DIR = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\01-素材库\夏季（6—8月·智能分类）\泛流量\宜兴溧阳\评2-赞221-前几天刚去了溧阳赶紧整理下攻略送给有缘人瑞秋20260606"
OUTPUT_DIR = r"D:\AICode\工具开发\projects\content-production-app\tests\migration_output"
CDP_PORT = 9432  # 实例 B
INSTANCE_ID = "B"

async def upload_files_to_worker(worker: InstanceWorker, file_paths: list):
    """通过 CDP 稳定注入并挂载图片到富文本框"""
    print(f"\n[{INSTANCE_ID}] 准备上传图片 ({len(file_paths)} 张)...")
    for fp in file_paths:
        print(f"  - {os.path.basename(fp)}")

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

    # 清理残留
    try:
        await worker.send_cmd("Runtime.evaluate", {"expression": """(() => {
            const btns = Array.from(document.querySelectorAll('button[aria-label*="移除文件"], button[aria-label*="Remove file"]'));
            btns.forEach(b => { try { b.click(); } catch (e) {} });
            Array.from(document.querySelectorAll('input[type="file"]')).forEach(i => { try { i.value = ''; } catch (e) {} });
            return btns.length;
        })()""", "returnByValue": True}, timeout=10)
    except Exception:
        pass

    _cands = []
    _seen_nids = set()
    for _round in range(15):
        try:
            _doc = await worker.send_cmd("DOM.getDocument", {"depth": 1})
            _root = _doc.get('result', {}).get('root', {}).get('nodeId', 1)
        except Exception:
            _root = 1
        for _sel in _upload_sel_order:
            try:
                _nr = await worker.send_cmd("DOM.querySelector", {"nodeId": _root, "selector": _sel})
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
        raise RuntimeError("未找到文件上传 DOM 节点！")

    js_dispatch_generic = """(() => {
        const inp = document.querySelector('form input[type="file"]:not([disabled])');
        if (!inp) return false;
        inp.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        return true;
    })()"""

    async def _probe_attached():
        try:
            _r = await worker.send_cmd("Runtime.evaluate", {"expression": _JS_COUNT_ATTACH, "returnByValue": True}, timeout=10)
            return int(_r.get("result", {}).get("result", {}).get("value", 0) or 0)
        except Exception:
            return -1

    node_id = None
    for _sel, _nid in _cands:
        _el_id = _sel.split('#')[-1] if _sel.startswith('input#') else ''
        try:
            await worker.send_cmd("DOM.setFileInputFiles", {"nodeId": _nid, "files": file_paths}, timeout=25)
        except Exception as e:
            continue
        _js_disp = ("""(() => {
            const i = document.getElementById('%s');
            if (!i) return false;
            i.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            i.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            return true;
        })()""" % _el_id) if _el_id else js_dispatch_generic
        try:
            await worker.send_cmd("Runtime.evaluate", {"expression": _js_disp}, timeout=10)
        except Exception:
            pass
        for _w in range(8):
            await asyncio.sleep(1)
            _hit = await _probe_attached()
            if _hit > 0:
                node_id = _nid
                break
        if node_id:
            break

    if not node_id:
        raise RuntimeError("附件挂载失败，前端无缩略图产出！")

    # 轮询等待全部缩略图渲染
    target_count = len(file_paths)
    for _w in range(15):
        await asyncio.sleep(1)
        _cnt = await _probe_attached()
        if _cnt >= target_count:
            print(f"[{INSTANCE_ID}] 附件全部就绪 ({_cnt}/{target_count})")
            break
    worker._attached_count = len(file_paths)
    try:
        await worker.send_cmd("DOM.disable")
    except Exception:
        pass
    return True

async def send_turn(worker: InstanceWorker, prompt_text: str, desc: str):
    """发送对话轮次（重置节流时间保证测试连贯）"""
    worker._submit_gate = {"ts": 0.0}
    print(f"\n[{INSTANCE_ID}] >>> 发送: {desc} (长度: {len(prompt_text)})")
    ok = await worker.send_text_prompt(prompt_text, desc, max_wait_sec=30)
    if not ok:
        raise RuntimeError(f"发送指令失败: {desc}")
    print(f"[{INSTANCE_ID}] 指令已成功提交至 ChatGPT！等待模型响应...")

async def get_latest_reply(worker: InstanceWorker, max_wait_sec=180):
    """等待模型生成结束并提取最新一条助手回复"""
    await worker.wait_until_idle(max_wait_sec=max_wait_sec, reason="等待助手回复完成")
    js_asst = """(() => {
        const turns = Array.from(document.querySelectorAll('[data-testid^="conversation-turn-"], [data-message-author-role="assistant"]'));
        const asst = turns.filter(t => !t.querySelector('[data-message-author-role="user"]') && t.getAttribute('data-message-author-role') !== 'user');
        if (asst.length > 0) return asst[asst.length - 1].innerText;
        const articles = Array.from(document.querySelectorAll('article'));
        return articles.length > 0 ? articles[articles.length - 1].innerText : "";
    })()"""
    rc = await worker.send_cmd("Runtime.evaluate", {"expression": js_asst, "returnByValue": True}, timeout=15)
    txt = rc.get("result", {}).get("result", {}).get("value", "") or ""
    return txt.strip()

async def get_current_image_urls(worker: InstanceWorker):
    """获取当前页面上所有大图 URL 集合"""
    js = """(() => {
        const map = new Map();
        document.querySelectorAll('img').forEach(img => {
            const src = img.currentSrc || img.src || '';
            const alt = img.alt || '';
            if (alt.includes('个人资料') || alt.includes('profile') || alt.includes('avatar')) return;
            const w = img.naturalWidth || img.clientWidth || 0;
            const h = img.naturalHeight || img.clientHeight || 0;
            if (w < 200 || h < 200) return;
            const isGenSrc = src.includes('estuary') || src.includes('oaiusercontent') ||
                             src.includes('fileservice') || src.startsWith('blob:');
            if (!isGenSrc) return;
            const idMatch = src.match(/id=([^&]+)/) || src.match(/enc\\/([^?&#]+)/);
            const fileId = idMatch ? idMatch[1] : src;
            if (!map.has(fileId)) {
                map.set(fileId, src);
            }
        });
        return Array.from(map.values());
    })()"""
    rc = await worker.send_cmd("Runtime.evaluate", {"expression": js, "returnByValue": True}, timeout=15)
    return set(rc.get("result", {}).get("result", {}).get("value", []) or [])

async def poll_and_download_image(worker: InstanceWorker, dest_path: str, baseline_urls: set, max_wait_sec=360):
    """等待 DALL-E 新图片生成并下载到目标文件"""
    print(f"\n[{INSTANCE_ID}] 开始监测 DALL-E 出图进度 (最长等待 {max_wait_sec} 秒)...")
    deadline = time.time() + max_wait_sec
    while time.time() < deadline:
        gen, ml = await worker._page_generating_state()
        curr_urls = await get_current_image_urls(worker)
        new_urls = [u for u in curr_urls if u not in baseline_urls]
        
        if new_urls:
            print(f"[{INSTANCE_ID}] 探测到全新生成图已就绪 (新图数量: {len(new_urls)})！页面真生成状态: {gen}")
            if not gen:
                print(f"[{INSTANCE_ID}] 模型生成完成！开始下载最新生成图...")
                target_url = new_urls[-1]
                dl_js = """(async (url) => {
                    const r = await fetch(url, {credentials: 'include'});
                    const b = await r.blob();
                    return new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result.split(',')[1]);
                        reader.readAsDataURL(b);
                    });
                })"""
                r_b64 = await worker.send_cmd("Runtime.evaluate", {
                    "expression": f"({dl_js})({json.dumps(target_url)})",
                    "awaitPromise": True,
                    "returnByValue": True
                }, timeout=30)
                b64_str = r_b64.get("result", {}).get("result", {}).get("value")
                if b64_str:
                    raw_bytes = base64.b64decode(b64_str)
                    with open(dest_path, "wb") as f:
                        f.write(raw_bytes)
                    print(f"[{INSTANCE_ID}] ★ 成功下载图片至: {dest_path} (大小: {len(raw_bytes)/1024/1024:.2f} MB)")
                    return dest_path
                else:
                    print(f"[{INSTANCE_ID}] 提取图片 base64 暂未就绪，重试中...")
        else:
            print(f"[{INSTANCE_ID}] 正在生成中... (gen={gen}, mainLen={ml})")

        await asyncio.sleep(5)

    raise RuntimeError(f"等待大图生成超时 ({max_wait_sec} 秒)！")

async def run_migration_test():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    worker = InstanceWorker(INSTANCE_ID, CDP_PORT)
    await worker.connect()

    print("=" * 60)
    print("🚀 启动【模板工程学 / 风格迁移新架构】全流程实机验证")
    print("=" * 60)

    # 1. 开启纯净新会话
    print(f"\n[Step 0] 正在开启纯净新会话...")
    await worker.open_fresh_session()
    print(f"[Step 0] 纯净新会话开启成功！")

    # 2. Phase 1: 上传模板图并让 AI 吸收排版骨架
    print(f"\n[Phase 1] 模版学习阶段：上传标杆封面模板 REF-COVER-004...")
    if not os.path.exists(TEMPLATE_IMG):
        raise FileNotFoundError(f"未找到模板图片: {TEMPLATE_IMG}")
    await upload_files_to_worker(worker, [TEMPLATE_IMG])

    phase1_prompt = """请认真观察并分析这张参考图片（Image A）。这是小红书爆款个人自驾/户外攻略的标杆封面版式。
请你深入分析并吸收它的视觉排版与风格基因：
1. 视觉基底：纸张/手账米白质感背景，自然温润，彻底消除商业海报的塑料感与广告感；
2. 标题区层级：顶部大粗无衬线标题（手绘黑体质感）+ 手撕/马克笔黄色高亮信息条 + 极简手绘线稿微元素（如小山、叶片）；
3. 内容呈现窗口：多格圆角实拍窗口（真实自然光实拍，非AI精修大片），带细线框；
4. 色彩体系：自然纸白 + 墨绿/暖棕 + 黄橙高亮点缀。

【本次指令要求】：
请仅回复“已完全吸收 Image A 的视觉版式与风格骨架，请提供新素材与行程事实”，绝对不要开始出图，不要输出多余解释。"""

    await send_turn(worker, phase1_prompt, "Phase 1: 模板学习指令")
    reply1 = await get_latest_reply(worker, max_wait_sec=90)
    print(f"\n[Phase 1 模型确认回复]:\n{reply1}\n")

    # 3. Phase 2: 上传真实素材图并输出排版计划
    print(f"\n[Phase 2] 素材注入与套版排版计划阶段...")
    mat_imgs = [
        os.path.join(MATERIAL_DIR, "1.jpg"),
        os.path.join(MATERIAL_DIR, "2.jpg"),
        os.path.join(MATERIAL_DIR, "4.jpg")
    ]
    await upload_files_to_worker(worker, mat_imgs)

    phase2_prompt = """很好！现在为你提供本次制作的全新真实素材（图片与行程事实）：
【目的地】：江苏·溧阳（3天2晚周末自驾漫游慢攻略）
【核心行程事实】：
- Day1: 南山竹海、天目湖山水园、溧阳博物馆、报恩禅寺、方所文化村（夜游）
- Day2: 彩虹一号公路、平桥石坝、深溪芥村、别桥原乡、八字桥湿地赏落日
- Day3: 梦界方村、翡翠湖、十思园、瓦尔登书局、焦尾琴公园
- 预约指南：南山竹海、天目湖提前约；其余全免预约
- 美食清单：紫藤园鱼头、老街扎肝、乌米饭、香酥鸡烧饼、汽锅乌鸡汤

【套版设计任务】：
请严格以刚才吸收的 Image A（纸张手账风、真实实拍感、清晰信息层级）为【视觉骨架】，
以本套溧阳自驾攻略的【真实事实】为血肉，
设计一套符合小红书个人自驾爆款攻略的【P1封面排版计划】：
1. 顶部大标题文案与样式（要求：手绘大黑体、无AI营销腔、字数精炼，如“溧阳3天2晚自驾攻略”）；
2. 黄色高亮标签文案（提炼自真实事实，如“避开人潮，松弛感拉满”或“免预约清单+慢游路线”）；
3. 4个圆角实拍窗口的内容规划（对应溧阳真实风光：南山竹海翠绿、天目湖碧水、彩虹公路、方所文化村）；
4. 手绘线稿微元素（山野、茶园、自驾车等极简线稿）。
请输出你的详细排版计划，此时依然不要直接调用 DALL-E 画图！"""

    await send_turn(worker, phase2_prompt, "Phase 2: 注入事实与套版设计计划")
    reply2 = await get_latest_reply(worker, max_wait_sec=150)
    print(f"\n[Phase 2 模型排版计划]:\n{reply2}\n")

    # 4. Phase 3: 触发执行出图
    print(f"\n[Phase 3] 执行出图阶段：生成 P1 封面高清图...")
    baseline_urls = await get_current_image_urls(worker)
    print(f"[{INSTANCE_ID}] 出图前基线已有大图数: {len(baseline_urls)}")

    phase3_prompt = """排版计划非常完美！现在请严格按照你设计的排版计划，立即调用绘图工具生成【P1 封面高清大图】！
要求：
1. 尺寸比例严格 3:4 竖版（1086x1448）；
2. 完美迁移 Image A 的纸张温润质感、顶部手绘大黑体标题、黄色高亮标签、手绘线稿小图标、以及 2x2 四宫格自然光实拍窗口（分别展示南山竹海翠绿竹林、天目湖澄澈碧水、彩虹公路自驾蜿蜒、方所文化村夜景）；
3. 画面质感真实自然，完全像手机原相机在小红书分享的爆款攻略封面，严禁 AI 塑料光泽感；
4. 直接出图，不要输出废话！"""

    await send_turn(worker, phase3_prompt, "Phase 3: 触发生成 P1 封面大图")
    dest_cover = os.path.join(OUTPUT_DIR, "P1_溧阳模板迁移封面.png")
    saved_img = await poll_and_download_image(worker, dest_cover, baseline_urls=baseline_urls, max_wait_sec=360)

    print("\n" + "=" * 60)
    print(f"🎉 验证圆满成功！P1 封面图已成功落地: {saved_img}")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(run_migration_test())
