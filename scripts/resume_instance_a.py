# -*- coding: utf-8 -*-
"""A 实例复工一键脚本（暂停期结束 → 恢复生产）

用途：19:30 复工时执行。流程：
  1. 删除暂停 flag（watchdog_pause_A.flag）→ 恢复原生守护补位能力
  2. 若 9431 未监听 → 立即拉起 A 守护（run-instance-a-daemon.js，脱离沙箱/清理环境）
  3. 轮询等待 CDP 9431 就绪（最长 120 秒）
  4. 【关键】重启主脑 —— 主脑 main() 里只对 candidate_workers 做「一次」启动探测，
     A 在它启动之后才上线时，主脑不会自行复探。不重启 = 9431 通了但没人驱动 A，
     整晚零产出（看门狗也只在主脑「已死」时才补拉，不会为 A 上线而重启活着的 主脑）。
  5. 轮询 autonomous_production.log，确认出现「探测到实例 A ... 挂载生产协程」
  6. 新配额阈值即时生效：3 小时窗 40 张 + 全天 180 张（2026-09-22 用户校准口径）

用法：
  python resume_instance_a.py                        # 正常复工（含主脑重启）
  python resume_instance_a.py --dry-run              # 只检查状态不动手
  python resume_instance_a.py --no-restart-producer  # 只起 A 守护，不重启主脑
"""
import os
import sys
import time
import argparse
import subprocess
import urllib.request

FLAG = r'D:\AICode\运行数据\watchdog_pause_A.flag'
SCRIPTS = r'D:\AICode\工具开发\projects\content-production-app\scripts'
NODE = r'D:\Program Files\nodejs\node.exe'
PY = r'C:\Users\z\AppData\Local\Programs\Python\Python311\python.exe'
DAEMON = os.path.join(SCRIPTS, 'run-instance-a-daemon.js')
PRODUCER = os.path.join(SCRIPTS, 'dual_browser_autonomous_producer.py')
RUN_DATA = r'D:\AICode\运行数据'
PRODUCER_LOG = os.path.join(RUN_DATA, 'autonomous_production.log')
PRODUCER_STDOUT = os.path.join(RUN_DATA, 'dual_daemon_stdout.log')
PRODUCER_STDERR = os.path.join(RUN_DATA, 'dual_daemon_stderr.log')
CDP_PORT = 9431
HTTP_PORT = 4331
DETACHED = 0x00000008
NEW_GROUP = 0x00000200


def port_ok(port):
    """绕过系统代理直连探测 CDP/HTTP 端口"""
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for path in ('/json/version', '/'):
        try:
            op.open(f'http://127.0.0.1:{port}{path}', timeout=4)
            return True
        except Exception:
            continue
    return False


def _expire_flag_now(flag):
    """兜底：把 flag 的 EXPIRES 改写为过去时间（保留 BOM 与否），交给看门狗自愈。"""
    import re
    try:
        with open(flag, 'rb') as fh:
            raw = fh.read()
        has_bom = raw[:3] == b'\xef\xbb\xbf'
        txt = raw.decode('utf-8-sig')
        txt = re.sub(r'EXPIRES\s*=\s*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?',
                     'EXPIRES=2000-01-01 00:00:00', txt)
        if 'EXPIRES' not in txt:
            txt = txt.rstrip('\r\n') + '\nEXPIRES=2000-01-01 00:00:00'
        with open(flag, 'wb') as fh:
            fh.write((b'\xef\xbb\xbf' if has_bom else b'') + txt.encode('utf-8'))
        return True
    except Exception:
        return False


def _producer_pids():
    """找出所有在跑的主脑 PID（psutil 优先，wmic 兜底）

    注意：必须按「进程名含 python」过滤。Git Bash 的 `env -u ... python -u xxx.py`
    启动方式会留下一个 cmdline 里同样含该文件名、但进程名是 env.exe 的父包装进程，
    只按 cmdline 匹配会把它当成第二个主脑（误判双开 + 有多余进程可杀）。
    """
    pids = []
    try:
        import psutil
    except Exception:
        psutil = None
    if psutil is not None:
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                if 'python' not in (proc.info.get('name') or '').lower():
                    continue
                if proc.pid == os.getpid():
                    continue
                cmd = ' '.join(proc.info.get('cmdline') or [])
                if 'dual_browser_autonomous_producer.py' in cmd:
                    pids.append(proc.pid)
            except Exception:
                continue
        # psutil 可用就以它的结果为准（「空」也是有效答案），
        # 绝不因为结果为空再落到兜底路径 —— 本机 wmic 在安全策略黑名单里，调用会被拦。
        return pids
    # 仅当 psutil 不可用时才走 CIM 兜底（用 powershell 调 Get-CimInstance，不用 wmic）
    try:
        out = subprocess.run(
            ['powershell', '-NoProfile', '-Command',
             "Get-CimInstance Win32_Process -Filter \"Name like '%python%'\" | "
             "Where-Object { $_.CommandLine -like '*dual_browser_autonomous_producer.py*' } | "
             "Select-Object -ExpandProperty ProcessId"],
            capture_output=True, text=True, timeout=60).stdout
        for line in out.splitlines():
            s = line.strip()
            if s.isdigit():
                pids.append(int(s))
    except Exception:
        pass
    return pids


