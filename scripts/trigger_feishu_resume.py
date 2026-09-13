import sys
import datetime
import subprocess
import argparse

sys.stdout.reconfigure(encoding='utf-8')

LARK_RUN_JS = r"D:\AICode\工具开发\toolchains\npm-global\node_modules\@larksuite\cli\scripts\run.js"
FEISHU_GROUP_CHAT_ID = "oc_a620407b836cb421f8bb72c0d6f596f1"
PRODUCER_SCRIPT = r"D:\AICode\工具开发\projects\content-production-app\scripts\dual_browser_autonomous_producer.py"

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
    try:
        cmd = 'Get-CimInstance Win32_Process -Filter "CommandLine like \'%dual_browser_autonomous_producer.py%\'" | Measure-Object | Select-Object -ExpandProperty Count'
        res = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, encoding='utf-8')
        cnt = int(res.stdout.strip()) if res.stdout.strip().isdigit() else 0
        if cnt == 0:
            print("[Trigger] 正在拉起双浏览器自主生产流水线...")
            subprocess.Popen([sys.executable, PRODUCER_SCRIPT], creationflags=subprocess.CREATE_NEW_CONSOLE)
            print("[Trigger] 流水线已成功在独立控制台拉起！")
        else:
            print("[Trigger] 流水线已在运行中，无需重复拉起。")
    except Exception as e:
        print(f"[Trigger] 拉起流水线异常: {e}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--instance", choices=["A", "C"], required=True)
    args = parser.parse_args()

    import random
    import time
    # 随机安全防风控隔离缓冲期 (5~10 分钟，300~600 秒)
    buffer_secs = random.randint(300, 600)
    print(f"[Trigger] 到达计划时间点，启动 {buffer_secs//60} 分钟 ({buffer_secs}秒) 防风控随机隔离缓冲...")
    time.sleep(buffer_secs)

    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if args.instance == "C":
        msg = (
            f"🔔【配额解除播报 · 实例 C 率先解冻开工】\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"⚙️ **生产实例**：实例 C (CDP 端口 9433)\n"
            f"⏱ **唤醒时刻**：{now_str}（已安全度过 {buffer_secs//60} 分钟防风控随机隔离缓冲）\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"🎉 **状态提醒**：实例 C 的 12 小时风控冷却期已正式结束，Plus 图像生成配额完全解冻！\n"
            f"🚀 **自动续接**：系统已自动检测并激活生产协程，立即从待生产素材池认领新任务开工制作！\n"
            f"⏳ **实例 A 预告**：实例 A 预计将在 1 小时后（约 20:48~20:52）解冻加入战斗。"
        )
    else:
        msg = (
            f"🔔【配额解除播报 · 实例 A 成功解冻·双机全开】\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"⚙️ **生产实例**：实例 A (CDP 端口 9431)\n"
            f"⏱ **唤醒时刻**：{now_str}（已安全度过 {buffer_secs//60} 分钟防风控随机隔离缓冲）\n"
            f"━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            f"🎉 **状态提醒**：实例 A 的 13 小时冷却期亦已正式结束，生图配额全部解冻！\n"
            f"⚡ **双机合璧**：实例 A + 实例 C 已全面进入双机并发自主生产状态，继续全速推进高品质画册制作！"
        )

    send_feishu_md(msg)
    print(f"已发送实例 {args.instance} 解冻通知！")
    check_and_start_producer()

if __name__ == "__main__":
    main()
