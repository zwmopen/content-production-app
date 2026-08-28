const path = require("node:path");

const RECIPES = [
  {
    id: "rice-grid-quotes",
    match: /米字格|黄底引号|手写标题/,
    name: "米字格封面＋黄底引号四宫格",
    cover: "米字格大字四宫格封面：2×2无白边实景拼图，中部米白米字格独立汉字卡，黑色毛笔感大字，红色细米字线，下方粉色不规则横条。",
    inner: "黄底引号无缝四宫格内页：2×2无白边拼图，黄色标题条压在中缝，黑色圆润手写字，蓝色左引号与绿色右引号。",
    titleStyle: "封面严格复刻米字格字卡；内页使用圆润手写标题，禁止促销黑体。"
  },
  {
    id: "green-info-keycaps",
    match: /湖景绿底|绿底.*键帽|彩色键帽|价格信息封面.*四宫格/,
    name: "湖景绿底价格信息封面 × 彩色键帽大字四宫格项目拼图",
    cover: "湖景或营地大图主视觉，下半部深绿色半透明信息区，白色重标题，简洁信息分区；有明确价格才保留价格，没有则改成玩法、时长和人数。",
    inner: "无白边四宫格，中央交界处为彩色圆角键帽逐字标题，左侧黑色花形符号键帽。",
    titleStyle: "保留彩色键帽识别度，但减少儿童化和廉价感。"
  },
  {
    id: "luxury-region-hotel-collage",
    match: /超大四角地域字|四角地域字.*高奢|高奢.*四角地域字|暗调酒店.*中心叠图|高奢体验拼贴|做云南定制十几年/,
    name: "超大四角地域字草海封面 × 暗调酒店双段透明框＋中心叠图高奢体验拼贴",
    cover: "全幅真实草海、山野或目的地环境作单一背景，四角放超大细体白色地域字；中央使用宽字距英文，左右仅保留精简信息，中下部保留数字信息槽，底部用克制的中英双语收束。不得改成多图套餐海报。",
    inner: "按母版页面角色复用三种固定骨架：暗调上下双段大图＋中央半透明横框；暗色多图背景＋中央明亮竖图；虚化自然背景＋白色大圆角路线信息板。真实酒店、建筑和景点只允许裁切、换位与局部修补，不得重建。",
    titleStyle: "细体、宽字距、低饱和、安静高奢；白色与克制金棕为主。禁止黑粗促销字、彩色胶囊、旅行社价格爆炸贴和新发明的装饰。"
  },
  {
    id: "forest-route-seam-title",
    match: /森林漂流|瀑布溪谷|溪谷路线|路线节点|黑描边景点|中缝标题|黑白描边大字无白边/,
    name: "瀑布溪谷路线节点封面 × 黑白描边大字无白边项目拼图",
    cover: "一张真实瀑布、溪谷或山野实景作满版背景，顶部黄白双色大标题加克制黑描边，半透明信息条、白色路线曲线与红色定位节点，左侧简版行程；禁止多图堆满的套餐海报。",
    inner: "3:4无白边双拼、四宫格或复合拼图，分区弱分隔，中央横向白色粗字加克制黑描边，每页只讲一个玩法或地点。真实景点保护优先，不得为换人而重建场地。",
    titleStyle: "沿用母版规整清晰的粗体标题，字号和描边克制；禁止刷字、超长两行广告语、胶囊副标题和模板漂移。"
  },
  {
    id: "memo-handwriting",
    match: /备忘录|手写大字|便签/,
    name: "备忘录手写封面＋原生拼图内页",
    cover: "真实场景主图叠加备忘录或便签式手写大字，保持原母版的字号、留白、色块和标题位置。",
    inner: "沿用母版典型内页的拼图比例、手写标题和色块关系。",
    titleStyle: "手写气质优先，不使用标准广告黑体。"
  }
];

const DEFAULT_RECIPE = {
  id: "strict-template-transfer",
  name: "严格母版迁移",
  cover: "逐项复刻所选模板首张封面的构图、字体气质、字号、配色、标题位置、装饰和留白。",
  inner: "逐项复刻所选模板典型内页的拼图结构、标题位置、字体、配色和页面节奏。",
  titleStyle: "不得重新设计，不得把素材原排版当成模板。"
};

const TOPIC_WORDS = [
  "漂流", "溯溪", "露营", "烧烤", "徒步", "采茶", "制茶", "点茶", "拓染", "采摘",
  "垂钓", "越野", "皮划艇", "篝火", "草坪", "温泉", "轰趴", "会议", "农家菜", "古村",
  "乐园", "溶洞", "团建", "一日", "两天一夜"
];

