"use strict";

const assert = require("node:assert/strict");
const net = require("node:net");
const test = require("node:test");
const { findListeningPort, isPortListening } = require("./instance-daemon-guard");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("detects an active instance CDP port and skips later ports", async (t) => {
  const active = net.createServer();
  const port = await listen(active);
  t.after(() => new Promise((resolve) => active.close(resolve)));

  assert.equal(await findListeningPort([port, 1]), port);
  assert.equal(await isPortListening(port), true);
});

test("returns null when no designated instance port is listening", async () => {
  const probe = net.createServer();
  const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));

  assert.equal(await findListeningPort([port]), null);
  assert.equal(await isPortListening(port), false);
});
