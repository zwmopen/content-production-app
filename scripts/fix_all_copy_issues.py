import os
import re
import json
import urllib.request

root_dir = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）"

def generate_douyin_no_marketing(city, spots, title):
    spot_text = "、".join(spots[:4]) if spots else f"{city}的特色景点"
    
    text = f"""从市区开过去两个小时，{city}的秋天真的太适合住一晚了🍂
⠀
一进山或者到了水边，两岸全都是红黄相间的秋树，风吹在脸上一点都不燥。
⠀
第一天到了先找个开阔的地方把身心放空
⠀
"""
    if any("骑行" in s for s in spots):
        text += "沿着环湖绿道骑上一段车，两边青山绿水，清风拂面，在工位上积了一周的疲惫瞬间就散了。\n⠀\n"
    elif any("徒步" in s or "登山" in s or "古道" in s for s in spots):
        text += "沿着落叶山道走一小段，脚下踩着沙沙的落叶，林子里空气特别清新，拍拍照吹吹风特别舒服。\n⠀\n"
    else:
        text += "在草地上晒晒太阳，玩几轮飞盘或者趣味互动，平时在办公室一坐一天的人，活动一下整个人都通透了。\n⠀\n"

    if any("皮划艇" in s or "水上" in s or "桨板" in s for s in spots):
        text += "下午阳光好的时候去水上划划皮划艇，水面很平很清，几个人并排漂着看远山，怎么拍都像电影画面。\n⠀\n"
    elif any("采摘" in s or "橘" in s or "果园" in s for s in spots):
        text += "下午去附近的果园里摘摘当季的水果，枝头挂得满满当当，边摘边剥，清甜爆汁，带一兜回去很有秋收感。\n⠀\n"
    elif any("越野" in s or "卡丁车" in s or "CS" in s for s in spots):
        text += "下午去树林里开了几圈山地越野车，油门一踩泥花四溅，大家尖叫大笑，压力全释放出来了。\n⠀\n"

    text += f"""傍晚回到院子里或者水边天幕下，重头戏才刚开始🌅
⠀
天幕下面串灯一亮，炭火噼里啪啦响起来，烤串和烤肉滋滋冒油。大家围坐在小矮椅上，吃着水果喝点冰镇饮料，看着整片天空从金色慢慢变成粉紫色的晚霞，那种松弛感真的无可替代。
⠀
夜里水边或者山里微凉，围着暖炉或者篝火喝热茶、烤红薯，有人唱歌，有人打牌聊天，聊到半夜也没人催。
⠀
第二天睡到自然醒，吃完特色早餐，去附近的古村老街或者湖光山色里慢步走走，中午尝尝地道的农家菜，下午三四点舒舒服服地往回走。
⠀
几个实在的避坑提醒：
⠀
秋天早晚温差大，一定要多备一件防风外套；户外活动穿双耐脏防滑的鞋子；傍晚看落日记得提前半小时占好观景位。
⠀
{city}的秋景就这几周最好看，周末想出门透透气的，可以直接动身了。
⠀
#{city}旅游 #{city}攻略 #秋天去哪玩 #周末去哪儿 #江浙沪周边游 #小众旅行地"""
    return text.strip()

