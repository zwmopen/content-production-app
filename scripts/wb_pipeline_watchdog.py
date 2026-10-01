# -*- coding: utf-8 -*-
"""产线看门狗（10 分钟循环）· WorkBuddy
每 600 秒执行：
  1. 判活：主脑进程是否存在（排除自身）；日志最后行距今是否 <25 分钟
  2. 端口：A/B CDP 9431/9432 是否 200
  3. 自愈：主脑进程缺失 → 重启；日志静默 >25 分钟且状态为 PRODUCING → 判卡死，杀掉重启
           B 实例 CDP 持续 502 → 拉起 run-instance-b-visible.py 守护（作为本看门狗子进程）
  4. 留痕：每轮一行写 D:\\AICode\\运行数据\\pipeline_watchdog.log
绝不触碰成品库/素材库/台账文件；不动 git。

【2026-09-22 修】补上人工暂停开关（此前本脚本没有任何 flag 逻辑）：
  - 它是「主脑的第 4 条拉起路径」，每 10 分钟一轮、且原先不看 flag，
    因此 watchdog_pause_producer.flag 对它完全无效（2026-09-22 16:27:46 实测：
    它在未授权的时刻拉起主脑 PID 19488，由 2 秒级进程监控抓到完整父链才确认）。
  - 现在与 windows_native_watchdog.ps1 的 Test-PauseFlag 同语义：
      存在 <运行数据>\\watchdog_pause_<组件>.flag 且未到期 → 跳过该组件的补位/重启；
      flag 内 `EXPIRES=yyyy-MM-dd HH:mm:ss` 已到期 → 自动删除该 flag 并放行（定时自愈，
      使「到点复工」不依赖 automation 单点）。
"""
import os, io, json, re, time, subprocess, sys, urllib.request, datetime

PY = r'C:\Users\z\AppData\Local\Programs\Python\Python311\python.exe'
SCRIPTS = r'D:\AICode\工具开发\projects\content-production-app\scripts'
PRODUCER = os.path.join(SCRIPTS, 'dual_browser_autonomous_producer.py')
B_GUARD = os.path.join(SCRIPTS, 'run-instance-b-visible.py')
LOG = r'D:\AICode\运行数据\autonomous_production.log'
WLOG = r'D:\AICode\运行数据\pipeline_watchdog.log'
STATUS = r'D:\AICode\运行数据\autonomous_production_daemon_status.json'
FLAG_DIR = r'D:\AICode\运行数据'
INTERVAL = 600
STALL_SEC = 25 * 60

_EXPIRES_RE = re.compile(r'EXPIRES\s*=\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)')


def wlog(msg):
    line = '[%s] %s' % (time.strftime('%m-%d %H:%M:%S'), msg)
    try:
        with open(WLOG, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass
    print(line, flush=True)


def pause_flag_active(name):
    """人工暂停开关（与 windows_native_watchdog.ps1 的 Test-PauseFlag 同语义）。
    返回 True = 该组件处于人工暂停、不得补位/重启。
    读到期时间用二进制安全方式（flag 可能带 UTF-8 BOM）。"""
    flag = os.path.join(FLAG_DIR, 'watchdog_pause_%s.flag' % name)
    if not os.path.exists(flag):
        return False
    exp = None
    try:
        with open(flag, 'rb') as f:
            txt = f.read().decode('utf-8-sig', errors='replace')
        m = _EXPIRES_RE.search(txt)
        if m:
            raw = m.group(1).replace('T', ' ')
            for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M'):
                try:
                    exp = datetime.datetime.strptime(raw, fmt)
                    break
                except Exception:
                    continue
    except Exception:
        exp = None
    if exp is not None and datetime.datetime.now() >= exp:
        try:
            os.remove(flag)
            wlog('⏰ %s 暂停已到期 (%s)，自动解除 flag，恢复补位守护' % (name, exp.strftime('%Y-%m-%d %H:%M:%S')))
        except Exception as e:
            wlog('!! %s 暂停 flag 到期但删除失败: %r（需人工删除 %s）' % (name, e, flag))
            return True
        return False
    return True


def producer_pid():
    import psutil
    me = os.getpid()
    for p in psutil.process_iter(['pid', 'name', 'cmdline']):
        try:
            if (p.info.get('name') or '').lower() in ('python.exe', 'pythonw.exe') and p.info['pid'] != me:
                c = ' '.join(p.info.get('cmdline') or [])
                if 'dual_browser_autonomous_producer.py' in c:
                    return p.info['pid']
        except Exception:
            pass
    return None


def log_age_sec():
    try:
        with open(LOG, 'rb') as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 4000))
            tail = f.read().decode('utf-8', errors='replace').strip().splitlines()
        last = [l for l in tail if l.startswith('[')]
        if not last:
            return 10**9
        m = last[-1][:20]  # [2026-09-21 20:24:02]
        t = time.mktime(time.strptime(m.strip('[]'), '%Y-%m-%d %H:%M:%S'))
        return time.time() - t
    except Exception:
        return 10**9


