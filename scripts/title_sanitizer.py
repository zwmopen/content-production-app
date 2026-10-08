# -*- coding: utf-8 -*-
"""
Title Sanitizer (铁门 1：标题黑名单过滤器)
防御与清洗 AI 提示词污染、模型对话口语与报错语句，防止其被误作为作品标题或文件夹名。
"""
import re

TITLE_BLACKLIST_KEYWORDS = [
    "我这边", "当前会话", "没有看到", "请重新", "抱歉", "AI", "好的",
    "收到", "正在生成", "无法识别", "未能", "对不起", "上一套", "重新传",
    "重新发送", "ChatGPT", "未检测到", "未找到", "没看到", "助手", "作为一个语言模型"
]

def strip_author_and_source_tags(title: str) -> str:
    """
    剥离爬虫抓取残留的评赞头部、日期尾缀、机构/公司名及第三方博主作者后缀。
    例如：
    '评2-赞2-安吉2天1夜团建🤩秋日松弛感拉满🍁-光合派团建-闪闪' -> '安吉2天1夜团建🤩秋日松弛感拉满🍁'
    '莫干山团建🔥被老板赞爆了の2⃣️大路线杭州聚吧旅游策划有限公司20251010' -> '莫干山团建🔥被老板赞爆了の2⃣️大路线'
    """
    if not title:
        return ""
    t = str(title).strip()
    # 1. 剥离头部评赞标记（如 评2-赞2-、评137-赞5865-）
    t = re.sub(r'^评\d+-赞\d+-', '', t)
    # 2. 剥离尾部8位年月日抓取日期（如 20251010）
    t = re.sub(r'[\s\-_]*\d{8}$', '', t)
    # 3. 剥离结尾的有限公司及其公司主体名
    t = re.sub(r'[\u4e00-\u9fa5A-Za-z0-9]{2,10}(?:旅游|策划|会务|会展|文化|咨询|传媒)?有限公司.*$', '', t)
    # 4. 剥离尾部由连字符/空格/下划线引导的竞品博主、团队、分站或账号后缀
    t = re.sub(r'[-—_。·\s]+[^-—_。·\s]+(?:团建|旅游|策划|民宿|旅行|户外|文化|工作室|站|小分队|摄影|聚励|好鸭|闪闪|路书).*$', '', t)
    # 5. 移除非法路径字符并去除两端空白
    t = re.sub(r'[\\/:*?"<>|]', '_', t).strip()
    return t

def is_title_polluted(title: str) -> bool:
    """检查标题是否被 AI 对话口语、报错或提示语污染"""
    if not title:
        return True
    s = str(title).strip()
    if len(s) == 0:
        return True
    return any(kw in s for kw in TITLE_BLACKLIST_KEYWORDS)

def sanitize_title(candidate_title: str, fallback_title: str = "") -> str:
    """清洗标题：剥离原作者后缀，若首句/候选词命中黑名单直接丢弃，回退使用 fallback_title"""
    candidate_clean = strip_author_and_source_tags(candidate_title)
    if is_title_polluted(candidate_clean):
        fallback_clean = strip_author_and_source_tags(fallback_title)
        if is_title_polluted(fallback_clean):
            return "精选团建方案"
        return fallback_clean
    return candidate_clean

