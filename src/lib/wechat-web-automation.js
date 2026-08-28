"use strict";

const path = require("node:path");

const WECHAT_HOME_URL = "https://mp.weixin.qq.com/";
const MAX_WECHAT_IMAGES = 10;

function visibleCharacterCount(value = "") {
  return Array.from(String(value || "")).filter((char) => !/\s/u.test(char)).length;
}

function classifyWechatWebPage(input = {}) {
  const url = String(input.url || "");
  const text = String(input.text || "");
  const readyState = String(input.readyState || "");
  const result = {
    stage: "unknown",
    canOpenEditor: false,
    canFill: false,
    canSave: false,
    authenticated: Boolean(input.authenticated),
    uploadedImageCount: Math.max(0, Number(input.uploadedImageCount || 0)),
    error: String(input.error || "")
  };

  if (result.error) return { ...result, stage: "failed" };
  if (input.saving) return { ...result, stage: "saving" };
  if (input.saveSucceeded || /(?:已保存到草稿箱|保存成功|草稿已保存)/u.test(text)) {
    return { ...result, stage: "saved", authenticated: true };
  }
  if (input.authenticationRequired
    || /微信扫一扫[^\n]{0,30}(?:公众平台账号)?登录|使用账号登录/u.test(text)
    || (/^https:\/\/mp\.weixin\.qq\.com\/?(?:\?.*)?$/iu.test(url) && !input.authenticated)) {
    return { ...result, stage: "login-required" };
  }
  if (input.uploading) return { ...result, stage: "uploading-images", authenticated: true };

  const completeEditor = Boolean(
    input.hasTitleInput
    && input.hasBodyEditor
    && input.hasImageInput
    && input.hasSaveButton
  );
  if (completeEditor) {
    return {
      ...result,
      stage: "editor-ready",
      authenticated: true,
      canFill: true,
      canSave: true
    };
  }
  if (!['interactive', 'complete'].includes(readyState)) {
    return { ...result, stage: "loading" };
  }
  if (/\/cgi-bin\/(?:appmsg|operate_appmsg)/iu.test(url)) {
    return { ...result, stage: "editor-incomplete", authenticated: true };
  }
  if (input.authenticated || /\/cgi-bin\//iu.test(url) || /新的创作|草稿箱/u.test(text)) {
    return { ...result, stage: "dashboard-ready", authenticated: true, canOpenEditor: true };
  }
  return result;
}

function normalizeWechatWebDraft(input = {}) {
  const postPath = path.win32.resolve(String(input.postPath || "."));
  const draftType = input.draftType === "article" ? "article" : "newspic";
  let title = String(input.title || "")
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0E\uFE0F\u20E3]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (draftType === "newspic" && visibleCharacterCount(title) > 20) {
    title = Array.from(title).filter((char) => !/\s/u.test(char)).slice(0, 20).join("");
  }
  const body = String(input.body || "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  const sourceImages = Array.isArray(input.imagePaths)
    ? input.imagePaths
    : Array.isArray(input.images) ? input.images : [];
  const images = sourceImages
    .map((image) => String(image || "").trim())
    .filter(Boolean)
    .map((image) => path.win32.isAbsolute(image) ? path.win32.normalize(image) : path.win32.join(postPath, image))
    .slice(0, MAX_WECHAT_IMAGES);
  if (!title) throw new Error("公众号草稿标题不能为空");
  if (!body) throw new Error("公众号草稿正文不能为空");
  if (!images.length) throw new Error("公众号草稿至少需要 1 张图片");
  return {
    postPath,
    draftType,
    title,
    body,
    images,
    expectedImageCount: images.length,
    titleChars: visibleCharacterCount(title),
    bodyChars: visibleCharacterCount(body)
  };
}