def port_ok(port):
    try:
        urllib.request.urlopen('http://127.0.0.1:%d/json/version' % port, timeout=4)
        return True
    except Exception:
        return False


def start_producer():
    subprocess.Popen([PY, '-u', PRODUCER], cwd=SCRIPTS,
                     env={**os.environ},
                     creationflags=0x00000008 | 0x00000200,  # DETACHED | NEW_GROUP
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wlog('  -> 已发出主脑重启指令')


def start_b_guard():
    subprocess.Popen([PY, '-u', B_GUARD], cwd=SCRIPTS,
                     creationflags=0x00000008 | 0x00000200,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wlog('  -> 已拉起 B 实例守护（30 秒后复核）')


def kill_producer(pid):
    import psutil
    try:
        p = psutil.Process(pid)
        for c in p.children(recursive=True):
            c.kill()
        p.kill()
        time.sleep(2)
        return True
    except Exception:
        return False


def cycle():
    pid = producer_pid()
    age = log_age_sec()
    a_ok, b_ok = port_ok(9431), port_ok(9432)
    state = ''
    try:
        s = json.load(open(STATUS, encoding='utf-8'))
        st = s.get('instances', {})
        state = 'A:%s/B:%s/q%s/c%s' % (st.get('A', {}).get('state'), st.get('B', {}).get('state'),
                                       s.get('queue_remaining'), s.get('completed_total'))
    except Exception:
        pass
    line = '主脑pid=%s 日志龄=%.0fs CDP A=%s B=%s %s' % (pid, age, '通' if a_ok else '断', '通' if b_ok else '断', state)
    acted = []

    # 主脑补位/重启（受 watchdog_pause_producer.flag 管制）
    if pause_flag_active('producer'):
        wlog(line + ' → 主脑处于人工暂停 (watchdog_pause_producer.flag)，跳过补位/重启')
    elif pid is None:
        wlog(line + ' → 主脑缺失，重启')
        start_producer()
        acted.append('重启主脑')
    elif age > STALL_SEC:
        # 【2026-09-22 修】本文档声称「静默 >25 分钟且状态为 PRODUCING 才判卡死」，
        # 但原代码只判了静默时长。当 A/B 都处于人工暂停/官方长休眠时主脑本就会静默，
        # 于是每 10 分钟被杀一次、白重启一轮（无意义抖动，还会打断进行中的任务）。
        # 现在按文档补齐：只有确实存在 PRODUCING 实例时才判卡死。
        states = []
        try:
            s = json.load(open(STATUS, encoding='utf-8'))
            states = [v.get('state') for v in (s.get('instances') or {}).values()]
        except Exception:
            pass
        if 'PRODUCING' in states:
            wlog(line + ' → 日志静默超25分钟且存在 PRODUCING 实例，判卡死，杀掉重启')
            if kill_producer(pid):
                time.sleep(3)
                start_producer()
            acted.append('卡死重启')
        else:
            wlog(line + ' → 日志静默超25分钟，但无 PRODUCING 实例（均暂停/休眠），跳过重启')

    # B 守护（受 watchdog_pause_B.flag 管制；A/C 守护不在本脚本职责内）
    if not b_ok:
        if pause_flag_active('B'):
            wlog(line + ' → 实例 B 处于人工暂停 (watchdog_pause_B.flag)，跳过拉起守护')
        else:
            wlog(line + ' → B 实例断，拉守护')
            start_b_guard()
            acted.append('拉B守护')

    if not acted:
        wlog(line + ' ✓')
    return acted


def main():
    wlog('=== 看门狗启动（每 %d 秒一轮，静默阈值 %d 秒） ===' % (INTERVAL, STALL_SEC))
    while True:
        try:
            cycle()
        except Exception as e:
            wlog('!! 轮次异常: %r' % (e,))
        time.sleep(INTERVAL)


if __name__ == '__main__':
    main()
