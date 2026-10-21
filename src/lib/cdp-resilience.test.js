'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { execSync } = require('node:child_process');

const {
  COMPOSER_SELECTORS,
  ATTACHMENT_SELECTORS,
  STOP_BUTTON_SELECTORS,
  SEND_BUTTON_SELECTORS,
  probeBrowserContext,
  injectBrowserContext,
  verifySendButtonBrowserContext,
  getFallbackEnterCdpCommands,
  generateProbeScript,
  generateInjectScript,
  generateVerifyScript,
  CdpInputStateMachine,
  executeSelfHealingInput
} = require('./cdp-input-statemachine');

const INSTANCES_ROOT = path.resolve(__dirname, '../../../../content-production-app-instances');
const INSTANCE_IDS = ['A', 'B', 'C', 'D'];

// =========================================================================
// Suite 1: Pre-Launch Surgical Cleanup & Launch Script Resilience
// =========================================================================

test('Instance launch.bat files (A, B, C, D) contain surgical netstat killer and lockfile purge', () => {
  for (const id of INSTANCE_IDS) {
    const batPath = path.join(INSTANCES_ROOT, id, 'launch.bat');
    assert.ok(fs.existsSync(batPath), `launch.bat for instance ${id} must exist`);

    const content = fs.readFileSync(batPath, 'utf8');

    // 1. Surgical port killing via netstat and taskkill /F /T /PID
    assert.match(content, /netstat -ano \^\| findstr :%TB_REMOTE_DEBUGGING_PORT%/i, `${id} must inspect remote debugging port`);
    assert.match(content, /netstat -ano \^\| findstr :%PORT%/i, `${id} must inspect web port`);
    assert.match(content, /taskkill \/F \/T \/PID/i, `${id} must kill process tree with /F /T /PID`);

    // 2. Singleton lockfiles purge
    assert.match(content, /del \/f \/q ["']?%TB_USER_DATA_ROOT%\\SingletonLock["']?/i, `${id} must purge SingletonLock`);
    assert.match(content, /del \/f \/q ["']?%TB_USER_DATA_ROOT%\\SingletonSocket["']?/i, `${id} must purge SingletonSocket`);
    assert.match(content, /del \/f \/q ["']?%TB_USER_DATA_ROOT%\\SingletonCookie["']?/i, `${id} must purge SingletonCookie`);

    // 3. WebRTC UDP leak shielding flag
    assert.match(content, /--force-webrtc-ip-handling-policy=disable_non_proxied_udp/, `${id} must include WebRTC UDP leak switch`);

    // 4. Clash proxy default
    assert.match(content, /http:\/\/127\.0\.0\.1:7890/, `${id} must default to Clash proxy 7890`);
    assert.match(content, /--proxy-server=/, `${id} must pass proxy-server argument to Electron`);
  }
});

test('Real file system test: Singleton lockfiles are purged correctly by purge logic', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-lockfile-test-'));
  const lock = path.join(tmpDir, 'SingletonLock');
  const socket = path.join(tmpDir, 'SingletonSocket');
  const cookie = path.join(tmpDir, 'SingletonCookie');

  // Create mock lockfiles
  fs.writeFileSync(lock, 'dummy lock content');
  fs.writeFileSync(socket, 'dummy socket content');
  fs.writeFileSync(cookie, 'dummy cookie content');

  assert.equal(fs.existsSync(lock), true);
  assert.equal(fs.existsSync(socket), true);
  assert.equal(fs.existsSync(cookie), true);

  // Execute batch purge logic
  const purgeCmd = `cmd.exe /c "if exist "${lock}" del /f /q "${lock}" & if exist "${socket}" del /f /q "${socket}" & if exist "${cookie}" del /f /q "${cookie}""`;
  execSync(purgeCmd);

  assert.equal(fs.existsSync(lock), false, 'SingletonLock must be purged');
  assert.equal(fs.existsSync(socket), false, 'SingletonSocket must be purged');
  assert.equal(fs.existsSync(cookie), false, 'SingletonCookie must be purged');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Real port check: netstat detection locates active listening PID', async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const assignedPort = server.address().port;

  try {
    const output = execSync(`cmd.exe /c "netstat -ano | findstr :${assignedPort} | findstr /I LISTENING"`, {
      encoding: 'utf8'
    });
    assert.ok(output.includes(String(process.pid)), `netstat output should find process PID ${process.pid}`);
  } finally {
    server.close();
  }
});

// =========================================================================
// Suite 2: CDP Gateway Port Decoupling
// =========================================================================

test('cdp-gateway.js defaults to port 9449, preventing collision with Instance C (9433)', () => {
  const gatewayPath = path.resolve(__dirname, 'cdp-gateway.js');
  const content = fs.readFileSync(gatewayPath, 'utf8');

  // Must default to 9449
  assert.match(content, /CDP_GATEWAY_PORT\s*\|\|\s*9449/, 'GATEWAY_PORT default must be 9449');
  assert.doesNotMatch(content, /CDP_GATEWAY_PORT\s*\|\|\s*9433/, 'GATEWAY_PORT must NOT default to 9433 (Instance C CDP port)');
});

// =========================================================================
// Suite 3: 4-Stage CDP Input Self-Healing State Machine Unit Tests
// =========================================================================

// Lightweight DOM Environment Mock for in-process testing
function createMockDomEnvironment() {
  const elements = new Map();
  let currentSelectionRange = null;

  class MockElement {
    constructor(tagName, id = '', className = '') {
      this.tagName = tagName.toUpperCase();
      this.id = id;
      this.className = className;
      this.attributes = new Map();
      this.classList = {
        contains: (cls) => (this.className || '').split(/\s+/).includes(cls)
      };
      this.style = {};
      this.value = '';
      this.innerText = '';
      this.contentEditable = 'false';
      this.isContentEditable = false;
      this.disabled = false;
      this.children = [];
      this.lastChild = null;
      this.offsetWidth = 100;
      this.offsetHeight = 30;
      this.listeners = new Map();
      this.clicked = false;
    }

    getAttribute(name) {
      return this.attributes.get(name) || null;
    }

    setAttribute(name, val) {
      this.attributes.set(name, String(val));
    }

    addEventListener(event, cb) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(cb);
    }

    dispatchEvent(event) {
      const cbs = this.listeners.get(event.type) || [];
      for (const cb of cbs) cb(event);
      return true;
    }

    focus() {
      this.isFocused = true;
    }

    click() {
      if (this.disabled || this.getAttribute('aria-disabled') === 'true') {
        throw new Error('Element is disabled');
      }
      this.clicked = true;
      this.dispatchEvent({ type: 'click' });
    }

    getClientRects() {
      return [{ width: this.offsetWidth, height: this.offsetHeight }];
    }
  }

  const documentMock = {
    querySelector: (selector) => {
      for (const el of elements.values()) {
        if (matchesSelector(el, selector)) return el;
      }
      return null;
    },
    querySelectorAll: (selector) => {
      const list = [];
      for (const el of elements.values()) {
        if (matchesSelector(el, selector)) list.push(el);
      }
      return list;
    },
    execCommand: (command, showUI, value) => {
      const focused = Array.from(elements.values()).find(e => e.isFocused);
      if (!focused) return false;
      if (command === 'insertText') {
        focused.innerText = (focused.innerText || '') + value;
        return true;
      }
      if (command === 'selectAll') {
        return true;
      }
      if (command === 'delete') {
        focused.innerText = '';
        return true;
      }
      return false;
    },
    createRange: () => ({
      selectNodeContents: (node) => { currentSelectionRange = { node, collapsed: false }; },
      collapse: (toStart) => { if (currentSelectionRange) currentSelectionRange.collapsed = true; }
    })
  };

  const windowMock = {
    getSelection: () => ({
      removeAllRanges: () => { currentSelectionRange = null; },
      addRange: (r) => { currentSelectionRange = r; }
    }),
    HTMLTextAreaElement: {
      prototype: {
        value: ''
      }
    },
    HTMLInputElement: {
      prototype: {
        value: ''
      }
    }
  };

  function matchesSelector(el, sel) {
    if (sel.startsWith('#')) return el.id === sel.slice(1);
    if (sel.startsWith('.')) return el.classList.contains(sel.slice(1));
    if (sel.includes('[data-testid="')) {
      const match = sel.match(/\[data-testid="([^"]+)"\]/);
      if (match && el.getAttribute('data-testid') === match[1]) return true;
    }
    if (sel.includes('[aria-label*="')) {
      const match = sel.match(/\[aria-label\*="([^"]+)"\]/);
      const label = el.getAttribute('aria-label') || '';
      if (match && label.includes(match[1])) return true;
    }
    if (sel.includes('[type="submit"]')) {
      if (el.tagName === 'BUTTON' && el.getAttribute('type') === 'submit') return true;
    }
    if (sel.includes('img[src^="blob:"]')) {
      if (el.tagName === 'IMG' && (el.getAttribute('src') || '').startsWith('blob:')) return true;
    }
    if (sel.includes('div[contenteditable="true"]')) {
      if (el.tagName === 'DIV' && (el.contentEditable === 'true' || el.isContentEditable)) return true;
    }
    if (sel.includes('textarea')) {
      if (el.tagName === 'TEXTAREA') return true;
    }
    if (sel.includes('.attachment-item')) {
      if (el.classList.contains('attachment-item')) return true;
    }
    return false;
  }

  function addElement(tag, id = '', className = '') {
    const el = new MockElement(tag, id, className);
    elements.set(`${tag}-${id}-${Math.random()}`, el);
    return el;
  }

  return {
    document: documentMock,
    window: windowMock,
    addElement,
    elements
  };
}

test('Stage 1: Probe discovers active composer, respects stop button, and engages Attachment Guard', () => {
  const env = createMockDomEnvironment();
  const originalDoc = global.document;
  const originalWin = global.window;
  global.document = env.document;
  global.window = env.window;

  try {
    // 1. Initially no composer
    const emptyProbe = probeBrowserContext();
    assert.equal(emptyProbe.ok, false);
    assert.equal(emptyProbe.reason, 'composer_not_found');

    // 2. Add contenteditable composer
    const composer = env.addElement('div', 'prompt-textarea');
    composer.contentEditable = 'true';
    composer.isContentEditable = true;
    composer.innerText = 'previous draft text';

    // Probe with no attachments
    const probeWithoutAttachments = probeBrowserContext();
    assert.equal(probeWithoutAttachments.ok, true);
    assert.equal(probeWithoutAttachments.composerFound, true);
    assert.equal(probeWithoutAttachments.hasAttachments, false);
    assert.equal(probeWithoutAttachments.guarded, false);
    assert.equal(probeWithoutAttachments.cleared, true);
    assert.equal(composer.innerText, '', 'Old draft should be cleared when no attachments exist');

    // 3. Add an attachment chip (e.g. image chip)
    composer.innerText = 'draft with attachment';
    const attachmentChip = env.addElement('button', '', '');
    attachmentChip.setAttribute('aria-label', '移除文件 image1.png');

    const probeWithAttachments = probeBrowserContext();
    assert.equal(probeWithAttachments.ok, true);
    assert.equal(probeWithAttachments.hasAttachments, true);
    assert.equal(probeWithAttachments.guarded, true);
    assert.equal(probeWithAttachments.cleared, false);
    assert.equal(composer.innerText, 'draft with attachment', 'Attachment guard must PRESERVE content');

    // 4. Test busy state when stop button is present
    const stopBtn = env.addElement('button', '', '');
    stopBtn.setAttribute('data-testid', 'stop-button');
    const probeBusy = probeBrowserContext();
    assert.equal(probeBusy.isBusy, true);
  } finally {
    global.document = originalDoc;
    global.window = originalWin;
  }
});

test('Stage 2: Inject writes text and dispatches native InputEvents to force React/Lexical sync', () => {
  const env = createMockDomEnvironment();
  const originalDoc = global.document;
  const originalWin = global.window;
  const originalInputEvent = global.InputEvent;
  const originalEvent = global.Event;
  const originalKeyboardEvent = global.KeyboardEvent;

  class MockInputEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.inputType = init.inputType;
      this.data = init.data;
      this.bubbles = init.bubbles;
    }
  }
  class MockEvent { constructor(type) { this.type = type; } }
  class MockKeyboardEvent { constructor(type, init = {}) { this.type = type; this.key = init.key; } }

  global.document = env.document;
  global.window = env.window;
  global.InputEvent = MockInputEvent;
  global.Event = MockEvent;
  global.KeyboardEvent = MockKeyboardEvent;

  try {
    const composer = env.addElement('div', 'prompt-textarea');
    composer.contentEditable = 'true';
    composer.isContentEditable = true;

    const dispatchedEvents = [];
    composer.addEventListener('beforeinput', (e) => dispatchedEvents.push(e));
    composer.addEventListener('input', (e) => dispatchedEvents.push(e));
    composer.addEventListener('change', (e) => dispatchedEvents.push(e));

    const testText = 'Hello Teamwork Claude/ChatGPT Autonomous Agent';
    const injectResult = injectBrowserContext(testText);

    assert.equal(injectResult.ok, true);
    assert.equal(injectResult.textInjected, true);
    assert.equal(composer.innerText, testText);

    // Verify native input events dispatched
    const beforeInput = dispatchedEvents.find(e => e.type === 'beforeinput');
    const input = dispatchedEvents.find(e => e.type === 'input');
    assert.ok(beforeInput, 'Must dispatch beforeinput');
    assert.equal(beforeInput.inputType, 'insertText');
    assert.equal(beforeInput.data, testText);
    assert.ok(input, 'Must dispatch input');
    assert.equal(input.inputType, 'insertText');
    assert.equal(input.data, testText);
  } finally {
    global.document = originalDoc;
    global.window = originalWin;
    global.InputEvent = originalInputEvent;
    global.Event = originalEvent;
    global.KeyboardEvent = originalKeyboardEvent;
  }
});

test('Stage 3: Poll & Verify detects dialects and enforces active button state', () => {
  const env = createMockDomEnvironment();
  const originalDoc = global.document;
  const originalWin = global.window;
  global.document = env.document;
  global.window = env.window;

  try {
    const composer = env.addElement('div', 'prompt-textarea');
    composer.innerText = 'Generated Prompt Content';

    // Dialect 1: data-testid="send-button"
    const sendBtn = env.addElement('button', '', '');
    sendBtn.setAttribute('data-testid', 'send-button');

    // Case A: Button disabled
    sendBtn.disabled = true;
    const disabledVerify = verifySendButtonBrowserContext();
    assert.equal(disabledVerify.ok, false);
    assert.equal(disabledVerify.requiresFallback, true);
    assert.equal(disabledVerify.reason, 'button_disabled');

    // Case B: Button enabled -> Trigger click
    sendBtn.disabled = false;
    const enabledVerify = verifySendButtonBrowserContext();
    assert.equal(enabledVerify.ok, true);
    assert.equal(enabledVerify.clicked, true);
    assert.equal(sendBtn.clicked, true);

    // Case C: Test aria-label dialect
    sendBtn.setAttribute('data-testid', 'other-id');
    sendBtn.setAttribute('aria-label', '发送消息 (Ctrl+Enter)');
    sendBtn.clicked = false;
    const dialectVerify = verifySendButtonBrowserContext();
    assert.equal(dialectVerify.ok, true);
    assert.equal(dialectVerify.clicked, true);
    assert.equal(sendBtn.clicked, true);
  } finally {
    global.document = originalDoc;
    global.window = originalWin;
  }
});

test('Stage 4: Fallback physical Enter produces hardware-level rawKeyDown CDP commands', () => {
  const commands = getFallbackEnterCdpCommands();
  assert.equal(commands.length, 2);

  const [rawKeyDown, keyUp] = commands;
  assert.equal(rawKeyDown.method, 'Input.dispatchKeyEvent');
  assert.equal(rawKeyDown.params.type, 'rawKeyDown');
  assert.equal(rawKeyDown.params.key, 'Enter');
  assert.equal(rawKeyDown.params.code, 'Enter');
  assert.equal(rawKeyDown.params.windowsVirtualKeyCode, 13);
  assert.equal(rawKeyDown.params.virtualKeyCode, 13);
  assert.equal(rawKeyDown.params.text, '\r');

  assert.equal(keyUp.method, 'Input.dispatchKeyEvent');
  assert.equal(keyUp.params.type, 'keyUp');
  assert.equal(keyUp.params.windowsVirtualKeyCode, 13);
});

// =========================================================================
// Suite 4: End-to-End State Machine Execution Tests
// =========================================================================

test('CdpInputStateMachine: Full normal flow (Stage 1 -> 2 -> 3 Button Click)', async () => {
  const sentCdpCommands = [];
  const mockCdp = {
    async send(method, params) {
      sentCdpCommands.push({ method, params });
      if (method === 'Runtime.evaluate') {
        const expr = params.expression;
        if (expr.includes('probeBrowserContext')) {
          return { result: { value: { ok: true, composerFound: true, isBusy: false, hasAttachments: false } } };
        }
        if (expr.includes('injectBrowserContext')) {
          return { result: { value: { ok: true, textInjected: true, domLength: 45 } } };
        }
        if (expr.includes('verifySendButtonBrowserContext')) {
          return { result: { value: { ok: true, clicked: true, verified: true } } };
        }
      }
      return { result: {} };
    }
  };

  const result = await executeSelfHealingInput(mockCdp, 'Create a luxury team building itinerary in Hangzhou', {
    pollTimeoutMs: 500,
    pollIntervalMs: 50
  });

  assert.equal(result.ok, true);
  assert.equal(result.submissionMethod, 'button_click');
  assert.equal(result.probe.ok, true);
  assert.equal(result.inject.ok, true);
  assert.equal(result.verify.clicked, true);
  assert.equal(result.history.some(h => h.state === 'VERIFIED_SUBMITTED'), true);
});

test('CdpInputStateMachine: Fallback flow (Stage 1 -> 2 -> 3 Timeout -> Stage 4 Physical Enter)', async () => {
  const sentCdpCommands = [];
  const mockCdp = {
    async send(method, params) {
      sentCdpCommands.push({ method, params });
      if (method === 'Runtime.evaluate') {
        const expr = params.expression;
        if (expr.includes('probeBrowserContext')) {
          return { result: { value: { ok: true, composerFound: true, isBusy: false, hasAttachments: false } } };
        }
        if (expr.includes('injectBrowserContext')) {
          return { result: { value: { ok: true, textInjected: true, domLength: 30 } } };
        }
        if (expr.includes('verifySendButtonBrowserContext')) {
          // Simulate Lexical editor state unresponsive (button remains disabled)
          return { result: { value: { ok: false, requiresFallback: true, reason: 'button_disabled' } } };
        }
      }
      return { result: {} };
    }
  };

  const result = await executeSelfHealingInput(mockCdp, 'Special itinerary fallback test', {
    pollTimeoutMs: 100,
    pollIntervalMs: 30
  });

  assert.equal(result.ok, true);
  assert.equal(result.submissionMethod, 'fallback_physical_enter');
  assert.equal(result.fallback.ok, true);
  assert.equal(result.fallback.method, 'physical_enter_rawKeyDown');

  // Verify that hardware rawKeyDown was dispatched via CDP
  const keyEvents = sentCdpCommands.filter(c => c.method === 'Input.dispatchKeyEvent');
  assert.equal(keyEvents.length, 2);
  assert.equal(keyEvents[0].params.type, 'rawKeyDown');
  assert.equal(keyEvents[0].params.windowsVirtualKeyCode, 13);
  assert.equal(keyEvents[1].params.type, 'keyUp');
});

test('CdpInputStateMachine: Busy guard aborts immediately if stop button is present', async () => {
  const mockCdp = {
    async send(method, params) {
      if (method === 'Runtime.evaluate') {
        return { result: { value: { ok: true, composerFound: true, isBusy: true } } };
      }
      return { result: {} };
    }
  };

  const result = await executeSelfHealingInput(mockCdp, 'Test while generating');
  assert.equal(result.ok, false);
  assert.equal(result.isBusy, true);
  assert.equal(result.error, 'page_is_generating');
});
