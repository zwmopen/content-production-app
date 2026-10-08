import os
import json
from pathlib import Path
from datetime import datetime

ROOT = Path(r"D:\AICode\项目推进\projects\江湖有旅人\主项目\02-模板库")
REG_FILE = ROOT / "templates-registry.json"

CATEGORIES = [
    ("精准流量团建模板", "精准流量团建"),
    ("泛流量小游戏模板", "泛流量团建小游戏"),
    ("泛流量个人攻略模板", "泛流量个人攻略")
]

all_templates = []

for folder_name, cat_label in CATEGORIES:
    folder_path = ROOT / folder_name
    if not folder_path.exists():
        continue
    
    for item in sorted(folder_path.iterdir(), key=lambda x: x.name):
        if not item.is_dir():
            continue
        if item.name.startswith((".", "_", "scripts")):
            continue
        
        # 查找图片文件
        img_files = sorted([f.name for f in item.iterdir() if f.is_file() and f.suffix.lower() in ('.jpg', '.png', '.jpeg', '.webp')])
        txt_files = sorted([f.name for f in item.iterdir() if f.is_file() and f.suffix.lower() == '.txt'])
        
        # 读取 template.json 或 metadata.json
        meta = {}
        for m_name in ["template.json", "metadata.json"]:
            m_path = item / m_name
            if m_path.exists():
                try:
                    with open(m_path, "r", encoding="utf-8") as mf:
                        meta = json.load(mf)
                    break
                except Exception:
                    pass
        
        # 提取 ID
        t_id = meta.get("id") or meta.get("templateId")
        if not t_id:
            # 从文件夹名提取 Txx / Gxx
            import re
            m = re.search(r'([TG]\d+)', item.name, re.I)
            t_id = m.group(1).upper() if m else item.name[:6]
        
        # 封面与内页
        p1 = next((img for img in img_files if "p1" in img.lower() or "封面" in img), img_files[0] if img_files else "")
        p2 = next((img for img in img_files if "p2" in img.lower() or "内页" in img), img_files[1] if len(img_files) > 1 else "")
        
        desc = meta.get("desc") or meta.get("description") or ""
        raw_tags = meta.get("tags")
        if isinstance(raw_tags, list):
            tags = list(raw_tags)
        else:
            tags = []
        if cat_label not in tags:
            tags.insert(0, cat_label)
            
        layout = meta.get("layout") or ("多页异构自驾画册" if cat_label == "泛流量个人攻略" else "拼图大字多宫格")
        
        # 相对路径用于网页加载
        rel_path = f"{folder_name}/{item.name}"
        
        entry = {
            "templateId": str(t_id).strip().upper(),
            "id": str(t_id).strip().upper(),
            "name": item.name,
            "category": cat_label,
            "folderGroup": folder_name,
            "layout": layout,
            "layoutType": meta.get("layoutType") or ("heterogeneous_album" if cat_label in ("泛流量个人攻略", "泛流量团建小游戏") and len(img_files) > 2 else "standard_pair"),
            "addedAt": meta.get("addedAt") or datetime.now().strftime("%Y-%m-%d"),
            "mtime": datetime.fromtimestamp(item.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
            "enabled": True,
            "localPath": str(item.resolve()).replace("\\", "/"),
            "relPath": rel_path,
            "p1": p1,
            "p2": p2,
            "cover": f"{rel_path}/{p1}" if p1 else "",
            "inner": f"{rel_path}/{p2}" if p2 else "",
            "imageCount": len(img_files),
            "images": [f"{rel_path}/{img}" for img in img_files],
            "textCount": len(txt_files),
            "description": desc,
            "tags": tags
        }
        all_templates.append(entry)

# 备份旧注册表
if REG_FILE.exists():
    bak_file = ROOT / f"templates-registry.json.bak-3cats-{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    import shutil
    shutil.copy2(str(REG_FILE), str(bak_file))
    print(f"已备份旧注册表至: {bak_file.name}")

# 保存新注册表
reg_payload = {
    "version": "2.0.0",
    "updatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "totalCount": len(all_templates),
    "categories": {
        "精准流量团建": len([t for t in all_templates if t["category"] == "精准流量团建"]),
        "泛流量团建小游戏": len([t for t in all_templates if t["category"] == "泛流量团建小游戏"]),
        "泛流量个人攻略": len([t for t in all_templates if t["category"] == "泛流量个人攻略"])
    },
    "templates": all_templates
}

with open(REG_FILE, "w", encoding="utf-8") as f:
    json.dump(reg_payload, f, ensure_ascii=False, indent=2)

print(f"✅ 模板注册表更新完成: 总计 {len(all_templates)} 套模板")
for cat, cnt in reg_payload["categories"].items():
    print(f"   - {cat}: {cnt} 套")