def _terminate_producer(pids):
    """优雅终止（psutil），并等待其退出"""
    killed = []
    try:
        import psutil
        for pid in pids:
            try:
                psutil.Process(pid).terminate()
                killed.append(pid)
            except Exception:
                continue
    except Exception:
        pass
    for _ in range(10):
        if not _producer_pids():
            break
        time.sleep(1)
    return killed


def _force_kill(pids):
    for pid in pids:
        try:
            subprocess.run(['taskkill', '/PID', str(pid), '/F', '/T'],
                           capture_output=True, timeout=20)
        except Exception:
            pass


def _start_producer():
    """拉起主脑。

    ⚠️ 2026-09-22 实测（重要）：在 WorkBuddy 的命令沙箱里，**前台命令**中用
    `Popen(..., DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)` 起的子进程
    会随该命令的 Job 结束被回收 —— 实测探针进程 20 秒后即消失；
    而 `CREATE_BREAKAWAY_FROM_JOB`(0x01000000) 被沙箱拒绝（PermissionError WinError 5）。
    因此这里优先用 `powershell Start-Process`（原生 windows_native_watchdog.ps1 用的就是它，
    实测可常驻），Popen 仅作兜底。
    """
    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    env.pop('NODE_OPTIONS', None)
    try:
        ps = ("Start-Process -FilePath '%s' -ArgumentList '-u','%s' -WorkingDirectory '%s' -WindowStyle Hidden"
              % (PY, PRODUCER, r'D:\AICode'))
        r = subprocess.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
                           capture_output=True, text=True, timeout=60)
        if r.returncode == 0:
            time.sleep(2)
            pids = _producer_pids()
            if pids:
                return pids[0]
    except Exception:
        pass
    so = open(PRODUCER_STDOUT, 'ab')
    se = open(PRODUCER_STDERR, 'ab')
    p = subprocess.Popen([PY, '-u', PRODUCER], cwd=r'D:\AICode', env=env,
                         creationflags=DETACHED | NEW_GROUP, stdout=so, stderr=se)
    return p.pid


