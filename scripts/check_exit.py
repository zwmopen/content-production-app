import os, sys, ctypes, time
from ctypes import wintypes

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

hwinsta = user32.OpenWindowStationW('winsta0', False, 0x037F)
if hwinsta: user32.SetProcessWindowStation(hwinsta)
hdesk = user32.OpenDesktopW('default', 0, False, 0x01FF)
if hdesk: user32.SetThreadDesktop(hdesk)

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

class SECURITY_ATTRIBUTES(ctypes.Structure):
    _fields_ = [
        ('nLength', wintypes.DWORD),
        ('lpSecurityDescriptor', ctypes.c_void_p),
        ('bInheritHandle', wintypes.BOOL),
    ]

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

lock = os.path.join(os.environ['TB_USER_DATA_ROOT'], 'SingletonLock')
if os.path.exists(lock):
    try:
        os.remove(lock)
    except:
        pass

log_path = r'D:\AICode\工具开发\projects\content-production-app\scripts\launch_b_debug.log'
sa = SECURITY_ATTRIBUTES()
sa.nLength = ctypes.sizeof(SECURITY_ATTRIBUTES)
sa.bInheritHandle = True
sa.lpSecurityDescriptor = None

h_file = kernel32.CreateFileW(
    log_path,
    0x40000000 | 0x10000000, # GENERIC_WRITE | GENERIC_ALL
    1 | 2, # FILE_SHARE_READ | FILE_SHARE_WRITE
    ctypes.byref(sa),
    2, # CREATE_ALWAYS
    0x80, # FILE_ATTRIBUTE_NORMAL
    None
)

electron_exe = r'D:\AICode\工具开发\projects\content-production-app\src\node_modules\electron\dist\electron.exe'
main_js = r'D:\AICode\工具开发\projects\content-production-app\src\desktop\main.js'
cwd = r'D:\AICode\工具开发\projects\content-production-app\src'

cmdline = f'"{electron_exe}" --remote-debugging-port=9432 --no-sandbox --show "{main_js}"'

si = STARTUPINFO()
si.cb = ctypes.sizeof(STARTUPINFO)
si.lpDesktop = 'WinSta0\\default'
si.dwFlags = 0x00000001 | 0x00000100 # STARTF_USESHOWWINDOW | STARTF_USESTDHANDLES
si.wShowWindow = 1
si.hStdOutput = h_file
si.hStdError = h_file

pi = PROCESS_INFORMATION()

res = kernel32.CreateProcessW(None, cmdline, None, None, True, 0, None, cwd, ctypes.byref(si), ctypes.byref(pi))
print('CreateProcess:', res, 'PID:', pi.dwProcessId)

for i in range(10):
    time.sleep(1)
    exit_code = wintypes.DWORD()
    kernel32.GetExitCodeProcess(pi.hProcess, ctypes.byref(exit_code))
    if exit_code.value != 0x103:
        print(f'Exited at {i+1}s with code: {hex(exit_code.value)}')
        break
    else:
        print(f'Still alive at {i+1}s')

kernel32.CloseHandle(h_file)
kernel32.CloseHandle(pi.hProcess)
kernel32.CloseHandle(pi.hThread)
