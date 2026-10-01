# -*- coding: utf-8 -*-
"""裁掉底部「AI生成 WORKBUDDY」水印并归一到成品库标准 1086x1448，回传飞书表更新"""
import hashlib
import json
import os
import shutil
import sys
import time

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wb_feishu_sheet_sync import (SPREADSHEET, SHEET_ID, WORK_DIR,
                                  api, token, upload)

FINISHED = ["P1-婺源晒秋团建封面.png", "P2-篁岭晒秋场景.png",
            "P3-婺源行程玩法.png", "P4-怪屋趣味打卡.png"]
BACKUP_DIR = os.path.join(WORK_DIR, "_原始带水印备份")
CROP_BOTTOM = 80          # 裁掉底部像素（水印顶沿约1471，留20px余量）
TARGET_W, TARGET_H = 1086, 1448  # 成品库标准 3:4


def crop_fit(path):
    """裁底→等比放大到宽1086→上下对称裁到1448，无变形"""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    im = im.crop((0, 0, w, h - CROP_BOTTOM))
    scale = TARGET_W / im.size[0]
    im = im.resize((TARGET_W, round(im.size[1] * scale)), Image.LANCZOS)
    excess = im.size[1] - TARGET_H
    top = excess // 2
    im = im.crop((0, top, TARGET_W, top + TARGET_H))
    return im


def find_or_create_folder(tok):
    root = api("GET", "/open-apis/drive/explorer/v2/root_folder/meta", tok)["data"]["token"]
    r = api("GET", "/open-apis/drive/v1/files", tok, query={"page_size": 200, "folder_token": root})
    for x in r.get("data", {}).get("files", []):
        if x.get("name") == "WorkBuddy流水线-婺源晒秋套" and x.get("type") == "folder":
            return x.get("token")
    r2 = api("POST", "/open-apis/drive/v1/files/create_folder", tok,
             {"name": "WorkBuddy流水线-婺源晒秋套", "folder_token": root})
    return r2.get("data", {}).get("token")


def main():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    hashes = json.load(open(os.path.join(WORK_DIR, "_hashes.json"), encoding="utf-8"))

    print("== 1) 本地裁剪 ==")
    for f in FINISHED:
        src = os.path.join(WORK_DIR, f)
        bak = os.path.join(BACKUP_DIR, f)
        if not os.path.exists(bak):
            shutil.copy2(src, bak)
        im = crop_fit(bak)
        im.save(src, "PNG")
        h = hashlib.sha256(open(src, "rb").read()).hexdigest().upper()
        hashes[f] = {"size": os.path.getsize(src), "sha256": h,
                     "size_px": f"{TARGET_W}x{TARGET_H}"}
        print("  ", f, f"{TARGET_W}x{TARGET_H}", h[:16])
    json.dump(hashes, open(os.path.join(WORK_DIR, "_hashes.json"), "w",
                           encoding="utf-8"), ensure_ascii=False, indent=1)

    print("== 2) manifest 更新 ==")
    mp = os.path.join(WORK_DIR, "manifest.json")
    m = json.load(open(mp, encoding="utf-8"))
    for pm in m["页面映射"]:
        f = pm["成图"]
        pm["成图尺寸"] = f"{TARGET_W}x{TARGET_H}"
        pm["成图SHA256"] = hashes[f]["sha256"]
        pm["快速检查"] = (pm.get("快速检查", "") +
                          "；已裁剪去除右下角「AI生成 WORKBUDDY」水印并归一1086x1448")
    m["水印处置"] = "已裁剪去除（2026-09-21，裁底80px+等比归一1086x1448，原件存 _原始带水印备份）"
    m["事实锚点"] = "V2文案按本地方案文档重写：FA0633《婺女洲篁岭2日（纯玩）》+ FA0632《篁岭+李坑2天1夜》"
    m["progress"]["status"] = "COMPLETED_PENDING_SPOTCHECK"
    json.dump(m, open(mp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("   manifest.json 已更新")

    print("== 3) 重传飞书云盘 ==")
    tok = token()
    folder = find_or_create_folder(tok)
    print("   云盘目录:", folder)
    new_links = []
    for f in FINISHED:
        r = upload(tok, os.path.join(WORK_DIR, f), "explorer", folder)
        ft = r.get("data", {}).get("file_token")
        new_links.append(f"https://my.feishu.cn/file/{ft}")
        print("  重传", f, r.get("code"), ft)
        time.sleep(0.3)

    print("== 4) 更新表格 ==")
    r = api("PUT", f"/open-apis/sheets/v2/spreadsheets/{SPREADSHEET}/values", tok,
            {"valueRange": {"range": f"{SHEET_ID}!D3:G3", "values": [new_links]}})
    print("   成品图链:", r.get("code"), r.get("msg"))
    r = api("PUT", f"/open-apis/sheets/v2/spreadsheets/{SPREADSHEET}/values", tok,
            {"valueRange": {"range": f"{SHEET_ID}!C3:C3",
                            "values": [["WorkBuddy混元直出首套（4页1086x1448）；水印已裁剪去除；文案V2已按本地方案FA0633/FA0632事实重写；待人工打分"]]}})
    print("   备注列:", r.get("code"), r.get("msg"))


if __name__ == "__main__":
    main()
