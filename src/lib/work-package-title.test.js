const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeWorkPackageTitle,
  publishTitleFromClipboard
} = require("./work-package-title");

test("object titles are treated as empty instead of leaking [object Object]", () => {
  const objectTitle = { text: "验证你的身份 - OpenAI" };

  assert.equal(normalizeWorkPackageTitle(objectTitle), "");
});

test("publish title prefers the first non-empty copy line when browser title is unsafe", () => {
  const clipboardText = "\n上海团建｜一日农庄团建这样排，吃喝玩乐全都有\n正文第二行";
  const objectTitle = { text: "验证你的身份 - OpenAI" };

  assert.equal(
    publishTitleFromClipboard(clipboardText, objectTitle),
    "上海团建｜一日农庄团建这样排，吃喝玩乐全都有"
  );
});

test("publish title never contains object stringification artifacts", () => {
  const clipboardText = "上海团建｜一日农庄团建这样排[object Object]上海团建｜一日农庄团建这样排，吃喝玩乐全都有";

  assert.equal(
    publishTitleFromClipboard(clipboardText, "备用标题"),
    "上海团建｜一日农庄团建这样排上海团建｜一日农庄团建这样排，吃喝玩乐全都有"
  );
});

test("publish title skips a standalone 标题 section label", () => {
  const clipboardText = "标题\n杭州一日团建｜79起峡谷漂流，玩水采摘太爽了\n正文\n杭州夏季团建还在纠结去哪儿？";

  assert.equal(
    publishTitleFromClipboard(clipboardText, "备用标题"),
    "杭州一日团建｜79起峡谷漂流，玩水采摘太爽了"
  );
});
