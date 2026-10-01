# -*- coding: utf-8 -*-
"""
wb_plan_board.py — 江湖有旅人 AUTUMN-C 生产计划看板（人工可编辑）

两种模式：
  render : 扫描 AUTUMN-C_tasks.json + 各素材 .tags.json → 生成/刷新看板 xlsx（保留人工指令列）
  apply  : 读取看板中「人工指令」列 → 安全写回 tags 真源（原子写 + 备份 + 留痕）
  dryrun : 只打印 apply 将要做的动作，不落盘

支持的指令（写在「人工指令」列）：
  暂停  → lifecycleState=需人工复核（主脑跳过，不再排队）
  恢复  → lifecycleState=待生产（回到队列）
  重做  → lifecycleState=待生产 + requeueNote（对 已生产/生产异常/需人工复核 有效）
  留空  → 不动

约定：
  - 看板文件 : D:\\AICode\\运行数据\\江湖有旅人\\生产计划看板.xlsx
  - 状态存档 : D:\\AICode\\运行数据\\江湖有旅人\\计划看板_state.json
  - 改动备份 : D:\\AICode\\运行数据\\jianghu-plan-board-backup\\<时间戳>\\
  - 所有 tags 写入均为 tmp+os.replace 原子写，写前整目录备份
"""

import json
import os
import shutil
import sys
from datetime import datetime

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

TASKS_JSON = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\04-技能库\运行记录\秋季四路并发任务\AUTUMN-C_tasks.json"
BOARD_XLSX = r"D:\AICode\运行数据\江湖有旅人\生产计划看板.xlsx"
STATE_JSON = r"D:\AICode\运行数据\江湖有旅人\计划看板_state.json"
BACKUP_DIR = r"D:\AICode\运行数据\jianghu-plan-board-backup"

STATE_COLORS = {
    "待生产": "E2EFDA",
    "已打标待生产": "E2EFDA",
    "生产中": "FFF2CC",
    "已生产": "DDEBF7",
    "生产异常": "F8CBAD",
    "需人工复核": "FCE4D6",
    "无tags": "EDEDED",
}
INSTRUCTIONS = ("暂停", "恢复", "重做")


def load_state():
    if os.path.exists(STATE_JSON):
        try:
            return json.load(open(STATE_JSON, encoding="utf-8"))
        except Exception:
            pass
    return {"applied": {}}


def save_state(state):
    os.makedirs(os.path.dirname(STATE_JSON), exist_ok=True)
    tmp = STATE_JSON + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE_JSON)


def read_tags(path):
    tp = os.path.join(path, ".tags.json")
    if not os.path.exists(tp):
        return None, tp
    try:
        return json.load(open(tp, encoding="utf-8")), tp
    except Exception:
        return "READ_ERROR", tp


def get_lifecycle(tags):
    if tags is None:
        return "无tags"
    if tags == "READ_ERROR":
        return "tags损坏"
    return str(tags.get("production", {}).get("lifecycleState", "无production字段"))


def collect_rows():
    tasks = json.load(open(TASKS_JSON, encoding="utf-8"))["tasks"]
    rows = []
    for t in tasks:
        tags, _ = read_tags(t["path"])
        rows.append({
            "index": t.get("index"),
            "name": t.get("name", ""),
            "dest": t.get("destination", ""),
            "traffic": t.get("traffic_type", ""),
            "imgs": t.get("img_count", 0),
            "weight": t.get("weight", 0),
            "state": get_lifecycle(tags),
            "path": t["path"],
        })
    return rows


def render():
    rows = collect_rows()
    state = load_state()
    applied = state.get("applied", {})

    # 保留旧看板里「已应用过」的指令文本与结果列（未应用的人工编辑不会被抹掉）
    old_cmd = {}
    if os.path.exists(BOARD_XLSX):
        try:
            ows = load_workbook(BOARD_XLSX).active
            for row in range(2, ows.max_row + 1):
                idx = ows.cell(row=row, column=1).value
                if idx is None:
                    continue
                key = str(idx)
                cmd = str(ows.cell(row=row, column=8).value or "").strip()
                if cmd:
                    old_cmd[key] = cmd
        except Exception:
            old_cmd = {}

    wb = Workbook()
    ws = wb.active
    ws.title = "生产计划"
    headers = ["序号", "素材名", "目的地", "流量", "原料图数", "权重",
               "当前状态", "人工指令", "应用结果", "更新时间"]
    ws.append(headers)
    for c in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=c)
        cell.font = Font(bold=True, size=11)
        cell.fill = PatternFill("solid", fgColor="4472C4")
        cell.font = Font(bold=True, color="FFFFFF", size=11)
        cell.alignment = Alignment(horizontal="center", vertical="center")

    for r in rows:
        key = str(r["index"])
        prev = applied.get(key, {})
        ws.append([r["index"], r["name"], r["dest"], r["traffic"], r["imgs"],
                   r["weight"], r["state"], old_cmd.get(key, ""), prev.get("result", ""),
                   prev.get("time", "")])
        row = ws.max_row
        color = STATE_COLORS.get(r["state"])
        if color:
            ws.cell(row=row, column=7).fill = PatternFill("solid", fgColor=color)

    widths = [6, 52, 12, 10, 9, 7, 13, 11, 26, 17]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:J{ws.max_row}"

    dv = DataValidation(type="list", formula1='"暂停,恢复,重做"', allow_blank=True,
                        showDropDown=False, promptTitle="人工指令",
                        prompt="暂停=移出队列 / 恢复=回队列 / 重做=清状态回队列")
    ws.add_data_validation(dv)
    dv.add(f"H2:H{ws.max_row}")

    os.makedirs(os.path.dirname(BOARD_XLSX), exist_ok=True)
    wb.save(BOARD_XLSX)
    print(f"[render] 看板已生成: {BOARD_XLSX}（{len(rows)} 行）")
    summary = {}
    for r in rows:
        summary[r["state"]] = summary.get(r["state"], 0) + 1
    for k, v in sorted(summary.items(), key=lambda x: -x[1]):
        print(f"    {k}: {v}")


