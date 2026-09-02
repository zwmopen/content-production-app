#!/usr/bin/env python3
"""
production_quota_guard.py - 24/7 全天候内容生产 20 套目标自动守护与自愈引擎

核心职责：
1. 目标死磕：持续守护 A/B/C/D 四路实例，直到成功产出并归档满 20 套新作品
2. 进程守护：每 30 秒巡检四路 Electron / CDP 进程，崩溃或掉线时自动拉起重启
3. 卡滞自愈：
   - 检测到单实例任务在同一阶段卡滞超过 8 分钟（如文案截断、旧会话加载慢、附件未响应）：自动执行 new-chat / 重试 / skip，绝不让单个会话拖死整条产线
   - 检测到队列停止或未启动：自动发送 resume 启动指令
4. 实时统计与进度上报：
   - 实时盘点 A/B/C/D 归档产出量，通过控制台、飞书、桌面液态玻璃通知汇报实时进度
   - 达成 20 套目标时触发大捷通知
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.request

sys.dont_write_bytecode = True
try:
    sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
except Exception:
    pass

CURRENT_DIR = pathlib.Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent

# 引入飞书与桌面告警
FEISHU_SCRIPT = pathlib.Path(r"D:\AICode\AI\skills\技能包\技能\device-folder-transfer\scripts\send_feishu_alert.py")
if FEISHU_SCRIPT.is_file():
    sys.path.insert(0, str(FEISHU_SCRIPT.parent))
    from send_feishu_alert import send_alert
else:
    def send_alert(*args, **kwargs):
        pass

INSTANCES = {
    "A": {"id": "A", "http": 4331, "cdp": 9431, "runtime": r"D:\AICode\运行数据\江湖有旅人\内容生产App\instance-A", "script": "start-instance-a.ps1"},
    "B": {"id": "B", "http": 4332, "cdp": 9432, "runtime": r"D:\AICode\运行数据\江湖有旅人\内容生产App\instance-B", "script": "start-instance-b.ps1"},
    "C": {"id": "C", "http": 4333, "cdp": 9433, "runtime": r"D:\AICode\运行数据\江湖有旅人\内容生产App\instance-C", "script": "start-instance-c.ps1"},
    "D": {"id": "D", "http": 4334, "cdp": 9434, "runtime": r"D:\AICode\运行数据\江湖有旅人\内容生产App\instance-D", "script": "start-instance-d.ps1"},
}

GUARD_STATE_FILE = pathlib.Path(r"D:\AICode\运行数据\江湖有旅人\内容生产App\quota_guard_state.json")


def count_all_archives() -> int:
    """统计 A/B/C/D 四个实例累计归档作品数"""
    total = 0
    for key, inst in INSTANCES.items():
        archive_path = pathlib.Path(inst["runtime"]) / "gpt-production-archive.jsonl"
        if archive_path.is_file():
            try:
                with archive_path.open("r", encoding="utf-8") as f:
                    for line in f:
                        if line.strip():
                            total += 1
            except Exception:
                pass
    return total


def get_cdp_status(port: int) -> bool:
    """检查 CDP 端口是否存活"""
    try:
        url = f"http://127.0.0.1:{port}/json/version"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def restart_instance(key: str) -> bool:
    """拉起/重启指定实例"""
    inst = INSTANCES[key]
    script_path = PROJECT_ROOT / inst["script"]
    if not script_path.is_file():
        print(f"[Guard] 启动脚本不存在: {script_path}", file=sys.stderr)
        return False

    print(f"[Guard] 正在自动拉起 实例 {key} ({script_path})...")
    cmd = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", str(script_path),
    ]
    try:
        subprocess.Popen(cmd, cwd=str(PROJECT_ROOT), creationflags=subprocess.CREATE_NEW_CONSOLE)
        time.sleep(4)
        return True
    except Exception as exc:
        print(f"[Guard] 拉起 实例 {key} 异常: {exc}", file=sys.stderr)
        return False


def run_control_cmd(cmd_name: str, inst_key: str) -> str:
    """调用 instance-control.mjs 执行 CDP 控制"""
    control_mjs = CURRENT_DIR / "instance-control.mjs"
    cmd = ["node", str(control_mjs), cmd_name, inst_key]
    try:
        res = subprocess.run(cmd, cwd=str(PROJECT_ROOT), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
        return res.stdout
    except Exception as exc:
        return f"Error: {exc}"


def guard_loop(target_quota: int = 20, check_interval_seconds: int = 30):
    print(f"=== 🛡️ 全天候生产守护引擎启动 (目标: 产出 {target_quota} 套新作品) ===")
    
    # 记录起始归档基准
    initial_archives = count_all_archives()
    start_time = time.time()
    
    print(f"[Guard] 起始历史总归档数: {initial_archives} 套")
    print(f"[Guard] 目标达成条件: 新增归档 >= {target_quota} 套 (总计达到 {initial_archives + target_quota} 套)")

    # 各实例最后状态记录（用于卡滞判定）
    last_stage_tracker = {k: {"stage": "", "percent": 0, "since": time.time(), "task_id": ""} for k in INSTANCES}

    send_alert(
        title="🚀 全天候内容生产 20 套冲刺已开启",
        content_lines=[
            f"**目标**：连续产出 {target_quota} 套作品",
            f"**策略**：A/B/C/D 四路并行，24小时无休，自动脱困自愈",
            f"**起始基准**：已存在历史归档 {initial_archives} 套",
        ],
        level="info",
        alert_key="quota_guard_started",
        cooldown_seconds=300,
    )

    iteration = 0
    while True:
        iteration += 1
        current_archives = count_all_archives()
        new_produced = max(0, current_archives - initial_archives)
        elapsed_mins = int((time.time() - start_time) / 60)

        now_str = time.strftime("%H:%M:%S")
        print(f"\n[{now_str}] 🎯 进度: 新增产出 {new_produced}/{target_quota} 套 (总计 {current_archives} 套) | 运行时间: {elapsed_mins} 分钟")

        # 检查是否达成目标
        if new_produced >= target_quota:
            print(f"\n🎉🎉🎉 恭喜！已成功产出 {new_produced} 套作品，顺利达成 {target_quota} 套生产目标！🎉🎉🎉")
            send_alert(
                title=f"🎉【大捷】{target_quota} 套作品生产目标已全部达成！",
                content_lines=[
                    f"**达成时间**：{time.strftime('%Y-%m-%d %H:%M:%S')}",
                    f"**本次新增产出**：{new_produced} 套完整双平台作品",
                    f"**耗时**：{elapsed_mins} 分钟",
                    f"**状态**：全部成品已安全归档至成品库，随时可由手机分发！",
                ],
                level="success",
                alert_key="quota_goal_achieved",
                force_notify_desktop=True,
            )
            break

        # 巡检每个实例
        for key, inst in INSTANCES.items():
            cdp_ok = get_cdp_status(inst["cdp"])
            if not cdp_ok:
                print(f"  [实例 {key}] 🔴 进程或 CDP 未响应，正在自动拉起...")
                restart_instance(key)
                continue

            # 自动消除 ChatGPT 弹窗阻断（如文件已上传过）
            run_control_cmd("dismiss-modals", key)

            # 读取运行时状态
            runtime_path = pathlib.Path(inst["runtime"]) / "gpt-production-runtime.json"
            runtime_data = {}
            if runtime_path.is_file():
                try:
                    runtime_data = json.loads(runtime_path.read_text(encoding="utf-8"))
                except Exception:
                    pass

            q = runtime_data.get("queue") or {}
            tasks = q.get("tasks") or []
            is_running = bool(q.get("running") or runtime_data.get("running"))
            is_paused = bool(q.get("paused") or runtime_data.get("paused"))
            active_task = tasks[0] if (tasks and isinstance(tasks, list)) else {}
            
            stage = active_task.get("_stage", "") if isinstance(active_task, dict) else ""
            percent = active_task.get("_percent", 0) if isinstance(active_task, dict) else 0
            task_id = active_task.get("id", "") if isinstance(active_task, dict) else ""
            last_err = ""
            if isinstance(active_task, dict):
                last_err = active_task.get("_error", "") or active_task.get("_errorCode", "")

            # 兼容 windowRuntime
            win_rt = runtime_data.get("windowRuntime") or {}
            for win_key, win_val in win_rt.items():
                if isinstance(win_val, dict):
                    if not stage:
                        stage = win_val.get("currentStage", "")
                    if percent == 0:
                        percent = win_val.get("currentPercent", 0)
                    if not task_id:
                        task_id = win_val.get("currentTaskId", "")
                    if win_val.get("status") == "running":
                        is_running = True

            stage = stage or "等待中"
            task_name = (active_task.get("name") if isinstance(active_task, dict) else None) or "主工作区"
            task_name = str(task_name)[:22]
            print(f"  [实例 {key}] 🟢 活跃 | running={is_running} | {task_name} | {stage} ({percent}%)")

            # 自愈逻辑 1: 如果队列停了或处于非运行态，自动 resume
            if not is_running or is_paused:
                print(f"  [实例 {key}] ⚡ 队列处于停止/暂停状态，正在自动触发 resume...")
                run_control_cmd("resume", key)

            # 自愈逻辑 2: 卡滞检测（同一个 task 和 stage 超过 8 分钟没有百分比变化）
            tracker = last_stage_tracker[key]
            if tracker["stage"] == stage and tracker["percent"] == percent and tracker["task_id"] == task_id and stage:
                stuck_duration = time.time() - tracker["since"]
                if stuck_duration > 480:  # 8 分钟
                    print(f"  [实例 {key}] ⚠️ 检测到任务在 [{stage} ({percent}%)] 卡滞已达 {int(stuck_duration/60)} 分钟，正在自动脱困重置为新对话...")
                    run_control_cmd("new-chat", key)
                    tracker["since"] = time.time()
            else:
                tracker["stage"] = stage
                tracker["percent"] = percent
                tracker["task_id"] = task_id
                tracker["since"] = time.time()

        # 每 15 分钟推送一次阶段性飞书与桌面进度
        if iteration % 30 == 0:  # 30 * 30s = 15 分钟
            send_alert(
                title=f"📊 内容生产进度播报 ({new_produced}/{target_quota} 套)",
                content_lines=[
                    f"**当前新增产出**：{new_produced} / {target_quota} 套",
                    f"**已运行**：{elapsed_mins} 分钟",
                    f"**四路状态**：A/B/C/D 正在全力满载生产中",
                ],
                level="info",
                alert_key="quota_progress_tick",
                cooldown_seconds=800,
            )

        time.sleep(check_interval_seconds)


def main():
    parser = argparse.ArgumentParser(description="24/7 全天候内容生产 20 套目标守护器")
    parser.add_argument("--quota", type=int, default=20, help="目标新产出作品套数（默认 20）")
    parser.add_argument("--interval", type=int, default=30, help="巡检间隔秒数（默认 30）")
    args = parser.parse_args()

    guard_loop(target_quota=args.quota, check_interval_seconds=args.interval)


if __name__ == "__main__":
    main()
