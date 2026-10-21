"use strict";

const net = require("node:net");

function isPortListening(port, { host = "127.0.0.1", timeoutMs = 350 } = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (listening) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };

    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function findListeningPort(ports, options) {
  for (const port of ports) {
    if (await isPortListening(Number(port), options)) return Number(port);
  }
  return null;
}

module.exports = { findListeningPort, isPortListening };