def fix_single_work(work_path, shelf):
    copy_path = os.path.join(work_path, "文案.txt")
    mf_path = os.path.join(work_path, "manifest.json")
    tag_path = os.path.join(work_path, "作品标签.json")
    if not os.path.exists(copy_path):
        return False, "无文案.txt"

    txt = open(copy_path, encoding="utf-8", errors="ignore").read()

    v_matches = re.findall(r"<<<VERSION_START:\s*([^>\r\n]+?)\s*>>>[\r\n]*(.*?)[\r\n]*<<<VERSION_END>>>", txt, re.S)
    v_dict = {}
    for tag, body in v_matches:
        clean_tag = tag.strip()
        if clean_tag in ("抖音攻略", "抖音避坑"):
            clean_tag = "抖音无营销"
        v_dict[clean_tag] = body.strip()

    if not v_dict and "<<<XHS_START>>>" in txt:
        m_xhs = re.search(r"<<<XHS_START>>>(.*?)<<<XHS_END>>>", txt, re.S)
        m_dy = re.search(r"<<<DOUYIN_START>>>(.*?)<<<DOUYIN_END>>>", txt, re.S)
        if m_xhs: v_dict["红书自然"] = m_xhs.group(1).strip()
        if m_dy: v_dict["抖音无营销"] = m_dy.group(1).strip()

    modified = False
    mods = []

    # 1. 修复红书自然乱码
    if "红书自然" in v_dict:
        xhs = v_dict["红书自然"]
        if "📍 目的地：【基本信息】" in xhs or "2️⃣ 3️⃣" in xhs or "【基本信息】" in xhs:
            city = shelf.replace("成品", "")
            xhs = xhs.replace("📍 目的地：【基本信息】", f"📍 目的地：江浙沪·{city}")
            xhs = re.sub(r'2️⃣\s*3️⃣', '2️⃣', xhs)
            xhs = re.sub(r'3️⃣\s*4️⃣', '3️⃣', xhs)
            xhs = re.sub(r'4️⃣\s*5️⃣', '4️⃣', xhs)
            v_dict["红书自然"] = xhs
            modified = True
            mods.append("修复红书自然乱码")

    # 2. 修复大纲与自然重复
    if "红书大纲" in v_dict and "红书自然" in v_dict:
        if v_dict["红书大纲"] == v_dict["红书自然"]:
            timeline_body = None
            for alt_tag in ["分天动线", "时间轴体", "杂志长条"]:
                if alt_tag in v_dict and len(v_dict[alt_tag]) > 180:
                    timeline_body = v_dict[alt_tag]
                    break
            
            if timeline_body:
                v_dict["红书大纲"] = timeline_body
                modified = True
                mods.append("大纲替换为真实时间轴")

    # 3. 修复抖音太短垃圾或含营销硬广词
    dy_text = v_dict.get("抖音无营销", "")
    if not dy_text or len(dy_text) < 180 or "一键定制" in dy_text or "公司小聚" in dy_text:
        folder_name = os.path.basename(work_path)
        city = shelf.replace("成品", "")
        if city in ("综合与其它城市", "江浙沪", "其他", "烧烤露营", "徒步登山", "团建游戏", "趣味运动会"):
            for c in ["千岛湖", "莫干山", "安吉", "桐庐", "舟山", "宁波", "苏州", "西山岛", "无锡", "宜兴", "常州", "溧阳", "南京", "上海", "崇明", "绍兴", "台州", "温州", "金华"]:
                if c in folder_name:
                    city = c
                    break
            if city in ("综合与其它城市", "江浙沪", "其他", "烧烤露营", "徒步登山", "团建游戏", "趣味运动会"):
                city = "江浙沪"

        spots = []
        for line in txt.splitlines():
            line = line.strip()
            if any(k in line for k in ["骑行", "徒步", "飞盘", "皮划艇", "露营", "烧烤", "游船", "天幕", "温泉", "古镇", "古村", "落日", "日落", "瀑布", "采摘", "农家乐", "卡丁车", "越野车", "鱼头", "漂流"]):
                clean_l = re.sub(r'(?:团建|HR|公司|定制|人均|策划|包办).*', '', line).strip()
                if 4 <= len(clean_l) <= 30 and clean_l not in spots:
                    spots.append(clean_l)
        new_dy = generate_douyin_no_marketing(city, spots, folder_name)
        v_dict["抖音无营销"] = new_dy
        modified = True
        mods.append(f"扩写抖音无营销({len(new_dy)}字)")

    # 4. 组装新文案
    core_order = ["红书自然", "抖音无营销", "红书大纲", "红书种草"]
    other_tags = [t for t in v_dict.keys() if t not in core_order]
    
    if "红书种草" not in v_dict:
        for alt in ["数字爆款", "包院私享", "案例背书", "红书自然"]:
            if alt in v_dict:
                v_dict["红书种草"] = v_dict[alt]
                modified = True
                mods.append("补齐红书种草")
                break

    if modified:
        new_blocks = ["<<<COPY_FORMAT:MULTI>>>\n"]
        for tag in core_order:
            if tag in v_dict:
                new_blocks.append(f"<<<VERSION_START:{tag}>>>\n{v_dict[tag]}\n<<<VERSION_END>>>\n")
        for tag in other_tags:
            if tag in v_dict:
                new_blocks.append(f"<<<VERSION_START:{tag}>>>\n{v_dict[tag]}\n<<<VERSION_END>>>\n")
        
        final_txt = "\n".join(new_blocks).strip() + "\n"
        
        with open(copy_path, "w", encoding="utf-8") as wf:
            wf.write(final_txt)

        if os.path.exists(mf_path):
            try:
                mf = json.load(open(mf_path, encoding="utf-8"))
                mf["copyText"] = final_txt
                if "completionMeta" in mf and isinstance(mf["completionMeta"], dict):
                    mf["completionMeta"]["copyVersionCount"] = len(v_dict)
                if "distribution" in mf and isinstance(mf["distribution"], dict):
                    mf["distribution"]["dispatchedVersions"] = []
                    mf["distribution"]["status"] = "待发手机"
                json.dump(mf, open(mf_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            except Exception:
                pass

        if os.path.exists(tag_path):
            try:
                tag_data = json.load(open(tag_path, encoding="utf-8"))
                if "distribution" in tag_data and isinstance(tag_data["distribution"], dict):
                    tag_data["distribution"]["dispatchedVersions"] = []
                json.dump(tag_data, open(tag_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
            except Exception:
                pass

        return True, ", ".join(mods)
    return False, "无需修复"

def run_all():
    total_checked = 0
    total_repaired = 0
    results = {}

    for shelf in os.listdir(root_dir):
        shelf_path = os.path.join(root_dir, shelf)
        if not os.path.isdir(shelf_path) or shelf.startswith("_"):
            continue
        for w in os.listdir(shelf_path):
            w_path = os.path.join(shelf_path, w)
            if not os.path.isdir(w_path):
                continue
            total_checked += 1
            ok, msg = fix_single_work(w_path, shelf)
            if ok:
                total_repaired += 1
                results[shelf] = results.get(shelf, 0) + 1

    print(f"Audit & repair completed! Total checked: {total_checked}, Repaired: {total_repaired}")
    print("Repaired breakdown by shelf:")
    for s, c in sorted(results.items(), key=lambda x: -x[1]):
        print(f"  - {s}: {c} 件")

if __name__ == "__main__":
    run_all()
