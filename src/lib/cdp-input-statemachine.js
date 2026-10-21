'use strict';

/**
 * 4-Stage CDP Input Self-Healing State Machine
 *
 * Implements resilient input & submission into modern web chat composers
 * (ChatGPT, Claude, Lexical, ProseMirror, Slate, Draft.js, React synthetic editors)
 * overcoming OS focus loss, desynchronized EditorState, attachment loss, and typewriter conflicts.
 *
 * Stages:
 * 1. PROBE: Verify active composer exists & is editable; Attachment Guard protects existing attachment chips.
 * 2. INJECT: Inject text via chunked execCommand('insertText') and dispatch native beforeinput & input InputEvents.
 * 3. POLL & VERIFY: Poll send button status across multiple dialects (data-testid, aria-label, submit) until enabled.
 * 4. FALLBACK: If rich text state or send button is unresponsive, dispatch physical rawKeyDown Enter via CDP.
 */

const COMPOSER_SELECTORS = [
  '#prompt-textarea',
  'div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
  'textarea#prompt-textarea',
  'textarea:not([tabindex="-1"])',
  '[data-placeholder]'
];

const ATTACHMENT_SELECTORS = [
  'button[aria-label*="移除文件"]',
  'button[aria-label*="Remove file"]',
  'form img[src^="blob:"]',
  '[data-testid*="attachment"]',
  '.attachment-item',
  '[aria-label*="attachment" i]',
  'button[aria-label*="删除" i]'
];

const STOP_BUTTON_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop"]',
  'button[aria-label*="停止"]'
];

const SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[type="submit"].size-token-button-composer',
  'button[type="submit"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="发送"]',
  'button.composer-submit-btn',
  '[data-testid*="send"]'
];

/**
 * Browser-side function for Stage 1: Probe
 * Can be serialized or executed directly in a browser/JSDOM context.
 */
function probeBrowserContext(composerSelectors, attachmentSelectors, stopSelectors) {
  const cSelectors = composerSelectors || COMPOSER_SELECTORS;
  const aSelectors = attachmentSelectors || ATTACHMENT_SELECTORS;
  const sSelectors = stopSelectors || STOP_BUTTON_SELECTORS;

  // 1. Locate Composer
  let composer = null;
  for (const sel of cSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      // Exclude 0x0 hidden fallback elements if layout metrics are available
      const isHiddenFallback = el.getAttribute && el.getAttribute('tabindex') === '-1' && el.id && el.id.includes('fallback');
      const hasZeroDimensions = (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects && el.getClientRects().length === 0);
      if (!isHiddenFallback && !hasZeroDimensions) {
        composer = el;
        break;
      } else if (!composer) {
        composer = el; // fallback candidate
      }
    }
  }

  if (!composer) {
    return {
      ok: false,
      stage: 'probe',
      reason: 'composer_not_found',
      composerFound: false
    };
  }

  // 2. Check if page is busy generating
  let isBusy = false;
  for (const sel of sSelectors) {
    const stopBtn = document.querySelector(sel);
    if (stopBtn && (!stopBtn.disabled && stopBtn.getAttribute('aria-disabled') !== 'true')) {
      isBusy = true;
      break;
    }
  }

  // 3. Attachment Guard Check
  let hasAttachments = false;
  let attachmentCount = 0;
  for (const sel of aSelectors) {
    const matches = document.querySelectorAll(sel);
    if (matches && matches.length > 0) {
      hasAttachments = true;
      attachmentCount += matches.length;
    }
  }

  // 4. Clean up / Cursor positioning with Attachment Guard
  let cleared = false;
  let guarded = false;
  if (hasAttachments) {
    // Attachment Guard Active: Protect existing attachments! Do NOT selectAll + delete
    guarded = true;
    cleared = false;
    try {
      composer.focus();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(composer);
        range.collapse(false); // Collapse to end
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (_) {}
  } else {
    // No attachments: Safe to clear existing draft text
    guarded = false;
    try {
      composer.focus();
      if (composer.isContentEditable || composer.contentEditable === 'true') {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        cleared = true;
      } else if (typeof composer.value === 'string') {
        composer.value = '';
        composer.dispatchEvent(new Event('input', { bubbles: true }));
        composer.dispatchEvent(new Event('change', { bubbles: true }));
        cleared = true;
      }
    } catch (_) {
      cleared = false;
    }
  }

  const isContentEditable = Boolean(composer.isContentEditable || composer.contentEditable === 'true');
  const isTextarea = composer.tagName ? composer.tagName.toUpperCase() === 'TEXTAREA' : false;

  return {
    ok: true,
    stage: 'probe',
    composerFound: true,
    tagName: composer.tagName ? composer.tagName.toLowerCase() : 'unknown',
    isContentEditable,
    isTextarea,
    isBusy,
    hasAttachments,
    attachmentCount,
    guarded,
    cleared
  };
}

