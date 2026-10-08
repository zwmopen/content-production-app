"""文案落盘出口守卫（2026-09-21 新增）

为什么需要它
------------
`copy_formatter.clean_entire_copy(text, mobile_safe=True)` 已经挂在主产线落盘前，
但它有两条**静默降级**路径：

1. 返回 `ok=False`（如实质字数不足被判废）→ 旧代码 `if ok and formatted_copy:` 不成立，
   `full_copy` 保持「客户端原文」，**标签与外泄文本逐字落盘**；
2. 抛异常（模块缺失/路径变更）→ `except` 分支同样落盘原文。

后果（已实测）：`标题：/正文：/话题：` 这类**不是协议字段**的标签会进成品库，
再被 `online_gallery_service.py` 原样下发到手机剪贴板 —— 用户在小红书/抖音编辑框里
看到的就是这几行垃圾。库内实测 112 份文案带此类标签（Codex 产线 32 份、网页CDP 5 份）。

本模块的定位
------------
**出口兜底，不改真源**。落盘前一律过一遍 `guard_copy_output()`：

- 真源成功时：本守卫**近似无操作**（幂等，只把假空行/多连分隔收敛成单个 `U+2800`）；
- 真源失败时：用与真源同口径的本地规则**至少**把标签与假空行清掉，
  绝不把原文直接落盘。

口径与 `copy_formatter` 保持一致
--------------------------------
- 单标题：每个版本块第一行就是标题，不许带 `标题：`、`正文：`、`话题：` 前缀；
- 段落留白：`mobile_safe=True` 用 **`U+2800`（BRAILLE PATTERN BLANK，「盲文空格」）**
  单独成行 —— 编辑框里看不见，但它是**非空字符**，平台裁空白行裁不掉它，
  所以「编辑框有空行 + 发布后仍在」。**不要用 `\\n\\n` 替代。**
- 多个连续分隔行收敛为**恰好一个** `U+2800`；
- 文件首尾的分隔、以及紧邻 `<<<...>>>` 协议标记的分隔**不动**（避免注入版本块体内）。

不变量（任一被破坏即返回 ok=False，调用方应保留原文并告警）
----------------------------------------------------------
1. 实质字数不减：`实质(净化后) >= 实质(净化前) - 被剥离的标签字符数`。
   实质 = 剔除「空白 + U+2800 + `<<<...>>>` 标记」后的字符数。
   ⚠️ `U+2800` 在 Python 里不是 `\\s`（`'\\u2800'.isspace() is False`），
   所以正则必须显式写成 `[\\s\\u2800]+`，否则新插的占位行会被当成正文内容，
   守恒断言会全线误拦。
2. 协议标记多重集不变：`sorted(re.findall(r'<<<[^>]*>>>', ...))` 前后一致。
3. 幂等：`clean(clean(x)) == clean(x)`。

用法
----
    from copy_output_guard import guard_copy_output, MAX_COPY_LINE_LEN
    ok, cleaned, rep = guard_copy_output(full_copy, tag="AUTUMN-C")
    if ok:
        full_copy = cleaned
    # rep["long_lines"] > 0 说明真源的呼吸分段没生效，应打告警而不是静默放过。

命令行自检/补救：

    python copy_output_guard.py --check <文件或目录>      # 只读扫描并出报告
    python copy_output_guard.py --apply <文件...>        # 就地净化（.orig 备份，幂等）
"""

from __future__ import annotations

import os
import re
import shutil
import sys

# ---- 与 copy_formatter 同口径的常量 -------------------------------------
BRAILLE_BLANK = "\u2800"          # U+2800 BRAILLE PATTERN BLANK（盲文空格）
MAX_COPY_LINE_LEN = 300           # 超过此长度视为「未呼吸分段」，只告警不擅自切

_SUBST_KEEP_RE = re.compile(r"[\s\u2800]+")
_MARK_ALL_RE = re.compile(r"<<<[^>]*>>>")
_MARK_LINE_RE = re.compile(r"^\s*<<<.*>>>\s*$")

# `标题：xxx` → `xxx`；`正文：xxx` → `xxx`
_LABEL_RE = re.compile(
    r"^[ \t]*(?:标题|正文|内容|话题|备选标题\d*|建议标题\d*)[ \t]*[：:][ \t]*"
)
# 整行只有标签、后面没内容（如单独的 `正文：`）→ 整行丢弃
_DROP_RE = re.compile(r"^[ \t]*(?:正文|内容|话题|标题)[ \t]*[：:][ \t]*$")

