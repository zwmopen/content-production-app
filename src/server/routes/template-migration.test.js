"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { handle } = require("./template-migration");

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "template-migration-route-"));
  const materialRoot = path.join(root, "素材");
  const material = path.join(materialRoot, "杭州", "西溪");
  const template = path.join(root, "模板.png");
  fs.mkdirSync(material, { recursive: true });
  fs.writeFileSync(path.join(material, "P1.jpg"), "image");
  fs.writeFileSync(path.join(material, "文案.txt"), "西溪团建");
  fs.writeFileSync(template, "template");
  return { root, materialRoot, material, template, outputRoot: path.join(root, "成品") };
}

function ctxFor(root, body, response) {
  return {
    DATA_ROOT: path.join(root, "runtime"),
    getBody: async () => JSON.stringify(body || {}),
    writeJson: (filePath, value) => fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8"),
    sendJson: (_res, value) => { response.value = value; },
    send: (_res, status, payload) => { response.status = status; response.payload = JSON.parse(payload); }
  };
}

test("template migration route requires 1 before creating the current work folder", async () => {
  const fixture = makeFixture();
  const response = {};
  try {
    let ctx = ctxFor(fixture.root, {
      templatePath: fixture.template,
      materialRoot: fixture.materialRoot,
      outputRoot: fixture.outputRoot
    }, response);
    assert.equal(await handle({ method: "POST" }, {}, "/api/template-migration/session", {}, ctx), true);
    assert.equal(response.value.session.status, "ready");
    assert.equal(fs.existsSync(path.join(fixture.outputRoot, "_套板迁移")), true);
    assert.equal(fs.readdirSync(path.join(fixture.outputRoot, "_套板迁移")).length, 0);

    response.value = null;
    ctx = ctxFor(fixture.root, { confirmation: "no" }, response);
    assert.equal(await handle({ method: "POST" }, {}, "/api/template-migration/session/confirm", {}, ctx), true);
    assert.equal(response.status, 409);

    response.value = null;
    ctx = ctxFor(fixture.root, { confirmation: "1" }, response);
    assert.equal(await handle({ method: "POST" }, {}, "/api/template-migration/session/confirm", {}, ctx), true);
    assert.equal(response.value.session.status, "confirmed");
    assert.equal(fs.readdirSync(path.join(fixture.outputRoot, "_套板迁移")).length, 1);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
