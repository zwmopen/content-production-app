const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const modulePath = path.join(__dirname, "gpt-runtime-recovery.js");

test("GPT runtime recovery is exposed as an independent controller factory", () => {
  const api = fs.existsSync(modulePath) ? require(modulePath) : {};
  assert.equal(typeof api.createController, "function");
});

test("a paused continuous queue awaits two ready checks before resuming", async () => {
  const { createController } = require(modulePath);
  const events = [];
  let statusCalls = 0;
  const controller = createController({
    getActiveAccountId: () => "account-1",
    getState: () => ({
      queuePaused: true,
      autoRunning: false,
      autoPaused: false,
      continuousMode: true,
      continuousArmed: true,
      retryPending: false,
      windowStopped: false,
      windowPaused: false
    }),
    status: async () => {
      statusCalls += 1;
      events.push(`status-${statusCalls}`);
      return { productionReady: true };
    },
    delay: async () => events.push("delay"),
    setQueuePaused: (value) => events.push(`paused-${value}`),
    resetRetryCount: () => events.push("reset-retry"),
    persistQueue: () => events.push("persist"),
    showBubble: () => events.push("bubble"),
    sendNext: async () => events.push("send-next")
  });

  const resumed = await controller.checkPausedQueue();

  assert.equal(resumed, true);
  assert.equal(statusCalls, 2);
  assert.deepEqual(events, [
    "status-1",
    "delay",
    "status-2",
    "bubble",
    "paused-false",
    "reset-retry",
    "persist",
    "send-next"
  ]);
});

test("late image completion resumes the same uncertain task without opening the queue boundary", async () => {
  const { createController } = require(modulePath);
  const task = {
    requestId: "gpt-current",
    accountId: "account-2",
    _status: "paused",
    _errorCode: "IMAGE_COUNT_UNCERTAIN",
    _submittedToGpt: true,
    expectedImages: 10,
    forceUpload: false,
    workflow: { imageSubmitted: true }
  };
  const events = [];
  let inspections = 0;
  const controller = createController({
    getActiveAccountId: () => "account-1",
    getState: () => ({
      queuePaused: true,
      autoRunning: false,
      autoPaused: false,
      continuousMode: true,
      continuousArmed: true,
      retryPending: false,
      windowStopped: false,
      windowPaused: false,
      currentTask: task
    }),
    inspect: async (accountId) => {
      inspections += 1;
      events.push(`inspect-${accountId}-${inspections}`);
      return {
        stage: "images-ready",
        generating: false,
        latestImageCount: 10,
        expectedImageCount: 10,
        patrolState: { key: "awaiting-copy" },
        safeToAct: true
      };
    },
    delay: async () => events.push("delay"),
    resumeImageUncertainty: async (context) => {
      events.push(`resume-${context.accountId}-${context.task.requestId}`);
    }
  });

  const resumed = await controller.checkPausedQueue();

  assert.equal(resumed, true);
  assert.equal(inspections, 2);
  assert.deepEqual(events, [
    "inspect-account-2-1",
    "delay",
    "inspect-account-2-2",
    "resume-account-2-gpt-current"
  ]);
  assert.equal(task.requestId, "gpt-current");
  assert.equal(task.forceUpload, false);
  assert.equal(task.workflow.imageSubmitted, true);
});

test("a restart-interrupted image checkpoint resumes only after two matching page inspections", async () => {
  const { createController } = require(modulePath);
  const task = {
    requestId: "gpt-restarted",
    accountId: "account-2",
    _status: "paused",
    _stage: "等待图片",
    _percent: 48,
    _errorCode: "RESTART_INTERRUPTED",
    _submittedToGpt: true,
    expectedImages: 8
  };
  const events = [];
  let inspections = 0;
  const controller = createController({
    getState: () => ({
      queuePaused: true,
      autoRunning: false,
      autoPaused: false,
      continuousMode: true,
      continuousArmed: false,
      retryPending: false,
      windowStopped: false,
      windowPaused: false,
      currentTask: task
    }),
    inspect: async (accountId) => {
      inspections += 1;
      events.push(`inspect-${accountId}-${inspections}`);
      return {
        stage: "images-ready",
        generating: false,
        responseInFlight: false,
        latestImageCount: 8,
        expectedImageCount: 8,
        patrolState: { key: "awaiting-copy" },
        safeToAct: true
      };
    },
    delay: async () => events.push("delay"),
    resumeRestartCheckpoint: async (context) => {
      events.push(`resume-${context.accountId}-${context.task.requestId}`);
    }
  });

  assert.equal(await controller.checkPausedQueue(), true);
  assert.deepEqual(events, [
    "inspect-account-2-1",
    "delay",
    "inspect-account-2-2",
    "resume-account-2-gpt-restarted"
  ]);
});

