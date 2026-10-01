# -*- coding: utf-8 -*-
"""江西方案索引补标与纠错（只动 FA0626-FA0636，其余 717 条零改动）"""
import json
import os
import shutil
import datetime

P = r"D:/AICode/运行数据/江湖有旅人/转化助手/公司资料与方案索引.json"

PATCH = {
    "FA0626": dict(省份="江西", 城市="上饶", 时长="2天1夜",
                   标记="江西专线｜三清山2天1夜休闲游；含日出行程表+景点介绍；适合2天1夜轻休闲企业团队"),
    "FA0627": dict(省份="江西", 城市="上饶", 时长="4日",
                   标记="江西专线｜三清山+婺源篁岭+望仙谷4日串联；最长线，适合有充足假期的深度游团队"),
    "FA0628": dict(省份="江西", 城市="上饶", 时长="2天1夜",
                   标记="江西专线｜三清山+望仙谷2天1夜；仙侠夜景+道教名山，最主流组合，优先推荐"),
    "FA0629": dict(省份="江西", 城市="上饶", 时长="3日",
                   标记="江西专线｜三清山+望仙谷3日；2日线的加长版，多留一天缓冲，适合30人以上大团"),
    "FA0630": dict(省份="江西", 城市="上饶", 时长="3天2夜",
                   标记="江西专线｜婺源3天2夜；晒秋+非遗+徽州古村主线，10-11月最佳"),
    "FA0631": dict(省份="江西", 城市="景德镇", 时长="3日",
                   标记="江西专线｜景德镇3天2晚；陶瓷手作+古镇人文，适合偏文化调性团队"),
    "FA0632": dict(省份="江西", 城市="上饶", 时长="2天1夜",
                   标记="江西专线｜篁岭+李坑2天1夜；晒秋核心双村，出片率最高的短途线"),
    "FA0633": dict(省份="江西", 城市="上饶", 时长="2日",
                   标记="江西专线｜婺女洲+篁岭2日纯玩；纯玩无购物，报价可直接套用（PDF版）"),
    "FA0634": dict(省份="江西", 城市="九江", 时长="2日",
                   标记="江西专线｜庐山2日含拓展；庐山含拓展与温泉，适合想把拓展项目打包进来的团队。【原时长误标6日，已纠正为2日】"),
    "FA0635": dict(省份="江西", 城市="景德镇", 时长="2日",
                   标记="江西专线｜景德镇2日纯玩；古镇+手工+科技元素，纯玩版（PDF）"),
    "FA0636": dict(省份="江西", 城市="上饶", 时长="2日",
                   标记="江西专线｜杭州出发→婺源2日；出发地杭州，目的地婺源（上饶）。【原标记省份=浙江/城市=杭州，已纠正为江西/上饶】"),
}

def load():
    return json.loads(open(P, "rb").read().decode("utf-8"))

def main():
    old = load()
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup = P.replace(".json", f"_backup_{ts}.json")
    shutil.copy2(P, backup)
    print("备份:", os.path.basename(backup))

    touched = []
    for it in old["方案"]:
        code = it.get("编号")
        if code in PATCH:
            before = {k: it.get(k) for k in ("省份", "城市", "时长")}
            it.update(PATCH[code])
            touched.append((code, before, {k: it.get(k) for k in PATCH[code]}))

    old.setdefault("标记说明", "标记字段 = 该方案的用途定位/主线/适用场景，供转化助手与人工快速选型；江西专线于 2026-09-21 由 WorkBuddy 补标并纠正原分类错漏。")

    text = json.dumps(old, ensure_ascii=False, indent=2)
    open(P, "wb").write(text.replace("\n", "\r\n").encode("utf-8"))

    # 校验
    new = load()
    assert len(new["方案"]) == len(old["方案"]), "条数变化"
    diff = 0
    for a, b in zip(old["方案"], new["方案"]):
        if a.get("编号") in PATCH:
            continue
        if json.dumps(a, ensure_ascii=False, sort_keys=True) != json.dumps(b, ensure_ascii=False, sort_keys=True):
            diff += 1
    print(f"方案总数: {len(new['方案'])}（未变）｜非目标条目改动数: {diff}（应为0）")
    print(f"本次补标: {len(touched)} 条")
    for code, before, after in touched:
        print(f"  {code}: {before} -> 省份={after['省份']} 城市={after['城市']} 时长={after['时长']}")
    print("文件大小:", os.path.getsize(P))

if __name__ == "__main__":
    main()
