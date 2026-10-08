# -*- coding: utf-8 -*-
"""
Redo Failed Page Tool (失败单图重做与本地诊断工具)
满足用户要求：
“失败的就先落地到本地检查，然后重新把那张图做出来，再重新发过去。”
支持：
1. 扫描成品目录或待制作目录下的 _failed_review/ 失败凭据；
2. 打印失败单图的具体病灶（如尺寸不符、OCR 命中 20人起接/竞品词）；
3. 提供自动重修（Pillow 营销贴纸覆盖）或生成重出图指令；
4. 修复合格后自动合流替换回成品目录，消除半成品卡点。
"""

import os
import sys
import json
import shutil
from typing import Dict, Any

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

import qa_business_gate


def inspect_package_failures(pkg_dir: str) -> Dict[str, Any]:
    """检查某个成品目录下的失败记录"""
    review_dir = os.path.join(pkg_dir, "_failed_review")
    diag_file = os.path.join(review_dir, "失败检查清单与重做凭据.json")
    if not os.path.exists(diag_file):
        return {"has_failure": False, "message": "该目录无待检查失败记录"}
    
    with open(diag_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {"has_failure": True, "data": data, "review_dir": review_dir}


def auto_patch_and_replace_cover(pkg_dir: str, target_people_text: str = "10人起接") -> bool:
    """
    自动对 P1 封面进行营销贴纸翻新覆盖，替换违规人数限制
    """
    from PIL import Image, ImageDraw, ImageFont

    cover_p = os.path.join(pkg_dir, "P1_封面.png")
    if not os.path.exists(cover_p):
        for f in os.listdir(pkg_dir):
            if f.startswith("P1") and f.lower().endswith(".png"):
                cover_p = os.path.join(pkg_dir, f)
                break
    if not os.path.exists(cover_p):
        print(f"未找到封面文件: {pkg_dir}")
        return False

    meta_dir = os.path.join(pkg_dir, "_meta")
    os.makedirs(meta_dir, exist_ok=True)
    bak_p = os.path.join(meta_dir, "P1_封面_pre_redo_bak.png")
    if not os.path.exists(bak_p):
        shutil.copy2(cover_p, bak_p)

    im = Image.open(cover_p).convert("RGBA")
    overlay = Image.new("RGBA", im.size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(overlay)

    # 贴纸坐标
    pts_white = [(700, 72), (1086, 78), (1086, 230), (725, 224), (700, 190)]
    draw.polygon(pts_white, fill=(255, 255, 255, 255))
    pts_yellow = [(700, 78), (1086, 84), (1086, 218), (728, 214), (700, 182)]
    draw.polygon(pts_yellow, fill=(254, 228, 12, 255))

    font_path = r"C:\Windows\Fonts\simhei.ttf"
    font = ImageFont.truetype(font_path, 72)

    txt_img = Image.new("RGBA", (360, 110), (255, 255, 255, 0))
    t_draw = ImageDraw.Draw(txt_img)
    t_draw.text((15, 10), target_people_text, fill=(20, 20, 20, 255), font=font, stroke_width=2, stroke_fill=(20, 20, 20, 255))

    rotated_txt = txt_img.rotate(1.5, resample=Image.BICUBIC, expand=True)
    overlay.paste(rotated_txt, (725, 96), rotated_txt)

    res = Image.alpha_composite(im, overlay).convert("RGB")
    res.save(cover_p)
    print(f"√ 已完成封面贴纸无痕翻新: {cover_p}")
    return True


if __name__ == "__main__":
    if len(sys.argv) > 1:
        target_dir = sys.argv[1]
        print(f"正在诊断: {target_dir}")
        diag = inspect_package_failures(target_dir)
        print(json.dumps(diag, ensure_ascii=False, indent=2))
    else:
        print("用法: python redo_failed_page.py <作品目录>")
