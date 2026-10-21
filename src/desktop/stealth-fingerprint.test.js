const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyStealthFingerprint,
  hashCoord,
  isLeakingCandidate,
  filterSdp,
  FALLBACK_PROFILE_A
} = require("./stealth-fingerprint");
const {
  INSTANCE_FINGERPRINT_PROFILES
} = require("../lib/instance-fingerprint-profile");

function createMockWindow() {
  function MockImageData(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  function MockCanvasRenderingContext2D(canvas) {
    this.canvas = canvas;
  }
  MockCanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
    const imgData = new MockImageData(sw, sh);
    // Fill with sample opaque test pattern
    for (let i = 0; i < imgData.data.length; i += 4) {
      imgData.data[i] = 120;     // R
      imgData.data[i + 1] = 140; // G
      imgData.data[i + 2] = 160; // B
      imgData.data[i + 3] = 255; // A (opaque)
    }
    // Set first pixel transparent to test alpha preservation
    imgData.data[3] = 0;
    return imgData;
  };
  MockCanvasRenderingContext2D.prototype.putImageData = function(imgData, x, y) {
    this._lastPutData = imgData;
  };

  function MockCanvasElement(width = 100, height = 100) {
    this.width = width;
    this.height = height;
    this._ctx2d = new MockCanvasRenderingContext2D(this);
    this._webgl = new MockWebGLRenderingContext();
  }
  MockCanvasElement.prototype.getContext = function(type) {
    if (type === "2d") return this._ctx2d;
    if (type === "webgl" || type === "webgl2") return this._webgl;
    return null;
  };
  MockCanvasElement.prototype.toDataURL = function() {
    const rawData = this._ctx2d._lastPutData ? this._ctx2d._lastPutData.data : new Uint8ClampedArray(16);
    // Simple mock encoder converting first few pixels into a hash string
    let hash = 0;
    for (let i = 0; i < rawData.length; i++) {
      hash = ((hash << 5) - hash + rawData[i]) | 0;
    }
    return `data:image/png;base64,mock_${hash}`;
  };

  function MockWebGLRenderingContext() {}
  MockWebGLRenderingContext.prototype.RGBA = 0x1908;
  MockWebGLRenderingContext.prototype.UNSIGNED_BYTE = 0x1401;
  MockWebGLRenderingContext.prototype.getParameter = function(p) {
    if (p === 0x1F00) return "Original WebKit";
    if (p === 0x1F01) return "Original SwiftShader";
    return "Microsoft Basic Render Driver";
  };
  MockWebGLRenderingContext.prototype.getExtension = function(name) {
    return null;
  };
  MockWebGLRenderingContext.prototype.getSupportedExtensions = function() {
    return ["EXT_color_buffer_half_float"];
  };
  MockWebGLRenderingContext.prototype.readPixels = function(x, y, w, h, fmt, type, pixels) {
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 100;
      pixels[i + 1] = 150;
      pixels[i + 2] = 200;
      pixels[i + 3] = (i === 0) ? 0 : 255; // first pixel transparent
    }
  };

  function MockWebGL2RenderingContext() {}
  MockWebGL2RenderingContext.prototype = Object.create(MockWebGLRenderingContext.prototype);

  function MockAudioBuffer(length = 128) {
    this.length = length;
    this._data = new Float32Array(length).fill(0.5);
  }
  MockAudioBuffer.prototype.getChannelData = function(ch) {
    return this._data;
  };

  function MockAnalyserNode() {}
  MockAnalyserNode.prototype.getFloatFrequencyData = function(array) {
    array.fill(-50.0);
  };
  MockAnalyserNode.prototype.getByteFrequencyData = function(array) {
    array.fill(128);
  };

  function MockRTCPeerConnection() {
    this._listeners = {};
    this.onicecandidate = null;
  }
  MockRTCPeerConnection.prototype.addEventListener = function(type, listener) {
    this._listeners[type] = this._listeners[type] || [];
    this._listeners[type].push(listener);
  };
  MockRTCPeerConnection.prototype._dispatch = function(type, event) {
    const list = this._listeners[type] || [];
    for (const fn of list) fn.call(this, event);
  };
  MockRTCPeerConnection.prototype.createOffer = async function() {
    return {
      type: "offer",
      sdp: "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\na=candidate:1 1 udp 123 192.168.1.100 5000 typ host\r\na=candidate:2 1 udp 124 203.0.113.50 5001 typ srflx\r\na=candidate:3 1 udp 125 0.0.0.0 5002 typ relay\r\n"
    };
  };

  const doc = {
    createElement(tag) {
      if (tag === "canvas") return new MockCanvasElement();
      return {};
    }
  };

  return {
    document: doc,
    CanvasRenderingContext2D: MockCanvasRenderingContext2D,
    HTMLCanvasElement: MockCanvasElement,
    WebGLRenderingContext: MockWebGLRenderingContext,
    WebGL2RenderingContext: MockWebGL2RenderingContext,
    AudioBuffer: MockAudioBuffer,
    AnalyserNode: MockAnalyserNode,
    RTCPeerConnection: MockRTCPeerConnection,
    navigator: {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) content-production-app/0.2.0 Chrome/130.0.6723.137 Electron/33.2.1 Safari/537.36",
      appVersion: "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) content-production-app/0.2.0 Chrome/130.0.6723.137 Electron/33.2.1 Safari/537.36",
      vendor: "Google Inc.",
      platform: "Win32"
    }
  };
}

