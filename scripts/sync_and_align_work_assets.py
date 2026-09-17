#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_and_align_work_assets.py - 成品资产三端对齐与相册 APK 兼容同步引擎
核心职能：
1. 单文件文案对齐：若存在 三平台文案.txt 但缺失 文案.txt，自动同步生成 文案.txt（适配手机相册 APK 优先识别）；
2. 大图根目录对齐：若 产出素材/ 中有大图但作品根目录无图，自动复制大图至根目录（解决手机相册 ZipWorkScanner / iOS WorkScanner 穿透无法识别子目录大图的断层）；
3. 标准元数据对齐：刷新并补齐 manifest.json，消除元数据断层。
"""

import os
import sys
import json
import shutil
import pathlib
import re

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp'}
BASE_DIR = pathlib.Path(r"D:\AICode\项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）")

def sync_work_folder(work_path: pathlib.Path, dry_run=False):
    rel_name = work_path.name
    actions = []
    
    # 1. 检查文案
    txt_wenan = work_path / "文案.txt"
    txt_sanpingtai = work_path / "三平台文案.txt"
    
    if not txt_wenan.exists():
        if txt_sanpingtai.exists():
            if not dry_run:
                shutil.copy2(txt_sanpingtai, txt_wenan)
            actions.append("同步生成 文案.txt (来自 三平台文案.txt)")
        else:
            # 查找其他文案
            other_txts = [f for f in work_path.iterdir() if f.is_file() and f.suffix == '.txt' and not f.name.startswith(('日志', '会话', '提示', '.'))]
            if other_txts:
                if not dry_run:
                    shutil.copy2(other_txts[0], txt_wenan)
                actions.append(f"同步生成 文案.txt (来自 {other_txts[0].name})")

    # 2. 检查大图与根目录对齐（解决手机相册 APK / iOS 相册扫描断层）
    root_imgs = [f for f in work_path.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_EXTS]
    sub_mat = work_path / "产出素材"
    if len(root_imgs) == 0 and sub_mat.exists() and sub_mat.is_dir():
        sub_imgs = [f for f in sub_mat.iterdir() if f.is_file() and f.suffix.lower() in IMAGE_EXTS]
        if sub_imgs:
            if not dry_run:
                for img in sub_imgs:
                    shutil.copy2(img, work_path / img.name)
            actions.append(f"将 产出素材/ 下 {len(sub_imgs)} 张大图对齐复制至根目录（适配移动端相册）")

    # 3. 检查并更新 manifest.json
    manifest_path = work_path / "manifest.json"
    manifest_data = {}
    if manifest_path.exists():
        try:
            manifest_data = json.loads(manifest_path.read_text(encoding='utf-8', errors='ignore'))
        except Exception:
            pass

    # 重新统计大图
    curr_imgs = [f for f in work_path.rglob('*') if f.is_file() and f.suffix.lower() in IMAGE_EXTS and '原素材' not in f.parts]
    page_indices = set()
    for img in curr_imgs:
        m = re.search(r'P(\d+)', img.name, re.I)
        if m:
            page_indices.add(int(m.group(1)))
    distinct_pages = len(page_indices) if page_indices else len(curr_imgs)

    # 模式自适应规划数
    mode = "Codex-API" if ("Codex" in rel_name or "API" in rel_name) else "Web-CDP"
    is_guide_or_game = any(k in rel_name for k in ['攻略', '路线', '游戏', '破冰', 'Citywalk', '合集', '玩法'])
    
    planned = manifest_data.get('progress', {}).get('plannedImageCount') or manifest_data.get('页数') or manifest_data.get('imageCount') or 0
    if not planned:
        if is_guide_or_game and distinct_pages > 0 and distinct_pages < 5:
            planned = distinct_pages
        elif mode == 'Web-CDP':
            planned = min(max(distinct_pages, 9), 10)
        else:
            planned = max(distinct_pages, 5) if distinct_pages > 0 else 9

    has_wenan = (work_path / "文案.txt").exists()
    status = "COMPLETED" if (distinct_pages >= planned and has_wenan) else "PRODUCING"

    manifest_update = {
        "workId": manifest_data.get('workId') or manifest_data.get('work_id') or f"work_{abs(hash(rel_name)):x}",
        "title": rel_name,
        "mode": mode,
        "category": "攻略类" if is_guide_or_game else ("精准团建" if mode == "Codex-API" else "泛流量"),
        "progress": {
            "plannedImageCount": planned,
            "completedDistinctPages": distinct_pages,
            "completionRate": round((distinct_pages / planned * 100.0) if planned > 0 else 0, 1),
            "missingPages": [f'P{i}' for i in range(1, planned + 1) if i not in page_indices],
            "hasCopyText": has_wenan,
            "singleCopyStandard": has_wenan,
            "status": status
        }
    }

    # 合并保留原始信息
    for k, v in manifest_data.items():
        if k not in manifest_update:
            manifest_update[k] = v

    if not dry_run:
        manifest_path.write_text(json.dumps(manifest_update, ensure_ascii=False, indent=2), encoding='utf-8')
    actions.append("更新/刷新 manifest.json 标准元数据")

    return actions

def main():
    dry_run = "--dry-run" in sys.argv
    print(f"=== 开始全库资产三端对齐与相册兼容同步 (dry_run={dry_run}) ===")
    
    target_dirs = []
    # 1. 根目录暂存区
    for d in sorted(BASE_DIR.iterdir()):
        if d.is_dir() and not d.name.startswith(('.', '_', '已发送', '作品集', '不合格', '发布空间', '归档', '已废弃')):
            target_dirs.append(d)

    # 2. 已发送0次（抖音小红书可发）
    stage0 = BASE_DIR / "已发送0次（抖音小红书可发）"
    if stage0.exists():
        for d in sorted(stage0.iterdir()):
            if d.is_dir() and not d.name.startswith('.'):
                target_dirs.append(d)

    print(f"共发现 {len(target_dirs)} 个作品待对齐检查...")
    total_synced_copy = 0
    total_synced_imgs = 0
    
    for idx, d in enumerate(target_dirs, 1):
        acts = sync_work_folder(d, dry_run=dry_run)
        has_copy_act = any("文案.txt" in a for a in acts)
        has_img_act = any("大图对齐复制" in a for a in acts)
        if has_copy_act:
            total_synced_copy += 1
        if has_img_act:
            total_synced_imgs += 1
        if has_copy_act or has_img_act:
            print(f"[{idx}/{len(target_dirs)}] {d.name[:40]}:")
            for a in acts:
                print(f"   -> {a}")

    print(f"\n=== 同步执行完毕！===")
    print(f"• 补齐/规范 文案.txt 作品数: {total_synced_copy}")
    print(f"• 移动端大图对齐作品数: {total_synced_imgs}")

if __name__ == '__main__':
    main()
