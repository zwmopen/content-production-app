/**
 * 工作流测试数据注入脚本 — v0.14.52
 *
 * 使用方法：
 * 1. 在团建工作台应用中按 F12 打开 DevTools
 * 2. 切到 Console 标签
 * 3. 复制本文件全部内容粘贴到 Console 中回车执行
 * 4. 刷新页面，测试配置将出现在设置面板的「模式切换」中
 *
 * 注意：此脚本会覆盖 localStorage 中的工作流模式配置，
 *       执行前请先备份（脚本会自动备份到 _backup 键）。
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'teambuilding-gpt-mode-profiles-v1';
  const BACKUP_KEY = STORAGE_KEY + '_backup_' + Date.now();

  // ── 备份当前配置 ──
  const current = localStorage.getItem(STORAGE_KEY);
  if (current) {
    localStorage.setItem(BACKUP_KEY, current);
    console.log(`[测试注入] 已备份当前配置到: ${BACKUP_KEY}`);
  }

  // ── 5 套测试配置 ──
  const testProfiles = {
    // 1. 分离归档模式
    "test-separated": {
      name: "分离归档（测试）",
      useCurrentSession: true,
      confirmText: "1",
      copyPrompt: "给我一份小红书文案",
      steps: [
        { action: "upload-material", text: "请读取全部附件，先输出逐页迁移计划，等待我回复 1。", timeoutSeconds: 120, enabled: true, autoDetect: true },
        { action: "wait-random", text: "", enabled: true, minSeconds: 2, maxSeconds: 5 },
        { action: "wait-plan", text: "", timeoutSeconds: 480, enabled: true, autoDetect: true, quietSeconds: 8 },
        { action: "send-confirm", text: "1", timeoutSeconds: 20, enabled: true, autoDetect: false },
        { action: "wait-random", text: "", enabled: true, minSeconds: 1, maxSeconds: 3 },
        { action: "wait-images", text: "", timeoutSeconds: 900, enabled: true, autoDetect: true, minImages: 4 },
        { action: "request-copy", text: "给我一份小红书文案", timeoutSeconds: 20, enabled: true, autoDetect: false },
        { action: "wait-random", text: "", enabled: true, minSeconds: 1, maxSeconds: 3 },
        { action: "wait-copy", text: "", timeoutSeconds: 480, enabled: true, autoDetect: true, minCopyLength: 300 },
        { action: "save-text", text: "", timeoutSeconds: 60, enabled: true, autoDetect: true },
        { action: "download-images", text: "", timeoutSeconds: 600, enabled: true, autoDetect: true },
        { action: "move-archive", text: "", timeoutSeconds: 120, enabled: true, autoDetect: false }
      ]
    },

    // 2. 合并归档模式
    "test-combined": {
      name: "合并归档（测试）",
      useCurrentSession: true,
      confirmText: "1",
      copyPrompt: "给我一份小红书文案",
      steps: [
        { action: "upload-material", text: "请读取全部附件，先输出逐页迁移计划，等待我回复 1。", timeoutSeconds: 120, enabled: true, autoDetect: true },
        { action: "wait-plan", text: "", timeoutSeconds: 480, enabled: true, autoDetect: true, quietSeconds: 8 },
        { action: "send-confirm", text: "1", timeoutSeconds: 20, enabled: true, autoDetect: false },
        { action: "wait-images", text: "", timeoutSeconds: 900, enabled: true, autoDetect: true, minImages: 4 },
        { action: "request-copy", text: "给我一份小红书文案", timeoutSeconds: 20, enabled: true, autoDetect: false },
        { action: "wait-copy", text: "", timeoutSeconds: 480, enabled: true, autoDetect: true, minCopyLength: 300 },
        { action: "package-archive", text: "", timeoutSeconds: 600, enabled: true, autoDetect: false }
      ]
    },

    // 3. 混合工具步骤
    "test-mixed": {
      name: "混合工具步骤（测试）",
      useCurrentSession: true,
      confirmText: "1",
      copyPrompt: "给我一份小红书文案",
      steps: [
        { action: "time-window", text: "", enabled: true, timeStart: "00:00", timeEnd: "23:59" },
        { action: "upload-material", text: "请读取全部附件，先输出逐页迁移计划。", timeoutSeconds: 120, enabled: true, autoDetect: true },
        { action: "wait-fixed", text: "", timeoutSeconds: 3, enabled: true },
        { action: "detect-plan", text: "", enabled: true, pattern: "迁移计划|逐页|P\\s*1" },
        { action: "wait-plan", text: "", timeoutSeconds: 480, enabled: true, autoDetect: true },
        { action: "send-text", text: "好的，请继续出图", enabled: true },
        { action: "send-confirm", text: "1", timeoutSeconds: 20, enabled: true, autoDetect: false },
        { action: "wait-random", text: "", enabled: true, minSeconds: 2, maxSeconds: 6 },
        { action: "detect-generating", text: "", enabled: true },
        { action: "wait-images", text: "", timeoutSeconds: 900, enabled: true, autoDetect: true, minImages: 4 },
        { action: "detect-images", text: "", enabled: true, minImages: 1 },
        { action: "request-copy", text: "给我一份小红书文案", timeoutSeconds: 20, enabled: true, autoDetect: false },
        { action: "wait-copy", text: "", timeoutSeconds: 480, enabled: true, autoDetect: true, minCopyLength: 300 },
        { action: "detect-copy", text: "", enabled: true, minCopyLength: 100 },
        { action: "clipboard-copy", text: "", enabled: true },
        { action: "retry", text: "", timeoutSeconds: 60, enabled: true },
        { action: "save-text", text: "", timeoutSeconds: 60, enabled: true, autoDetect: true },
        { action: "download-images", text: "", timeoutSeconds: 600, enabled: true, autoDetect: true },
        { action: "move-archive", text: "", timeoutSeconds: 120, enabled: true, autoDetect: false }
      ]
    },

    // 4. 部分禁用
    "test-partial": {
      name: "部分禁用（测试）",
      useCurrentSession: true,
      confirmText: "1",
      copyPrompt: "给我一份小红书文案",
      steps: [
        { action: "upload-material", text: "请读取全部附件，先输出逐页迁移计划。", timeoutSeconds: 120, enabled: true, autoDetect: true },
        { action: "wait-plan", text: "", timeoutSeconds: 480, enabled: true, autoDetect: true },
        { action: "send-confirm", text: "1", timeoutSeconds: 20, enabled: true, autoDetect: false },
        { action: "wait-images", text: "", timeoutSeconds: 900, enabled: true, autoDetect: true, minImages: 4 },
        { action: "request-copy", text: "", timeoutSeconds: 20, enabled: false, autoDetect: false },
        { action: "wait-copy", text: "", timeoutSeconds: 480, enabled: false, autoDetect: true },
        { action: "save-text", text: "", timeoutSeconds: 60, enabled: false, autoDetect: true },
        { action: "download-images", text: "", timeoutSeconds: 600, enabled: true, autoDetect: true },
        { action: "move-archive", text: "", timeoutSeconds: 120, enabled: true, autoDetect: false }
      ]
    },

    // 5. 合并模式 + autoPackage=false
    "test-combined-no-pkg": {
      name: "合并+跳过打包（测试）",
      useCurrentSession: true,
      confirmText: "1",
      copyPrompt: "给我一份小红书文案",
      steps: [
        { action: "upload-material", text: "请读取全部附件，先输出逐页迁移计划。", timeoutSeconds: 120, enabled: true, autoDetect: true },
        { action: "wait-plan", text: "", timeoutSeconds: 480, enabled: true, autoDetect: true },
        { action: "send-confirm", text: "1", timeoutSeconds: 20, enabled: true, autoDetect: false },
        { action: "wait-images", text: "", timeoutSeconds: 900, enabled: true, autoDetect: true, minImages: 4 },
        { action: "request-copy", text: "给我一份小红书文案", timeoutSeconds: 20, enabled: true, autoDetect: false },
        { action: "wait-copy", text: "", timeoutSeconds: 480, enabled: true, autoDetect: true, minCopyLength: 300 },
        { action: "package-archive", text: "", timeoutSeconds: 600, enabled: true, autoDetect: false }
      ]
    }
  };

  // ── 合并到已有配置（保留原有模式，添加测试模式） ──
  let existing = {};
  try {
    existing = JSON.parse(current || '{}');
  } catch (e) {
    console.warn('[测试注入] 解析已有配置失败，将使用空对象');
  }

  const merged = { ...existing, ...testProfiles };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));

  console.log(`[测试注入] 成功注入 ${Object.keys(testProfiles).length} 套测试配置`);
  console.log('[测试注入] 测试模式列表:');
  Object.entries(testProfiles).forEach(([key, profile]) => {
    const archiveSteps = profile.steps.filter(s =>
      ['save-text', 'download-images', 'move-archive', 'package-archive'].includes(s.action) && s.enabled !== false
    );
    const mode = archiveSteps.some(s => s.action === 'package-archive') ? '合并' : '分离';
    console.log(`  - ${key}: ${profile.name} (${profile.steps.length} 步, ${mode}归档)`);
  });
  console.log(`[测试注入] 恢复方法: localStorage.setItem('${STORAGE_KEY}', localStorage.getItem('${BACKUP_KEY}'))`);
  console.log('[测试注入] 请刷新页面以加载测试配置');
})();