function buildWechatWebProbeScript() {
  return `(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const firstVisible = (selectors, root = document) => selectors
      .map((selector) => root.querySelector(selector))
      .find(isVisible) || null;
    const query = new URLSearchParams(location.search);
    const draftType = query.get("createType") === "8" ? "newspic" : "article";
    const titleInput = firstVisible([
      "#title", "input[name='title']", "textarea[name='title']",
      "input[placeholder*='标题']", "textarea[placeholder*='标题']",
      "[contenteditable='true'][data-placeholder*='标题']"
    ]);
    let bodyEditor = firstVisible([
      ".ProseMirror[contenteditable='true']:not([data-placeholder*='标题'])", "[contenteditable='true'][data-placeholder*='正文']",
      ".edui-body-container[contenteditable='true']", "#js_editor [contenteditable='true']",
      "[role='textbox'][contenteditable='true']"
    ]);
    let editorFrame = null;
    if (!bodyEditor) {
      editorFrame = [...document.querySelectorAll("iframe")].find((frame) => {
        try { return isVisible(frame) && Boolean(frame.contentDocument?.body); } catch { return false; }
      }) || null;
      try { bodyEditor = editorFrame?.contentDocument?.body || null; } catch {}
    }
    const imageInputs = [...document.querySelectorAll("input[type='file']")]
      .filter((element) => /image|jpg|jpeg|png|gif|webp/iu.test(element.accept || "") || element.multiple);
    for (const element of imageInputs) element.removeAttribute("data-tb-wechat-image-input");
    const imageInput = draftType === "newspic"
      // 贴图页上传首张后会保留旧 WebUploader input，并在 DOM 末尾新建
      // 下一张的 input。始终选择最后一个贴图上传器，避免继续写入失效控件。
      ? [...imageInputs].reverse().find((element) => element.closest(".js_upload_btn_container, .weui-desktop-upload-input__wrp")) || null
      : imageInputs.find((element) => element.name === "file" || element.closest("#js_editor_insertimage")) || imageInputs[0] || null;
    if (imageInput) imageInput.setAttribute("data-tb-wechat-image-input", "ready");
    const controls = [...document.querySelectorAll("button, a, [role='button']")].filter(isVisible);
    const saveButton = controls.find((element) => /^(?:保存为草稿|保存草稿|保存)$/u.test((element.innerText || element.textContent || "").trim())) || null;
    const pageText = (document.body?.innerText || "").slice(0, 30000);
    const uploading = [...document.querySelectorAll("[class*='loading'], [class*='upload']")]
      .some((element) => isVisible(element) && /上传中|正在上传|loading/iu.test(element.innerText || element.className || ""));
    const visibleImageCount = new Set([...document.querySelectorAll("img")]
      .filter((image) => isVisible(image) && /blob:|mmbiz|wx_fmt|temp/iu.test(image.currentSrc || image.src || ""))
      .map((image) => image.currentSrc || image.src)).size;
    const newspicCounter = document.querySelector(".image-selector__preview-center-tips-area__num");
    const newspicCounts = newspicCounter
      ? [...newspicCounter.querySelectorAll("span")]
        .map((element) => Number((element.textContent || "").trim()))
        .filter(Number.isFinite)
      : [];
    // 贴图轮播一次只渲染当前图片，不能用可见 img 数量判断总数。
    // 右下角原生计数器显示“当前张 / 总张数”，取最大值即已上传总数。
    const uploadedImageCount = draftType === "newspic" && newspicCounts.length
      ? Math.max(...newspicCounts)
      : visibleImageCount;
    const saveSucceeded = /已保存到草稿箱|保存成功|草稿已保存/u.test(pageText)
      || (Boolean(query.get("appmsgid")) && query.get("isNew") !== "1");
    const validationError = [...document.querySelectorAll(".weui-desktop-dialog, .weui-desktop-toast, [role='dialog']")]
      .filter(isVisible)
      .map((element) => (element.innerText || element.textContent || "").trim())
      .find((message) => /标题[^\\n]{0,20}(?:不能|特殊字符)|(?:请选择|需要)[^\\n]{0,20}封面|保存失败|正文[^\\n]{0,20}不能为空/u.test(message)) || "";
    const loginRequired = /微信扫一扫[^\\n]{0,30}(?:公众平台账号)?登录|使用账号登录/u.test(pageText);
    return {
      url: location.href,
      draftType,
      readyState: document.readyState,
      text: pageText,
      authenticated: /\\/cgi-bin\\//u.test(location.pathname) && !loginRequired,
      authenticationRequired: loginRequired,
      hasTitleInput: Boolean(titleInput),
      hasBodyEditor: Boolean(bodyEditor),
      hasImageInput: Boolean(imageInput),
      hasSaveButton: Boolean(saveButton),
      uploading,
      uploadedImageCount,
      saveSucceeded,
      error: validationError,
      selectors: {
        imageInput: imageInput ? "[data-tb-wechat-image-input='ready']" : ""
      }
    };
  })()`;
}