# 剥离网页端与客户端 UI 免责声明
_FOOTER_STRIP_RE = re.compile(
    r"(?:ChatGPT\s*可能会出错[。，\.]*请核查重要信息[。，\.]*|最新一条回复|内容由\s*AI\s*生成[，。]*仅供参考)",
    re.IGNORECASE
)


def substance_of(text: str) -> int:
    """实质字数：剔除全部空白、U+2800 与 `<<<...>>>` 标记。"""
    return len(_SUBST_KEEP_RE.sub("", _MARK_ALL_RE.sub("", text)))


def _is_sep(line: str) -> bool:
    s = line.strip()
    return s == "" or s.replace(BRAILLE_BLANK, "").strip() == ""


def _is_mark(line: str) -> bool:
    return bool(_MARK_LINE_RE.match(line))


def clean_copy_text(text: str) -> tuple[str, int]:
    """纯净化：内联盲文空格拆行 + 剥标签 + 分隔收敛成单个 `U+2800`。返回 (结果, 被剥离字符数)。"""
    # 修复前缀截断
    if text.startswith("ION_START:"):
        text = "<<<VERS" + text
    elif text.startswith("VERSION_START:"):
        text = "<<<" + text

    # 剥离 UI 声明
    text_stripped = _FOOTER_STRIP_RE.sub("", text)
    footer_removed = len(text) - len(text_stripped)
    text = text_stripped

    # ⚠️ 产出方会写出 `\t\r\r\n`：只剥一个 \r 会让 `\t\r` 逃过判据，
    #    整份文件一行都修不上却报 0。必须 rstrip("\r") 全剥。
    # 【2026-10-07 修复·单行粘连】当单行内包含内联盲文空格 `⠀`（\u2800）而两侧无换行时，
    # 自动拆分为真正的物理换行 `\n⠀\n`。
    raw_lines_0 = [ln.rstrip("\r") for ln in text.split("\n")]
    raw_lines = []
    for ln in raw_lines_0:
        if BRAILLE_BLANK in ln and not _is_mark(ln) and not _is_sep(ln):
            parts = [p.strip(" \t") for p in re.split(r"[ \t]*\u2800+[ \t]*", ln) if p.strip(" \t")]
            for idx_p, part in enumerate(parts):
                if idx_p > 0:
                    raw_lines.append(BRAILLE_BLANK)
                raw_lines.append(part)
        else:
            raw_lines.append(ln)

    removed = footer_removed
    stage = []
    for ln in raw_lines:
        if _is_mark(ln):
            stage.append(ln)
            continue
        if _DROP_RE.match(ln):
            removed += len(ln)
            stage.append("")
            continue
        new = _LABEL_RE.sub("", ln)
        removed += len(ln) - len(new)
        stage.append(new)

    out = []
    i, n = 0, len(stage)
    while i < n:
        if not _is_sep(stage[i]):
            out.append(stage[i])
            i += 1
            continue
        j = i
        while j < n and _is_sep(stage[j]):
            j += 1
        prev_c = next((stage[k] for k in range(i - 1, -1, -1) if not _is_sep(stage[k])), None)
        next_c = next((stage[k] for k in range(j, n) if not _is_sep(stage[k])), None)
        if prev_c is None or next_c is None or _is_mark(prev_c) or _is_mark(next_c):
            out.extend(stage[i:j])          # 首尾 / 紧邻协议标记：原样保留
        else:
            out.append(BRAILLE_BLANK)       # 段间留白：恰好一个盲文空格
        i = j

    while out and out[0].strip() == "":     # 去首行空行
        out.pop(0)
    while out and out[-1].strip() == "":    # 去尾部空行…
        out.pop()
    res = "\n".join(out)
    if text.endswith(("\n", "\r")):         # …但保留文件原有的末尾换行习惯，
        res += "\n"                         #   否则合规文本会被无谓改写（守卫本应近似 no-op）
    return res, removed


