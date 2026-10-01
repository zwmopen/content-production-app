"""高频监控：抓 A 实例复活瞬间的 spawner 本体与完整父链"""
import psutil, time, os, datetime, io

OUT = r"D:\AICode\运行数据\spawn_watch_A.log"
MATCH = ("run-instance-a-daemon.js", "remote-debugging-port=9431", "instance-A")

def log(msg):
    line = "[%s] %s" % (datetime.datetime.now().strftime("%H:%M:%S"), msg)
    try:
        with io.open(OUT, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass
    return line

def chain(pid, depth=4):
    rows = []
    cur = pid
    for _ in range(depth):
        try:
            p = psutil.Process(cur)
            cl = " ".join(p.cmdline())[:260]
            ct = datetime.datetime.fromtimestamp(p.create_time()).strftime("%m-%d %H:%M:%S")
            rows.append("  PID=%d PPID=%d [%s] %s :: %s" % (p.pid, p.ppid(), ct, p.name(), cl))
            cur = p.ppid()
            if cur in (0, None):
                break
        except Exception:
            rows.append("  PID=%d <gone>" % cur)
            break
    return rows

log("=== spawn watcher started (poll 2s) ===")
seen = set()
for p in psutil.process_iter(["pid"]):
    seen.add(p.info["pid"])

hits = 0
while True:
    try:
        current = {}
        for p in psutil.process_iter(["pid", "name", "cmdline"]):
            current[p.info["pid"]] = p.info
        new_pids = set(current) - seen
        for np in new_pids:
            info = current.get(np) or {}
            cl = " ".join(info.get("cmdline") or [])
            if any(m in cl for m in MATCH):
                hits += 1
                log("*** HIT #%d: new A-related process PID=%d" % (hits, np))
                for r in chain(np):
                    log(r)
        seen = set(current)
    except Exception as e:
        try:
            log("watcher-error %s" % e)
        except Exception:
            pass
    time.sleep(2)
