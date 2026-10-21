(function exposeFixedTemplateSession(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TBFixedTemplateSession = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFixedTemplateSession() {
  "use strict";

  // Read-only projection. Configuration is never treated as a model receipt.
  function text(value) { return String(value || "").trim(); }
  function conversationUrl(value) {
    try {
      const url = new URL(text(value));
      if (url.protocol !== "https:" || url.hostname !== "chatgpt.com") return "";
      if (!/^\/c\/[a-zA-Z0-9-]+\/?$/.test(url.pathname)) return "";
      return `https://chatgpt.com${url.pathname.replace(/\/$/, "")}`;
    } catch (_) { return ""; }
  }
  function templateReferenceReady(template) {
    const references = Array.isArray(template.references) ? template.references : [];
    return references.length > 0 && references.every((item) =>
      text(item.path) && /^[a-f0-9]{64}$/i.test(text(item.sha256)) && item.physicalVerified === true);
  }
  function referenceAssets(template = {}) {
    const rows = Array.isArray(template.images) ? template.images
      : Array.isArray(template.references) ? template.references : [];
    return rows.map((item, index) => ({
      name: text(item?.name || item?.fileName || item?.label || item?.path) || `母版图 ${index + 1}`,
      path: text(item?.path || item?.filePath || item?.originalPath),
      page: Number(item?.page || item?.pageNumber || 0)
    })).filter((item) => item.path);
  }
  function templatePageReferences(template = {}) {
    const assets = referenceAssets(template);
    const pageOf = (asset) => {
      if (asset.page === 1 || /(?:^|[^a-z0-9])p1(?:[^0-9]|$)|封面/i.test(asset.name)) return 1;
      if (asset.page === 2 || /(?:^|[^a-z0-9])p2(?:[^0-9]|$)|内页/i.test(asset.name)) return 2;
      return 0;
    };
    const p1 = assets.find((asset) => pageOf(asset) === 1) || assets[0] || null;
    const p2 = assets.find((asset) => pageOf(asset) === 2 && asset !== p1)
      || assets.find((asset) => asset !== p1) || null;
    return p1 && p2 ? [p1, p2] : [];
  }
  function buildTemplateSetupPrompt(input = {}) {
    const template = input.template || {};
    const templateId = text(template.id || template.templateId);
    const templateName = text(template.name || template.title) || templateId;
    const refs = templatePageReferences(template);
    if (!templateId || !refs.length) return {
      ready: false,
      status: "请选择一个含真实 P1 封面和 P2 内页文件的母版。",
      text: "请先在内容制作中选择一个含真实 P1/P2 图片的母版。"
    };
    return {
      ready: true,
      status: "把下列 P1、P2 原图作为附件，和这段指令一起发到新建的 Codex 对话。",
      text: [
        `这是本对话的固定模板初始化。母版：${templateName}（${templateId}）。`,
        "请先完整查看本消息附带的两张真实模板图：P1 是封面，P2 是内页。它们只作为后续这条对话内的版式参照，不是要复刻其原有主题内容。",
        `请在本消息附上这两张原图：\n- P1 封面：${refs[0].path}\n- P2 内页：${refs[1].path}`,
        "请提炼并在当前对话可见上下文中遵循其画布比例、拼图格数与位置、构图、配色、字体层级、文字描边、留白、标签和图片质感。原封面有字就保留相同层级的标题设计，不可无故变成无字封面；拼图格数可随素材灵活调整，但结构气质要一致。",
        "收到后只回复你已读取 P1/P2 的设计规则及仍看不清的部分；此步骤不要生成作品，不要声称训练了永久模型记忆。接下来我会在同一对话中一次发送一个完整素材文件夹，每个有效源图对应一张成品，完成一套后再等下一套。若换了新对话或你看不到本对话中的模板附件，先要求我重新附上 P1/P2。",
        "不要把不同文件夹混成一套，不要编造原素材没有支持的地点、价格、人数、时长或服务，不要加水印、二维码或账号名。"
      ].join("\n\n"),
      referencePages: refs
    };
  }
  function buildMaterialPrompt(input = {}) {
    const template = input.template || {};
    const sourcePath = text(input.sourcePath);
    const templateId = text(template.id || template.templateId);
    const templateName = text(template.name || template.title) || templateId;
    const sourceFiles = (Array.isArray(input.sourceFiles) ? input.sourceFiles : [])
      .map((item) => text(typeof item === "string" ? item : item?.name || item?.fileName || item?.path))
      .filter(Boolean);
    if (!sourcePath || !templateId || !templatePageReferences(template).length) return {
      ready: false,
      status: "需要且只需要一个完整素材文件夹和一个真实 P1/P2 母版。",
      text: "请先选择一个完整素材文件夹和一个含真实 P1/P2 图片的母版。"
    };
    return {
      ready: true,
      status: "本指令只对应当前选中的一个完整素材文件夹；请把其中全部源图作为附件发送。",
      text: [
        `请只制作这一套完整作品。素材文件夹：${sourcePath}`,
        `固定母版：${templateName}（${templateId}）；沿用本对话已附的真实 P1/P2 参照。`,
        sourceFiles.length ? `工作台目录索引到的文件名（不是附件回执，请确认实际收到完整源图）：\n${sourceFiles.map((name) => `- ${name}`).join("\n")}` : "请读取我随消息附带的该文件夹全部源图和文案；仅凭路径不可读取本地文件。",
        "本文件夹就是一个作品，禁止混入其他文件夹或把它拆成多套。先确认实际收到的文件清单，再按原顺序处理：每个有效源图对应一张成品；P1 封面依母版原有标题与拼图版式处理（母版原本有字时封面不能漏字），其余页面迁移 P2 内页结构。拼图格数按素材灵活适配，不要为了固定九宫格造图。",
        "交付目标为完整高清图组和 11 版本双协议文案，并完成逐页事实、版式、比例、白缝、重复及水印检查；成品不得带水印、二维码或账号名。不得编造场地、价格、人数、路线、时长、套餐或原文没有的信息。",
        "只有在文件实际落盘、检查通过且有回读凭证时，才可说已保存或已入库；若当前 Codex 对话没有本地文件访问能力，请明确给出可下载结果并说明本地封装仍待做。完成后停在本套闭环状态，等我发送下一个完整素材文件夹。"
      ].join("\n\n"),
      sourceFiles
    };
  }
  function project(input = {}) {
    const profile = input.profile || {};
    const template = input.template || {};
    const receipt = input.bindingReceipt || {};
    const pipeline = text(input.pipeline).toLowerCase();
    const codex = ["codex", "codex-api", "codex-native"].includes(pipeline);
    const cdp = ["cdp", "cdp-a", "cdp-b", "gpt-web"].includes(pipeline);
    const templateId = text(template.id || template.templateId || profile.selectedTemplateId);
    const accountId = text(profile.accountId || profile.id);
    const sourcePath = text(input.sourcePath);
    const referencesReady = templateReferenceReady(template);
    const url = conversationUrl(profile.templateConversationUrl);
    const fresh = profile.workflowVariant === "fresh-session-fixed-template";
    const result = {
      pipeline, accountId, templateId, templateName: text(template.name), sourcePath,
      conversationUrl: codex ? "" : url,
      canInitializeConversation: cdp,
      bindingStatus: "UNSUPPORTED", bindingLabel: "当前产线尚未接入固定母版流程",
      workflow: "unsupported", readyForMaterial: false, reasons: [], steps: []
    };
    if (codex) {
      result.workflow = "native-reference-per-call";
      result.bindingStatus = referencesReady && templateId ? "REFERENCES_VERIFIED" : "REFERENCES_PENDING";
      result.bindingLabel = referencesReady && templateId ? "母版参照已核实" : "母版参照待核实";
      result.reasons = referencesReady && templateId ? [] : ["需要母版实物及 SHA 校验"];
      result.steps = ["核实母版实物", "逐套读取完整素材", "每次生图携带母版参照", "逐页质检并完成整套交付"];
      result.explanation = "Codex 原生生图逐次传入母版参照；当前未接入可初始化和复用的网页会话。";
    } else if (cdp && fresh) {
      result.workflow = "fresh-session-fixed-template";
      result.bindingStatus = referencesReady && templateId ? "REFERENCES_VERIFIED" : "REFERENCES_PENDING";
      result.bindingLabel = referencesReady && templateId ? "固定母版已核实，每套新对话" : "固定母版待核实";
      result.reasons = referencesReady && templateId ? [] : ["需要选择并核实真实母版，空附件母版不能算就绪"];
      result.steps = ["核实固定母版", "每套新建网页对话并发送母版", "发送本套完整素材", "质检、封装、入库后进入下一套"];
      result.explanation = "每套新对话都重新发送相同母版，不继承上一套对话上下文。";
    } else if (cdp) {
      result.workflow = "reuse-conversation";
      const matches = Boolean(url && accountId && templateId
        && conversationUrl(receipt.conversationUrl) === url
        && text(receipt.accountId) === accountId
        && text(receipt.templateId) === templateId
        && receipt.status === "READY"
        && receipt.physicalVerified === true
        && text(receipt.receiptPath)
        && /^[a-f0-9]{64}$/i.test(text(receipt.receiptSha256)));
      result.bindingStatus = matches ? "CONVERSATION_VERIFIED" : url ? "CONFIGURED_UNVERIFIED" : "UNBOUND";
      result.bindingLabel = matches ? "母版会话已核实" : url ? "已配置母版会话，待核实" : "未绑定母版会话";
      result.reasons = matches ? [] : [url ? "需要当前账号、母版和会话一致的初始化回执" : "需要绑定本账号的母版会话"];
      result.steps = ["绑定账号与母版", "发送母版并保存学习回执", "在同一会话逐套发送完整素材", "质检、封装、入库后进入下一套"];
      result.explanation = "先在网页会话初始化母版；后续只发送本套素材，保留会话与账号绑定。";
    }
    result.readyForMaterial = result.bindingStatus === "CONVERSATION_VERIFIED"
      || result.bindingStatus === "REFERENCES_VERIFIED";
    if (!sourcePath) result.reasons.push("尚未选择完整素材文件夹");
    // Readiness is a projection only, never permission to send or generate.
    result.canSubmitSelectedMaterial = result.readyForMaterial && Boolean(sourcePath);
    return result;
  }
  return { project, conversationUrl, referenceAssets, templatePageReferences, buildTemplateSetupPrompt, buildMaterialPrompt };
});
