import os
import shutil
from pathlib import Path
import json

ROOT = Path(r"D:\AICode\项目推进\projects\江湖有旅人\主项目\02-模板库")

TARGET_TEAM = ROOT / "精准流量团建模板"
TARGET_GAME = ROOT / "泛流量小游戏模板"
TARGET_GUIDE = ROOT / "泛流量个人攻略模板"

OLD_TEAM = ROOT / "团建方案模板"
OLD_GUIDE = ROOT / "旅游攻略模板"

print("=== 1. 检查目标目录 ===")
for p in [TARGET_TEAM, TARGET_GAME, TARGET_GUIDE]:
    p.mkdir(parents=True, exist_ok=True)
    print(f"已确保目录存在: {p.name}")

print("\n=== 2. 扫描现存模板并制定移动计划 ===")
moves = []

if OLD_TEAM.exists():
    for item in OLD_TEAM.iterdir():
        if not item.is_dir():
            continue
        # 跳过辅助目录
        if item.name in ["scripts", "_skill-模板识别", "_模板弱化", "_模板硬链接预览"]:
            continue
        
        # 判断是否为小游戏
        if any(k in item.name for k in ["游戏", "破冰", "互动"]):
            moves.append((item, TARGET_GAME / item.name, "小游戏"))
        else:
            moves.append((item, TARGET_TEAM / item.name, "精准团建"))

if OLD_GUIDE.exists():
    for item in OLD_GUIDE.iterdir():
        if item.is_dir() and item.name not in ["scripts"]:
            moves.append((item, TARGET_GUIDE / item.name, "个人攻略"))

print(f"待移动模板总数: {len(moves)}")
for src, dst, cat in moves[:10]:
    print(f"  [{cat}] {src.name} -> {dst.parent.name}")
print(f"  ... 共 {len(moves)} 项")

# 执行移动
success_count = 0
for src, dst, cat in moves:
    try:
        if dst.exists():
            print(f"⚠️ 目标已存在，跳过: {dst.name}")
        else:
            shutil.move(str(src), str(dst))
            success_count += 1
    except Exception as e:
        print(f"❌ 移动失败 {src.name}: {e}")

print(f"\n✅ 移动完成: {success_count}/{len(moves)} 个模板")

# 检查 OLD_TEAM 是否还保留 scripts 等辅助
print("\n=== 3. 统计迁移后各库模板数量 ===")
print(f"精准流量团建模板: {len([d for d in TARGET_TEAM.iterdir() if d.is_dir()])} 个")
print(f"泛流量小游戏模板: {len([d for d in TARGET_GAME.iterdir() if d.is_dir()])} 个")
print(f"泛流量个人攻略模板: {len([d for d in TARGET_GUIDE.iterdir() if d.is_dir()])} 个")
