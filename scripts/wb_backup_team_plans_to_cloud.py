# -*- coding: utf-8 -*-
"""团建方案库备份+推送：本地 → rclone(gdrive) → aliyunpan(可选)

按 2026-09-21 用户指令：
- 凌晨 12 点触发
- 先 rclone copy 到 gdrive 远程（不计数阻塞）
- 统计 PDF+PPTX 数量，若 < 500 → 走 aliyunpan.exe 推阿里云盘
- 全部执行结果写一份报告到 workspace memory

前置条件（必须全部满足，否则脚本早退）：
  1. 源目录存在且至少包含 1 个 PDF/PPTX
  2. rclone remote `gdrive:` 可用（token 未过期）
  3. aliyunpan.exe 已登录（activeUID 非空）

路径常量：
  - 源：SRC_DIR（默认 D:\AICode\项目推进\projects\江湖有旅人\主项目\00-团建方案库）
  - rclone：RCLONE = r"D:\Program Files\Rclone\rclone.exe"
  - aliyunpan：ALIYUNPAN = r"D:\Program Files\aliyunpan\aliyunpan.exe"
  - 谷歌云目的地：gdrive:江湖有旅人/团建方案库
  - 阿里云盘目的地：手动用 aliyunpan upload subcommand
"""
import os
import sys
import json
import shutil
import subprocess
import datetime
from pathlib import Path

# ---- 路径常量 ----
RCLONE = r"D:\Program Files\Rclone\rclone.exe"
ALIYUNPAN = r"D:\Program Files\aliyunpan\aliyunpan.exe"
SRC_DIR = r"D:\AICode\项目推进\projects\江湖有旅人\主项目\00-团建方案库"
GDRIVE_REMOTE = "gdrive:江湖有旅人/团建方案库"
MEMORY_DIR = r"C:\Users\z\WorkBuddy\2026-09-20-14-53-26\.workbuddy\memory"

# ---- 阈值 ----
ALIYUN_THRESHOLD = 500  # 数量 < 这个值才推阿里云盘

def now_ts():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def log(msg, also_print=True):
    line = f"[{now_ts()}] {msg}"
    if also_print:
        print(line, flush=True)
    return line

def run(cmd, timeout=600):
    """run a command, return (returncode, stdout, stderr)"""
    log(f"$ {' '.join(cmd) if isinstance(cmd, list) else cmd}")
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired as e:
        return -1, e.stdout or "", f"TIMEOUT after {timeout}s"

def check_tools():
    """前置检查"""
    log("=== 阶段 1/4: 前置检查 ===")
    if not Path(RCLONE).exists():
        raise SystemExit(f"rclone 不存在: {RCLONE}")
    if not Path(ALIYUNPAN).exists():
        raise SystemExit(f"aliyunpan 不存在: {ALIYUNPAN}")
    if not Path(SRC_DIR).exists():
        raise SystemExit(f"源目录不存在: {SRC_DIR}（请先从企微微盘下载方案文件到该目录）")
    log(f"工具检查通过: rclone ✓ aliyunpan ✓ 源目录 ✓")

def count_source():
    """统计源目录的 PDF/PPTX 数量"""
    log("=== 阶段 2/4: 统计源文件 ===")
    pdfs = list(Path(SRC_DIR).rglob("*.pdf"))
    pptxs = list(Path(SRC_DIR).rglob("*.pptx"))
    total = len(pdfs) + len(pptxs)
    size_pdf = sum(p.stat().st_size for p in pdfs)
    size_pptx = sum(p.stat().st_size for p in pptxs)
    total_mb = (size_pdf + size_pptx) / 1024 / 1024
    log(f"PDF: {len(pdfs)} | PPTX: {len(pptxs)} | 合计: {total} 个 / {total_mb:.1f} MB")
    return total, total_mb, len(pdfs), len(pptxs)

