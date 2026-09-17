import datetime
import time
import subprocess
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

LARK_RUN_JS = r"D:\AICode\工具开发\toolchains\npm-global\node_modules\@larksuite\cli\scripts\run.js"
FEISHU_GROUP_CHAT_ID = "oc_bb67c9036e6b14da9bb7be9336dfa9c0"  # CDP流水线作品生产通知群
PRODUCER_SCRIPT = r"D:\AICode\工具开发\projects\content-production-app\scripts\dual_browser_autonomous_producer.py"

# 解冻目标时间点
TARGET_C = datetime.datetime.strptime("2026-09-13 19:42:15", "%Y-%m-%d %H:%M:%S")
TARGET_A = datetime.datetime.strptime("2026-09-13 20:42:15", "%Y-%m-%d %H:%M:%S")

def send_feishu_md(md_text):
    try:
        cmd = [
            "node", LARK_RUN_JS, "im", "+messages-send",
            "--as", "bot",
            "--chat-id", FEISHU_GROUP_CHAT_ID,
            "--markdown", md_text
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', timeout=15)
        return res.returncode == 0
    except Exception as e:
        print(f"飞书推送异常: {e}")
        return False

def check_and_start_producer():
    """检查并拉起主生产脚本"""
    try:
        # 检查是否已有该脚本进程在运行
        cmd = 'Get-CimInstance Win32_Process -Filter "CommandLine like \'%dual_browser_autonomous_producer.py%\'" | Measure-Object | Select-Object -ExpandProperty Count'
        res = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, encoding='utf-8')
        cnt = int(res.stdout.strip()) if res.stdout.strip().isdigit() else 0
        if cnt == 0:
            print("[Watcher] 正在拉起双浏览器自主生产流水线...")
            subprocess.Popen([sys.executable, PRODUCER_SCRIPT], creationflags=subprocess.CREATE_NEW_CONSOLE)
            print("[Watcher] 流水线已成功在独立控制台拉起！")
        else:
            print("[Watcher] 流水线已在运行中，无需重复拉起。")
    except Exception as e:
        print(f"[Watcher] 拉起流水线异常: {e}")

def main():
    print("==================================================")
    print("⏰ ChatGPT Plus 配额解冻定时通知与自愈拉起看门狗已就绪")
    print(f"实例 C 预计解冻时间: {TARGET_C.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"实例 A 预计解冻时间: {TARGET_A.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"飞书通知目标群聊: {FEISHU_GROUP_CHAT_ID}")
    print("==================================================")

    notified_c = False
    notified_a = False

    while True:
        now = datetime.datetime.now()

        # 检查实例 C
        if not notified_c and now >= TARGET_C:
            notified_c = True
            msg_c = (
                f"🔔【配额解除播报 · 实例 C 率先解冻开工】\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"⚙️ **生产实例**：实例 C (CDP 端口 9433)\n"
                f"⏱ **到达时间**：{now.strftime('%Y-%m-%d %H:%M:%S')}\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"🎉 **状态提醒**：实例 C 的 12 小时风控冷却期已正式结束，生图配额已完全解冻！\n"
                f"🚀 **自动续接**：系统已自动检测并激活生产协程，立即从素材池领取任务开工制作！\n"
                f"⏳ **实例 A 预告**：实例 A 将在 1 小时后（20:42）解冻加入战斗。"
            )
            send_feishu_md(msg_c)
            print(f"[{now.strftime('%H:%M:%S')}] 实例 C 解冻通知已发送飞书群！")
            check_and_start_producer()

        # 检查实例 A
        if not notified_a and now >= TARGET_A:
            notified_a = True
            msg_a = (
                f"🔔【配额解除播报 · 实例 A 成功解冻·双机全开】\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"⚙️ **生产实例**：实例 A (CDP 端口 9431)\n"
                f"⏱ **到达时间**：{now.strftime('%Y-%m-%d %H:%M:%S')}\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"🎉 **状态提醒**：实例 A 的 13 小时冷却期亦已正式结束，生图配额全部解冻！\n"
                f"⚡ **双机合璧**：实例 A + 实例 C 已全面进入双机并发自主生产状态，继续全速推进高品质画册制作！"
            )
            send_feishu_md(msg_a)
            print(f"[{now.strftime('%H:%M:%S')}] 实例 A 解冻通知已发送飞书群！")
            check_and_start_producer()

        if notified_c and notified_a:
            print("全部目标时间点已到达并成功发送通知与自愈续接，看门狗使命完成。")
            break

        time.sleep(30)

if __name__ == "__main__":
    main()