/**
 * Browser-side function for Stage 2: Inject & Synchronize
 */
function injectBrowserContext(textPayload, composerSelectors) {
  const cSelectors = composerSelectors || COMPOSER_SELECTORS;
  let composer = null;
  for (const sel of cSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      composer = el;
      break;
    }
  }

  if (!composer) {
    return { ok: false, stage: 'inject', reason: 'composer_not_found' };
  }

  composer.focus();

  const isContentEditable = Boolean(composer.isContentEditable || composer.contentEditable === 'true');
  const isTextarea = composer.tagName && composer.tagName.toUpperCase() === 'TEXTAREA';

  if (isContentEditable) {
    // Chunked execCommand to avoid OS focus dropout / timeout
    const CHUNK_SIZE = 800;
    for (let i = 0; i < textPayload.length; i += CHUNK_SIZE) {
      const chunk = textPayload.slice(i, i + CHUNK_SIZE);
      document.execCommand('insertText', false, chunk);
    }

    // Force React / Lexical / ProseMirror state reconciliation via native InputEvent
    try {
      const beforeInputEvt = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: textPayload
      });
      composer.dispatchEvent(beforeInputEvt);
    } catch (_) {}

    try {
      const inputEvt = new InputEvent('input', {
        bubbles: true,
        cancelable: false,
        inputType: 'insertText',
        data: textPayload
      });
      composer.dispatchEvent(inputEvt);
    } catch (_) {}

    // Lexical PASTE_COMMAND channel synthesis
    try {
      if (typeof DataTransfer !== 'undefined' && typeof ClipboardEvent !== 'undefined') {
        const dt = new DataTransfer();
        dt.setData('text/plain', textPayload);
        const pasteEvt = new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true
        });
        composer.dispatchEvent(pasteEvt);
      }
    } catch (_) {}

    // Synthetic change & keyup pulses for legacy React synthetic listeners
    try {
      composer.dispatchEvent(new Event('change', { bubbles: true }));
      composer.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
    } catch (_) {}
  } else if (isTextarea || composer.tagName === 'INPUT') {
    // Use prototype setter to bypass React 16+ setter hijacking
    try {
      const proto = isTextarea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(composer, textPayload);
      } else {
        composer.value = textPayload;
      }
    } catch (_) {
      composer.value = textPayload;
    }

    try {
      composer.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: textPayload
      }));
      composer.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: false,
        inputType: 'insertText',
        data: textPayload
      }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
  } else {
    // Fallback generic element
    composer.textContent = textPayload;
    try {
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {}
  }

  const currentLength = ((composer.innerText !== undefined ? composer.innerText : composer.value) || '').length;

  return {
    ok: true,
    stage: 'inject',
    textInjected: true,
    domLength: currentLength,
    expectedLength: textPayload.length
  };
}

/**
 * Browser-side function for Stage 3: Poll & Verify
 */
function verifySendButtonBrowserContext(sendButtonSelectors, composerSelectors, minLength) {
  const sSelectors = sendButtonSelectors || SEND_BUTTON_SELECTORS;
  const cSelectors = composerSelectors || COMPOSER_SELECTORS;

  let composer = null;
  for (const sel of cSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      composer = el;
      break;
    }
  }

  const domLength = composer
    ? ((composer.innerText !== undefined ? composer.innerText : composer.value) || '').length
    : 0;

  let matchedButton = null;
  let matchedSelector = null;

  for (const sel of sSelectors) {
    const btn = document.querySelector(sel);
    if (btn) {
      matchedButton = btn;
      matchedSelector = sel;
      break;
    }
  }

  if (!matchedButton) {
    return {
      ok: false,
      stage: 'poll_verify',
      buttonFound: false,
      buttonEnabled: false,
      domLength,
      requiresFallback: true,
      reason: 'button_not_found'
    };
  }

  const isDisabled = Boolean(
    matchedButton.disabled ||
    matchedButton.getAttribute('aria-disabled') === 'true' ||
    matchedButton.classList.contains('disabled')
  );

  const lengthSatisfied = typeof minLength === 'number' ? domLength >= minLength : domLength > 0;

  if (isDisabled || !lengthSatisfied) {
    return {
      ok: false,
      stage: 'poll_verify',
      buttonFound: true,
      buttonEnabled: !isDisabled,
      domLength,
      matchedSelector,
      requiresFallback: true,
      reason: isDisabled ? 'button_disabled' : 'insufficient_length'
    };
  }

  // Active & ready: Trigger click
  try {
    matchedButton.click();
  } catch (err) {
    return {
      ok: false,
      stage: 'poll_verify',
      buttonFound: true,
      buttonEnabled: true,
      clicked: false,
      error: err.message,
      requiresFallback: true,
      reason: 'click_failed'
    };
  }

  return {
    ok: true,
    stage: 'poll_verify',
    verified: true,
    buttonFound: true,
    buttonEnabled: true,
    clicked: true,
    domLength,
    matchedSelector
  };
}

