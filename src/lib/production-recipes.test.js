const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applySuggestedTitles,
  buildCopyPrompt,
  buildPagePrompt,
  buildProductionPlan,
  recipeForTemplate
} = require("./production-recipes");

test("chat-derived template recipes identify the three long-term master styles", () => {
  assert.equal(recipeForTemplate("米字格大字四宫格封面 × 黄底引号手写标题").id, "rice-grid-quotes");
  assert.equal(recipeForTemplate("湖景绿底价格信息封面 × 彩色键帽大字四宫格").id, "green-info-keycaps");
  assert.equal(recipeForTemplate("森林漂流路线节点封面 × 无白边四宫格黑描边").id, "forest-route-seam-title");
});

test("referenced master names resolve to their permanent visual recipes", () => {
  assert.equal(recipeForTemplate("湖景绿底价格信息封面 × 彩色键帽大字四宫格项目拼图模板").id, "green-info-keycaps");
  assert.equal(recipeForTemplate("超大四角地域字草海封面 × 暗调酒店上下双段透明框＋中心叠图高奢体验拼贴模板").id, "luxury-region-hotel-collage");
  assert.equal(recipeForTemplate("瀑布溪谷路线节点封面 × 黑白描边大字无白边项目拼图模板").id, "forest-route-seam-title");
});

test("copy prompt uses the dual-platform contract with 10/5 hashtags", () => {
  const plan = buildProductionPlan({
    mode: "set",
    materialPath: "D:\\素材\\安吉两天一夜",
    templatePath: "D:\\模板\\湖景绿底价格信息封面 × 彩色键帽大字四宫格项目拼图模板",
    materialImages: ["1.jpg", "2.jpg"]
  });
  const prompt = buildCopyPrompt(plan, "参考人均550+");
  assert.match(prompt, /COPY_FORMAT:2/);
  assert.match(prompt, /XHS_START/);
  assert.match(prompt, /DOUYIN_START/);
  assert.match(prompt, /10人起接/);
  assert.match(prompt, /固定10个相关话题标签/);
  assert.match(prompt, /固定输出5个相关话题标签/);
  assert.match(prompt, /禁止价格、报价、费用、10人起接、人数起接/);
  assert.match(prompt, /可选、可组合或路线参考/);
  assert.doesNotMatch(prompt, /8—12个相关标签/);
});

test("keycap inner-page prompt forbids white rounded cards and extra text", () => {
  const plan = buildProductionPlan({
    mode: "set",
    materialPath: "D:\\素材\\杭州农庄",
    templatePath: "D:\\模板\\湖景绿底价格信息封面 × 彩色键帽大字四宫格项目拼图模板",
    materialImages: ["D:\\素材\\杭州农庄\\P1.jpg", "D:\\素材\\杭州农庄\\P2.jpg"]
  });
  const prompt = buildPagePrompt(plan, plan.pages[1], "樱桃采摘");
  assert.match(prompt, /禁止绿色外框、白色边框、白色缝隙、圆角照片卡/);
  assert.match(prompt, /禁止页眉、页脚、品牌、水印、说明文字和额外小字/);
  assert.doesNotMatch(prompt, /10人起接/);
});

test("one, set and material-driven page counts are explicit", () => {
  const common = {
    materialPath: "D:\\素材\\杭州径山团建",
    templatePath: "D:\\模板\\森林漂流路线节点封面",
    materialImages: ["1.jpg", "2_茶山采茶.jpg", "3_点茶.jpg"],
    facts: "茶山采茶\n七汤点茶"
  };
  assert.equal(buildProductionPlan({ ...common, mode: "one" }).pageCount, 1);
  const set = buildProductionPlan({ ...common, mode: "set" });
  assert.equal(set.pageCount, 3);
  assert.equal(set.pages[0].role, "cover");
  assert.equal(set.pages[1].role, "inner");
  assert.match(set.output, /文案/);
});

test("text planning suggestions are cleaned before appearing in the user plan", () => {
  const plan = buildProductionPlan({
    mode: "set",
    materialPath: "D:\\素材\\1__杭州径山团建@HR快收藏",
    templatePath: "D:\\模板\\森林路线节点",
    materialImages: ["1.jpg", "2.jpg"]
  });
  const refined = applySuggestedTitles(plan, {
    workTitle: "杭州径山团建🔥",
    pages: [{ title: "杭州径山团建" }, { title: "茶山采茶✨" }]
  });
  assert.equal(refined.materialName, "杭州径山团建");
  assert.equal(refined.pages[1].title, "茶山采茶");
});
