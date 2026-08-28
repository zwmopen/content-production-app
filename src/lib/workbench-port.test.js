const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyWorkbenchPortProbe,
  formatPortInUseMessage
} = require("./workbench-port");

test("HTTP 200 on the workbench port means the local workbench is ready", () => {
  assert.equal(classifyWorkbenchPortProbe({ statusCode: 200 }), "ready");
});

test("non-200 HTTP response means the port is occupied by another service", () => {
  assert.equal(classifyWorkbenchPortProbe({ statusCode: 404 }), "occupied");
});

test("connection refused means the workbench port is free to start", () => {
  assert.equal(classifyWorkbenchPortProbe({ errorCode: "ECONNREFUSED" }), "free");
});

test("port conflict message is explicit and includes the port number", () => {
  assert.match(formatPortInUseMessage(4327), /4327/);
  assert.match(formatPortInUseMessage(4327), /占用/);
});