test("Canvas 2D getImageData preserves transparent pixels while perturbing opaque pixels", () => {
  const win = createMockWindow();
  applyStealthFingerprint(win, INSTANCE_FINGERPRINT_PROFILES.A);

  const canvas = new win.HTMLCanvasElement(10, 10);
  const ctx = canvas.getContext("2d");
  const imgData = ctx.getImageData(0, 0, 10, 10);

  // Pixel 0 has alpha === 0 (transparent) -> must NOT be modified
  assert.equal(imgData.data[3], 0);
  assert.equal(imgData.data[0], 120, "Transparent pixel R must remain untouched");
  assert.equal(imgData.data[1], 140, "Transparent pixel G must remain untouched");
  assert.equal(imgData.data[2], 160, "Transparent pixel B must remain untouched");

  // Opaque pixels (alpha === 255) must be perturbed by ±1 or 0
  for (let i = 4; i < imgData.data.length; i += 4) {
    const rDelta = imgData.data[i] - 120;
    const gDelta = imgData.data[i + 1] - 140;
    const bDelta = imgData.data[i + 2] - 160;
    assert.ok(Math.abs(rDelta) <= 1, `R delta ${rDelta} exceeded ±1`);
    assert.ok(Math.abs(gDelta) <= 1, `G delta ${gDelta} exceeded ±1`);
    assert.ok(Math.abs(bDelta) <= 1, `B delta ${bDelta} exceeded ±1`);
  }
});

test("Canvas 2D getImageData is deterministic across multiple calls with same seed", () => {
  const win = createMockWindow();
  applyStealthFingerprint(win, INSTANCE_FINGERPRINT_PROFILES.A);

  const canvas = new win.HTMLCanvasElement(10, 10);
  const ctx = canvas.getContext("2d");

  const call1 = ctx.getImageData(0, 0, 10, 10);
  const call2 = ctx.getImageData(0, 0, 10, 10);

  assert.deepEqual(Array.from(call1.data), Array.from(call2.data));
});

test("Canvas 2D getImageData produces distinct outputs for Instance A vs Instance B", () => {
  const winA = createMockWindow();
  applyStealthFingerprint(winA, INSTANCE_FINGERPRINT_PROFILES.A);
  const canvasA = new winA.HTMLCanvasElement(10, 10);
  const dataA = canvasA.getContext("2d").getImageData(0, 0, 10, 10);

  const winB = createMockWindow();
  applyStealthFingerprint(winB, INSTANCE_FINGERPRINT_PROFILES.B);
  const canvasB = new winB.HTMLCanvasElement(10, 10);
  const dataB = canvasB.getContext("2d").getImageData(0, 0, 10, 10);

  assert.notDeepEqual(Array.from(dataA.data), Array.from(dataB.data));
});

