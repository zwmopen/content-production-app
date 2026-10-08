'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { allowedOrigin, findTarget, inputCommands, createPreviewServer } = require('./cdp-live-preview');

test('preview refuses unrelated browser origins and arbitrary debug ports', async () => {
  assert.equal(allowedOrigin('https://example.com'), false);
  assert.equal(allowedOrigin('null'), false);
  assert.equal(allowedOrigin('http://127.0.0.1:4332'), true);
  await assert.rejects(findTarget(9223), /端口无效/);
  assert.throws(() => inputCommands({ type: 'click', x: -1, y: 2 }), /坐标/);
  assert.throws(() => inputCommands({ type: 'prompt', text: 'submit' }), /坐标/);
});

test('native composer input never automatically appends submit', () => {
  assert.deepEqual(inputCommands({ type: 'text', text: '输入中文' }), [{ method: 'Input.insertText', params: { text: '输入中文' } }]);
  assert.equal(inputCommands({ type: 'key', key: 'Enter', shift: true })[0].params.modifiers, 8);
  assert.throws(() => inputCommands({ type: 'text', text: 'x'.repeat(4001) }), /文本/);
  assert.throws(() => inputCommands({ type: 'key', key: 'ExecuteScript' }), /按键/);
});

async function request(server, path, origin = 'http://127.0.0.1:4332') {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: server.address().port, path, headers: { Host: '127.0.0.1:9440', Origin: origin } }, res => {
      const chunks = []; res.on('data', b => chunks.push(b));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], data: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('frame returns an actual image response; disconnect is explicit, not a broken image', async () => {
  let requestedPort;
  const server = createPreviewServer({ getTarget: async port => { requestedPort = port; if (port === 9433) throw new Error('实例未启动'); return { title: 'page', url: 'https://chatgpt.com/' }; }, call: async () => ({ data: Buffer.from([255,216,255,217]).toString('base64') }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const frame = await request(server, '/frame?port=9432');
    assert.equal(frame.status, 200); assert.equal(frame.type, 'image/jpeg'); assert.equal(frame.data[0], 255); assert.equal(requestedPort, 9432);
    const missing = await request(server, '/frame?port=9433');
    assert.equal(missing.status, 503); assert.match(missing.data.toString(), /实例未启动/);
    assert.equal((await request(server, '/frame?port=9432', 'https://example.com')).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