def push_to_gdrive():
    """rclone copy 到 gdrive"""
    log(f"=== 阶段 3/4: rclone copy → {GDRIVE_REMOTE} ===")
    rc, out, err = run([RCLONE, "copy", SRC_DIR, GDRIVE_REMOTE,
                        "--progress", "--stats", "30s",
                        "-c", "--transfers", "4"])
    if rc != 0:
        log(f"❌ rclone copy 失败 rc={rc}")
        log(f"stderr: {err[-500:]}")
        return False, out, err
    log(f"✓ rclone copy 完成")
    return True, out, err

def check_aliyunpan_login():
    """检查 aliyunpan 是否登录"""
    log("检查 aliyunpan 登录态...")
    rc, out, err = run([ALIYUNPAN, "whoami"], timeout=30)
    if rc != 0 or "未登录" in out or "uid" not in out.lower():
        log(f"❌ aliyunpan 未登录: {out[:200]}")
        return False
    log(f"✓ aliyunpan 已登录: {out.strip()[:200]}")
    return True

def push_to_aliyunpan(total):
    """aliyunpan 上传到 /江湖有旅人/团建方案库"""
    log(f"=== 阶段 4/4: aliyunpan upload → /江湖有旅人/团建方案库 ===")
    if total >= ALIYUN_THRESHOLD:
        log(f"⚠️ 数量 {total} ≥ {ALIYUN_THRESHOLD}，按用户规则**不**推阿里云盘")
        return False, "skipped: too many files"

    if not check_aliyunpan_login():
        return False, "aliyunpan not logged in"

    # 先确保远端目录存在
    rc, out, err = run([ALIYUNPAN, "mkdir", "-p", "/江湖有旅人/团建方案库"], timeout=60)
    log(f"mkdir: rc={rc}")

    # 上传（递归 + 保留目录结构）
    rc, out, err = run([ALIYUNPAN, "upload",
                        SRC_DIR + "/", "/江湖有旅人/团建方案库/",
                        "--parallel", "4"], timeout=3600)
    if rc != 0:
        log(f"❌ aliyunpan upload 失败 rc={rc}")
        log(f"stderr: {err[-500:]}")
        return False, err
    log(f"✓ aliyunpan upload 完成")
    return True, out

def write_report(total, total_mb, n_pdf, n_pptx, gdrive_ok, aliyun_ok, aliyun_msg=""):
    """写一份执行报告到 workspace memory"""
    log("=== 写执行报告 ===")
    Path(MEMORY_DIR).mkdir(parents=True, exist_ok=True)
    today = datetime.date.today().strftime("%Y-%m-%d")
    report_path = Path(MEMORY_DIR) / f"{today}.md"
    timestamp = now_ts()
    section = f"""
## 团建方案库备份推送 ({timestamp}) - WorkBuddy
- 触发源：自动化任务（一次性，深夜 12 点）/ 或手动
- 源目录：`{SRC_DIR}`
- PDF: {n_pdf} | PPTX: {n_pptx} | 合计: {total} 个 / {total_mb:.1f} MB
- 谷歌云 (gdrive:江湖有旅人/团建方案库): {'✓ 成功' if gdrive_ok else '❌ 失败'}
- 阿里云盘 (/江湖有旅人/团建方案库): {'✓ 成功' if aliyun_ok else f'⚠️ {aliyun_msg}'}
- 阈值判断：{'< 500 → 推阿里云盘' if total < ALIYUN_THRESHOLD else f'≥ {ALIYUN_THRESHOLD} → 不推阿里云盘'}
"""
    with open(report_path, "a", encoding="utf-8") as f:
        f.write(section)
    log(f"✓ 报告已写入: {report_path}")
    return report_path

def main():
    log(">>> 团建方案库备份+推送脚本启动 <<<")
    try:
        check_tools()
    except SystemExit as e:
        log(f"早退: {e}")
        return 1

    total, total_mb, n_pdf, n_pptx = count_source()
    gdrive_ok, _, _ = push_to_gdrive()
    aliyun_ok, aliyun_msg = push_to_aliyunpan(total)
    write_report(total, total_mb, n_pdf, n_pptx, gdrive_ok, aliyun_ok, str(aliyun_msg))
    log(">>> 全部完成 <<<")
    return 0 if gdrive_ok else 1

if __name__ == "__main__":
    sys.exit(main())