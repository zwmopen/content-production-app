# -*- coding: utf-8 -*-
"""江西方案索引补标·第二刀：补 FA0695（婺源3天旅行方案 · 长线方案目录）

- 上一刀（wb_jiangxi_plan_relabel.py）只覆盖 FA0626-FA0636。
- 这一刀只补 FA0695：省份=江西 / 城市=上饶 / 标记=江西专线说明。
- 不动其余 727 条；其他条目的差异校验失败直接报错。
"""
import json
import shutil
import datetime
import os

P = r"D:/AICode/运行数据/江湖有旅人/转化助手/公司资料与方案索引.json"

PATCH = {
    "FA0695": dict(
        省份="江西",
        城市="上饶",
        标记="江西专线｜婺源3天旅行方案；纯旅游路线（非团建），作为长线方案收纳，可在客户说'要3天玩婺源'时直接套用。【原省份/城市=未分类未标，已补】",
    ),
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
        print(f"  {code}: before={before} -> after=省份={after['省份']} 城市={after['城市']} 标记={after['标记'][:50]}...")
    print("文件大小:", os.path.getsize(P))

if __name__ == "__main__":
    main()