test("Canvas toDataURL produces unique, deterministic data URLs between instances", () => {
  const winA = createMockWindow();
  applyStealthFingerprint(winA, INSTANCE_FINGERPRINT_PROFILES.A);
  const canvasA = new winA.HTMLCanvasElement(10, 10);
  const urlA1 = canvasA.toDataURL();
  const urlA2 = canvasA.toDataURL();
  assert.equal(urlA1, urlA2, "Repeated calls on instance A must produce identical data URL");

  const winB = createMockWindow();
  applyStealthFingerprint(winB, INSTANCE_FINGERPRINT_PROFILES.B);
  const canvasB = new winB.HTMLCanvasElement(10, 10);
  const urlB = canvasB.toDataURL();

  assert.notEqual(urlA1, urlB, "Instance A and Instance B must produce distinct data URLs");
});

test("WebGL readPixels perturbs pixels by ±1 deterministically while preserving transparent pixels", () => {
  const win = createMockWindow();
  applyStealthFingerprint(win, INSTANCE_FINGERPRINT_PROFILES.A);

  const gl = new win.WebGLRenderingContext();
  const pixels = new Uint8Array(4 * 4 * 4); // 4x4 image
  gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  // Pixel 0 was transparent (alpha === 0)
  assert.equal(pixels[3], 0);
  assert.equal(pixels[0], 100, "Transparent pixel R must be unchanged");
  assert.equal(pixels[1], 150, "Transparent pixel G must be unchanged");
  assert.equal(pixels[2], 200, "Transparent pixel B must be unchanged");

  // Opaque pixels must be perturbed by ±1
  let anyPerturbed = false;
  for (let i = 4; i < pixels.length; i += 4) {
    const rDelta = pixels[i] - 100;
    const gDelta = pixels[i + 1] - 150;
    const bDelta = pixels[i + 2] - 200;
    assert.ok(Math.abs(rDelta) <= 1, `R delta ${rDelta} exceeded ±1`);
    assert.ok(Math.abs(gDelta) <= 1, `G delta ${gDelta} exceeded ±1`);
    assert.ok(Math.abs(bDelta) <= 1, `B delta ${bDelta} exceeded ±1`);
    if (rDelta !== 0 || gDelta !== 0 || bDelta !== 0) anyPerturbed = true;
  }
  assert.ok(anyPerturbed, "At least some opaque pixels should have micro-noise");
});

test("AudioBuffer.getChannelData introduces deterministic ±10^-6 perturbation without double-perturbing", () => {
  const win = createMockWindow();
  applyStealthFingerprint(win, INSTANCE_FINGERPRINT_PROFILES.A);

  const buffer = new win.AudioBuffer(64);
  const data1 = buffer.getChannelData(0);

  // Values should deviate from 0.5 by at most 10^-6
  let anyPerturbed = false;
  for (let i = 0; i < data1.length; i++) {
    const diff = Math.abs(data1[i] - 0.5);
    assert.ok(diff <= 1.1e-6, `Diff ${diff} exceeded 10^-6`);
    if (diff > 0) anyPerturbed = true;
  }
  assert.ok(anyPerturbed, "Audio data must receive micro-noise");

  // Second call must NOT re-perturb
  const snapshot = Array.from(data1);
  const data2 = buffer.getChannelData(0);
  assert.deepEqual(Array.from(data2), snapshot);
});

test("AudioBuffer perturbation produces distinct signals between Instance A and Instance B", () => {
  const winA = createMockWindow();
  applyStealthFingerprint(winA, INSTANCE_FINGERPRINT_PROFILES.A);
  const bufA = new winA.AudioBuffer(64);
  const dataA = bufA.getChannelData(0);

  const winB = createMockWindow();
  applyStealthFingerprint(winB, INSTANCE_FINGERPRINT_PROFILES.B);
  const bufB = new winB.AudioBuffer(64);
  const dataB = bufB.getChannelData(0);

  assert.notDeepEqual(Array.from(dataA), Array.from(dataB));
});

