// ==UserScript==
// @name         ChatGPT 最近对话分组（飞书式目录）
// @namespace    https://chatgpt.com/
// @version      1.12.5
// @description  把可拖动、可嵌套的对话分组原生融入 ChatGPT"最近"列表，并给图片组增加外置下载全部快捷按钮，支持一键下载本轮所有图片。
// @author       Codex
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/zwmopen/scripts/master/chatgpt-conversation-tree.user.js
// @downloadURL  https://raw.githubusercontent.com/zwmopen/scripts/master/chatgpt-conversation-tree.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_download
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// ==/UserScript==

(() => {
  'use strict';

  const APP_ID = 'cgpt-conversation-tree';
  const SCRIPT_VERSION = '1.12.5';
  const HEADER_ID = `${APP_ID}-header-actions`;
  const MENU_ID = `${APP_ID}-menu`;
  const STYLE_ID = `${APP_ID}-style`;
  const PARKING_ID = `${APP_ID}-parking`;
  const RENAME_ID = `${APP_ID}-batch-rename`;
  const RENAME_STAGE_ID = `${APP_ID}-rename-stage`;
  const IMPORT_INPUT_ID = `${APP_ID}-import-input`;
  const PROMPT_BUTTON_ID = `${APP_ID}-prompt-button`;
  const PROMPT_PANEL_ID = `${APP_ID}-prompt-panel`;
  const PAGE_OPEN_EVENT = `${APP_ID}:page-open-chat`;
  const IMAGE_DOWNLOAD_CLASS = `${APP_ID}-image-download-all`;
  const IMAGE_DOWNLOAD_SLOT_CLASS = `${APP_ID}-image-download-slot`;
  const TEXT_DOWNLOAD_CLASS = `${APP_ID}-text-download`;
  const TEXT_COPY_CLASS = `${APP_ID}-text-copy`;
  const TEXT_DOWNLOAD_SLOT_CLASS = `${APP_ID}-text-download-slot`;
  const WORK_PACKAGE_CLASS = `${APP_ID}-work-package`;
  const IMAGE_DOWNLOAD_TOAST_ID = `${APP_ID}-image-download-toast`;
  const IMAGE_DOWNLOAD_HISTORY_KEY = `${APP_ID}:image-download-history:v1`;
  const IMAGE_DOWNLOAD_HISTORY_LIMIT = 240;
  const WORK_PACKAGE_PROTOCOL_URL = 'cgpt-workpkg://run';
  const WORK_PACKAGE_TITLE_MARKER = 'WORKPKG_GPT_TITLE_B64:';
  const WORK_PACKAGE_METADATA_MARKER = 'WORKPKG_GPT_META_B64:';
  // v1 曾被多个同名/改名后的脚本版本同时读写。1.0 起改用独立存储区，
  // 旧脚本即使仍在运行，也不能再覆盖新版数据。
  const STORAGE_KEY = `${APP_ID}:state:v3`;
  const LEGACY_STORAGE_KEY = `${APP_ID}:state:v1`;
  const BACKUP_PREFIX = `${APP_ID}:backup:`;
  const MAX_BACKUPS = 8;
  const GM_STATE_KEY = 'state-v3';
  const GM_BACKUP_PREFIX = 'backup:';
  const UNGROUPED_COLLAPSED_KEY = 'ungrouped-collapsed';
  const PROMPT_STORAGE_KEY = `${APP_ID}:prompts:v1`;
  const GM_PROMPT_KEY = 'prompts-v1';
  const CLOUD_PROMPT_URL = 'https://raw.githubusercontent.com/zwmopen/scripts/master/chatgpt-cloud-prompts.json';
  const CLOUD_PROMPT_CACHE_KEY = 'cloud-prompts-cache-v1';
  const CLOUD_PROMPT_CACHE_STORAGE_KEY = `${APP_ID}:cloud-prompts-cache:v1`;
  const CLOUD_PROMPT_BACKUPS_KEY = 'cloud-prompts-backups-v1';
  const CLOUD_PROMPT_LAST_ATTEMPT_KEY = 'cloud-prompts-last-attempt-v1';
  const CLOUD_PROMPT_BACKUPS_STORAGE_KEY = `${APP_ID}:cloud-prompts-backups:v1`;
  const CLOUD_PROMPT_AUTO_SYNC_INTERVAL = 24 * 60 * 60 * 1000;
  const MAX_CLOUD_PROMPT_BACKUPS = 5;
  const MAX_CLOUD_PROMPT_RESPONSE_BYTES = 2 * 1024 * 1024;
  const DIAGNOSTIC_LOG_KEY = `${APP_ID}:diagnostic-log:v1`;
  const MAX_DIAGNOSTIC_LOGS = 220;
  const WORK_PACKAGE_VISIBLE_KEY = 'work-package-visible';
  const HARD_NAVIGATION_FALLBACK_KEY = 'hard-navigation-fallback-enabled';
  const DRAG_MIME = `application/x-${APP_ID}`;
  // ChatGPT 会频繁替换左侧历史列表。搬动其原生 React 节点会导致会话点击卡住，
  // 因此扩展版只保留下载、提示词和工作包能力，原生左侧会话由 ChatGPT 自己管理。
  const ENABLE_CONVERSATION_TREE = false;

  function promptLibraryEnabled() {
    return localStorage.getItem('tb-workbench-prompt-library-enabled') !== '0';
  }

  function messageDownloadToolsEnabled() {
    return localStorage.getItem('tb-workbench-message-downloads-enabled') !== '0';
  }

  const icons = {
    chevron: (open) => open
      ? '<svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>'
      : '<svg viewBox="0 0 16 16"><path d="m6 4 4 4-4 4"/></svg>',
    folder: '<svg viewBox="0 0 18 18"><path d="M2.5 5.2h5l1.5 1.6h6.5v7.4H2.5z"/><path d="M2.5 5.2V3.8h4.2l1.4 1.4"/></svg>',
    plus: '<svg viewBox="0 0 18 18"><path d="M9 3v12M3 9h12"/></svg>',
    fold: '<svg viewBox="0 0 18 18"><path d="m4 7 5-4 5 4M4 11l5 4 5-4"/></svg>',
    dots: '<svg viewBox="0 0 18 18"><circle cx="4" cy="9" r="1"/><circle cx="9" cy="9" r="1"/><circle cx="14" cy="9" r="1"/></svg>',
    chat: '<svg viewBox="0 0 18 18"><path d="M3 3.5h12v8.8H8l-3.6 2.2.8-2.2H3z"/></svg>',
    move: '<svg viewBox="0 0 18 18"><path d="M3 5.2h5l1.4 1.5H15v7.1H3z"/><path d="m8 10 2-2 2 2M10 8v4"/></svg>',
    out: '<svg viewBox="0 0 18 18"><path d="M3 4.5h7v9H3z"/><path d="M8 9h7m-2-2 2 2-2 2"/></svg>',
    batch: '<svg viewBox="0 0 18 18"><path d="M7 4h8M7 9h8M7 14h8"/><path d="m2.5 4 1 1 2-2M2.5 9l1 1 2-2M2.5 14l1 1 2-2"/></svg>',
    pencil: '<svg viewBox="0 0 18 18"><path d="m4 13 1-4 7-7 3 3-7 7z"/><path d="m10.5 3.5 3 3M4 13l3.7-.8"/></svg>',
    download: '<svg viewBox="0 0 18 18"><path d="M9 3v8"/><path d="m5.5 8 3.5 3.5L12.5 8"/><path d="M4 14.5h10"/></svg>',
    package: '<svg viewBox="0 0 18 18"><path d="M3 6.2 9 3l6 3.2v6.4L9 16l-6-3.4z"/><path d="M3 6.2 9 9.4l6-3.2M9 9.4V16"/><path d="M7.2 5.1 13 8.2"/><path d="M5.2 11.1h3.1M6.8 9.5l1.6 1.6-1.6 1.6"/></svg>',
  };

  const defaultState = () => ({
    version: 3,
    tree: [],
    known: {},
    updatedAt: 0,
  });

  // 必须在 loadState() 前初始化；1.1.0 的顺序错误会让刷新时读取失败并回落为空数据。
  let lastSavedTree = '';
  let lastLegacySnapshot = '';
  let state = loadState();
  let historyRoot = null;
  let nativeList = null;
  let recentHeader = null;
  let host = null;
  let parkingLot = null;
  let headerActions = null;
  let nativeRows = new Map();
  let activeDrag = null;
  let lastActiveChatId = '';
  let scanTimer = 0;
  let saveTimer = 0;
  let renderTimer = 0;
  let promptButtonTimer = 0;
  let rendering = false;
  let ignoreMutationsUntil = 0;
  let eventsBound = false;
  let pendingNativeMenuChatId = '';
  let pendingNativeMenuAnchor = null;
  let pendingNativeMenuUntil = 0;
  let nativeMenuAugmented = false;
  let sortPendingOnLoad = true;
  let batchSelectedChatIds = [];
  let renameRun = null;
  let pendingImportMode = 'merge';
  let promptState = loadPromptState();
  let cloudPromptState = loadCloudPromptState();
  let cloudPromptSyncing = false;
  let cloudPromptSyncPromise = null;
  let editingPromptId = '';
  let promptHelpVisible = false;
  let pendingRecentMenuUntil = 0;
  let recentMenuAugmented = false;
  let imageToolsTimer = 0;
  let imageEventsBound = false;
  let userscriptMenuCommandIds = [];
  let preloadHistoryRun = null;
  let openChatRunning = false;
  let queuedOpenChat = null;
  let openChatRequestSeq = 0;
  let diagnosticLogs = loadDiagnosticLogs();
  let hardNavigationFallbackEnabled = loadHardNavigationFallbackSetting();
  let diagnosticSaveTimer = 0;
  let workPackageButtonVisible = (() => {
    try {
      return GM_getValue(WORK_PACKAGE_VISIBLE_KEY, true) !== false;
    } catch {
      return true;
    }
  })();
  let ungroupedCollapsed = (() => {
    try {
      return Boolean(GM_getValue(UNGROUPED_COLLAPSED_KEY, false));
    } catch {
      return false;
    }
  })();

  function loadHardNavigationFallbackSetting() {
    try {
      return GM_getValue(HARD_NAVIGATION_FALLBACK_KEY, false) === true;
    } catch {
      return false;
    }
  }

  function setHardNavigationFallbackEnabled(enabled) {
    hardNavigationFallbackEnabled = Boolean(enabled);
    try { GM_setValue(HARD_NAVIGATION_FALLBACK_KEY, hardNavigationFallbackEnabled); } catch {}
    showImageDownloadToast(
      hardNavigationFallbackEnabled
        ? '已允许失败时整页跳转'
        : '已关闭整页跳转，优先保持原生无刷新切换',
      true
    );
    registerUserscriptMenuCommands();
  }

  function loadState() {
    const modernSources = [];
    try {
      modernSources.push(GM_getValue(GM_STATE_KEY, null));
    } catch {
      // 兼容不支持 GM 存储的脚本管理器。
    }
    try {
      modernSources.push(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
    } catch {
      modernSources.push(null);
    }

    const validModern = modernSources.filter((candidate) => (
      candidate && Array.isArray(candidate.tree)
    ));
    const nonEmptyModern = validModern.filter((candidate) => {
      const counts = countStateItems(candidate);
      return counts.folders > 0 || counts.chats > 0;
    });

    let legacy = null;
    try {
      legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || 'null');
    } catch {
      legacy = null;
    }

    let candidates = nonEmptyModern.length ? nonEmptyModern : validModern;
    if (!nonEmptyModern.length && legacy && Array.isArray(legacy.tree)) {
      candidates = [...candidates, legacy];
    }

    if (!candidates.some((candidate) => {
      const counts = countStateItems(candidate);
      return counts.folders > 0 || counts.chats > 0;
    })) {
      const backupCandidates = [];
      localStorageKeys()
        .filter((key) => key.startsWith(BACKUP_PREFIX))
        .forEach((key) => {
          try {
            const item = JSON.parse(localStorage.getItem(key) || 'null');
            if (item?.state && Array.isArray(item.state.tree)) backupCandidates.push(item.state);
          } catch {
            // 忽略损坏快照。
          }
        });
      try {
        GM_listValues()
          .filter((key) => key.startsWith(GM_BACKUP_PREFIX))
          .forEach((key) => {
            const item = GM_getValue(key, null);
            if (item?.state && Array.isArray(item.state.tree)) backupCandidates.push(item.state);
          });
      } catch {
        // localStorage 快照仍然可用。
      }
      candidates.push(...backupCandidates);
    }

    const parsed = candidates
      .filter((candidate) => candidate && Array.isArray(candidate.tree))
      .sort((a, b) => {
        const timeDifference = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
        if (timeDifference) return timeDifference;
        const ac = countStateItems(a);
        const bc = countStateItems(b);
        return (bc.chats - ac.chats)
          || (bc.folders - ac.folders)
          || (Object.keys(b.known || {}).length - Object.keys(a.known || {}).length);
      })[0];
    if (!parsed) return defaultState();
    lastSavedTree = JSON.stringify(parsed.tree);
    return {
      ...defaultState(),
      ...parsed,
      version: 3,
      known: parsed.known && typeof parsed.known === 'object' ? parsed.known : {},
    };
  }

  function countStateItems(candidate) {
    let folders = 0;
    let chats = 0;
    const walk = (nodes) => (Array.isArray(nodes) ? nodes : []).forEach((node) => {
      if (node?.type === 'folder') {
        folders += 1;
        walk(node.children);
      } else if (node?.type === 'chat' && node.chatId) {
        chats += 1;
      }
    });
    walk(candidate?.tree);
    return { folders, chats };
  }

  function localStorageKeys() {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) keys.push(key);
    }
    return keys;
  }

  function trimBackups() {
    const keys = localStorageKeys()
      .filter((key) => key.startsWith(BACKUP_PREFIX))
      .sort()
      .reverse();
    keys.slice(MAX_BACKUPS).forEach((key) => localStorage.removeItem(key));
    try {
      const gmKeys = GM_listValues()
        .filter((key) => key.startsWith(GM_BACKUP_PREFIX))
        .sort()
        .reverse();
      gmKeys.slice(MAX_BACKUPS).forEach((key) => GM_deleteValue(key));
    } catch {
      // localStorage 备份仍然可用。
    }
  }

  function storeBackup(candidate, reason = '自动备份') {
    if (!candidate || !Array.isArray(candidate.tree)) return '';
    const treeText = JSON.stringify(candidate.tree);
    if (!treeText || treeText === '[]') return '';
    const stamp = new Date().toISOString();
    const key = `${BACKUP_PREFIX}${stamp}`;
    const counts = countStateItems(candidate);
    const payload = {
      savedAt: stamp,
      reason,
      counts,
      state: candidate,
    };
    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // 备份不能阻断主数据保存；空间不足时交给 GM 存储接管。
    }
    try {
      GM_setValue(`${GM_BACKUP_PREFIX}${stamp}`, payload);
    } catch {
      // localStorage 备份仍然可用。
    }
    trimBackups();
    return key;
  }

  function parseStateValue(raw) {
    try {
      const parsed = JSON.parse(raw || 'null');
      return parsed && Array.isArray(parsed.tree) ? parsed : null;
    } catch {
      return null;
    }
  }

  function captureLegacyCandidate() {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY) || '';
    if (!raw || raw === lastLegacySnapshot) return;
    lastLegacySnapshot = raw;
    const legacy = parseStateValue(raw);
    if (!legacy) return;
    const legacyTree = JSON.stringify(legacy.tree);
    const currentTree = JSON.stringify(state.tree);
    if (legacyTree === currentTree || legacyTree === '[]') return;
    storeBackup(legacy, '从仍在运行的旧版脚本捕获');
  }

  function syncLegacyChanges() {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY) || '';
    if (!raw || raw === lastLegacySnapshot) return;
    const legacy = parseStateValue(raw);
    lastLegacySnapshot = raw;
    if (!legacy) return;
    const legacyCounts = countStateItems(legacy);
    if (!legacyCounts.folders && !legacyCounts.chats) return;
    if (JSON.stringify(legacy.tree) === JSON.stringify(state.tree)) return;
    // 旧脚本可能携带过期状态，只捕获为恢复快照，不再自动覆盖当前树。
    storeBackup(legacy, '捕获旧版脚本的分组副本');
  }

  function strongestPersistedState() {
    const candidates = [];
    try {
      candidates.push(GM_getValue(GM_STATE_KEY, null));
    } catch {
      // 继续读取网页存储。
    }
    for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
      try {
        candidates.push(JSON.parse(localStorage.getItem(key) || 'null'));
      } catch {
        // 忽略单个损坏副本。
      }
    }
    return candidates
      .filter((candidate) => candidate && Array.isArray(candidate.tree))
      .filter((candidate) => {
        const counts = countStateItems(candidate);
        return counts.folders > 0 || counts.chats > 0;
      })
      .sort((a, b) => {
        const timeDifference = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
        if (timeDifference) return timeDifference;
        const ac = countStateItems(a);
        const bc = countStateItems(b);
        return (bc.chats - ac.chats) || (bc.folders - ac.folders);
      })[0] || null;
  }

  function saveState(immediate = false, allowEmpty = false) {
    clearTimeout(saveTimer);
    const save = () => {
      try {
        const nextTree = JSON.stringify(state.tree);
        const nextCounts = countStateItems(state);
        const persisted = strongestPersistedState();
        if (
          persisted
          && !allowEmpty
          && nextCounts.folders === 0
          && nextCounts.chats === 0
          && JSON.stringify(persisted.tree) !== '[]'
        ) {
          console.warn('[ChatGPT 最近对话分组] 已阻止空数据覆盖，并恢复本地有效分组。');
          state = {
            ...defaultState(),
            ...persisted,
            version: 3,
            known: persisted.known && typeof persisted.known === 'object'
              ? persisted.known
              : {},
          };
          lastSavedTree = JSON.stringify(state.tree);
          queueRender();
          return;
        }
        const previous = parseStateValue(localStorage.getItem(STORAGE_KEY));
        if (
          previous
          && lastSavedTree
          && lastSavedTree !== nextTree
          && JSON.stringify(previous.tree) !== nextTree
        ) {
          storeBackup(previous, '分组结构修改前');
        }
        state.version = 3;
        state.updatedAt = Date.now();
        try {
          GM_setValue(GM_STATE_KEY, state);
        } catch {
          // localStorage 主存储仍然可用。
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        // 给最初的 0.1 版保留 version:1 镜像，避免旧脚本把数据判为空。
        const legacyMirror = { ...state, version: 1 };
        const legacyRaw = JSON.stringify(legacyMirror);
        localStorage.setItem(LEGACY_STORAGE_KEY, legacyRaw);
        lastLegacySnapshot = legacyRaw;
        lastSavedTree = nextTree;
      } catch (error) {
        console.warn('[ChatGPT 最近对话分组] 保存失败：', error);
      }
    };
    if (immediate) save();
    else saveTimer = window.setTimeout(save, 100);
  }

  function defaultPromptState() {
    return {
      version: 1,
      items: [],
      updatedAt: 0,
    };
  }

  function normalizePromptItem(item) {
    const title = compactTitle(item?.title || '');
    const content = String(item?.content || '').trim();
    if (!title && !content) return null;
    const now = Date.now();
    return {
      id: String(item?.id || uid('prompt')),
      title: title || compactTitle(content).slice(0, 28) || '未命名提示词',
      content,
      createdAt: Number(item?.createdAt || now),
      updatedAt: Number(item?.updatedAt || now),
    };
  }

  function loadPromptState() {
    const sources = [];
    try {
      sources.push(GM_getValue(GM_PROMPT_KEY, null));
    } catch {
      // keep fallback
    }
    try {
      sources.push(JSON.parse(localStorage.getItem(PROMPT_STORAGE_KEY) || 'null'));
    } catch {
      sources.push(null);
    }
    const source = sources
      .filter((candidate) => candidate && Array.isArray(candidate.items))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0];
    if (!source) return defaultPromptState();
    const items = source.items
      .map((item) => normalizePromptItem(item))
      .filter(Boolean)
      .slice(0, 300);
    return {
      version: 1,
      items,
      updatedAt: Number(source.updatedAt || 0),
    };
  }

  function savePromptState() {
    promptState.updatedAt = Date.now();
    const payload = {
      version: 1,
      items: promptState.items.map((item) => ({ ...item })),
      updatedAt: promptState.updatedAt,
    };
    try {
      GM_setValue(GM_PROMPT_KEY, payload);
    } catch {
      // localStorage fallback
    }
    try {
      localStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('[ChatGPT 辅助器] 提示词保存失败：', error);
    }
  }

  function defaultCloudPromptState() {
    return {
      schemaVersion: 1,
      version: '',
      items: [],
      updatedAt: 0,
      syncedAt: 0,
    };
  }

  function promptTimestamp(value, fallback = Date.now()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeCloudPromptItem(item, index = 0) {
    const title = compactTitle(item?.title || '').slice(0, 160);
    const content = String(item?.content || '').trim().slice(0, 50000);
    if (!title && !content) return null;
    const sourceId = String(
      item?.sourceId || String(item?.id || `item-${index + 1}`).replace(/^cloud:/, '')
    ).slice(0, 240);
    const updatedAt = promptTimestamp(item?.updatedAt, Date.now());
    return {
      id: `cloud:${sourceId}`,
      sourceId,
      source: 'cloud',
      title: title || compactTitle(content).slice(0, 28) || '未命名云端提示词',
      content,
      createdAt: promptTimestamp(item?.createdAt, updatedAt),
      updatedAt,
    };
  }

  function normalizeCloudPromptState(source) {
    if (!source || typeof source !== 'object') return defaultCloudPromptState();
    const rawItems = Array.isArray(source.prompts) ? source.prompts : source.items;
    if (!Array.isArray(rawItems)) return defaultCloudPromptState();
    return {
      schemaVersion: 1,
      version: String(source.version || ''),
      items: rawItems
        .slice(0, 500)
        .map((item, index) => normalizeCloudPromptItem(item, index))
        .filter(Boolean),
      updatedAt: promptTimestamp(source.updatedAt, 0),
      syncedAt: promptTimestamp(source.syncedAt, 0),
    };
  }

  function loadCloudPromptState() {
    const sources = [];
    try {
      sources.push(GM_getValue(CLOUD_PROMPT_CACHE_KEY, null));
    } catch {}
    try {
      sources.push(JSON.parse(localStorage.getItem(CLOUD_PROMPT_CACHE_STORAGE_KEY) || 'null'));
    } catch {}
    const source = sources
      .filter((candidate) => candidate && (Array.isArray(candidate.items) || Array.isArray(candidate.prompts)))
      .sort((a, b) => promptTimestamp(b.syncedAt, 0) - promptTimestamp(a.syncedAt, 0))[0];
    return normalizeCloudPromptState(source);
  }

  function saveCloudPromptState() {
    const payload = {
      schemaVersion: 1,
      version: cloudPromptState.version,
      items: cloudPromptState.items.map((item) => ({ ...item })),
      updatedAt: cloudPromptState.updatedAt,
      syncedAt: cloudPromptState.syncedAt,
    };
    try { GM_setValue(CLOUD_PROMPT_CACHE_KEY, payload); } catch {}
    try {
      localStorage.setItem(CLOUD_PROMPT_CACHE_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('[ChatGPT 辅助器] 云端提示词缓存失败：', error);
    }
  }

  function cloudPromptSnapshot(source = cloudPromptState) {
    return {
      schemaVersion: 1,
      version: String(source?.version || ''),
      items: (source?.items || []).map((item) => ({ ...item })),
      updatedAt: Number(source?.updatedAt || 0),
      syncedAt: Number(source?.syncedAt || 0),
      backedUpAt: Date.now(),
    };
  }

  function loadCloudPromptBackups() {
    let raw = null;
    try { raw = GM_getValue(CLOUD_PROMPT_BACKUPS_KEY, null); } catch {}
    if (!Array.isArray(raw)) {
      try { raw = JSON.parse(localStorage.getItem(CLOUD_PROMPT_BACKUPS_STORAGE_KEY) || 'null'); } catch {}
    }
    return (Array.isArray(raw) ? raw : [])
      .map((item) => normalizeCloudPromptState(item))
      .filter((item) => item.items.length)
      .slice(0, MAX_CLOUD_PROMPT_BACKUPS);
  }

  function saveCloudPromptBackups(backups) {
    const payload = backups.slice(0, MAX_CLOUD_PROMPT_BACKUPS).map((item) => cloudPromptSnapshot(item));
    try { GM_setValue(CLOUD_PROMPT_BACKUPS_KEY, payload); } catch {}
    try { localStorage.setItem(CLOUD_PROMPT_BACKUPS_STORAGE_KEY, JSON.stringify(payload)); } catch {}
  }

  function backupCloudPromptState(source = cloudPromptState) {
    if (!source?.items?.length) return;
    const snapshot = cloudPromptSnapshot(source);
    const signature = `${snapshot.version}|${snapshot.updatedAt}|${snapshot.items.length}`;
    const backups = loadCloudPromptBackups().filter((item) => (
      `${item.version}|${item.updatedAt}|${item.items.length}` !== signature
    ));
    backups.unshift(snapshot);
    saveCloudPromptBackups(backups);
  }

  function cloudPromptBackupCount() {
    return loadCloudPromptBackups().length;
  }

  function cloudPromptStatusText() {
    const lastSync = Number(cloudPromptState.syncedAt || 0);
    const time = lastSync
      ? new Date(lastSync).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '未同步';
    return `本地 ${promptState.items.length} · 云端 ${cloudPromptState.items.length} · ${time}`;
  }

  function restorePreviousCloudPrompts() {
    const backups = loadCloudPromptBackups();
    const previous = backups.shift();
    if (!previous) {
      showImageDownloadToast('没有可恢复的云端提示词版本', false);
      return false;
    }
    const current = cloudPromptSnapshot(cloudPromptState);
    if (current.items.length) backups.push(current);
    cloudPromptState = { ...previous, syncedAt: Date.now() };
    saveCloudPromptState();
    saveCloudPromptBackups(backups);
    if (!document.getElementById(PROMPT_PANEL_ID)?.hidden) renderPromptPanel();
    showImageDownloadToast(`已恢复云端提示词：${cloudPromptState.items.length} 条`, true);
    addDiagnosticLog('prompt:cloud-restore', {
      count: cloudPromptState.items.length,
      version: cloudPromptState.version,
    });
    return true;
  }

  function visiblePromptItems() {
    const localIds = new Set(promptState.items.map((item) => String(item.id)));
    const localContent = new Set(promptState.items.map((item) => `${item.title}\n${item.content}`));
    const cloudItems = cloudPromptState.items.filter((item) => (
      !localIds.has(item.sourceId) && !localContent.has(`${item.title}\n${item.content}`)
    ));
    return [...promptState.items, ...cloudItems];
  }

  function findPromptItem(promptId) {
    return promptState.items.find((item) => item.id === promptId)
      || cloudPromptState.items.find((item) => item.id === promptId)
      || null;
  }

  function requestCloudPromptJson() {
    const url = `${CLOUD_PROMPT_URL}?ts=${Date.now()}`;
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout: 15000,
          headers: { Accept: 'application/json' },
          onload(response) {
            if (response.status < 200 || response.status >= 300) {
              reject(new Error(`GitHub 返回 HTTP ${response.status}`));
              return;
            }
            const body = String(response.responseText || '');
            if (body.length > MAX_CLOUD_PROMPT_RESPONSE_BYTES) {
              reject(new Error('云端提示词文件超过 2MB，已拒绝加载'));
              return;
            }
            try { resolve(JSON.parse(body)); }
            catch { reject(new Error('云端提示词不是有效 JSON')); }
          },
          onerror: () => reject(new Error('无法连接 GitHub 云端提示词库')),
          ontimeout: () => reject(new Error('连接 GitHub 云端提示词库超时')),
        });
      });
    }
    return fetch(url, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
      const body = await response.text();
      if (body.length > MAX_CLOUD_PROMPT_RESPONSE_BYTES) {
        throw new Error('云端提示词文件超过 2MB，已拒绝加载');
      }
      try { return JSON.parse(body); }
      catch { throw new Error('云端提示词不是有效 JSON'); }
    });
  }

  async function syncCloudPrompts(manual = false) {
    if (cloudPromptSyncPromise) {
      if (manual) showImageDownloadToast('云端提示词正在同步…', true);
      return cloudPromptSyncPromise;
    }
    cloudPromptSyncing = true;
    try { GM_setValue(CLOUD_PROMPT_LAST_ATTEMPT_KEY, Date.now()); } catch {}
    if (!document.getElementById(PROMPT_PANEL_ID)?.hidden) renderPromptPanel();
    cloudPromptSyncPromise = (async () => {
      try {
        const raw = await requestCloudPromptJson();
        const rawItems = Array.isArray(raw?.prompts) ? raw.prompts : raw?.items;
        if (!Array.isArray(rawItems)) throw new Error('云端文件缺少 prompts 数组');
        if (Number(raw.schemaVersion || 1) !== 1) throw new Error('不支持该云端提示词格式版本');
        if (rawItems.length > 500) throw new Error('云端提示词超过 500 条，已拒绝加载');
        if (rawItems.some((item) => String(item?.content || '').length > 50000)) {
          throw new Error('单条云端提示词超过 50000 字，已拒绝加载');
        }

        const next = normalizeCloudPromptState({ ...raw, syncedAt: Date.now() });
        if (next.items.length !== rawItems.length) {
          throw new Error('云端提示词包含空白或无效条目，已拒绝覆盖缓存');
        }
        if (new Set(next.items.map((item) => item.sourceId)).size !== next.items.length) {
          throw new Error('云端提示词 ID 重复，已拒绝覆盖缓存');
        }

        const currentCount = cloudPromptState.items.length;
        const nextCount = next.items.length;
        const suspiciousShrink = currentCount > 0 && (
          nextCount === 0
          || (currentCount >= 5 && nextCount < Math.ceil(currentCount * 0.5))
        );
        if (suspiciousShrink) {
          const message = `云端提示词将从 ${currentCount} 条减少到 ${nextCount} 条。`;
          if (!manual) throw new Error(`${message} 自动同步已拒绝，需手动确认`);
          if (!window.confirm(`${message}\n确认同步并保留旧版本备份吗？`)) return false;
        }

        backupCloudPromptState(cloudPromptState);
        cloudPromptState = next;
        saveCloudPromptState();
        if (manual) showImageDownloadToast(`云端提示词已同步：${next.items.length} 条`, true);
        addDiagnosticLog('prompt:cloud-sync', { ok: true, count: next.items.length, version: next.version });
        return true;
      } catch (error) {
        addDiagnosticLog('prompt:cloud-sync', { ok: false, error: String(error?.message || error) });
        if (manual) window.alert(`云端提示词同步失败：${error?.message || error}\n已继续使用本地缓存。`);
        return false;
      } finally {
        cloudPromptSyncPromise = null;
        cloudPromptSyncing = false;
        if (!document.getElementById(PROMPT_PANEL_ID)?.hidden) renderPromptPanel();
      }
    })();
    return cloudPromptSyncPromise;
  }
  function scheduleCloudPromptSync() {
    let lastAttempt = 0;
    try { lastAttempt = Number(GM_getValue(CLOUD_PROMPT_LAST_ATTEMPT_KEY, 0) || 0); } catch {}
    const lastActivity = Math.max(Number(cloudPromptState.syncedAt || 0), lastAttempt);
    if (Date.now() - lastActivity < CLOUD_PROMPT_AUTO_SYNC_INTERVAL) return;
    window.setTimeout(() => void syncCloudPrompts(false), 1200);
  }

  function exportCloudPromptFile() {
    const payload = {
      schemaVersion: 1,
      version: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      prompts: promptState.items.map((item) => ({ ...item })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'chatgpt-cloud-prompts.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function loadDiagnosticLogs() {
    try {
      const logs = JSON.parse(localStorage.getItem(DIAGNOSTIC_LOG_KEY) || '[]');
      return Array.isArray(logs) ? logs.slice(-MAX_DIAGNOSTIC_LOGS) : [];
    } catch {
      return [];
    }
  }

  function saveDiagnosticLogs(immediate = false) {
    if (!immediate) {
      clearTimeout(diagnosticSaveTimer);
      diagnosticSaveTimer = window.setTimeout(() => saveDiagnosticLogs(true), 900);
      return;
    }
    try {
      localStorage.setItem(
        DIAGNOSTIC_LOG_KEY,
        JSON.stringify(diagnosticLogs.slice(-MAX_DIAGNOSTIC_LOGS))
      );
    } catch {
      // 诊断日志不影响主功能。
    }
  }

  function safeDiagnosticDetail(value, depth = 0) {
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
      const text = String(value ?? '');
      if (typeof value === 'string') return text.slice(0, 500);
      return value;
    }
    if (depth > 2) return '[depth-limit]';
    if (Array.isArray(value)) {
      return value.slice(0, 20).map((item) => safeDiagnosticDetail(item, depth + 1));
    }
    if (typeof value === 'object') {
      const output = {};
      Object.entries(value).slice(0, 30).forEach(([key, item]) => {
        if (/token|cookie|authorization|password|secret/i.test(key)) return;
        output[key] = safeDiagnosticDetail(item, depth + 1);
      });
      return output;
    }
    return String(value).slice(0, 200);
  }

  function diagnosticSnapshot() {
    return {
      scriptVersion: SCRIPT_VERSION,
      pageUrl: location.href,
      pageTitle: document.title,
      appMounted: Boolean(host?.isConnected),
      appVersion: host?.dataset?.cgptTreeVersion || '',
      bridgeVersion: (() => {
        try {
          const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
          return pageWindow.__cgptConversationTreeBridgeVersion || window.__cgptConversationTreeBridgeVersion || '';
        } catch {
          return '';
        }
      })(),
      knownChats: Object.keys(state.known || {}).length,
      classifiedChats: classifiedChatIds().size,
      visibleFallbackChats: host?.querySelectorAll?.('.cgpt-fallback-chat[data-chat-id]').length || 0,
      visibleNativeRows: nativeRows.size,
      openChatRunning,
      queuedOpenChat: queuedOpenChat ? { ...queuedOpenChat } : null,
    };
  }

  function addDiagnosticLog(eventName, detail = {}) {
    const entry = {
      at: new Date().toISOString(),
      event: eventName,
      detail: safeDiagnosticDetail(detail),
      snapshot: safeDiagnosticDetail(diagnosticSnapshot()),
    };
    diagnosticLogs.push(entry);
    diagnosticLogs = diagnosticLogs.slice(-MAX_DIAGNOSTIC_LOGS);
    saveDiagnosticLogs();
    try {
      const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      pageWindow.__cgptConversationTreeDiagnostics = {
        snapshot: diagnosticSnapshot(),
        logs: diagnosticLogs,
      };
    } catch {
      // ignore
    }
    console.debug('[ChatGPT 最近对话分组诊断]', eventName, entry);
  }

  async function copyDiagnosticLogs() {
    const payload = {
      format: `${APP_ID}:diagnostics`,
      exportedAt: new Date().toISOString(),
      snapshot: diagnosticSnapshot(),
      logs: diagnosticLogs.slice(-MAX_DIAGNOSTIC_LOGS),
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      window.alert(`已复制诊断日志：${payload.logs.length} 条。把它发给 Codex 就能继续定位。`);
    } catch {
      const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `chatgpt-conversation-tree-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function clearDiagnosticLogs() {
    diagnosticLogs = [];
    saveDiagnosticLogs(true);
    addDiagnosticLog('diagnostic:cleared');
  }

  function installConversationTreeDebugApi() {
    try {
      const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      pageWindow.CGPTConversationTreeDebug = {
        snapshot: () => diagnosticSnapshot(),
        logs: () => diagnosticLogs.slice(),
        copyLogs: () => copyDiagnosticLogs(),
        clearLogs: () => clearDiagnosticLogs(),
        preloadHistory: () => preloadAllHistoryChats(),
        version: SCRIPT_VERSION,
      };
    } catch {
      // ignore
    }
  }

  function uid(prefix) {
    if (crypto?.randomUUID) return `${prefix}:${crypto.randomUUID()}`;
    return `${prefix}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function compactTitle(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/^(打开|Open)\s*/i, '')
      .trim()
      .slice(0, 180);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function base64Utf8(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function normalizeWorkPackageConversationTitle(value) {
    let title = compactTitle(value);
    title = title
      .replace(/\s+[-\u2013\u2014]\s+(Microsoft Edge|Google Chrome|Chrome|Chromium|Brave|Mozilla Firefox)$/i, '')
      .replace(/\s+[-\u2013\u2014]\s*(ChatGPT|OpenAI)\s*$/i, '')
      .replace(/^\s*(ChatGPT|OpenAI)\s*[-\u2013\u2014]\s*/i, '');
    title = compactTitle(title);
    if (!title || /^(ChatGPT|OpenAI|New chat|\u65b0\u804a\u5929)$/i.test(title)) return '';
    return title.slice(0, 80);
  }

  function currentWorkPackageConversationTitle() {
    const chatId = currentChatId();
    const candidates = [
      chatId ? state.known?.[chatId]?.title : '',
      document.querySelector('main h1')?.innerText || '',
      document.title || '',
    ];

    for (const candidate of candidates) {
      const title = normalizeWorkPackageConversationTitle(candidate);
      if (title) return title;
    }
    return '';
  }

  function workPackageTitleMarker(title = currentWorkPackageConversationTitle()) {
    const normalized = normalizeWorkPackageConversationTitle(title);
    if (!normalized) return '';
    return `<!--${WORK_PACKAGE_TITLE_MARKER}${base64Utf8(normalized)}-->`;
  }

  let workPackageAccountName = '';
  let workPackageAccountLookupPromise = null;

  function normalizeWorkPackageAccountName(value) {
    const ignored = /^(ChatGPT|OpenAI|Plus|Pro|Team|Business|Enterprise|Free|Upgrade|升级|设置|Settings|Log out|退出|Open profile menu|Profile|Account|账号|个人资料|个人资料图片|头像|Profile picture|User avatar)$/i;
    const lines = String(value || '').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = compactTitle(rawLine);
      if (!line || ignored.test(line) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line)) continue;
      return line.slice(0, 120);
    }
    return '';
  }

  async function refreshWorkPackageAccountName() {
    if (workPackageAccountLookupPromise) return workPackageAccountLookupPromise;
    workPackageAccountLookupPromise = (async () => {
      try {
        const response = await fetch('/api/auth/session', {
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return workPackageAccountName;
        const session = await response.json();
        const name = normalizeWorkPackageAccountName(session?.user?.name);
        if (name) workPackageAccountName = name;
      } catch (error) {
        addDiagnosticLog('workpkg:account-name-fetch-failed', {
          message: error?.message || String(error),
        });
      }
      return workPackageAccountName;
    })().finally(() => {
      workPackageAccountLookupPromise = null;
    });
    return workPackageAccountLookupPromise;
  }

  function currentWorkPackageAccountName() {
    if (workPackageAccountName) return workPackageAccountName;
    refreshWorkPackageAccountName();
    const selectors = [
      '[data-testid="accounts-profile-button"]',
      '[data-testid="profile-button"]',
      '[data-testid*="account"][data-testid*="profile"]',
      'button[aria-label*="profile" i]',
      'button[aria-label*="account" i]',
      'button[aria-label*="个人资料"]',
      'button[aria-label*="账号"]',
    ];
    const roots = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    for (const root of roots) {
      const candidates = [
        root.getAttribute('data-user-name'),
        root.querySelector('[data-user-name]')?.getAttribute('data-user-name'),
        root.innerText,
        root.querySelector('img[alt]')?.getAttribute('alt'),
        root.getAttribute('title'),
        root.getAttribute('aria-label'),
      ];
      for (const candidate of candidates) {
        const name = normalizeWorkPackageAccountName(candidate);
        if (name) {
          workPackageAccountName = name;
          return name;
        }
      }
    }
    return '未识别账号';
  }

  function currentWorkPackageConversationUrl() {
    const chatId = currentChatId();
    if (!chatId) return '';
    return `${location.origin}/c/${encodeURIComponent(chatId)}`;
  }

  function workPackageMetadataMarker() {
    const conversationUrl = currentWorkPackageConversationUrl();
    if (!conversationUrl) return '';
    const metadata = {
      accountName: currentWorkPackageAccountName(),
      conversationUrl,
    };
    return `<!--${WORK_PACKAGE_METADATA_MARKER}${base64Utf8(JSON.stringify(metadata))}-->`;
  }

  function workPackageClipboardMarkers(title = currentWorkPackageConversationTitle()) {
    return `${workPackageTitleMarker(title)}${workPackageMetadataMarker()}`;
  }

  function stripWorkPackageMarkers(html = '') {
    return String(html || '')
      .replace(/<!--WORKPKG_GPT_TITLE_B64:[A-Za-z0-9+/=]+-->/g, '')
      .replace(/<!--WORKPKG_GPT_META_B64:[A-Za-z0-9+/=]+-->/g, '');
  }

  function htmlFromPlainText(text = '') {
    return escapeHtml(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
  }

  function selectedHtmlFragment() {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount <= 0) return '';
    const container = document.createElement('div');
    for (let index = 0; index < selection.rangeCount; index += 1) {
      container.append(selection.getRangeAt(index).cloneContents());
    }
    return container.innerHTML || '';
  }

  function installWorkPackageClipboardBridge() {
    if (installWorkPackageClipboardBridge.installed) return;
    installWorkPackageClipboardBridge.installed = true;
    document.addEventListener('copy', (event) => {
      const title = currentWorkPackageConversationTitle();
      const markers = workPackageClipboardMarkers(title);
      const selection = window.getSelection?.();
      const text = selection?.toString?.() || '';
      if (!event.clipboardData || !markers || !text.trim()) return;

      const selectedHtml = selectedHtmlFragment();
      const html = `${stripWorkPackageMarkers(selectedHtml || htmlFromPlainText(text))}${markers}`;
      event.clipboardData.setData('text/plain', text);
      event.clipboardData.setData('text/html', html);
      event.preventDefault();
      addDiagnosticLog('workpkg:copy-metadata-marker', { title, conversationUrl: currentWorkPackageConversationUrl() });
    }, true);
  }

  async function stampWorkPackageTitleOnClipboard() {
    const title = currentWorkPackageConversationTitle();
    const markers = workPackageClipboardMarkers(title);
    if (!markers || !navigator.clipboard?.readText || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      return false;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) return false;
      const html = `${htmlFromPlainText(text)}${markers}`;
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      addDiagnosticLog('workpkg:clipboard-metadata-stamped', { title, conversationUrl: currentWorkPackageConversationUrl() });
      return true;
    } catch (error) {
      addDiagnosticLog('workpkg:clipboard-title-stamp-failed', { title, message: error?.message || String(error) });
      return false;
    }
  }

  function chatInfoFromHref(href) {
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return null;
      const match = url.pathname.match(/\/c\/([^/?#]+)/);
      if (!match) return null;
      return {
        chatId: decodeURIComponent(match[1]),
        url: url.pathname,
      };
    } catch {
      return null;
    }
  }

  function titleFromAnchor(anchor) {
    const titleClone = anchor.cloneNode(true);
    titleClone.querySelectorAll('button, [role="button"]').forEach((element) => element.remove());
    const visibleTitle = compactTitle(titleClone.innerText || titleClone.textContent);
    if (visibleTitle) return visibleTitle;
    return compactTitle(
      anchor.getAttribute('aria-label')
        ?.replace(/，已置顶对话$/, '')
        .replace(/（未读）$/, '')
    ) || '未命名对话';
  }

  function findRecentElements() {
    const history = document.querySelector(
      'nav[aria-label="历史聊天记录"] #history, nav[aria-label="Chat history"] #history, #history'
    );
    if (!history) return null;
    const list = [...history.children].find((child) => child.tagName === 'UL')
      || history.querySelector('ul');
    if (!list) return null;
    const section = history.parentElement;
    const header = history.previousElementSibling
      || section?.querySelector('.group\\/sidebar-expando-section-header');
    return { history, list, section, header };
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${APP_ID}, #${APP_ID} ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      #${APP_ID} {
        width: 100%;
      }
      #${PARKING_ID} {
        display: none !important;
      }
      #${RENAME_STAGE_ID} {
        position: fixed;
        left: -10000px;
        top: 0;
        width: 260px;
        min-height: 40px;
        opacity: .001;
        pointer-events: none;
        z-index: -1;
      }
      #${HEADER_ID} {
        display: inline-flex;
        align-items: center;
        gap: 1px;
      }
      .cgpt-tree-button {
        width: 28px;
        height: 28px;
        display: inline-grid;
        place-items: center;
        padding: 0;
        border: 0;
        border-radius: 8px;
        color: var(--text-secondary, currentColor);
        background: transparent;
        cursor: pointer;
      }
      .cgpt-tree-button:hover {
        color: var(--text-primary, currentColor);
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.06));
      }
      .cgpt-load-all-button {
        position: relative;
      }
      .cgpt-load-all-button.cgpt-loading,
      .cgpt-load-all-button.cgpt-done {
        width: auto;
        min-width: 36px;
        padding: 0 6px;
        gap: 3px;
        font-size: 11px;
        line-height: 1;
      }
      .cgpt-load-all-button.cgpt-loading {
        color: #2563eb;
        background: color-mix(in srgb, #2563eb 10%, transparent);
      }
      .cgpt-load-all-button.cgpt-done {
        color: #16a34a;
      }
      .cgpt-load-all-button span {
        max-width: 42px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${PROMPT_BUTTON_ID} {
        flex: 0 0 auto;
        align-self: center;
        height: auto;
        min-height: 0;
        min-width: 58px;
        padding: 0 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        border: 0;
        border-radius: 999px;
        color: var(--text-tertiary, var(--text-secondary, inherit));
        background: transparent;
        font: inherit;
        font-size: inherit;
        font-weight: inherit;
        line-height: inherit;
        cursor: pointer;
        white-space: nowrap;
        box-sizing: border-box;
        position: relative;
        z-index: 2;
      }
      #${PROMPT_BUTTON_ID}:hover,
      #${PROMPT_BUTTON_ID}[aria-expanded="true"] {
        color: var(--text-secondary, inherit);
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.06));
      }
      #${PROMPT_PANEL_ID} {
        position: fixed;
        z-index: 2147483647;
        width: min(320px, calc(100vw - 20px));
        max-height: min(420px, calc(100vh - 20px));
        display: flex;
        flex-direction: column;
        gap: 5px;
        padding: 7px;
        box-sizing: border-box;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        border-radius: 13px;
        color: var(--text-primary, inherit);
        background: var(--main-surface-primary, Canvas);
        box-shadow: 0 18px 44px rgba(0,0,0,.18);
      }
      #${PROMPT_PANEL_ID}[hidden] {
        display: none;
      }
      .cgpt-prompt-head,
      .cgpt-prompt-foot,
      .cgpt-prompt-row-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .cgpt-prompt-head {
        flex: 0 0 auto;
        justify-content: space-between;
        font-weight: 600;
        padding: 0 2px;
      }
      .cgpt-prompt-head span:last-child,
      .cgpt-prompt-foot {
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .cgpt-prompt-head small {
        color: var(--text-tertiary, #888);
        font-weight: 400;
      }
      #${PROMPT_PANEL_ID} button {
        border: 0;
        border-radius: 10px;
        padding: 5px 7px;
        color: inherit;
        background: transparent;
        cursor: pointer;
        text-align: left;
      }
      #${PROMPT_PANEL_ID} button:hover {
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.06));
      }
      #${PROMPT_PANEL_ID} button:disabled {
        opacity: .55;
        cursor: progress;
      }
      #${PROMPT_PANEL_ID} .cgpt-prompt-list {
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
      }
      #${PROMPT_PANEL_ID} .cgpt-prompt-primary {
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.08));
        font-weight: 600;
      }
      #${PROMPT_PANEL_ID} .cgpt-prompt-help-button {
        width: 30px;
        padding: 7px 0;
        border-radius: 999px;
        text-align: center;
        font-weight: 700;
      }
      .cgpt-prompt-help {
        flex: 0 0 auto;
        padding: 10px 12px;
        border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
        border-radius: 12px;
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.04));
        font-size: 12px;
        line-height: 1.55;
      }
      .cgpt-prompt-help strong {
        display: block;
        margin-bottom: 4px;
        font-size: 13px;
      }
      .cgpt-prompt-help p {
        margin: 4px 0;
      }
      .cgpt-prompt-help ul {
        margin: 5px 0;
        padding-left: 18px;
      }
      .cgpt-prompt-help small {
        color: var(--text-tertiary, #777);
      }
      #${PROMPT_PANEL_ID} .cgpt-danger {
        color: #e03131;
      }
      .cgpt-prompt-list {
        flex: 1 1 auto;
        min-height: 42px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: none;
        overflow: auto;
      }
      .cgpt-prompt-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 5px;
        align-items: center;
        padding: 4px;
        border-radius: 9px;
        cursor: pointer;
      }
      .cgpt-prompt-row:hover,
      .cgpt-prompt-row:focus-visible {
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.06));
        outline: none;
      }
      .cgpt-prompt-insert {
        min-width: 0;
        display: grid;
        gap: 3px;
      }
      .cgpt-prompt-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
      }
      .cgpt-prompt-cloud-badge {
        display: inline-flex;
        margin-left: 6px;
        padding: 1px 5px;
        border-radius: 999px;
        color: #2563eb;
        background: rgba(37, 99, 235, .1);
        font-size: 11px;
        font-weight: 500;
        vertical-align: 1px;
      }
      .cgpt-prompt-preview,
      .cgpt-prompt-empty {
        color: var(--text-tertiary, #888);
        font-size: 12px;
        line-height: 1.35;
      }
      .cgpt-prompt-preview {
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
      }
      .cgpt-prompt-row-actions {
        opacity: .78;
      }
      .cgpt-prompt-row:hover .cgpt-prompt-row-actions,
      .cgpt-prompt-row:focus-visible .cgpt-prompt-row-actions {
        opacity: 1;
      }
      .cgpt-prompt-row-actions button {
        padding: 4px 6px;
        white-space: nowrap;
      }
      .cgpt-prompt-editor {
        flex: 0 0 auto;
        display: grid;
        gap: 8px;
        padding-top: 4px;
        max-height: min(360px, 52vh);
        overflow: auto;
      }
      .cgpt-prompt-editor input,
      .cgpt-prompt-editor textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 9px 10px;
        border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
        border-radius: 10px;
        color: inherit;
        background: var(--main-surface-primary, Canvas);
        font: inherit;
      }
      .cgpt-prompt-editor textarea {
        min-height: 120px;
        max-height: min(220px, 34vh);
        resize: vertical;
        line-height: 1.45;
      }
      .cgpt-prompt-foot {
        position: sticky;
        bottom: 0;
        z-index: 1;
        padding-top: 6px;
        background: var(--main-surface-primary, Canvas);
      }
      .cgpt-tree-button svg,
      .cgpt-folder-icon svg,
      .cgpt-fallback-icon svg {
        width: 17px;
        height: 17px;
        display: block;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.55;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .cgpt-folder-row {
        position: relative;
        min-height: 36px;
        margin: 0 6px;
        padding: 2px 4px 2px calc(6px + var(--cgpt-depth, 0) * 14px);
        display: flex;
        align-items: center;
        gap: 3px;
        border-radius: 8px;
        color: var(--text-primary, inherit);
        cursor: default;
      }
      .cgpt-folder-row:hover,
      .cgpt-folder-row.cgpt-drop-folder {
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.06));
      }
      .cgpt-folder.cgpt-drop-folder-range {
        border-radius: 9px;
        background: color-mix(in srgb, #4b7bec 8%, transparent);
        box-shadow: inset 0 0 0 2px color-mix(in srgb, #4b7bec 58%, transparent);
      }
      .cgpt-folder.cgpt-drop-folder-range > .cgpt-folder-row {
        background: color-mix(in srgb, #4b7bec 12%, transparent);
      }
      .cgpt-folder-row.cgpt-drop-folder {
        outline: 2px solid color-mix(in srgb, #4b7bec 72%, transparent);
        outline-offset: -2px;
      }
      .cgpt-folder-row.cgpt-drop-before::before {
        content: "";
        position: absolute;
        top: -1px;
        left: calc(12px + var(--cgpt-depth, 0) * 14px);
        right: 8px;
        height: 2px;
        border-radius: 2px;
        background: #4b7bec;
      }
      .cgpt-chevron {
        width: 20px;
        height: 28px;
        flex: 0 0 20px;
      }
      .cgpt-chevron svg {
        width: 14px;
        height: 14px;
      }
      .cgpt-folder-icon {
        width: 20px;
        height: 28px;
        display: grid;
        place-items: center;
        flex: 0 0 20px;
        color: #4b7bec;
      }
      .cgpt-folder-title {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        padding: 5px 2px;
        border: 0;
        color: inherit;
        background: transparent;
        text-align: left;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
        font: inherit;
        font-weight: 500;
      }
      .cgpt-folder-count {
        min-width: 17px;
        color: var(--text-tertiary, #888);
        font-size: 11px;
        text-align: center;
      }
      .cgpt-folder-action {
        width: 26px;
        height: 26px;
        display: none;
        flex: 0 0 26px;
      }
      .cgpt-folder-row:hover .cgpt-folder-action {
        display: inline-grid;
      }
      .cgpt-folder-children.cgpt-collapsed {
        display: none;
      }
      .cgpt-system-folder .cgpt-folder-icon {
        color: var(--text-tertiary, #888);
      }
      .cgpt-system-folder .cgpt-folder-title {
        font-weight: 400;
      }
      li.cgpt-native-chat {
        padding-inline-start: calc(var(--cgpt-depth, 1) * 14px);
      }
      li.cgpt-native-chat > a {
        width: calc(100% - var(--cgpt-depth, 1) * 14px);
        max-width: calc(100% - var(--cgpt-depth, 1) * 14px);
      }
      li.cgpt-native-chat.cgpt-active-chat {
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.08));
        box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 7%, transparent);
        overflow: hidden;
      }
      li.cgpt-native-chat.cgpt-active-chat > a,
      li.cgpt-native-chat.cgpt-active-chat [role="link"] {
        background: transparent !important;
        box-shadow: none !important;
        outline: none !important;
      }
      li.cgpt-native-chat.cgpt-opening-chat > a,
      li.cgpt-native-chat.cgpt-opening-chat {
        background: color-mix(in srgb, #2563eb 8%, transparent);
      }
      li.cgpt-native-chat.cgpt-open-failed > a,
      li.cgpt-native-chat.cgpt-open-failed {
        box-shadow: inset 0 0 0 1px color-mix(in srgb, #ef4444 38%, transparent);
      }
      li.cgpt-native-chat[data-cgpt-tree-managed="true"] {
        margin: 0 6px;
        border-radius: 8px;
      }
      li.cgpt-native-chat:hover button[aria-label*="对话选项"],
      li.cgpt-native-chat:focus-within button[aria-label*="对话选项"],
      li.cgpt-native-chat:hover button[aria-label*="conversation options" i],
      li.cgpt-native-chat:focus-within button[aria-label*="conversation options" i] {
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
      li.cgpt-native-chat.cgpt-dragging,
      .cgpt-folder-row.cgpt-dragging {
        opacity: .42;
      }
      li.cgpt-native-source-row {
        min-height: 0 !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      li.cgpt-native-source-row > * {
        visibility: hidden !important;
      }
      li.cgpt-native-unclassified-row {
        scroll-margin-bottom: 120px;
      }
      .cgpt-fallback-chat {
        min-height: 36px;
        margin: 0 6px;
        padding: 2px 7px 2px calc(8px + var(--cgpt-depth, 1) * 14px);
        display: flex;
        align-items: center;
        border-radius: 8px;
        cursor: pointer;
      }
      .cgpt-fallback-chat:hover {
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.06));
      }
      .cgpt-fallback-chat.cgpt-active-chat {
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.08));
        box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 7%, transparent);
        overflow: hidden;
      }
      .cgpt-fallback-chat.cgpt-active-chat .cgpt-fallback-link {
        outline: none !important;
        box-shadow: none !important;
      }
      .cgpt-fallback-chat.cgpt-active-chat .cgpt-fallback-link {
        font-weight: 600;
      }
      .cgpt-fallback-chat.cgpt-opening-chat {
        background: color-mix(in srgb, #2563eb 8%, transparent);
      }
      .cgpt-fallback-chat.cgpt-open-failed {
        box-shadow: inset 0 0 0 1px color-mix(in srgb, #ef4444 38%, transparent);
      }
      .cgpt-fallback-link {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        display: flex;
        align-items: center;
        min-height: 32px;
        color: inherit;
        text-decoration: none;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cgpt-proxy-options {
        width: 28px;
        height: 28px;
        flex: 0 0 28px;
        display: none;
        place-items: center;
        padding: 0;
        border: 0;
        border-radius: 8px;
        color: inherit;
        background: transparent;
        cursor: pointer;
        pointer-events: auto;
      }
      .cgpt-fallback-chat:hover .cgpt-proxy-options,
      .cgpt-fallback-chat:focus-within .cgpt-proxy-options {
        display: grid;
      }
      .cgpt-proxy-options:hover {
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.08));
      }
      #${APP_ID}.cgpt-drop-root {
        border-radius: 8px;
        box-shadow: inset 0 0 0 2px color-mix(in srgb, #4b7bec 62%, transparent);
      }
      .cgpt-recent-drop {
        border-radius: 8px;
        box-shadow: inset 0 0 0 2px color-mix(in srgb, #4b7bec 62%, transparent);
      }
      #${MENU_ID} {
        position: fixed;
        z-index: 2147483646;
        min-width: 148px;
        padding: 5px;
        border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
        border-radius: 10px;
        color: var(--text-primary, inherit);
        background: var(--main-surface-primary, Canvas);
        box-shadow: 0 12px 34px rgba(0,0,0,.18);
      }
      #${MENU_ID}[hidden] {
        display: none;
      }
      #${MENU_ID} button {
        width: 100%;
        padding: 8px 10px;
        border: 0;
        border-radius: 7px;
        color: inherit;
        background: transparent;
        text-align: left;
        font: inherit;
        cursor: pointer;
      }
      #${MENU_ID} button:hover {
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.06));
      }
      #${MENU_ID} button.cgpt-danger {
        color: #e5484d;
      }
      #${MENU_ID} .cgpt-menu-title {
        padding: 6px 10px 5px;
        color: var(--text-tertiary, #888);
        font-size: 12px;
      }
      #${MENU_ID} .cgpt-menu-folder {
        display: flex;
        align-items: center;
        gap: 7px;
        padding-inline-start: calc(10px + var(--cgpt-menu-depth, 0) * 14px);
      }
      #${MENU_ID} .cgpt-menu-folder svg {
        width: 16px;
        height: 16px;
        flex: 0 0 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.55;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      #${MENU_ID} .cgpt-menu-folder[disabled] {
        opacity: .48;
        cursor: default;
      }
      #${MENU_ID} .cgpt-menu-meta {
        margin-inline-start: auto;
        color: var(--text-tertiary, #888);
        font-size: 11px;
      }
      #${MENU_ID} .cgpt-current-mark {
        width: 15px;
        flex: 0 0 15px;
        color: #4b7bec;
        text-align: center;
      }
      #${MENU_ID} .cgpt-menu-divider {
        height: 1px;
        margin: 4px 5px;
        background: color-mix(in srgb, currentColor 12%, transparent);
      }
      .cgpt-native-menu-item {
        cursor: pointer;
      }
      .cgpt-native-menu-item svg {
        width: 18px;
        height: 18px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.55;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .${IMAGE_DOWNLOAD_SLOT_CLASS} {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-inline-start: 2px;
        vertical-align: middle;
      }
      /* Never place production actions on top of the generated picture. The
         only visible manual entry belongs beside the reply's native ellipsis. */
      [data-testid="image-gen-overlay-right-actions"] .${IMAGE_DOWNLOAD_SLOT_CLASS},
      [data-testid*="image-gen-overlay"] .${IMAGE_DOWNLOAD_SLOT_CLASS} {
        display: none !important;
      }
      .${IMAGE_DOWNLOAD_SLOT_CLASS}.cgpt-image-download-fallback {
        display: flex;
        margin: 7px 0 2px;
      }
      .cgpt-image-download-marker {
        display: inline-flex;
        align-items: center;
        min-height: 24px;
        padding: 0 8px;
        border: 1px solid color-mix(in srgb, #16a34a 28%, transparent);
        border-radius: 999px;
        color: #15803d;
        background: color-mix(in srgb, #16a34a 9%, transparent);
        font-size: 12px;
        font-weight: 650;
        line-height: 1;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .cgpt-image-download-marker[data-state="packaged"] {
        color: #1d4ed8;
        border-color: color-mix(in srgb, #2563eb 28%, transparent);
        background: color-mix(in srgb, #2563eb 9%, transparent);
      }
      .${TEXT_DOWNLOAD_SLOT_CLASS} {
        display: inline-flex;
        align-items: center;
        margin-inline-start: 4px;
        vertical-align: middle;
      }
      .${IMAGE_DOWNLOAD_CLASS},
      .${WORK_PACKAGE_CLASS},
      .${TEXT_DOWNLOAD_CLASS},
      .${TEXT_COPY_CLASS} {
        position: relative;
        min-width: 34px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 7px;
        border: 0;
        border-radius: 10px;
        color: var(--text-primary, currentColor);
        background: transparent;
        font: inherit;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
      }
      .${IMAGE_DOWNLOAD_CLASS}:hover,
      .${WORK_PACKAGE_CLASS}:hover,
      .${TEXT_DOWNLOAD_CLASS}:hover,
      .${TEXT_COPY_CLASS}:hover {
        background: var(--sidebar-surface-tertiary, rgba(0,0,0,.08));
      }
      .${IMAGE_DOWNLOAD_CLASS}.cgpt-image-download-done {
        color: #16a34a;
        background: color-mix(in srgb, #16a34a 9%, transparent);
      }
      .${WORK_PACKAGE_CLASS}.cgpt-work-package-called {
        color: #2563eb;
        background: color-mix(in srgb, #2563eb 9%, transparent);
      }
      .${WORK_PACKAGE_CLASS}.cgpt-work-package-done {
        color: #16a34a;
        background: color-mix(in srgb, #16a34a 9%, transparent);
      }
      .${WORK_PACKAGE_CLASS}[disabled] {
        opacity: .78;
        cursor: progress;
      }
      .${IMAGE_DOWNLOAD_CLASS}[disabled] {
        opacity: .58;
        cursor: progress;
      }
      .${IMAGE_DOWNLOAD_CLASS} svg,
      .${WORK_PACKAGE_CLASS} svg,
      .${TEXT_DOWNLOAD_CLASS} svg,
      .${TEXT_COPY_CLASS} svg {
        width: 16px;
        height: 16px;
        flex: 0 0 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.65;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .${IMAGE_DOWNLOAD_CLASS} .cgpt-image-download-count {
        min-width: 26px;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .${IMAGE_DOWNLOAD_CLASS} .cgpt-image-download-status {
        white-space: nowrap;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
      }
      .${WORK_PACKAGE_CLASS} .cgpt-work-package-label {
        white-space: nowrap;
        font-size: 12px;
        font-weight: 600;
      }
      .${WORK_PACKAGE_CLASS}:not(.cgpt-work-package-called):not(.cgpt-work-package-done) .cgpt-work-package-label {
        font-size: 0;
      }
      .${WORK_PACKAGE_CLASS}:not(.cgpt-work-package-called):not(.cgpt-work-package-done) .cgpt-work-package-label::after {
        content: '\u4e0b\u8f7d\u5e76\u6253\u5305';
        font-size: 12px;
      }
      #${IMAGE_DOWNLOAD_TOAST_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        max-width: min(320px, calc(100vw - 36px));
        padding: 10px 13px;
        border: 1px solid color-mix(in srgb, currentColor 11%, transparent);
        border-radius: 12px;
        color: var(--text-primary, #111);
        background: var(--main-surface-primary, Canvas);
        box-shadow: 0 12px 34px rgba(0,0,0,.18);
        font-size: 13px;
        line-height: 1.35;
      }
      #${IMAGE_DOWNLOAD_TOAST_ID}.cgpt-image-download-toast-ok {
        border-color: color-mix(in srgb, #16a34a 34%, transparent);
      }

      #${MENU_ID}.cgpt-batch-menu {
        width: min(330px, calc(100vw - 20px));
        max-width: 330px;
      }
      #${MENU_ID} .cgpt-batch-head,
      #${MENU_ID} .cgpt-batch-foot {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 7px 8px;
      }
      #${MENU_ID} .cgpt-batch-head {
        justify-content: space-between;
        font-weight: 600;
      }
      #${MENU_ID} .cgpt-batch-list {
        max-height: min(46vh, 420px);
        overflow: auto;
        padding: 2px 4px;
        scrollbar-width: thin;
      }
      #${MENU_ID} label.cgpt-batch-row {
        min-height: 36px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 7px;
        border-radius: 7px;
        cursor: pointer;
      }
      #${MENU_ID} label.cgpt-batch-row:hover {
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.06));
      }
      #${MENU_ID} .cgpt-batch-row input {
        width: 16px;
        height: 16px;
        flex: 0 0 16px;
        accent-color: #4b7bec;
      }
      #${MENU_ID} .cgpt-batch-row span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${MENU_ID} .cgpt-batch-foot {
        justify-content: flex-end;
      }
      #${MENU_ID} .cgpt-batch-primary {
        width: auto;
        padding-inline: 13px;
        color: white;
        background: #111;
      }
      #${MENU_ID} .cgpt-batch-primary:hover {
        background: #2c2c2c;
      }
      #${MENU_ID} .cgpt-batch-primary[disabled] {
        opacity: .38;
        cursor: default;
      }
      #${RENAME_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        padding: 16px;
        color: var(--text-primary, #202123);
        background: rgba(0, 0, 0, .38);
        backdrop-filter: blur(2px);
      }
      #${RENAME_ID}[hidden] {
        display: none;
      }
      #${RENAME_ID} .cgpt-rename-dialog {
        width: min(820px, calc(100vw - 24px));
        max-height: min(88vh, 860px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
        border-radius: 16px;
        background: var(--main-surface-primary, Canvas);
        box-shadow: 0 24px 70px rgba(0, 0, 0, .28);
      }
      #${RENAME_ID} .cgpt-rename-head {
        padding: 18px 20px 13px;
        border-bottom: 1px solid color-mix(in srgb, currentColor 11%, transparent);
      }
      #${RENAME_ID} .cgpt-rename-head h2 {
        margin: 0 0 5px;
        font-size: 18px;
      }
      #${RENAME_ID} .cgpt-rename-head p {
        margin: 0;
        color: var(--text-secondary, #666);
        font-size: 13px;
      }
      #${RENAME_ID} .cgpt-rename-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 20px;
        border-bottom: 1px solid color-mix(in srgb, currentColor 9%, transparent);
        color: var(--text-secondary, #666);
        font-size: 12px;
      }
      #${RENAME_ID} .cgpt-rename-list {
        min-height: 120px;
        overflow: auto;
        padding: 8px 12px 12px;
        scrollbar-width: thin;
      }
      #${RENAME_ID} .cgpt-rename-row {
        display: grid;
        grid-template-columns: minmax(140px, 220px) minmax(260px, 1fr) 72px;
        align-items: center;
        gap: 10px;
        padding: 7px 8px;
        border-radius: 9px;
      }
      #${RENAME_ID} .cgpt-rename-row:hover {
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.05));
      }
      #${RENAME_ID} .cgpt-rename-path {
        min-width: 0;
        overflow: hidden;
        color: var(--text-tertiary, #888);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${RENAME_ID} .cgpt-rename-input {
        width: 100%;
        height: 34px;
        padding: 5px 9px;
        border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
        border-radius: 8px;
        outline: none;
        color: inherit;
        background: var(--main-surface-primary, Canvas);
        font: inherit;
      }
      #${RENAME_ID} .cgpt-rename-input:focus {
        border-color: #4b7bec;
        box-shadow: 0 0 0 2px color-mix(in srgb, #4b7bec 18%, transparent);
      }
      #${RENAME_ID} .cgpt-rename-input.cgpt-changed {
        border-color: #4b7bec;
        background: color-mix(in srgb, #4b7bec 5%, Canvas);
      }
      #${RENAME_ID} .cgpt-rename-input[disabled] {
        opacity: .65;
      }
      #${RENAME_ID} .cgpt-rename-status {
        overflow: hidden;
        color: var(--text-tertiary, #888);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${RENAME_ID} .cgpt-rename-status[data-state="success"] { color: #1f8a4c; }
      #${RENAME_ID} .cgpt-rename-status[data-state="error"] { color: #d14b4b; }
      #${RENAME_ID} .cgpt-rename-status[data-state="running"] { color: #4b7bec; }
      #${RENAME_ID} .cgpt-rename-foot {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 20px;
        border-top: 1px solid color-mix(in srgb, currentColor 11%, transparent);
      }
      #${RENAME_ID} .cgpt-rename-button {
        min-width: 86px;
        padding: 8px 14px;
        border: 0;
        border-radius: 9px;
        color: inherit;
        background: var(--sidebar-surface-secondary, rgba(0,0,0,.07));
        font: inherit;
        cursor: pointer;
      }
      #${RENAME_ID} .cgpt-rename-button:hover {
        filter: brightness(.96);
      }
      #${RENAME_ID} .cgpt-rename-button.cgpt-primary {
        color: white;
        background: #111;
      }
      #${RENAME_ID} .cgpt-rename-button[disabled] {
        opacity: .4;
        cursor: default;
      }
      @media (max-width: 620px) {
        #${RENAME_ID} .cgpt-rename-row {
          grid-template-columns: 1fr 62px;
        }
        #${RENAME_ID} .cgpt-rename-path {
          grid-column: 1 / -1;
        }
      }
    `;
    document.head.append(style);
  }

  function ensureMenu() {
    let menu = document.getElementById(MENU_ID);
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.hidden = true;
    document.body.append(menu);
    return menu;
  }

  function ensureRenameStage() {
    let stage = document.getElementById(RENAME_STAGE_ID);
    if (stage) return stage;
    stage = document.createElement('div');
    stage.id = RENAME_STAGE_ID;
    stage.setAttribute('aria-hidden', 'true');
    document.body.append(stage);
    return stage;
  }

  function ensureRenameModal() {
    let modal = document.getElementById(RENAME_ID);
    if (modal) return modal;
    modal = document.createElement('section');
    modal.id = RENAME_ID;
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', '批量重命名对话');
    document.body.append(modal);
    return modal;
  }

  function ensureMounted() {
    const found = findRecentElements();
    if (!found) return false;

    if (nativeList !== found.list) {
      document.getElementById(APP_ID)?.remove();
      document.getElementById(HEADER_ID)?.remove();
      host = null;
      headerActions = null;
      parkingLot = null;
      nativeList = found.list;
      historyRoot = found.history;
    }
    historyRoot = found.history;
    recentHeader = found.header;

    injectStyles();
    ensureMenu();
    ensureImportInput();
    ensureRenameStage();
    ensureRenameModal();
    injectPageBridge();

    if (!host?.isConnected) {
      host = document.createElement('li');
      host.id = APP_ID;
      host.className = 'list-none';
      host.setAttribute('aria-label', '最近对话分组');
      host.dataset.cgptTreeVersion = SCRIPT_VERSION;
      nativeList.insertBefore(host, nativeList.firstChild);
    }
    if (host?.isConnected) host.dataset.cgptTreeVersion = SCRIPT_VERSION;

    if (!parkingLot?.isConnected) {
      parkingLot = document.getElementById(PARKING_ID) || document.createElement('div');
      parkingLot.id = PARKING_ID;
      parkingLot.setAttribute('aria-hidden', 'true');
      historyRoot.append(parkingLot);
    }

    if (!headerActions?.isConnected && found.header) {
      headerActions = document.createElement('span');
      headerActions.id = HEADER_ID;
      headerActions.innerHTML = `
        <button class="cgpt-tree-button" data-cgpt-action="add-folder"
                title="新建分组" aria-label="新建分组">${icons.plus}</button>
        <button class="cgpt-tree-button" data-cgpt-action="batch-group"
                title="批量分组未分组对话" aria-label="批量分组未分组对话">${icons.batch}</button>
        <button class="cgpt-tree-button cgpt-load-all-button" data-cgpt-action="preload-history"
                title="手动预加载所有历史对话（再次点击可停止）" aria-label="手动预加载所有历史对话">
          ${icons.download}<span data-cgpt-load-label hidden></span>
        </button>
        <button class="cgpt-tree-button" data-cgpt-action="collapse-all"
                title="全部折叠或展开" aria-label="全部折叠或展开">${icons.fold}</button>
        <button class="cgpt-tree-button" data-cgpt-action="data-menu"
                title="导入或导出分组数据" aria-label="导入或导出分组数据">${icons.dots}</button>
      `;
      const actionArea = found.header.querySelector('.shrink-0') || found.header;
      actionArea.append(headerActions);
    }

    bindEvents();
    return true;
  }

  function injectPageBridge() {
    if (document.getElementById(`${APP_ID}-page-bridge`)) return;
    const source = `(() => {
      const EVENT_NAME = ${JSON.stringify(PAGE_OPEN_EVENT)};
      const APP_ID = ${JSON.stringify(APP_ID)};
      const BRIDGE_VERSION = ${JSON.stringify(SCRIPT_VERSION)};
      if (window.__cgptConversationTreeBridgeVersion === BRIDGE_VERSION) return;
      window.__cgptConversationTreeBridge = true;
      window.__cgptConversationTreeBridgeVersion = BRIDGE_VERSION;

      function chatInfoFromHref(href) {
        try {
          const url = new URL(href, location.href);
          const match = url.pathname.match(/\\/c\\/([^/?#]+)/);
          return match ? decodeURIComponent(match[1]) : '';
        } catch {
          return '';
        }
      }

      function nativeAnchorForChat(chatId) {
        const anchors = [...document.querySelectorAll('#history a[href*="/c/"], nav a[href*="/c/"], aside a[href*="/c/"]')];
        return anchors.find((anchor) => (
          chatInfoFromHref(anchor.getAttribute('href')) === chatId
          && !anchor.closest('.cgpt-fallback-chat')
          && !anchor.closest('#' + CSS.escape(APP_ID))
        )) || null;
      }

      function reactPropsFor(element) {
        if (!element) return null;
        const key = Object.getOwnPropertyNames(element)
          .find((name) => name.startsWith('__reactProps$') || name.startsWith('__reactEventHandlers$'));
        if (key && element[key]) return element[key];
        const fiberKey = Object.getOwnPropertyNames(element)
          .find((name) => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'));
        const fiber = fiberKey ? element[fiberKey] : null;
        return fiber?.memoizedProps || fiber?.return?.memoizedProps || null;
      }

      function fakeClickEvent(target, currentTarget) {
        let defaultPrevented = false;
        let propagationStopped = false;
        return {
          type: 'click',
          target,
          currentTarget,
          nativeEvent: {
            type: 'click',
            target,
            currentTarget,
            button: 0,
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            defaultPrevented: false,
          },
          button: 0,
          buttons: 0,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          defaultPrevented: false,
          preventDefault() {
            defaultPrevented = true;
            this.defaultPrevented = true;
            this.nativeEvent.defaultPrevented = true;
          },
          stopPropagation() {
            propagationStopped = true;
          },
          isDefaultPrevented() {
            return defaultPrevented;
          },
          isPropagationStopped() {
            return propagationStopped;
          },
          persist() {},
        };
      }

      function invokeReactClick(anchor) {
        for (let element = anchor; element && element !== document.body; element = element.parentElement) {
          const props = reactPropsFor(element);
          if (typeof props?.onClick === 'function') {
            props.onClick(fakeClickEvent(anchor, element));
            return true;
          }
          if (element.matches?.('li, a')) {
            const parentProps = reactPropsFor(element.parentElement);
            if (typeof parentProps?.onClick === 'function') {
              parentProps.onClick(fakeClickEvent(anchor, element.parentElement));
              return true;
            }
          }
        }
        return false;
      }

      function dispatchMouseClick(anchor) {
        const rect = anchor.getBoundingClientRect();
        const x = Math.max(1, Math.round(rect.left + Math.min(24, rect.width / 2 || 12)));
        const y = Math.max(1, Math.round(rect.top + Math.min(14, rect.height / 2 || 10)));
        ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
          const EventClass = type.startsWith('pointer') && typeof PointerEvent === 'function'
            ? PointerEvent
            : MouseEvent;
          anchor.dispatchEvent(new EventClass(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            button: 0,
            buttons: type.endsWith('down') ? 1 : 0,
            clientX: x,
            clientY: y,
          }));
        });
      }

      function openChat(chatId) {
        if (!chatId) return { ok: false, reason: 'missing-chat-id' };
        const before = location.href;
        const anchor = nativeAnchorForChat(chatId);
        if (!anchor) return { ok: false, reason: 'native-anchor-not-found' };
        const row = anchor.closest('li');
        row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        const usedReact = invokeReactClick(anchor);
        if (!usedReact) dispatchMouseClick(anchor);
        window.setTimeout(() => {
          const current = chatInfoFromHref(location.href);
          if (current !== chatId && location.href === before) {
            dispatchMouseClick(anchor);
          }
        }, 80);
        return { ok: true, usedReact };
      }

      window.__cgptConversationTreeOpenChat = openChat;

      window.addEventListener(EVENT_NAME, (event) => {
        const chatId = event.detail?.chatId;
        if (!chatId) return;
        event.detail.result = openChat(chatId);
      }, true);
    })();`;
    try {
      const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      if (pageWindow.__cgptConversationTreeBridgeVersion === SCRIPT_VERSION) return;
      if (typeof pageWindow.eval === 'function') {
        pageWindow.eval(source);
        if (pageWindow.__cgptConversationTreeBridgeVersion === SCRIPT_VERSION) {
          addDiagnosticLog('bridge:eval-success');
          return;
        }
      }
      pageWindow.Function(source)();
      addDiagnosticLog('bridge:function-success', {
        bridgeVersion: pageWindow.__cgptConversationTreeBridgeVersion || '',
      });
      return;
    } catch (error) {
      addDiagnosticLog('bridge:page-window-failed', {
        message: error?.message || String(error),
      });
      // Fall back to a script tag. Some pages block this through CSP, but
      // Tampermonkey page-window execution above works on most Chromium setups.
    }
    const script = document.createElement('script');
    script.id = `${APP_ID}-page-bridge`;
    script.textContent = source;
    (document.head || document.documentElement).append(script);
    script.remove();
    window.setTimeout(() => {
      try {
        const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        addDiagnosticLog('bridge:script-tag-result', {
          bridgeVersion: pageWindow.__cgptConversationTreeBridgeVersion || '',
        });
      } catch {
        addDiagnosticLog('bridge:script-tag-result', { bridgeVersion: '' });
      }
    }, 120);
  }

  function ensureImportInput() {
    let input = document.getElementById(IMPORT_INPUT_ID);
    if (input) return input;
    input = document.createElement('input');
    input.id = IMPORT_INPUT_ID;
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    document.body.append(input);
    return input;
  }

  function ensurePromptPanel() {
    let panel = document.getElementById(PROMPT_PANEL_ID);
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = PROMPT_PANEL_ID;
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '提示词库');
    panel.addEventListener('click', (event) => {
      const promptAction = event.target.closest?.('[data-cgpt-prompt-action]');
      if (!promptAction) return;
      event.preventDefault();
      event.stopPropagation();
      const action = promptAction.dataset.cgptPromptAction;
      const promptId = promptAction.dataset.promptId || '';
      if (action === 'new') {
        editingPromptId = 'new';
        renderPromptPanel();
      } else if (action === 'edit') {
        editingPromptId = promptId;
        renderPromptPanel();
      } else if (action === 'delete') {
        deletePrompt(promptId);
      } else if (action === 'insert') {
        insertPrompt(promptId);
      } else if (action === 'sync-cloud') {
        void syncCloudPrompts(true);
      } else if (action === 'toggle-help') {
        promptHelpVisible = !promptHelpVisible;
        renderPromptPanel();
      } else if (action === 'restore-cloud') {
        restorePreviousCloudPrompts();
      } else if (action === 'export-cloud') {
        exportCloudPromptFile();
      } else if (action === 'save') {
        upsertPromptFromPanel();
      } else if (action === 'cancel') {
        editingPromptId = '';
        renderPromptPanel();
      } else if (action === 'close') {
        closePromptPanel();
      }
    }, true);
    document.body.append(panel);
    return panel;
  }

  function promptComposerInput() {
    return document.querySelector('#prompt-textarea')
      || [...document.querySelectorAll('main textarea, form textarea, main [contenteditable="true"], form [contenteditable="true"]')]
        .find((element) => {
          if (element.closest?.(`#${APP_ID}, #${MENU_ID}, #${PROMPT_PANEL_ID}`)) return false;
          const rect = element.getBoundingClientRect?.();
          return rect && rect.width > 160 && rect.height > 20 && isElementVisible(element);
        })
      || null;
  }

  function composerRootFor(element) {
    return element?.closest?.('form')
      || element?.closest?.('[data-testid*="composer"], [class*="composer"], main')
      || null;
  }

  function directChildContaining(parent, child) {
    if (!parent || !child || !parent.contains(child)) return null;
    let current = child;
    while (current?.parentElement && current.parentElement !== parent) {
      current = current.parentElement;
    }
    return current?.parentElement === parent ? current : null;
  }

  function findModelButton(composer) {
    if (!composer) return null;
    const buttons = [...composer.querySelectorAll('button')]
      .filter((button) => (
        button.id !== PROMPT_BUTTON_ID
        && !button.closest(`#${APP_ID}, #${MENU_ID}, #${PROMPT_PANEL_ID}, .${IMAGE_DOWNLOAD_SLOT_CLASS}`)
        && isElementVisible(button)
      ));
    const byText = buttons.find((button) => /高级|模型|model|GPT|auto|thinking|reason|fast|legacy|standard|默认/i.test(
      compactTitle(`${button.innerText || ''} ${button.getAttribute('aria-label') || ''} ${button.title || ''}`)
    ));
    if (byText) return byText;
    return buttons.find((button) => {
      const rect = button.getBoundingClientRect();
      const inputRect = promptComposerInput()?.getBoundingClientRect?.();
      return inputRect && rect.left > inputRect.left + inputRect.width * 0.45 && rect.top > inputRect.top - 20;
    }) || null;
  }

  function promptButtonMount(modelButton, composer, input) {
    if (!modelButton) return null;
    let row = null;
    let parent = modelButton.parentElement;
    while (parent && parent !== composer && parent !== document.body) {
      const style = getComputedStyle(parent);
      const rect = parent.getBoundingClientRect?.();
      const isRow = (
        rect
        && rect.width > 120
        && rect.height < 88
        && (
          (style.display.includes('flex') && !style.flexDirection.startsWith('column'))
          || style.display.includes('grid')
        )
        && parent.querySelectorAll('button').length >= 2
      );
      if (isRow) {
        row = parent;
        break;
      }
      parent = parent.parentElement;
    }
    if (!row) return { parent: modelButton.parentElement, before: modelButton };
    const before = directChildContaining(row, modelButton) || modelButton;
    const inputChild = directChildContaining(row, input);
    if (inputChild && inputChild === before) return { parent: modelButton.parentElement, before: modelButton };
    return { parent: row, before };
  }

  function syncPromptButtonStyle(button, modelButton) {
    if (!button || !modelButton?.isConnected) return;
    try {
      const style = getComputedStyle(modelButton);
      const rect = modelButton.getBoundingClientRect?.();
      button.style.fontSize = style.fontSize || '';
      button.style.fontWeight = style.fontWeight || '';
      button.style.fontFamily = style.fontFamily || '';
      button.style.lineHeight = style.lineHeight || '';
      button.style.color = style.color || '';
      button.style.height = rect?.height ? `${Math.round(rect.height)}px` : style.height || '';
      button.style.paddingTop = style.paddingTop || '0px';
      button.style.paddingBottom = style.paddingBottom || '0px';
      button.style.paddingLeft = '4px';
      button.style.paddingRight = '4px';
      button.style.marginTop = style.marginTop || '';
      button.style.marginBottom = style.marginBottom || '';
    } catch {
      // If ChatGPT changes the model button shape, the CSS fallback still keeps this usable.
    }
  }

  function ensurePromptButton() {
    if (!promptLibraryEnabled()) {
      document.getElementById(PROMPT_BUTTON_ID)?.remove();
      closePromptPanel();
      return false;
    }
    const input = promptComposerInput();
    if (!input) return false;
    const composer = composerRootFor(input);
    if (!composer) return false;

    let button = document.getElementById(PROMPT_BUTTON_ID);
    if (!button) {
      button = document.createElement('button');
      button.id = PROMPT_BUTTON_ID;
      button.type = 'button';
      button.textContent = '提示词';
      button.title = '打开提示词库';
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        togglePromptPanel(button);
      }, true);
    }

    const modelButton = findModelButton(composer);
    const mount = promptButtonMount(modelButton, composer, input);
    const targetParent = mount?.parent
      || [...composer.querySelectorAll('div')].reverse().find((element) => (
        element.querySelectorAll('button').length >= 2 && element.contains(input) === false
      ))
      || input.parentElement;

    if (!targetParent) return false;
    syncPromptButtonStyle(button, modelButton);
    if (mount?.before && mount.parent === targetParent) {
      if (button.parentElement !== targetParent || button.nextSibling !== mount.before) {
        targetParent.insertBefore(button, mount.before);
      }
    } else if (button.parentElement !== targetParent) {
      targetParent.insertBefore(button, targetParent.firstChild || null);
    }
    return true;
  }

  function schedulePromptButton(delay = 180) {
    window.clearTimeout(promptButtonTimer);
    promptButtonTimer = window.setTimeout(() => {
      runWhenIdle(() => ensurePromptButton(), 700);
    }, delay);
  }

  function closePromptPanel() {
    const panel = document.getElementById(PROMPT_PANEL_ID);
    const button = document.getElementById(PROMPT_BUTTON_ID);
    if (panel) panel.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
    editingPromptId = '';
  }

  function positionPromptPanel(button = null) {
    const panel = document.getElementById(PROMPT_PANEL_ID);
    const anchor = button || panel?.__cgptPromptAnchor || document.getElementById(PROMPT_BUTTON_ID);
    if (!panel || panel.hidden || !anchor?.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    const gap = 8;
    const availableAbove = Math.max(0, rect.top - gap * 2);
    const availableBelow = Math.max(0, innerHeight - rect.bottom - gap * 2);
    const useAbove = availableAbove >= 260 || availableAbove >= availableBelow;
    panel.style.maxHeight = `${Math.min(420, Math.max(220, useAbove ? availableAbove : availableBelow))}px`;
    if (useAbove) {
      panel.style.top = 'auto';
      panel.style.bottom = `${Math.max(8, innerHeight - rect.top + gap)}px`;
    } else {
      panel.style.bottom = 'auto';
      panel.style.top = `${Math.max(8, rect.bottom + gap)}px`;
    }
    const width = panel.offsetWidth || 420;
    panel.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width - width))}px`;
  }

  function togglePromptPanel(button) {
    injectStyles();
    const panel = ensurePromptPanel();
    if (!panel.hidden) {
      closePromptPanel();
      return;
    }
    panel.__cgptPromptAnchor = button;
    editingPromptId = '';
    renderPromptPanel();
    panel.hidden = false;
    positionPromptPanel(button);
    button.setAttribute('aria-expanded', 'true');
  }

  function renderPromptPanel() {
    const panel = ensurePromptPanel();
    const visibleItems = visiblePromptItems();
    const editing = editingPromptId
      ? promptState.items.find((item) => item.id === editingPromptId)
      : null;
    const editorTitle = editingPromptId === 'new' ? '新建提示词' : '编辑提示词';
    const list = visibleItems.length ? visibleItems.map((item) => `
      <div class="cgpt-prompt-row"
           data-cgpt-prompt-action="insert"
           data-prompt-id="${escapeHtml(item.id)}"
           role="button"
           tabindex="0"
           title="插入输入框：${escapeHtml(item.title)}">
        <div class="cgpt-prompt-insert">
          <span class="cgpt-prompt-title">${escapeHtml(item.title)}${item.source === 'cloud' ? '<span class="cgpt-prompt-cloud-badge">云端</span>' : ''}</span>
          <span class="cgpt-prompt-preview">${escapeHtml(item.content || '空内容')}</span>
        </div>
        ${item.source === 'cloud' ? '' : `<span class="cgpt-prompt-row-actions">
          <button data-cgpt-prompt-action="edit" data-prompt-id="${escapeHtml(item.id)}">编辑</button>
          <button class="cgpt-danger" data-cgpt-prompt-action="delete" data-prompt-id="${escapeHtml(item.id)}">删除</button>
        </span>`}
      </div>`).join('') : '<div class="cgpt-prompt-empty">还没有提示词。点“新增”创建，或点“同步云端”从 GitHub 拉取。</div>';

    const editingTitle = editing?.title || '';
    const editingContent = editing?.content || '';
    panel.innerHTML = `
      <div class="cgpt-prompt-head">
        <span>提示词库 <small>${cloudPromptStatusText()}</small></span>
        <span>
          <button data-cgpt-prompt-action="new">＋ 新增</button>
          <button data-cgpt-prompt-action="sync-cloud" ${cloudPromptSyncing ? 'disabled' : ''}>${cloudPromptSyncing ? '同步中…' : '☁ 同步'}</button>
          <button class="cgpt-prompt-help-button" data-cgpt-prompt-action="toggle-help" aria-label="提示词库说明" title="提示词库说明">?</button>
          ${cloudPromptBackupCount() ? '<button data-cgpt-prompt-action="restore-cloud">↶ 回退</button>' : ''}
          <button data-cgpt-prompt-action="export-cloud">导出云端文件</button>
          <button data-cgpt-prompt-action="close">关闭</button>
        </span>
      </div>
      ${promptHelpVisible ? `
        <div class="cgpt-prompt-help">
          <strong>这个提示词库如何工作？</strong>
          <p><b>开发初衷：</b>在尽量保留 ChatGPT 原生体验的前提下，把常用提示词、对话整理和作品处理集中成一个贴着网页生长的生产力工具。</p>
          <ul>
            <li><b>GitHub 云端库：</b>相当于你维护的官方公共库；“同步”只会从云端拉取。</li>
            <li><b>浏览器本地库：</b>相当于个人自建库；新增、编辑和删除都只影响当前浏览器。</li>
            <li><b>合并规则：</b>两套数据一起显示；标题和内容完全相同时优先显示本地版本。</li>
            <li><b>安全设计：</b>云端同步不会覆盖本地库，并保留缓存和可回退版本。</li>
          </ul>
          <small>网页中新增提示词不会自动上传 GitHub；“导出云端文件”只生成 JSON 文件，也不会自动上传。</small>
        </div>
      ` : ''}
      <div class="cgpt-prompt-list">${list}</div>
      ${editingPromptId ? `
        <div class="cgpt-prompt-editor">
          <div>${editorTitle}</div>
          <input data-cgpt-prompt-title placeholder="标题" value="${escapeHtml(editingTitle)}">
          <textarea data-cgpt-prompt-content placeholder="提示词内容">${escapeHtml(editingContent)}</textarea>
          <div class="cgpt-prompt-foot">
            <button class="cgpt-prompt-primary" data-cgpt-prompt-action="save">保存</button>
            <button data-cgpt-prompt-action="cancel">取消</button>
          </div>
        </div>
      ` : ''}`;
    positionPromptPanel();
  }

  function upsertPromptFromPanel() {
    const panel = ensurePromptPanel();
    const titleInput = panel.querySelector('[data-cgpt-prompt-title]');
    const contentInput = panel.querySelector('[data-cgpt-prompt-content]');
    const content = String(contentInput?.value || '').trim();
    const title = compactTitle(titleInput?.value || content.slice(0, 32));
    if (!content) {
      window.alert('提示词内容不能为空。');
      return;
    }
    const now = Date.now();
    if (editingPromptId && editingPromptId !== 'new') {
      const item = promptState.items.find((candidate) => candidate.id === editingPromptId);
      if (item) {
        item.title = title || item.title;
        item.content = content;
        item.updatedAt = now;
      }
    } else {
      promptState.items.unshift({
        id: uid('prompt'),
        title: title || '未命名提示词',
        content,
        createdAt: now,
        updatedAt: now,
      });
    }
    savePromptState();
    editingPromptId = '';
    renderPromptPanel();
  }

  function deletePrompt(promptId) {
    const item = promptState.items.find((candidate) => candidate.id === promptId);
    if (!item) return;
    if (!window.confirm(`删除提示词“${item.title}”？`)) return;
    promptState.items = promptState.items.filter((candidate) => candidate.id !== promptId);
    savePromptState();
    renderPromptPanel();
  }

  function dispatchPasteLikeInput(input, text) {
    try {
      input.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: 'insertFromPaste',
        data: text,
      }));
    } catch {}
    try {
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertFromPaste',
        data: text,
      }));
    } catch {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function fastPasteIntoContentEditable(input, text) {
    if (!input?.isContentEditable) return false;
    input.focus();
    const selection = window.getSelection();
    if (!selection) return false;
    if (!selection.rangeCount || !input.contains(selection.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const range = selection.rangeCount ? selection.getRangeAt(0) : document.createRange();
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    dispatchPasteLikeInput(input, text);
    return true;
  }

  function insertTextIntoComposer(text) {
    const input = promptComposerInput();
    if (!input) {
      window.alert('没有找到 ChatGPT 输入框。');
      return false;
    }
    input.focus();
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.setRangeText(text, start, end, 'end');
      dispatchPasteLikeInput(input, text);
      return true;
    }
    const selection = window.getSelection();
    if (selection && input.isContentEditable) {
      if (String(text || '').length > 800 && fastPasteIntoContentEditable(input, text)) {
        return true;
      }
      if (!selection.rangeCount || !input.contains(selection.anchorNode)) {
        const range = document.createRange();
        range.selectNodeContents(input);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      const ok = document.execCommand?.('insertText', false, text);
      dispatchPasteLikeInput(input, text);
      if (ok) return true;
      const range = selection.rangeCount ? selection.getRangeAt(0) : document.createRange();
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
    return false;
  }

  function composerSendButton(input = promptComposerInput()) {
    const composer = composerRootFor(input);
    const inputRect = input?.getBoundingClientRect?.();
    const composerRect = composer?.getBoundingClientRect?.();
    const scopes = [composer, document].filter(Boolean);
    const buttons = [...new Set(scopes.flatMap((scope) => [...scope.querySelectorAll('button')]))]
      .filter((button) => (
        button.id !== PROMPT_BUTTON_ID
        && !button.closest?.(`#${APP_ID}, #${MENU_ID}, #${PROMPT_PANEL_ID}, .${IMAGE_DOWNLOAD_SLOT_CLASS}, .${TEXT_DOWNLOAD_SLOT_CLASS}`)
        && isElementVisible(button)
        && !button.disabled
        && button.getAttribute('aria-disabled') !== 'true'
      ));
    const directSendButton = buttons.find((button) => {
      const text = compactTitle(`${button.innerText || ''} ${button.getAttribute('aria-label') || ''} ${button.title || ''} ${button.getAttribute('data-testid') || ''} ${button.id || ''}`);
      return /\u53d1\u9001|\u63d0\u4ea4|send|submit|send-button|composer-submit|submit-button/i.test(text);
    });
    if (directSendButton) return directSendButton;
    const rightEdgeButton = buttons
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const text = compactTitle(`${button.innerText || ''} ${button.getAttribute('aria-label') || ''} ${button.title || ''} ${button.getAttribute('data-testid') || ''}`);
        const html = button.innerHTML || '';
        let score = 0;
        const referenceRect = composerRect || inputRect;
        if (referenceRect) {
          const centerY = rect.top + rect.height / 2;
          const referenceCenterY = referenceRect.top + referenceRect.height / 2;
          if (rect.left > referenceRect.left + referenceRect.width * 0.76) score += 90;
          if (rect.right > referenceRect.right - 92) score += 70;
          if (Math.abs(centerY - referenceCenterY) < Math.max(44, referenceRect.height * 0.38)) score += 45;
        }
        if (inputRect) {
          const centerY = rect.top + rect.height / 2;
          const inputCenterY = inputRect.top + inputRect.height / 2;
          if (rect.left > inputRect.left + inputRect.width * 0.72) score += 70;
          if (rect.right > inputRect.right - 80) score += 55;
          if (Math.abs(centerY - inputCenterY) < 48) score += 45;
          if (rect.left >= inputRect.left && rect.right <= inputRect.right + 90) score += 20;
        }
        if (/\u53d1\u9001|send|submit|arrow-up/i.test(text)) score += 60;
        if (/send-button|composer-submit|submit-button/i.test(text)) score += 80;
        if (button.querySelector('svg')) score += 20;
        if (/M12|arrow-up|path/i.test(html)) score += 12;
        if (rect.width >= 30 && rect.width <= 62 && rect.height >= 30 && rect.height <= 62) score += 28;
        return { button, score, rect };
      })
      .filter((item) => item.score >= 82)
      .sort((a, b) => b.score - a.score || b.rect.right - a.rect.right)[0]?.button;
    if (rightEdgeButton) return rightEdgeButton;
    const explicitSendButton = buttons.find((button) => {
      const testId = button.getAttribute('data-testid') || '';
      const aria = button.getAttribute('aria-label') || '';
      const title = button.title || '';
      return /send-button|composer-submit|submit-button/i.test(testId)
        || /(^|\s)(send|submit)(\s|$)/i.test(`${aria} ${title}`);
    });
    if (explicitSendButton) return explicitSendButton;
    const sendButton = buttons.find((button) => {
      const text = compactTitle(`${button.innerText || ''} ${button.getAttribute('aria-label') || ''} ${button.title || ''} ${button.getAttribute('data-testid') || ''}`);
      return /发送|send|submit/i.test(text);
    });
    if (sendButton) return sendButton;
    return buttons
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const html = button.innerHTML || '';
        let score = 0;
        if (inputRect && rect.left > inputRect.left + inputRect.width * 0.62) score += 30;
        if (inputRect && Math.abs((rect.top + rect.height / 2) - (inputRect.top + inputRect.height / 2)) < 80) score += 20;
        if (/arrow-up|send|M12|path/i.test(html) && button.querySelector('svg')) score += 18;
        if (rect.width <= 58 && rect.height <= 58) score += 10;
        return { button, score };
      })
      .sort((a, b) => b.score - a.score)[0]?.score > 30
      ? buttons
        .map((button) => {
          const rect = button.getBoundingClientRect();
          let score = 0;
          if (inputRect && rect.left > inputRect.left + inputRect.width * 0.62) score += 30;
          if (inputRect && Math.abs((rect.top + rect.height / 2) - (inputRect.top + inputRect.height / 2)) < 80) score += 20;
          if (button.querySelector('svg')) score += 18;
          if (rect.width <= 58 && rect.height <= 58) score += 10;
          return { button, score };
        })
        .sort((a, b) => b.score - a.score)[0].button
      : null;
  }

  function dispatchEnterToComposer(input = promptComposerInput()) {
    if (!input) return false;
    input.focus();
    const eventInit = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    input.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    input.dispatchEvent(new KeyboardEvent('keypress', eventInit));
    input.dispatchEvent(new KeyboardEvent('keyup', eventInit));
    return true;
  }

  async function submitComposerAfterPrompt() {
    const input = promptComposerInput();
    if (!input) return false;
    input.focus();
    await sleep(120);
    const sendButton = await waitForValue(() => composerSendButton(input), 2200, 80);
    if (sendButton) {
      dispatchNativeClickAt(sendButton, 0.5, 0.5);
      dispatchNativeClick(sendButton);
      return true;
    }
    await sleep(120);
    return dispatchEnterToComposer(input);
  }

  function insertPrompt(promptId) {
    const item = findPromptItem(promptId);
    if (!item) return;
    const ok = insertTextIntoComposer(item.content);
    if (ok) {
      closePromptPanel();
      addDiagnosticLog('prompt:insert', { promptId, title: item.title, source: item.source || 'local', ok });
    } else {
      addDiagnosticLog('prompt:insert', { promptId, title: item.title, source: item.source || 'local', ok });
    }
  }

  function findNode(nodeId, nodes = state.tree, parentArray = state.tree) {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.id === nodeId) return { node, parentArray, index };
      if (node.type === 'folder') {
        const nested = findNode(nodeId, node.children, node.children);
        if (nested) return nested;
      }
    }
    return null;
  }

  function findChatNode(chatId, nodes = state.tree) {
    for (const node of nodes) {
      if (node.type === 'chat' && node.chatId === chatId) return node;
      if (node.type === 'folder') {
        const nested = findChatNode(chatId, node.children);
        if (nested) return nested;
      }
    }
    return null;
  }

  function folderContains(folder, nodeId) {
    if (folder.id === nodeId) return true;
    return folder.children.some((child) => (
      child.type === 'folder' && folderContains(child, nodeId)
    ));
  }

  function removeNode(nodeId) {
    const found = findNode(nodeId);
    if (!found) return null;
    return found.parentArray.splice(found.index, 1)[0];
  }

  function parentFolderOfNode(nodeId, nodes = state.tree, parentFolder = null) {
    for (const node of nodes) {
      if (node.id === nodeId) return parentFolder;
      if (node.type === 'folder') {
        const nested = parentFolderOfNode(nodeId, node.children, node);
        if (nested) return nested;
      }
    }
    return null;
  }

  function classifiedChatIds(nodes = state.tree, result = new Set()) {
    nodes.forEach((node) => {
      if (node.type === 'chat') result.add(node.chatId);
      else classifiedChatIds(node.children, result);
    });
    return result;
  }

  function countFolderChats(folder) {
    return folder.children.reduce((total, child) => (
      total + (child.type === 'chat' ? 1 : countFolderChats(child))
    ), 0);
  }

  function chatActivity(chatId) {
    const info = state.known[chatId] || {};
    return Number(info.activity || info.lastSeen || 0);
  }

  function nodeActivity(node) {
    if (node.type === 'chat') return chatActivity(node.chatId);
    return node.children.reduce((latest, child) => (
      Math.max(latest, nodeActivity(child))
    ), 0);
  }

  function sortTreeByRecent(nodes = state.tree) {
    nodes.forEach((node) => {
      if (node.type === 'folder') sortTreeByRecent(node.children);
    });
    nodes.sort((a, b) => nodeActivity(b) - nodeActivity(a));
  }

  function addFolder(parentFolderId = null, chatIdToMove = '') {
    const name = compactTitle(window.prompt('分组名称：', '新分组'));
    if (!name) return;
    const folder = {
      type: 'folder',
      id: uid('folder'),
      title: name,
      collapsed: false,
      children: [],
    };

    const parent = parentFolderId ? findNode(parentFolderId)?.node : null;
    if (parent?.type === 'folder') {
      parent.collapsed = false;
      parent.children.push(folder);
    } else {
      state.tree.push(folder);
    }
    if (chatIdToMove) {
      const chatNode = getOrCreateChatNode(chatIdToMove);
      if (findNode(chatNode.id)) removeNode(chatNode.id);
      folder.children.push(chatNode);
    }
    persistAndRender(true);
  }

  function renameFolder(folderId) {
    const folder = findNode(folderId)?.node;
    if (!folder || folder.type !== 'folder') return;
    const name = compactTitle(window.prompt('新的分组名称：', folder.title));
    if (!name || name === folder.title) return;
    folder.title = name;
    persistAndRender(true);
  }

  function deleteFolder(folderId) {
    const found = findNode(folderId);
    if (!found || found.node.type !== 'folder') return;
    const count = countFolderChats(found.node);
    const message = count
      ? `删除“${found.node.title}”？其中 ${count} 条对话会回到上一级，不会删除原对话。`
      : `删除空分组“${found.node.title}”？`;
    if (!window.confirm(message)) return;
    found.parentArray.splice(found.index, 1, ...found.node.children);
    persistAndRender(true, true);
  }

  function getOrCreateChatNode(chatId) {
    return findChatNode(chatId) || {
      type: 'chat',
      id: uid('chat-node'),
      chatId,
    };
  }

  function unclassifyChatNode(nodeId) {
    const node = findNode(nodeId)?.node;
    if (!node || node.type !== 'chat') return;
    removeNode(nodeId);
    persistAndRender(true);
  }

  function moveChatsToFolder(chatIds, folderId) {
    const folder = findNode(folderId)?.node;
    if (!folder || folder.type !== 'folder') return;
    const uniqueIds = [...new Set(chatIds)].filter(Boolean);
    uniqueIds.forEach((chatId) => {
      const existing = findChatNode(chatId);
      if (existing) removeNode(existing.id);
      folder.children.push(existing || {
        type: 'chat',
        id: uid('chat-node'),
        chatId,
      });
    });
    saveState(true);
    queueRender();
  }

  function addFolderWithChats(chatIds) {
    const name = compactTitle(window.prompt('新分组名称：', '新分组'));
    if (!name) return;
    const folder = {
      type: 'folder',
      id: uid('folder'),
      title: name,
      collapsed: false,
      children: [...new Set(chatIds)].filter(Boolean).map((chatId) => ({
        type: 'chat',
        id: uid('chat-node'),
        chatId,
      })),
    };
    state.tree.push(folder);
    saveState(true);
    queueRender();
  }

  function movePayload(payload, target) {
    if (!payload || !target) return;

    let node = payload.nodeId ? findNode(payload.nodeId)?.node : null;
    if (!node && payload.kind === 'chat' && payload.chatId) {
      node = getOrCreateChatNode(payload.chatId);
    }
    if (!node) return;

    if (target.kind === 'unclassified') {
      if (node.type !== 'chat') return;
      if (findNode(node.id)) removeNode(node.id);
      persistAndRender(true);
      return;
    }

    if (target.kind === 'folder') {
      const folder = findNode(target.nodeId)?.node;
      if (!folder || folder.type !== 'folder') return;
      if (node.id === folder.id) return;
      if (node.type === 'folder' && folderContains(node, folder.id)) return;
      if (node.type === 'chat' && parentFolderOfNode(node.id)?.id === folder.id) return;

      if (findNode(node.id)) removeNode(node.id);
      if (node.type === 'chat') {
        const duplicate = findChatNode(node.chatId);
        if (duplicate && duplicate.id !== node.id) removeNode(duplicate.id);
      }
      folder.children.push(node);
      persistAndRender(true);
      return;
    }

    if (target.kind === 'before') {
      if (node.id === target.nodeId) return;
      const destination = findNode(target.nodeId);
      if (!destination) return;
      if (node.type === 'folder' && folderContains(node, target.nodeId)) return;
      if (findNode(node.id)) removeNode(node.id);
      const refreshed = findNode(target.nodeId);
      if (!refreshed) return;
      refreshed.parentArray.splice(refreshed.index, 0, node);
      persistAndRender(true);
      return;
    }

    if (target.kind === 'root') {
      if (findNode(node.id)) removeNode(node.id);
      state.tree.push(node);
      persistAndRender(true);
    }
  }

  function scanNativeChats() {
    if (!ENABLE_CONVERSATION_TREE) return;
    if (!ensureMounted() || rendering) return;

    let changed = false;
    let renderNeeded = false;
    const previousRows = nativeRows;
    const now = Date.now();
    const nextRows = new Map();
    const anchors = [...historyRoot.querySelectorAll('a[href]')]
      .filter((anchor) => !anchor.closest('.cgpt-fallback-chat'));

    anchors.forEach((anchor) => {
      const info = chatInfoFromHref(anchor.getAttribute('href'));
      if (!info) return;
      const row = anchor.closest('li');
      if (!row || row === host) return;

      nextRows.set(info.chatId, row);
      row.dataset.cgptChatId = info.chatId;
      anchor.draggable = true;
      row.querySelectorAll('button').forEach((button) => { button.draggable = false; });

      const title = titleFromAnchor(anchor);
      const previous = state.known[info.chatId] || {};
      if (previous.title !== title || previous.url !== info.url) {
        state.known[info.chatId] = {
          ...previous,
          title,
          url: info.url,
          firstSeen: previous.firstSeen || previous.lastSeen || now,
          lastSeen: now,
        };
        changed = true;
        renderNeeded = true;
      } else if (!previous.lastSeen) {
        state.known[info.chatId] = {
          ...previous,
          lastSeen: now,
        };
        changed = true;
      }
    });

    nativeRows = nextRows;
    const rowsChanged = previousRows.size !== nextRows.size
      || [...nextRows].some(([chatId, row]) => previousRows.get(chatId) !== row);

    const classified = classifiedChatIds();
    const directRows = [...nativeList.children].filter((row) => row !== host);
    directRows.forEach((row, index) => {
      const anchor = row.querySelector('a[href]');
      const info = chatInfoFromHref(anchor?.getAttribute('href'));
      if (!info) return;
      const known = state.known[info.chatId] || {};
      if (sortPendingOnLoad && classified.has(info.chatId)) {
        known.activity = now - index * 10;
        state.known[info.chatId] = known;
        changed = true;
      } else if (!known.activity) {
        known.activity = now - index * 1000;
        state.known[info.chatId] = known;
        changed = true;
      }
    });

    const activeId = chatInfoFromHref(location.href)?.chatId || '';
    if (activeId && activeId !== lastActiveChatId) {
      const known = state.known[activeId] || {
        title: document.title || '未命名对话',
        url: `/c/${encodeURIComponent(activeId)}`,
      };
      known.activity = now;
      known.lastSeen = now;
      state.known[activeId] = known;
      lastActiveChatId = activeId;
      changed = true;
    }

    if (sortPendingOnLoad) {
      sortTreeByRecent();
      sortPendingOnLoad = false;
      changed = true;
      renderNeeded = true;
    }

    if (changed) saveState();
    updateFallbackChatVisualState();
    if (renderNeeded || rowsChanged || !host.firstElementChild) queueRender();
  }

  function scheduleScan() {
    if (!ENABLE_CONVERSATION_TREE) return;
    if (document.hidden) return;
    clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => runWhenIdle(scanNativeChats, 900), 240);
  }

  function persistAndRender(immediate = false, allowEmpty = false) {
    saveState(immediate, allowEmpty);
    queueRender();
  }

  function queueRender() {
    clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderTree, 20);
  }

  function renderFolder(folder, depth = 0) {
    const collapsed = Boolean(folder.collapsed);
    const children = collapsed
      ? ''
      : folder.children.map((node) => {
          if (node.type === 'folder') return renderFolder(node, depth + 1);
          return `<li class="cgpt-chat-slot"
                      data-chat-node-id="${escapeHtml(node.id)}"
                      data-chat-id="${escapeHtml(node.chatId)}"
                      data-depth="${depth + 1}"></li>`;
        }).join('');

    return `
      <li class="cgpt-folder" data-folder-node-id="${escapeHtml(folder.id)}">
        <div class="cgpt-folder-row"
             style="--cgpt-depth:${depth}"
             draggable="true"
             data-folder-id="${escapeHtml(folder.id)}"
             data-node-id="${escapeHtml(folder.id)}">
          <button class="cgpt-tree-button cgpt-chevron"
                  data-cgpt-action="toggle-folder"
                  data-node-id="${escapeHtml(folder.id)}"
                  title="${collapsed ? '展开分组' : '折叠分组'}">
            ${icons.chevron(!collapsed)}
          </button>
          <span class="cgpt-folder-icon">${icons.folder}</span>
          <button class="cgpt-folder-title"
                  data-cgpt-action="toggle-folder"
                  data-node-id="${escapeHtml(folder.id)}"
                  title="${escapeHtml(folder.title)}">${escapeHtml(folder.title)}</button>
          <span class="cgpt-folder-count">${countFolderChats(folder) || ''}</span>
          <button class="cgpt-tree-button cgpt-folder-action"
                  data-cgpt-action="add-child"
                  data-node-id="${escapeHtml(folder.id)}"
                  title="新建子分组">${icons.plus}</button>
          <button class="cgpt-tree-button cgpt-folder-action"
                  data-cgpt-action="folder-menu"
                  data-node-id="${escapeHtml(folder.id)}"
                  title="分组操作">${icons.dots}</button>
        </div>
        <ul class="cgpt-folder-children ${collapsed ? 'cgpt-collapsed' : ''}">${children}</ul>
      </li>`;
  }

  function renderUngroupedFolder() {
    const chats = unclassifiedChats();
    const activeId = currentChatId();
    const children = ungroupedCollapsed
      ? ''
      : chats.map(({ chatId, info }) => `
          <li class="cgpt-fallback-chat cgpt-ungrouped-chat ${activeId === chatId ? 'cgpt-active-chat' : ''}"
              style="--cgpt-depth:1"
              draggable="true"
              data-chat-id="${escapeHtml(chatId)}"
              data-cgpt-ungrouped-chat="${escapeHtml(chatId)}"
              ${activeId === chatId ? 'aria-current="page"' : ''}>
            <a class="cgpt-fallback-link"
               href="${escapeHtml(info.url || `/c/${encodeURIComponent(chatId)}`)}"
               title="${escapeHtml(info.title || '未命名对话')}">${escapeHtml(info.title || '未命名对话')}</a>
            <button class="cgpt-proxy-options"
                    type="button"
                    data-cgpt-proxy-options="${escapeHtml(chatId)}"
                    title="对话操作"
                    aria-label="打开“${escapeHtml(info.title || '未命名对话')}”的对话选项">
              ${icons.dots}
            </button>
          </li>`).join('');
    return `
      <li class="cgpt-folder cgpt-system-folder"
          data-cgpt-ungrouped-folder="true">
        <div class="cgpt-folder-row"
             style="--cgpt-depth:0"
             data-cgpt-ungrouped-drop="true">
          <button class="cgpt-tree-button cgpt-chevron"
                  data-cgpt-action="toggle-ungrouped"
                  title="${ungroupedCollapsed ? '展开未分组' : '折叠未分组'}">
            ${icons.chevron(!ungroupedCollapsed)}
          </button>
          <span class="cgpt-folder-icon">${icons.folder}</span>
          <button class="cgpt-folder-title"
                  data-cgpt-action="toggle-ungrouped"
                  title="未分组">未分组</button>
          <span class="cgpt-folder-count">${chats.length || ''}</span>
        </div>
        <ul class="cgpt-folder-children ${ungroupedCollapsed ? 'cgpt-collapsed' : ''}">
          ${children}
        </ul>
      </li>`;
  }

  function restoreManagedNativeRows() {
    if (!nativeList) return;
    const movedRows = [
      ...(host?.querySelectorAll('li.cgpt-native-chat') || []),
      ...(parkingLot?.querySelectorAll('li[data-cgpt-chat-id]') || []),
    ];
    movedRows.forEach((row) => {
      resetNativeRow(row);
      nativeList.append(row);
    });
  }

  function resetNativeRow(row) {
    row.classList.remove(
      'cgpt-native-chat',
      'cgpt-native-source-row',
      'cgpt-native-unclassified-row',
      'cgpt-active-chat',
      'cgpt-opening-chat',
      'cgpt-open-failed',
      'cgpt-dragging'
    );
    delete row.dataset.cgptTreeNodeId;
    delete row.dataset.cgptTreeManaged;
    row.style.removeProperty('--cgpt-depth');
  }

  function insertUnclassifiedRow(row, chatId) {
    resetNativeRow(row);
    const activity = chatActivity(chatId);
    const directRows = [...nativeList.children].filter((candidate) => (
      candidate !== host && candidate !== row && candidate.querySelector('a[href]')
    ));
    const before = directRows.find((candidate) => {
      const candidateInfo = chatInfoFromHref(
        candidate.querySelector('a[href]')?.getAttribute('href')
      );
      return candidateInfo && chatActivity(candidateInfo.chatId) < activity;
    });
    nativeList.insertBefore(row, before || null);
  }

  function placeChatRows() {
    const classified = classifiedChatIds();
    const activeId = currentChatId();
    const placedNativeChatIds = new Set();

    host.querySelectorAll('.cgpt-chat-slot').forEach((slot) => {
      const chatId = slot.dataset.chatId;
      const nodeId = slot.dataset.chatNodeId;
      const depth = Number(slot.dataset.depth || 1);
      const info = state.known[chatId] || {};
      const nativeRow = nativeRows.get(chatId);
      const nativeAnchor = nativeRow?.isConnected ? nativeAnchorForChat(chatId) : null;

      if (!preloadHistoryRun?.running && nativeRow?.isConnected && nativeAnchor) {
        resetNativeRow(nativeRow);
        nativeRow.classList.add('cgpt-native-chat');
        nativeRow.dataset.cgptChatId = chatId;
        nativeRow.dataset.cgptTreeNodeId = nodeId || '';
        nativeRow.dataset.cgptTreeManaged = 'true';
        nativeRow.style.setProperty('--cgpt-depth', depth);
        nativeRow.draggable = true;
        nativeRow.classList.toggle('cgpt-active-chat', activeId === chatId);
        if (activeId === chatId) nativeRow.setAttribute('aria-current', 'page');
        else nativeRow.removeAttribute('aria-current');
        nativeAnchor.draggable = true;
        slot.replaceWith(nativeRow);
        placedNativeChatIds.add(chatId);
        return;
      }

      slot.className = `cgpt-fallback-chat ${activeId === chatId ? 'cgpt-active-chat' : ''}`;
      slot.style.setProperty('--cgpt-depth', depth);
      slot.draggable = true;
      slot.dataset.cgptTreeNodeId = nodeId;
      if (activeId === chatId) slot.setAttribute('aria-current', 'page');
      else slot.removeAttribute('aria-current');
      slot.innerHTML = `
        <a class="cgpt-fallback-link"
           data-cgpt-fallback="true"
           href="${escapeHtml(info.url || `/c/${encodeURIComponent(chatId)}`)}"
           title="${escapeHtml(info.title || '未命名对话')}">${escapeHtml(info.title || '未命名对话')}</a>`;
      slot.insertAdjacentHTML('beforeend', `
        <button class="cgpt-proxy-options"
                type="button"
                data-cgpt-proxy-options="${escapeHtml(chatId)}"
                title="对话操作"
                aria-label="打开“${escapeHtml(info.title || '未命名对话')}”的对话选项">
          ${icons.dots}
        </button>`);
    });

    nativeRows.forEach((row, chatId) => {
      if (placedNativeChatIds.has(chatId)) return;
      if (!row.isConnected || row.closest(`#${APP_ID}`) || row.parentElement === parkingLot) {
        insertUnclassifiedRow(row, chatId);
      }
      const node = classified.has(chatId) ? findChatNode(chatId) : null;
      row.classList.remove('cgpt-native-source-row', 'cgpt-native-unclassified-row');
      if (node) {
        row.dataset.cgptTreeNodeId = node.id || '';
      } else {
        row.classList.add('cgpt-native-unclassified-row');
        row.dataset.cgptTreeNodeId = '';
      }
      row.draggable = true;
    });
  }

  function bindFallbackRowDirectHandlers() {
    host?.querySelectorAll?.('.cgpt-fallback-chat[data-chat-id]').forEach((row) => {
      if (row.dataset.cgptDirectOpenBound === 'true') return;
      row.dataset.cgptDirectOpenBound = 'true';
      row.addEventListener('click', (event) => {
        if (event.target.closest?.('[data-cgpt-proxy-options], button')) return;
        const chatId = row.dataset.chatId;
        const fallbackLink = row.querySelector('.cgpt-fallback-link[href]');
        if (!chatId) return;
        event.preventDefault();
        event.stopPropagation();
        addDiagnosticLog('click:direct-row', {
          chatId,
          href: fallbackLink?.getAttribute('href') || '',
          target: event.target?.tagName || '',
        });
        requestOpenChat(chatId, fallbackLink?.getAttribute('href') || '');
      }, true);
    });
  }

  function renderTree() {
    if (!ensureMounted() || rendering) return;
    rendering = true;
    ignoreMutationsUntil = Date.now() + 350;

    restoreManagedNativeRows();
    host.innerHTML = `<ul class="cgpt-tree-root" data-drop-root="true">${
      state.tree.map((node) => node.type === 'folder' ? renderFolder(node) : '').join('')
    }${renderUngroupedFolder()}</ul>`;
    placeChatRows();
    bindFallbackRowDirectHandlers();

    rendering = false;
  }

  function flattenFolders(nodes = state.tree, depth = 0, result = []) {
    nodes.forEach((node) => {
      if (node.type !== 'folder') return;
      result.push({ folder: node, depth });
      flattenFolders(node.children, depth + 1, result);
    });
    return result;
  }

  function folderContainingChat(chatId, nodes = state.tree) {
    for (const node of nodes) {
      if (node.type !== 'folder') continue;
      if (node.children.some((child) => child.type === 'chat' && child.chatId === chatId)) {
        return node;
      }
      const nested = folderContainingChat(chatId, node.children);
      if (nested) return nested;
    }
    return null;
  }

  function folderChatEntries(folder, path = [folder.title], result = []) {
    folder.children.forEach((node) => {
      if (node.type === 'chat') {
        result.push({
          chatId: node.chatId,
          nodeId: node.id,
          path: path.join(' / '),
          title: state.known[node.chatId]?.title || '未命名对话',
        });
      } else {
        folderChatEntries(node, [...path, node.title], result);
      }
    });
    return result;
  }

  function updateRenameEditorState() {
    const modal = document.getElementById(RENAME_ID);
    if (!modal || modal.hidden) return;
    let changed = 0;
    modal.querySelectorAll('.cgpt-rename-input').forEach((input) => {
      const isChanged = compactTitle(input.value) !== input.dataset.original;
      input.classList.toggle('cgpt-changed', isChanged);
      if (isChanged && compactTitle(input.value)) changed += 1;
    });
    const count = modal.querySelector('[data-cgpt-rename-count]');
    if (count) count.textContent = `${changed} 条有修改`;
    const save = modal.querySelector('[data-cgpt-rename-action="save"]');
    if (save) save.disabled = changed === 0 || Boolean(renameRun?.running);
  }

  function showBatchRenameDialog(folderId) {
    const folder = findNode(folderId)?.node;
    if (!folder || folder.type !== 'folder') return;
    const entries = folderChatEntries(folder);
    const modal = ensureRenameModal();
    closeMenu();
    renameRun = null;
    modal.innerHTML = `
      <div class="cgpt-rename-dialog">
        <header class="cgpt-rename-head">
          <h2>批量重命名“${escapeHtml(folder.title)}”中的对话</h2>
          <p>直接编辑名称。未修改的行会自动跳过；保存后将逐条调用 ChatGPT 原生重命名。</p>
        </header>
        <div class="cgpt-rename-toolbar">
          <span>共 ${entries.length} 条（包含子分组）</span>
          <span data-cgpt-rename-count>0 条有修改</span>
        </div>
        <div class="cgpt-rename-list">
          ${entries.length ? entries.map((entry) => `
            <label class="cgpt-rename-row" data-chat-id="${escapeHtml(entry.chatId)}">
              <span class="cgpt-rename-path" title="${escapeHtml(entry.path)}">${escapeHtml(entry.path)}</span>
              <input class="cgpt-rename-input"
                     type="text"
                     value="${escapeHtml(entry.title)}"
                     data-original="${escapeHtml(entry.title)}"
                     data-chat-id="${escapeHtml(entry.chatId)}"
                     autocomplete="off"
                     spellcheck="false">
              <span class="cgpt-rename-status" data-cgpt-rename-status>未修改</span>
            </label>`).join('') : `
            <div class="cgpt-menu-title">该分组内没有对话</div>
          `}
        </div>
        <footer class="cgpt-rename-foot">
          <button class="cgpt-rename-button" data-cgpt-rename-action="close">取消</button>
          <button class="cgpt-rename-button cgpt-primary"
                  data-cgpt-rename-action="save"
                  ${entries.length ? 'disabled' : 'disabled'}>保存并开始</button>
        </footer>
      </div>`;
    modal.hidden = false;
    modal.querySelector('.cgpt-rename-input')?.focus();
    updateRenameEditorState();
  }

  function closeBatchRenameDialog() {
    if (renameRun?.running) return;
    const modal = document.getElementById(RENAME_ID);
    if (modal) modal.hidden = true;
    renameRun = null;
  }

  function setRenameStatus(chatId, text, stateName = '') {
    const row = document.querySelector(
      `#${RENAME_ID} .cgpt-rename-row[data-chat-id="${CSS.escape(chatId)}"]`
    );
    const status = row?.querySelector('[data-cgpt-rename-status]');
    if (!status) return;
    status.textContent = text;
    status.dataset.state = stateName;
  }

  function waitForValue(getValue, timeout = 3500, interval = 70) {
    return new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        const value = getValue();
        if (value) {
          resolve(value);
          return;
        }
        if (Date.now() - started >= timeout) {
          resolve(null);
          return;
        }
        window.setTimeout(check, interval);
      };
      check();
    });
  }

  function setNativeInputValue(input, value) {
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value,
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function menuItemByText(menu, pattern) {
    return [...menu.querySelectorAll('[role="menuitem"], button')]
      .find((element) => pattern.test(compactTitle(element.innerText)));
  }

  function renameInputForRow(row, oldTitle) {
    const rowInput = row.querySelector('input[type="text"], textarea');
    if (rowInput) return rowInput;
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      .filter((dialog) => dialog.id !== RENAME_ID);
    for (const dialog of dialogs) {
      const inputs = [...dialog.querySelectorAll('input[type="text"], textarea')];
      const likely = inputs.find((input) => (
        input.value === oldTitle
        || /重命名|rename|标题|title/i.test(
          `${input.getAttribute('aria-label') || ''} ${input.getAttribute('placeholder') || ''}`
        )
      ));
      if (likely) return likely;
    }
    return null;
  }

  function saveRenameControl(input, row) {
    const scope = input.closest('form, [role="dialog"]') || row;
    return [...scope.querySelectorAll('button')]
      .find((button) => /^(保存|Save|确定|Confirm)(?:\s|$)/i.test(
        compactTitle(button.innerText || button.getAttribute('aria-label'))
      ));
  }

  function clickWithoutAnchorNavigation(element) {
    const anchor = element?.closest?.('a[href]');
    const preventNavigation = (event) => {
      if (event.target === element || element.contains?.(event.target)) {
        event.preventDefault();
      }
    };
    anchor?.addEventListener('click', preventNavigation, true);
    element.click();
    anchor?.removeEventListener('click', preventNavigation, true);
  }

  function liveNativeAnchorForChat(chatId) {
    const roots = [historyRoot, document.querySelector('#history'), document]
      .filter(Boolean);
    for (const root of [...new Set(roots)]) {
      const anchor = [...root.querySelectorAll('a[href*="/c/"]')]
        .find((candidate) => (
          chatInfoFromHref(candidate.getAttribute('href'))?.chatId === chatId
          && !candidate.closest('.cgpt-fallback-chat')
          && !candidate.closest(`#${APP_ID}`)
          && !candidate.closest(`#${MENU_ID}`)
        ));
      if (anchor) return anchor;
    }
    return null;
  }

  function nativeAnchorForChat(chatId) {
    const row = nativeRows.get(chatId);
    const rowAnchor = row?.isConnected ? [...row.querySelectorAll('a[href]')]
      .find((anchor) => chatInfoFromHref(anchor.getAttribute('href'))?.chatId === chatId)
      : null;
    if (rowAnchor) return rowAnchor;

    const liveAnchor = liveNativeAnchorForChat(chatId);
    const liveRow = liveAnchor?.closest('li');
    if (liveAnchor && liveRow) {
      nativeRows.set(chatId, liveRow);
      liveRow.dataset.cgptChatId = chatId;
    }
    return liveAnchor || null;
  }

  function clickLoadedNativeChat(chatId) {
    const anchor = nativeAnchorForChat(chatId);
    if (!anchor) return false;
    wakeNativeRow(anchor.closest('li'));
    anchor.click();
    return true;
  }

  function nativeOptionsButtonForChat(chatId) {
    const row = nativeRows.get(chatId);
    if (!row) return null;
    const buttons = [...row.querySelectorAll('button')]
      .filter((button) => !button.closest(`#${APP_ID}, #${MENU_ID}`));
    if (!buttons.length) return null;
    return buttons.find((button) => {
      const label = compactTitle([
        button.getAttribute('aria-label'),
        button.getAttribute('title'),
        button.innerText,
      ].filter(Boolean).join(' '));
      return /对话选项|conversation options|更多|more|选项|options/i.test(label);
    }) || buttons.find((button) => (
      button.querySelectorAll('svg circle').length >= 3
    )) || buttons.at(-1);
  }

  function wakeNativeRow(row) {
    if (!row) return;
    ['pointerover', 'mouseover', 'mouseenter'].forEach((type) => {
      row.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    });
  }

  function chatHref(chatId, fallbackHref = '') {
    const fallbackInfo = chatInfoFromHref(fallbackHref);
    if (fallbackInfo?.chatId === chatId) return fallbackHref;
    const knownUrl = state.known[chatId]?.url;
    if (knownUrl) return knownUrl;
    return `/c/${encodeURIComponent(chatId)}`;
  }

  function isChatLocation(chatId) {
    return chatInfoFromHref(location.href)?.chatId === chatId;
  }

  function currentChatId() {
    return chatInfoFromHref(location.href)?.chatId || '';
  }

  function updateFallbackChatVisualState(chatId = '') {
    const activeId = currentChatId();
    host?.querySelectorAll?.('.cgpt-fallback-chat[data-chat-id], li.cgpt-native-chat[data-cgpt-chat-id]')
      .forEach((row) => {
      const rowChatId = row.dataset.chatId || row.dataset.cgptChatId || '';
      const isActive = Boolean(activeId && rowChatId === activeId);
      row.classList.toggle('cgpt-active-chat', isActive);
      if (isActive) row.setAttribute('aria-current', 'page');
      else row.removeAttribute('aria-current');
      if (chatId && rowChatId === chatId && isActive) {
        row.classList.remove('cgpt-opening-chat', 'cgpt-open-failed');
      }
    });
  }

  function markFallbackChatOpening(chatId, stateName = 'opening') {
    host?.querySelectorAll?.(
      `.cgpt-fallback-chat[data-chat-id="${CSS.escape(chatId)}"], li.cgpt-native-chat[data-cgpt-chat-id="${CSS.escape(chatId)}"]`
    )
      .forEach((row) => {
        row.classList.toggle('cgpt-opening-chat', stateName === 'opening');
        row.classList.toggle('cgpt-open-failed', stateName === 'failed');
      });
  }

  function dispatchNativeClick(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect?.() || {};
    const clientX = Math.max(1, Math.round((rect.left || 0) + (rect.width || 40) / 2));
    const clientY = Math.max(1, Math.round((rect.top || 0) + (rect.height || 28) / 2));
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      const EventClass = type.startsWith('pointer') && typeof PointerEvent === 'function'
        ? PointerEvent
        : MouseEvent;
      element.dispatchEvent(new EventClass(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        buttons: type.endsWith('down') ? 1 : 0,
        clientX,
        clientY,
      }));
    });
    try { element.click?.(); } catch {}
    return true;
  }

  function dispatchNativeClickAt(element, xRatio = 0.5, yRatio = 0.5) {
    if (!element) return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    const clientX = Math.min(innerWidth - 2, Math.max(2, Math.round(rect.left + rect.width * xRatio)));
    const clientY = Math.min(innerHeight - 2, Math.max(2, Math.round(rect.top + rect.height * yRatio)));
    const pointElement = document.elementFromPoint(clientX, clientY);
    const target = pointElement?.closest?.('button, a, [role="button"]') || pointElement || element;
    ['pointerover', 'mouseover', 'pointermove', 'mousemove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']
      .forEach((type) => {
        const EventClass = type.startsWith('pointer') && typeof PointerEvent === 'function'
          ? PointerEvent
          : MouseEvent;
        target.dispatchEvent(new EventClass(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          button: 0,
          buttons: type.endsWith('down') ? 1 : 0,
          clientX,
          clientY,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        }));
      });
    return true;
  }

  function pageBridgeOpenChat(chatId, fallbackHref = '') {
    try {
      const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const href = chatHref(chatId, fallbackHref);
      if (typeof pageWindow.__cgptConversationTreeOpenChat === 'function') {
        const result = pageWindow.__cgptConversationTreeOpenChat(chatId, href);
        addDiagnosticLog('open:bridge-call', { chatId, href, result });
        if (result?.ok) return true;
        addDiagnosticLog('open:bridge-rejected', { chatId, href, result });
        return false;
      }
      const event = new CustomEvent(PAGE_OPEN_EVENT, {
        detail: { chatId, href, result: null },
      });
      pageWindow.dispatchEvent(event);
      if (event.detail?.result?.ok) return true;
      addDiagnosticLog('open:bridge-event', {
        chatId,
        href,
        hasLiveAnchor: Boolean(liveNativeAnchorForChat(chatId)),
      });
      // 发出事件不等于页面已经切换；调用方必须继续执行原生点击兜底。
      return false;
    } catch (error) {
      addDiagnosticLog('open:bridge-error', {
        chatId,
        message: error?.message || String(error),
      });
      return false;
    }
  }

  function historyScrollContainer() {
    const starts = [
      historyRoot,
      nativeList,
      recentHeader,
      document.querySelector('#history'),
    ].filter(Boolean);

    const isScrollable = (element) => {
      if (!element || element === document.documentElement || element === document.body) return false;
      const style = getComputedStyle(element);
      const overflowY = style.overflowY || style.overflow;
      const historyNode = historyRoot || nativeList;
      const looksLikeHistoryScroller = (historyNode && element.contains?.(historyNode))
        || element.matches?.('[data-radix-scroll-area-viewport], [class*="scroll"], [class*="overflow"]');
      return element.scrollHeight > element.clientHeight + 40
        && (/(auto|scroll|overlay)/i.test(overflowY) || looksLikeHistoryScroller);
    };

    for (const start of starts) {
      for (let element = start; element && element !== document.body; element = element.parentElement) {
        if (isScrollable(element)) return element;
      }
    }

    return [...document.querySelectorAll('aside div, nav div, [class*="scroll"], [data-radix-scroll-area-viewport]')]
      .filter((element) => element.contains?.(historyRoot || nativeList))
      .sort((a, b) => (a.clientHeight || 0) - (b.clientHeight || 0))
      .find(isScrollable)
      || document.scrollingElement
      || document.documentElement;
  }

  function setHistoryPreloadButtonState(button, status = {}) {
    const target = button || headerActions?.querySelector('[data-cgpt-action="preload-history"]');
    if (!target) return;
    const label = target.querySelector('[data-cgpt-load-label]');
    target.classList.toggle('cgpt-loading', status.running === true);
    target.classList.toggle('cgpt-done', status.done === true);
    if (label) {
      const count = Number(status.count || 0);
      label.hidden = !status.running && !status.done;
      label.textContent = count ? String(count) : '...';
    }
    if (status.running) {
      target.title = `正在加载最近对话，已发现 ${status.count || 0} 条；再次点击可停止`;
      target.setAttribute('aria-label', target.title);
    } else if (status.done) {
      target.title = `最近对话加载完成，已发现 ${status.count || 0} 条`;
      target.setAttribute('aria-label', target.title);
      window.setTimeout(() => {
        target.classList.remove('cgpt-done');
        if (label) label.hidden = true;
        target.title = '手动预加载所有历史对话（再次点击可停止）';
        target.setAttribute('aria-label', '手动预加载所有历史对话');
      }, 2600);
    } else {
      target.title = '手动预加载所有历史对话（再次点击可停止）';
      target.setAttribute('aria-label', '手动预加载所有历史对话');
      if (label) label.hidden = true;
    }
  }

  async function preloadAllHistoryChats(button = null) {
    if (preloadHistoryRun?.running) {
      preloadHistoryRun.cancelled = true;
      setHistoryPreloadButtonState(button, {
        running: true,
        count: Object.keys(state.known || {}).length,
      });
      return;
    }

    if (!ensureMounted()) return;
    const scroller = historyScrollContainer();
    if (!scroller) {
      window.alert('没有找到左侧最近对话的滚动区域。');
      return;
    }

    const run = { running: true, cancelled: false };
    preloadHistoryRun = run;
    const originalTop = scroller.scrollTop || 0;
    let lastCount = -1;
    let stableRounds = 0;
    let direction = 1;

    try {
      scanNativeChats();
      setHistoryPreloadButtonState(button, {
        running: true,
        count: Object.keys(state.known || {}).length,
      });

      for (let round = 0; round < 240 && !run.cancelled; round += 1) {
        const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        if (maxScroll <= 0) break;

        const targetTop = direction > 0 ? maxScroll : 0;
        scroller.scrollTop = targetTop;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await sleep(round < 8 ? 420 : 650);
        scanNativeChats();

        const count = Object.keys(state.known || {}).length;
        setHistoryPreloadButtonState(button, { running: true, count });
        if (count <= lastCount) stableRounds += 1;
        else stableRounds = 0;
        lastCount = count;

        if (stableRounds >= 8 && direction > 0) {
          direction = -1;
          stableRounds = 0;
        } else if (stableRounds >= 5 && direction < 0) {
          break;
        }
      }
    } finally {
      if (scroller && Number.isFinite(originalTop)) {
        scroller.scrollTop = Math.max(0, Math.min(originalTop, scroller.scrollHeight));
      }
      preloadHistoryRun = null;
      scanNativeChats();
      queueRender();
      setHistoryPreloadButtonState(button, {
        done: true,
        count: Object.keys(state.known || {}).length,
      });
    }
  }

  function forceOpenChat(chatId, fallbackHref = '') {
    const href = chatHref(chatId, fallbackHref);
    const url = new URL(href, location.href);
    if (url.href === location.href || isChatLocation(chatId)) return;
    addDiagnosticLog('open:hard-navigation-fallback', { chatId, href: url.href });
    markFallbackChatOpening(chatId, 'opening');
    window.location.assign(url.href);
  }

  function requestOpenChat(chatId, fallbackHref = '') {
    if (!chatId) return;
    const requestSeq = ++openChatRequestSeq;
    markFallbackChatOpening(chatId, 'opening');
    addDiagnosticLog('open:request', { chatId, fallbackHref, requestSeq });
    queuedOpenChat = { chatId, fallbackHref };
    if (openChatRunning) return;
    void drainOpenChatQueue();
    if (hardNavigationFallbackEnabled) {
      window.setTimeout(() => {
        if (requestSeq !== openChatRequestSeq) return;
        if (isChatLocation(chatId)) return;
        addDiagnosticLog('open:request-timeout-hard-navigation', { chatId, fallbackHref, requestSeq });
        forceOpenChat(chatId, fallbackHref);
      }, 9000);
    }
  }

  async function drainOpenChatQueue() {
    openChatRunning = true;
    try {
      while (queuedOpenChat) {
        const job = queuedOpenChat;
        queuedOpenChat = null;
        try {
          addDiagnosticLog('open:queue-start', {
            chatId: job.chatId,
            fallbackHref: job.fallbackHref,
          });
          const opened = await openChatThroughNativeRow(job.chatId, job.fallbackHref);
          addDiagnosticLog('open:queue-finish', {
            chatId: job.chatId,
            opened,
            currentUrl: location.href,
            isCurrent: isChatLocation(job.chatId),
          });
          if (!opened && !isChatLocation(job.chatId)) {
            markFallbackChatOpening(job.chatId, 'failed');
            showImageDownloadToast('该对话尚未加载，请先点“最近”右侧的加载按钮', false);
            if (hardNavigationFallbackEnabled) forceOpenChat(job.chatId, job.fallbackHref);
          }
          updateFallbackChatVisualState(job.chatId);
        } catch (error) {
          console.warn('[ChatGPT 最近对话分组] 原生打开分组对话失败：', error);
          addDiagnosticLog('open:queue-error', {
            chatId: job.chatId,
            message: error?.message || String(error),
          });
          markFallbackChatOpening(job.chatId, 'failed');
          showImageDownloadToast('原生切换失败，已保持当前页面', false);
          if (hardNavigationFallbackEnabled) forceOpenChat(job.chatId, job.fallbackHref);
        }
        await sleep(520);
      }
    } finally {
      openChatRunning = false;
    }
  }

  async function waitForChatLocation(chatId, timeout = 950) {
    return Boolean(await waitForValue(() => isChatLocation(chatId), timeout, 80));
  }

  async function openChatThroughNativeRow(chatId, fallbackHref = '') {
    if (!chatId || isChatLocation(chatId)) return true;
    scanNativeChats();

    let anchor = nativeAnchorForChat(chatId);
    const before = location.href;
    addDiagnosticLog('open:start', {
      chatId,
      fallbackHref,
      before,
      hasAnchor: Boolean(anchor),
      nativeRows: nativeRows.size,
    });

    if (!anchor) {
      addDiagnosticLog('open:no-native-anchor-click-skipped-loading', {
        chatId,
        reason: '点击时不再自动滚动加载历史；请先点最近右侧加载按钮',
      });
      markFallbackChatOpening(chatId, 'failed');
      return false;
    }

    if (anchor) {
      wakeNativeRow(anchor.closest('li'));
      const usedBridge = pageBridgeOpenChat(chatId, fallbackHref);
      if (!usedBridge) dispatchNativeClick(anchor);
      addDiagnosticLog('open:native-click', {
        chatId,
        usedBridge,
        href: anchor.getAttribute('href') || '',
      });
      if (await waitForChatLocation(chatId, 4200)) return true;

      wakeNativeRow(anchor.closest('li'));
      dispatchNativeClick(anchor);
      addDiagnosticLog('open:native-click-retry', { chatId });
      if (await waitForChatLocation(chatId, 2600)) return true;

      if (location.href === before && !isChatLocation(chatId)) {
        addDiagnosticLog('open:native-click-no-change-no-hard-navigation', { chatId, before });
        markFallbackChatOpening(chatId, 'failed');
      }
      addDiagnosticLog('open:native-click-failed', {
        chatId,
        before,
        after: location.href,
      });
      return false;
    }

    const href = chatHref(chatId, fallbackHref);
    const url = new URL(href, location.href);
    if (url.href === location.href || isChatLocation(chatId)) return false;

    if (pageBridgeOpenChat(chatId, fallbackHref) && await waitForChatLocation(chatId, 900)) {
      addDiagnosticLog('open:bridge-only-success', { chatId });
      return true;
    }

    addDiagnosticLog('open:no-native-anchor-no-hard-navigation', { chatId, href: url.href });
    markFallbackChatOpening(chatId, 'failed');
    return false;
  }

  function scrollHistoryToLoad(chatId) {
    const sidebar = historyScrollContainer();
    if (!sidebar) return;

    const sortedIds = Object.keys(state.known || {}).sort((a, b) => {
      const activityA = state.known[a]?.activity || 0;
      const activityB = state.known[b]?.activity || 0;
      return activityB - activityA;
    });

    const chatIndex = sortedIds.indexOf(chatId);
    if (chatIndex === -1) {
      sidebar.scrollTop = sidebar.scrollHeight;
      return;
    }

    const maxScroll = Math.max(0, sidebar.scrollHeight - sidebar.clientHeight);
    const ratio = sortedIds.length <= 1 ? 0 : chatIndex / (sortedIds.length - 1);
    const targetScroll = Math.max(0, Math.min(maxScroll, maxScroll * ratio));
    sidebar.scrollTo({ top: targetScroll, behavior: 'smooth' });
  }

  async function findNativeAnchorByScrolling(chatId, maxRounds = 18) {
    const sidebar = historyScrollContainer();
    if (!sidebar) return null;

    const sortedIds = Object.keys(state.known || {}).sort((a, b) => {
      const activityA = state.known[a]?.activity || 0;
      const activityB = state.known[b]?.activity || 0;
      return activityB - activityA;
    });
    const chatIndex = sortedIds.indexOf(chatId);
    const maxScroll = Math.max(0, sidebar.scrollHeight - sidebar.clientHeight);
    const ratio = chatIndex >= 0 && sortedIds.length > 1
      ? chatIndex / (sortedIds.length - 1)
      : 1;
    const estimatedTop = Math.max(0, Math.min(maxScroll, maxScroll * ratio));
    const step = Math.max(220, sidebar.clientHeight * 0.72);
    const targets = [estimatedTop];

    for (let offset = 1; targets.length < maxRounds; offset += 1) {
      targets.push(Math.max(0, estimatedTop - offset * step));
      if (targets.length >= maxRounds) break;
      targets.push(Math.min(maxScroll, estimatedTop + offset * step));
    }
    if (!targets.includes(maxScroll)) targets.push(maxScroll);
    if (!targets.includes(0)) targets.push(0);

    for (let attempt = 0; attempt < targets.length; attempt += 1) {
      const top = targets[attempt];
      addDiagnosticLog('open:targeted-scroll-attempt', {
        chatId,
        attempt,
        top: Math.round(top),
        maxScroll: Math.round(maxScroll),
      });
      sidebar.scrollTop = top;
      sidebar.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(attempt < 3 ? 280 : 420);
      scanNativeChats();
      const anchor = nativeAnchorForChat(chatId);
      if (anchor) {
        addDiagnosticLog('open:targeted-scroll-found', { chatId, attempt });
        return anchor;
      }
    }

    addDiagnosticLog('open:targeted-scroll-not-found', { chatId, rounds: targets.length });
    return null;
  }

  async function openNativeOptionsForChat(chatId, anchorElement) {
    const row = nativeRows.get(chatId);
    wakeNativeRow(row);
    const optionsButton = nativeOptionsButtonForChat(chatId)
      || await waitForValue(() => {
        wakeNativeRow(row);
        return nativeOptionsButtonForChat(chatId);
      }, 900, 60);

    if (!optionsButton) {
      showMoveToFolderMenu(chatId, anchorElement);
      return;
    }

    pendingNativeMenuChatId = chatId;
    pendingNativeMenuAnchor = anchorElement;
    pendingNativeMenuUntil = Date.now() + 3000;
    nativeMenuAugmented = false;
    clickWithoutAnchorNavigation(optionsButton);
    window.setTimeout(augmentNativeConversationMenu, 30);
    window.setTimeout(augmentNativeConversationMenu, 120);
    window.setTimeout(augmentNativeConversationMenu, 260);
    window.setTimeout(() => {
      if (!visibleNativeMenu()) {
        showMoveToFolderMenu(chatId, anchorElement);
      }
    }, 720);
  }

  async function renameConversationNatively(chatId, newTitle) {
    const row = nativeRows.get(chatId);
    if (!row) throw new Error('原生对话尚未加载');

    const originalParent = row.parentNode;
    const originalNext = row.nextSibling;
    const needsStage = row.parentElement === parkingLot || !row.getClientRects().length;
    if (needsStage) ensureRenameStage().append(row);

    try {
      wakeNativeRow(row);
      const optionsButton = nativeOptionsButtonForChat(chatId)
        || await waitForValue(() => {
          wakeNativeRow(row);
          return nativeOptionsButtonForChat(chatId);
        }, 900, 60);
      if (!optionsButton) throw new Error('未找到原生省略号菜单');

      pendingNativeMenuChatId = '';
      nativeMenuAugmented = true;
      clickWithoutAnchorNavigation(optionsButton);

      const menu = await waitForValue(() => visibleNativeMenu(), 3000);
      if (!menu) throw new Error('原生菜单未打开');
      const renameItem = menuItemByText(menu, /^(重命名|Rename)(?:\s|$)/i);
      if (!renameItem) throw new Error('未找到重命名操作');
      renameItem.click();

      const oldTitle = state.known[chatId]?.title || '';
      const input = await waitForValue(() => renameInputForRow(row, oldTitle), 3000);
      if (!input) throw new Error('未找到重命名输入框');

      input.focus();
      setNativeInputValue(input, newTitle);
      const saveButton = saveRenameControl(input, row);
      if (saveButton) {
        clickWithoutAnchorNavigation(saveButton);
      } else {
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        }));
        input.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        }));
      }

      const completed = await waitForValue(() => {
        const currentAnchor = row.querySelector('a[href]');
        const currentTitle = currentAnchor ? titleFromAnchor(currentAnchor) : '';
        return currentTitle === newTitle || !input.isConnected;
      }, 4500);
      if (!completed) throw new Error('等待保存超时');

      const known = state.known[chatId] || {};
      known.title = newTitle;
      state.known[chatId] = known;
      saveState();
    } finally {
      if (needsStage && originalParent) {
        originalParent.insertBefore(row, originalNext?.parentNode === originalParent ? originalNext : null);
      }
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
      }));
    }
  }

  async function startBatchRename() {
    const modal = document.getElementById(RENAME_ID);
    if (!modal || renameRun?.running) return;
    const changes = [...modal.querySelectorAll('.cgpt-rename-input')]
      .map((input) => ({
        chatId: input.dataset.chatId,
        oldTitle: input.dataset.original,
        newTitle: compactTitle(input.value),
      }))
      .filter((item) => item.newTitle && item.newTitle !== item.oldTitle);
    if (!changes.length) return;
    if (!window.confirm(`将依次重命名 ${changes.length} 条 ChatGPT 对话。确定开始吗？`)) return;

    renameRun = { running: true, stopped: false };
    modal.querySelectorAll('.cgpt-rename-input').forEach((input) => { input.disabled = true; });
    const saveButton = modal.querySelector('[data-cgpt-rename-action="save"]');
    const closeButton = modal.querySelector('[data-cgpt-rename-action="close"]');
    if (saveButton) {
      saveButton.textContent = '停止';
      saveButton.disabled = false;
      saveButton.dataset.cgptRenameAction = 'stop';
    }
    if (closeButton) closeButton.disabled = true;

    let succeeded = 0;
    let failed = 0;
    for (const change of changes) {
      if (renameRun.stopped) {
        setRenameStatus(change.chatId, '已停止', 'error');
        continue;
      }
      setRenameStatus(change.chatId, '处理中…', 'running');
      try {
        await renameConversationNatively(change.chatId, change.newTitle);
        setRenameStatus(change.chatId, '已完成', 'success');
        succeeded += 1;
      } catch (error) {
        setRenameStatus(change.chatId, error.message || '失败', 'error');
        failed += 1;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }

    renameRun.running = false;
    modal.querySelectorAll('.cgpt-rename-input').forEach((input) => { input.disabled = false; });
    const toolbar = modal.querySelector('[data-cgpt-rename-count]');
    if (toolbar) toolbar.textContent = `完成 ${succeeded}，失败 ${failed}`;
    if (saveButton) {
      saveButton.textContent = '完成';
      saveButton.dataset.cgptRenameAction = 'close';
      saveButton.disabled = false;
    }
    if (closeButton) {
      closeButton.hidden = true;
      closeButton.disabled = false;
    }
    queueRender();
  }

  function showMoveToFolderMenu(chatId, anchorElement) {
    const menu = ensureMenu();
    menu.classList.remove('cgpt-batch-menu');
    const folders = flattenFolders();
    const currentFolder = folderContainingChat(chatId);
    const rect = anchorElement?.getBoundingClientRect?.()
      || pendingNativeMenuAnchor?.getBoundingClientRect?.()
      || { left: 16, right: 180, bottom: 80 };

    const folderButtons = folders.length
      ? folders.map(({ folder, depth }) => `
          <button class="cgpt-menu-folder"
                  style="--cgpt-menu-depth:${depth}"
                  data-cgpt-action="move-chat-to-folder"
                  data-chat-id="${escapeHtml(chatId)}"
                  data-folder-id="${escapeHtml(folder.id)}"
                  ${currentFolder?.id === folder.id ? 'disabled' : ''}>
            ${icons.folder}
            <span>${escapeHtml(folder.title)}</span>
            <span class="cgpt-menu-meta">${countFolderChats(folder) || ''}</span>
            <span class="cgpt-current-mark">${currentFolder?.id === folder.id ? '✓' : ''}</span>
          </button>`).join('')
      : '<div class="cgpt-menu-title">还没有分组</div>';

    menu.innerHTML = `
      <div class="cgpt-menu-title">${currentFolder ? '移动到其他分组' : '移动到分组'}</div>
      ${folderButtons}
      <div class="cgpt-menu-divider"></div>
      <button data-cgpt-action="new-folder-for-chat" data-chat-id="${escapeHtml(chatId)}">＋ 新建分组并移动</button>
      ${currentFolder ? `
        <button data-cgpt-action="remove-chat-from-folder" data-chat-id="${escapeHtml(chatId)}">移出分组</button>
      ` : ''}`;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - 190, rect.left - 164))}px`;
    menu.style.top = `${Math.max(8, Math.min(innerHeight - 280, rect.bottom - 24))}px`;
    menu.hidden = false;
  }

  function visibleNativeMenu() {
    const candidates = [...document.querySelectorAll(
      '[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]'
    )];
    return candidates
      .filter((element) => !element.closest(`#${MENU_ID}`))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 120 && rect.height > 50
          && style.display !== 'none' && style.visibility !== 'hidden';
      })
      .sort((a, b) => {
        const roleScore = (element) => element.getAttribute('role') === 'menu' ? 1000 : 0;
        const itemScore = (element) => element.querySelectorAll('[role="menuitem"], button').length;
        return roleScore(b) + itemScore(b) - roleScore(a) - itemScore(a);
      })[0] || null;
  }

  function nativeMenuReferenceItem(menu) {
    return menu.querySelector('[role="menuitem"]')
      || menu.querySelector('button')
      || menu.firstElementChild;
  }

  function buildNativeMenuItem(reference, label, action, icon) {
    const tagName = ['BUTTON', 'DIV'].includes(reference?.tagName)
      ? reference.tagName.toLowerCase()
      : 'div';
    const item = document.createElement(tagName);
    item.className = `${reference?.className || ''} cgpt-native-menu-item`;
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '-1');
    item.dataset.cgptNativeMenuAction = action;
    item.innerHTML = `${icon}<span>${label}</span>`;
    return item;
  }

  function augmentNativeConversationMenu() {
    if (!pendingNativeMenuChatId || nativeMenuAugmented || Date.now() > pendingNativeMenuUntil) return;
    const menu = visibleNativeMenu();
    if (!menu || menu.querySelector('[data-cgpt-native-menu-action]')) return;
    const reference = nativeMenuReferenceItem(menu);
    if (!reference) return;

    const chatId = pendingNativeMenuChatId;
    const grouped = Boolean(findChatNode(chatId));
    const divider = document.createElement('div');
    divider.className = 'cgpt-menu-divider';
    divider.dataset.cgptNativeMenuAction = 'divider';
    const moveItem = buildNativeMenuItem(
      reference,
      grouped ? '移动到其他分组' : '移动到分组',
      'open-folder-picker',
      icons.move
    );
    const exportMdItem = buildNativeMenuItem(reference, '导出 MD', 'export-markdown', icons.download);
    const removeItem = grouped
      ? buildNativeMenuItem(reference, '移出分组', 'remove-from-folder', icons.out)
      : null;
    const deleteItem = [...menu.querySelectorAll('[role="menuitem"], button')]
      .find((element) => /^(删除|Delete)(?:\s|$)/i.test(compactTitle(element.innerText)));
    let insertionPoint = deleteItem;
    while (insertionPoint?.parentElement && insertionPoint.parentElement !== menu) {
      insertionPoint = insertionPoint.parentElement;
    }
    const insert = (element) => {
      if (insertionPoint?.parentElement === menu) menu.insertBefore(element, insertionPoint);
      else menu.append(element);
    };
    insert(divider);
    insert(exportMdItem);
    insert(moveItem);
    if (grouped) {
      insert(removeItem);
    }
    nativeMenuAugmented = true;
  }

  function buildRecentMenuItem(reference, label, action, icon) {
    const item = buildNativeMenuItem(reference, label, `recent:${action}`, icon);
    item.removeAttribute('data-cgpt-native-menu-action');
    item.dataset.cgptAction = action;
    item.dataset.cgptRecentMenuItem = 'true';
    return item;
  }

  function augmentNativeRecentMenu() {
    if (recentMenuAugmented || Date.now() > pendingRecentMenuUntil) return;
    const menu = visibleNativeMenu();
    if (!menu || menu.querySelector('[data-cgpt-recent-menu-item]')) return;
    const text = compactTitle(menu.innerText);
    if (!/整理聊天|在一个列表中|按项目|organize chats|in one list|by project/i.test(text)) return;
    const reference = nativeMenuReferenceItem(menu);
    if (!reference) return;

    const divider = document.createElement('div');
    divider.className = 'cgpt-menu-divider';
    divider.dataset.cgptRecentMenuItem = 'true';
    menu.append(divider);
    menu.append(
      buildRecentMenuItem(reference, '新建分组', 'add-folder', icons.plus),
      buildRecentMenuItem(reference, '批量分组未分组对话', 'batch-group', icons.batch),
      buildRecentMenuItem(reference, '按标题条件分组…', 'condition-group', icons.move),
      buildRecentMenuItem(reference, '分组数据、导入与恢复', 'data-menu', icons.folder)
    );
    recentMenuAugmented = true;
  }

  function dismissNativeMenu() {
    const menu = visibleNativeMenu();
    if (!menu) return;
    menu.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    }));
  }

  function showFolderMenu(button, folderId) {
    const menu = ensureMenu();
    menu.classList.remove('cgpt-batch-menu');
    const folder = findNode(folderId)?.node;
    if (!folder || folder.type !== 'folder') return;
    const parentFolder = parentFolderOfNode(folderId);
    const rect = button.getBoundingClientRect();
    menu.innerHTML = `
      <button data-cgpt-action="toggle-folder" data-node-id="${escapeHtml(folderId)}">
        ${folder.collapsed ? '展开分组' : '折叠分组'}
      </button>
      <button data-cgpt-action="rename-folder" data-node-id="${escapeHtml(folderId)}">重命名分组</button>
      <button data-cgpt-action="add-child" data-node-id="${escapeHtml(folderId)}">新建子分组</button>
      <button data-cgpt-action="batch-rename-folder" data-node-id="${escapeHtml(folderId)}">批量重命名对话…</button>
      <div class="cgpt-menu-divider"></div>
      <button data-cgpt-action="open-folder-move-picker" data-node-id="${escapeHtml(folderId)}">移动分组…</button>
      ${parentFolder ? `
        <button data-cgpt-action="move-folder-root" data-node-id="${escapeHtml(folderId)}">移到顶层</button>
      ` : ''}
      <div class="cgpt-menu-divider"></div>
      <button class="cgpt-danger" data-cgpt-action="delete-folder" data-node-id="${escapeHtml(folderId)}">删除分组</button>`;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - 176, rect.right - 168))}px`;
    menu.style.top = `${Math.max(8, Math.min(innerHeight - 250, rect.bottom + 4))}px`;
    menu.hidden = false;
  }

  function showMoveFolderMenu(folderId, anchorElement) {
    const menu = ensureMenu();
    menu.classList.remove('cgpt-batch-menu');
    const movingFolder = findNode(folderId)?.node;
    if (!movingFolder || movingFolder.type !== 'folder') return;
    const currentParent = parentFolderOfNode(folderId);
    const candidates = flattenFolders().filter(({ folder }) => (
      folder.id !== movingFolder.id && !folderContains(movingFolder, folder.id)
    ));
    const rect = anchorElement.getBoundingClientRect();
    const buttons = candidates.length
      ? candidates.map(({ folder, depth }) => `
          <button class="cgpt-menu-folder"
                  style="--cgpt-menu-depth:${depth}"
                  data-cgpt-action="move-folder-to-folder"
                  data-node-id="${escapeHtml(folderId)}"
                  data-folder-id="${escapeHtml(folder.id)}"
                  ${currentParent?.id === folder.id ? 'disabled' : ''}>
            ${icons.folder}
            <span>${escapeHtml(folder.title)}</span>
            <span class="cgpt-menu-meta">${countFolderChats(folder) || ''}</span>
            <span class="cgpt-current-mark">${currentParent?.id === folder.id ? '✓' : ''}</span>
          </button>`).join('')
      : '<div class="cgpt-menu-title">没有可移动到的分组</div>';
    menu.innerHTML = `
      <div class="cgpt-menu-title">移动“${escapeHtml(movingFolder.title)}”</div>
      <button class="cgpt-menu-folder"
              data-cgpt-action="move-folder-root"
              data-node-id="${escapeHtml(folderId)}"
              ${currentParent ? '' : 'disabled'}>
        ${icons.folder}<span>顶层</span>
        <span class="cgpt-menu-meta"></span>
        <span class="cgpt-current-mark">${currentParent ? '' : '✓'}</span>
      </button>
      ${buttons}`;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - 200, rect.left - 176))}px`;
    menu.style.top = `${Math.max(8, Math.min(innerHeight - 320, rect.top - 6))}px`;
    menu.hidden = false;
  }

  function unclassifiedChats() {
    const classified = classifiedChatIds();
    return Object.keys(state.known || {})
      .filter((chatId) => !classified.has(chatId))
      .map((chatId) => ({
        chatId,
        info: state.known[chatId] || {},
      }))
      .filter(({ info }) => info?.url || info?.title)
      .sort((a, b) => chatActivity(b.chatId) - chatActivity(a.chatId));
  }

  function groupByTitleCondition() {
    const rawKeywords = window.prompt(
      '输入标题关键词；多个关键词可用逗号分隔，满足任意一个就会加入分组：',
      '团建游戏'
    );
    const keywords = String(rawKeywords || '')
      .split(/[,，]/)
      .map((value) => compactTitle(value).toLocaleLowerCase())
      .filter(Boolean);
    if (!keywords.length) return;

    const defaultName = compactTitle(String(rawKeywords).split(/[,，]/)[0]) || '条件分组';
    const folderName = compactTitle(window.prompt('保存到哪个分组？', defaultName));
    if (!folderName) return;

    const matchedChatIds = Object.entries(state.known)
      .filter(([, info]) => {
        const title = compactTitle(info?.title).toLocaleLowerCase();
        return title && keywords.some((keyword) => title.includes(keyword));
      })
      .map(([chatId]) => chatId);
    if (!matchedChatIds.length) {
      window.alert('当前已加载的最近聊天中，没有找到符合条件的标题。');
      return;
    }

    let folder = flattenFolders()
      .map((item) => item.folder)
      .find((item) => item.title === folderName);
    if (!folder) {
      folder = {
        type: 'folder',
        id: uid('folder'),
        title: folderName,
        collapsed: false,
        children: [],
      };
      state.tree.push(folder);
    }
    moveChatsToFolder(matchedChatIds, folder.id);
    window.alert(`已将 ${matchedChatIds.length} 条匹配对话加入“${folderName}”。`);
  }

  function updateBatchMenuState() {
    const menu = document.getElementById(MENU_ID);
    if (!menu || !menu.classList.contains('cgpt-batch-menu')) return;
    const checked = [...menu.querySelectorAll('.cgpt-batch-row input:checked')]
      .map((input) => input.value);
    batchSelectedChatIds = checked;
    const total = menu.querySelectorAll('.cgpt-batch-row input').length;
    const selectAll = menu.querySelector('[data-cgpt-batch-select-all]');
    if (selectAll) {
      selectAll.checked = total > 0 && checked.length === total;
      selectAll.indeterminate = checked.length > 0 && checked.length < total;
    }
    const count = menu.querySelector('[data-cgpt-batch-count]');
    if (count) count.textContent = `已选 ${checked.length} 条`;
    const next = menu.querySelector('[data-cgpt-action="batch-next"]');
    if (next) next.disabled = checked.length === 0;
  }

  function showBatchGroupingMenu(anchorElement) {
    const menu = ensureMenu();
    const chats = unclassifiedChats();
    const rect = anchorElement.getBoundingClientRect();
    batchSelectedChatIds = [];
    menu.classList.add('cgpt-batch-menu');
    menu.innerHTML = chats.length ? `
      <div class="cgpt-batch-head">
        <span>批量分组</span>
        <label>
          <input type="checkbox" data-cgpt-batch-select-all>
          全选
        </label>
      </div>
      <div class="cgpt-menu-divider"></div>
      <div class="cgpt-batch-list">
        ${chats.map(({ chatId, info }) => `
          <label class="cgpt-batch-row">
            <input type="checkbox" value="${escapeHtml(chatId)}">
            <span title="${escapeHtml(info.title || '未命名对话')}">${escapeHtml(info.title || '未命名对话')}</span>
          </label>`).join('')}
      </div>
      <div class="cgpt-menu-divider"></div>
      <div class="cgpt-batch-foot">
        <span data-cgpt-batch-count>已选 0 条</span>
        <button class="cgpt-batch-primary" data-cgpt-action="batch-next" disabled>选择分组</button>
      </div>
    ` : `
      <div class="cgpt-batch-head"><span>批量分组</span></div>
      <div class="cgpt-menu-title">当前没有未分组对话</div>
    `;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - 340, rect.right - 330))}px`;
    menu.style.top = `${Math.max(8, Math.min(innerHeight - 500, rect.bottom + 4))}px`;
    menu.hidden = false;
  }

  function showBatchFolderMenu(anchorElement) {
    const menu = ensureMenu();
    const folders = flattenFolders();
    const rect = anchorElement.getBoundingClientRect();
    menu.classList.remove('cgpt-batch-menu');
    menu.innerHTML = `
      <div class="cgpt-menu-title">将 ${batchSelectedChatIds.length} 条对话移动到</div>
      ${folders.length ? folders.map(({ folder, depth }) => `
        <button class="cgpt-menu-folder"
                style="--cgpt-menu-depth:${depth}"
                data-cgpt-action="batch-move-to-folder"
                data-folder-id="${escapeHtml(folder.id)}">
          ${icons.folder}
          <span>${escapeHtml(folder.title)}</span>
          <span class="cgpt-menu-meta">${countFolderChats(folder) || ''}</span>
          <span class="cgpt-current-mark"></span>
        </button>`).join('') : '<div class="cgpt-menu-title">还没有分组</div>'}
      <div class="cgpt-menu-divider"></div>
      <button data-cgpt-action="batch-new-folder">＋ 新建分组并移动</button>`;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - 220, rect.left - 190))}px`;
    menu.style.top = `${Math.max(8, Math.min(innerHeight - 360, rect.top - 8))}px`;
    menu.hidden = false;
  }

  function classifiedChatIdList(nodes = state.tree, result = []) {
    nodes.forEach((node) => {
      if (node.type === 'chat') result.push(node.chatId);
      else classifiedChatIdList(node.children, result);
    });
    return result;
  }

  function exportGroupData() {
    const chatIds = [...new Set(classifiedChatIdList())];
    const ungroupedChatIds = unclassifiedChats().map(({ chatId }) => chatId);
    const knownChatIds = [...new Set([
      ...Object.keys(state.known || {}),
      ...chatIds,
      ...ungroupedChatIds,
    ])];
    const known = {};
    knownChatIds.forEach((chatId) => {
      if (state.known[chatId]) known[chatId] = { ...state.known[chatId] };
    });
    const payload = {
      format: APP_ID,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceHost: location.host,
      summary: {
        folders: flattenFolders().length,
        chats: chatIds.length,
        ungroupedChats: ungroupedChatIds.length,
        knownChats: knownChatIds.length,
        prompts: promptState.items.length,
      },
      state: {
        version: 2,
        tree: typeof structuredClone === 'function'
          ? structuredClone(state.tree)
          : JSON.parse(JSON.stringify(state.tree)),
        known,
      },
      prompts: {
        version: 1,
        items: promptState.items.map((item) => ({ ...item })),
        updatedAt: promptState.updatedAt || 0,
      },
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    anchor.href = url;
    anchor.download = `chatgpt-helper-data-${stamp}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function markdownFileName(title = '') {
    const safe = compactTitle(title || document.title || 'chatgpt-conversation')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70) || 'chatgpt-conversation';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${safe}-${stamp}.md`;
  }

  function markdownEscapeText(text = '') {
    return String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function conversationMessageElements() {
    const main = document.querySelector('main') || document.body;
    return [...main.querySelectorAll('[data-message-author-role]')]
      .filter((element) => element.closest?.('[data-message-author-role]') === element)
      .filter((element) => {
        const role = element.getAttribute('data-message-author-role') || '';
        return /user|assistant|tool/i.test(role) && isElementVisible(element);
      });
  }

  function markdownTextFromMessage(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll?.([
      'button',
      'svg',
      'script',
      'style',
      'textarea',
      'input',
      '[contenteditable="true"]',
      `.${IMAGE_DOWNLOAD_SLOT_CLASS}`,
      `.${TEXT_DOWNLOAD_SLOT_CLASS}`,
      `.${WORK_PACKAGE_CLASS}`,
      `#${APP_ID}`,
      `#${MENU_ID}`,
      `#${PROMPT_PANEL_ID}`,
    ].join(',')).forEach((node) => node.remove());
    return markdownEscapeText(clone.innerText || clone.textContent || '');
  }

  function buildConversationMarkdown(chatId = currentChatId()) {
    const title = state.known[chatId]?.title
      || compactTitle(document.title.replace(/\s*[-–]\s*ChatGPT\s*$/i, ''))
      || 'ChatGPT 对话';
    const url = chatId ? new URL(chatHref(chatId), location.href).href : location.href;
    const messages = conversationMessageElements()
      .map((element) => {
        const role = element.getAttribute('data-message-author-role') || '';
        const label = /user/i.test(role) ? '用户' : (/assistant/i.test(role) ? 'ChatGPT' : role || '消息');
        const text = markdownTextFromMessage(element);
        if (!text) return '';
        return `## ${label}\n\n${text}`;
      })
      .filter(Boolean);
    if (!messages.length) return { title, markdown: '' };
    const header = [
      `# ${title}`,
      '',
      `- 导出时间：${new Date().toLocaleString()}`,
      `- 对话链接：${url}`,
      '',
      '---',
      '',
    ].join('\n');
    return {
      title,
      markdown: `${header}${messages.join('\n\n---\n\n')}\n`,
    };
  }

  function downloadMarkdownFile(title, markdown) {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = markdownFileName(title);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportConversationMarkdown(chatId = currentChatId()) {
    const targetChatId = chatId || currentChatId();
    const fallbackHref = targetChatId ? chatHref(targetChatId) : '';
    dismissNativeMenu();
    if (targetChatId && !isChatLocation(targetChatId)) {
      showImageDownloadToast('正在打开对话...', true);
      const opened = await openChatThroughNativeRow(targetChatId, fallbackHref);
      if (!opened) {
        window.alert('没有成功打开这个对话，暂时无法导出 MD。');
        return false;
      }
    }
    const ready = await waitForValue(() => (
      (!targetChatId || isChatLocation(targetChatId)) && conversationMessageElements().length > 0
    ), 6500, 120);
    if (!ready) {
      window.alert('没有找到可导出的对话内容。请先打开这个对话后再试一次。');
      return false;
    }
    const { title, markdown } = buildConversationMarkdown(targetChatId || currentChatId());
    if (!markdown) {
      window.alert('没有找到可导出的对话内容。');
      return false;
    }
    downloadMarkdownFile(title, markdown);
    showImageDownloadToast('MD 导出完成', true);
    return true;
  }

  function refreshWorkPackageButtons() {
    document.querySelectorAll(`.${WORK_PACKAGE_CLASS}`).forEach((button) => button.remove());
    scheduleImageDownloadButtons();
  }

  function setWorkPackageButtonVisible(visible) {
    workPackageButtonVisible = Boolean(visible);
    try {
      GM_setValue(WORK_PACKAGE_VISIBLE_KEY, workPackageButtonVisible);
    } catch {
      // 菜单开关失败不影响页面按钮刷新。
    }
    refreshWorkPackageButtons();
    showImageDownloadToast(
      workPackageButtonVisible ? '已显示作品包按钮' : '已隐藏作品包按钮',
      true
    );
    registerUserscriptMenuCommands();
  }

  function registerUserscriptMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    if (typeof GM_unregisterMenuCommand === 'function') {
      userscriptMenuCommandIds.forEach((id) => {
        try { GM_unregisterMenuCommand(id); } catch {}
      });
    }
    userscriptMenuCommandIds = [];
    const addMenu = (label, handler) => {
      const id = GM_registerMenuCommand(label, handler);
      if (id != null) userscriptMenuCommandIds.push(id);
    };
    addMenu('导出 ChatGPT 辅助器数据（分组+提示词）', () => exportGroupData());
    addMenu('同步 GitHub 云端提示词', () => void syncCloudPrompts(true));
    addMenu('恢复上一版云端提示词', () => restorePreviousCloudPrompts());
    addMenu('导出本地提示词为云端文件', () => exportCloudPromptFile());
    addMenu(
      hardNavigationFallbackEnabled ? '关闭失败时整页跳转' : '允许失败时整页跳转（当前关闭）',
      () => setHardNavigationFallbackEnabled(!hardNavigationFallbackEnabled)
    );
    addMenu('打开提示词库', () => {
      ensurePromptButton();
      const button = document.getElementById(PROMPT_BUTTON_ID);
      if (button) togglePromptPanel(button);
      else window.alert('没有找到 ChatGPT 输入框，暂时无法打开提示词库。');
    });
    addMenu(
      workPackageButtonVisible ? '隐藏作品包按钮' : '显示作品包按钮',
      () => setWorkPackageButtonVisible(!workPackageButtonVisible)
    );
    addMenu('设置本地作品包目录', () => openWorkPackageProtocol('cgpt-workpkg://configure'));
    addMenu('复制诊断日志', () => copyDiagnosticLogs());
  }

  function sanitizeKnownRecord(record) {
    if (!record || typeof record !== 'object') return {};
    const clean = {};
    if (typeof record.title === 'string') clean.title = compactTitle(record.title);
    if (typeof record.url === 'string' && record.url.startsWith('/')) {
      clean.url = record.url.slice(0, 500);
    }
    if (Number.isFinite(Number(record.activity))) clean.activity = Number(record.activity);
    if (Number.isFinite(Number(record.firstSeen))) clean.firstSeen = Number(record.firstSeen);
    if (Number.isFinite(Number(record.lastSeen))) clean.lastSeen = Number(record.lastSeen);
    return clean;
  }

  function sanitizeImportedData(raw) {
    const source = raw?.state && typeof raw.state === 'object' ? raw.state : raw;
    if (!source || !Array.isArray(source.tree)) {
      throw new Error('不是有效的分组备份文件');
    }
    if (raw?.format && raw.format !== APP_ID) {
      throw new Error('该 JSON 不是本脚本导出的分组数据');
    }

    const seenChats = new Set();
    let nodeCount = 0;
    const sanitizeNodes = (nodes, depth = 0) => {
      if (!Array.isArray(nodes) || depth > 20) return [];
      const result = [];
      nodes.forEach((node) => {
        if (!node || typeof node !== 'object' || nodeCount >= 10000) return;
        nodeCount += 1;
        if (node.type === 'folder') {
          const title = compactTitle(node.title) || '未命名分组';
          result.push({
            type: 'folder',
            id: uid('folder'),
            title,
            collapsed: Boolean(node.collapsed),
            children: sanitizeNodes(node.children, depth + 1),
          });
          return;
        }
        if (node.type === 'chat') {
          const chatId = String(node.chatId || '').trim().slice(0, 256);
          if (!chatId || seenChats.has(chatId)) return;
          seenChats.add(chatId);
          result.push({
            type: 'chat',
            id: uid('chat-node'),
            chatId,
          });
        }
      });
      return result;
    };

    const tree = sanitizeNodes(source.tree);
    const known = {};
    if (source.known && typeof source.known === 'object') {
      seenChats.forEach((chatId) => {
        known[chatId] = sanitizeKnownRecord(source.known[chatId]);
      });
    }
    const promptSource = raw?.prompts?.items
      || source.prompts?.items
      || raw?.promptState?.items
      || [];
    const prompts = Array.isArray(promptSource)
      ? promptSource.map((item) => normalizePromptItem(item)).filter(Boolean).slice(0, 300)
      : [];
    return {
      tree,
      known,
      prompts,
      folders: (() => {
        const count = (nodes) => nodes.reduce((total, node) => (
          total + (node.type === 'folder' ? 1 + count(node.children) : 0)
        ), 0);
        return count(tree);
      })(),
      chats: seenChats.size,
      promptCount: prompts.length,
    };
  }

  function pruneImportedDuplicates(nodes, blockedChatIds) {
    return nodes.map((node) => {
      if (node.type === 'chat') {
        if (blockedChatIds.has(node.chatId)) return null;
        blockedChatIds.add(node.chatId);
        return node;
      }
      return {
        ...node,
        children: pruneImportedDuplicates(node.children, blockedChatIds),
      };
    }).filter(Boolean);
  }

  function importGroupData(imported, mode) {
    if (mode === 'replace') {
      if (!window.confirm(
        `将用备份中的 ${imported.folders} 个分组、${imported.chats} 条对话、${imported.promptCount || 0} 条提示词替换本机数据。确定继续吗？`
      )) return false;
      state.tree = imported.tree;
      state.known = {
        ...state.known,
        ...imported.known,
      };
      if (Array.isArray(imported.prompts)) {
        promptState = {
          version: 1,
          items: imported.prompts,
          updatedAt: Date.now(),
        };
      }
    } else {
      const existingChatIds = classifiedChatIds();
      const importedTree = pruneImportedDuplicates(imported.tree, existingChatIds);
      state.tree.push(...importedTree);
      state.known = {
        ...imported.known,
        ...state.known,
      };
      if (Array.isArray(imported.prompts) && imported.prompts.length) {
        const seenPromptKeys = new Set(promptState.items.map((item) => (
          `${item.title}\n${item.content}`
        )));
        imported.prompts.forEach((item) => {
          const key = `${item.title}\n${item.content}`;
          if (seenPromptKeys.has(key)) return;
          seenPromptKeys.add(key);
          promptState.items.push({
            ...item,
            id: uid('prompt'),
          });
        });
      }
    }
    saveState(true, mode === 'replace');
    savePromptState();
    queueRender();
    return true;
  }

  async function handleImportFile(file) {
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('备份文件超过 5MB，已拒绝导入');
      }
      const raw = JSON.parse(await file.text());
      const imported = sanitizeImportedData(raw);
      const completed = importGroupData(imported, pendingImportMode);
      if (completed) {
        window.alert(
          `导入完成：${imported.folders} 个分组，${imported.chats} 条已分组对话，${imported.promptCount || 0} 条提示词。`
        );
      }
    } catch (error) {
      window.alert(`导入失败：${error.message || '文件格式错误'}`);
    } finally {
      const input = document.getElementById(IMPORT_INPUT_ID);
      if (input) input.value = '';
    }
  }

  function chooseImportFile(mode) {
    pendingImportMode = mode;
    const input = ensureImportInput();
    input.value = '';
    input.click();
  }

  function recoverySnapshots() {
    const snapshots = [];
    localStorageKeys()
      .filter((key) => key.startsWith(BACKUP_PREFIX))
      .forEach((key) => {
        try {
          const item = JSON.parse(localStorage.getItem(key) || 'null');
          const candidate = item?.state && Array.isArray(item.state.tree) ? item.state : null;
          if (!candidate) return;
          snapshots.push({
            key,
            state: candidate,
            savedAt: item.savedAt || key.slice(BACKUP_PREFIX.length),
            reason: item.reason || '历史快照',
            counts: item.counts || countStateItems(candidate),
          });
        } catch {
          // 忽略损坏的单个快照。
        }
      });
    try {
      GM_listValues()
        .filter((key) => key.startsWith(GM_BACKUP_PREFIX))
        .forEach((key) => {
          const item = GM_getValue(key, null);
          const candidate = item?.state && Array.isArray(item.state.tree) ? item.state : null;
          if (!candidate) return;
          snapshots.push({
            key: `gm:${key}`,
            state: candidate,
            savedAt: item.savedAt || key.slice(GM_BACKUP_PREFIX.length),
            reason: item.reason || '油猴独立存储快照',
            counts: item.counts || countStateItems(candidate),
          });
        });
    } catch {
      // localStorage 快照仍然会参与恢复。
    }

    const legacy = parseStateValue(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (legacy && JSON.stringify(legacy.tree) !== JSON.stringify(state.tree)) {
      snapshots.push({
        key: LEGACY_STORAGE_KEY,
        state: legacy,
        savedAt: '旧版脚本当前数据',
        reason: '旧版兼容存储区',
        counts: countStateItems(legacy),
      });
    }
    return snapshots.sort((a, b) => (
      (b.counts.chats - a.counts.chats)
      || (b.counts.folders - a.counts.folders)
      || String(b.savedAt).localeCompare(String(a.savedAt))
    ));
  }

  function restoreBestSnapshot() {
    captureLegacyCandidate();
    const snapshots = recoverySnapshots();
    if (!snapshots.length) {
      window.alert('暂时没有发现可恢复的历史快照。请先不要关闭较早打开的 ChatGPT 标签页。');
      return;
    }
    const best = snapshots[0];
    const currentCounts = countStateItems(state);
    const message = [
      `发现历史快照：${best.counts.folders} 个分组 / ${best.counts.chats} 条已分组对话。`,
      `当前：${currentCounts.folders} 个分组 / ${currentCounts.chats} 条已分组对话。`,
      '',
      `来源：${best.reason}（${best.savedAt}）`,
      '恢复前会自动备份当前数据。是否恢复？',
    ].join('\n');
    if (!window.confirm(message)) return;
    storeBackup(state, '恢复历史快照前的当前数据');
    state = {
      ...defaultState(),
      ...best.state,
      version: 3,
      known: best.state.known && typeof best.state.known === 'object'
        ? best.state.known
        : {},
    };
    saveState(true);
    queueRender();
    window.alert('历史分组已恢复。');
  }

  function showDataMenu(anchorElement) {
    const menu = ensureMenu();
    menu.classList.remove('cgpt-batch-menu');
    captureLegacyCandidate();
    const rect = anchorElement.getBoundingClientRect();
    const folderCount = flattenFolders().length;
    const chatCount = classifiedChatIdList().length;
    const snapshotCount = recoverySnapshots().length;
    menu.innerHTML = `
      <div class="cgpt-menu-title">辅助器数据 · ${folderCount} 个分组 / ${chatCount} 条对话 / ${promptState.items.length} 条提示词</div>
      <button data-cgpt-action="export-data">导出全部数据（分组+提示词）</button>
      <div class="cgpt-menu-divider"></div>
      <button data-cgpt-action="import-data-merge">导入并合并…</button>
      <button data-cgpt-action="import-data-replace">导入并替换…</button>
      <div class="cgpt-menu-divider"></div>
      <button data-cgpt-action="restore-snapshot">恢复历史分组${snapshotCount ? `（${snapshotCount}）` : ''}</button>
      <div class="cgpt-menu-divider"></div>
      <button data-cgpt-action="copy-diagnostics">复制诊断日志（${diagnosticLogs.length}）</button>
      <button data-cgpt-action="clear-diagnostics">清空诊断日志</button>`;
    menu.style.left = `${Math.max(8, Math.min(innerWidth - 220, rect.right - 210))}px`;
    menu.style.top = `${Math.max(8, Math.min(innerHeight - 190, rect.bottom + 4))}px`;
    menu.hidden = false;
  }

  function closeMenu() {
    const menu = document.getElementById(MENU_ID);
    if (menu) {
      menu.hidden = true;
      menu.classList.remove('cgpt-batch-menu');
    }
  }

  function setDragPayload(event, payload) {
    activeDrag = { app: APP_ID, ...payload };
    const raw = JSON.stringify(activeDrag);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_MIME, raw);
    event.dataTransfer.setData('text/plain', raw);
  }

  function payloadFromEvent(event) {
    if (activeDrag) return activeDrag;
    for (const type of [DRAG_MIME, 'text/plain']) {
      try {
        const value = event.dataTransfer?.getData(type);
        if (!value) continue;
        const parsed = JSON.parse(value);
        if (parsed?.app === APP_ID) return parsed;
      } catch {
        // Ignore ordinary text drags.
      }
    }
    return null;
  }

  function clearDropIndicators() {
    document.querySelectorAll(
      '.cgpt-drop-folder, .cgpt-drop-folder-range, .cgpt-drop-before, .cgpt-drop-root'
    )
      .forEach((element) => element.classList.remove(
        'cgpt-drop-folder',
        'cgpt-drop-folder-range',
        'cgpt-drop-before',
        'cgpt-drop-root'
      ));
    recentHeader?.classList.remove('cgpt-recent-drop');
  }

  function isNativeRecentDropArea(target) {
    return Boolean(
      (target.closest?.('#history') && !target.closest?.(`#${APP_ID}`))
      || recentHeader?.contains(target)
    );
  }

  function treeDropTarget(event) {
    const ungroupedFolder = event.target.closest?.('[data-cgpt-ungrouped-drop]');
    if (ungroupedFolder) {
      return { kind: 'unclassified', element: ungroupedFolder };
    }
    const folderRow = event.target.closest?.('.cgpt-folder-row[data-folder-id]');
    if (folderRow) {
      const rect = folderRow.getBoundingClientRect();
      if (event.clientY <= rect.top + Math.min(9, rect.height * 0.28)) {
        return { kind: 'before', nodeId: folderRow.dataset.folderId, element: folderRow };
      }
      return { kind: 'folder', nodeId: folderRow.dataset.folderId, element: folderRow };
    }
    const folderArea = event.target.closest?.('.cgpt-folder[data-folder-node-id]');
    if (folderArea) {
      return {
        kind: 'folder',
        nodeId: folderArea.dataset.folderNodeId,
        element: folderArea,
        area: true,
      };
    }
    if (event.target.closest?.(`#${APP_ID}`)) {
      return { kind: 'root', element: host };
    }
    return null;
  }


  function isElementVisible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
  }

  function isNearViewport(element, margin = Math.max(900, innerHeight * 1.5)) {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) return false;
    return rect.bottom >= -margin && rect.top <= innerHeight + margin;
  }

  function elementText(element) {
    return compactTitle([
      element?.innerText,
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
      element?.getAttribute?.('data-testid'),
    ].filter(Boolean).join(' '));
  }

  function contentImageElements(scope = document) {
    const root = scope === document ? (document.querySelector('main') || document.body) : scope;
    return [...root.querySelectorAll('img')].filter((img) => {
      if (img.closest?.(`#${APP_ID}, #${MENU_ID}, .${IMAGE_DOWNLOAD_SLOT_CLASS}, .${TEXT_DOWNLOAD_SLOT_CLASS}`)) return false;
      if (img.closest?.('#history, nav, aside, [role="navigation"]')) return false;
      if (img.closest?.('[data-radix-menu-content], [data-radix-popper-content-wrapper]')) return false;
      const src = img.currentSrc || img.src || '';
      if (!src || /^data:image\/svg/i.test(src)) return false;
      const rect = img.getBoundingClientRect?.();
      if (!rect || rect.width < 105 || rect.height < 105) return false;
      return isElementVisible(img);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function runWhenIdle(callback, timeout = 900) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(callback, { timeout });
      return;
    }
    window.setTimeout(callback, Math.min(timeout, 260));
  }

  function broadImageElements(scope = document, minSize = 24) {
    const root = scope === document ? (document.querySelector('main') || document.body) : scope;
    return [...root.querySelectorAll('img')].filter((img) => {
      if (img.closest?.(`#${APP_ID}, #${MENU_ID}, .${IMAGE_DOWNLOAD_SLOT_CLASS}, .${TEXT_DOWNLOAD_SLOT_CLASS}`)) return false;
      if (img.closest?.('#history, nav, aside, [role="navigation"]')) return false;
      if (img.closest?.('[data-radix-menu-content], [data-radix-popper-content-wrapper]')) return false;
      const src = img.currentSrc || img.src || '';
      if (!src || /^data:image\/svg/i.test(src)) return false;
      const rect = img.getBoundingClientRect?.();
      if (!rect || rect.width < minSize || rect.height < minSize) return false;
      return isElementVisible(img);
    });
  }

  function imageTurnContainer(img) {
    return img.closest?.('[data-testid^="conversation-turn"]')
      || img.closest?.('[data-message-author-role="assistant"], article[data-turn="assistant"], [class*="group/conversation-turn"]')
      || img.closest?.('[id^="image-"][class*="imagegen-image"]')
      || img.closest?.('main > div > div > div')
      || img.parentElement;
  }

  // Only assistant image-generation results get production download controls.
  // User attachment previews are also large content images, but attaching
  // "download this group / package this work" to them confuses source material
  // with generated output and can package the wrong files.
  function isAssistantGeneratedImage(img) {
    if (!img?.isConnected) return false;
    if (img.closest?.('[data-message-author-role="user"], article[data-turn="user"]')) return false;

    const assistantTurn = img.closest?.(
      '[data-message-author-role="assistant"], article[data-turn="assistant"], [data-testid^="conversation-turn"]'
    );
    if (!assistantTurn) return false;
    if (assistantTurn.getAttribute?.('data-message-author-role') === 'user'
      || assistantTurn.getAttribute?.('data-turn') === 'user'
      || assistantTurn.querySelector?.('[data-message-author-role="user"]')) return false;

    const generatedShell = img.closest?.(
      '[id^="image-"][class*="imagegen-image"], [data-testid*="imagegen"], [data-testid*="generated-image"], [class*="imagegen-image"]'
    );
    const label = [
      img.getAttribute?.('alt'),
      img.getAttribute?.('aria-label'),
      img.getAttribute?.('data-testid'),
    ].filter(Boolean).join(' ');
    return Boolean(generatedShell || /generated image|image generated|已生成图片|生成的图片/i.test(label));
  }

  function imageGroupsOnPage() {
    const groups = new Map();
    contentImageElements(document)
      .filter(isAssistantGeneratedImage)
      .filter((img) => isNearViewport(img))
      .forEach((img) => {
      const container = imageTurnContainer(img);
      if (!container || container === document.body || container === document.documentElement) return;
      const images = groups.get(container) || [];
      images.push(img);
      groups.set(container, images);
    });
    return [...groups.entries()].filter(([, images]) => images.length > 0);
  }

  function countFromText(text) {
    const source = compactTitle(text || '');
    const patterns = [
      /\b\d+\s*\/\s*(\d+)\b/,
      /(?:本组|共|全部|total|all|of)\D{0,8}(\d{1,3})\D{0,6}(?:张|图|image|images)/i,
      /(?:下载|download)\D{0,8}(\d{1,3})\D{0,6}(?:张|图|image|images)/i,
      /(?:第|image|图片)\D{0,4}\d{1,3}\D{0,5}(?:共|of|\/)\D{0,4}(\d{1,3})/i,
    ];
    for (const pattern of patterns) {
      const match = source.match(pattern);
      const value = Number(match?.[1]);
      if (Number.isFinite(value) && value > 1 && value < 100) return value;
    }
    return 0;
  }

  function inferDeclaredImageCount(container, row) {
    const bits = [];
    const scopes = [container, row].filter(Boolean);
    scopes.forEach((scope) => {
      bits.push(elementText(scope));
      scope.querySelectorAll?.('[aria-label], [title], [alt], button, [role="button"]')
        .forEach((element) => {
          bits.push(elementText(element));
          bits.push(element.getAttribute?.('alt') || '');
        });
    });
    const declared = countFromText(bits.join(' '));
    if (declared) return declared;

    const candidates = broadImageElements(container || document, 24);
    let maxIndex = 0;
    candidates.forEach((img) => {
      const text = [
        img.getAttribute('aria-label'),
        img.getAttribute('title'),
        img.getAttribute('alt'),
        img.closest?.('button, [role="button"]')?.getAttribute?.('aria-label'),
      ].filter(Boolean).join(' ');
      const value = countFromText(text);
      if (value > maxIndex) maxIndex = value;
    });
    return maxIndex;
  }

  function findImageActionRow(container) {
    const buttons = [...container.querySelectorAll('button')]
      .filter((button) => !button.closest(`.${IMAGE_DOWNLOAD_SLOT_CLASS}, .${TEXT_DOWNLOAD_SLOT_CLASS}`))
      .filter((button) => !button.closest('[data-testid="image-gen-overlay-right-actions"], [data-testid*="image-gen-overlay"]'));
    const scored = buttons.map((button) => {
      const text = elementText(button);
      const score = /\u590d\u5236|copy|\u66f4\u591a|more|\u9009\u9879|options|\u5206\u4eab|share/i.test(text) ? 10 : 0;
      return { button, score };
    }).sort((a, b) => b.score - a.score);

    for (const { button } of scored) {
      let row = button.parentElement;
      for (let depth = 0; row && depth < 4; depth += 1, row = row.parentElement) {
        if (row === container || row.querySelector?.('img')) continue;
        if (row.matches?.('[data-testid="image-gen-overlay-right-actions"], [data-testid*="image-gen-overlay"]')
          || row.closest?.('[data-testid="image-gen-overlay-right-actions"], [data-testid*="image-gen-overlay"]')) continue;
        const rowButtons = row.querySelectorAll?.('button') || [];
        if (rowButtons.length >= 1 && rowButtons.length <= 8) return row;
      }
    }
    return null;
  }

  function isLikelyImageActionRow(row) {
    if (!row || !row.isConnected) return false;
    if (row.closest?.(`#${APP_ID}, #${MENU_ID}, #history, nav, aside, [role="navigation"]`)) return false;
    if (row.matches?.('[data-testid="image-gen-overlay-right-actions"], [data-testid*="image-gen-overlay"]')
      || row.closest?.('[data-testid="image-gen-overlay-right-actions"], [data-testid*="image-gen-overlay"]')) return false;
    if (row.querySelector?.('img')) return false;
    const rect = row.getBoundingClientRect?.();
    if (!rect || rect.width < 34 || rect.height < 18 || rect.height > 72) return false;
    const buttons = [...row.querySelectorAll('button')]
      .filter((button) => !button.closest(`.${IMAGE_DOWNLOAD_SLOT_CLASS}, .${TEXT_DOWNLOAD_SLOT_CLASS}`) && isElementVisible(button));
    if (buttons.length < 1 || buttons.length > 8) return false;
    const rowText = elementText(row);
    const hasKnownAction = buttons.some((button) => {
      const text = elementText(button);
      return /\u590d\u5236|copy|\u66f4\u591a|more|\u9009\u9879|options|\u6765\u6e90|source|\u5206\u652f|branch/i.test(text)
        || button.querySelectorAll('svg circle').length >= 2;
    });
    return hasKnownAction || /\u67e5\u770b\u6765\u6e90|\u5206\u652f|source|branch/i.test(rowText);
  }

  function actionRowsOnPage() {
    const main = document.querySelector('main') || document.body;
    const rows = new Set();
    [...main.querySelectorAll('button')].forEach((button) => {
      if (!isElementVisible(button) || !isNearViewport(button) || button.closest(`.${IMAGE_DOWNLOAD_SLOT_CLASS}, .${TEXT_DOWNLOAD_SLOT_CLASS}`)) return;
      let row = button.parentElement;
      for (let depth = 0; row && depth < 5; depth += 1, row = row.parentElement) {
        if (isLikelyImageActionRow(row)) {
          rows.add(row);
          break;
        }
      }
    });
    return [...rows];
  }

  function overlapRatio(a, b) {
    const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    return overlap / Math.max(1, Math.min(a.width, b.width));
  }

  function nearbyImagesForActionRow(row) {
    const rowRect = row.getBoundingClientRect();
    const maxActionGap = Math.max(96, Math.min(170, innerHeight * 0.18));
    const sameTurn = row.closest?.('[data-testid^="conversation-turn"]')
      || row.closest?.('[data-message-author-role="assistant"], article[data-turn="assistant"], [class*="group/conversation-turn"]');
    const sameTurnImages = sameTurn
      ? broadImageElements(sameTurn, 24).filter(isAssistantGeneratedImage).filter((img) => {
        const rect = img.getBoundingClientRect();
        const gap = rowRect.top - rect.bottom;
        return gap > -70 && gap < maxActionGap && overlapRatio(rect, rowRect) > 0.08;
      })
      : [];
    if (sameTurnImages.length) {
      return { container: sameTurn, images: sameTurnImages };
    }

    let ancestor = row.parentElement;
    for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
      if (ancestor === document.body || ancestor === document.documentElement || ancestor.matches?.('main')) break;
      const rect = ancestor.getBoundingClientRect?.();
      if (!rect || rect.height > Math.max(1400, innerHeight * 1.65)) continue;
      const images = broadImageElements(ancestor, 24)
        .filter(isAssistantGeneratedImage)
        .filter((img) => {
          const imgRect = img.getBoundingClientRect();
          const gap = rowRect.top - imgRect.bottom;
          return gap > -70 && gap < maxActionGap && overlapRatio(imgRect, rowRect) > 0.08;
        });
      if (images.length) return { container: imageTurnContainer(images[0]) || ancestor, images };
    }

    const candidates = broadImageElements(document, 24)
      .filter(isAssistantGeneratedImage)
      .map((img) => ({ img, rect: img.getBoundingClientRect() }))
      .filter(({ rect }) => {
        const verticalGap = rowRect.top - rect.bottom;
        return verticalGap > -70
          && verticalGap < maxActionGap
          && overlapRatio(rect, rowRect) > 0.08;
      })
      .sort((a, b) => {
        const gapA = Math.abs(rowRect.top - a.rect.bottom);
        const gapB = Math.abs(rowRect.top - b.rect.bottom);
        return gapA - gapB;
      });
    if (!candidates.length) return null;

    const nearestBottom = candidates[0].rect.bottom;
    const images = candidates
      .filter(({ rect }) => Math.abs(rect.bottom - nearestBottom) < Math.max(400, innerHeight * 0.45))
      .map(({ img }) => img);
    const container = imageTurnContainer(images[0]) || row.parentElement;
    return { container, images };
  }

  function imageButtonLabel(count, downloaded = 0, busyText = '') {
    if (busyText) return busyText;
    const total = Math.max(0, Number(count || 0));
    if (!total) return '';
    const done = Math.max(0, Math.min(total, Number(downloaded || 0)));
    return `${done}/${total}`;
  }

  function imageButtonStatusText(state = 'idle') {
    if (state === 'running') return '\u4e0b\u8f7d\u4e2d';
    if (state === 'done') return '\u4e0b\u8f7d\u5b8c\u6210';
    return '';
  }

  function ensureImageButtonLabels(button) {
    if (!button) return {};
    let status = button.querySelector('[data-cgpt-image-download-status]');
    let count = button.querySelector('[data-cgpt-image-download-label]');
    if (!status || !count) {
      button.innerHTML = `${icons.download}<span class="cgpt-image-download-status" data-cgpt-image-download-status hidden></span><span class="cgpt-image-download-count" data-cgpt-image-download-label hidden></span>`;
      status = button.querySelector('[data-cgpt-image-download-status]');
      count = button.querySelector('[data-cgpt-image-download-label]');
    }
    return { status, count };
  }

  function uniqueImageUrls(images = []) {
    const urls = [];
    const seen = new Set();
    images.forEach((img) => {
      const url = imageUrlForDirectDownload(img);
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    });
    return urls;
  }

  function canonicalDownloadImageUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, location.href);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return raw.split(/[?#]/, 1)[0];
    }
  }

  function imageDownloadFingerprint(urls = []) {
    const stableUrls = [...new Set((urls || []).map(canonicalDownloadImageUrl).filter(Boolean))].sort();
    if (!stableUrls.length) return '';
    let hash = 5381;
    const source = stableUrls.join('\n');
    for (let index = 0; index < source.length; index += 1) {
      hash = ((hash << 5) + hash) ^ source.charCodeAt(index);
    }
    return `${stableUrls.length}-${(hash >>> 0).toString(36)}`;
  }

  function imageDownloadHistoryKey(urls = []) {
    const fingerprint = imageDownloadFingerprint(urls);
    return fingerprint ? `${location.pathname}|${fingerprint}` : '';
  }

  function loadImageDownloadHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(IMAGE_DOWNLOAD_HISTORY_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveImageDownloadHistory(history) {
    try {
      const entries = Object.entries(history || {})
        .sort((left, right) => String(right[1]?.downloadedAt || '').localeCompare(String(left[1]?.downloadedAt || '')))
        .slice(0, IMAGE_DOWNLOAD_HISTORY_LIMIT);
      localStorage.setItem(IMAGE_DOWNLOAD_HISTORY_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // 下载记录只是可视状态；存储失败不能影响真实文件落盘。
    }
  }

  function ensureImageDownloadMarker(slot) {
    if (!slot) return null;
    let marker = slot.querySelector('.cgpt-image-download-marker');
    if (!marker) {
      marker = document.createElement('span');
      marker.className = 'cgpt-image-download-marker';
      marker.hidden = true;
      marker.setAttribute('role', 'status');
      marker.setAttribute('aria-live', 'polite');
      slot.append(marker);
    }
    return marker;
  }

  function renderImageDownloadRecord(button, record = null) {
    const slot = button?.closest?.(`.${IMAGE_DOWNLOAD_SLOT_CLASS}`);
    const marker = ensureImageDownloadMarker(slot);
    if (!button || !marker || !record) {
      if (marker) marker.hidden = true;
      return;
    }
    const downloaded = Math.max(0, Number(record.downloaded || 0));
    const total = Math.max(downloaded, Number(record.total || 0));
    const packaged = record.state === 'packaged';
    marker.hidden = downloaded <= 0;
    marker.dataset.state = packaged ? 'packaged' : 'downloaded';
    marker.textContent = `${packaged ? '已打包' : '已下载'} ${downloaded}/${total || downloaded}`;
    marker.title = `${packaged ? '本作品已完成打包' : '本作品已下载'}${record.downloadedAt ? ` · ${new Date(record.downloadedAt).toLocaleString()}` : ''}`;
    button.dataset.cgptImageDownloaded = String(downloaded);
    if (total) button.dataset.cgptImageTotal = String(total);
    if (!button.disabled) setImageButtonProgress(button, downloaded, total || downloaded, false);
  }

  function imageDownloadRecordForButton(button) {
    if (!button) return null;
    const container = button.__cgptImageDownloadContainer
      || button.closest?.('[data-cgpt-image-download-container]');
    const images = Array.isArray(button.__cgptImageDownloadImages)
      ? button.__cgptImageDownloadImages
      : groupImageElements(container || document);
    const urls = uniqueImageUrls(images);
    const key = imageDownloadHistoryKey(urls);
    return key ? loadImageDownloadHistory()[key] || null : null;
  }

  function rememberImageDownload(button, downloaded, total, batchId = '', state = 'downloaded', explicitUrls = []) {
    const container = button?.__cgptImageDownloadContainer
      || button?.closest?.('[data-cgpt-image-download-container]');
    const images = Array.isArray(button?.__cgptImageDownloadImages)
      ? button.__cgptImageDownloadImages
      : groupImageElements(container || document);
    const urls = explicitUrls.length ? explicitUrls : uniqueImageUrls(images);
    const key = imageDownloadHistoryKey(urls);
    if (!key) return null;
    const history = loadImageDownloadHistory();
    const record = {
      downloaded: Math.max(0, Number(downloaded || 0)),
      total: Math.max(Number(downloaded || 0), Number(total || 0)),
      batchId: String(batchId || ''),
      state: state === 'packaged' ? 'packaged' : 'downloaded',
      downloadedAt: new Date().toISOString(),
    };
    history[key] = record;
    saveImageDownloadHistory(history);
    if (button) renderImageDownloadRecord(button, record);
    return record;
  }

  function markImageGroupDownloadedByUrls(detail = {}) {
    const urls = [...new Set((detail.urls || []).map(String).filter(Boolean))];
    if (!urls.length) return false;
    refreshImageDownloadButtons();
    const wanted = new Set(urls.map(canonicalDownloadImageUrl).filter(Boolean));
    const buttons = [...document.querySelectorAll(`.${IMAGE_DOWNLOAD_CLASS}`)];
    const button = buttons.find((candidate) => {
      const container = candidate.__cgptImageDownloadContainer
        || candidate.closest?.('[data-cgpt-image-download-container]');
      const images = Array.isArray(candidate.__cgptImageDownloadImages)
        ? candidate.__cgptImageDownloadImages
        : groupImageElements(container || document);
      const current = new Set(uniqueImageUrls(images).map(canonicalDownloadImageUrl).filter(Boolean));
      return current.size > 0 && [...wanted].every((url) => current.has(url));
    }) || null;
    const downloaded = Math.max(0, Number(detail.downloaded || urls.length));
    const total = Math.max(downloaded, Number(detail.total || urls.length));
    if (button) {
      rememberImageDownload(button, downloaded, total, detail.batchId, detail.state, urls);
      return true;
    }
    const key = imageDownloadHistoryKey(urls);
    if (!key) return false;
    const history = loadImageDownloadHistory();
    history[key] = {
      downloaded,
      total,
      batchId: String(detail.batchId || ''),
      state: detail.state === 'packaged' ? 'packaged' : 'downloaded',
      downloadedAt: new Date().toISOString(),
    };
    saveImageDownloadHistory(history);
    return true;
  }

  // ChatGPT keeps the non-selected items of an image carousel mounted but
  // hidden (and sometimes at 0x0). They still carry the real image URL and
  // belong to the same downloadable group, so visibility must not decide
  // whether they are counted or downloaded.
  function groupImageElements(scope = document) {
    const root = scope === document ? (document.querySelector('main') || document.body) : scope;
    return [...root.querySelectorAll('img')].filter((img) => {
      if (img.closest?.(`#${APP_ID}, #${MENU_ID}, .${IMAGE_DOWNLOAD_SLOT_CLASS}, .${TEXT_DOWNLOAD_SLOT_CLASS}`)) return false;
      if (img.closest?.('#history, nav, aside, [role="navigation"]')) return false;
      if (img.closest?.('[data-radix-menu-content], [data-radix-popper-content-wrapper]')) return false;
      return Boolean(imageUrlForDirectDownload(img));
    });
  }

  function imageGroupElements(container, images = []) {
    return [...new Set([
      ...images,
      ...groupImageElements(container || document),
    ].filter((img) => img?.isConnected))];
  }

  function imageGroupUniqueCount(container, images = []) {
    const candidates = imageGroupElements(container, images).filter(isAssistantGeneratedImage);
    const urlCount = uniqueImageUrls(candidates).length;
    const declaredCount = inferDeclaredImageCount(container, null);
    return Math.max(urlCount || candidates.length, declaredCount);
  }

  function logImageDownloadStep(step, detail = {}) {
    try {
      console.info('[ChatGPT 图片下载快捷按钮]', step, detail);
      unsafeWindow.__cgptImageDownloadLastStep = {
        step,
        detail,
        time: new Date().toISOString(),
      };
    } catch {
      // 调试日志失败不影响下载流程。
    }
  }

  function setImageButtonStatus(button, text, busy = true) {
    const { status, count } = ensureImageButtonLabels(button);
    if (!button || !status || !count) return;
    const total = Number(button.dataset.cgptImageTotal || 0);
    const downloaded = Number(button.dataset.cgptImageDownloaded || 0);
    const countText = imageButtonLabel(total, downloaded);
    status.hidden = false;
    status.textContent = text;
    count.hidden = !countText;
    count.textContent = countText;
    button.dataset.cgptBusyText = busy ? text : '';
    button.classList.remove('cgpt-image-download-done');
  }

  function setImageButtonProgress(button, downloaded, total, busy = false, forcedState = '') {
    const { status, count } = ensureImageButtonLabels(button);
    if (!button || !status || !count) return;
    const safeTotal = Math.max(0, Number(total || 0));
    const safeDownloaded = Math.max(0, Math.min(safeTotal || Number(downloaded || 0), Number(downloaded || 0)));
    button.dataset.cgptImageDownloaded = String(safeDownloaded);
    if (safeTotal) button.dataset.cgptImageTotal = String(safeTotal);
    const complete = safeTotal > 0 && safeDownloaded >= safeTotal;
    const state = forcedState || (busy ? 'running' : (complete ? 'done' : 'idle'));
    const statusText = imageButtonStatusText(state);
    const countText = imageButtonLabel(safeTotal, safeDownloaded);
    button.dataset.cgptBusyText = busy ? statusText : '';
    status.hidden = !statusText;
    status.textContent = statusText;
    count.hidden = !countText;
    count.textContent = countText;
    button.classList.toggle('cgpt-image-download-done', complete && !busy);
    if (safeTotal) {
      button.title = complete
        ? `已下载 ${safeDownloaded}/${safeTotal} 张图片；再次点击可重新下载`
        : `已下载 ${safeDownloaded}/${safeTotal} 张图片；点击可下载本组图片`;
    }
  }

  function showImageDownloadToast(message, ok = true) {
    let toast = document.getElementById(IMAGE_DOWNLOAD_TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = IMAGE_DOWNLOAD_TOAST_ID;
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.append(toast);
    }
    toast.className = ok ? 'cgpt-image-download-toast-ok' : '';
    toast.textContent = message;
    window.clearTimeout(showImageDownloadToast.timer);
    showImageDownloadToast.timer = window.setTimeout(() => {
      toast.remove();
    }, 2000);
  }

  function textDownloadFilename(text = '') {
    const firstLine = String(text || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || 'chatgpt-text';
    const safe = firstLine
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 42) || 'chatgpt-text';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${safe}-${stamp}.txt`;
  }

  function textContentForDownload(card) {
    if (!card) return '';
    const clone = card.cloneNode(true);
    clone.querySelectorAll?.(`button, svg, .${TEXT_DOWNLOAD_SLOT_CLASS}, .${IMAGE_DOWNLOAD_SLOT_CLASS}, [aria-hidden="true"]`)
      .forEach((element) => element.remove());
    return String(clone.innerText || clone.textContent || '')
      .replace(/^\s*(text|txt|文本)\s*/i, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function textCardForCopyButton(copyButton) {
    if (!copyButton || copyButton.closest?.(`.${TEXT_DOWNLOAD_SLOT_CLASS}, .${IMAGE_DOWNLOAD_SLOT_CLASS}`)) return null;
    const candidates = [];
    let node = copyButton.parentElement;
    for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
      if (node.matches?.('main, article, [data-testid^="conversation-turn"], [data-message-author-role]')) break;
      if (node.querySelector?.('img')) continue;
      const rect = node.getBoundingClientRect?.();
      if (!rect || rect.width < 160 || rect.height < 42 || rect.height > 360) continue;
      const text = textContentForDownload(node);
      if (text.length < 12) continue;
      const buttonCount = node.querySelectorAll?.('button')?.length || 0;
      const hasTextBadge = /\b(text|txt)\b|文本/i.test(elementText(node));
      const score = (hasTextBadge ? 40 : 0)
        + (rect.height < 220 ? 12 : 0)
        + (buttonCount <= 4 ? 10 : 0)
        - Math.max(0, rect.height - 180) / 20;
      candidates.push({ node, score });
    }
    return candidates.sort((a, b) => b.score - a.score)[0]?.node || null;
  }

  function ensureTextDownloadButton(card, copyButton) {
    if (!card || !copyButton) return;
    let slot = copyButton.parentElement?.querySelector?.(`:scope > .${TEXT_DOWNLOAD_SLOT_CLASS}`) || null;
    if (!slot && copyButton.nextElementSibling?.classList?.contains(TEXT_DOWNLOAD_SLOT_CLASS)) {
      slot = copyButton.nextElementSibling;
    }
    if (!slot) {
      slot = document.createElement('span');
      slot.className = TEXT_DOWNLOAD_SLOT_CLASS;
      copyButton.insertAdjacentElement('afterend', slot);
    }
    slot.__cgptTextDownloadCard = card;
    let button = slot.querySelector(`.${TEXT_DOWNLOAD_CLASS}`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = TEXT_DOWNLOAD_CLASS;
      button.title = '下载这个文本为 TXT';
      button.setAttribute('aria-label', '下载 TXT');
      button.innerHTML = `${icons.download}<span>下载 TXT</span>`;
      slot.append(button);
    }
    button.__cgptTextDownloadCard = card;
    let copy = slot.querySelector(`.${TEXT_COPY_CLASS}`);
    if (!copy) {
      copy = document.createElement('button');
      copy.type = 'button';
      copy.className = TEXT_COPY_CLASS;
      copy.textContent = '复制文案';
      copy.setAttribute('aria-label', '复制本条文案');
      copy.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = textContentForDownload(copy.__cgptTextDownloadCard);
        if (!text) return showImageDownloadToast('没有检测到可复制文案', false);
        await navigator.clipboard.writeText(text);
        showImageDownloadToast('文案已复制', true);
      }, true);
      slot.prepend(copy);
    }
    copy.__cgptTextDownloadCard = card;
  }

  function isLikelyPublishCopyCard(card) {
    const text = textContentForDownload(card);
    if (text.replace(/\s/g, '').length < 300) return false;
    if (/母版页数不是输出上限|逐页迁移计划|迁移计划|等待.{0,12}(?:回复|输入).{0,6}1|暂时不出图/i.test(text)) return false;
    return /#[^\s#]{2,}|(?:适合|地点|行程|玩法|团建|公司团队|出发前)/i.test(text);
  }

  function hydrateReplyBoundTools() {
    const main = document.querySelector('main') || document.body;
    const imageGroups = new Map();
    [...main.querySelectorAll('img')].forEach((img) => {
      if (!isAssistantGeneratedImage(img) || !isNearViewport(img)) return;
      const turn = imageTurnContainer(img);
      if (!turn) return;
      const items = imageGroups.get(turn) || [];
      items.push(img);
      imageGroups.set(turn, items);
    });
    imageGroups.forEach((images, turn) => {
      try {
        const actionRow = findImageActionRow(turn);
        ensureImageDownloadButton(turn, images, actionRow);
      } catch (error) {
        document.documentElement.dataset.tbImageToolsError = String(error?.message || error).slice(0, 240);
      }
    });

    [...main.querySelectorAll('[data-message-author-role="assistant"]')].forEach((card) => {
      if (!isNearViewport(card) || card.querySelector('img') || !isLikelyPublishCopyCard(card)) return;
      const turn = card.closest?.('[data-testid^="conversation-turn"]') || card;
      if (turn.querySelector(`.${TEXT_DOWNLOAD_SLOT_CLASS}`)) return;
      const copyButton = [...turn.querySelectorAll('button')].find((button) => /复制|copy/i.test(elementText(button)));
      if (copyButton) ensureTextDownloadButton(card, copyButton);
      else {
        const placeholder = document.createElement('button');
        placeholder.type = 'button';
        placeholder.hidden = true;
        turn.append(placeholder);
        ensureTextDownloadButton(card, placeholder);
        placeholder.remove();
      }
    });
  }

  function refreshTextDownloadButtons() {
    const main = document.querySelector('main') || document.body;
    if (!messageDownloadToolsEnabled()) {
      main.querySelectorAll(`.${TEXT_DOWNLOAD_SLOT_CLASS}, .${IMAGE_DOWNLOAD_SLOT_CLASS}`).forEach((node) => node.remove());
      return;
    }
    [...main.querySelectorAll(`.${TEXT_DOWNLOAD_SLOT_CLASS}`)].forEach((slot) => {
      const copyButton = slot.previousElementSibling;
      const card = slot.__cgptTextDownloadCard || (copyButton ? textCardForCopyButton(copyButton) : null);
      if (!card) slot.remove();
    });
    [...main.querySelectorAll('button')].forEach((button) => {
      if (!isElementVisible(button) || button.closest?.(`#${APP_ID}, #${MENU_ID}, .${IMAGE_DOWNLOAD_SLOT_CLASS}, .${TEXT_DOWNLOAD_SLOT_CLASS}`)) return;
      const label = elementText(button);
      if (!/\u590d\u5236|copy/i.test(label)) return;
      const card = textCardForCopyButton(button);
      if (!card) return;
      ensureTextDownloadButton(card, button);
    });
  }

  function triggerTextDownloadButton(button, event = null) {
    if (!button) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    const card = button.__cgptTextDownloadCard || textCardForCopyButton(button.closest?.(`.${TEXT_DOWNLOAD_SLOT_CLASS}`)?.previousElementSibling);
    const text = textContentForDownload(card);
    if (!text) {
      window.alert('这个文本框里暂时没有找到可下载的文本。');
      return;
    }
    const blob = new Blob([`${text}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = textDownloadFilename(text);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 800);
    showImageDownloadToast('TXT 下载完成', true);
  }

  function triggerImageDownloadButton(button, event = null) {
    if (!button || button.disabled) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    logImageDownloadStep('外部按钮点击', {
      title: button.title,
      count: button.dataset.cgptImageCount,
    });
    runImageDownloadShortcut(button);
  }

  function setWorkPackageButtonState(button, state = 'idle') {
    if (!button) return;
    button.classList.remove('cgpt-work-package-called', 'cgpt-work-package-done');
    button.disabled = state === 'running';
    if (state === 'running') {
      button.classList.add('cgpt-work-package-called');
      button.innerHTML = `${icons.package}<span class="cgpt-work-package-label">打包中</span>`;
      button.title = '打包中：正在由团建内容工作台处理';
      button.setAttribute('aria-label', '打包中');
      return;
    }
    if (state === 'done') {
      button.classList.add('cgpt-work-package-done');
      button.innerHTML = `${icons.package}<span class="cgpt-work-package-label">打包完成</span>`;
      button.title = '打包完成';
      button.setAttribute('aria-label', '打包完成');
      return;
    }
    if (state === 'duplicate') {
      button.classList.add('cgpt-work-package-done');
      button.innerHTML = `${icons.package}<span class="cgpt-work-package-label">重复已跳过</span>`;
      button.title = '历史图片组已存在，本轮暂存图片已清理';
      button.setAttribute('aria-label', '重复已跳过');
      return;
    }
    button.innerHTML = `${icons.package}<span class="cgpt-work-package-label">下载并打包</span>`;
    button.title = '打包作品：整理已下载图片和剪贴板文案';
    button.setAttribute('aria-label', '打包作品');
  }

  async function triggerWorkPackageButton(button, event = null) {
    if (!button || button.disabled) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    setWorkPackageButtonState(button, 'running');
    showImageDownloadToast('正在保存文案，随后下载并核对本组图片...', true);
    try {
      const imageButton = button.__cgptImageDownloadButton;
      if (!imageButton) throw new Error('没有找到当前回复对应的图片下载按钮');
      const turn = imageButton.closest?.('[data-testid^="conversation-turn"], [data-message-author-role="assistant"]');
      const copyButton = turn?.querySelector?.('button[data-testid="copy-turn-action-button"], button[aria-label*="复制回复"], button[aria-label*="Copy response" i]');
      let replyText = textContentForDownload(textCardForCopyButton(copyButton));
      if (!replyText || (!replyText.includes('<<<XHS_START>>>') && !replyText.includes('小红书'))) {
        const turns = Array.from(document.querySelectorAll('[data-message-author-role="assistant"], [data-testid^="conversation-turn"]'));
        for (let i = turns.length - 1; i >= 0; i--) {
          const t = turns[i].innerText || '';
          if (t.includes('<<<XHS_START>>>') || (t.includes('小红书') && t.includes('抖音'))) {
            replyText = t;
            break;
          }
        }
      }
      const clipboardText = await navigator.clipboard.readText().catch(() => '');
      let copyText = '';
      if (replyText && (replyText.includes('<<<XHS_START>>>') || (replyText.includes('小红书') && replyText.includes('抖音')))) {
        copyText = String(replyText).trim();
      } else if (clipboardText && (clipboardText.includes('<<<XHS_START>>>') || clipboardText.includes('小红书'))) {
        copyText = String(clipboardText).trim();
      } else {
        copyText = String(replyText || clipboardText || '').trim();
      }
      if (!copyText) throw new Error('请先复制或下载本轮文案 TXT，再执行下载并打包');
      const priorDownload = imageDownloadRecordForButton(imageButton);
      const batchId = imageButton.dataset.cgptWorkPackageBatch
        || priorDownload?.batchId
        || `${new Date().toISOString().replace(/\D/g, '').slice(0, 8)}-${new Date().toTimeString().replace(/\D/g, '').slice(0, 6)}-${Math.random().toString(36).slice(2, 6)}`;
      imageButton.dataset.cgptWorkPackageBatch = batchId;
      const saveCopyText = globalThis.TeambuildingGptProductionSaveCopyText;
      if (typeof saveCopyText !== 'function') throw new Error('工作台文案保存桥接尚未就绪，请稍后再试');
      await saveCopyText({ copyText, batchId });
      showImageDownloadToast('文案 TXT 已保存，开始下载本组图片...', true);
      const currentTotal = Number(imageButton.dataset.cgptImageTotal || 0)
        || uniqueImageUrls(imageButton.__cgptImageDownloadImages || []).length;
      const canReuseDownload = Boolean(
        priorDownload?.batchId
        && priorDownload.state === 'downloaded'
        && Number(priorDownload.downloaded || 0) >= currentTotal
        && Number(priorDownload.total || 0) === currentTotal
      );
      const downloadResult = canReuseDownload
        ? {
            batchId: priorDownload.batchId,
            downloaded: Number(priorDownload.downloaded || 0),
            total: Number(priorDownload.total || 0),
          }
        : await runImageDownloadShortcut(imageButton);
      if (canReuseDownload) showImageDownloadToast(`复用已下载图片：${downloadResult.downloaded}/${downloadResult.total}`, true);
      if (!downloadResult?.batchId || downloadResult.downloaded !== downloadResult.total) {
        throw new Error(`本组图片未完整下载：${downloadResult?.downloaded || 0}/${downloadResult?.total || 0}`);
      }
      const packageRequest = {
        clipboardText: copyText,
        title: currentWorkPackageConversationTitle(),
        conversationUrl: currentWorkPackageConversationUrl(),
        accountName: currentWorkPackageAccountName(),
        batchId: downloadResult.batchId || batchId,
        expectedImageCount: downloadResult.total,
      };
      const response = typeof globalThis.TeambuildingGptProductionPackage === 'function'
        ? await globalThis.TeambuildingGptProductionPackage(packageRequest)
        : await chrome.runtime.sendMessage({
            type: 'tb-work-package',
            baseUrl: /^http:\/\/127\.0\.0\.1:\d+$/.test(localStorage.getItem('tb-workbench-api-root') || '')
              ? localStorage.getItem('tb-workbench-api-root')
              : undefined,
            body: packageRequest,
          });
      if (!response?.ok) {
        throw new Error(response?.error || '本地工作台未返回打包结果');
      }
      if (response.duplicate) {
        setWorkPackageButtonState(button, 'duplicate');
        rememberImageDownload(imageButton, downloadResult.downloaded, downloadResult.total, downloadResult.batchId, 'downloaded');
        showImageDownloadToast(`历史图片组已存在，已清理 ${Number(response.deletedImages || 0)} 张暂存图`, true);
        return;
      }
      setWorkPackageButtonState(button, 'done');
      rememberImageDownload(imageButton, downloadResult.downloaded, downloadResult.total, downloadResult.batchId, 'packaged');
      showImageDownloadToast('打包完成', true);
    } catch (error) {
      console.warn('[ChatGPT 作品包按钮] 工作台直接打包失败：', error);
      const message = `打包失败：${error?.message || error}`;
      showImageDownloadToast(message, false);
      document.dispatchEvent(new CustomEvent('tb-gpt-package-status', {
        detail: { status: 'error', message, source: 'manual' }
      }));
      setWorkPackageButtonState(button, 'idle');
      button.title = `${message}；点击可重试`;
      return;
    }
  }

  function openWorkPackageProtocol(url) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function ensureImageDownloadButton(container, images, preferredActionRow = null) {
    const generatedImages = (images || []).filter(isAssistantGeneratedImage);
    if (!generatedImages.length) {
      container?.querySelector?.(`.${IMAGE_DOWNLOAD_SLOT_CLASS}`)?.remove();
      return;
    }
    if (!messageDownloadToolsEnabled()) {
      container.querySelector(`.${IMAGE_DOWNLOAD_SLOT_CLASS}`)?.remove();
      return;
    }
    // A single assistant turn can contain several carousel shells and more than
    // one native action row.  Treat the outer conversation turn as the only
    // production-image group, otherwise every carousel/action row injects its
    // own copy of "download / package" controls.
    const turn = generatedImages[0]?.closest?.('[data-testid^="conversation-turn"]');
    if (turn) {
      container = turn;
      preferredActionRow = findImageActionRow(turn);
    }
    container.setAttribute('data-cgpt-image-download-container', 'true');
    const existingSlots = [...container.querySelectorAll(`.${IMAGE_DOWNLOAD_SLOT_CLASS}`)];
    let slot = existingSlots.shift() || null;
    existingSlots.forEach((duplicate) => duplicate.remove());
    if (preferredActionRow && slot && slot.parentElement !== preferredActionRow) {
      slot.remove();
      slot = null;
    }
    if (!slot) {
      slot = document.createElement('span');
      slot.className = IMAGE_DOWNLOAD_SLOT_CLASS;
      const actionRow = preferredActionRow || findImageActionRow(container);
      if (actionRow) actionRow.append(slot);
      else {
        slot.classList.add('cgpt-image-download-fallback');
        container.append(slot);
      }
    }
    const groupElements = imageGroupElements(container, generatedImages).filter(isAssistantGeneratedImage);
    const count = imageGroupUniqueCount(container, generatedImages) || groupElements.length || generatedImages.length;
    let button = slot.querySelector(`.${IMAGE_DOWNLOAD_CLASS}`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = IMAGE_DOWNLOAD_CLASS;
      button.setAttribute('aria-label', '\u4e0b\u8f7d\u672c\u7ec4\u56fe\u7247');
      button.addEventListener('click', (event) => {
        triggerImageDownloadButton(button, event);
      }, true);
      slot.append(button);
    }
    let packageButton = slot.querySelector(`.${WORK_PACKAGE_CLASS}`);
    if (workPackageButtonVisible) {
      if (!packageButton) {
        packageButton = document.createElement('button');
        packageButton.type = 'button';
        packageButton.className = WORK_PACKAGE_CLASS;
        setWorkPackageButtonState(packageButton, 'idle');
        packageButton.addEventListener('click', (event) => {
          triggerWorkPackageButton(packageButton, event);
        }, true);
        slot.append(packageButton);
      }
      packageButton.onclick = (event) => triggerWorkPackageButton(packageButton, event);
      packageButton.__cgptImageDownloadButton = button;
    } else if (packageButton) {
      packageButton.remove();
    }
    button.onclick = (event) => triggerImageDownloadButton(button, event);
    button.__cgptImageDownloadContainer = container;
    button.__cgptImageDownloadImages = groupElements;
    const declaredCount = Number(button.dataset.cgptExactCount || 0)
      || count
      || inferDeclaredImageCount(container, preferredActionRow || slot.parentElement);
    const totalCount = declaredCount || count || 0;
    const previousTotal = Number(button.dataset.cgptImageTotal || 0);
    if (!button.disabled && previousTotal && totalCount && previousTotal !== totalCount) {
      button.dataset.cgptImageDownloaded = '0';
    }
    button.dataset.cgptImageTotal = String(totalCount || '');
    button.dataset.cgptImageCount = String(totalCount || '');
    button.dataset.cgptImageElementCount = String(groupElements.length);
    button.title = declaredCount > 1
      ? `\u4e0b\u8f7d\u672c\u7ec4\u4e2d\u7684 ${declaredCount} \u5f20\u56fe\u7247`
      : '\u4e0b\u8f7d\u672c\u7ec4\u56fe\u7247';
    if (!button.disabled) {
      const downloaded = Number(button.dataset.cgptImageDownloaded || 0);
      const countText = imageButtonLabel(totalCount, downloaded);
      const done = totalCount > 0 && downloaded >= totalCount;
      const statusText = imageButtonStatusText(done ? 'done' : 'idle');
      const status = `<span class="cgpt-image-download-status" data-cgpt-image-download-status${statusText ? '' : ' hidden'}>${escapeHtml(statusText)}</span>`;
      const badge = `<span class="cgpt-image-download-count" data-cgpt-image-download-label${countText ? '' : ' hidden'}>${escapeHtml(countText)}</span>`;
      button.innerHTML = `${icons.download}<span class="cgpt-image-download-label">\u4e0b\u8f7d\u672c\u7ec4</span>${status}${badge}`;
      button.classList.toggle('cgpt-image-download-done', done);
      if (downloaded) setImageButtonProgress(button, downloaded, totalCount, false);
    }
    const savedDownload = imageDownloadRecordForButton(button);
    if (savedDownload) renderImageDownloadRecord(button, savedDownload);
  }

  function refreshImageDownloadButtons() {
    try { actionRowsOnPage().forEach((row) => {
      const existingSlot = row.querySelector(`.${IMAGE_DOWNLOAD_SLOT_CLASS}`);
      const group = nearbyImagesForActionRow(row);
      if (!group?.images?.length) {
        existingSlot?.remove();
        return;
      }
      const existingButton = existingSlot?.querySelector(`.${IMAGE_DOWNLOAD_CLASS}`);
      const currentElements = imageGroupElements(group.container, group.images);
      const currentCount = imageGroupUniqueCount(group.container, group.images) || currentElements.length;
      const previousElementCount = Number(existingButton?.dataset.cgptImageElementCount || 0);
      const previousCount = Number(existingButton?.dataset.cgptImageCount || 0);
      if (!existingButton || previousElementCount !== currentElements.length || previousCount !== currentCount) {
        ensureImageDownloadButton(group.container, group.images, row);
      }
    }); } catch (error) {
      document.documentElement.dataset.tbImageToolsError = String(error?.message || error).slice(0, 240);
    }
    try { imageGroupsOnPage().forEach(([container, images]) => {
      if (container.querySelector(`.${IMAGE_DOWNLOAD_CLASS}`)) return;
      ensureImageDownloadButton(container, images);
    }); } catch (error) {
      document.documentElement.dataset.tbImageToolsError = String(error?.message || error).slice(0, 240);
    }
    hydrateReplyBoundTools();
    // Final defensive pass: ChatGPT mutates action rows asynchronously, so an
    // older slot may briefly survive while a replacement row is mounted. Keep
    // exactly one slot per generated assistant turn.
    try {
      const main = document.querySelector('main') || document.body;
      main.querySelectorAll(
        `[data-testid="image-gen-overlay-right-actions"] .${IMAGE_DOWNLOAD_SLOT_CLASS}, [data-testid*="image-gen-overlay"] .${IMAGE_DOWNLOAD_SLOT_CLASS}`
      ).forEach((slot) => slot.remove());
      const slotsByTurn = new Map();
      [...main.querySelectorAll(`.${IMAGE_DOWNLOAD_SLOT_CLASS}`)].forEach((slot) => {
        const turn = slot.closest?.('[data-testid^="conversation-turn"]');
        if (!turn) return;
        const slots = slotsByTurn.get(turn) || [];
        slots.push(slot);
        slotsByTurn.set(turn, slots);
      });
      slotsByTurn.forEach((slots) => slots.slice(1).forEach((slot) => slot.remove()));
    } catch (error) {
      document.documentElement.dataset.tbImageToolsError = String(error?.message || error).slice(0, 240);
    }
    try { refreshTextDownloadButtons(); } catch (error) {
      document.documentElement.dataset.tbImageToolsError = String(error?.message || error).slice(0, 240);
    }
  }

  function generatingNow() {
    const stopSelectors = [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="stop"]',
      'button[aria-label*="停止"]',
    ];
    return stopSelectors.some((selector) => [...document.querySelectorAll(selector)]
      .some((button) => isElementVisible(button) && !button.disabled));
  }

  function scheduleImageDownloadButtons() {
    window.clearTimeout(imageToolsTimer);
    // Streaming replies can mutate the DOM multiple times per second. Scanning
    // a long image-heavy conversation for every token blocks ChatGPT's own
    // renderer and delays the send/stop button state used by automation.
    if (generatingNow()) {
      imageToolsTimer = window.setTimeout(scheduleImageDownloadButtons, 2400);
      return;
    }
    imageToolsTimer = window.setTimeout(() => {
      runWhenIdle(refreshImageDownloadButtons, 1200);
    }, 420);
  }

  function bindImageDownloadEvents() {
    if (imageEventsBound) return;
    imageEventsBound = true;
    document.addEventListener('click', (event) => {
      const workPackageButton = event.target.closest?.(`.${WORK_PACKAGE_CLASS}`);
      if (workPackageButton) {
        triggerWorkPackageButton(workPackageButton, event);
        return;
      }
      const textDownloadButton = event.target.closest?.(`.${TEXT_DOWNLOAD_CLASS}`);
      if (textDownloadButton) {
        triggerTextDownloadButton(textDownloadButton, event);
        return;
      }
      if (event.target.closest?.(`.${TEXT_COPY_CLASS}`)) return;
      const imageDownloadButton = event.target.closest?.(`.${IMAGE_DOWNLOAD_CLASS}`);
      if (!imageDownloadButton) return;
      triggerImageDownloadButton(imageDownloadButton, event);
    }, true);
  }

  function largestImage(images) {
    return [...images].sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (br.width * br.height) - (ar.width * ar.height);
    })[0];
  }

  function clickTargetForImage(img) {
    return img.closest?.('button, a, [role="button"]') || img;
  }

  function topPreviewDownloadButton() {
    const previewImages = broadImageElements(document, 90)
      .map((img) => ({ img, rect: img.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > Math.min(220, innerWidth * 0.18) && rect.height > 160)
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
    const imageRect = previewImages[0]?.rect || null;

    const candidates = [...document.querySelectorAll('button, [role="button"], a')]
      .filter((button) => {
        if (button.closest?.(`.${IMAGE_DOWNLOAD_SLOT_CLASS}, .${TEXT_DOWNLOAD_SLOT_CLASS}, #${APP_ID}, #${MENU_ID}`)) return false;
        const rect = button.getBoundingClientRect?.();
        if (!rect || rect.width < 5 || rect.height < 5) return false;
        if (rect.right < 0 || rect.bottom < 0 || rect.left > innerWidth || rect.top > innerHeight) return false;
        const style = getComputedStyle(button);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
      })
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const text = elementText(button);
        const html = button.innerHTML || '';
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        let score = 0;

        const looksLikeDownloadIcon = /download|arrow|Down|M9 3v|M12 3v|M12 15|M12 5|M5\.5 8|M7 10|M4 14\.5|M12 16|M19 14|M21 15|M5 20/i.test(html);
        const isTopToolbar = rect.top < Math.max(150, innerHeight * 0.18)
          && rect.right > innerWidth * 0.58
          && rect.left > innerWidth * 0.32;
        const hasDownloadMeaning = looksLikeDownloadIcon || /\u4e0b\u8f7d|download/i.test(text);

        if (/\u4e0b\u8f7d|download/i.test(text)) score += 120;
        if (looksLikeDownloadIcon) score += 60;
        if (button.querySelector('svg')) score += 16;
        if (isTopToolbar) score += looksLikeDownloadIcon ? 260 : 50;
        if (/\u5206\u4eab|share|\u66f4\u591a|more|\u5173\u95ed|close|\u8fd4\u56de|back|\u8bc4\u8bba|comment/i.test(text)) {
          score -= 160;
        }
        if (button.closest?.('[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]')) {
          score -= 80;
        }
        return { button, score, text, isTopToolbar, hasDownloadMeaning };
      })
      .filter((item) => item.isTopToolbar && item.hasDownloadMeaning && item.score > 90)
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.button || null;
  }

  function visibleNativeDownloadMenuItem() {
    const menuScopes = [...document.querySelectorAll(
      '[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]'
    )].filter(isElementVisible);
    const scopes = menuScopes.length ? menuScopes : [document.body];
    const candidates = scopes.flatMap((scope) => [
      ...scope.querySelectorAll('[role="menuitem"], button, a')
    ]).filter((element) => (
      !element.closest?.(`.${IMAGE_DOWNLOAD_SLOT_CLASS}, .${TEXT_DOWNLOAD_SLOT_CLASS}`)
      && isElementVisible(element)
      && /\u4e0b\u8f7d|download/i.test(elementText(element))
    ));
    return candidates.find((element) => /\u4e0b\u8f7d\u672c\u7ec4|\u672c\u7ec4.*\d+.*\u5f20|download all|download.*all|download.*\d+.*image/i.test(elementText(element)))
      || candidates.find((element) => /\u4e0b\u8f7d\u56fe\u7247|download image/i.test(elementText(element)))
      || candidates[0];
  }

  function imageUrlForDirectDownload(img) {
    const src = img?.currentSrc || img?.src || '';
    if (!src || /^data:image\/svg/i.test(src)) return '';
    return src;
  }

  function directDownloadName(index, url, batchId = '', total = 0) {
    let ext = 'jpg';
    try {
      const pathname = new URL(url, location.href).pathname;
      const match = pathname.match(/\.([a-z0-9]{3,5})(?:$|[?#])/i) || pathname.match(/\.([a-z0-9]{3,5})$/i);
      if (match?.[1] && !/html?|aspx?|php/i.test(match[1])) ext = match[1].toLowerCase();
    } catch {
      // keep default
    }
    if (batchId && total > 0) {
      return `chatgpt-workpkg-${batchId}-${String(index + 1).padStart(2, '0')}-of-${String(total).padStart(2, '0')}.${ext}`;
    }
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    return `chatgpt-image-group-${stamp}-${String(index + 1).padStart(2, '0')}.${ext}`;
  }

  function imageBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }

  async function gmDownload(url, name) {
    try {
      const imageResponse = await fetch(url, { credentials: 'include', cache: 'no-store' });
      if (!imageResponse.ok) throw new Error(`图片读取失败：HTTP ${imageResponse.status}`);
      const contentType = String(imageResponse.headers.get('content-type') || 'image/png');
      if (!/^image\/(?:png|jpe?g|webp)$/i.test(contentType)) {
        throw new Error(`图片响应类型无效：${contentType}`);
      }
      const requestId = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const apiRoot = /^http:\/\/127\.0\.0\.1:\d+$/.test(localStorage.getItem('tb-workbench-api-root') || '')
        ? localStorage.getItem('tb-workbench-api-root')
        : 'http://127.0.0.1:4327';
      const saveResponse = await fetch(`${apiRoot}/api/extension/save-generated-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: name,
          requestId,
          contentType,
          data: imageBufferToBase64(await imageResponse.arrayBuffer()),
          sourceUrl: url,
          downloadRoot: ''
        })
      });
      const result = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok || !result?.ok || !result?.filename) {
        throw new Error(result?.error || `工作台保存失败：HTTP ${saveResponse.status}`);
      }
      return true;
    } catch (error) {
      console.warn('[ChatGPT 图片下载快捷按钮] 工作台直存失败：', error);
      return false;
    }
  }

  async function downloadUrlsConcurrently(urls, onProgress = null, concurrency = 4, batchId = '') {
    const total = urls.length;
    const limit = Math.max(1, Math.min(8, Number(concurrency || 4), total || 1));
    let nextIndex = 0;
    let ok = 0;
    const worker = async () => {
      while (nextIndex < total) {
        const index = nextIndex;
        nextIndex += 1;
        const success = await gmDownload(urls[index], directDownloadName(index, urls[index], batchId, total));
        if (success) ok += 1;
        if (onProgress) {
          try { onProgress(ok, total); } catch {}
        }
      }
    };
    await Promise.all(Array.from({ length: limit }, worker));
    return ok;
  }

  async function directDownloadImagesFromContainer(container, seedImages = []) {
    const allImages = [
      ...seedImages,
      ...groupImageElements(container || document),
    ];
    const urls = [];
    const seen = new Set();
    allImages.forEach((img) => {
      const url = imageUrlForDirectDownload(img);
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    });
    const usableUrls = urls
      .filter((url) => !/^data:image\/svg/i.test(url))
      .slice(0, 20);
    logImageDownloadStep('直接下载兜底候选', {
      count: usableUrls.length,
      sample: usableUrls.slice(0, 3),
    });
    if (!usableUrls.length) return 0;
    return downloadUrlsConcurrently(usableUrls, null, 4);
  }

  async function openPreviewAndFindDownloadButton(images, label = null) {
    let downloadButton = topPreviewDownloadButton();
    if (downloadButton) return downloadButton;

    const image = largestImage(images);
    if (!image) return null;
    image.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    await sleep(220);

    const clickSteps = [
      () => dispatchNativeClickAt(image, 0.5, 0.5),
      () => dispatchNativeClick(clickTargetForImage(image)),
      () => dispatchNativeClickAt(image, 0.5, 0.22),
      () => dispatchNativeClickAt(image, 0.5, 0.78),
      () => dispatchNativeClickAt(image, 0.24, 0.5),
      () => dispatchNativeClickAt(image, 0.76, 0.5),
    ];

    for (let index = 0; index < clickSteps.length; index += 1) {
      if (label) label.textContent = index ? '\u91cd\u8bd5\u6253\u5f00\u2026' : '\u6253\u5f00\u9884\u89c8\u2026';
      clickSteps[index]();
      downloadButton = await waitForValue(() => topPreviewDownloadButton(), index ? 1350 : 1900, 80);
      if (downloadButton) return downloadButton;
      await sleep(120);
    }

    return null;
  }

  function dispatchEscapeKey() {
    const eventInit = {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    [document.activeElement, document, window].filter(Boolean).forEach((target) => {
      target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      target.dispatchEvent(new KeyboardEvent('keyup', eventInit));
    });
  }

  async function closeImagePreview(delay = 0) {
    if (delay) await sleep(delay);
    const closeButton = [...document.querySelectorAll('button')]
      .filter(isElementVisible)
      .find((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left < 140
          && rect.top < Math.max(170, innerHeight * 0.22)
          && /\u5173\u95ed|close|\u8fd4\u56de|back/i.test(elementText(button));
      })
      || [...document.querySelectorAll('button')]
        .filter(isElementVisible)
        .find((button) => {
          const rect = button.getBoundingClientRect();
          return rect.left < 120
            && rect.top < Math.max(150, innerHeight * 0.18)
            && rect.width <= 70
            && rect.height <= 70;
        });
    if (closeButton) return dispatchNativeClick(closeButton);
    dispatchEscapeKey();
    return false;
  }

  function closeImagePreviewSoon(delay = 850) {
    window.setTimeout(() => {
      closeImagePreview(0);
    }, delay);
  }

  async function directDownloadImages(images, onProgress = null, batchId = '') {
    const urls = [];
    const seen = new Set();
    images.forEach((img) => {
      const url = imageUrlForDirectDownload(img);
      if (!url || seen.has(url)) return;
      seen.add(url);
      urls.push(url);
    });
    const usableUrls = urls.filter((url) => !/^data:image\/svg/i.test(url));
    if (!usableUrls.length) return 0;
    if (onProgress) {
      try { onProgress(0, usableUrls.length); } catch {}
    }
    return downloadUrlsConcurrently(usableUrls, onProgress, 4, batchId);
  }

  async function runImageDownloadShortcut(button) {
    if (button.disabled) return null;
    const container = button.__cgptImageDownloadContainer
      || button.closest('[data-cgpt-image-download-container]')
      || document;
    let images = [];
    if (Array.isArray(button.__cgptImageDownloadImages)) {
      images = button.__cgptImageDownloadImages.filter((img) => img?.isConnected);
    }
    if (!images.length) {
      images = groupImageElements(container);
    }
    if (!images.length) {
      console.warn('[AutoHeal] 未找到可下载图片，跳过弹窗阻断。');
      return null;
    }

    const label = button.querySelector('[data-cgpt-image-download-label]');
    let totalImages = Number(button.dataset.cgptImageTotal || 0)
      || uniqueImageUrls(images).length
      || images.length;
    const batchId = button.dataset.cgptWorkPackageBatch
      || `${new Date().toISOString().replace(/\D/g, '').slice(0, 8)}-${new Date().toTimeString().replace(/\D/g, '').slice(0, 6)}-${Math.random().toString(36).slice(2, 6)}`;
    button.dataset.cgptWorkPackageBatch = batchId;
    button.disabled = true;
    setImageButtonProgress(button, 0, totalImages, true);

    let downloaded = 0;
    try {
      logImageDownloadStep('\u5f00\u59cb\u76f4\u63a5\u4e0b\u8f7d', {
        imageCount: images.length,
        containerText: compactTitle(container.innerText || '').slice(0, 120),
      });
      downloaded = await directDownloadImages(images, (current, total) => {
        totalImages = total || totalImages;
        setImageButtonProgress(button, current, totalImages, true);
      }, batchId);
      if (!downloaded) {
        console.warn('[AutoHeal] 下载失败，已记录日志，跳过弹窗阻断。');
      } else if (totalImages && downloaded >= totalImages) {
        rememberImageDownload(button, downloaded, totalImages, batchId, 'downloaded');
        showImageDownloadToast(`图片下载完成：${downloaded}/${totalImages}`, true);
      } else {
        rememberImageDownload(button, downloaded, totalImages, batchId, 'downloaded');
        showImageDownloadToast(`图片下载完成：${downloaded}/${totalImages || downloaded}，有图片未成功`, false);
      }
    } catch (error) {
      console.warn('[ChatGPT \u56fe\u7247\u4e0b\u8f7d\u5feb\u6377\u6309\u94ae] \u4e0b\u8f7d\u5931\u8d25\uff1a', error);
      console.warn('[AutoHeal] 下载出错，已记录日志，跳过弹窗阻断。');
    } finally {
      window.setTimeout(() => {
        button.disabled = false;
        setImageButtonProgress(button, downloaded, totalImages, false, downloaded ? 'done' : 'idle');
      }, 600);
    }
    return { batchId, downloaded, total: totalImages };
  }

  function handleAction(actionElement) {
    const action = actionElement.dataset.cgptAction;
    const nodeId = actionElement.dataset.nodeId;

    if (action === 'add-folder') addFolder();
    else if (action === 'batch-group') showBatchGroupingMenu(actionElement);
    else if (action === 'preload-history') preloadAllHistoryChats(actionElement);
    else if (action === 'condition-group') groupByTitleCondition();
    else if (action === 'data-menu') showDataMenu(actionElement);
    else if (action === 'toggle-ungrouped') {
      ungroupedCollapsed = !ungroupedCollapsed;
      try {
        GM_setValue(UNGROUPED_COLLAPSED_KEY, ungroupedCollapsed);
      } catch {
        // 折叠状态不是关键数据。
      }
      queueRender();
    }
    else if (action === 'export-data') {
      exportGroupData();
      closeMenu();
    } else if (action === 'copy-diagnostics') {
      copyDiagnosticLogs();
      closeMenu();
    } else if (action === 'clear-diagnostics') {
      clearDiagnosticLogs();
      closeMenu();
    } else if (action === 'import-data-merge') {
      chooseImportFile('merge');
      closeMenu();
    } else if (action === 'import-data-replace') {
      chooseImportFile('replace');
      closeMenu();
    } else if (action === 'restore-snapshot') {
      restoreBestSnapshot();
      closeMenu();
    }
    else if (action === 'add-child') addFolder(nodeId);
    else if (action === 'rename-folder') renameFolder(nodeId);
    else if (action === 'delete-folder') deleteFolder(nodeId);
    else if (action === 'folder-menu') showFolderMenu(actionElement, nodeId);
    else if (action === 'batch-rename-folder') showBatchRenameDialog(nodeId);
    else if (action === 'open-folder-move-picker') {
      showMoveFolderMenu(nodeId, actionElement);
    } else if (action === 'move-folder-to-folder') {
      movePayload(
        { kind: 'folder', nodeId },
        { kind: 'folder', nodeId: actionElement.dataset.folderId }
      );
      closeMenu();
    } else if (action === 'move-folder-root') {
      movePayload({ kind: 'folder', nodeId }, { kind: 'root' });
      closeMenu();
    }
    else if (action === 'move-chat-to-folder') {
      movePayload(
        { kind: 'chat', chatId: actionElement.dataset.chatId },
        { kind: 'folder', nodeId: actionElement.dataset.folderId }
      );
      closeMenu();
    } else if (action === 'remove-chat-from-folder') {
      const chatNode = findChatNode(actionElement.dataset.chatId);
      if (chatNode) unclassifyChatNode(chatNode.id);
      closeMenu();
    } else if (action === 'new-folder-for-chat') {
      addFolder(null, actionElement.dataset.chatId);
      closeMenu();
    } else if (action === 'batch-next') {
      showBatchFolderMenu(actionElement);
    } else if (action === 'batch-move-to-folder') {
      moveChatsToFolder(batchSelectedChatIds, actionElement.dataset.folderId);
      batchSelectedChatIds = [];
      closeMenu();
    } else if (action === 'batch-new-folder') {
      addFolderWithChats(batchSelectedChatIds);
      batchSelectedChatIds = [];
      closeMenu();
    }
    else if (action === 'toggle-folder') {
      const folder = findNode(nodeId)?.node;
      if (folder?.type === 'folder') {
        folder.collapsed = !folder.collapsed;
        persistAndRender(true);
      }
    } else if (action === 'collapse-all') {
      const folders = [];
      const collect = (nodes) => nodes.forEach((node) => {
        if (node.type === 'folder') {
          folders.push(node);
          collect(node.children);
        }
      });
      collect(state.tree);
      const collapse = folders.some((folder) => !folder.collapsed);
      folders.forEach((folder) => { folder.collapsed = collapse; });
      persistAndRender(true);
    }
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    document.addEventListener('click', (event) => {
      const proxyOptions = event.target.closest?.('[data-cgpt-proxy-options]');
      if (proxyOptions) {
        event.preventDefault();
        event.stopPropagation();
        const chatId = proxyOptions.dataset.cgptProxyOptions;
        openNativeOptionsForChat(chatId, proxyOptions);
        return;
      }

      const proxyLink = event.target.closest?.(`#${APP_ID} .cgpt-fallback-link[href]`);
      if (proxyLink) {
        const row = proxyLink.closest('[data-chat-id]');
        const chatId = row?.dataset.chatId;
        if (chatId) {
          event.preventDefault();
          event.stopPropagation();
          addDiagnosticLog('click:proxy-link', {
            chatId,
            href: proxyLink.getAttribute('href') || '',
          });
          requestOpenChat(chatId, proxyLink.getAttribute('href') || '');
        }
        return;
      }

      const proxyRow = event.target.closest?.(`#${APP_ID} .cgpt-fallback-chat[data-chat-id]`);
      if (proxyRow) {
        const chatId = proxyRow.dataset.chatId;
        const fallbackLink = proxyRow.querySelector('.cgpt-fallback-link[href]');
        if (chatId) {
          event.preventDefault();
          event.stopPropagation();
          addDiagnosticLog('click:proxy-row', {
            chatId,
            href: fallbackLink?.getAttribute('href') || '',
            target: event.target?.tagName || '',
          });
          requestOpenChat(chatId, fallbackLink?.getAttribute('href') || '');
        }
        return;
      }

      const renameAction = event.target.closest?.('[data-cgpt-rename-action]');
      if (renameAction) {
        event.preventDefault();
        event.stopPropagation();
        const action = renameAction.dataset.cgptRenameAction;
        if (action === 'close') closeBatchRenameDialog();
        else if (action === 'save') startBatchRename();
        else if (action === 'stop' && renameRun) renameRun.stopped = true;
        return;
      }

      const nativeAction = event.target.closest?.('[data-cgpt-native-menu-action]');
      if (nativeAction) {
        event.preventDefault();
        event.stopPropagation();
        const chatId = pendingNativeMenuChatId;
        const action = nativeAction.dataset.cgptNativeMenuAction;
        if (action === 'open-folder-picker' && chatId) {
          showMoveToFolderMenu(chatId, nativeAction);
          window.setTimeout(dismissNativeMenu, 0);
        } else if (action === 'export-markdown' && chatId) {
          void exportConversationMarkdown(chatId);
        } else if (action === 'remove-from-folder' && chatId) {
          const chatNode = findChatNode(chatId);
          if (chatNode) unclassifyChatNode(chatNode.id);
          window.setTimeout(dismissNativeMenu, 0);
        }
        return;
      }

      const promptAction = event.target.closest?.('[data-cgpt-prompt-action]');
      if (promptAction) {
        event.preventDefault();
        event.stopPropagation();
        const action = promptAction.dataset.cgptPromptAction;
        const promptId = promptAction.dataset.promptId || '';
        if (action === 'new') {
          editingPromptId = 'new';
          renderPromptPanel();
        } else if (action === 'edit') {
          editingPromptId = promptId;
          renderPromptPanel();
        } else if (action === 'delete') {
          deletePrompt(promptId);
        } else if (action === 'insert') {
          insertPrompt(promptId);
        } else if (action === 'sync-cloud') {
          void syncCloudPrompts(true);
        } else if (action === 'toggle-help') {
          promptHelpVisible = !promptHelpVisible;
          renderPromptPanel();
        } else if (action === 'restore-cloud') {
          restorePreviousCloudPrompts();
        } else if (action === 'export-cloud') {
          exportCloudPromptFile();
        } else if (action === 'save') {
          upsertPromptFromPanel();
        } else if (action === 'cancel') {
          editingPromptId = '';
          renderPromptPanel();
        } else if (action === 'close') {
          closePromptPanel();
        }
        return;
      }

      const actionElement = event.target.closest?.('[data-cgpt-action]');
      if (actionElement) {
        event.preventDefault();
        event.stopPropagation();
        const fromRecentNativeMenu = Boolean(
          actionElement.closest('[role="menu"], [data-radix-menu-content], [data-radix-popper-content-wrapper]')
          && actionElement.dataset.cgptRecentMenuItem
        );
        handleAction(actionElement);
        if (fromRecentNativeMenu) window.setTimeout(dismissNativeMenu, 0);
        if (
          actionElement.closest(`#${MENU_ID}`)
          && !['open-folder-move-picker', 'batch-next'].includes(
            actionElement.dataset.cgptAction
          )
        ) closeMenu();
        return;
      }
      if (!event.target.closest?.(`#${MENU_ID}`)) closeMenu();
      if (!event.target.closest?.(`#${PROMPT_PANEL_ID}, #${PROMPT_BUTTON_ID}`)) {
        closePromptPanel();
      }
    }, true);

    document.addEventListener('change', (event) => {
      if (event.target.id === IMPORT_INPUT_ID) {
        handleImportFile(event.target.files?.[0]);
        return;
      }
      const menu = event.target.closest?.(`#${MENU_ID}.cgpt-batch-menu`);
      if (!menu) return;
      if (event.target.matches('[data-cgpt-batch-select-all]')) {
        menu.querySelectorAll('.cgpt-batch-row input')
          .forEach((input) => { input.checked = event.target.checked; });
      }
      updateBatchMenuState();
    }, true);

    document.addEventListener('input', (event) => {
      if (event.target.matches?.(`#${RENAME_ID} .cgpt-rename-input`)) {
        updateRenameEditorState();
      }
    }, true);

    window.addEventListener('resize', () => {
      positionPromptPanel();
    }, { passive: true });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !document.getElementById(RENAME_ID)?.hidden) {
        closeBatchRenameDialog();
      }
      if (event.key === 'Escape' && !document.getElementById(PROMPT_PANEL_ID)?.hidden) {
        closePromptPanel();
      }
      const promptRow = event.target.closest?.(`#${PROMPT_PANEL_ID} .cgpt-prompt-row[data-cgpt-prompt-action="insert"]`);
      if (
        promptRow
        && event.target === promptRow
        && (event.key === 'Enter' || event.key === ' ')
      ) {
        event.preventDefault();
        event.stopPropagation();
        insertPrompt(promptRow.dataset.promptId || '');
      }
    }, true);

    document.addEventListener('pointerdown', (event) => {
      const button = event.target.closest?.('button');
      const label = button?.getAttribute('aria-label') || '';
      const visibleLabel = compactTitle(`${label} ${button?.innerText || ''}`);
      if (
        button
        && (
          /整理聊天|organize chats/i.test(visibleLabel)
          || (recentHeader?.contains(button) && /更多|more|选项|options/i.test(visibleLabel))
        )
      ) {
        pendingRecentMenuUntil = Date.now() + 3000;
        recentMenuAugmented = false;
        window.setTimeout(augmentNativeRecentMenu, 30);
        window.setTimeout(augmentNativeRecentMenu, 120);
      }
      if (!button || !/对话选项|conversation options/i.test(label)) return;
      const anchor = button.closest('a[href]');
      const info = chatInfoFromHref(anchor?.getAttribute('href'));
      if (!info) return;
      pendingNativeMenuChatId = info.chatId;
      pendingNativeMenuAnchor = button;
      pendingNativeMenuUntil = Date.now() + 3000;
      nativeMenuAugmented = false;
      window.setTimeout(augmentNativeConversationMenu, 30);
      window.setTimeout(augmentNativeConversationMenu, 120);
    }, true);

    document.addEventListener('dragstart', (event) => {
      if (event.target.closest?.('button')) return;

      const folderRow = event.target.closest?.('.cgpt-folder-row[data-folder-id]');
      if (folderRow) {
        folderRow.classList.add('cgpt-dragging');
        setDragPayload(event, {
          kind: 'folder',
          nodeId: folderRow.dataset.folderId,
          source: 'tree',
        });
        return;
      }

      const fallback = event.target.closest?.('.cgpt-fallback-chat[data-cgpt-tree-node-id]');
      if (fallback) {
        const node = findNode(fallback.dataset.cgptTreeNodeId)?.node;
        if (!node || node.type !== 'chat') return;
        fallback.classList.add('cgpt-dragging');
        setDragPayload(event, {
          kind: 'chat',
          nodeId: node.id,
          chatId: node.chatId,
          source: 'tree',
        });
        return;
      }

      const ungrouped = event.target.closest?.('[data-cgpt-ungrouped-chat]');
      if (ungrouped) {
        const chatId = ungrouped.dataset.cgptUngroupedChat;
        ungrouped.classList.add('cgpt-dragging');
        setDragPayload(event, {
          kind: 'chat',
          chatId,
          source: 'ungrouped',
        });
        return;
      }

      const row = event.target.closest?.('li[data-cgpt-chat-id]');
      if (!row) return;
      const chatId = row.dataset.cgptChatId;
      const existing = findChatNode(chatId);
      row.classList.add('cgpt-dragging');
      setDragPayload(event, {
        kind: 'chat',
        nodeId: existing?.id,
        chatId,
        source: existing ? 'tree' : 'native',
      });
    }, true);

    document.addEventListener('dragover', (event) => {
      const payload = payloadFromEvent(event);
      if (!payload) return;
      clearDropIndicators();

      const treeTarget = treeDropTarget(event);
      if (treeTarget) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (treeTarget.kind === 'before') treeTarget.element.classList.add('cgpt-drop-before');
        else if (treeTarget.kind === 'folder') {
          treeTarget.element.classList.add(
            treeTarget.area ? 'cgpt-drop-folder-range' : 'cgpt-drop-folder'
          );
        }
        else host.classList.add('cgpt-drop-root');
        return;
      }

      if (isNativeRecentDropArea(event.target)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        recentHeader?.classList.add('cgpt-recent-drop');
      }
    }, true);

    document.addEventListener('drop', (event) => {
      const payload = payloadFromEvent(event);
      if (!payload) return;
      const treeTarget = treeDropTarget(event);
      clearDropIndicators();

      if (treeTarget) {
        event.preventDefault();
        movePayload(payload, treeTarget);
      } else if (isNativeRecentDropArea(event.target)) {
        event.preventDefault();
        movePayload(payload, payload.kind === 'chat'
          ? { kind: 'unclassified' }
          : { kind: 'root' });
      }
      activeDrag = null;
    }, true);

    document.addEventListener('dragend', () => {
      activeDrag = null;
      clearDropIndicators();
      document.querySelectorAll('.cgpt-dragging')
        .forEach((element) => element.classList.remove('cgpt-dragging'));
    }, true);

    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY) return;
      state = loadState();
      queueRender();
    });
  }

  function installImageDownloadDebugApi() {
    try {
      unsafeWindow.CGPTImageDownloadDebug = {
        scan() {
          return [...document.querySelectorAll(`.${IMAGE_DOWNLOAD_CLASS}`)].map((button, index) => {
            const container = button.__cgptImageDownloadContainer
              || button.closest('[data-cgpt-image-download-container]');
            const images = container ? [
              ...contentImageElements(container),
              ...broadImageElements(container, 24),
            ] : [];
            const rect = button.getBoundingClientRect();
            return {
              index,
              title: button.title,
              text: compactTitle(button.textContent || ''),
              disabled: button.disabled,
              count: button.dataset.cgptImageCount || '',
              exactCount: button.dataset.cgptExactCount || '',
              uniqueUrls: uniqueImageUrls(images),
              rect: {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
              },
              lastStep: unsafeWindow.__cgptImageDownloadLastStep || null,
            };
          });
        },
        click(index = 0) {
          const button = document.querySelectorAll(`.${IMAGE_DOWNLOAD_CLASS}`)[index];
          if (!button) return false;
          triggerImageDownloadButton(button);
          return true;
        },
        lastStep() {
          return unsafeWindow.__cgptImageDownloadLastStep || null;
        },
        async manualAction(action = 'download') {
          refreshImageDownloadButtons();
          await new Promise((resolve) => window.setTimeout(resolve, 120));
          if (action === 'download-complete-latest') {
            const candidates = [...document.querySelectorAll('[data-turn="assistant"]')]
              .map((turn) => [...new Set([...turn.querySelectorAll('img')]
                .map((image) => String(image.currentSrc || image.src || ''))
                .filter((url) => url.includes('backend-api/estuary/content')))])
              .filter((urls) => urls.length);
            const urls = candidates.at(-1) || [];
            if (!urls.length) return { ok: false, error: '当前页面没有检测到可恢复的完整图片批次' };
            const downloader = globalThis.TeambuildingGptProductionDownload;
            if (typeof downloader !== 'function') return { ok: false, error: '工作台认证下载桥尚未加载' };
            const now = new Date();
            const date = now.toISOString().slice(0, 10).replace(/-/g, '');
            const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
            const random = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
            const batchId = `${date}-${time}-${random}`;
            const files = [];
            for (let index = 0; index < urls.length; index += 1) {
              files.push(await downloader({
                url: urls[index],
                filename: `chatgpt-workpkg-${batchId}-${index + 1}-of-${urls.length}.png`,
                requestId: `manual-repair-${batchId}-${index}`
              }));
            }
            return { ok: true, action, count: urls.length, batchId, files };
          }
          const imageButtons = [...document.querySelectorAll(`.${IMAGE_DOWNLOAD_CLASS}`)]
            .filter((button) => button.isConnected && !button.disabled);
          const imageButton = imageButtons.at(-1) || null;
          const packageButton = imageButton?.closest(`.${IMAGE_DOWNLOAD_SLOT_CLASS}`)
            ?.querySelector(`.${WORK_PACKAGE_CLASS}`) || null;
          const textButtons = [...document.querySelectorAll(`.${TEXT_DOWNLOAD_CLASS}`)]
            .filter((button) => button.isConnected && !button.disabled);
          const textButton = textButtons.at(-1) || null;
          if (action === 'download') {
            if (!imageButton) return { ok: false, error: '当前页面没有检测到可下载的生成图片' };
            triggerImageDownloadButton(imageButton);
            return { ok: true, action, count: Number(imageButton.dataset.cgptImageTotal || 0) };
          }
          if (action === 'package') {
            if (!packageButton) return { ok: false, error: '当前页面没有检测到可打包的生成图片组' };
            await triggerWorkPackageButton(packageButton);
            return { ok: true, action };
          }
          if (action === 'copy-text') {
            const card = textButton?.__cgptTextDownloadCard
              || textCardForCopyButton(textButton?.closest?.(`.${TEXT_DOWNLOAD_SLOT_CLASS}`)?.previousElementSibling);
            const text = textContentForDownload(card);
            if (!text) return { ok: false, error: '当前页面没有检测到可复制的成品文案' };
            await navigator.clipboard.writeText(text);
            showImageDownloadToast('文案已复制', true);
            return { ok: true, action, characters: text.length };
          }
          if (action === 'download-text') {
            if (!textButton) return { ok: false, error: '当前页面没有检测到可下载的成品文案' };
            triggerTextDownloadButton(textButton);
            return { ok: true, action };
          }
          return { ok: false, error: `未知手动操作：${action}` };
        },
      };
    } catch (error) {
      console.warn('[ChatGPT 图片下载快捷按钮] 安装调试入口失败：', error);
    }
  }

  document.addEventListener('tb-workbench-manual-action', async () => {
    let request = null;
    try {
      request = JSON.parse(document.getElementById('tb-workbench-manual-action-request')?.textContent || 'null');
    } catch {
      request = null;
    }
    if (!request?.requestId) return;
    let result;
    try {
      result = await unsafeWindow.CGPTImageDownloadDebug?.manualAction(request.action);
      if (!result) result = { ok: false, error: '网页下载工具尚未加载' };
    } catch (error) {
      result = { ok: false, error: error?.message || String(error) };
    }
    let bridge = document.getElementById('tb-workbench-manual-action-result');
    if (!bridge) {
      bridge = document.createElement('script');
      bridge.id = 'tb-workbench-manual-action-result';
      bridge.type = 'application/json';
      document.documentElement.appendChild(bridge);
    }
    bridge.textContent = JSON.stringify({ requestId: request.requestId, ...result });
    document.dispatchEvent(new Event('tb-workbench-manual-action-result'));
  });

  const observer = new MutationObserver((mutations) => {
    if (document.hidden) return;
    if (pendingNativeMenuChatId) augmentNativeConversationMenu();
    if (Date.now() <= pendingRecentMenuUntil) augmentNativeRecentMenu();
    if (rendering || Date.now() < ignoreMutationsUntil) return;

    let scanHistory = false;
    let scanImages = false;
    let scanComposer = false;
    for (const mutation of mutations) {
      const target = mutation.target.nodeType === 1
        ? mutation.target
        : mutation.target.parentElement;
      if (!target || target.closest?.(`#${APP_ID}, #${HEADER_ID}, #${MENU_ID}, #${PROMPT_PANEL_ID}, #${PROMPT_BUTTON_ID}, .${IMAGE_DOWNLOAD_SLOT_CLASS}, .${TEXT_DOWNLOAD_SLOT_CLASS}`)) {
        continue;
      }

      const rootReplacement = target === document.documentElement
        || target === document.body
        || [...mutation.addedNodes].some((node) => (
          node.nodeType === 1
          && (node.matches?.('main, nav, aside, #history') || node.querySelector?.('main, nav, aside, #history'))
        ));
      const touchesHistory = rootReplacement
        || target.closest?.('nav, aside, #history')
        || historyRoot?.contains?.(target)
        || target.contains?.(historyRoot);
      const touchesMain = rootReplacement || target.closest?.('main');
      const touchesComposer = touchesMain || target.closest?.('form, [data-testid*="composer"]');

      scanHistory ||= Boolean(touchesHistory);
      scanImages ||= Boolean(touchesMain);
      scanComposer ||= Boolean(touchesComposer);
      if (scanHistory && scanImages && scanComposer) break;
    }

    if (scanHistory) scheduleScan();
    if (scanImages) scheduleImageDownloadButtons();
    if (scanComposer) schedulePromptButton();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Historical image controls are hydrated lazily as the user scrolls near
  // them instead of scanning an entire long conversation during startup.
  document.addEventListener('scroll', () => scheduleImageDownloadButtons(), { passive: true, capture: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    scheduleScan();
    scheduleImageDownloadButtons();
    schedulePromptButton(80);
  });
  document.addEventListener('tb-gpt-image-download-complete', (event) => {
    markImageGroupDownloadedByUrls(event?.detail || {});
    scheduleImageDownloadButtons(40);
  });
  let previousUrl = location.href;
  window.setInterval(() => {
    if (document.hidden) return;
    if (location.href !== previousUrl) {
      previousUrl = location.href;
      updateFallbackChatVisualState();
      scheduleScan();
      scheduleImageDownloadButtons();
      schedulePromptButton(80);
    }
  }, 850);
  window.setInterval(() => {
    if (document.hidden) return;
    syncLegacyChanges();
    schedulePromptButton(400);
  }, 6000);

  if (!localStorage.getItem(STORAGE_KEY)) saveState(true);
  installConversationTreeDebugApi();
  registerUserscriptMenuCommands();
  refreshWorkPackageAccountName();
  installWorkPackageClipboardBridge();
  bindImageDownloadEvents();
  installImageDownloadDebugApi();
  addDiagnosticLog('script:init');
  // Prompt and download tools must keep their own styles even when ChatGPT hides
  // or virtualizes the recent-conversation list.  The old userscript mounted
  // styles only after finding that list, which left the prompt panel appended
  // as an unstyled block at the bottom of the page.
  injectStyles();
  window.addEventListener('tb-workbench-tools-visibility', () => {
    ensurePromptButton();
    scheduleImageDownloadButtons();
  });
  scanNativeChats();
  ensurePromptButton();
  scheduleCloudPromptSync();
  scheduleImageDownloadButtons();
})();
