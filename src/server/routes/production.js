/**
 * 工作台助手路由。
 *
 * 旧 API 生图链（/api/production、/api/image-api、/api/text-api）已在
 * 0.16.10 正式退役。真实内容生产统一走持久 GPT 网页与本地归档链。
 */
async function handle(req, res, pathname, parsed, ctx) {
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