test("restart recovery uses the task image plan instead of counting the TXT attachment as an image", async () => {
  const { createController } = require(modulePath);
  const controller = createController();
  assert.equal(controller.isImageCompletionReady({
    expectedImages: 8,
    attachments: Array.from({ length: 9 }, (_, index) => index === 8 ? "文案.txt" : `${index + 1}.jpg`)
  }, {
    stage: "images-ready",
    generating: false,
    responseInFlight: false,
    latestImageCount: 8,
    expectedImageCount: 9,
    patrolState: { key: "partial-images" },
    safeToAct: true
  }), true);
});

test("a restart-interrupted checkpoint stays paused when the page still reports generation", async () => {
  const { createController } = require(modulePath);
  let resumed = false;
  const controller = createController({
    getState: () => ({
      queuePaused: true,
      autoRunning: false,
      autoPaused: false,
      continuousMode: true,
      continuousArmed: false,
      retryPending: false,
      windowStopped: false,
      windowPaused: false,
      currentTask: {
        requestId: "gpt-restarted",
        accountId: "account-2",
        _stage: "等待图片",
        _errorCode: "RESTART_INTERRUPTED",
        _submittedToGpt: true,
        expectedImages: 8
      }
    }),
    inspect: async () => ({
      stage: "generating-images",
      generating: true,
      responseInFlight: true,
      latestImageCount: 3,
      expectedImageCount: 8
    }),
    resumeRestartCheckpoint: async () => { resumed = true; }
  });

  assert.equal(await controller.checkPausedQueue(), false);
  assert.equal(resumed, false);
});

test("image uncertainty stays paused while GPT is still generating", async () => {
  const { createController } = require(modulePath);
  let resumed = false;
  const controller = createController({
    getState: () => ({
      queuePaused: true,
      autoRunning: false,
      autoPaused: false,
      continuousMode: true,
      continuousArmed: true,
      retryPending: false,
      windowStopped: false,
      windowPaused: false,
      currentTask: {
        requestId: "gpt-current",
        accountId: "account-2",
        _status: "paused",
        _errorCode: "IMAGE_COUNT_UNCERTAIN",
        _submittedToGpt: true,
        expectedImages: 10
      }
    }),
    inspect: async () => ({
      stage: "generating-images",
      generating: true,
      latestImageCount: 3,
      expectedImageCount: 10
    }),
    resumeImageUncertainty: async () => { resumed = true; }
  });

  assert.equal(await controller.checkPausedQueue(), false);
  assert.equal(resumed, false);
});

test("non-image integrity boundaries never auto-resume", async () => {
  const { createController } = require(modulePath);
  let inspected = false;
  const controller = createController({
    getState: () => ({
      queuePaused: true,
      autoRunning: false,
      autoPaused: false,
      continuousMode: true,
      continuousArmed: true,
      retryPending: false,
      windowStopped: false,
      windowPaused: false,
      currentTask: {
        requestId: "gpt-current",
        accountId: "account-2",
        _status: "paused",
        _errorCode: "COMPOSER_ATTACHMENT_CONFLICT",
        _submittedToGpt: true
      }
    }),
    inspect: async () => { inspected = true; },
    status: async () => ({ productionReady: true }),
    delay: async () => {}
  });

  assert.equal(await controller.checkPausedQueue(), false);
  assert.equal(inspected, false);
});

test("image uncertainty recovery is bounded per task", async () => {
  const { createController } = require(modulePath);
  let inspected = false;
  const controller = createController({
    getState: () => ({
      queuePaused: true,
      autoRunning: false,
      autoPaused: false,
      continuousMode: true,
      continuousArmed: true,
      retryPending: false,
      windowStopped: false,
      windowPaused: false,
      currentTask: {
        requestId: "gpt-current",
        accountId: "account-2",
        _errorCode: "IMAGE_COUNT_UNCERTAIN",
        _submittedToGpt: true,
        _imageUncertainRecoveryCount: 3,
        expectedImages: 10
      }
    }),
    inspect: async () => { inspected = true; }
  });

  assert.equal(await controller.checkPausedQueue(), false);
  assert.equal(inspected, false);
});
