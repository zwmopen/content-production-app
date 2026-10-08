import os
import json
import re
import random
from pathlib import Path

# 默认全局模板库根目录
DEFAULT_TEMPLATE_ROOT = Path(r"D:\AICode\项目推进\projects\江湖有旅人\主项目\02-模板库")

CATEGORY_DIRS = {
    "team_building": "精准流量团建模板",
    "game": "泛流量小游戏模板",
    "personal_guide": "泛流量个人攻略模板"
}

CATEGORY_LABELS = {
    "team_building": "精准流量团建",
    "game": "泛流量团建小游戏",
    "personal_guide": "泛流量个人攻略"
}


def detect_material_category(material_path):
    """
    智能识别待加工素材的类型归属：
    返回: "team_building" | "game" | "personal_guide"
    """
    mat = Path(material_path) if isinstance(material_path, Path) else Path(str(material_path))
    folder_name = mat.name.lower()
    full_path_str = str(mat.resolve()).lower().replace("\\", "/")

    # L1: 路径目录层级与文件夹名强关联判断
    if any(k in full_path_str for k in ["/团建游戏/", "/破冰游戏/", "小游戏"]):
        return "game"
    if any(k in full_path_str for k in ["/泛流量/", "个人攻略", "旅游攻略", "02-泛流量-攻略类"]):
        if any(k in folder_name for k in ["游戏", "破冰"]):
            return "game"
        # 泛流量下的个人自驾/手绘/攻略/小众游玩优先识别为个人攻略
        if any(k in folder_name for k in ["地图", "自驾", "攻略", "玩转", "避坑", "逛吃", "游玩", "j人", "p人", "大学生", "周末"]):
            return "personal_guide"

    # L2: 读取素材的 .tags.json / metadata.json
    meta = {}
    for meta_name in [".tags.json", "tags.json", "metadata.json"]:
        meta_file = mat / meta_name
        if meta_file.exists():
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                break
            except Exception:
                pass

    if meta:
        tagging = meta.get("tagging", {})
        traffic_type = str(tagging.get("trafficType") or meta.get("trafficType") or "").lower()
        tags = [str(t).lower() for t in (tagging.get("tags") or meta.get("tags") or [])]
        main_tag = str(tagging.get("mainTag") or meta.get("mainTag") or "").lower()
        all_meta_str = " ".join([traffic_type, main_tag] + tags)

        if any(k in all_meta_str for k in ["游戏", "破冰", "互动", "game"]):
            return "game"
        if traffic_type == "攻略" or any(k in all_meta_str for k in ["个人攻略", "自驾", "旅游攻略"]):
            return "personal_guide"
        if any(k in all_meta_str for k in ["精准", "团建", "定制", "会务", "企业"]):
            return "team_building"

    # L3: 检查素材中的文案.txt与文件夹命名
    text_content = ""
    for txt_name in ["文案.txt", "content.txt"]:
        txt_file = mat / txt_name
        if txt_file.exists():
            try:
                with open(txt_file, "r", encoding="utf-8", errors="ignore") as f:
                    text_content = f.read().lower()
                break
            except Exception:
                pass

    combined_text = f"{folder_name} {text_content}"

    # 优先识别小游戏
    if any(k in combined_text for k in ["撕名牌", "破冰小游戏", "互动小游戏", "室内游戏", "团队破冰", "桌游游戏"]):
        return "game"

    # 识别个人攻略（有明确攻略/自驾特征且没有强企业团建词）
    is_guide_vocab = any(k in combined_text for k in ["自驾游", "自驾攻略", "保姆级攻略", "避坑指南", "两天一夜攻略", "小众打卡", "穷游", "探店", "美食红黑榜", "必打卡机位"])
    is_team_vocab = any(k in combined_text for k in ["企业团建", "公司团建", "团建方案", "hr必备", "团建策划", "百人团建", "年会定制"])

    if is_guide_vocab and not is_team_vocab:
        return "personal_guide"

    # 兜底：默认为精准流量团建
    return "team_building"