function buildWechatWebFillScript(input = {}) {
  const title = String(input.title || "");
  const body = String(input.body || "");
  const draftType = input.draftType === "article" ? "article" : "newspic";
  return `(() => {
    const title = ${JSON.stringify(title)};
    const body = ${JSON.stringify(body)};
    const draftType = ${JSON.stringify(draftType)};
    const isVisible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const firstVisible = (selectors, root = document) => selectors
      .map((selector) => root.querySelector(selector))
      .find(isVisible) || null;
    const setTextControl = (element, value) => {
      if (!element) return false;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, value); else element.value = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };
    const setEditable = (element, value) => {
      if (!element) return false;
      element.focus();
      element.textContent = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };
    const setBodyEditable = (element, value) => {
      if (!element) return { ok: false, paragraphCount: 0 };
      element.focus();
      element.replaceChildren();
      const lines = value.split("\\n");
      for (const line of lines) {
        const paragraph = document.createElement("p");
        if (line) paragraph.textContent = line;
        else paragraph.appendChild(document.createElement("br"));
        element.appendChild(paragraph);
      }
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, paragraphCount: lines.length };
    };
    const titleInput = firstVisible([
      "#title", "input[name='title']", "textarea[name='title']",
      "input[placeholder*='标题']", "textarea[placeholder*='标题']",
      "[contenteditable='true'][data-placeholder*='标题']"
    ]);
    let titleFilled = false;
    if (titleInput?.matches("input, textarea")) titleFilled = setTextControl(titleInput, title);
    else titleFilled = setEditable(titleInput, title);
    let bodyEditor = firstVisible([
      ".ProseMirror[contenteditable='true']:not([data-placeholder*='标题'])", "[contenteditable='true'][data-placeholder*='正文']",
      ".edui-body-container[contenteditable='true']", "#js_editor [contenteditable='true']",
      "[role='textbox'][contenteditable='true']"
    ]);
    if (!bodyEditor) {
      const editorFrame = [...document.querySelectorAll("iframe")].find((frame) => {
        try { return isVisible(frame) && Boolean(frame.contentDocument?.body); } catch { return false; }
      });
      try { bodyEditor = editorFrame?.contentDocument?.body || null; } catch {}
    }
    // 贴图描述是公众号自己的纯文本 ProseMirror schema，不接受文章段落节点；
    // 直接写入原始换行后由平台按其原生规则规范化。文章正文才创建段落。
    const bodyResult = draftType === "newspic"
      ? { ok: setEditable(bodyEditor, body), paragraphCount: body ? 1 : 0, format: "newspic-description" }
      : { ...setBodyEditable(bodyEditor, body), format: "article-paragraphs" };
    return {
      ok: titleFilled && bodyResult.ok,
      titleFilled,
      bodyFilled: bodyResult.ok,
      bodyParagraphCount: bodyResult.paragraphCount,
      bodyFormat: bodyResult.format
    };
  })()`;
}

function buildWechatWebMoveCaretScript() {
  return `(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const bodyEditor = [
      ".ProseMirror[contenteditable='true']:not([data-placeholder*='标题'])",
      "[contenteditable='true'][data-placeholder*='正文']",
      ".edui-body-container[contenteditable='true']",
      "#js_editor [contenteditable='true']",
      "[role='textbox'][contenteditable='true']"
    ].map((selector) => document.querySelector(selector)).find(isVisible) || null;
    if (!bodyEditor) return { ok: false, error: "没有找到公众号正文编辑器" };
    bodyEditor.focus();
    const range = document.createRange();
    range.selectNodeContents(bodyEditor);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return { ok: true, action: "caret-to-body-end" };
  })()`;
}

function buildWechatWebSaveScript() {
  return `(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const uploading = [...document.querySelectorAll("[class*='loading'], [class*='upload']")]
      .some((element) => isVisible(element) && /上传中|正在上传|loading/iu.test(element.innerText || element.className || ""));
    if (uploading) return { ok: false, uploading: true, error: "图片仍在上传，暂不保存" };
    const saveButton = [...document.querySelectorAll("button, a, [role='button']")]
      .filter(isVisible)
      .find((element) => /^(?:保存为草稿|保存草稿|保存)$/u.test((element.innerText || element.textContent || "").trim()));
    if (!saveButton) return { ok: false, uploading: false, error: "没有找到保存草稿按钮" };
    saveButton.click();
    return { ok: true, uploading: false, action: "save-draft" };
  })()`;
}

function buildWechatWebOpenEditorScript(draftType = "newspic") {
  const normalizedType = draftType === "article" ? "article" : "newspic";
  return `(() => {
    const isVisible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const draftType = ${JSON.stringify(normalizedType)};
    const allowedLabels = draftType === "newspic"
      ? ["贴图"]
      : ["文章", "写新图文", "新建图文", "图文消息", "图文"];
    const candidates = [...document.querySelectorAll(".new-creation__menu-item, button, a, [role='button'], [role='menuitem']")].filter(isVisible);
    const target = allowedLabels
      .map((label) => candidates.find((element) => (element.innerText || element.textContent || "").trim() === label))
      .find(Boolean);
    if (!target) return { ok: false, error: draftType === "newspic" ? "没有找到贴图入口" : "没有找到文章入口" };
    const label = (target.innerText || target.textContent || "").trim();
    target.click();
    return { ok: true, action: "open-editor", draftType, label };
  })()`;
}

module.exports = {
  WECHAT_HOME_URL,
  MAX_WECHAT_IMAGES,
  classifyWechatWebPage,
  normalizeWechatWebDraft,
  buildWechatWebProbeScript,
  buildWechatWebFillScript,
  buildWechatWebMoveCaretScript,
  buildWechatWebSaveScript,
  buildWechatWebOpenEditorScript
};
