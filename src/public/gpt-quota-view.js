(function attachGptQuotaView(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TBGptQuotaView = api;
})(typeof globalThis === "undefined" ? this : globalThis, function createGptQuotaViewApi() {
  "use strict";

  function finiteCount(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
  }

  function createQuotaViewModel(snapshot, accountName = "当前账号窗口", fallbackSettings = {}, now = Date.now()) {
    const quota = snapshot && typeof snapshot === "object" ? snapshot : null;
    const settings = quota?.settings && typeof quota.settings === "object"
      ? quota.settings
      : fallbackSettings;
    const uploadLimit = finiteCount(settings.uploadLimit);
    const generationLimit = finiteCount(settings.generationLimit);
    const windowHours = finiteCount(settings.windowHours);
    const uploaded = finiteCount(quota?.uploaded);
    const generated = finiteCount(quota?.generated);
    const hasUploadData = uploaded !== null && uploadLimit !== null;
    const hasGenerationData = generated !== null && generationLimit !== null;
    const remainingUploads = hasUploadData ? Math.max(0, uploadLimit - uploaded) : null;
    const remainingGenerations = hasGenerationData ? Math.max(0, generationLimit - generated) : null;
    const disabled = settings.enabled === false;
    const blocked = !disabled && ((hasUploadData && remainingUploads === 0)
      || (hasGenerationData && remainingGenerations === 0));
    const near = !disabled && !blocked && (
      hasUploadData && uploadLimit > 0 && remainingUploads <= Math.max(1, Math.ceil(uploadLimit * 0.1))
      || hasGenerationData && generationLimit > 0 && remainingGenerations <= Math.max(1, Math.ceil(generationLimit * 0.1))
    );
    const state = disabled ? "disabled" : blocked ? "blocked" : near ? "near" : hasUploadData && hasGenerationData ? "tracked" : "unknown";
    const uploadLabel = hasUploadData
      ? `已记上传附件 ${uploaded}/${uploadLimit} · 本地账面余 ${remainingUploads}`
      : `上传附件：本地记录未同步${uploadLimit === null ? "" : ` / ${uploadLimit}（${windowHours || 3}小时）`}`;
    const generationLabel = hasGenerationData
      ? `已记生图 ${generated}/${generationLimit} · 本地账面余 ${remainingGenerations}`
      : `生图：本地记录未同步${generationLimit === null ? "" : ` / ${generationLimit}（${windowHours || 3}小时）`}`;
    const nextExpiry = Date.parse(String(quota?.nextExpiryAt || ""));
    const validExpiry = Number.isFinite(nextExpiry) && nextExpiry > Number(now);
    const nextExpiryLabel = validExpiry
      ? `本地最早释放：${new Date(nextExpiry).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`
      : "";
    const note = disabled
      ? "本地额度提醒已关闭；实际网页限流仍可能发生。"
      : blocked
        ? "已到本地安全线：只暂停当前 CDP 账号窗口；启用轮换模式后转到下一个可用 CDP 窗口。Gemini/Codex API 尚未接入可用额度计数。"
        : "本地滚动估算，仅统计工作台成功提交/识别的记录；修复前和网页内其他操作未补录。网页明确额度提示优先，普通网络 429 不单独判定额度耗尽。Gemini/Codex API 尚未接入可用额度计数。";

    return {
      state,
      accountName: String(accountName || "当前账号窗口"),
      title: `${String(accountName || "当前账号窗口")} · 频次安全监控（滚动 ${windowHours || 3} 小时）`,
      uploadLabel,
      generationLabel,
      note,
      nextExpiryLabel,
      remainingUploads,
      remainingGenerations,
      uploadLimit,
      generationLimit,
      windowHours: windowHours || 3
    };
  }

  function isExplicitQuotaLimitSignal(message = "") {
    const text = String(message || "").trim();
    if (!text || /(?:未|无法|不能)判定.{0,16}(?:额度|配额|触顶|上限|限制)|(?:不是|不属于).{0,12}(?:额度|配额|触顶|上限|限制)/i.test(text)) return false;
    // A bare 429, rate limit, timeout, or generic "too many requests" can be
    // network/service throttling. Only explicit account/usage/upload/generation
    // quota evidence should pause a CDP account window.
    const explicitQuota = /(?:额度|配额|用量上限|上传.{0,8}上限|生图.{0,8}上限|图片生成.{0,10}上限|(?:usage|upload|generation|image generation|individual)\s+(?:quota|limit)|quota\s+(?:reached|exhausted|limit)|resource_exhausted)/i;
    return explicitQuota.test(text)
      && /(?:达到|已达|超出|用尽|不足|上限|触顶|exhaust(?:ed)?|reached|limit|resource_exhausted)/i.test(text);
  }

  return { createQuotaViewModel, isExplicitQuotaLimitSignal };
});
