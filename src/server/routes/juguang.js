"use strict";

const { getJuguangSnapshot, queryKeywords } = require("../../lib/juguang-data");

/**
 * 聚光数据路由
 * 匹配 /api/juguang 和 /api/juguang/keywords
 * @returns {Promise<boolean>} true 表示已匹配并处理
 */
async function handle(req, res, pathname, parsed, ctx) {
  const { sendJson, PROJECT_ROOT } = ctx;

  if (pathname === "/api/juguang") {
    sendJson(res, getJuguangSnapshot(PROJECT_ROOT));
    return true;
  }

  if (pathname === "/api/juguang/keywords") {
    sendJson(res, queryKeywords({ text: parsed.query.q || "", limit: parsed.query.limit || 20 }, PROJECT_ROOT));
    return true;
  }

  return false;
}

module.exports = { handle };
