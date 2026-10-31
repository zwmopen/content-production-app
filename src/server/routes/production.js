/**
 * 工作台助手路由。
 *
 * 旧 API 生图链（/api/production、/api/image-api、/api/text-api）已在
 * 0.16.10 正式退役。真实内容生产统一走持久 GPT 网页与本地归档链。
 * /api/production/requests 仅准备和回读隔离的真实制作请求，不复活旧生图 API。
 */
const fs = require("fs");
const path = require("path");
const productionRequest = require("./production-request");
const productionPlan = require("./production-plan");
const productionActions = require("./production-actions");
const templateBindingStatus = require("./template-binding-status");
const templateSyncPlan = require("./template-sync-plan");
const templateSyncState = require("./template-sync-state");
const { publicVisionProviderStatus } = require("../../lib/production-vision-provider");
const { loadPrompts, sendPromptToChatGpt, getLatestConversationState, getChatGptTabs } = require("../../lib/production-prompt-service");

async function handle(req, res, pathname, parsed, ctx) {
  if (pathname === "/api/production/prompts" && req.method === "GET") {
    ctx.sendJson(res, { ok: true, prompts: loadPrompts() });
    return true;
  }

  if (pathname === "/api/production/tabs" && req.method === "GET") {
    const tabs = await getChatGptTabs();
    ctx.sendJson(res, { ok: true, tabs });
    return true;
  }

  if (pathname === "/api/production/step/execute" && req.method === "POST") {
    const body = JSON.parse(await ctx.getBody(req, 500000) || "{}");
    const result = await sendPromptToChatGpt(body);
    ctx.sendJson(res, result);
    return true;
  }

  if (pathname === "/api/production/step/status" && req.method === "GET") {
    const targetId = parsed?.query?.targetId;
    const result = await getLatestConversationState({ targetId });
    ctx.sendJson(res, result);
    return true;
  }

  if (pathname === "/api/production/vision/providers" && req.method === "GET") {
    const secretFile = process.env.CONTENT_PRODUCTION_VISION_SECRET_FILE || "D:\\AICode\\运行数据\\江湖有旅人\\团建工作台\\secrets\\image-api.local.env";
    ctx.sendJson(res, { ok: true, status: publicVisionProviderStatus({ secretFile }) });
    return true;
  }

  if (await templateSyncPlan.handle(req, res, pathname, parsed, ctx)) return true;
  if (await templateSyncState.handle(req, res, pathname, parsed, ctx)) return true;
  if (await templateBindingStatus.handle(req, res, pathname, parsed, ctx)) return true;
  if (await productionActions.handle(req, res, pathname, parsed, ctx)) return true;
  if (await productionPlan.handle(req, res, pathname, parsed, ctx)) return true;
  if (await productionRequest.handle(req, res, pathname, parsed, ctx)) return true;
  if (pathname !== "/api/workbench-assistant/interpret" || req.method !== "POST") return false;

  const { send, sendJson, getBody, interpretWorkbenchAssistantCommand } = ctx;
  const body = JSON.parse(await getBody(req, 16_000) || "{}");
  try {
    return sendJson(res, {
      ok: true,
      interpretation: await interpretWorkbenchAssistantCommand(body.command)
    });
  } catch (error) {
    return send(res, 503, JSON.stringify({
      error: "智能理解暂时不可用",
      detail: String(error?.message || error).slice(0, 300)
    }));
  }
}

module.exports = { handle };