def atomic_write_json(fp, obj):
    tmp = fp + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.replace(tmp, fp)


def backup_tags(path, stamp):
    dst = os.path.join(BACKUP_DIR, stamp)
    os.makedirs(dst, exist_ok=True)
    safe = "".join(ch for ch in os.path.basename(path) if ch not in '\\/:*?"<>|')[:80]
    shutil.copy2(os.path.join(path, ".tags.json"), os.path.join(dst, f"{safe}.tags.json"))


def build_actions(dryrun=False):
    """返回 [(row, action)]，人工指令与上次已应用的相同则跳过。"""
    if not os.path.exists(BOARD_XLSX):
        print("[apply] 看板不存在，先执行 render")
        return []
    ws = load_workbook(BOARD_XLSX).active
    state = load_state()
    applied = state.setdefault("applied", {})
    rows = {str(r["index"]): r for r in collect_rows()}
    actions = []
    for row in range(2, ws.max_row + 1):
        idx = ws.cell(row=row, column=1).value
        if idx is None:
            continue
        key = str(idx)
        r = rows.get(key)
        if not r:
            continue
        cmd = str(ws.cell(row=row, column=8).value or "").strip()
        if not cmd:
            continue
        if cmd not in INSTRUCTIONS:
            continue  # 非法指令忽略，不报错不写盘
        if applied.get(key, {}).get("instruction") == cmd and \
           applied.get(key, {}).get("state_at") == r["state"]:
            continue  # 已应用过同样指令且状态未变
        actions.append((row, key, r, cmd))
    return actions


def apply(dryrun=False):
    actions = build_actions()
    if not actions:
        print("[apply] 没有待应用的人工指令")
        return
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if dryrun:
        for _, key, r, cmd in actions:
            print(f"  [dry] #{key} {r['name'][:40]} : {r['state']} --{cmd}--> ", end="")
            print("需人工复核" if cmd == "暂停" else "待生产")
        print(f"[dryrun] 共 {len(actions)} 条待应用（未落盘）")
        return

    state = load_state()
    applied = state.setdefault("applied", {})
    now = datetime.now().strftime("%m-%d %H:%M")
    ws = load_workbook(BOARD_XLSX).active
    done = 0
    for row, key, r, cmd in actions:
        tags, tp = read_tags(r["path"])
        if tags in (None, "READ_ERROR"):
            tags = {"production": {}}
        tags.setdefault("production", {})
        if cmd == "暂停":
            new_state = "需人工复核"
            tags["production"]["applyNote"] = f"人工暂停(看板) {now}"
        elif cmd == "恢复":
            new_state = "待生产"
            tags["production"]["applyNote"] = f"人工恢复(看板) {now}"
        else:  # 重做
            new_state = "待生产"
            tags["production"]["requeueNote"] = f"人工重做(看板) {now}"
        old_state = r["state"]
        tags["production"]["lifecycleState"] = new_state
        os.makedirs(os.path.join(r["path"]), exist_ok=True)
        if os.path.exists(tp):
            backup_tags(r["path"], stamp)
        atomic_write_json(tp, tags)
        result = f"{old_state} → {new_state}"
        applied[key] = {"instruction": cmd, "state_at": new_state,
                        "result": result, "time": now}
        ws.cell(row=row, column=9).value = result
        ws.cell(row=row, column=10).value = now
        ws.cell(row=row, column=7).fill = PatternFill("solid",
            fgColor=STATE_COLORS.get(new_state, "FFFFFF"))
        done += 1
        print(f"  [ok] #{key} {r['name'][:40]} : {result}")
    ws.parent.save(BOARD_XLSX)
    save_state(state)
    print(f"[apply] 已应用 {done} 条，tags 已原子写回，备份在 {os.path.join(BACKUP_DIR, stamp)}")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "render"
    if mode == "render":
        render()
    elif mode == "apply":
        apply()
    elif mode == "dryrun":
        apply(dryrun=True)
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
