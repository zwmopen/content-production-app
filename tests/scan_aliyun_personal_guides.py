import os
import subprocess
import json

ALIYUN_BIN = r"D:\Program Files\aliyunpan\aliyunpan.exe"
ALIYUN_CFG = r"D:\Program Files\aliyunpan\config"

def run_cmd(args):
    env = os.environ.copy()
    env["ALIYUNPAN_CONFIG_DIR"] = ALIYUN_CFG
    res = subprocess.run([ALIYUN_BIN] + args, env=env, capture_output=True, text=True, errors="ignore")
    return res.stdout.strip()

def list_dir(remote_path):
    out = run_cmd(["ls", remote_path])
    items = []
    lines = out.splitlines()
    for l in lines:
        parts = l.split()
        if len(parts) >= 4 and parts[0].isdigit():
            # item line
            # format: # size date time name
            name = " ".join(parts[4:])
            is_dir = name.endswith('/')
            items.append({"name": name.rstrip('/'), "is_dir": is_dir, "size": parts[1], "date": parts[2] + " " + parts[3]})
    return items

print("开始全景探测阿里云盘目录树...")
root_items = list_dir("/")
print(f"根目录总项数: {len(root_items)}")

all_found = []

for r in root_items:
    path = "/" + r["name"]
    print(f"\n--> 扫描根目录分支: {path}")
    sub_items = list_dir(path)
    print(f"    子项数量: {len(sub_items)}")
    for s in sub_items:
        sub_path = path + "/" + s["name"]
        print(f"      [{'DIR' if s['is_dir'] else 'FILE'}] {s['name']} ({s['size']})")
        all_found.append({"path": sub_path, "is_dir": s["is_dir"], "size": s["size"], "date": s["date"]})
        
        # 如果是目录且看起来像备份库，再往下一层
        if s["is_dir"] and any(k in s["name"] for k in ["作品", "备份", "素材", "攻略", "模板", "项目", "SecondBrain", "成品"]):
            sub2_items = list_dir(sub_path)
            for s2 in sub2_items[:15]:
                sub2_path = sub_path + "/" + s2["name"]
                print(f"        └── [{'DIR' if s2['is_dir'] else 'FILE'}] {s2['name']}")
                all_found.append({"path": sub2_path, "is_dir": s2["is_dir"], "size": s2["size"], "date": s2["date"]})

with open("d:/AICode/工具开发/projects/content-production-app/tests/migration_output/aliyun_scan_results.json", "w", encoding="utf-8") as f:
    json.dump(all_found, f, ensure_ascii=False, indent=2)

print("\nSCAN_COMPLETE")
