import os
import re
import json

def expand_douyin_no_marketing(shelf, title, source_text, existing_copy):
    """根据真实原素材和现有文案，为太短垃圾的作品自动生成正宗的抖音无营销长文"""
    # 提取目的地城市/区域
    city = shelf.replace("成品", "")
    if city in ("综合与其它城市", "江浙沪", "其他"):
        for c in ["千岛湖", "莫干山", "安吉", "桐庐", "舟山", "宁波", "苏州", "西山岛", "无锡", "宜兴", "常州", "溧阳", "南京", "上海", "崇明", "绍兴", "台州", "温州", "金华"]:
            if c in title:
                city = c
                break

    # 从原素材或现有文案提取核心活动/景点
    combined_source = (source_text or "") + "\n" + (existing_copy or "")
    
    # 寻找具体的景点、玩法
    spots = []
    for line in combined_source.splitlines():
        line = line.strip()
        if any(k in line for k in ["骑行", "徒步", "飞盘", "皮划艇", "露营", "烧烤", "游船", "天幕", "温泉", "古镇", "古村", "落日", "日落", "瀑布", "采摘", "农家乐", "卡丁车", "越野车", "鱼头"]):
            # 过滤掉涉旅词
            clean_line = re.sub(r'(?:团建|HR|公司|定制|人均|策划|包办).*', '', line).strip()
            if len(clean_line) >= 4 and len(clean_line) <= 40 and clean_line not in spots:
                spots.append(clean_line)

    return city, spots[:8]

# 测试千岛湖作品样本
test_p = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）\千岛湖成品\20260904_232058_省心省力❗️千岛湖团建两天一夜超全保姆级攻略🈶（___COPY_FORMAT_2___）"
txt = open(os.path.join(test_p, "文案.txt"), encoding="utf-8").read()
city, spots = expand_douyin_no_marketing("千岛湖成品", "千岛湖团建两天一夜", "", txt)
print(f"City: {city}")
print(f"Extracted spots: {spots}")
