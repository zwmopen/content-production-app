/**
 * Stealth Fingerprint & Anti-Detect Injection Module (Milestone M1 / R1)
 *
 * Injected into the Main World before web content executes:
 * 1. Deterministic coordinate PRNG micro-noise engine for Canvas 2D/3D.
 * 2. AudioContext buffer perturbation (AudioBuffer.getChannelData & AnalyserNode).
 * 3. WebGL physical GPU spoofing (UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL).
 * 4. WebRTC IP leak suppression (in-page RTCPeerConnection candidate filtering).
 */

let getFingerprintProfile;
let INSTANCE_FINGERPRINT_PROFILES;
try {
  const profileModule = require("../lib/instance-fingerprint-profile");
  getFingerprintProfile = profileModule.getFingerprintProfile;
  INSTANCE_FINGERPRINT_PROFILES = profileModule.INSTANCE_FINGERPRINT_PROFILES;
} catch (_) {
  // Standalone / sandbox fallback
}

const FALLBACK_PROFILE_A = Object.freeze({
  instanceId: "A",
  seed: 0x9A4F,
  gpu: Object.freeze({
    vendor: "Google Inc. (NVIDIA)",
    renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.4617)",
    unmaskedVendor: "Google Inc. (NVIDIA)",
    unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.4617)",
    gpuVendor: "nvidia",
    gpuArchitecture: "ada lovelace",
    description: "NVIDIA GeForce RTX 4070"
  }),
  browser: Object.freeze({
    type: "chrome",
    name: "Google Chrome",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    appVersion: "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    vendor: "Google Inc.",
    platform: "Win32",
    brands: Object.freeze([
      Object.freeze({ brand: "Chromium", version: "130" }),
      Object.freeze({ brand: "Google Chrome", version: "130" }),
      Object.freeze({ brand: "Not?A_Brand", version: "99" })
    ])
  }),
  audio: Object.freeze({
    noiseScale: 1e-6
  })
});

/**
 * Coordinate PRNG hash engine (standalone pure function).
 */
function hashCoord(seed, x, y, channel = 0) {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(channel, 1274126177)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Tests if an ICE candidate string leaks private LAN or public IPs.
 */
function isLeakingCandidate(candidateStr) {
  if (!candidateStr || typeof candidateStr !== "string") return false;
  // Match private LAN IPv4 (192.168.x.x, 10.x.x.x, 172.16-31.x.x, 127.x.x.x)
  if (/(?:192\.168\.|10\.\d+\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.)\d+\.\d+/.test(candidateStr)) {
    return true;
  }
  // Match public IPv4 candidates
  if (/\b(?:[1-9]\d{0,2})\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})\b/.test(candidateStr)) {
    return true;
  }
  // Match IPv6 address patterns
  if (/[0-9a-fA-F]{1,4}:[0-9a-fA-F]{1,4}:[0-9a-fA-F:]+/.test(candidateStr)) {
    return true;
  }
  return false;
}

/**
 * Filters SDP descriptions removing leaking candidate lines.
 */
function filterSdp(sdp) {
  if (!sdp || typeof sdp !== "string") return sdp;
  return sdp
    .split("\r\n")
    .filter((line) => {
      if (line.startsWith("a=candidate:") && isLeakingCandidate(line)) {
        return false;
      }
      return true;
    })
    .join("\r\n");
}

/**
 * Self-contained injection function designed to be serialized and executed
 * directly in the Main World via webFrame.executeJavaScript or called locally.
 *
 * @param {object} target Window or global context
 * @param {object} config Resolved fingerprint profile
 */
