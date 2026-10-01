# -*- coding: utf-8 -*-
"""
3 小时产线报告 · WorkBuddy
统计近 3 小时产出 → 打分 → 生成 Markdown → 发飞书「流水线生产」群（Card 2.0）
复用主脑同款发送链路（lark-run-js，profile=feishu-main，群 oc_a620407b...）。
只读统计，不改动任何成品/台账文件。
"""
import os, re, json, time, subprocess, sys
from datetime import datetime, timedelta

SCRIPTS = r'D:\AICode\工具开发\projects\content-production-app\scripts'
sys.path.insert(0, SCRIPTS)
import wb_quality_scorer as qs  # noqa: E402

LARK_RUN_JS = r"D:\AICode\工具开发\toolchains\npm-global\node_modules\@larksuite\cli\scripts\run.js"
CHAT_ID = "oc_a620407b836cb421f8bb72c0d6f596f1"
PROFILE = "feishu-main"
POOL = qs.POOL
PROD_LOG = r'D:\AICode\运行数据\autonomous_production.log'
WLOG = r'D:\AICode\运行数据\pipeline_watchdog.log'
STATUS = r'D:\AICode\运行数据\autonomous_production_daemon_status.json'
STATE = r'D:\AICode\运行数据\江湖有旅人\三小时报告_state.json'
REPORT_DIR = r'D:\AICode\运行数据\江湖有旅人'
WINDOW_H = 3

now = datetime.now()
t0 = now - timedelta(hours=WINDOW_H)


def in_window(ts):
    return t0 <= ts <= now


def load_status():
    try:
        return json.load(open(STATUS, encoding='utf-8'))
    except Exception:
        return {}


def log_successes():
    """从生产日志数窗口内的 成功/判废 次数（按实例）"""
    succ, fail = {'A': 0, 'B': 0}, {'A': 0, 'B': 0}
    try:
        with open(PROD_LOG, 'rb') as f:
            f.seek(0, 2); size = f.tell()
            f.seek(max(0, size - 300000))
            tail = f.read().decode('utf-8', errors='replace')
        for ln in tail.splitlines():
            m = re.match(r'\[(2026-\d\d-\d\d \d\d:\d\d:\d\d)\] \[([AB])\]', ln)
            if not m: continue
            ts = datetime.strptime(m.group(1), '%Y-%m-%d %H:%M:%S')
            if not in_window(ts): continue
            if '生产成功' in ln: succ[m.group(2)] += 1
            if ('判废' in ln) or ('空文案判废' in ln) or ('残缺画册阻断' in ln): fail[m.group(2)] += 1
    except Exception:
        pass
    return succ, fail


def new_packages():
    out = []
    for dp, dn, fn in os.walk(POOL):
        dn[:] = [d for d in dn if d not in qs.SKIP_DIRS]
        if 'manifest.json' not in fn: continue
        mf = os.path.join(dp, 'manifest.json')
        try:
            m = json.load(open(mf, encoding='utf-8'))
        except Exception:
            continue
        ts = None
        for k in ('created_at', 'createdAt'):
            v = m.get(k)
            if isinstance(v, str):
                for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S'):
                    try:
                        ts = datetime.strptime(v[:19], fmt); break
                    except Exception: pass
            if ts: break
        if ts is None:
            ts = datetime.fromtimestamp(os.path.getmtime(dp))
        if in_window(ts):
            out.append((dp, m, ts))
    out.sort(key=lambda x: x[2])
    return out


def main():
    st = load_status()
    succ, fail = log_successes()
    pkgs = new_packages()
    # 打分（仅窗口内新套）
    scored = []
    for dp, m, ts in pkgs:
        r = qs.score_package(dp)
        r['worker'] = m.get('worker') or m.get('pipeline') or ''
        r['hm'] = ts.strftime('%H:%M')
        scored.append(r)
    from collections import Counter
    dist = Counter(r['grade'] for r in scored)

    # 看门狗
    wd = ''
    try:
        with open(WLOG, 'r', encoding='utf-8') as f:
            wd = f.read().strip().splitlines()[-1]
    except Exception:
        wd = '（无记录）'

    total = st.get('completed_total', '?')
    queue = st.get('queue_remaining', '?')
    inst = st.get('instances', {})
    a_st, b_st = inst.get('A', {}), inst.get('B', {})

    L = []
    a_n = sum(1 for r in scored if 'A' in r['worker'].upper() or 'instance-a' in r['worker'].lower())
    b_n = sum(1 for r in scored if 'B' in r['worker'].upper() or 'instance-b' in r['worker'].lower())
    L.append('**📊 网页CDP产线 · 3 小时报告（%s–%s）**' % (t0.strftime('%H:%M'), now.strftime('%H:%M')))
    L.append('')
    L.append('**产出：%d 套**（A：%d 套 · B：%d 套）｜判废/阻断：%d 次' % (
        len(scored), a_n, b_n, fail['A'] + fail['B']))
    L.append('**累计**：completed_total %s ｜ 队列剩余 %s 套' % (total, queue))
    if scored:
        L.append('**质量分布**：优 %d · 良 %d · 合格 %d · 垃圾候选 %d' % (
            dist.get('优', 0), dist.get('良', 0), dist.get('合格', 0), dist.get('⚠️垃圾候选', 0)))
    L.append('')
    L.append('**实例状态**：A=%s（今日图 %s）｜B=%s（今日图 %s）' % (
        a_st.get('state'), a_st.get('today_images'), b_st.get('state'), b_st.get('today_images')))
    L.append('**健康**：主脑 PID %s ｜ 看门狗：%s' % (st.get('pid'), wd[:90]))
    if scored:
        L.append('')
        L.append('**交付清单**')
        for r in scored[-12:]:
            L.append('- %s %s（%s，%d图，%d分%s）' % (
                r['hm'], r['name'][:38], r['worker'] or 'CDP', r['imgs'], r['total'], r['grade']))
        bad = [r for r in scored if r['total'] < 60]
        if bad:
            L.append('')
            L.append('**⚠️ 新增垃圾候选 %d 套**（仅标记未处置）' % len(bad))
            for r in bad:
                L.append('- %s（%d分：%s）' % (r['name'][:40], r['total'], '；'.join(r['notes'])[:60]))
    md = '\n'.join(L)

    # 落盘
    rp = os.path.join(REPORT_DIR, '三小时产报_%s.md' % now.strftime('%Y%m%d_%H%M'))
    with open(rp, 'w', encoding='utf-8') as f:
        f.write(md)
    print(md)
    print('\n报告已存:', rp)

    # 发送（Card 2.0，主脑同款链路）
    card = json.dumps({"schema": "2.0",
                       "config": {"wide_screen_mode": True, "update_multi": True},
                       "body": {"elements": [{"tag": "markdown", "content": md}]}}, ensure_ascii=False)
    cmd = ["node", LARK_RUN_JS, "im", "+messages-send",
           "--profile", PROFILE, "--as", "user",
           "--chat-id", CHAT_ID, "--msg-type", "interactive",
           "--content", card, "--format", "json"]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', timeout=20)
    ok = res.returncode == 0
    print('飞书发送:', 'OK' if ok else 'FAIL rc=%s %s' % (res.returncode, (res.stderr or '')[:200]))
    json.dump({'last_sent': now.strftime('%Y-%m-%d %H:%M:%S'),
               'completed_total': st.get('completed_total'),
               'sent': ok}, open(STATE, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
