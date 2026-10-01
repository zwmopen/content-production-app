"""全量新进程监控：抓所有相关新进程及其完整父链（专抓神秘拉起者）"""
import psutil, time, os, datetime, io

OUT = r"D:\AICode\运行数据\spawn_watch_all.log"
WATCH = ("python.exe", "pythonw.exe", "node.exe", "electron.exe", "powershell.exe",
         "pwsh.exe", "cmd.exe", "wscript.exe", "cscript.exe", "bash.exe", "conhost.exe")
IGNORE_CL = ("spawn_watch", "psutil", "codebuddy_payload")  # 忽略自身与工具调用

def log(msg):
    line = "[%s] %s" % (datetime.datetime.now().strftime("%m-%d %H:%M:%S"), msg)
    try:
        with io.open(OUT, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass

def chain(pid, depth=5):
    rows = []
    cur = pid
    for _ in range(depth):
        if cur in (0, None):
            break
        try:
            p = psutil.Process(cur)
            cl = " ".join(p.cmdline())[:300]
            ct = datetime.datetime.fromtimestamp(p.create_time()).strftime("%m-%d %H:%M:%S")
            rows.append("    PID=%d PPID=%d [%s] %s :: %s" % (p.pid, p.ppid(), ct, p.name(), cl))
            cur = p.ppid()
        except Exception:
            rows.append("    PID=%d <gone>" % cur)
            break
    return rows

log("=== FULL spawn watcher started (poll 2s) ===")
seen = set()
for p in psutil.process_iter(["pid"]):
    seen.add(p.info["pid"])

while True:
    try:
        current = {}
        for p in psutil.process_iter(["pid", "name", "cmdline"]):
            current[p.info["pid"]] = p.info
        for np in set(current) - seen:
            info = current.get(np) or {}
            name = (info.get("name") or "").lower()
            cl = " ".join(info.get("cmdline") or [])
            if name not in WATCH:
                continue
            if any(m in cl for m in IGNORE_CL):
                continue
            log("*** NEW %s PID=%d" % (name, np))
            for r in chain(np):
                log(r)
        seen = set(current)
    except Exception as e:
        try:
            log("watcher-error %s" % e)
        except Exception:
            pass
    time.sleep(2)