function applyStealthFingerprint(target, config) {
  if (!target || target.__STEALTH_FINGERPRINT_INITIALIZED__) return;
  target.__STEALTH_FINGERPRINT_INITIALIZED__ = true;

  const seed = Number(config?.seed) || 0x9A4F;
  const gpu = config?.gpu || {
    vendor: "Google Inc. (NVIDIA)",
    renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.4617)",
    unmaskedVendor: "Google Inc. (NVIDIA)",
    unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.4617)"
  };

  function hashCoordInner(s, x, y, c) {
    let h = (s ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(c, 1274126177)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // ==========================================
  // 1. Canvas 2D/3D Micro-Noise Perturbation
  // ==========================================
  const STEALTH_CLONE_KEY = typeof Symbol !== "undefined" ? Symbol("stealth_clone") : "__stealth_clone__";

  if (target.CanvasRenderingContext2D && target.CanvasRenderingContext2D.prototype) {
    const proto2D = target.CanvasRenderingContext2D.prototype;
    if (!proto2D.getImageData?.__isStealthHooked__) {
      const origGetImageData = proto2D.getImageData;
      proto2D.getImageData = function(sx, sy, sw, sh, ...rest) {
        const imageData = origGetImageData.apply(this, [sx, sy, sw, sh, ...rest]);
        if (!imageData || !imageData.data) return imageData;
        const data = imageData.data;
        const w = imageData.width;
        const h = imageData.height;
        const startX = Math.round(Number(sx) || 0);
        const startY = Math.round(Number(sy) || 0);

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const a = data[idx + 3];
            // Strictly preserve transparent pixels (alpha === 0 untouched)
            if (a === 0) continue;

            for (let c = 0; c < 3; c++) {
              const delta = (hashCoordInner(seed, startX + x, startY + y, c) % 3) - 1;
              const val = data[idx + c] + delta;
              data[idx + c] = val < 0 ? 0 : val > 255 ? 255 : val;
            }
          }
        }
        return imageData;
      };
      proto2D.getImageData.__isStealthHooked__ = true;
    }
  }

  if (target.HTMLCanvasElement && target.HTMLCanvasElement.prototype) {
    const protoCanvas = target.HTMLCanvasElement.prototype;
    if (!protoCanvas.toDataURL?.__isStealthHooked__) {
      const origToDataURL = protoCanvas.toDataURL;
      protoCanvas.toDataURL = function(...args) {
        if (this[STEALTH_CLONE_KEY] || this.width === 0 || this.height === 0) {
          return origToDataURL.apply(this, args);
        }
        try {
          const ctx2d = this.getContext && this.getContext("2d");
          if (ctx2d) {
            const w = this.width;
            const h = this.height;
            const imgData = ctx2d.getImageData(0, 0, w, h);
            const doc = this.ownerDocument || target.document;
            if (doc && doc.createElement) {
              const clone = doc.createElement("canvas");
              clone[STEALTH_CLONE_KEY] = true;
              clone.width = w;
              clone.height = h;
              const cloneCtx = clone.getContext("2d");
              if (cloneCtx && cloneCtx.putImageData) {
                cloneCtx.putImageData(imgData, 0, 0);
                return origToDataURL.apply(clone, args);
              }
            }
          }
          const gl = this.getContext && (this.getContext("webgl") || this.getContext("webgl2") || this.getContext("experimental-webgl"));
          if (gl && gl.readPixels) {
            const w = this.width;
            const h = this.height;
            const pixels = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            const doc = this.ownerDocument || target.document;
            if (doc && doc.createElement) {
              const clone = doc.createElement("canvas");
              clone[STEALTH_CLONE_KEY] = true;
              clone.width = w;
              clone.height = h;
              const cloneCtx = clone.getContext("2d");
              if (cloneCtx && cloneCtx.createImageData) {
                const imgData = cloneCtx.createImageData(w, h);
                for (let y = 0; y < h; y++) {
                  const srcRow = (h - 1 - y) * w * 4;
                  const dstRow = y * w * 4;
                  imgData.data.set(pixels.subarray(srcRow, srcRow + w * 4), dstRow);
                }
                cloneCtx.putImageData(imgData, 0, 0);
                return origToDataURL.apply(clone, args);
              }
            }
          }
        } catch (_) {}
        return origToDataURL.apply(this, args);
      };
      protoCanvas.toDataURL.__isStealthHooked__ = true;
    }

    if (!protoCanvas.toBlob?.__isStealthHooked__) {
      const origToBlob = protoCanvas.toBlob;
      if (origToBlob) {
        protoCanvas.toBlob = function(callback, ...args) {
          if (this[STEALTH_CLONE_KEY] || this.width === 0 || this.height === 0) {
            return origToBlob.apply(this, [callback, ...args]);
          }
          try {
            const ctx2d = this.getContext && this.getContext("2d");
            if (ctx2d) {
              const w = this.width;
              const h = this.height;
              const imgData = ctx2d.getImageData(0, 0, w, h);
              const doc = this.ownerDocument || target.document;
              if (doc && doc.createElement) {
                const clone = doc.createElement("canvas");
                clone[STEALTH_CLONE_KEY] = true;
                clone.width = w;
                clone.height = h;
                const cloneCtx = clone.getContext("2d");
                if (cloneCtx && cloneCtx.putImageData) {
                  cloneCtx.putImageData(imgData, 0, 0);
                  return origToBlob.apply(clone, [callback, ...args]);
                }
              }
            }
            const gl = this.getContext && (this.getContext("webgl") || this.getContext("webgl2") || this.getContext("experimental-webgl"));
            if (gl && gl.readPixels) {
              const w = this.width;
              const h = this.height;
              const pixels = new Uint8Array(w * h * 4);
              gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
              const doc = this.ownerDocument || target.document;
              if (doc && doc.createElement) {
                const clone = doc.createElement("canvas");
                clone[STEALTH_CLONE_KEY] = true;
                clone.width = w;
                clone.height = h;
                const cloneCtx = clone.getContext("2d");
                if (cloneCtx && cloneCtx.createImageData) {
                  const imgData = cloneCtx.createImageData(w, h);
                  for (let y = 0; y < h; y++) {
                    const srcRow = (h - 1 - y) * w * 4;
                    const dstRow = y * w * 4;
                    imgData.data.set(pixels.subarray(srcRow, srcRow + w * 4), dstRow);
                  }
                  cloneCtx.putImageData(imgData, 0, 0);
                  return origToBlob.apply(clone, [callback, ...args]);
                }
              }
            }
          } catch (_) {}
          return origToBlob.apply(this, [callback, ...args]);
        };
        protoCanvas.toBlob.__isStealthHooked__ = true;
      }
    }
  }

  // WebGL readPixels hook
  function hookReadPixels(proto) {
    if (!proto || !proto.readPixels || proto.readPixels.__isStealthHooked__) return;
    const origReadPixels = proto.readPixels;
    proto.readPixels = function(x, y, width, height, format, type, pixels) {
      origReadPixels.apply(this, arguments);
      if (!pixels || !(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) return;
      const w = Number(width) || 0;
      const h = Number(height) || 0;
      const startX = Math.round(Number(x) || 0);
      const startY = Math.round(Number(y) || 0);

      const RGBA = this.RGBA || 0x1908;
      const UNSIGNED_BYTE = this.UNSIGNED_BYTE || 0x1401;
      if (format === RGBA && type === UNSIGNED_BYTE) {
        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            const idx = (py * w + px) * 4;
            const a = pixels[idx + 3];
            if (a === 0) continue; // transparent pixel preserved
            for (let c = 0; c < 3; c++) {
              const delta = (hashCoordInner(seed, startX + px, startY + py, c) % 3) - 1;
              const val = pixels[idx + c] + delta;
              pixels[idx + c] = val < 0 ? 0 : val > 255 ? 255 : val;
            }
          }
        }
      }
    };
    proto.readPixels.__isStealthHooked__ = true;
  }

  if (target.WebGLRenderingContext && target.WebGLRenderingContext.prototype) {
    hookReadPixels(target.WebGLRenderingContext.prototype);
  }
  if (target.WebGL2RenderingContext && target.WebGL2RenderingContext.prototype) {
    hookReadPixels(target.WebGL2RenderingContext.prototype);
  }

  // ==========================================
  // 2. AudioContext Perturbation
  // ==========================================
  if (target.AudioBuffer && target.AudioBuffer.prototype) {
    const protoAudio = target.AudioBuffer.prototype;
    if (!protoAudio.getChannelData?.__isStealthHooked__) {
      const origGetChannelData = protoAudio.getChannelData;
      const PERTURBED_FLAG = typeof Symbol !== "undefined" ? Symbol("audio_perturbed") : "__audio_perturbed__";

      protoAudio.getChannelData = function(channelIndex) {
        const channel = Number(channelIndex) || 0;
        const data = origGetChannelData.call(this, channel);
        if (!data) return data;

        this[PERTURBED_FLAG] = this[PERTURBED_FLAG] || new Set();
        if (this[PERTURBED_FLAG].has(channel)) {
          return data;
        }
        this[PERTURBED_FLAG].add(channel);

        const len = data.length;
        for (let i = 0; i < len; i++) {
          const h = hashCoordInner(seed, i, channel, 99);
          // ±10^-6 micro-noise
          const delta = ((h % 2001) - 1000) * 1e-9;
          data[i] = data[i] + delta;
        }
        return data;
      };
      protoAudio.getChannelData.__isStealthHooked__ = true;
    }
  }

  if (target.AnalyserNode && target.AnalyserNode.prototype) {
    const protoAnalyser = target.AnalyserNode.prototype;
    if (!protoAnalyser.getFloatFrequencyData?.__isStealthHooked__) {
      const origGetFloatFreq = protoAnalyser.getFloatFrequencyData;
      if (origGetFloatFreq) {
        protoAnalyser.getFloatFrequencyData = function(array) {
          origGetFloatFreq.call(this, array);
          if (array && array.length) {
            for (let i = 0; i < array.length; i++) {
              if (Number.isFinite(array[i])) {
                const h = hashCoordInner(seed, i, 0, 77);
                // Frequency decibels: scale to float32 representation
                const delta = ((h % 2001) - 1000) * 1e-5;
                array[i] = array[i] + delta;
              }
            }
          }
        };
        protoAnalyser.getFloatFrequencyData.__isStealthHooked__ = true;
      }
    }

    if (!protoAnalyser.getByteFrequencyData?.__isStealthHooked__) {
      const origGetByteFreq = protoAnalyser.getByteFrequencyData;
      if (origGetByteFreq) {
        protoAnalyser.getByteFrequencyData = function(array) {
          origGetByteFreq.call(this, array);
          if (array && array.length) {
            for (let i = 0; i < array.length; i++) {
              const delta = (hashCoordInner(seed, i, 0, 88) % 3) - 1;
              const val = array[i] + delta;
              array[i] = val < 0 ? 0 : val > 255 ? 255 : val;
            }
          }
        };
        protoAnalyser.getByteFrequencyData.__isStealthHooked__ = true;
      }
    }
  }

  // ==========================================
  // 3. WebGL Physical GPU Spoofing
  // ==========================================
  const UNMASKED_VENDOR_WEBGL = 0x9245;
  const UNMASKED_RENDERER_WEBGL = 0x9246;
  const VENDOR = 0x1F00;
  const RENDERER = 0x1F01;

  function hookWebGLContext(proto) {
    if (!proto || proto.getParameter?.__isStealthHooked__) return;
    const origGetParameter = proto.getParameter;
    if (origGetParameter) {
      proto.getParameter = function(param) {
        if (param === UNMASKED_VENDOR_WEBGL) {
          return gpu.unmaskedVendor || gpu.vendor;
        }
        if (param === UNMASKED_RENDERER_WEBGL) {
          return gpu.unmaskedRenderer || gpu.renderer;
        }
        if (param === VENDOR) {
          return "WebKit";
        }
        if (param === RENDERER) {
          return "WebKit WebGL";
        }
        return origGetParameter.apply(this, arguments);
      };
      proto.getParameter.__isStealthHooked__ = true;
    }

    const origGetExtension = proto.getExtension;
    if (origGetExtension) {
      proto.getExtension = function(name) {
        if (String(name).toLowerCase() === "webgl_debug_renderer_info") {
          return {
            UNMASKED_VENDOR_WEBGL,
            UNMASKED_RENDERER_WEBGL
          };
        }
        return origGetExtension.apply(this, arguments);
      };
    }

    const origGetSupportedExtensions = proto.getSupportedExtensions;
    if (origGetSupportedExtensions) {
      proto.getSupportedExtensions = function() {
        const exts = origGetSupportedExtensions.apply(this, arguments) || [];
        if (!exts.includes("WEBGL_debug_renderer_info")) {
          return [...exts, "WEBGL_debug_renderer_info"];
        }
        return exts;
      };
    }
  }

  if (target.WebGLRenderingContext && target.WebGLRenderingContext.prototype) {
    hookWebGLContext(target.WebGLRenderingContext.prototype);
  }
  if (target.WebGL2RenderingContext && target.WebGL2RenderingContext.prototype) {
    hookWebGLContext(target.WebGL2RenderingContext.prototype);
  }

  // WebGPU spoofing if present
  if (target.navigator && target.navigator.gpu && target.navigator.gpu.requestAdapter) {
    const origRequestAdapter = target.navigator.gpu.requestAdapter.bind(target.navigator.gpu);
    target.navigator.gpu.requestAdapter = async function(options) {
      const adapter = await origRequestAdapter(options);
      if (!adapter) return adapter;
      const vendorLower = (gpu.vendor || "").toLowerCase();
      const vendorStr = vendorLower.includes("nvidia") ? "nvidia" : vendorLower.includes("amd") ? "amd" : "intel";
      const archStr = (gpu.renderer || "").toLowerCase().includes("rtx 40") ? "ada lovelace" : "rdna 3";
      try {
        Object.defineProperty(adapter, "info", {
          get: () => Object.freeze({
            vendor: vendorStr,
            architecture: archStr,
            device: gpu.unmaskedRenderer || gpu.renderer,
            description: gpu.description || gpu.renderer
          }),
          configurable: true
        });
      } catch (_) {}
      return adapter;
    };
  }

  // ==========================================
  // 4. WebRTC IP Leak Prevention
  // ==========================================
  function candidateIsLeaking(candStr) {
    if (!candStr || typeof candStr !== "string") return false;
    // Private LAN IPs
    if (/(?:192\.168\.|10\.\d+\.|172\.(?:1[6-9]|2\d|3[01])\.|127\.)\d+\.\d+/.test(candStr)) {
      return true;
    }
    // Public IPv4
    if (/\b(?:[1-9]\d{0,2})\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})\b/.test(candStr)) {
      return true;
    }
    // IPv6
    if (/[0-9a-fA-F]{1,4}:[0-9a-fA-F]{1,4}:[0-9a-fA-F:]+/.test(candStr)) {
      return true;
    }
    return false;
  }

  function cleanSdp(sdp) {
    if (!sdp || typeof sdp !== "string") return sdp;
    return sdp
      .split("\r\n")
      .filter((line) => {
        if (line.startsWith("a=candidate:") && candidateIsLeaking(line)) {
          return false;
        }
        return true;
      })
      .join("\r\n");
  }

  if (typeof target.RTCPeerConnection !== "undefined") {
    const OrigRTCPeerConnection = target.RTCPeerConnection;
    const PatchedRTCPeerConnection = function(...pcArgs) {
      const pc = new OrigRTCPeerConnection(...pcArgs);
      let userOnIceCandidate = null;

      Object.defineProperty(pc, "onicecandidate", {
        get: () => userOnIceCandidate,
        set: (handler) => {
          userOnIceCandidate = handler;
        },
        configurable: true,
        enumerable: true
      });

      const origAddEventListener = pc.addEventListener ? pc.addEventListener.bind(pc) : null;
      if (origAddEventListener) {
        pc.addEventListener = function(type, listener, options) {
          if (type === "icecandidate" && typeof listener === "function") {
            const wrappedListener = function(event) {
              if (event && event.candidate && event.candidate.candidate) {
                if (candidateIsLeaking(event.candidate.candidate)) {
                  event.stopImmediatePropagation?.();
                  return;
                }
              }
              return listener.call(this, event);
            };
            return origAddEventListener(type, wrappedListener, options);
          }
          return origAddEventListener(type, listener, options);
        };

        origAddEventListener("icecandidate", (event) => {
          if (event && event.candidate && event.candidate.candidate) {
            if (candidateIsLeaking(event.candidate.candidate)) {
              event.stopImmediatePropagation?.();
              return;
            }
          }
          if (typeof userOnIceCandidate === "function") {
            userOnIceCandidate.call(pc, event);
          }
        });
      }

      if (pc.createOffer) {
        const origCreateOffer = pc.createOffer.bind(pc);
        pc.createOffer = async function(...offerArgs) {
          const offer = await origCreateOffer(...offerArgs);
          if (offer && offer.sdp) {
            offer.sdp = cleanSdp(offer.sdp);
          }
          return offer;
        };
      }

      if (pc.createAnswer) {
        const origCreateAnswer = pc.createAnswer.bind(pc);
        pc.createAnswer = async function(...answerArgs) {
          const answer = await origCreateAnswer(...answerArgs);
          if (answer && answer.sdp) {
            answer.sdp = cleanSdp(answer.sdp);
          }
          return answer;
        };
      }

      return pc;
    };

    PatchedRTCPeerConnection.prototype = OrigRTCPeerConnection.prototype;
    if (OrigRTCPeerConnection.generateCertificate) {
      PatchedRTCPeerConnection.generateCertificate = OrigRTCPeerConnection.generateCertificate.bind(OrigRTCPeerConnection);
    }
    target.RTCPeerConnection = PatchedRTCPeerConnection;
    if (target.webkitRTCPeerConnection) {
      target.webkitRTCPeerConnection = PatchedRTCPeerConnection;
    }
  }

  // ==========================================
  // 5. Browser Identity & Navigator Disguise
  // ==========================================
  const browserConfig = config?.browser;
  if (browserConfig && target.navigator) {
    const nav = target.navigator;
    const protoNav = Object.getPrototypeOf(nav) || nav;

    function safeDefine(prop, getter) {
      try {
        Object.defineProperty(nav, prop, {
          get: getter,
          configurable: true,
          enumerable: true
        });
      } catch (_) {}
      try {
        if (protoNav && protoNav !== Object.prototype) {
          Object.defineProperty(protoNav, prop, {
            get: getter,
            configurable: true,
            enumerable: true
          });
        }
      } catch (_) {}
    }

    if (browserConfig.userAgent) {
      safeDefine("userAgent", () => browserConfig.userAgent);
    }
    if (browserConfig.appVersion) {
      safeDefine("appVersion", () => browserConfig.appVersion);
    }
    if (browserConfig.vendor) {
      safeDefine("vendor", () => browserConfig.vendor);
    }
    if (browserConfig.platform) {
      safeDefine("platform", () => browserConfig.platform);
    }

    // Client Hints userAgentData
    if (browserConfig.brands) {
      const brandsList = Array.isArray(browserConfig.brands) ? browserConfig.brands : [];
      const uad = {
        brands: brandsList,
        mobile: false,
        platform: "Windows",
        getHighEntropyValues: async (hints) => ({
          brands: brandsList,
          mobile: false,
          platform: "Windows",
          platformVersion: "15.0.0",
          architecture: "x86",
          bitness: "64",
          model: ""
        }),
        toJSON: () => ({
          brands: brandsList,
          mobile: false,
          platform: "Windows"
        })
      };
      safeDefine("userAgentData", () => uad);
    }
  }
}

