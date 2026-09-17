#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
成品库全景总台账生成与治理中控引擎 (Master Product Stock & Lifecycle Ledger)
功能：
1. 深度遍历成品库所有仓位（已发送0次、_制作中、根目录在制品、历史归档作品集）；
2. 读取各作品的 manifest.json / GPT作品记录.json，或通过 Pillow / verify_work_metadata 智能推导；
3. 提取 5 大核心维度：
   (a) 制作开始时间与完成时间 (createdAt, completedAt)
   (b) 被使用或发送的时间与次数 (distributedAt, usageCount)
   (c) 成品物理绝对路径 (productPath)
   (d) 成品使用的原素材物理绝对路径 (sourcePath)
   (e) 业务标签 (businessTags)、社交话题 (publishTopics)、生产模式与图片页数
4. 输出双格式持久化资产：
   - 机器真源 JSON：D:\\AICode\\运行数据\\江湖有旅人\\内容生产App\\master_product_ledger.json
   - 人类可读 Markdown：D:\\AICode\\项目推进\\projects\\江湖有旅人\\主项目\\成品库（GPT+本地脚本制作）\\成品库全景总台账.md
5. 附带秋季素材库中少于 5 张的 6 套精准流量素材专项目录。
"""

import os
import sys
import json
import re
import datetime
import pathlib

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

PROJECT_ROOT = pathlib.Path(r"D:\AICode\项目推进\projects\江湖有旅人\主项目")
OUTPUT_BASE = PROJECT_ROOT / "成品库（GPT+本地脚本制作）"
MATERIAL_AUTUMN = PROJECT_ROOT / r"01-素材库\秋季（9—11月·智能分类）"
RUNTIME_DIR = pathlib.Path(r"D:\AICode\运行数据\江湖有旅人\内容生产App")
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

LEDGER_JSON = RUNTIME_DIR / "master_product_ledger.json"
LEDGER_MD = OUTPUT_BASE / "成品库全景总台账.md"

IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp'}
TEXT_EXTS = {'.txt'}
LOCATIONS = ['安吉', '莫干山', '千岛湖', '桐庐', '苏州', '西山', '太湖', '上海', '杭州', '临安', '青山湖', '富阳', '宁波', '南京', '绍兴', '丽水', '舟山', '湖州', '长兴', '嘉兴', '阳澄湖']

def inspect_single_work(work_dir: pathlib.Path, bucket_name: str):
    name = work_dir.name
    # 模式判断
    mode = "Codex-API" if ("Codex" in name or "API" in name) else "Web-CDP"

    # 读取 manifest
    manifest = {}
    for mf_name in ["manifest.json", "GPT作品记录.json"]:
        mf_p = work_dir / mf_name
        if mf_p.exists():
            try:
                manifest = json.loads(mf_p.read_text(encoding='utf-8', errors='ignore'))
                break
            except Exception:
                pass

    # 扫描图片与文案
    images = [f for f in work_dir.rglob('*') if f.is_file() and f.suffix.lower() in IMAGE_EXTS and '原素材' not in f.parts]
    texts = [f for f in work_dir.rglob('*.txt') if f.is_file() and '原素材' not in f.parts]

    # 页码去重
    page_set = set()
    for img in images:
        m = re.search(r'P(\d+)', img.name, re.I)
        if m:
            page_set.add(int(m.group(1)))
    distinct_pages = len(page_set) if page_set else len(images)

    # 时间统计
    all_files = [f for f in work_dir.rglob('*') if f.is_file()]
    mtimes = [f.stat().st_mtime for f in all_files] if all_files else [work_dir.stat().st_mtime]
    birthtimes = [f.stat().st_ctime for f in all_files] if all_files else [work_dir.stat().st_ctime]
    
    start_time_ts = min(birthtimes + mtimes)
    end_time_ts = max(mtimes)
    start_time_str = datetime.datetime.fromtimestamp(start_time_ts).strftime('%Y-%m-%d %H:%M:%S')
    end_time_str = datetime.datetime.fromtimestamp(end_time_ts).strftime('%Y-%m-%d %H:%M:%S')

    created_at = manifest.get('timestamps', {}).get('createdAt') or manifest.get('created_at') or start_time_str
    completed_at = manifest.get('timestamps', {}).get('updatedAt') or end_time_str

    # 原素材路径推导
    raw_path_str = (
        manifest.get('sourcePath') or
        manifest.get('rawMaterialPath') or
        manifest.get('原素材绝对路径') or
        manifest.get('sourceMaterial') or
        ""
    )

    # 标签提炼
    business_tags = set(manifest.get('businessTags') or manifest.get('tags') or [])
    for loc in LOCATIONS:
        if loc in name:
            business_tags.add(loc)
    if any(k in name for k in ['秋', '国庆', '中秋', '蟹', '银杏']):
        business_tags.add('秋季')
    if any(k in name for k in ['2天1夜', '两天一夜', '2日']):
        business_tags.add('2天1夜')
    elif any(k in name for k in ['一日', '1日', '1天']):
        business_tags.add('1日游')
    
    category = "精准团建" if any(k in name for k in ['团建', '方案', 'HR', '公司']) else ("游戏破冰" if any(k in name for k in ['游戏', '破冰']) else "泛流量攻略")
    business_tags.add(category)

    # 话题提取
    topics = set(manifest.get('publishTopics') or [])
    for t in texts:
        try:
            c = t.read_text(encoding='utf-8', errors='ignore')
            topics.update(re.findall(r'#\S+', c))
        except Exception:
            pass

    # 状态与分发时间
    usage_count = 0
    distributed_at = None
    if bucket_name == "已发送0次（抖音小红书可发）":
        status = "READY_TO_DISTRIBUTE"
        usage_count = 0
    elif bucket_name == "_制作中":
        status = "PRODUCING"
    elif "已发送" in bucket_name or "已使用" in bucket_name:
        status = "DISTRIBUTED"
        usage_count = 1
        distributed_at = completed_at
    else:
        # 根目录作品
        has_copy = len(texts) > 0
        if distinct_pages >= 5 and has_copy:
            status = "COMPLETED_PENDING_MOVE"
        elif distinct_pages >= 1 and has_copy and category in ["泛流量攻略", "游戏破冰"]:
            status = "COMPLETED_PENDING_MOVE"
        else:
            status = "PRODUCING"

    planned_count = manifest.get('progress', {}).get('plannedImageCount') or manifest.get('plannedImageCount') or (10 if mode == "Web-CDP" else max(distinct_pages, 5))

    return {
        "workId": manifest.get('workId', f"work_{abs(hash(name)):x}"),
        "title": name,
        "bucket": bucket_name,
        "mode": mode,
        "category": category,
        "productPath": str(work_dir.resolve()),
        "sourcePath": raw_path_str,
        "imageCount": distinct_pages,
        "totalImageFiles": len(images),
        "plannedCount": planned_count,
        "hasCopyText": len(texts) > 0,
        "copyFiles": [t.name for t in texts],
        "businessTags": sorted(list(business_tags)),
        "publishTopics": sorted(list(topics))[:10],
        "timestamps": {
            "createdAt": created_at,
            "completedAt": completed_at,
            "distributedAt": distributed_at,
            "usageCount": usage_count
        },
        "status": status
    }

def scan_all_products():
    works = []
    
    # 1. 扫描 已发送0次（抖音小红书可发）
    stage0 = OUTPUT_BASE / "已发送0次（抖音小红书可发）"
    if stage0.exists():
        for d in sorted(stage0.iterdir()):
            if d.is_dir() and not d.name.startswith('.'):
                works.append(inspect_single_work(d, "已发送0次（抖音小红书可发）"))

    # 2. 扫描 _制作中
    producing = OUTPUT_BASE / "_制作中"
    if producing.exists():
        for d in sorted(producing.iterdir()):
            if d.is_dir() and not d.name.startswith('.'):
                works.append(inspect_single_work(d, "_制作中"))

    # 3. 扫描 根目录在制品
    for d in sorted(OUTPUT_BASE.iterdir()):
        if d.is_dir() and not d.name.startswith(('.', '_', '已发送', '作品集', '不合格', '发布空间', '归档', '抖音小红书')):
            works.append(inspect_single_work(d, "根目录暂存区"))

    # 4. 扫描 历史作品集 (作品集_XXX)
    for d in sorted(OUTPUT_BASE.iterdir()):
        if d.is_dir() and d.name.startswith("作品集_"):
            for sub in sorted(d.iterdir()):
                if sub.is_dir() and not sub.name.startswith('.'):
                    works.append(inspect_single_work(sub, d.name))

    return works

def scan_autumn_under_5_precision():
    results = []
    if not MATERIAL_AUTUMN.exists():
        return results
    for root, dirs, files in os.walk(MATERIAL_AUTUMN):
        imgs = [f for f in files if os.path.splitext(f)[1].lower() in IMAGE_EXTS]
        if imgs and len(imgs) < 5:
            if "精准流量" in root:
                tags_file = os.path.join(root, '.tags.json')
                tdata = {}
                if os.path.exists(tags_file):
                    try:
                        with open(tags_file, 'r', encoding='utf-8') as tf:
                            tdata = json.load(tf)
                    except Exception:
                        pass
                results.append({
                    "count": len(imgs),
                    "path": root,
                    "relPath": os.path.relpath(root, MATERIAL_AUTUMN),
                    "lifecycle": tdata.get('production', {}).get('lifecycleState', '未打标'),
                    "images": sorted(imgs)
                })
    return sorted(results, key=lambda x: x['count'])

def generate_report():
    print("开始扫描全库成品...")
    products = scan_all_products()
    print(f"共扫描出 {len(products)} 套成品！")

    print("扫描秋季少于 5 张的精准素材...")
    precision_under_5 = scan_autumn_under_5_precision()
    print(f"精准素材少于 5 张共有 {len(precision_under_5)} 套！")

    # 统计分类
    by_bucket = {}
    by_status = {}
    by_mode = {}
    for p in products:
        by_bucket.setdefault(p['bucket'], []).append(p)
        by_status.setdefault(p['status'], []).append(p)
        by_mode.setdefault(p['mode'], []).append(p)

    now_str = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    ledger_payload = {
        "version": "1.0.0",
        "generatedAt": now_str,
        "totalProducts": len(products),
        "statistics": {
            "byBucket": {k: len(v) for k, v in by_bucket.items()},
            "byStatus": {k: len(v) for k, v in by_status.items()},
            "byMode": {k: len(v) for k, v in by_mode.items()}
        },
        "precisionUnder5Materials": precision_under_5,
        "products": products
    }

    # 1. 写入机器真源 JSON
    with open(LEDGER_JSON, 'w', encoding='utf-8') as f:
        json.dump(ledger_payload, f, ensure_ascii=False, indent=2)
    print(f"已写入机器真源: {LEDGER_JSON}")

    # 2. 写入 Markdown 报表
    md = []
    md.append(f"# 📊【江湖有旅人】成品库全景总台账")
    md.append(f"> **生成时间**：`{now_str}` ｜ **数据基准**：本地成品库唯一物理真源\n")
    md.append(f"## 一、 全库宏观水位与库存汇总")
    md.append(f"| 统计维度 | 统计项 | 数量 | 说明 |")
    md.append(f"| :--- | :--- | :---: | :--- |")
    md.append(f"| **全库成品总量** | 总计 | **{len(products)} 套** | 覆盖所有仓位作品 |")
    md.append(f"| **可直接分发库存** | `已发送0次（可发库）` | **{len(by_bucket.get('已发送0次（抖音小红书可发）', []))} 套** | 手机端相册优先消费仓位 |")
    md.append(f"| **在制与暂存区** | `根目录暂存区` | **{len(by_bucket.get('根目录暂存区', []))} 套** | 15 套保持原状的在制品 |")
    md.append(f"| **历史已分发/归档** | `作品集容器/归档` | **{sum(len(v) for k, v in by_bucket.items() if k.startswith('作品集'))} 套** | 历史归档资产 |")
    md.append(f"| **生产模式分布** | `Codex-API` | **{len(by_mode.get('Codex-API', []))} 套** | 原素材驱动 5~20 张画册 |")
    md.append(f"| | `Web-CDP` | **{len(by_mode.get('Web-CDP', []))} 套** | 浏览器直连最多 10 张 |")
    md.append("")

    md.append(f"## 二、 重点关注：秋季素材库中少于 5 张的精准流量素材排查（共 {len(precision_under_5)} 套）")
    md.append(f"> 遵照指示：攻略类与游戏类（1~3张均可，共39套）全部保留；精准流量类（要求 $\\ge 5$ 张）仅有以下 6 套异常/极少样本：\n")
    md.append(f"| 序号 | 图片张数 | 相对路径 | 生产状态 | 图片明细 | 处置建议 |")
    md.append(f"| :---: | :---: | :--- | :---: | :--- | :--- |")
    for idx, item in enumerate(precision_under_5, 1):
        imgs_str = ", ".join(item['images'])
        advice = "单图素材，建议合并或转为泛流量攻略" if item['count'] == 1 else ("此前生产异常，建议人工核验原素材质量" if "异常" in item['lifecycle'] else "4张素材，建议扩充第5张或转泛流量")
        md.append(f"| {idx} | **{item['count']} 张** | `{item['relPath']}` | `{item['lifecycle']}` | {imgs_str} | {advice} |")
    md.append("")

    md.append(f"## 三、 全量成品明细清单（按仓位与状态排列）\n")
    
    # 分仓位展开
    for b_name in sorted(by_bucket.keys()):
        b_items = by_bucket[b_name]
        md.append(f"### 仓位：`{b_name}`（共 {len(b_items)} 套）\n")
        md.append(f"| 序号 | 作品标题 | 模式 | 类别 | 图数 | 文案 | 制作时间 | 分发/使用时间 | 状态 |")
        md.append(f"| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |")
        for i, it in enumerate(b_items, 1):
            t_str = it['timestamps']['createdAt'][:16] if it['timestamps']['createdAt'] else "—"
            d_str = it['timestamps']['distributedAt'][:16] if it['timestamps']['distributedAt'] else "未发送(0次)"
            copy_flag = "✅ 齐备" if it['hasCopyText'] else "❌ 缺失"
            md.append(f"| {i} | `{it['title'][:40]}` | {it['mode']} | {it['category']} | **{it['imageCount']}张** | {copy_flag} | {t_str} | {d_str} | `{it['status']}` |")
        md.append("")

    with open(LEDGER_MD, 'w', encoding='utf-8') as f:
        f.write("\n".join(md))
    print(f"已写入 Markdown 报表: {LEDGER_MD}")

if __name__ == '__main__':
    generate_report()
