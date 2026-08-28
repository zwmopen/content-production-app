"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyWechatWebPage,
  normalizeWechatWebDraft,
  buildWechatWebProbeScript,
  buildWechatWebFillScript,
  buildWechatWebMoveCaretScript,
  buildWechatWebSaveScript,
  buildWechatWebOpenEditorScript
} = require("./wechat-web-automation");

test("classifies the public-platform login page before any editor action", () => {
  const state = classifyWechatWebPage({
    url: "https://mp.weixin.qq.com/",
    text: "微信扫一扫，选择公众平台账号登录",
    readyState: "complete"
  });
  assert.equal(state.stage, "login-required");
  assert.equal(state.canFill, false);
  assert.equal(state.canSave, false);
});

test("classifies an authenticated dashboard separately from the editor", () => {
  const state = classifyWechatWebPage({
    url: "https://mp.weixin.qq.com/cgi-bin/home?t=home/index",
    text: "江浙沪团建策划 新的创作 草稿箱",
    readyState: "complete",
    authenticated: true
  });
  assert.equal(state.stage, "dashboard-ready");
  assert.equal(state.canOpenEditor, true);
  assert.equal(state.canFill, false);
});

test("requires title, body, image input and save control before declaring the editor ready", () => {
  const state = classifyWechatWebPage({
    url: "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit",
    readyState: "complete",
    authenticated: true,
    hasTitleInput: true,
    hasBodyEditor: true,
    hasImageInput: true,
    hasSaveButton: true,
    uploading: false
  });
  assert.equal(state.stage, "editor-ready");
  assert.equal(state.canFill, true);
  assert.equal(state.canSave, true);
});

test("does not save while image upload is still running", () => {
  const state = classifyWechatWebPage({
    url: "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit",
    readyState: "complete",
    authenticated: true,
    hasTitleInput: true,
    hasBodyEditor: true,
    hasImageInput: true,
    hasSaveButton: true,
    uploading: true,
    uploadedImageCount: 3
  });
  assert.equal(state.stage, "uploading-images");
  assert.equal(state.canFill, false);
  assert.equal(state.canSave, false);
});

test("recognizes a saved draft without treating it as another fillable editor", () => {
  const state = classifyWechatWebPage({
    url: "https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit",
    readyState: "complete",
    authenticated: true,
    saveSucceeded: true,
    text: "已保存到草稿箱"
  });
  assert.equal(state.stage, "saved");
  assert.equal(state.canSave, false);
});

test("normalizes a local post into a bounded browser-upload payload", () => {
  const payload = normalizeWechatWebDraft({
    postPath: "D:\\成品库\\作品集_060\\帖子一",
    title: "  江浙沪团建方案🍂  ",
    body: "正文第一行\r\n\r\n正文第二行",
    images: Array.from({ length: 12 }, (_, index) => `D:\\成品库\\${index + 1}.png`)
  });
  assert.equal(payload.title, "江浙沪团建方案");
  assert.equal(payload.draftType, "newspic");
  assert.equal(payload.body, "正文第一行\n\n正文第二行");
  assert.equal(payload.images.length, 10);
  assert.equal(payload.expectedImageCount, 10);
});

test("probe and fill scripts are self-contained and never click save", () => {
  const probe = buildWechatWebProbeScript();
  const fill = buildWechatWebFillScript({ title: "标题", body: "正文" });
  const articleFill = buildWechatWebFillScript({ draftType: "article", title: "标题", body: "第一段\n\n第二段" });
  assert.doesNotThrow(() => new Function(probe));
  assert.doesNotThrow(() => new Function(fill));
  assert.doesNotThrow(() => new Function(articleFill));
  assert.match(probe, /titleInput/);
  assert.match(probe, /saveSucceeded/);
  assert.match(probe, /appmsgid/);
  assert.match(probe, /validationError/);
  assert.match(probe, /removeAttribute\("data-tb-wechat-image-input"\)/);
  assert.match(probe, /\.reverse\(\)\.find/);
  assert.match(probe, /image-selector__preview-center-tips-area__num/);
  assert.match(probe, /Math\.max\(\.\.\.newspicCounts\)/);
  assert.match(probe, /:not\(\[data-placeholder\*='标题'\]\)/);
  assert.match(fill, /dispatchEvent/);
  assert.match(fill, /标题/);
  assert.match(fill, /:not\(\[data-placeholder\*='标题'\]\)/);
  assert.match(fill, /createElement\("p"\)/);
  assert.match(fill, /bodyParagraphCount/);
  assert.match(fill, /newspic-description/);
  assert.match(articleFill, /article-paragraphs/);
  assert.doesNotMatch(fill, /\.click\s*\(/);
});

test("save script only accepts an exact visible draft-save control", () => {
  const save = buildWechatWebSaveScript();
  assert.doesNotThrow(() => new Function(save));
  assert.match(save, /保存为草稿/);
  assert.match(save, /uploading/);
  assert.match(save, /saveButton\.click\(\)/);
  assert.doesNotMatch(save, /发表|群发/);
});

test("caret script keeps sequential image insertion at the end of the article", () => {
  const caret = buildWechatWebMoveCaretScript();
  assert.doesNotThrow(() => new Function(caret));
  assert.match(caret, /range\.collapse\(false\)/);
  assert.match(caret, /caret-to-body-end/);
});

test("open-editor script uses only creation labels and never publication actions", () => {
  const open = buildWechatWebOpenEditorScript();
  const article = buildWechatWebOpenEditorScript("article");
  assert.doesNotThrow(() => new Function(open));
  assert.doesNotThrow(() => new Function(article));
  assert.match(open, /new-creation__menu-item/);
  assert.match(open, /贴图/);
  assert.match(open, /"newspic"/);
  assert.match(article, /文章/);
  assert.match(article, /图文消息/);
  assert.match(article, /"article"/);
  assert.match(open, /target\.click\(\)/);
  assert.doesNotMatch(open, /发表|群发/);
  assert.doesNotMatch(article, /发表|群发/);
});

test("newspic normalization enforces the real 20-character title limit", () => {
  const payload = normalizeWechatWebDraft({
    draftType: "newspic",
    postPath: "D:\\成品库\\帖子",
    title: "江浙沪周边团建方案整理｜秋冬季8大热门团建地推荐",
    body: "正文",
    images: ["01.png"]
  });
  assert.equal(payload.titleChars, 20);
  assert.equal(payload.draftType, "newspic");
});
