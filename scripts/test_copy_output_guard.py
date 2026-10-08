"""copy_output_guard 的自检（2026-09-21）

纪律：**绿色 ≠ 有效**。光跑通正常用例不算证明，必须把实现换成「错误版本」
（会丢内容 / 丢协议标记），确认 `guard_copy_output` 真的返回 ok=False。
否则不变量只是永不触发的死代码。

跑法：
    python test_copy_output_guard.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import copy_output_guard as g  # noqa: E402

B = g.BRAILLE_BLANK
FAILS = []


def check(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + ((" | " + detail) if detail else ""))
    if not cond:
        FAILS.append(name)


# ---------------------------------------------------------------- 正常行为
def t_clean_is_noop():
    """已合规的文本必须原样返回（真源成功时守卫近似无操作）。"""
    txt = ("<<<COPY_FORMAT:3>>>\n"
           f"上海团建｜秋日一日游\n{B}\n"
           "秋天适合团队出来走走。\n"
           "09:00 集合出发\n")
    ok, out, rep = g.guard_copy_output(txt, "clean")
    check("T1 合规文本原样放行", ok and out == txt, f"reason={rep['reason']}")


def t_strip_labels():
    txt = ("标题：上海团建｜秋日一日游\n"
           "正文：\n"
           "秋天适合团队出来走走。\n"
           "话题：#上海团建 #秋游\n")
    ok, out, rep = g.guard_copy_output(txt, "labels")
    check("T2 标签被剥离且不残留",
          ok and "标题：" not in out and "正文：" not in out and "话题：" not in out,
          repr(out))
    check("T2b 实质内容未丢", "秋天适合团队出来走走" in out and "#上海团建" in out)
    check("T2c 记账正确", rep["labels_removed"] == 3, str(rep["labels_removed"]))


def t_fake_blank_to_braille():
    """真实空白行 → 恰好一个 U+2800（落 mobile_safe 口径）。"""
    txt = "第一段内容。\n \n第二段内容。\n"
    ok, out, rep = g.guard_copy_output(txt, "fakeblank")
    check("T3 假空行收敛为单个盲文空格", ok and out == f"第一段内容。\n{B}\n第二段内容。\n", repr(out))


def t_collapse_multi_sep():
    txt = f"上段。\n{B}\n\n \n下段。\n"
    ok, out, rep = g.guard_copy_output(txt, "multi")
    check("T4 多连分隔收敛为一个", ok and out == f"上段。\n{B}\n下段。\n", repr(out))


def t_keep_marker_adjacent_sep():
    """紧邻 <<<...>>> 的分隔不动，避免把占位注进版本块体内。"""
    txt = f"<<<XHS_START>>>\n\n\n正文内容。\n<<<XHS_END>>>\n"
    ok, out, rep = g.guard_copy_output(txt, "marker")
    check("T5 协议标记相邻分隔不动", ok and out.startswith("<<<XHS_START>>>\n\n\n"), repr(out))


def t_idempotent():
    txt = "标题：甲\n\n正文乙\n\n\n丙\n"
    ok1, a, _ = g.guard_copy_output(txt, "i1")
    ok2, b, _ = g.guard_copy_output(a, "i2")
    check("T6 幂等（二次净化零变更）", ok1 and ok2 and a == b, repr(a) + " vs " + repr(b))


def t_crlf_and_tab():
    """产出方实测会写 `\\t\\r\\r\\n`：必须全剥 \\r 才能命中假空行。"""
    txt = "第一段。\r\n\t\r\r\n第二段。\r\n"
    ok, out, rep = g.guard_copy_output(txt, "crlf")
    check("T7 CRLF+Tab 假空行被识别", ok and out == f"第一段。\n{B}\n第二段。\n", repr(out))


# ------------------------------------- 闸门有效性：换成错误实现必须被拦
def t_gate_fires_on_content_loss():
    orig = g.clean_copy_text

    def lossy(text):
        out, _ = orig(text)
        cut = max(1, len(out) * 6 // 10)
        return out[:cut], 0              # 悄悄删掉 40% 正文

    g.clean_copy_text = lossy
    try:
        ok, out, rep = g.guard_copy_output("标题：甲\n\n正文内容很长很长，必须被保住。\n", "lossy")
    finally:
        g.clean_copy_text = orig
    check("T8 【闸门】内容被吞时必须 REFUSE",
          (not ok) and rep["reason"] == "substance_loss", f"ok={ok} reason={rep['reason']}")


def t_gate_fires_on_marker_loss():
    orig = g.clean_copy_text

    def drop_marks(text):
        out, _ = orig(text)
        return "\n".join(l for l in out.split("\n") if "<<<" not in l), 0

    g.clean_copy_text = drop_marks
    try:
        ok, out, rep = g.guard_copy_output(
            "<<<COPY_FORMAT:3>>>\n<<<VERSION_START:原生种草>>>\n正文内容。\n<<<VERSION_END>>>\n",
            "dropmarks")
    finally:
        g.clean_copy_text = orig
    check("T9 【闸门】协议标记被抹时必须 REFUSE",
          (not ok) and rep["reason"] == "marker_loss", f"ok={ok} reason={rep['reason']}")


def t_gate_fires_on_nonidempotent():
    orig = g.clean_copy_text
    calls = {"n": 0}

    def unstable(text):
        calls["n"] += 1
        out, _ = orig(text)
        return (out + f"\n第{calls['n']}次漂移", 0) if calls["n"] > 1 else (out, 0)

    g.clean_copy_text = unstable
    try:
        ok, out, rep = g.guard_copy_output("正文内容。\n", "unstable")
    finally:
        g.clean_copy_text = orig
    check("T10 【闸门】规则不稳（不幂等）时必须 REFUSE",
          (not ok) and rep["reason"] == "not_idempotent", f"ok={ok} reason={rep['reason']}")


def t_marker_survives_normal_path():
    """反向确认：正常路径下协议标记不会被误伤（T9 的对照组）。"""
    txt = ("<<<COPY_FORMAT:3>>>\n<<<VERSION_START:原生种草>>>\n"
           "标题：甲\n\n正文内容。\n<<<VERSION_END>>>\n")
    ok, out, rep = g.guard_copy_output(txt, "keepmarks")
    check("T11 正常路径协议标记完好",
          ok and rep["marks_ok"] and out.count("<<<") == txt.count("<<<"), repr(out))


def t_inline_braille_split():
    """内联盲文空格（两侧无换行符）自动拆分为物理换行 \\n⠀\\n。"""
    txt = f"标题：莫干山团建{B}第一段内容。{B}{B}第二段内容。{B}话题：#莫干山\n"
    ok, out, rep = g.guard_copy_output(txt, "inline_braille")
    expected = f"莫干山团建\n{B}\n第一段内容。\n{B}\n第二段内容。\n{B}\n#莫干山\n"
    check("T12 内联盲文空格自动拆分为物理换行",
          ok and out == expected and rep["labels_removed"] == 2,
          f"out={repr(out)} rep={rep}")


def main():
    for fn in (t_clean_is_noop, t_strip_labels, t_fake_blank_to_braille, t_collapse_multi_sep,
               t_keep_marker_adjacent_sep, t_idempotent, t_crlf_and_tab,
               t_gate_fires_on_content_loss, t_gate_fires_on_marker_loss,
               t_gate_fires_on_nonidempotent, t_marker_survives_normal_path,
               t_inline_braille_split):
        fn()
    print()
    if FAILS:
        print(f"❌ {len(FAILS)} 项失败: {FAILS}")
        return 1
    print("✅ 全部通过：守卫正常放行，且「掏空内容 / 抹掉标记 / 规则不稳」三种错误版本都被拦下")
    return 0


if __name__ == "__main__":
    sys.exit(main())
