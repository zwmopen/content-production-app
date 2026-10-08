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

KEYWORDS = ["攻略", "旅游", "自驾", "个人", "路线", "景点", "目标", "素材库", "游玩"]

def scan_tree(drive_id, drive_name, start_dirs):
    print(f"=== 切换至网盘: {drive_name} ({drive_id}) ===")
    run_cmd(["drive", str(drive_id)])
    matches = []
    
    queue = list(start_dirs)
    visited = set()
    
    while queue:
        curr = queue.pop(0)
        if curr in visited:
            continue
        visited.add(curr)
        
        out = run_cmd(["ls", curr])
        lines = out.splitlines()
        for l in lines:
            parts = l.split()
            if len(parts) >= 4 and parts[0].isdigit():
                name = " ".join(parts[3:] if len(parts) == 4 else parts[4:])
                is_dir = name.endswith('/')
                clean_name = name.rstrip('/')
                full_path = curr.rstrip('/') + '/' + clean_name
                
                # Check keyword match
                hit = any(k in clean_name for k in KEYWORDS)
                if hit:
                    print(f"[{drive_name}] 命中关键词: {full_path} (大小: {parts[1]})", flush=True)
                    matches.append({"drive": drive_name, "path": full_path, "is_dir": is_dir, "size": parts[1]})
                
                if is_dir:
                    # 避免陷入极其庞大的系统目录
                    if not any(skip in clean_name for skip in ["node_modules", ".git", ".cache", "Fonts", "VM", "安卓备份"]):
                        # 限制队列大小
                        if len(queue) < 150:
                            queue.append(full_path)
    return matches

all_hits = []
# 1. 资源库
all_hits.extend(scan_tree("850026872", "资源库", ["/", "/团建项目", "/自媒体", "/历史项目"]))

# 2. 备份盘
all_hits.extend(scan_tree("1229024", "备份盘", ["/", "/U盘备份", "/我的备份", "/已使用过的作品库"]))

with open(r"d:\AICode\工具开发\projects\content-production-app\tests\migration_output\aliyun_keyword_hits.json", "w", encoding="utf-8") as f:
    json.dump(all_hits, f, ensure_ascii=False, indent=2)

print("ALL_SEARCH_DONE, Total Hits:", len(all_hits))