def guard_copy_output(text: str, tag: str = "") -> tuple[bool, str, dict]:
    """落盘前出口守卫。返回 (ok, cleaned, report)。

    ok=False 只在「会丢内容 / 丢协议标记 / 自身不幂等」时出现 ——
    此时调用方必须保留原文并告警，但仍应把 report 写进日志留下可 grep 的证据。
    """
    rep = {"tag": tag, "labels_removed": 0, "removed_chars": 0,
           "sep_runs": 0, "long_lines": 0, "reason": ""}
    if text is None:
        rep["reason"] = "none"
        return True, text, rep
    if text.strip() == "":
        rep["reason"] = "blank"
        return True, text, rep

    subst_before = substance_of(text)
    marks_before = sorted(_MARK_ALL_RE.findall(text))

    cleaned, removed = clean_copy_text(text)
    rep["removed_chars"] = removed
    # 记账：按「行」去重 —— `正文：` 同时命中 _LABEL_RE 与 _DROP_RE，不能重复计数
    rep["labels_removed"] = sum(
        1 for ln in re.split(r"\n|[ \t]*\u2800+[ \t]*", text)
        if _LABEL_RE.match(ln.rstrip("\r")) or _DROP_RE.match(ln.rstrip("\r"))
    )
    rep["sep_runs"] = sum(
        1 for ln in cleaned.split("\n") if ln.strip() == BRAILLE_BLANK
    )

    # ---- 不变量校验 ---------------------------------------------------
    subst_after = substance_of(cleaned)
    marks_after = sorted(_MARK_ALL_RE.findall(cleaned))
    rep["subst_before"] = subst_before
    rep["subst_after"] = subst_after
    rep["marks_ok"] = marks_before == marks_after
    rep["long_lines"] = sum(1 for l in cleaned.split("\n") if len(l) >= MAX_COPY_LINE_LEN)

    if subst_after < subst_before - removed:
        rep["reason"] = "substance_loss"
        return False, text, rep
    if not rep["marks_ok"]:
        rep["reason"] = "marker_loss"
        return False, text, rep

    # ---- 幂等自检：守卫自身必须可重复跑，否则说明规则不稳 --------------
    again, _ = clean_copy_text(cleaned)
    if again != cleaned:
        rep["reason"] = "not_idempotent"
        return False, text, rep

    return True, cleaned, rep


# ---- 命令行：只读检查 / 就地补救 ----------------------------------------
COPY_NAMES = {"文案.txt", "三平台文案.txt", "小红书文案.txt",
              "小红书发布文案.txt", "小红书HR决策版.txt"}


def _collect(paths):
    files = []
    for p in paths:
        if os.path.isdir(p):
            for dp, _dn, fn in os.walk(p):
                for f in fn:
                    if f in COPY_NAMES:
                        files.append(os.path.join(dp, f))
        elif os.path.isfile(p):
            files.append(p)
    return files


def main(argv):
    if not argv or argv[0] not in ("--check", "--apply"):
        print(__doc__)
        return 2
    mode, targets = argv[0], argv[1:]
    files = _collect(targets)
    if not files:
        print("未找到目标文件")
        return 1
    n_need = n_bad = 0
    for p in files:
        txt = open(p, "r", encoding="utf-8", errors="ignore").read()
        ok, cleaned, rep = guard_copy_output(txt, tag=os.path.basename(p))
        if not ok:
            n_bad += 1
            print(f"[REFUSE] {p}  reason={rep['reason']} {rep}")
            continue
        if cleaned != txt:
            n_need += 1
            if mode == "--apply":
                bak = p + ".orig"
                if not os.path.exists(bak):          # 备份只写一次，绝不覆盖
                    shutil.copy2(p, bak)
                with open(p, "w", encoding="utf-8", newline="\n") as f:
                    f.write(cleaned)
                print(f"[FIX] {p}  labels={rep['labels_removed']} "
                      f"sep={rep['sep_runs']} subst={rep['subst_before']}->{rep['subst_after']}")
            else:
                print(f"[NEED] {p}  labels={rep['labels_removed']} "
                      f"sep={rep['sep_runs']} long_lines={rep['long_lines']}")
    print(f"\n扫描 {len(files)} 份；需净化 {n_need} 份；守卫拒绝 {n_bad} 份"
          f"（模式 {mode}，已就地修复 {n_need if mode == '--apply' else 0} 份）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
