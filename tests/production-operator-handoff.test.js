const test = require('node:test');
const assert = require('node:assert/strict');
const { operatorPrompt } = require('../src/public/production-request');

test('handoff binds exact request and local workbench without claiming execution', () => {
  const id = 'a'.repeat(64);
  const prompt = operatorPrompt(id, 'http://127.0.0.1:4399');
  assert.ok(prompt.includes(`--request-id ${id}`));
  assert.ok(prompt.includes('--url http://127.0.0.1:4399'));
  assert.ok(prompt.includes('不转到旧队列'));
  assert.ok(prompt.includes('不能把生成回执当成作品完成'));
});

test('handoff rejects incomplete IDs and remote origins', () => {
  assert.throws(() => operatorPrompt('partial', 'http://localhost:4399'));
  for (const origin of ['https://example.com', 'http://localhost/api', 'http://user@localhost', 'http://localhost?x=1']) {
    assert.throws(() => operatorPrompt('a'.repeat(64), origin));
  }
});