def scan_category_templates(category_key, template_root=DEFAULT_TEMPLATE_ROOT):
    """
    扫描指定分类子目录下的所有合法模板
    """
    root = Path(template_root) if isinstance(template_root, Path) else Path(str(template_root))
    sub_folder_name = CATEGORY_DIRS.get(category_key, "精准流量团建模板")
    target_dir = root / sub_folder_name

    if not target_dir.exists():
        return []

    templates = []
    for item in sorted(target_dir.iterdir(), key=lambda x: x.name):
        if not item.is_dir() or item.name.startswith((".", "_", "scripts")):
            continue

        imgs = sorted([f for f in item.iterdir() if f.is_file() and f.suffix.lower() in ('.jpg', '.png', '.jpeg', '.webp')])
        if not imgs:
            continue

        p1_files = [f for f in imgs if 'p1' in f.stem.lower() or '封面' in f.stem]
        p2_files = [f for f in imgs if 'p2' in f.stem.lower() or '内页' in f.stem]

        p1_path = p1_files[0] if p1_files else imgs[0]
        p2_path = p2_files[0] if p2_files else (imgs[1] if len(imgs) > 1 else p1_path)

        # 尝试提取 ID
        t_id = ""
        for mf_name in ["template.json", "metadata.json"]:
            mf = item / mf_name
            if mf.exists():
                try:
                    with open(mf, "r", encoding="utf-8") as f:
                        mdata = json.load(f)
                    t_id = mdata.get("id") or mdata.get("templateId") or ""
                    if t_id:
                        break
                except Exception:
                    pass
        if not t_id:
            m = re.search(r'([TG]\d+)', item.name, re.I)
            t_id = m.group(1).upper() if m else item.name[:6]

        templates.append({
            "id": str(t_id).strip().upper(),
            "name": item.name,
            "category": CATEGORY_LABELS.get(category_key, "精准流量团建"),
            "categoryKey": category_key,
            "folder": str(item.resolve()),
            "p1_path": str(p1_path.resolve()),
            "p2_path": str(p2_path.resolve()),
            "all_images": [str(im.resolve()) for im in imgs],
            "image_count": len(imgs)
        })

    return templates


def pick_template_for_material(material_path, template_root=DEFAULT_TEMPLATE_ROOT, mode="2_random_template", fixed_id=""):
    """
    ✨ 核心路由器：
    1. 自动识别素材属于哪一类 (精准团建 / 泛流量小游戏 / 泛流量个人攻略)
    2. 进入对应的模板库子文件夹
    3. 抽选出匹配该类型的模板
    """
    category_key = detect_material_category(material_path)
    cat_label = CATEGORY_LABELS.get(category_key, "精准流量团建")

    pool = scan_category_templates(category_key, template_root)

    # 兜底容错：如果该分类库暂无模板，平滑回退到精准库
    if not pool:
        print(f"⚠️ [路由降级] 分类库 [{cat_label}] 暂无可用模板，回退到精准流量团建模板库...")
        pool = scan_category_templates("team_building", template_root)

    if not pool:
        print(f"❌ [严重告警] 全库均未找到任何有效模板！路径: {template_root}")
        return None, category_key

    # 固定模板模式
    if mode == "3_fixed_template" and fixed_id:
        tgt = str(fixed_id).strip().upper()
        for tpl in pool:
            if tpl["id"] == tgt or tgt in tpl["name"].upper():
                print(f"🔒 [固定母版] 命中固定模板 [{tpl['id']}] {tpl['name']} (分类: {cat_label})")
                return tpl, category_key
        print(f"⚠️ 未在分类库找到指定固定模板 [{fixed_id}]，随机抽选该分类下模板")

    # 随机抽选模式
    selected = random.choice(pool)
    print(f"🎲 [智能挑模] 素材分类: [{cat_label}] ➔ 子模板库: {CATEGORY_DIRS[category_key]} ➔ 抽中母版: [{selected['id']}] {selected['name']} (共{selected['image_count']}张图)")
    return selected, category_key


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    test_paths = [
        r"D:\AICode\项目推进\projects\江湖有旅人\主项目\01-素材库\泛流量\宜兴溧阳\评28-赞582-本J人被自己画的溧阳地图满意到睡不着了😭-小红薯6A2C658C",
        r"D:\AICode\项目推进\projects\江湖有旅人\主项目\01-素材库\泛流量\团建游戏\撕名牌游戏",
        r"D:\AICode\项目推进\projects\江湖有旅人\主项目\01-素材库\精准流量\安吉团建方案"
    ]
    for p in test_paths:
        cat = detect_material_category(p)
        print(f"测试路径: {Path(p).name} ➔ 识别为: {cat} ({CATEGORY_LABELS.get(cat)})")
        tpl, _ = pick_template_for_material(p)
        if tpl:
            print(f"   ➔ 抽选模板: {tpl['id']} - {tpl['name'][:30]}")
