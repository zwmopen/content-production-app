/**
 * Instance Fingerprint Profile Mapping (Milestone M1 / R1)
 *
 * Defines deterministic, immutable hardware seeds and physical GPU profiles
 * for instances A, B, C, and D to eliminate fingerprint collisions (-d8262ce)
 * and virtual driver disclosure (Microsoft Basic Render Driver).
 */

const BROWSER_PROFILES = Object.freeze({
  CHROME_WIN11: Object.freeze({
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
  EDGE_WIN11: Object.freeze({
    type: "edge",
    name: "Microsoft Edge",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    appVersion: "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
    vendor: "Google Inc.",
    platform: "Win32",
    brands: Object.freeze([
      Object.freeze({ brand: "Chromium", version: "130" }),
      Object.freeze({ brand: "Microsoft Edge", version: "130" }),
      Object.freeze({ brand: "Not?A_Brand", version: "99" })
    ])
  })
});

const INSTANCE_FINGERPRINT_PROFILES = Object.freeze({
  A: Object.freeze({
    instanceId: "A",
    seed: 0x9A4F, // 39503
    browser: BROWSER_PROFILES.CHROME_WIN11,
    gpu: Object.freeze({
      vendor: "Google Inc. (NVIDIA)",
      renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.4617)",
      unmaskedVendor: "Google Inc. (NVIDIA)",
      unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.4617)",
      gpuVendor: "nvidia",
      gpuArchitecture: "ada lovelace",
      description: "NVIDIA GeForce RTX 4070"
    }),
    audio: Object.freeze({
      noiseScale: 1e-6
    })
  }),
  B: Object.freeze({
    instanceId: "B",
    seed: 0x3C8E, // 15502
    browser: BROWSER_PROFILES.EDGE_WIN11,
    gpu: Object.freeze({
      vendor: "Google Inc. (AMD)",
      renderer: "ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.24033.1003)",
      unmaskedVendor: "Google Inc. (AMD)",
      unmaskedRenderer: "ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.24033.1003)",
      gpuVendor: "amd",
      gpuArchitecture: "rdna 3",
      description: "AMD Radeon RX 7800 XT"
    }),
    audio: Object.freeze({
      noiseScale: 1e-6
    })
  }),
  C: Object.freeze({
    instanceId: "C",
    seed: 0x7B21, // 31521
    browser: BROWSER_PROFILES.CHROME_WIN11,
    gpu: Object.freeze({
      vendor: "Google Inc. (NVIDIA)",
      renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.4617)",
      unmaskedVendor: "Google Inc. (NVIDIA)",
      unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.4617)",
      gpuVendor: "nvidia",
      gpuArchitecture: "ada lovelace",
      description: "NVIDIA GeForce RTX 4080"
    }),
    audio: Object.freeze({
      noiseScale: 1e-6
    })
  }),
  D: Object.freeze({
    instanceId: "D",
    seed: 0x5E6A, // 24170
    browser: BROWSER_PROFILES.EDGE_WIN11,
    gpu: Object.freeze({
      vendor: "Google Inc. (Intel)",
      renderer: "ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.101.4953)",
      unmaskedVendor: "Google Inc. (Intel)",
      unmaskedRenderer: "ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.101.4953)",
      gpuVendor: "intel",
      gpuArchitecture: "alchemist",
      description: "Intel Arc A770 Graphics"
    }),
    audio: Object.freeze({
      noiseScale: 1e-6
    })
  }),
  E: Object.freeze({
    instanceId: "E",
    seed: 0x4D12,
    browser: BROWSER_PROFILES.CHROME_WIN11,
    gpu: Object.freeze({
      vendor: "Google Inc. (NVIDIA)",
      renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.5123)",
      unmaskedVendor: "Google Inc. (NVIDIA)",
      unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.5123)",
      gpuVendor: "nvidia",
      gpuArchitecture: "ada lovelace",
      description: "NVIDIA GeForce RTX 4060 Ti"
    }),
    audio: Object.freeze({
      noiseScale: 1e-6
    })
  }),
  F: Object.freeze({
    instanceId: "F",
    seed: 0x8C33,
    browser: BROWSER_PROFILES.EDGE_WIN11,
    gpu: Object.freeze({
      vendor: "Google Inc. (AMD)",
      renderer: "ANGLE (AMD, AMD Radeon RX 7700 XT Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.24033.1003)",
      unmaskedVendor: "Google Inc. (AMD)",
      unmaskedRenderer: "ANGLE (AMD, AMD Radeon RX 7700 XT Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.24033.1003)",
      gpuVendor: "amd",
      gpuArchitecture: "rdna 3",
      description: "AMD Radeon RX 7700 XT"
    }),
    audio: Object.freeze({
      noiseScale: 1e-6
    })
  }),
  G: Object.freeze({
    instanceId: "G",
    seed: 0x2B99,
    browser: BROWSER_PROFILES.CHROME_WIN11,
    gpu: Object.freeze({
      vendor: "Google Inc. (NVIDIA)",
      renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.3623)",
      unmaskedVendor: "Google Inc. (NVIDIA)",
      unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.3623)",
      gpuVendor: "nvidia",
      gpuArchitecture: "ampere",
      description: "NVIDIA GeForce RTX 3080"
    }),
    audio: Object.freeze({
      noiseScale: 1e-6
    })
  }),
  H: Object.freeze({
    instanceId: "H",
    seed: 0x6F47,
    browser: BROWSER_PROFILES.EDGE_WIN11,
    gpu: Object.freeze({
      vendor: "Google Inc. (Intel)",
      renderer: "ANGLE (Intel, Intel(R) Arc(TM) A750 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.101.4953)",
      unmaskedVendor: "Google Inc. (Intel)",
      unmaskedRenderer: "ANGLE (Intel, Intel(R) Arc(TM) A750 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.101.4953)",
      gpuVendor: "intel",
      gpuArchitecture: "alchemist",
      description: "Intel Arc A750 Graphics"
    }),
    audio: Object.freeze({
      noiseScale: 1e-6
    })
  })
});

