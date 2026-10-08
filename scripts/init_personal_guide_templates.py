import os
import shutil
import json
from pathlib import Path

GUIDE_ROOT = Path(r"D:\AICode\项目推进\projects\江湖有旅人\主项目\02-模板库\泛流量个人攻略模板")
GUIDE_ROOT.mkdir(parents=True, exist_ok=True)

# 1. 模板 1：千岛湖极简自驾打卡套版 (5张图)
src_qiandao = Path(r"D:\AICode\运行数据\临时文件\test_douyin\评14-赞558-千岛湖两天一日旅游攻略来了。千岛湖2日一晚游玩攻略_日程安排_Day1_东南湖区-天屿山观景台-骑龙巷_（东南湖-米多多")
dst_t1 = GUIDE_ROOT / "「泛流母版·个人攻略」千岛湖极简自驾打卡套版（大字实拍封面+环湖分天路线+免预约机位+避坑美食）"
dst_t1.mkdir(parents=True, exist_ok=True)

if src_qiandao.exists():
    img_files = []
    # 封面
    for f in src_qiandao.glob("*封面*.jpg"):
        dst_f = dst_t1 / "模板-P1.jpg"
        shutil.copy2(str(f), str(dst_f))
        img_files.append("模板-P1.jpg")
        break
    # 内页 1-4
    for i in range(1, 5):
        for f in src_qiandao.glob(f"*内页{i}*.jpg"):
            dst_f = dst_t1 / f"模板-P{i+1}.jpg"
            shutil.copy2(str(f), str(dst_f))
            img_files.append(f"模板-P{i+1}.jpg")
            break
    
    # 文案
    for f in src_qiandao.glob("*文案*.txt"):
        shutil.copy2(str(f), str(dst_t1 / "模板-文案.txt"))
        break
    
    t1_meta = {
        "id": "G01",
        "name": "「泛流母版·个人攻略」千岛湖极简自驾打卡套版（大字实拍封面+环湖分天路线+免预约机位+避坑美食）",
        "category": "泛流量个人攻略",
        "trafficType": "泛流量",
        "layoutType": "heterogeneous_album",
        "layout": "多页异构自驾画册",
        "imageCount": len(img_files),
        "images": img_files,
        "p1": "模板-P1.jpg",
        "p2": "模板-P2.jpg",
        "learningMode": "full_album",
        "tags": ["个人攻略", "自驾打卡", "小红书爆款", "千岛湖", "异构画册"],
        "desc": "千岛湖2日自驾完整画册，包含封面大字排版、分天时间轴路线图、景点打卡与避坑指南"
    }
    with open(dst_t1 / "template.json", "w", encoding="utf-8") as f:
        json.dump(t1_meta, f, ensure_ascii=False, indent=2)
    print("已建立个人攻略母版 G01: 千岛湖极简自驾打卡套版")

# 2. 模板 2：奶油手绘自驾地图套版 (9张图)
src_liyang = Path(r"D:\AICode\项目推进\projects\江湖有旅人\主项目\01-素材库\泛流量\宜兴溧阳\评28-赞582-本J人被自己画的溧阳地图满意到睡不着了😭-小红薯6A2C658C")
dst_t2 = GUIDE_ROOT / "「泛流母版·个人攻略」奶油手绘自驾地图套版（封面手绘大地图+分天时间轴+备忘录打卡清单+避坑红黑榜）"
dst_t2.mkdir(parents=True, exist_ok=True)

if src_liyang.exists():
    img_files2 = []
    # cover
    cover_f = src_liyang / "cover.jpg"
    if cover_f.exists():
        shutil.copy2(str(cover_f), str(dst_t2 / "模板-P1.jpg"))
        img_files2.append("模板-P1.jpg")
    for i in range(1, 9):
        p_f = src_liyang / f"p{i}.jpg"
        if p_f.exists():
            shutil.copy2(str(p_f), str(dst_t2 / f"模板-P{i+1}.jpg"))
            img_files2.append(f"模板-P{i+1}.jpg")
    
    txt_f = src_liyang / "文案.txt"
    if txt_f.exists():
        shutil.copy2(str(txt_f), str(dst_t2 / "模板-文案.txt"))
        
    t2_meta = {
        "id": "G02",
        "name": "「泛流母版·个人攻略」奶油手绘自驾地图套版（封面手绘大地图+分天时间轴+备忘录打卡清单+避坑红黑榜）",
        "category": "泛流量个人攻略",
        "trafficType": "泛流量",
        "layoutType": "heterogeneous_album",
        "layout": "手绘地图异构画册",
        "imageCount": len(img_files2),
        "images": img_files2,
        "p1": "模板-P1.jpg",
        "p2": "模板-P2.jpg",
        "learningMode": "full_album",
        "tags": ["个人攻略", "手绘地图", "奶油风", "自驾路线", "iPhone备忘录", "异构画册"],
        "desc": "爆款手绘地图自驾攻略，9页完整画册，涵盖手绘全景地图封面、分天路线节点、机位打卡与美食红黑榜"
    }
    with open(dst_t2 / "template.json", "w", encoding="utf-8") as f:
        json.dump(t2_meta, f, ensure_ascii=False, indent=2)
    print("已建立个人攻略母版 G02: 奶油手绘自驾地图套版")
