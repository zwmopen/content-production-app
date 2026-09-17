import sys
import os
import datetime
import subprocess
import argparse

sys.stdout.reconfigure(encoding='utf-8')

LARK_RUN_JS = r"D:\AICode\工具开发\toolchains\npm-global\node_modules\@larksuite\cli\scripts\run.js"
FEISHU_GROUP_CHAT_ID = "oc_bb67c9036e6b14da9bb7be9336dfa9c0"  # CDP流水线作品生产通知群
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
            ps_launch = f'Start-Process "{sys.executable}" -ArgumentList "\'{PRODUCER_SCRIPT}\'"'
            subprocess.run(["powershell", "-NoProfile", "-Command", ps_launch], check=True)
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

    # 动态统计当前本地成品总数
    prod_root = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\成品库（GPT+本地脚本制作）"
    cur_count = 96
    if os.path.exists(prod_root):
        cur_count = len([
            f for f in os.listdir(prod_root)
            if os.path.isdir(os.path.join(prod_root, f))
            and not f.startswith(('_', '不合格', '已发', '归档', '抖音'))
            and f != '发布空间'
        ])

    if args.instance == "C":
        msg = (
            f"🚀 **【秋季素材开工 · 网页 CDP】**\n\n"
            f"• **生产模式**：网页 CDP（账号 3 · z x Plus）\n"
            f"• **当前状态**：冷却期结束，系统已自动接续生产\n"
            f"• **开工时刻**：{now_str}（已度过 {buffer_secs//60} 分钟防风控安全缓冲）\n\n"
            f"📊 **【秋季素材包】全盘进度**：\n"
            f"• 本地成品总数：已累计 **{cur_count} 套**\n"
            f"• 秋季素材进度：已完成 **{cur_count} / 781 套**\n"
            f"• 下一步动作：秋季素材全部制作完成后归档，紧接着开启冬季素材库。"
        )
    else:
        msg = (
            f"🚀 **【秋季素材开工 · 网页 CDP】**\n\n"
            f"• **生产模式**：网页 CDP（账号 1 · zwmrpg）\n"
            f"• **当前状态**：冷却期结束，系统已自动接续生产\n"
            f"• **开工时刻**：{now_str}（已度过 {buffer_secs//60} 分钟防风控安全缓冲）\n\n"
            f"📊 **【秋季素材包】全盘进度**：\n"
            f"• 本地成品总数：已累计 **{cur_count} 套**\n"
            f"• 秋季素材进度：已完成 **{cur_count} / 781 套**\n"
            f"• 下一步动作：秋季素材全部制作完成后归档，紧接着开启冬季素材库。"
        )

    send_feishu_md(msg)
    print(f"已发送实例 {args.instance} 解冻通知！")
    check_and_start_producer()

if __name__ == "__main__":
    main()
