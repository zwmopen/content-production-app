import os
import re
import json

root_dir = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）"
works = []

for shelf in os.listdir(root_dir):
    shelf_path = os.path.join(root_dir, shelf)
    if not os.path.isdir(shelf_path) or shelf.startswith("_"):
        continue
    for w in os.listdir(shelf_path):
        w_path = os.path.join(shelf_path, w)
        if not os.path.isdir(w_path):
            continue
        copy_path = os.path.join(w_path, "文案.txt")
        if not os.path.exists(copy_path):
            continue

        txt = open(copy_path, encoding="utf-8", errors="ignore").read()

        # 解析版本
        v_matches = re.findall(r"<<<VERSION_START:\s*([^>\r\n]+?)\s*>>>[\r\n]*(.*?)[\r\n]*<<<VERSION_END>>>", txt, re.S)
        v_dict = {tag.strip(): body.strip() for tag, body in v_matches}

        if not v_dict and "<<<XHS_START>>>" in txt:
            m_xhs = re.search(r"<<<XHS_START>>>(.*?)<<<XHS_END>>>", txt, re.S)
            m_dy = re.search(r"<<<DOUYIN_START>>>(.*?)<<<DOUYIN_END>>>", txt, re.S)
            if m_xhs:
                v_dict["红书自然"] = m_xhs.group(1).strip()
            if m_dy:
                v_dict["抖音无营销"] = m_dy.group(1).strip()

        issues = []

        # 检查抖音版本
        dy_text = v_dict.get("抖音无营销") or v_dict.get("抖音攻略") or ""
        if not dy_text:
            issues.append("缺少抖音版本")
        elif len(dy_text) < 150:
            issues.append(f"抖音太短垃圾({len(dy_text)}字)")
        elif "一键定制" in dy_text or "公司小聚" in dy_text or "团队" in dy_text:
            # 严格检查抖音无营销是否含有违规词
            if "一键定制" in dy_text or "公司小聚" in dy_text:
                issues.append("抖音含硬广涉旅词")

        # 检查红书自然
        xhs_text = v_dict.get("红书自然") or ""
        if not xhs_text:
            issues.append("缺少红书自然")
        elif len(xhs_text) < 250:
            issues.append(f"红书自然太短({len(xhs_text)}字)")
        elif "📍 目的地：【基本信息】" in xhs_text or "2️⃣ 3️⃣" in xhs_text:
            issues.append("红书自然含模板乱码")

        # 检查地名错配（货不对版）
        clean_shelf = shelf.replace("成品", "")
        if clean_shelf not in ("综合与其它城市", "江浙沪", "其他", "烧烤露营", "徒步登山", "团建游戏", "趣味运动会", "杭州"):
            if clean_shelf not in xhs_text and "杭州秋季团建" in xhs_text:
                issues.append(f"地名错配(货架{clean_shelf}写成杭州)")

        # 检查红书自然与红书大纲是否重复
        dg_text = v_dict.get("红书大纲") or ""
        if dg_text and xhs_text and dg_text == xhs_text:
            issues.append("大纲与自然完全重复")

        if issues:
            works.append({
                "shelf": shelf,
                "folder": w,
                "path": w_path,
                "issues": issues,
                "dy_len": len(dy_text),
                "xhs_len": len(xhs_text),
                "v_count": len(v_dict)
            })

print(f"Total problematic works found: {len(works)}")
# 分类统计
issue_counts = {}
for item in works:
    for iss in item["issues"]:
        k = iss.split("(")[0]
        issue_counts[k] = issue_counts.get(k, 0) + 1

print("Issue category breakdown:")
for k, v in issue_counts.items():
    print(f"  - {k}: {v} 件")

print("\nSample 25 problematic works:")
for idx, item in enumerate(works[:25]):
    s = item["shelf"]
    f = item["folder"][:45]
    iss = ", ".join(item["issues"])
    print(f"[{idx+1}] [{s}] {f} -> {iss}")

with open(r"C:\Users\z\.gemini\antigravity\brain\49cf527e-2cc4-4cee-9850-37ffb3832a70\all_problematic_works.json", "w", encoding="utf-8") as wf:
    json.dump(works, wf, ensure_ascii=False, indent=2)