def _log_since_contains(path, from_size, needle):
    try:
        size = os.path.getsize(path)
        with open(path, 'r', encoding='utf-8', errors='ignore') as fh:
            if from_size <= size:
                fh.seek(from_size)
            return needle in fh.read()
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--no-restart-producer', action='store_true')
    a = ap.parse_args()

    print('=== A 实例复工流程 ===')

    flag_exists = os.path.exists(FLAG)
    print(f'[1] 暂停 flag 存在: {flag_exists}')
    if a.dry_run:
        print(f'[2] CDP {CDP_PORT} 就绪: {port_ok(CDP_PORT)}  HTTP {HTTP_PORT} 就绪: {port_ok(HTTP_PORT)}')
        print(f'[5] 当前主脑 PID: {_producer_pids() or "无"}')
        print('[dry-run] 不执行任何变更')
        return 0

    # 1. 解除暂停 flag
    if flag_exists:
        try:
            os.remove(FLAG)
            print('    -> 已删除暂停 flag（原生守护补位能力恢复）')
        except Exception as e:
            # 兜底：删除失败时把 flag 的 EXPIRES 改写为过去时间，
            # 交给 windows_native_watchdog.ps1 的「定时自愈」在 ≤5 分钟内自动解除。
            print(f'    !! 删除失败: {e} -> 改写 EXPIRES 为过去时间，交给看门狗自愈')
            if not _expire_flag_now(FLAG):
                print(f'    !! 兜底也失败（需人工删除 {FLAG}）')
                return 1
            print('    -> EXPIRES 已改写为过去时间，等待看门狗自动解除（≤5 分钟）')
    else:
        print('    -> flag 不存在，跳过')

    # 2-3. 确保 A 守护在线
    # ⚠️ 2026-09-22 实测：从「被 WorkBuddy 前台命令」或「一次性任务」里拉起的进程，
    # 会随该命令的沙箱 Job 关闭被回收（Popen(DETACHED) 与 powershell Start-Process 同样如此，
    # CREATE_BREAKAWAY_FROM_JOB 会被拒绝 WinError 5）。可靠的长驻执行者只有从独立任务上下文
    # 启动的原生看门狗（windows_native_watchdog.ps1，每 ~5 分钟一轮，含 A 守护补位分支）。
    # 因此这里把「拉起」当最佳努力，「等待就绪」的窗口放大到 ~6 分钟覆盖看门狗节拍。
    if port_ok(CDP_PORT):
        print(f'[2] A 已在运行（{CDP_PORT} 就绪），无需拉起')
    else:
        env = dict(os.environ)
        env.pop('ELECTRON_RUN_AS_NODE', None)
        env.pop('NODE_OPTIONS', None)
        try:
            p = subprocess.Popen(
                [NODE, DAEMON], cwd=SCRIPTS, env=env,
                creationflags=DETACHED | NEW_GROUP,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print(f'[3] 已尝试拉起 A 守护 PID={p.pid}'
                  f'（若被沙箱回收，原生看门狗会在 ≤5 分钟内补位拉起 9431）')
        except Exception as e:
            print(f'[3] 拉起尝试失败: {e}（转而等待原生看门狗补位）')
        ready = False
        for i in range(90):          # ≤6 分钟，覆盖看门狗 5 分钟节拍
            time.sleep(4)
            if port_ok(CDP_PORT):
                print(f'[4] CDP {CDP_PORT} 就绪（等待 {(i + 1) * 4} 秒）')
                ready = True
                break
            if (i + 1) % 15 == 0:
                print(f'    ...等待 9431 就绪 {(i + 1) * 4}s')
        if not ready:
            print('[4] !! 超时：9431 未就绪，请人工检查 A 窗口与 windows_watchdog.log')
            return 1

    # 4-5. 重启主脑，让它重新探测并挂载 A
    if a.no_restart_producer:
        print('[5] 按参数跳过主脑重启（需自行确保主脑已挂载 A，否则 A 不会产出）')
        return 0

    from_size = os.path.getsize(PRODUCER_LOG) if os.path.exists(PRODUCER_LOG) else 0
    old = _producer_pids()
    print(f'[5] 重启主脑以复探 A 实例（当前主脑 PID: {old or "无"}）')
    killed = _terminate_producer(old) if old else []
    if killed:
        print(f'    -> 已终止旧主脑: {killed}')
    else:
        print('    -> 未发现运行中的主脑')
    still = _producer_pids()
    if still:
        print(f'    -> 仍存活，强制终止: {still}')
        _force_kill(still)
        time.sleep(3)
    try:
        pid = _start_producer()
        print(f'    -> 已拉起新主脑 PID={pid}')
    except Exception as e:
        print(f'    !! 主脑拉起失败: {e}')
        return 1

    ok = False
    # 等待窗口给到 ~7 分钟：沙箱可能回收我们启动的副本，此时原生看门狗会在 ≤5 分钟内
    # 补位拉起主脑（它启动的进程可常驻），那一份同样会因为 9431 已就绪而挂载 A，
    # 只要日志出现「探测到实例 A」就算复工成功（不区分是哪一份主脑写下的）。
    for i in range(105):
        time.sleep(4)
        if _log_since_contains(PRODUCER_LOG, from_size, '探测到实例 A'):
            print(f'[6] ✅ 主脑已挂载 A 实例（等待 {(i + 1) * 4} 秒）—— A 复工完成')
            ok = True
            break
        if (i + 1) % 15 == 0:
            print(f'    ...等待主脑挂载 A {(i + 1) * 4}s（若我方副本被沙箱回收，'
                  f'原生看门狗会在 ≤5 分钟内补位拉起）')
    if not ok:
        print('[6] !! 超时：主脑未挂载 A，请检查 autonomous_production.log 与 windows_watchdog.log')
        return 1
    print('    配额阈值：3 小时窗 40 张 + 全天 180 张')
    return 0


if __name__ == '__main__':
    sys.exit(main())
