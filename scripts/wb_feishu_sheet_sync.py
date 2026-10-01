# -*- coding: utf-8 -*-
"""
WorkBuddy 飞书流水线同步器 V1
1) 上传本地「素材 + 成品」图片到飞书云盘（小号扛存储，C 盘零残留）
2) 把成对行写入飞书表「workbuddy流水线」页签：类型/本地绝对路径/我的备注和打分/P1..P12(可点击直链)
3) 成品行整行渲染浅天蓝 #E8F3FF，素材行白底
4) 可推送飞书群卡片
用法:
  python wb_feishu_sheet_sync.py plan      # 只打印将写入的行，不写表
  python wb_feishu_sheet_sync.py run       # 正式执行
"""
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

SECRETS = r"D:/AICode/AI/secrets/平台服务/飞书/feishu_config.json"
SPREADSHEET = "D7OMsirIChkd2gt8TMBcPHD9ndc"
SHEET_ID = "KnJQ0r"
DRIVE_FOLDER_NAME = "WorkBuddy流水线-婺源晒秋套"
PIPELINE_CHAT = "oc_a620407b836cb421f8bb72c0d6f596f1"  # 流水线作品生产通知群

WORK_DIR = ("D:/AICode/项目推进/projects/江湖有旅人/主项目/成品库（GPT+本地脚本制作）"
            "/_制作中/20260921_0845-WorkBuddy混元直出-婺源晒秋秋季团建")
SRC_DIR = ("D:/AICode/项目推进/projects/江湖有旅人/主项目/01-素材库/秋季（9—11月·智能分类）"
           "/精准流量/杭州/评8-赞3-婺源晒秋团建🍂10-11月必去🥰")

FINISHED = ["P1-婺源晒秋团建封面.png", "P2-篁岭晒秋场景.png", "P3-婺源行程玩法.png", "P4-怪屋趣味打卡.png"]
RAW = [f"P{i}.jpg" for i in range(1, 9)]

TYPE_COL = 0      # A 类型
PATH_COL = 1      # B 本地绝对物理路径
NOTE_COL = 2      # C 我的备注和打分
IMG_COL0 = 3      # D 起：P1(封面) ...
HEADERS = ["类型", "本地绝对物理路径", "我的备注和打分。"] + \
          [f"P{i} (封面)" if i == 1 else f"P{i} (内页{i-1})" for i in range(1, 13)]


def api(method, path, tok, body=None, query=None, base="https://open.feishu.cn"):
    url = base + path + (("?" + urllib.parse.urlencode(query)) if query else "")
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": "Bearer " + tok}
    if data:
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        return json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e:
        return {"code": e.code, "msg": e.read().decode(errors="replace")[:300]}


def token():
    cfg = json.load(open(SECRETS, encoding="utf-8"))
    r = api("POST", "/open-apis/auth/v3/tenant_access_token/internal", "",
            {"app_id": cfg["app_id"], "app_secret": cfg["app_secret"]})
    return r["tenant_access_token"]


def upload(tok, path, parent_type, parent_node):
    size = os.path.getsize(path)
    name = os.path.basename(path)
    boundary = "----wb" + uuid.uuid4().hex
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        data = f.read()
    parts = []
    for k, v in [("file_name", name), ("parent_type", parent_type),
                 ("parent_node", parent_node), ("size", str(size))]:
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
                 f"Content-Type: {mime}\r\n\r\n".encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    req = urllib.request.Request(
        "https://open.feishu.cn/open-apis/drive/v1/medias/upload_all",
        data=b"".join(parts),
        headers={"Authorization": "Bearer " + tok,
                 "Content-Type": f"multipart/form-data; boundary={boundary}"})
    return json.loads(urllib.request.urlopen(req, timeout=300).read())


def root_folder(tok):
    r = api("GET", "/open-apis/drive/explorer/v2/root_folder/meta", tok)
    return r.get("data", {}).get("token")