/**
 * Helper to construct CDP commands for Stage 4: Fallback Physical Enter
 */
function getFallbackEnterCdpCommands() {
  return [
    {
      method: 'Input.dispatchKeyEvent',
      params: {
        type: 'rawKeyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        virtualKeyCode: 13,
        text: '\r',
        unmodifiedText: '\r'
      }
    },
    {
      method: 'Input.dispatchKeyEvent',
      params: {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        virtualKeyCode: 13
      }
    }
  ];
}

/**
 * Script generation helpers to inject into CDP Runtime.evaluate
 */
function generateProbeScript(options = {}) {
  const cSel = JSON.stringify(options.composerSelectors || COMPOSER_SELECTORS);
  const aSel = JSON.stringify(options.attachmentSelectors || ATTACHMENT_SELECTORS);
  const sSel = JSON.stringify(options.stopSelectors || STOP_BUTTON_SELECTORS);
  return `(${probeBrowserContext.toString()})(${cSel}, ${aSel}, ${sSel});`;
}

function generateInjectScript(textPayload, options = {}) {
  const safeText = JSON.stringify(textPayload);
  const cSel = JSON.stringify(options.composerSelectors || COMPOSER_SELECTORS);
  return `(${injectBrowserContext.toString()})(${safeText}, ${cSel});`;
}

function generateVerifyScript(options = {}) {
  const sSel = JSON.stringify(options.sendButtonSelectors || SEND_BUTTON_SELECTORS);
  const cSel = JSON.stringify(options.composerSelectors || COMPOSER_SELECTORS);
  const minLen = typeof options.minLength === 'number' ? options.minLength : 1;
  return `(${verifySendButtonBrowserContext.toString()})(${sSel}, ${cSel}, ${minLen});`;
}

/**
 * 4-Stage State Machine Implementation
 */
class CdpInputStateMachine {
  constructor(cdpClient, options = {}) {
    this.cdp = cdpClient;
    this.options = {
      pollIntervalMs: 150,
      pollTimeoutMs: 2000,
      minPayloadVerificationRatio: 0.5,
      ...options
    };
    this.state = 'IDLE';
    this.history = [];
  }

  _transition(nextState, metadata = {}) {
    this.state = nextState;
    this.history.push({ state: nextState, timestamp: Date.now(), metadata });
  }

