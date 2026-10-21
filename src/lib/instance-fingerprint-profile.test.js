const test = require("node:test");
const assert = require("node:assert/strict");
const {
  INSTANCE_FINGERPRINT_PROFILES,
  WEBRTC_IP_HANDLING_POLICY,
  getFingerprintProfile,
  normalizeInstanceId,
  hashCoord
} = require("./instance-fingerprint-profile");

test("instance fingerprint profiles are defined for instances A, B, C, D with required seeds", () => {
  assert.equal(INSTANCE_FINGERPRINT_PROFILES.A.seed, 0x9A4F);
  assert.equal(INSTANCE_FINGERPRINT_PROFILES.B.seed, 0x3C8E);
  assert.equal(INSTANCE_FINGERPRINT_PROFILES.C.seed, 0x7B21);
  assert.equal(INSTANCE_FINGERPRINT_PROFILES.D.seed, 0x5E6A);

  // All seeds must be unique
  const seeds = [
    INSTANCE_FINGERPRINT_PROFILES.A.seed,
    INSTANCE_FINGERPRINT_PROFILES.B.seed,
    INSTANCE_FINGERPRINT_PROFILES.C.seed,
    INSTANCE_FINGERPRINT_PROFILES.D.seed
  ];
  assert.equal(new Set(seeds).size, 4);
});

test("instance profiles contain designated physical GPU hardware profiles without virtual drivers", () => {
  const profileA = INSTANCE_FINGERPRINT_PROFILES.A;
  const profileB = INSTANCE_FINGERPRINT_PROFILES.B;
  const profileC = INSTANCE_FINGERPRINT_PROFILES.C;
  const profileD = INSTANCE_FINGERPRINT_PROFILES.D;

  assert.match(profileA.gpu.renderer, /RTX 4070/i);
  assert.match(profileA.gpu.vendor, /NVIDIA/i);
  assert.doesNotMatch(profileA.gpu.renderer, /Microsoft Basic Render/i);

  assert.match(profileB.gpu.renderer, /RX 7800 XT/i);
  assert.match(profileB.gpu.vendor, /AMD/i);
  assert.doesNotMatch(profileB.gpu.renderer, /Microsoft Basic Render/i);

  assert.match(profileC.gpu.renderer, /RTX 4080/i);
  assert.match(profileC.gpu.vendor, /NVIDIA/i);

  assert.match(profileD.gpu.renderer, /Arc.*A770/i);
  assert.match(profileD.gpu.vendor, /Intel/i);
});

test("normalizeInstanceId handles case-insensitive, prefixed, and fallback cases", () => {
  assert.equal(normalizeInstanceId("A"), "A");
  assert.equal(normalizeInstanceId("b"), "B");
  assert.equal(normalizeInstanceId("instance-c"), "C");
  assert.equal(normalizeInstanceId("INSTANCE-D"), "D");
  assert.equal(normalizeInstanceId("UNKNOWN"), "A");
  assert.equal(normalizeInstanceId(""), "A");
  assert.equal(normalizeInstanceId(null), "A");
});

test("getFingerprintProfile returns frozen profile with immutable properties", () => {
  const profile = getFingerprintProfile("B");
  assert.equal(profile.instanceId, "B");
  assert.equal(profile.seed, 0x3C8E);
  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(profile.gpu));
});

test("hashCoord produces 100% deterministic output for identical inputs", () => {
  const seed = 0x9A4F;
  const val1 = hashCoord(seed, 100, 200, 1);
  const val2 = hashCoord(seed, 100, 200, 1);
  assert.equal(val1, val2);
  assert.equal(typeof val1, "number");
  assert.ok(val1 >= 0 && val1 <= 0xFFFFFFFF);
});

test("hashCoord produces divergent outputs across different instance seeds for the same coordinate", () => {
  const coordX = 42;
  const coordY = 88;
  const channel = 0;

  const hashA = hashCoord(INSTANCE_FINGERPRINT_PROFILES.A.seed, coordX, coordY, channel);
  const hashB = hashCoord(INSTANCE_FINGERPRINT_PROFILES.B.seed, coordX, coordY, channel);
  const hashC = hashCoord(INSTANCE_FINGERPRINT_PROFILES.C.seed, coordX, coordY, channel);
  const hashD = hashCoord(INSTANCE_FINGERPRINT_PROFILES.D.seed, coordX, coordY, channel);

  const hashes = new Set([hashA, hashB, hashC, hashD]);
  assert.equal(hashes.size, 4, "All 4 instances must produce distinct coordinate hashes");
});

