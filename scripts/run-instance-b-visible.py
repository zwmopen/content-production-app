import os
import sys
import time
import ctypes
from ctypes import wintypes
import psutil

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

hwinsta = user32.OpenWindowStationW('winsta0', False, 0x037F)
if hwinsta:
    user32.SetProcessWindowStation(hwinsta)
hdesk = user32.OpenDesktopW('default', 0, False, 0x01FF)
if hdesk:
    user32.SetThreadDesktop(hdesk)

class STARTUPINFO(ctypes.Structure):
    _fields_ = [
        ('cb', wintypes.DWORD),
        ('lpReserved', wintypes.LPWSTR),
        ('lpDesktop', wintypes.LPWSTR),
        ('lpTitle', wintypes.LPWSTR),
        ('dwX', wintypes.DWORD),
        ('dwY', wintypes.DWORD),
        ('dwXSize', wintypes.DWORD),
        ('dwYSize', wintypes.DWORD),
        ('dwXCountChars', wintypes.DWORD),
        ('dwYCountChars', wintypes.DWORD),
        ('dwFillAttribute', wintypes.DWORD),
        ('dwFlags', wintypes.DWORD),
        ('wShowWindow', wintypes.WORD),
        ('cbReserved2', wintypes.WORD),
        ('lpReserved2', ctypes.POINTER(ctypes.c_byte)),
        ('hStdInput', wintypes.HANDLE),
        ('hStdOutput', wintypes.HANDLE),
        ('hStdError', wintypes.HANDLE),
    ]

class PROCESS_INFORMATION(ctypes.Structure):
    _fields_ = [
        ('hProcess', wintypes.HANDLE),
        ('hThread', wintypes.HANDLE),
        ('dwProcessId', wintypes.DWORD),
        ('dwThreadId', wintypes.DWORD),
    ]

def clean_ports_and_locks():
    # Kill any process listening on 4332 or 9432
    for conn in psutil.net_connections(kind='inet'):
        if conn.laddr.port in (4332, 9432) and conn.status == 'LISTEN':
            if conn.pid:
                try:
                    p = psutil.Process(conn.pid)
                    print(f'Killing stale process {conn.pid} on port {conn.laddr.port}')
                    p.kill()
                except Exception:
                    pass

    userdata = r'D:\AICode\运行数据\江湖有旅人\内容生产App\instance-B\electron-userdata'
    lock = os.path.join(userdata, 'SingletonLock')
    if os.path.exists(lock):
        try:
            os.remove(lock)
            print('Removed stale SingletonLock')
        except Exception as e:
            print(f'Failed to remove lock: {e}')

clean_ports_and_locks()

os.environ['CONTENT_INSTANCE_ID'] = 'B'
os.environ['CONTENT_INSTANCE_LABEL'] = '实例 B · account-2'
os.environ['PORT'] = '4332'
os.environ['TB_REMOTE_DEBUGGING_PORT'] = '9432'
os.environ['CONTENT_HTTP_PROXY'] = 'http://127.0.0.1:7897'
os.environ['TEAMBUILDING_DASHBOARD_RUNTIME'] = r'D:\AICode\运行数据\江湖有旅人\内容生产App\instance-B'
os.environ['TEAMBUILDING_SHARED_MATERIAL_ROOT'] = r'D:\AICode\运行数据\江湖有旅人\内容生产App\shared-material'
os.environ['TB_USER_DATA_ROOT'] = r'D:\AICode\运行数据\江湖有旅人\内容生产App\instance-B\electron-userdata'
os.environ['CONTENT_ACCOUNT_IDS'] = 'account-2'
os.environ['CONTENT_ONLY_MODE'] = '1'
os.environ['TB_MAIN_WINDOW_SANDBOX'] = '0'
os.environ['TB_DESKTOP_HIDDEN'] = '0'

electron_exe = r'D:\AICode\工具开发\projects\content-production-app\src\node_modules\electron\dist\electron.exe'
main_js = r'D:\AICode\工具开发\projects\content-production-app\src\desktop\main.js'
cwd = r'D:\AICode\工具开发\projects\content-production-app\src'

cmdline = f'"{electron_exe}" --remote-debugging-port=9432 --no-sandbox --show "{main_js}"'

si = STARTUPINFO()
si.cb = ctypes.sizeof(STARTUPINFO)
si.lpDesktop = 'WinSta0\\default'
si.dwFlags = 0x00000001
si.wShowWindow = 1

pi = PROCESS_INFORMATION()

# Pass None for std handles so Electron allocates standard console/GUI
res = kernel32.CreateProcessW(
    None,
    cmdline,
    None,
    None,
    False,
    0,
    None,
    cwd,
    ctypes.byref(si),
    ctypes.byref(pi)
)

if not res:
    err = kernel32.GetLastError()
    print(f'CreateProcess failed with error: {err}')
    sys.exit(1)

print(f'[Instance B Daemon] Successfully started Electron with PID {pi.dwProcessId} on WinSta0\\default')

# Keep process alive and monitor child
try:
    while True:
        time.sleep(2)
        exit_code = wintypes.DWORD()
        if not kernel32.GetExitCodeProcess(pi.hProcess, ctypes.byref(exit_code)):
            break
        if exit_code.value != 0x103:
            print(f'[Instance B Daemon] Child exited with code {hex(exit_code.value)}')
            break
finally:
    kernel32.CloseHandle(pi.hProcess)
    kernel32.CloseHandle(pi.hThread)