const DYNAMIC_GPU_POOL = Object.freeze([
  Object.freeze({
    vendor: "Google Inc. (NVIDIA)",
    renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.5123)",
    unmaskedVendor: "Google Inc. (NVIDIA)",
    unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.5123)",
    gpuVendor: "nvidia",
    gpuArchitecture: "ada lovelace",
    description: "NVIDIA GeForce RTX 4070 Ti"
  }),
  Object.freeze({
    vendor: "Google Inc. (AMD)",
    renderer: "ANGLE (AMD, AMD Radeon RX 7900 GRE Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.24033.1003)",
    unmaskedVendor: "Google Inc. (AMD)",
    unmaskedRenderer: "ANGLE (AMD, AMD Radeon RX 7900 GRE Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.24033.1003)",
    gpuVendor: "amd",
    gpuArchitecture: "rdna 3",
    description: "AMD Radeon RX 7900 GRE"
  }),
  Object.freeze({
    vendor: "Google Inc. (NVIDIA)",
    renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.5123)",
    unmaskedVendor: "Google Inc. (NVIDIA)",
    unmaskedRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11-31.0.15.5123)",
    gpuVendor: "nvidia",
    gpuArchitecture: "ada lovelace",
    description: "NVIDIA GeForce RTX 4060"
  })
]);

function createDynamicProfile(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (Math.imul(31, hash) + id.charCodeAt(i)) >>> 0;
  }
  const seed = (hashCoord(0xABCD, hash, 1) & 0xFFFF) || 0x4321;
  const gpuIndex = seed % DYNAMIC_GPU_POOL.length;
  const browser = (seed % 2 === 0) ? BROWSER_PROFILES.CHROME_WIN11 : BROWSER_PROFILES.EDGE_WIN11;
  return Object.freeze({
    instanceId: id,
    seed,
    gpu: DYNAMIC_GPU_POOL[gpuIndex],
    browser,
    audio: Object.freeze({ noiseScale: 1e-6 })
  });
}

/**
 * Coordinate PRNG hash engine producing deterministic 32-bit unsigned integers.
 * Based on 32-bit Murmur3 integer finalizer with prime mixers.
 *
 * @param {number} seed Instance seed
 * @param {number} x Coordinate X or index
 * @param {number} y Coordinate Y
 * @param {number} channel Color channel (0: R, 1: G, 2: B) or extra index
 * @returns {number} 32-bit unsigned integer [0, 4294967295]
 */
function hashCoord(seed, x, y, channel = 0) {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(channel, 1274126177)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Normalize arbitrary instance identifier to a standard profile key.
 * Defaults to "A" for empty, invalid, or unrecognized inputs.
 *
 * @param {string|number} value
 * @returns {string}
 */
function normalizeInstanceId(value) {
  const str = String(value || "A").trim().toUpperCase();
  if (INSTANCE_FINGERPRINT_PROFILES[str]) {
    return str;
  }
  // 支持直接传入 account-1, account-2 ... 映射到 A, B, C, D, E ...
  const accountMatch = str.match(/ACCOUNT-(\d+)/i);
  if (accountMatch) {
    const num = parseInt(accountMatch[1], 10);
    const letter = String.fromCharCode(64 + num);
    if (INSTANCE_FINGERPRINT_PROFILES[letter]) {
      return letter;
    }
  }
  const match = str.match(/(?:INSTANCE-|\b)([A-H])\b/i);
  if (match && INSTANCE_FINGERPRINT_PROFILES[match[1].toUpperCase()]) {
    return match[1].toUpperCase();
  }
  return "A";
}

/**
 * Retrieve the frozen fingerprint profile for a given instance.
 * For predefined instances (A-H), returns static immutable profile.
 * For any newly added/custom instance in the future, automatically
 * derives a deterministic, unique seed and physical GPU profile.
 *
 * @param {string|number} instanceId
 * @returns {Readonly<typeof INSTANCE_FINGERPRINT_PROFILES["A"]>}
 */
function getFingerprintProfile(instanceId) {
  const str = String(instanceId || "A").trim().toUpperCase();
  if (INSTANCE_FINGERPRINT_PROFILES[str]) {
    return INSTANCE_FINGERPRINT_PROFILES[str];
  }
  const normalized = normalizeInstanceId(instanceId);
  if (INSTANCE_FINGERPRINT_PROFILES[normalized]) {
    return INSTANCE_FINGERPRINT_PROFILES[normalized];
  }
  return createDynamicProfile(str);
}

const WEBRTC_IP_HANDLING_POLICY = "disable_non_proxied_udp";

module.exports = {
  INSTANCE_FINGERPRINT_PROFILES,
  BROWSER_PROFILES,
  WEBRTC_IP_HANDLING_POLICY,
  getFingerprintProfile,
  normalizeInstanceId,
  hashCoord
};