test("micro-noise perturbation formula strictly constrains delta to {-1, 0, +1}", () => {
  const seed = 0x9A4F;
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      for (let c = 0; c < 3; c++) {
        const delta = (hashCoord(seed, x, y, c) % 3) - 1;
        assert.ok(delta === -1 || delta === 0 || delta === 1, `Delta ${delta} out of bounds`);
      }
    }
  }
});

test("WEBRTC_IP_HANDLING_POLICY constant matches chromium flag", () => {
  assert.equal(WEBRTC_IP_HANDLING_POLICY, "disable_non_proxied_udp");
});

test("electron-network-proxy defines default proxy 7890 with dynamic probe fallbacks", () => {
  const {
    DEFAULT_ELECTRON_PROXY,
    LOCAL_PROXY_FALLBACK_PORTS,
    resolveElectronProxy
  } = require("./electron-network-proxy");

  assert.equal(DEFAULT_ELECTRON_PROXY, "http://127.0.0.1:7890");
  assert.equal(LOCAL_PROXY_FALLBACK_PORTS[0], 7890);
  assert.ok(LOCAL_PROXY_FALLBACK_PORTS.includes(7897));
  assert.ok(LOCAL_PROXY_FALLBACK_PORTS.includes(17897));

  const resolved = resolveElectronProxy();
  assert.equal(resolved.enabled, true);
  assert.match(resolved.proxyServer, /http:\/\/127\.0\.0\.1:(?:7890|7897|17897)/);
});

test("BROWSER_PROFILES defines Google Chrome and Microsoft Edge without Electron or app traces", () => {
  const { BROWSER_PROFILES } = require("./instance-fingerprint-profile");
  assert.ok(BROWSER_PROFILES.CHROME_WIN11);
  assert.ok(BROWSER_PROFILES.EDGE_WIN11);

  assert.equal(BROWSER_PROFILES.CHROME_WIN11.type, "chrome");
  assert.doesNotMatch(BROWSER_PROFILES.CHROME_WIN11.userAgent, /Electron/i);
  assert.doesNotMatch(BROWSER_PROFILES.CHROME_WIN11.userAgent, /Teambuilding/i);
  assert.match(BROWSER_PROFILES.CHROME_WIN11.userAgent, /Chrome\/130/);
  assert.doesNotMatch(BROWSER_PROFILES.CHROME_WIN11.userAgent, /Edg\//);

  assert.equal(BROWSER_PROFILES.EDGE_WIN11.type, "edge");
  assert.doesNotMatch(BROWSER_PROFILES.EDGE_WIN11.userAgent, /Electron/i);
  assert.doesNotMatch(BROWSER_PROFILES.EDGE_WIN11.userAgent, /Teambuilding/i);
  assert.match(BROWSER_PROFILES.EDGE_WIN11.userAgent, /Edg\/130/);
});

test("Instance A is Google Chrome and Instance B is Microsoft Edge (Edge vs Chrome differentiation)", () => {
  const profileA = getFingerprintProfile("A");
  const profileB = getFingerprintProfile("B");

  assert.equal(profileA.browser.type, "chrome");
  assert.equal(profileA.browser.name, "Google Chrome");
  assert.ok(profileA.browser.brands.some((b) => b.brand === "Google Chrome"));
  assert.ok(!profileA.browser.brands.some((b) => b.brand === "Microsoft Edge"));

  assert.equal(profileB.browser.type, "edge");
  assert.equal(profileB.browser.name, "Microsoft Edge");
  assert.ok(profileB.browser.brands.some((b) => b.brand === "Microsoft Edge"));
  assert.ok(!profileB.browser.brands.some((b) => b.brand === "Google Chrome"));
});

test("dynamic profiles derive valid browser identities alternating Chrome and Edge", () => {
  const profileX = getFingerprintProfile("account-99");
  const profileY = getFingerprintProfile("account-100");

  assert.ok(profileX.browser);
  assert.ok(profileY.browser);
  assert.ok(["chrome", "edge"].includes(profileX.browser.type));
  assert.ok(["chrome", "edge"].includes(profileY.browser.type));
});