  async _evaluate(expression) {
    if (!this.cdp) throw new Error('CDP client not provided');
    if (typeof this.cdp.evaluate === 'function') {
      return this.cdp.evaluate(expression);
    }
    if (typeof this.cdp.send === 'function') {
      const resp = await this.cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      return resp?.result?.value;
    }
    if (typeof this.cdp.send_cmd === 'function') {
      const resp = await this.cdp.send_cmd('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      return resp?.result?.value;
    }
    throw new Error('Unsupported CDP client interface');
  }

  async _dispatchCdpCommand(method, params) {
    if (!this.cdp) throw new Error('CDP client not provided');
    if (typeof this.cdp.send === 'function') {
      return this.cdp.send(method, params);
    }
    if (typeof this.cdp.send_cmd === 'function') {
      return this.cdp.send_cmd(method, params);
    }
    if (typeof this.cdp.dispatch === 'function') {
      return this.cdp.dispatch(method, params);
    }
    throw new Error('Unsupported CDP command interface');
  }

  /**
   * Stage 1: Probe
   */
  async stage1Probe() {
    this._transition('PROBING');
    const script = generateProbeScript(this.options);
    const result = await this._evaluate(script);
    if (!result || !result.ok) {
      this._transition('FAILED', { stage: 1, result });
      return { ok: false, stage: 'probe', error: result?.reason || 'probe_failed', details: result };
    }
    this._transition('PROBED', result);
    return result;
  }

  /**
   * Stage 2: Inject
   */
  async stage2Inject(textPayload) {
    this._transition('INJECTING', { length: textPayload.length });
    const script = generateInjectScript(textPayload, this.options);
    const result = await this._evaluate(script);
    if (!result || !result.ok) {
      this._transition('FAILED', { stage: 2, result });
      return { ok: false, stage: 'inject', error: result?.reason || 'inject_failed', details: result };
    }
    this._transition('INJECTED', result);
    return result;
  }

  /**
   * Stage 3: Poll & Verify
   */
  async stage3PollAndVerify(minExpectedLength = 1) {
    this._transition('POLLING_VERIFY');
    const start = Date.now();
    const script = generateVerifyScript({ ...this.options, minLength: minExpectedLength });

    let lastResult = null;
    while (Date.now() - start < this.options.pollTimeoutMs) {
      lastResult = await this._evaluate(script);
      if (lastResult && lastResult.ok && lastResult.clicked) {
        this._transition('VERIFIED_SUBMITTED', lastResult);
        return lastResult;
      }
      // Wait poll interval
      await new Promise(r => setTimeout(r, this.options.pollIntervalMs));
    }

    this._transition('VERIFY_TIMEOUT', { lastResult });
    return lastResult || {
      ok: false,
      stage: 'poll_verify',
      requiresFallback: true,
      reason: 'timeout_exceeded'
    };
  }

  /**
   * Stage 4: Fallback Physical Enter
   */
  async stage4FallbackPhysicalEnter() {
    this._transition('FALLING_BACK');

    // 1. Refocus composer
    try {
      await this._evaluate(`(() => {
        const c = document.querySelector('#prompt-textarea') || document.querySelector('[role="textbox"]') || document.querySelector('textarea');
        if (c) c.focus();
      })()`);
    } catch (_) {}

    // 2. Dispatch rawKeyDown and keyUp via CDP
    const commands = getFallbackEnterCdpCommands();
    for (const cmd of commands) {
      await this._dispatchCdpCommand(cmd.method, cmd.params);
    }

    const fallbackResult = {
      ok: true,
      stage: 'fallback',
      fallbackExecuted: true,
      method: 'physical_enter_rawKeyDown',
      events: commands.map(c => c.params.type)
    };

    this._transition('FALLBACK_COMPLETED', fallbackResult);
    return fallbackResult;
  }

  /**
   * Execute full 4-stage pipeline
   */
  async execute(textPayload) {
    if (typeof textPayload !== 'string' || textPayload.length === 0) {
      throw new Error('textPayload must be a non-empty string');
    }

    // Stage 1: Probe
    const probeRes = await this.stage1Probe();
    if (!probeRes.ok) {
      return { ok: false, stage: 'probe', error: probeRes.error, history: this.history };
    }
    if (probeRes.isBusy) {
      return { ok: false, stage: 'probe', isBusy: true, error: 'page_is_generating', history: this.history };
    }

    // Stage 2: Inject
    const injectRes = await this.stage2Inject(textPayload);
    if (!injectRes.ok) {
      return { ok: false, stage: 'inject', error: injectRes.error, history: this.history };
    }

    // Stage 3: Poll & Verify
    const minLength = Math.max(1, Math.floor(textPayload.length * this.options.minPayloadVerificationRatio));
    const verifyRes = await this.stage3PollAndVerify(minLength);

    if (verifyRes && verifyRes.ok && verifyRes.clicked) {
      this._transition('COMPLETED', { method: 'button_click' });
      return {
        ok: true,
        submissionMethod: 'button_click',
        probe: probeRes,
        inject: injectRes,
        verify: verifyRes,
        history: this.history
      };
    }

    // Stage 4: Fallback to physical Enter
    const fallbackRes = await this.stage4FallbackPhysicalEnter();
    this._transition('COMPLETED', { method: 'fallback_physical_enter' });

    return {
      ok: true,
      submissionMethod: 'fallback_physical_enter',
      probe: probeRes,
      inject: injectRes,
      verify: verifyRes,
      fallback: fallbackRes,
      history: this.history
    };
  }
}

/**
 * Convenient procedural wrapper
 */
async function executeSelfHealingInput(cdpClient, textPayload, options = {}) {
  const machine = new CdpInputStateMachine(cdpClient, options);
  return machine.execute(textPayload);
}

module.exports = {
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
};
