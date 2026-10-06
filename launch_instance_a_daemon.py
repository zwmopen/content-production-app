# -*- coding: utf-8 -*-
import os
import subprocess
import sys
import time
from pathlib import Path

script_dir = Path(__file__).resolve().parent
src = script_dir / "src"
electron_exe = src / "node_modules" / "electron" / "dist" / "electron.exe"
main_js = src / "desktop" / "main.js"

ai_code_root = script_dir.parents[2]
runtime_base = ai_code_root / "运行数据" / "江湖有旅人" / "内容生产App"
userdata = runtime_base / "instance-A" / "electron-userdata"
lock_file = userdata / "SingletonLock"

if lock_file.exists():
    try:
        lock_file.unlink()
        print(f"Removed SingletonLock: {lock_file}")
    except Exception as e:
        print(f"Failed to remove lock: {e}")

env = os.environ.copy()
env.update({
    "CONTENT_INSTANCE_ID": "A",
    "CONTENT_INSTANCE_LABEL": "实例 A · account-1",
    "PORT": "4331",
    "TB_REMOTE_DEBUGGING_PORT": "9431",
    "CONTENT_HTTP_PROXY": "http://127.0.0.1:17897",
    "TEAMBUILDING_DASHBOARD_RUNTIME": str(runtime_base / "instance-A"),
    "TEAMBUILDING_SHARED_MATERIAL_ROOT": str(runtime_base / "shared-material"),
    "TB_USER_DATA_ROOT": str(userdata),
    "CONTENT_ACCOUNT_IDS": "account-1",
    "CONTENT_ONLY_MODE": "1",
    "TB_MAIN_WINDOW_SANDBOX": "0",
    "TB_DESKTOP_HIDDEN": "0",
})

cmd = [str(electron_exe), "--remote-debugging-port=9431", "--no-sandbox", "--show", str(main_js)]
print(f"Starting Instance A daemon: {cmd}", flush=True)
subprocess.run(cmd, cwd=str(src), env=env)
