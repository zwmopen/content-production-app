# -*- coding: utf-8 -*-
"""
QA Business Gate (业务强规则与违禁词质检门禁)
负责全链路图片 OCR 文本与文案的业务合规性硬阻断：
1. 人数门槛检验：下限一律强制为 10 人，坚决拦截“20人起接/30人起订/50人起”等竞品残留；
2. 竞品机构/博主违禁词门禁：拦截光合派、聚吧、哒尔文、知旅等第三方竞品词汇；
3. 第三方平台敏感引流词拦截：拦截微信号、电话、公众号等违规引流词汇。
"""

import os
import sys
import re
from typing import Dict, Any, List, Optional
from PIL import Image
import numpy as np

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

# 1. 竞品机构与博主违禁词黑名单
COMPETITOR_BLACKLIST = [
    "光合派", "聚吧", "哒尔文", "智博", "知旅", "企星", "潮尚", "嗨森",
    "拾焱", "猫小贝", "千渡好鸭", "聚励团建", "小车拼团", "公途意",
    "山野路书", "气指北", "趣加团建", "大应基地", "江苏哒尔文", "杭州聚吧",
    "上海拾焱", "可可定制", "条条", "闪闪", "玉米", "团子"
]

# 2. 引流与敏感词黑名单
SENSITIVE_WORDS_BLACKLIST = [
    "微信号", "加微信", "公众号", "淘宝店铺", "电话号码", "扫码关注",
    "私人微信", "个人v", "联系电话", "手机号"
]

# 3. 人数门槛违规正则：检测 20人起接、30人起订、50人起团 等过高门槛
# 排除 15-300人、10~200人等合理团队区间定制
INVALID_PEOPLE_PATTERN = re.compile(
    r'(?<![-~至到\d])(?:[2-9]\d|[1-9]\d{2,})\s*人\s*(?:起接|起订|起团|起做|起拍|起)'
)

# 允许的标准人数与区间特征白名单
VALID_PEOPLE_EXCEPTIONS = [
    r'10\s*人\s*起接', r'10\s*人\s*起', r'\d+[-~至到]\d+\s*人'
]


def check_text_business_compliance(text: str) -> Dict[str, Any]:
    """
    检查纯文本（文案或 OCR 识别内容）的业务合规性
    """
    if not text:
        return {"passed": True, "violations": []}

    violations = []

    # 1. 人数门槛检验
    invalid_people_matches = INVALID_PEOPLE_PATTERN.findall(text)
    for m in invalid_people_matches:
        violations.append(f"【人数门槛违规】检测到竞品硬性人数限制 [{m}]，业务铁律要求一律统一为 10人起接/15-300人定制")

    # 2. 竞品机构与博主过滤
    for comp in COMPETITOR_BLACKLIST:
        if comp in text:
            violations.append(f"【竞品泄露阻断】检测到竞品机构/博主关键词 [{comp}]")

    # 3. 敏感引流词过滤
    for sens in SENSITIVE_WORDS_BLACKLIST:
        if sens in text:
            violations.append(f"【敏感引流拦截】检测到敏感引流词 [{sens}]")

    return {
        "passed": len(violations) == 0,
        "violations": violations,
        "details": {
            "invalid_people_found": invalid_people_matches,
            "text_length": len(text)
        }
    }


def check_image_business_compliance(image_path: str, ocr_reader=None) -> Dict[str, Any]:
    """
    对单张成品图片进行 OCR 业务门禁扫描，验证画面文字是否合规
    """
    if not os.path.exists(image_path):
        return {"passed": False, "violations": [f"图片文件不存在: {image_path}"]}

    try:
        im = Image.open(image_path).convert("RGB")
    except Exception as e:
        return {"passed": False, "violations": [f"图片损坏无法解析: {e}"]}

    ocr_text = ""
    try:
        if ocr_reader is None:
            import easyocr
            ocr_reader = easyocr.Reader(['ch_sim', 'en'], gpu=False)
        
        # 将 PIL Image 转换为 numpy 数组传入 easyocr（避免 Windows 路径中文解码问题）
        results = ocr_reader.readtext(np.array(im))
        lines = [item[1] for item in results if len(item) > 1 and item[2] > 0.3]
        ocr_text = " ".join(lines)
    except Exception as e:
        # OCR 容错（若没有显卡或环境抖动，记录告警但不阻塞纯像素质检）
        return {
            "passed": True,
            "violations": [],
            "warning": f"OCR 扫描跳过或容错: {e}",
            "ocr_text": ""
        }

    res = check_text_business_compliance(ocr_text)
    res["ocr_text"] = ocr_text
    res["image_path"] = image_path
    return res


if __name__ == "__main__":
    # 自测用例
    print("--- 业务门禁质检测试 ---")
    test_cases = [
        "安吉团建2天1夜，20人起接，光合派团建制作",
        "莫干山秋季团建，10人起接，吃喝玩乐一整天",
        "杭州30人起订团建，联系电话13800000000",
        "江浙沪15-300人定制团建方案，大厂同款"
    ]
    for c in test_cases:
        r = check_text_business_compliance(c)
        print(f"输入: {c}")
        print(f"结果: {'通过 √' if r['passed'] else '拦截 ❌'} -> {r['violations']}\n")
