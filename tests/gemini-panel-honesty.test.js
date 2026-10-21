const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync(require.resolve('../src/public/index.html'), 'utf8');
const start = html.indexOf('<div class="prod-line-panel" id="geminiProductionPanel"');
const end = html.indexOf('<!-- 本地模式 · Codex 客户端制作请求登记台 -->', start);
const panel = html.slice(start, end !== -1 ? end : undefined);

test('Gemini panel states that production is decommissioned and disabled', () => {
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(panel, /Gemini 团建生产已停用/);
  assert.match(panel, /这是按你的要求停用的生产线/);
  assert.match(panel, /不会接收新素材、创建请求、领取旧请求或继续生成/);
  assert.match(panel, /旧请求和旧作品保留为只读记录/);
});

test('Gemini panel does not claim live quota, accounts, Feishu sync, or online status', () => {
  for (const staleClaim of [
    '实时大盘', '6 大 Chrome Pro 账号', '290,304 点',
    '已接入 (双向同频)', '127.0.0.1:8820', '127.0.0.1:8792'
  ]) {
    assert.equal(panel.includes(staleClaim), false, `stale claim remains: ${staleClaim}`);
  }
});
