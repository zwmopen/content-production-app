const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync(require.resolve('../src/public/index.html'), 'utf8');
const start = html.indexOf('<div class="prod-line-panel" id="geminiProductionPanel"');
const end = html.indexOf('<!-- 产线 3 · Codex API 制作请求登记台 -->', start);
const panel = html.slice(start, end);

test('Gemini panel states that unified request and execution are not connected', () => {
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(panel, /当前未接入统一生产请求与执行链/);
  assert.match(panel, /不能向 Gemini 派发任务/);
  assert.match(panel, /没有收到真实生图结果或完成回执/);
});

test('Gemini panel does not claim live quota, accounts, Feishu sync, or online status', () => {
  assert.match(panel, /数量与额度未核实/);
  assert.match(panel, /无实时探针；当前不能确认在线/);
  assert.match(panel, /未接入本产线闭环验证/);
  for (const staleClaim of [
    '实时大盘', '6 大 Chrome Pro 账号', '290,304 点',
    '已接入 (双向同频)', '127.0.0.1:8820', '127.0.0.1:8792'
  ]) {
    assert.equal(panel.includes(staleClaim), false, `stale claim remains: ${staleClaim}`);
  }
});