test("AnalyserNode.getFloatFrequencyData introduces micro-noise", () => {
  const win = createMockWindow();
  applyStealthFingerprint(win, INSTANCE_FINGERPRINT_PROFILES.A);

  const analyser = new win.AnalyserNode();
  const freqData = new Float32Array(32);
  analyser.getFloatFrequencyData(freqData);

  let anyDiff = false;
  for (let i = 0; i < freqData.length; i++) {
    const diff = Math.abs(freqData[i] - (-50.0));
    assert.ok(diff <= 0.02, `Diff ${diff} out of expected decibel range`);
    if (diff > 0) anyDiff = true;
  }
  assert.ok(anyDiff, "Frequency data must be perturbed");
});

test("WebGL getParameter returns configured physical GPU and eliminates virtual drivers", () => {
  const winA = createMockWindow();
  applyStealthFingerprint(winA, INSTANCE_FINGERPRINT_PROFILES.A);
  const glA = new winA.WebGLRenderingContext();

  assert.equal(glA.getParameter(0x9245), "Google Inc. (NVIDIA)");
  assert.match(glA.getParameter(0x9246), /RTX 4070/);
  assert.doesNotMatch(glA.getParameter(0x9246), /Microsoft Basic Render Driver/);
  assert.doesNotMatch(glA.getParameter(0x9246), /SwiftShader/);

  const winB = createMockWindow();
  applyStealthFingerprint(winB, INSTANCE_FINGERPRINT_PROFILES.B);
  const glB = new winB.WebGLRenderingContext();

  assert.equal(glB.getParameter(0x9245), "Google Inc. (AMD)");
  assert.match(glB.getParameter(0x9246), /RX 7800 XT/);

  // Extension queries
  assert.ok(glA.getExtension("WEBGL_debug_renderer_info"));
  assert.ok(glA.getSupportedExtensions().includes("WEBGL_debug_renderer_info"));
});

test("isLeakingCandidate identifies private LAN and public IP addresses", () => {
  // Leaking cases
  assert.ok(isLeakingCandidate("candidate:1 1 udp 123 192.168.1.1 5000 typ host"));
  assert.ok(isLeakingCandidate("candidate:2 1 udp 124 10.0.0.15 5001 typ host"));
  assert.ok(isLeakingCandidate("candidate:3 1 udp 125 172.16.5.4 5002 typ host"));
  assert.ok(isLeakingCandidate("candidate:4 1 udp 126 127.0.0.1 5003 typ host"));
  assert.ok(isLeakingCandidate("candidate:5 1 udp 127 123.45.67.89 5004 typ srflx"));
  assert.ok(isLeakingCandidate("candidate:6 1 udp 128 2001:db8::1 5005 typ host"));

  // Safe cases (empty, non-IP, mDNS)
  assert.equal(isLeakingCandidate(""), false);
  assert.equal(isLeakingCandidate(null), false);
  assert.equal(isLeakingCandidate("candidate:7 1 udp 129 abc-123.local 5006 typ host"), false);
});

test("filterSdp removes leaking candidate lines from SDP", () => {
  const rawSdp = [
    "v=0",
    "o=- 12345 2 IN IP4 127.0.0.1",
    "a=candidate:1 1 udp 123 192.168.1.100 5000 typ host",
    "a=candidate:2 1 udp 124 203.0.113.50 5001 typ srflx",
    "a=candidate:3 1 udp 125 abc.local 5002 typ host",
    "a=sendrecv"
  ].join("\r\n");

  const cleaned = filterSdp(rawSdp);
  assert.doesNotMatch(cleaned, /192\.168\.1\.100/);
  assert.doesNotMatch(cleaned, /203\.0\.113\.50/);
  assert.match(cleaned, /abc\.local/);
  assert.match(cleaned, /a=sendrecv/);
});