def ensure_folder(tok, name, parent):
    r = api("GET", "/open-apis/drive/v1/files", tok,
            query={"page_size": 200, "folder_token": parent})
    for f in r.get("data", {}).get("files", []):
        if f.get("name") == name and f.get("type") == "folder":
            return f.get("token"), False
    r2 = api("POST", "/open-apis/drive/v1/files/create_folder", tok,
             {"name": name, "folder_token": parent})
    return r2.get("data", {}).get("token"), True


def main(run=False):
    tok = token()
    root = root_folder(tok)
    print("drive root:", root)
    folder, created = ensure_folder(tok, DRIVE_FOLDER_NAME, root)
    print("folder:", folder, "(新建)" if created else "(复用)")

    rows = []
    mapping = {}

    # ---- 素材行（白底）----
    raw_tokens = []
    for f in RAW:
        p = os.path.join(SRC_DIR, f)
        if run:
            r = upload(tok, p, "explorer", folder)
            ft = r.get("data", {}).get("file_token")
            print("  素材上传", f, r.get("code"), ft)
            time.sleep(0.3)
        else:
            ft = "DRY"
        raw_tokens.append(ft)
    raw_links = [""] * 12
    for i, ft in enumerate(raw_tokens):
        raw_links[i] = f"https://my.feishu.cn/file/{ft}" if ft else ""
    rows.append(["1素材", SRC_DIR, "婺源晒秋原素材（8图，抖音笔记，作者：神秘的momo团建酱）"] + raw_links)
    mapping["1素材"] = raw_tokens

    # ---- 成品行（浅天蓝）----
    fin_tokens = []
    for f in FINISHED:
        p = os.path.join(WORK_DIR, f)
        if run:
            r = upload(tok, p, "explorer", folder)
            ft = r.get("data", {}).get("file_token")
            print("  成品上传", f, r.get("code"), ft)
            time.sleep(0.3)
        else:
            ft = "DRY"
        fin_tokens.append(ft)
    fin_links = [f"https://my.feishu.cn/file/{ft}" if ft else "" for ft in fin_tokens] + [""] * 8
    rows.append(["1成品", WORK_DIR, "WorkBuddy混元直出首套（4页，md5见manifest）；水印暂未去除；待人工打分"] + fin_links)
    mapping["1成品"] = fin_tokens

    if not run:
        print("\n[DRY-RUN] 将写入行数:", len(rows))
        for r in rows:
            print("  ", r[0], "|", r[1][-40:], "|", r[2][:30], "| 图片列:", len([x for x in r[3:] if x]))
        return

    # ---- 表头 ----
    r = api("PUT", f"/open-apis/sheets/v2/spreadsheets/{SPREADSHEET}/values", tok,
            {"valueRange": {"range": f"{SHEET_ID}!A1:O1", "values": [HEADERS]}})
    print("表头:", r.get("code"), r.get("msg"))

    # ---- 数据行 A2:O3 ----
    r = api("PUT", f"/open-apis/sheets/v2/spreadsheets/{SPREADSHEET}/values", tok,
            {"valueRange": {"range": f"{SHEET_ID}!A2:O3", "values": rows}})
    print("数据行:", r.get("code"), r.get("msg"))

    # ---- 成品行整行浅天蓝 #E8F3FF（行号3，1-based）----
    r = api("PUT", f"/open-apis/sheets/v2/spreadsheets/{SPREADSHEET}/styles_batch_update", tok,
            {"data": [{"ranges": [f"{SHEET_ID}!A3:O3"],
                       "style": {"backColor": "#E8F3FF"}}]})
    print("成品行配色:", r.get("code"), r.get("msg"))

    json.dump(mapping, open("_wb_last_upload_tokens.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("完成。表格:", f"https://my.feishu.cn/sheets/{SPREADSHEET}?sheet={SHEET_ID}")


if __name__ == "__main__":
    main(run=(len(sys.argv) > 1 and sys.argv[1] == "run"))
