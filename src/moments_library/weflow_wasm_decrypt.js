"use strict";

// Uses the exact WxIsaac64 implementation shipped with the local WeFlow
// installation. Keys are received over stdin and are never written to disk.

const fs = require("fs");
const vm = require("vm");
const crypto = require("crypto");

function imageKind(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).equals(buffer.subarray(0, 8))) return "png";
  if (buffer.length >= 6 && /^GIF8/.test(buffer.subarray(0, 6).toString("ascii"))) return "gif";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return "";
}

function isReadableImage(buffer) {
  const kind = imageKind(buffer);
  if (kind === "jpeg") return buffer.lastIndexOf(Buffer.from([0xff, 0xd9])) >= 0;
  if (kind === "png") return buffer.length >= 20
    && Buffer.from([73, 69, 78, 68, 174, 66, 96, 130]).equals(buffer.subarray(-8));
  if (kind === "gif") return buffer.length >= 7 && buffer[buffer.length - 1] === 0x3b;
  return kind === "webp";
}

function decrypt(encrypted, key, moduleObject, capture, streamLength) {
  const generator = new moduleObject.WxIsaac64(String(key));
  capture.value = null;
  // WeFlow's getKeystream() always asks ISAAC for a whole number of
  // 64-bit words, then reverses and truncates the result to the payload
  // length.  Generating the exact non-aligned length changes the stream for
  // many SNS payloads and can produce JPEG-looking but invalid bytes.
  const requestedLength = streamLength || encrypted.length;
  const alignedLength = Math.ceil(requestedLength / 8) * 8;
  generator.generate(alignedLength);
  // Mirror WeFlow's own getRawKeystream lifecycle before copying the
  // captured bytes out of the WASM-backed view.
  if (typeof generator.delete === "function") generator.delete();
  const raw = Buffer.from(capture.value);
  // This is the same reversal performed by WeFlow's getKeystream().
  raw.reverse();
  const plain = Buffer.allocUnsafe(encrypted.length);
  for (let index = 0; index < encrypted.length; index += 1) plain[index] = encrypted[index] ^ raw[index];
  return plain;
}

async function main() {
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  const wasmDir = process.argv[2];
  if (!wasmDir) throw new Error("missing wasm directory");
  const allowMagicOnly = process.env.WEFLOW_ALLOW_MAGIC_ONLY === "1";
  const wasmBinary = fs.readFileSync(`${wasmDir}/wasm_video_decode.wasm`);
  const wasmSource = fs.readFileSync(`${wasmDir}/wasm_video_decode.js`, "utf8");
  const capture = { value: null };
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const sandbox = {
    console,
    Buffer,
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    Array,
    Object,
    Function,
    String,
    Number,
    Boolean,
    Error,
    Promise,
    require,
    process,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  sandbox.Module = {
    onRuntimeInitialized: resolveReady,
    wasmBinary,
    print: () => {},
    printErr: () => {},
  };
  sandbox.self = sandbox;
  sandbox.self.location = { href: "file:///weflow-image-wasm.js" };
  sandbox.WorkerGlobalScope = function WorkerGlobalScope() {};
  sandbox.VTS_WASM_URL = "file:///weflow-image-wasm.wasm";
  sandbox.wasm_isaac_generate = (pointer, length) => {
    // WeFlow copies the callback view immediately; keep the same semantics
    // so deleting the WASM generator cannot invalidate captured bytes.
    capture.value = new Uint8Array(new Uint8Array(sandbox.Module.HEAPU8.buffer, pointer, length));
  };
  const context = vm.createContext(sandbox);
  new vm.Script(wasmSource, { filename: "wasm_video_decode.js" }).runInContext(context);
  await Promise.race([
    ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error("WASM 初始化超时")), 30000)),
  ]);

  const results = [];
  for (const item of input.items || []) {
    fs.rmSync(item.output, { force: true });
    const encrypted = fs.readFileSync(item.input);
    let plain = decrypt(encrypted, item.key, sandbox.Module, capture, item.streamLength);
    const format = imageKind(plain);
    // Some SNS responses append a fixed trailer after a complete JPEG. Keep
    // the actual image payload and drop that transport trailer before saving.
    if (format === "jpeg") {
      const end = plain.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (end >= 0 && end + 2 < plain.length) plain = plain.subarray(0, end + 2);
    }
    const readable = allowMagicOnly ? Boolean(format) : isReadableImage(plain);
    if (!readable) {
      results.push({ input: item.input, ok: false, magic: Boolean(format), format, error: "解密后未通过完整性校验" });
      continue;
    }
    fs.writeFileSync(item.output, plain);
    results.push({
      input: item.input,
      output: item.output,
      ok: true,
      bytes: plain.length,
      sha256: crypto.createHash("sha256").update(plain).digest("hex"),
    });
  }
  process.stdout.write(JSON.stringify({ ok: true, results }));
}

main()
  // The WeFlow Emscripten runtime may leave an internal timer alive after
  // the requested batch has completed. This helper is a one-shot subprocess;
  // exit explicitly after emitting the JSON result so the Python collector
  // can commit the completed post and continue/resume safely.
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