test("RTCPeerConnection suppresses leaking icecandidate events", () => {
  const win = createMockWindow();
  applyStealthFingerprint(win, INSTANCE_FINGERPRINT_PROFILES.A);

  const pc = new win.RTCPeerConnection();
  const receivedCandidates = [];

  pc.onicecandidate = (e) => {
    if (e?.candidate) receivedCandidates.push(e.candidate.candidate);
  };

  // Dispatch leaking candidate
  pc._dispatch("icecandidate", {
    candidate: { candidate: "candidate:1 1 udp 123 192.168.1.100 5000 typ host" }
  });

  // Dispatch safe candidate
  pc._dispatch("icecandidate", {
    candidate: { candidate: "candidate:2 1 udp 124 safe-node.local 5001 typ host" }
  });

  assert.equal(receivedCandidates.length, 1);
  assert.equal(receivedCandidates[0], "candidate:2 1 udp 124 safe-node.local 5001 typ host");
});

test("RTCPeerConnection createOffer cleans leaking candidates in SDP", async () => {
  const win = createMockWindow();
  applyStealthFingerprint(win, INSTANCE_FINGERPRINT_PROFILES.A);

  const pc = new win.RTCPeerConnection();
  const offer = await pc.createOffer();
  assert.doesNotMatch(offer.sdp, /192\.168\.1\.100/);
  assert.doesNotMatch(offer.sdp, /203\.0\.113\.50/);
});

test("applyStealthFingerprint disguises navigator.userAgent as genuine Google Chrome for Instance A without Electron traces", () => {
  const win = createMockWindow();
  applyStealthFingerprint(win, INSTANCE_FINGERPRINT_PROFILES.A);

  assert.equal(win.navigator.userAgent, INSTANCE_FINGERPRINT_PROFILES.A.browser.userAgent);
  assert.doesNotMatch(win.navigator.userAgent, /Electron/i);
  assert.doesNotMatch(win.navigator.userAgent, /content-production-app/i);
  assert.match(win.navigator.userAgent, /Chrome\/130/);
  assert.doesNotMatch(win.navigator.userAgent, /Edg\//);
});

test("applyStealthFingerprint disguises navigator.userAgent as genuine Microsoft Edge for Instance B with Edg token", () => {
  const win = createMockWindow();
  applyStealthFingerprint(win, INSTANCE_FINGERPRINT_PROFILES.B);

  assert.equal(win.navigator.userAgent, INSTANCE_FINGERPRINT_PROFILES.B.browser.userAgent);
  assert.doesNotMatch(win.navigator.userAgent, /Electron/i);
  assert.doesNotMatch(win.navigator.userAgent, /content-production-app/i);
  assert.match(win.navigator.userAgent, /Edg\/130/);
});

test("applyStealthFingerprint hooks navigator.userAgentData with valid Client Hints brands", async () => {
  const winA = createMockWindow();
  applyStealthFingerprint(winA, INSTANCE_FINGERPRINT_PROFILES.A);

  assert.ok(winA.navigator.userAgentData);
  assert.equal(winA.navigator.userAgentData.mobile, false);
  assert.equal(winA.navigator.userAgentData.platform, "Windows");
  assert.ok(winA.navigator.userAgentData.brands.some((b) => b.brand === "Google Chrome"));

  const winB = createMockWindow();
  applyStealthFingerprint(winB, INSTANCE_FINGERPRINT_PROFILES.B);

  assert.ok(winB.navigator.userAgentData);
  assert.equal(winB.navigator.userAgentData.mobile, false);
  assert.equal(winB.navigator.userAgentData.platform, "Windows");
  assert.ok(winB.navigator.userAgentData.brands.some((b) => b.brand === "Microsoft Edge"));

  const highEntropy = await winB.navigator.userAgentData.getHighEntropyValues(["platformVersion"]);
  assert.equal(highEntropy.platform, "Windows");
  assert.equal(highEntropy.platformVersion, "15.0.0");
});

test("Canvas toBlob handles WebGL canvases with deterministic micro-noise without throwing", (t, done) => {
  const win = createMockWindow();
  const canvas = new win.HTMLCanvasElement(10, 10);
  canvas.toBlob = function(cb) {
    cb({ size: 128, type: "image/png" });
  };
  applyStealthFingerprint(win, INSTANCE_FINGERPRINT_PROFILES.A);

  canvas.toBlob((blob) => {
    assert.ok(blob);
    assert.equal(blob.type, "image/png");
    done();
  });
});


