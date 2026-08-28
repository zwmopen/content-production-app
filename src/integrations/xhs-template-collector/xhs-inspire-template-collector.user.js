// ==UserScript==
// @name         图文模板仓库｜小红书聚光卡片下载按钮
// @namespace    jianghu-template-repository
// @version      0.19.65
// @description  在小红书聚光创意灵感卡片右下角加入小型采集按钮，登记标题、笔记 ID、统计并交给本地模板仓库下载/去重队列。
// @match        https://ad.xiaohongshu.com/microapp/creativity/inspire*
// @connect      127.0.0.1
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const API = "http://127.0.0.1:4327/api/template-collector/queue";
  const BUTTON_CLASS = "jianghu-xhs-template-collector-button";
  const CARD_FLAG = "data-jianghu-template-collector-bound";
  const STYLE_ID = "jianghu-xhs-template-collector-style";
  const NOTE_ID_RE = /^[a-f0-9]{24}$/i;

  function textOf(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function parseMetric(value) {
    const text = textOf(value).replace(/,/g, "");
    const match = text.match(/\d+(?:\.\d+)?(?:万|k|K)?/);
    return match ? match[0] : "";
  }

  function parseNoteId(value) {
    try {
      const payload = typeof value === "string" ? JSON.parse(value) : value;
      const id = textOf(payload?.attributes?.triggerValue).toLowerCase();
      return NOTE_ID_RE.test(id) ? id : "";
    } catch {
      return "";
    }
  }

  function parseNoteIdFromHref(value) {
    const match = String(value || "").match(/\/explore\/([a-f0-9]{24})(?:[/?#]|$)/i);
    return match ? match[1].toLowerCase() : "";
  }

  function sourceUrlFromHref(value, noteId) {
    const raw = textOf(value);
    if (!raw) return "";
    try {
      const url = new URL(raw, "https://www.xiaohongshu.com/");
      const hostname = url.hostname.toLowerCase();
      const allowed = ["xhslink.cn", "www.xhslink.cn", "xhslink.com", "www.xhslink.com", "xiaohongshu.com", "www.xiaohongshu.com"];
      if (!allowed.includes(hostname) || parseNoteIdFromHref(url.href) !== textOf(noteId).toLowerCase()) return "";
      url.pathname = url.pathname.replace(/\/explore\/[a-f0-9]{24}/i, `/explore/${textOf(noteId).toLowerCase()}`);
      return url.href;
    } catch {
      return "";
    }
  }

  function firstText(card, selectors) {
    for (const selector of selectors) {
      const value = textOf(card.querySelector(selector)?.textContent);
      if (value) return value;
    }
    return "";
  }

  function extractCard(card) {
    const title = firstText(card, [".note-meta > span", ".note-meta span", "[data-note-title]", "h3", "h4"]);
    const noteId = [
      parseNoteId(card.getAttribute("data-track-impression")),
      textOf(card.getAttribute("data-note-id")),
      textOf(card.getAttribute("data-id")),
      ...[...card.querySelectorAll("a[href*='/explore/']")].map((node) => parseNoteIdFromHref(node.getAttribute("href")))
    ].find((value) => NOTE_ID_RE.test(value)) || "";
    const sourceUrl = [...card.querySelectorAll("a[href*='/explore/']")]
      .map((node) => sourceUrlFromHref(node.getAttribute("href"), noteId))
      .find(Boolean) || "";
    const tags = [...card.querySelectorAll(".note-meta .d-tag-content")]
      .map((node) => parseMetric(node.textContent));
    const imageCount = card.querySelectorAll(".note-image-item").length;
    if (!title || !noteId) return null;
    return {
      noteId,
      title: title.slice(0, 240),
      imageCount: Number(tags[0] || imageCount) || imageCount,
      stats: {
        imageCount: Number(tags[0] || imageCount) || imageCount,
        likes: tags[1] || "",
        collections: tags[2] || "",
        comments: tags[3] || ""
      },
      sourceUrl,
      sourcePageUrl: location.href
    };
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      section.note-card { position: relative !important; }
      .${BUTTON_CLASS} {
        position: absolute !important; right: 8px !important; bottom: 8px !important;
        z-index: 20 !important; width: 30px !important; height: 30px !important;
        padding: 0 !important; border: 1px solid rgba(255,255,255,.88) !important;
        border-radius: 50% !important; background: rgba(20, 25, 35, .86) !important;
        color: #fff !important; box-shadow: 0 3px 10px rgba(0,0,0,.22) !important;
        font: 700 16px/28px system-ui, sans-serif !important; text-align: center !important;
        cursor: pointer !important; opacity: .92 !important; transition: transform .15s ease, opacity .15s ease !important;
      }
      .${BUTTON_CLASS}:hover, .${BUTTON_CLASS}:focus-visible { opacity: 1 !important; transform: scale(1.08) !important; }
      .${BUTTON_CLASS}[data-state="busy"] { background: #2563eb !important; }
      .${BUTTON_CLASS}[data-state="done"] { background: #16845b !important; }
      .${BUTTON_CLASS}[data-state="exists"] { background: #64748b !important; }
      .${BUTTON_CLASS}[data-state="needs-source"], .${BUTTON_CLASS}[data-state="error"] { background: #b45309 !important; }
    `;
    document.head.appendChild(style);
  }

  function setButtonState(button, state, label, title) {
    button.dataset.state = state;
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
  }

  async function queueCard(button, card) {
    const record = extractCard(card);
    if (!record) {
      setButtonState(button, "error", "!", "未能读取这张卡片的笔记 ID");
      return;
    }
    if (button.dataset.state === "busy") return;
    setButtonState(button, "busy", "…", "正在登记并启动本地下载");
    button.disabled = true;
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `本地工作台返回 ${response.status}`);
      if (payload.status === "needs_source_link" || payload.record?.status === "needs_source_link") {
        setButtonState(button, "needs-source", "!", "已登记，但聚光卡片没有暴露真实短链；请补充真实小红书链接后再下载");
      } else if (payload.status === "already_registered" || payload.status === "downloaded" || payload.status === "candidate_ready") {
        setButtonState(button, "exists", "✓", `已登记：${payload.record?.statusLabel || "不会重复下载"}`);
      } else {
        setButtonState(button, "done", "✓", "已加入本地模板仓库下载队列");
      }
      button.dataset.noteId = record.noteId;
    } catch (error) {
      setButtonState(button, "error", "×", `采集失败：${textOf(error.message).slice(0, 120)}`);
    } finally {
      button.disabled = false;
    }
  }

  function bindCard(card) {
    if (!(card instanceof HTMLElement) || card.getAttribute(CARD_FLAG) === "1") return;
    const record = extractCard(card);
    if (!record) return;
    card.setAttribute(CARD_FLAG, "1");
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.dataset.state = "idle";
    button.textContent = "↓";
    button.title = "采集到本地模板仓库（不打开笔记）";
    button.setAttribute("aria-label", "采集到本地模板仓库");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      queueCard(button, card);
    }, true);
    card.appendChild(button);
  }

  function scan() {
    installStyle();
    const cards = new Set(document.querySelectorAll("section.note-card, [data-track-impression], [data-note-id]"));
    cards.forEach(bindCard);
  }

  function start() {
    scan();
    const observer = new MutationObserver(() => scan());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