/**
 * Resolve runtime fingerprint profile from process arguments or environment.
 */
function resolveConfig() {
  if (typeof process !== "undefined" && Array.isArray(process.argv)) {
    for (const arg of process.argv) {
      if (arg.startsWith("--fingerprint-config=")) {
        try {
          const raw = arg.slice("--fingerprint-config=".length);
          const parsed = JSON.parse(decodeURIComponent(raw));
          if (parsed && parsed.seed) return parsed;
        } catch (_) {}
      }
      if (arg.startsWith("--content-instance-id=")) {
        const instId = arg.slice("--content-instance-id=".length);
        if (getFingerprintProfile) return getFingerprintProfile(instId);
      }
    }
  }

  const envId = (typeof process !== "undefined" && process.env?.CONTENT_INSTANCE_ID) || "A";
  if (getFingerprintProfile) {
    return getFingerprintProfile(envId);
  }
  return FALLBACK_PROFILE_A;
}

// Automatically execute when running in Electron preload or browser context
(function autoExecute() {
  const currentWindow = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null);
  if (!currentWindow) return;

  const config = resolveConfig();

  // 1. Hook the current context (preload isolated world)
  applyStealthFingerprint(currentWindow, config);

  // 2. Synchronously inject into Main World via webFrame if available
  try {
    let webFrame = null;
    if (typeof require !== "undefined") {
      try {
        const electron = require("electron");
        webFrame = electron.webFrame;
      } catch (_) {}
    }
    if (!webFrame && currentWindow.webFrame) {
      webFrame = currentWindow.webFrame;
    }

    if (webFrame && typeof webFrame.executeJavaScript === "function") {
      const serializedFn = `(${applyStealthFingerprint.toString()})(window, ${JSON.stringify(config)});`;
      webFrame.executeJavaScript(serializedFn);
    }
  } catch (_) {}
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    applyStealthFingerprint,
    hashCoord,
    isLeakingCandidate,
    filterSdp,
    resolveConfig,
    FALLBACK_PROFILE_A
  };
}