function recipeForTemplate(templateName = "") {
  return RECIPES.find((recipe) => recipe.match.test(String(templateName))) || DEFAULT_RECIPE;
}

function cleanTitle(value) {
  const cleaned = String(value || "")
    .replace(/\.[^.]+$/, "")
    .replace(/^[\d\s._\-（）()【】[\]]+/, "")
    .replace(/[@#].*$/, "")
    .replace(/[|｜].*$/, "")
    .replace(/[^\p{L}\p{N}\s·＋+&]/gu, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(HR|行政)(快|请)?(收藏|码住)/i, "")
    .replace(/(超好玩|快收藏|必看|码住|一键解锁|无限尝鲜)/g, "")
    .trim();
  return cleaned.slice(0, 16);
}

function factTitles(facts = "") {
  const lines = String(facts).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const found = [];
  for (const line of lines) {
    const compact = cleanTitle(line.replace(/^[#>*\d.\-、\s]+/, "").replace(/[：:].*$/, ""));
    if (compact.length >= 2 && compact.length <= 16 && TOPIC_WORDS.some((word) => compact.includes(word))) {
      found.push(compact);
    }
  }
  return [...new Set(found)];
}

function buildProductionPlan({
  mode = "set",
  materialPath,
  templatePath,
  materialImages = [],
  facts = "",
  requestedPages,
  batchIndex = 0
}) {
  const materialName = cleanTitle(path.basename(materialPath)) || `素材${batchIndex + 1}`;
  const templateName = cleanTitle(path.basename(templatePath)) || "当前模板";
  const recipe = recipeForTemplate(templateName);
  const imageTitles = materialImages.map((file) => cleanTitle(path.basename(file))).filter((title) => title && !/^(img|image|dsc|微信图片|p\d+)$/i.test(title));
  const titles = [...factTitles(facts), ...imageTitles];
  const automaticPages = Math.max(1, Math.min(10, materialImages.length || 1));
  const pageCount = mode === "one"
    ? 1
    : Math.max(1, Math.min(10, Number(requestedPages) || automaticPages));
  const pages = Array.from({ length: pageCount }, (_, index) => {
    const role = index === 0 ? "cover" : "inner";
    const sourceImage = materialImages[Math.min(index, Math.max(0, materialImages.length - 1))] || "";
    const title = index === 0 ? materialName : (titles[index - 1] || `项目亮点 ${index}`);
    return {
      index: index + 1,
      code: `P${index + 1}`,
      role,
      roleLabel: role === "cover" ? "封面" : "内页",
      title,
      sourceImage,
      rule: role === "cover" ? recipe.cover : recipe.inner
    };
  });
  return {
    mode,
    materialPath,
    materialName,
    templatePath,
    templateName,
    recipe: { id: recipe.id, name: recipe.name, cover: recipe.cover, inner: recipe.inner, titleStyle: recipe.titleStyle },
    pageCount,
    pages,
    output: mode === "one" ? "1张独立3:4待审图片" : `${pageCount}张独立3:4图片＋1份小红书文案＋1份生产记录`,
    safeguards: [
      "A类模板只决定视觉；B类素材只决定事实和内容；历史失败图不参与设计",
      "页数由有效素材决定，不按母版页数硬凑，不把多页合成一张",
      "小红书与抖音按平台分别生成；抖音不使用起接人数或服务承接话术；没有明确价格不写价格",
      "禁止虚构地点、项目、车程、价格、建筑和素材中不存在的场景",
      "结果先进入待审区，人工通过后才进入正式成品库"
    ]
  };
}

function buildPagePrompt(plan, page, facts = "", extraPrompt = "", quality = "严格母版") {
  const innerPageGuard = page.role === "inner"
    ? "内页只允许显示本页准确标题；禁止页眉、页脚、品牌、水印、说明文字和额外小字。标题放在母版原有中部位置，顶部与四周必须留出安全边距，任何文字不得裁切出画面。"
    : "";
  const keycapGuard = plan.recipe.id === "green-info-keycaps" && page.role === "inner"
    ? "本页必须是铺满整张画布的无白边四宫格：四张照片直达画面外沿、直角硬拼、只允许极弱拼缝。禁止绿色外框、白色边框、白色缝隙、圆角照片卡、阴影卡片和海报底板。彩色键帽标题仅横压在四格中央交界处，所有键帽必须缩小后保持一行横排，禁止拆成两行。"
    : "";
  return [
    "执行已经确认的本地团建图文生产任务。不是自由设计，也不是做相似风格。",
    `模板生产配方：${plan.recipe.name}。`,
    `本页：${page.code} ${page.roleLabel}，标题“${page.title}”。`,
    plan.mode === "one"
      ? "这是单张作品，不得沿用母版里的01/09等多页页码；需要页码时只能写01/01，优先不显示页码。"
      : `本套共${plan.pageCount}页；如母版含页码，本页只能显示${String(page.index).padStart(2, "0")}/${String(plan.pageCount).padStart(2, "0")}。`,
    `本页硬规则：${page.rule}`,
    `文字规则：${plan.recipe.titleStyle}`,
    "第一组参考图是A类永久视觉母版；最后一张参考图是本页B类内容素材。只替换内容，不改变母版骨架。",
    "每次只输出一张独立3:4成品图。禁止多页合集、长图、缩略图墙、手机样机和白色画布展示。",
    "图片只负责真实场景与视觉结构，不写起接人数、价格、联系方式或交易话术。素材没有明确价格时不得出现任何价格。",
    "事实锁：不得虚构地点、项目、车程、价格、建筑、人物活动和素材中不存在的露营或篝火。",
    "人物、分区、静物和道具必须去重；保持真实手机抓拍感，不要广告模特、塑料脸和统一假笑。",
    innerPageGuard,
    keycapGuard,
    `质量档：${quality}。`,
    extraPrompt ? `本批补充要求：${String(extraPrompt).slice(0, 12000)}` : "",
    facts ? `素材事实（只能从这里取业务事实）：\n${String(facts).slice(0, 12000)}` : ""
  ].filter(Boolean).join("\n\n");
}

function buildCopyPrompt(plan, facts = "") {
  return [
    "请为下面这套团建轮播一次生成小红书和抖音两个平台的可直接发布成稿，只输出一个 TXT 机器协议，不解释写作过程。",
    `主题：${plan.materialName}`,
    `页面：${plan.pages.map((page) => page.title).join("、")}`,
    "严格按以下标记输出，标记原样保留，不得加代码围栏、平台说明或其他前后文字：",
    "<<<COPY_FORMAT:2>>>\n\n<<<XHS_START>>>\n小红书完整成稿\n<<<XHS_END>>>\n\n<<<DOUYIN_START>>>\n抖音完整成稿\n<<<DOUYIN_END>>>",
    "小红书版：使用真实、自然的小红书口语，不要像旅行社广告，也不要写成项目清单堆砌。路线型使用基础信息＋DAY1/DAY2或上午/下午节奏；场地型使用场景体验＋可选玩法；清单型使用明确分组。可在已确认业务口径适用时写江浙沪企业团建、10人起接；没有明确价格不写价格。最后一行固定10个相关话题标签。",
    "抖音版：必须基于同一事实重新写成目的地攻略、玩法分享、体验参考和避坑内容，不是团建服务销售页。讲清楚项目差异、怎么玩、适合什么体力、天气季节、装备、开放情况和取舍建议；自然保留必要地域/团建关键词，但不要写企业获客或服务承接话术。禁止价格、报价、费用、10人起接、人数起接、承接、接单、定制、咨询、联系我们、留言城市+人数、方案获客、报名、预约、下单及其他交易表达；固定输出5个相关话题标签。",
    "没有明确确认的KTV、篝火、烤全羊、拓展、景点等统一写成可选、可组合或路线参考，不得暗示固定全部包含。不得虚构客户案例、场地、建筑、项目、资质和效果。",
    "两版必须基于同一套事实，不得互相矛盾；不得提及 TXT、图片、附件、素材或生成过程；语言要克制具体，减少‘氛围拉满、封神、天花板、直接抄、绝绝子’等营销腔，不写必然结果。",
    facts ? `素材事实：\n${String(facts).slice(0, 12000)}` : ""
  ].filter(Boolean).join("\n\n");
}

function applySuggestedTitles(plan, suggestion = {}) {
  const workTitle = cleanTitle(suggestion.workTitle) || plan.materialName;
  const suggestedPages = Array.isArray(suggestion.pages) ? suggestion.pages : [];
  return {
    ...plan,
    materialName: workTitle,
    pages: plan.pages.map((page, index) => ({
      ...page,
      title: index === 0
        ? workTitle
        : (cleanTitle(suggestedPages[index]?.title || suggestedPages[index - 1]?.title) || page.title)
    }))
  };
}

module.exports = {
  DEFAULT_RECIPE,
  RECIPES,
  applySuggestedTitles,
  buildCopyPrompt,
  buildPagePrompt,
  buildProductionPlan,
  recipeForTemplate
};
