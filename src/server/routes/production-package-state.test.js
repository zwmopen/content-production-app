const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { lifecycleSnapshot } = require('./production-request');
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function evidence(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'package-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'outputs')); fs.mkdirSync(path.join(root, 'package'));
  const native = path.join(root, 'outputs', 'P1.png'); fs.writeFileSync(native, 'native test bytes');
  const request = { requestId: 'a'.repeat(64), pipeline: 'codex-api', sourceCount: 1 };
  fs.writeFileSync(path.join(root, 'request.json'), JSON.stringify(request));
  const stat = fs.statSync(native);
  fs.writeFileSync(path.join(root, 'generation-receipt.json'), JSON.stringify({ ...request,
    outputs: [{ nativePath: native, nativeBytes: stat.size, nativeMtimeMs: stat.mtimeMs, nativeSha256: sha(native) }] }));
  const artifacts = ['manifest.json', 'copy.txt', 'qa.json'].map(name => {
    const file = path.join(root, 'package', name); fs.writeFileSync(file, name); return file;
  }).concat([path.join(root, 'request.json'), path.join(root, 'generation-receipt.json'), native])
    .map(file => ({ path: file, sha256: sha(file) }));
  fs.writeFileSync(path.join(root, 'package-receipt.json'), JSON.stringify({
    ...request, status: 'PACKAGE_VERIFIED_PENDING_DELIVERY', artifacts }));
  return { root, request, native };
}

test('verified local package remains pending external delivery', t => {
  const f = evidence(t), state = lifecycleSnapshot(f.root, f.request);
  assert.equal(state.status, 'PACKAGE_VERIFIED_PENDING_DELIVERY');
  assert.equal(state.lifecycle.qaState, 'PASS_REPORTED');
  assert.equal(state.lifecycle.deliveryState, 'NOT_REPORTED');
  assert.equal(state.lifecycle.generatedPages, 1); assert.equal(state.completed, false);
});
test('copy modified after verification invalidates package state', t => {
  const f = evidence(t); fs.writeFileSync(path.join(f.root, 'package', 'copy.txt'), 'modified');
  const state = lifecycleSnapshot(f.root, f.request);
  assert.equal(state.status, 'PACKAGE_CHANGED_AFTER_VERIFICATION');
  assert.equal(state.lifecycle.qaState, 'EVIDENCE_INVALID'); assert.equal(state.completed, false);
});
test('native hash is rechecked even when byte length and recorded timestamp match', t => {
  const f = evidence(t), file = path.join(f.root, 'generation-receipt.json');
  const receipt = JSON.parse(fs.readFileSync(file));
  fs.writeFileSync(f.native, Buffer.alloc(fs.statSync(f.native).size, 120));
  receipt.outputs[0].nativeMtimeMs = fs.statSync(f.native).mtimeMs;
  fs.writeFileSync(file, JSON.stringify(receipt));
  assert.equal(lifecycleSnapshot(f.root, f.request).status, 'OUTPUT_CHANGED_AFTER_RECEIPT');
});
