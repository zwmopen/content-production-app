# -*- coding: utf-8 -*-
"""脱离沙箱 Job 对象拉起内容生产实例守护进程（A/B 通用）。
用法: python spawn_instance_daemon.py A|B
"""
import subprocess
import sys
import os

INSTANCE = (sys.argv[1] if len(sys.argv) > 1 else "A").upper()
assert INSTANCE in ("A", "B"), "instance must be A or B"

NODE = r"C:\Users\z\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
DAEMON = rf"D:\AICode\工具开发\projects\content-production-app\scripts\run-instance-{INSTANCE.lower()}-daemon.js"
CWD = r"D:\AICode\工具开发\projects\content-production-app\src"
LOG = rf"D:\AICode\运行数据\江湖有旅人\内容生产App\instance-{INSTANCE}\daemon.log"

DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_BREAKAWAY_FROM_JOB = 0x01000000

logf = open(LOG, "ab")
flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB
try:
    p = subprocess.Popen(
        [NODE, DAEMON],
        cwd=CWD,
        stdout=logf,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        creationflags=flags,
        close_fds=True,
    )
    print(f"OK breakaway pid={p.pid}")
except OSError as e:
    # 作业对象不允许 breakaway 时退回普通 detached
    p = subprocess.Popen(
        [NODE, DAEMON],
        cwd=CWD,
        stdout=logf,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
        close_fds=True,
    )
    print(f"FALLBACK no-breakaway pid={p.pid} err={e}")
