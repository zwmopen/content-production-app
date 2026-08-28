const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');
const { resolveAuthorizedDownloadRoot } = require('./lib/gpt-download-root');

const server = require('./server');

test('work-package duplicate output becomes a clean skipped result', { concurrency: false }, async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-duplicate-output-'));
  const productRoot = path.join(parent, 'products');
  const downloadRoot = path.join(parent, 'downloads');
  const duplicatePackagePath = path.join(productRoot, 'existing-package');
  fs.mkdirSync(duplicatePackagePath, { recursive: true });
  const originalSpawn = childProcess.spawn;
  t.after(() => {
    childProcess.spawn = originalSpawn;
    cleanup(parent);
  });
  childProcess.spawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    process.nextTick(() => {
      child.stdout.end([
        'DUPLICATE',
        'Version=1.8.4',
        'DeletedImages=6',
        'DuplicateReason=ExactImageSet',
        `DuplicatePackagePath=${duplicatePackagePath}`,
        'HistoryEntries=12'
      ].join('\n'));
      child.stderr.end();
      child.emit('close', 0);
    });
    return child;
  };
  const result = await server.runExtensionWorkPackage({
    clipboardText: '本次重复作品的文案',
    downloadRoot,
    productRoot
  });
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.skipped, true);
  assert.equal(result.deletedImages, 6);
  assert.equal(result.duplicateReason, 'ExactImageSet');
  assert.equal(result.packagePath, duplicatePackagePath);
});

test('work-package result path is recovered from the UTF-8 package record instead of console text', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-package-result-'));
  const productRoot = path.join(parent, '成品库');
  const packagePath = path.join(productRoot, '20260802_测试中文成品');
  const batchId = '20260802-010203-ab12';
  fs.mkdirSync(packagePath, { recursive: true });
  fs.writeFileSync(path.join(packagePath, 'GPT作品记录.json'), JSON.stringify({
    status: 'completed',
    batchId,
    packagePath
  }, null, 2), 'utf8');
  try {
    assert.equal(server.findCompletedWorkPackageByBatchId(productRoot, batchId), packagePath);
    assert.equal(server.findCompletedWorkPackageByBatchId(productRoot, '20260802-010203-miss'), '');
  } finally {
    cleanup(parent);
  }
});

test('completed first-batch package uses its verified 10/10 record instead of the larger plan count', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-package-inspection-'));
  try {
    fs.writeFileSync(path.join(parent, '文案.txt'), '完整文案', 'utf8');
    for (let index = 1; index <= 10; index += 1) {
      fs.writeFileSync(path.join(parent, `${index}.png`), Buffer.from('89504e470d0a1a0a', 'hex'));
    }
    fs.writeFileSync(path.join(parent, 'GPT作品记录.json'), JSON.stringify({
      status: 'completed',
      expectedImageCount: 10,
      actualImages: 10
    }), 'utf8');
    const completeBatch = server.inspectGptWorkPackage(parent, 12);
    assert.equal(completeBatch.valid, true);
    assert.equal(completeBatch.expectedImageCount, 10);
    assert.equal(completeBatch.plannedImageCount, 12);
    assert.equal(completeBatch.validatedByPackageRecord, true);

    fs.rmSync(path.join(parent, '10.png'));
    const incompleteBatch = server.inspectGptWorkPackage(parent, 12);
    assert.equal(incompleteBatch.valid, false);
    assert.equal(incompleteBatch.expectedImageCount, 12);
    assert.equal(incompleteBatch.validatedByPackageRecord, false);
  } finally {
    cleanup(parent);
  }
});

test('work-package image validation accepts extra legacy files but rejects incomplete output', () => {
  const complete = server.validateGptWorkPackageImageCount(21, 8);
  assert.equal(complete.valid, true);
  assert.equal(complete.overproduced, true);
  assert.equal(complete.actualImageCount, 21);
  assert.equal(complete.expectedImageCount, 8);

  const incomplete = server.validateGptWorkPackageImageCount(7, 8);
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.overproduced, false);
});

test('online GPT templates are stored atomically in the template-root text file', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-online-templates-'));
  const file = path.join(parent, '链接模板.txt');
  try {
    const first = server.updateOnlineTemplate({
      name: '湖景绿底母版',
      url: 'https://chatgpt.com/c/6a1e65b9-6bf0-83a9-b4e6-6c8cece1fbcf',
      accountId: 'account-2'
    }, file);
    assert.equal(first.templates.length, 1);
    assert.equal(first.templates[0].kind, 'online');
    assert.equal(first.templates[0].accountId, 'account-2');
    assert.equal(fs.existsSync(`${file}.tmp`), false);
    const updated = server.updateOnlineTemplate({
      id: first.templates[0].id,
      name: '湖景绿底母版（更新）',
      url: 'https://chatgpt.com/share/6a1e65b9-6bf0-83a9-b4e6-6c8cece1fbcf'
    }, file);
    assert.equal(updated.templates.length, 1);
    assert.equal(updated.templates[0].name, '湖景绿底母版（更新）');
    assert.equal(server.normalizeOnlineTemplateUrl('https://example.com/c/no'), '');
  } finally {
    cleanup(parent);
  }
});

test('online GPT templates keep one account-owned conversation and count successful outputs idempotently', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-online-session-'));
  const file = path.join(parent, '链接模板.txt');
  try {
    const first = server.updateOnlineTemplate({
      action: 'record-success',
      templateId: 'T01',
      name: '上海团建母版',
      url: 'https://chatgpt.com/c/account-a-session',
      accountId: 'account-a',
      browserIdentityId: 'account-a',
      requestId: 'gpt-success-1',
      threshold: 2
    }, file);
    assert.equal(first.templates.length, 1);
    assert.equal(first.templates[0].status, 'warming');
    assert.equal(first.templates[0].successfulOutputCount, 1);
    assert.equal(first.templates[0].autoSaved, false);

    const duplicate = server.updateOnlineTemplate({
      action: 'record-success',
      templateId: 'T01',
      name: '上海团建母版',
      url: 'https://chatgpt.com/c/account-a-session',
      accountId: 'account-a',
      browserIdentityId: 'account-a',
      requestId: 'gpt-success-1',
      threshold: 2
    }, file);
    assert.equal(duplicate.templates[0].successfulOutputCount, 1);

    const verified = server.updateOnlineTemplate({
      action: 'record-success',
      templateId: 'T01',
      name: '上海团建母版',
      url: 'https://chatgpt.com/c/account-a-session',
      accountId: 'account-a',
      browserIdentityId: 'account-a',
      requestId: 'gpt-success-2',
      threshold: 2
    }, file);
    assert.equal(verified.templates[0].status, 'verified');
    assert.equal(verified.templates[0].successfulOutputCount, 2);
    assert.equal(verified.templates[0].autoSaved, true);

    const secondAccount = server.updateOnlineTemplate({
      action: 'record-success',
      templateId: 'T01',
      name: '上海团建母版',
      url: 'https://chatgpt.com/c/account-b-session',
      accountId: 'account-b',
      browserIdentityId: 'account-b',
      requestId: 'gpt-success-b-1',
      threshold: 2
    }, file);
    assert.equal(secondAccount.templates.length, 2);
    assert.deepEqual(secondAccount.templates.map((item) => item.accountId).sort(), ['account-a', 'account-b']);
  } finally {
    cleanup(parent);
  }
});

test('mobile conversion access distinguishes loopback from LAN clients', () => {
  assert.equal(server.isLoopbackAddress('127.0.0.1'), true);
  assert.equal(server.isLoopbackAddress('::1'), true);
  assert.equal(server.isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(server.isLoopbackAddress('192.168.1.27'), false);
});

test('mobile conversion link contains a private LAN address, port and access secret', () => {
  const link = new URL(server.mobileConversionLink());
  assert.equal(link.pathname, '/mobile-conversion');
  assert.equal(link.port, String(process.env.PORT || 4327));
  assert.match(link.searchParams.get('access') || '', /^[a-f0-9]{48}$/);
  assert.notEqual(link.hostname, '0.0.0.0');
});

function makeTemp(name) {
  return fs.mkdtempSync(path.join(__dirname, `.test-${name}-`));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('device discovery keeps recently seen phones without treating an old record as current', () => {
  const now = Date.parse('2026-07-27T16:00:00Z');
  const previous = [
    { name: '苹果12', model: 'iPhone13,2', online: true, current: true, lastSeenAt: now - 60_000 },
    { name: '过期设备', model: 'old-model', online: true, current: true, lastSeenAt: now - 11 * 60_000 }
  ];
  const current = [
    { name: 'VIVO（作品数 7）', model: 'vivo V2327A', online: true, workCount: 7 }
  ];
  const merged = server.mergeDevicePresence(current, previous, now);
  assert.deepEqual(merged.map((item) => item.model).sort(), ['iPhone13,2', 'vivo V2327A']);
  assert.equal(merged.find((item) => item.model === 'iPhone13,2').recentlySeen, true);
  assert.equal(merged.find((item) => item.model === 'vivo V2327A').current, true);
});

test('registered devices still require a current live discovery record before transfer', () => {
  const presence = [
    { name: '红米13（微信） 1号', model: 'Xiaomi 23124RN87C', current: true },
    { name: 'WRedmi Note 8（A2）', model: 'Xiaomi Redmi Note 8', current: false, recentlySeen: true }
  ];
  const registered = {
    aliases: ['6号', '红米 Note 8'],
    models: ['Xiaomi Redmi Note 8']
  };

  assert.equal(server.hasCurrentDevicePresence(presence, registered, '红米 Note 8'), false);
  assert.equal(server.hasCurrentDevicePresence(presence, registered, '红米13（微信） 1号'), true);
});

test('isPathInside rejects sibling paths that share a prefix', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-boundary-'));
  const root = path.join(parent, 'materials');
  const nested = path.join(root, 'nested', 'item');
  const sibling = path.join(parent, 'materials-backup', 'item');
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });
  try {
    assert.equal(server.isPathInside(root, nested), true);
    assert.equal(server.isPathInside(root, sibling), false);
    assert.equal(server.isPathInside(root, path.join(root, '..', 'escape')), false);
  } finally {
    cleanup(parent);
  }
});

test('full-chain conversion HTML is the only external knowledge report allowed to open', () => {
  const report = path.join('D:\\AICode\\AI\\repos\\江湖团建企业转化知识库', '05-分析与复盘', '团建项目全链路知识库.html');
  assert.equal(server.isAllowedFile(report), true);
  assert.equal(server.isAllowedFile(path.join(path.dirname(report), '其他内部文件.md')), false);
});

test('GPT download accepts the configured image inbox and rejects unrelated roots', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-gpt-download-root-'));
  const runtimeRoot = path.join(parent, 'runtime-download');
  const configuredRoot = path.join(parent, 'configured-download');
  const unrelatedRoot = path.join(parent, 'unrelated-download');
  try {
    assert.equal(
      resolveAuthorizedDownloadRoot(configuredRoot, {
        defaultRoot: runtimeRoot,
        configuredRoot
      }),
      path.resolve(configuredRoot)
    );
    assert.equal(
      resolveAuthorizedDownloadRoot(path.join(configuredRoot, 'batch'), {
        defaultRoot: runtimeRoot,
        configuredRoot
      }),
      path.resolve(configuredRoot, 'batch')
    );
    assert.throws(
      () => resolveAuthorizedDownloadRoot(unrelatedRoot, {
        defaultRoot: runtimeRoot,
        configuredRoot
      }),
      /下载目录未获授权/
    );
  } finally {
    cleanup(parent);
  }
});

test('extension product tree exposes every local folder and rejects path escape', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-product-tree-'));
  const root = path.join(parent, 'products');
  const sent = path.join(root, '已发送');
  const publish = path.join(root, '发布空间');
  const recent = path.join(root, '刚刚下载打包');
  fs.mkdirSync(sent, { recursive: true });
  fs.mkdirSync(publish, { recursive: true });
  fs.mkdirSync(recent, { recursive: true });
  fs.writeFileSync(path.join(recent, '封面.png'), 'image');
  fs.writeFileSync(path.join(recent, '文案.txt'), 'copy');
  try {
    const snapshot = server.extensionProductTreeSnapshot('', root);
    assert.deepEqual(
      new Set(snapshot.entries.map((entry) => entry.name)),
      new Set(['刚刚下载打包', '发布空间', '已发送'])
    );
    const packageFolder = snapshot.entries.find((entry) => entry.name === '刚刚下载打包');
    assert.equal(packageFolder.imageCount, 1);
    assert.equal(packageFolder.textCount, 1);
    assert.equal(packageFolder.attachments.length, 2);
    assert.throws(
      () => server.extensionProductTreeSnapshot(parent, root),
      /只能读取当前成品库内部/
    );
  } finally {
    cleanup(parent);
  }
});

test('material usage ledger records prepared and used without moving source files', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-material-usage-'));
  const root = path.join(parent, 'materials');
  const post = path.join(root, '待加工帖子');
  const ledgerFile = path.join(parent, 'runtime', 'material-usage-ledger.json');
  fs.mkdirSync(post, { recursive: true });
  fs.writeFileSync(path.join(post, '封面.png'), 'image');
  try {
    const prepared = server.recordMaterialUsage(
      { entryPath: post, name: '待加工帖子', status: 'prepared', conversationUrl: 'https://chatgpt.com/c/test' },
      { materialRoot: root, ledgerFile }
    );
    assert.equal(prepared.status, 'prepared');
    assert.equal(fs.existsSync(post), true);
    const used = server.recordMaterialUsage(
      { entryPath: post, name: '待加工帖子', status: 'used', conversationUrl: 'https://chatgpt.com/c/test' },
      { materialRoot: root, ledgerFile }
    );
    assert.equal(used.status, 'used');
    assert.ok(used.usedAt);
    assert.equal(fs.existsSync(path.join(post, '封面.png')), true);
    assert.equal(server.getMaterialUsageLedger(ledgerFile).events.length, 2);
    const renamed = path.join(root, '已经改过名字的帖子');
    fs.renameSync(post, renamed);
    const duplicate = server.checkMaterialUsage(
      { entryPath: renamed },
      { materialRoot: root, ledgerFile }
    );
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.match, 'fingerprint');
  } finally {
    cleanup(parent);
  }
});

test('material main tags collapse similar game keywords into one parent tag', () => {
  assert.equal(server.inferMaterialMainTag('素材', '聚会游戏合集', '公司破冰小游戏'), '团建游戏');
  assert.equal(server.inferMaterialMainTag('素材', '七月爬山大合集', '周边游攻略'), '合集攻略');
  assert.equal(server.inferMaterialMainTag('素材', '安吉两天一夜', '公司团建路线'), '团建转化');
});

test('manual material tags and usage count stay bound to folder hash after a move', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'material-metadata-hash-'));
  const root = path.join(parent, 'materials');
  const original = path.join(root, '待分类', '聚会游戏01');
  const movedParent = path.join(root, '已整理');
  const ledgerFile = path.join(parent, 'material-metadata-ledger.json');
  const cacheFile = path.join(parent, 'material-hash-cache.json');
  fs.mkdirSync(original, { recursive: true });
  fs.mkdirSync(movedParent, { recursive: true });
  fs.writeFileSync(path.join(original, '文案.txt'), '这是一个破冰游戏');
  fs.writeFileSync(path.join(original, '图片.png'), Buffer.from([1, 2, 3, 4]));
  try {
    const first = server.updateMaterialMetadata({
      entryPath: original,
      mainTag: '团建游戏',
      tags: ['夏季'],
      incrementUsage: true
    }, { materialRoot: root, ledgerFile, cacheFile });
    const moved = path.join(movedParent, path.basename(original));
    fs.renameSync(original, moved);
    const second = server.updateMaterialMetadata({
      entryPath: moved,
      incrementUsage: true
    }, { materialRoot: root, ledgerFile, cacheFile });
    assert.equal(second.folderHash, first.folderHash);
    assert.equal(second.mainTag, '团建游戏');
    assert.deepEqual(second.tags, ['夏季']);
    assert.equal(second.usageCount, 2);
    assert.equal(Object.keys(server.getMaterialMetadataLedger(ledgerFile).entries).length, 1);
  } finally {
    cleanup(parent);
  }
});

test('successful material production uses numeric usage archive folders', () => {
  assert.equal(server.materialUsageDirectoryName(1), '1');
  assert.equal(server.materialUsageDirectoryName(2), '2');
  assert.equal(server.materialUsageDirectoryName(3), '3');
  assert.equal(server.materialUsageDirectoryName(4), '4');
});

test('identical material contents still receive distinct folder identity hashes', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'material-folder-identity-'));
  const first = path.join(parent, '帖子一');
  const second = path.join(parent, '帖子二');
  fs.mkdirSync(first, { recursive: true });
  fs.mkdirSync(second, { recursive: true });
  for (const folder of [first, second]) {
    fs.writeFileSync(path.join(folder, '文案.txt'), '完全相同的内容');
    fs.writeFileSync(path.join(folder, '图片.png'), Buffer.from([9, 8, 7]));
  }
  try {
    const firstHash = server.materialFolderHash(first, { cache: { entries: {} } }).hash;
    const secondHash = server.materialFolderHash(second, { cache: { entries: {} } }).hash;
    assert.notEqual(firstHash, secondHash);
    assert.equal(server.materialUsageFingerprint(first), server.materialUsageFingerprint(second));
  } finally {
    cleanup(parent);
  }
});

test('legacy production evidence backfills usage once and leaves uncertain records for review', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'material-legacy-evidence-'));
  const itemPath = path.join(parent, '聚会游戏素材01');
  const ledgerFile = path.join(parent, 'material-metadata-ledger.json');
  fs.mkdirSync(itemPath, { recursive: true });
  try {
    const folderHash = server.materialFolderHash(itemPath, { cache: { entries: {} } }).hash;
    const items = [{
      id: itemPath,
      name: '聚会游戏素材01',
      path: itemPath,
      folderHash,
      mainTag: '团建游戏',
      usageCount: 0
    }];
    const evidence = [{
      eventKey: 'TB-001|2026-06-28 18:55:50|T01',
      materialId: 'TB-001',
      folderName: '聚会游戏素材01',
      title: '聚会游戏素材01',
      sourcePath: 'D:\\旧素材库\\聚会游戏素材01',
      sources: ['制作日志']
    }, {
      eventKey: 'TB-404|2026-06-28 19:00:00|T01',
      materialId: 'TB-404',
      folderName: '已经改名且无法确认',
      title: '无法确认',
      sourcePath: 'D:\\旧素材库\\已经改名且无法确认',
      sources: ['素材链接记录']
    }];
    const first = server.applyLegacyMaterialEvidence(items, evidence, { ledgerFile });
    const second = server.applyLegacyMaterialEvidence(items, evidence, { ledgerFile });
    assert.equal(first.importedEvents, 1);
    assert.equal(first.review.length, 1);
    assert.equal(second.importedEvents, 0);
    assert.equal(server.getMaterialMetadataLedger(ledgerFile).entries[folderHash].usageCount, 1);
    assert.deepEqual(server.materialIndexStats([
      { mainTag: '团建游戏', usageCount: 1 },
      { mainTag: '团建转化', usageCount: 0 }
    ], first.review), {
      total: 2,
      byMainTag: { 团建游戏: 1, 团建转化: 1, 合集攻略: 0 },
      byUsage: { unused: 1, once: 1, twice: 0, threePlus: 0, used: 1 },
      review: 1
    });
  } finally {
    cleanup(parent);
  }
});

test('workspace folder move renames a real folder inside the same authorized root', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-move-folder-'));
  const root = path.join(parent, 'materials');
  const source = path.join(root, '待加工');
  const target = path.join(root, '已使用');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(source, '文案.txt'), 'copy');
  try {
    const result = server.moveWorkspaceEntry(
      { sourcePath: source, targetPath: target },
      { roots: [root] }
    );
    assert.equal(result.to, path.join(target, '待加工'));
    assert.equal(fs.existsSync(source), false);
    assert.equal(fs.readFileSync(path.join(result.to, '文案.txt'), 'utf8'), 'copy');
  } finally {
    cleanup(parent);
  }
});

test('workspace folder move rejects files, roots, links and cross-root targets', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-move-safety-'));
  const rootA = path.join(parent, 'materials');
  const rootB = path.join(parent, 'products');
  const source = path.join(rootA, '帖子');
  const child = path.join(source, '子目录');
  const target = path.join(rootA, '目标');
  const file = path.join(rootA, '文案.txt');
  fs.mkdirSync(child, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(rootB, { recursive: true });
  fs.writeFileSync(file, 'copy');
  try {
    assert.throws(
      () => server.moveWorkspaceEntry({ sourcePath: file, targetPath: target }, { roots: [rootA, rootB] }),
      /只能移动真实文件夹/
    );
    assert.throws(
      () => server.moveWorkspaceEntry({ sourcePath: rootA, targetPath: rootB }, { roots: [rootA, rootB] }),
      /不能移动素材库或成品库根目录/
    );
    assert.throws(
      () => server.moveWorkspaceEntry({ sourcePath: source, targetPath: child }, { roots: [rootA, rootB] }),
      /不能把文件夹移动到它自己或它的子文件夹里/
    );
    assert.throws(
      () => server.moveWorkspaceEntry({ sourcePath: source, targetPath: rootB }, { roots: [rootA, rootB] }),
      /只能在同一个素材库或成品库内部移动/
    );
  } finally {
    cleanup(parent);
  }
});

test('safeName removes unsafe and Windows-reserved names', () => {
  assert.equal(server.safeName('../客户:素材*'), '.._客户_素材_');
  assert.equal(server.safeName('CON'), '_CON');
  assert.equal(server.safeName('LPT1.txt'), '_LPT1.txt');
  assert.equal(server.safeName('...   '), '未命名');
});

test('material collection commits atomically after all links succeed', () => {
  const library = makeTemp('success');
  const sourceA = path.join(library, 'A');
  const sourceB = path.join(library, 'B');
  fs.mkdirSync(sourceA);
  fs.mkdirSync(sourceB);
  try {
    const result = server.collectMaterialLinks(
      library,
      [{ path: sourceA, name: 'A' }, { path: sourceB, name: 'B' }],
      'test filter',
      {
        allowedRoots: [fs.realpathSync.native(__dirname)],
        linkDirectory(source, target) {
          fs.symlinkSync(source, target, 'junction');
        }
      }
    );
    assert.equal(result.created, 2);
    assert.equal(fs.existsSync(result.folderPath), true);
    assert.equal(fs.existsSync(path.join(result.folderPath, '筛选说明.json')), true);
    assert.equal(fs.readdirSync(library).some((name) => name.includes('.tmp-')), false);
  } finally {
    cleanup(library);
  }
});

test('material collection rolls back completely when a link fails', () => {
  const library = makeTemp('rollback');
  const sourceA = path.join(library, 'A');
  const sourceB = path.join(library, 'B');
  fs.mkdirSync(sourceA);
  fs.mkdirSync(sourceB);
  let calls = 0;
  try {
    assert.throws(() => {
      server.collectMaterialLinks(
        library,
        [{ path: sourceA, name: 'A' }, { path: sourceB, name: 'B' }],
        '',
        {
          allowedRoots: [fs.realpathSync.native(__dirname)],
          linkDirectory(source, target) {
            calls += 1;
            if (calls === 2) throw new Error('simulated junction failure');
            fs.symlinkSync(source, target, 'junction');
          }
        }
      );
    }, /simulated junction failure/);

    const generated = fs.readdirSync(library).filter((name) => name.startsWith('.筛选整合_'));
    assert.deepEqual(generated, []);
  } finally {
    cleanup(library);
  }
});

test('request reader rejects oversized bodies instead of hanging', async () => {
  const req = new PassThrough();
  req.headers = { 'content-length': '20' };
  const pending = server.getBody(req, 10);
  req.end('01234567890123456789');
  await assert.rejects(pending, (error) => error.statusCode === 413);
});

test('public file resolver prevents traversal outside the public directory', () => {
  const index = server.resolvePublicFile('/');
  const escaped = server.resolvePublicFile('/../server.js');
  assert.equal(escaped, index);
  assert.equal(path.basename(index), 'index.html');
});

test('integrated conversion scripts keep API requests inside the workbench proxy', () => {
  const source = [
    "fetch('/api/正式SOP')",
    'fetch("/api/用户状态")',
    'fetch(`/api/方案?key=${value}`)'
  ].join(';');
  const rewritten = server.rewriteIntegratedConversionContent(source);
  assert.match(rewritten, /fetch\('\/conversion-integrated\/api\/正式SOP\?workbench-proxy=20260729-2'\)/);
  assert.match(rewritten, /fetch\("\/conversion-integrated\/api\/用户状态\?workbench-proxy=20260729-2"\)/);
  assert.match(rewritten, /fetch\(`\/conversion-integrated\/api\/方案/);
  assert.doesNotMatch(rewritten, /fetch\((['"`])\/api\//);
});

test('integrated conversion supervisor starts one missing service and waits until it is ready', async () => {
  assert.equal(typeof server.createConversionServiceSupervisor, 'function');
  const events = [];
  let probes = 0;
  const ensureReady = server.createConversionServiceSupervisor({
    probe: async () => {
      probes += 1;
      events.push(`probe-${probes}`);
      if (probes < 3) throw new Error('offline');
      return { ok: true };
    },
    launch: async () => events.push('launch'),
    wait: async () => events.push('wait'),
    attempts: 3
  });

  const [first, second] = await Promise.all([ensureReady(), ensureReady()]);

  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
  assert.equal(events.filter((event) => event === 'launch').length, 1);
  assert.deepEqual(events, ['probe-1', 'launch', 'wait', 'probe-2', 'wait', 'probe-3']);
});

test('embedded conversion fetch wrapper does not add the workbench prefix twice', () => {
  const source = [
    "if(input.startsWith('/api/'))return nativeFetch('/conversion-integrated'+input,init)",
    "if(new URL(input.url).pathname.startsWith('/api/')){}"
  ].join(';');
  const rewritten = server.rewriteIntegratedConversionContent(source);
  assert.match(rewritten, /input\.startsWith\('\/api\/'\)/);
  assert.match(rewritten, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(rewritten, /nativeFetch\('\/conversion-integrated'\+input/);
  assert.doesNotMatch(rewritten, /startsWith\('\/conversion-integrated\/api\/'\)/);
});

test('formal SOP enhancement failures degrade without emitting a fatal browser error', () => {
  const rewritten = server.rewriteIntegratedConversionContent(
    "catch(error){console.error('正式SOP加载失败',error)}"
  );
  assert.match(rewritten, /console\.warn\('正式SOP增强层已回退到页面现有数据'/);
  assert.doesNotMatch(rewritten, /console\.error\('正式SOP加载失败'/);
});

test('integrated conversion document cache-busts the rewritten formal SOP script', () => {
  const html = '<script src="/正式SOP增强.js?v=20260718-scrollfix2"></script>';
  const versioned = server.rewriteIntegratedConversionDocument(html);
  assert.match(versioned, /workbench-proxy=20260729-2/);
  assert.match(versioned, /src="\/conversion-integrated\//);
  assert.match(versioned, /workbench-seamless-embed/);
  assert.match(versioned, /html\.embedded-host \.app/);
  assert.match(versioned, /background: transparent !important/);
});

test('only the known legacy conversion API paths receive compatibility forwarding', () => {
  assert.equal(server.isIntegratedConversionCompatibilityPath('/api/正式SOP'), true);
  assert.equal(server.isIntegratedConversionCompatibilityPath('/api/用户状态'), true);
  assert.equal(server.isIntegratedConversionCompatibilityPath('/api/settings'), false);
  assert.equal(server.isIntegratedConversionCompatibilityPath('/api/unknown'), false);
});

test('external launcher only allows approved workflow sites and the existing work-package protocol', () => {
  assert.equal(server.isAllowedExternalTarget('https://chatgpt.com/'), true);
  assert.equal(server.isAllowedExternalTarget('https://chatgpt.com/c/abc'), true);
  assert.equal(server.isAllowedExternalTarget('https://mp.weixin.qq.com/'), true);
  assert.equal(server.isAllowedExternalTarget('https://github.com/zwmopen/scripts'), true);
  assert.equal(server.isAllowedExternalTarget('https://raw.githubusercontent.com/zwmopen/scripts/master/example.user.js'), true);
  assert.equal(server.isAllowedExternalTarget('https://creator.douyin.com/'), true);
  assert.equal(server.isAllowedExternalTarget('https://x.com/compose/post'), true);
  assert.equal(server.isAllowedExternalTarget('https://we.ctrip.com/'), true);
  assert.equal(server.isAllowedExternalTarget('cgpt-workpkg://run'), true);
  assert.equal(server.isAllowedExternalTarget('cgpt-workpkg://configure'), true);
  assert.equal(server.isAllowedExternalTarget('https://example.com/'), false);
  assert.equal(server.isAllowedExternalTarget('file:///C:/Windows/System32'), false);
});

test('ChatGPT and the extension may access the localhost bridge through private-network preflight', () => {
  const chatgpt = server.extensionCorsHeaders({ headers: { origin: 'https://chatgpt.com' } });
  assert.equal(chatgpt['Access-Control-Allow-Origin'], 'https://chatgpt.com');
  assert.equal(chatgpt['Access-Control-Allow-Private-Network'], 'true');
  const rejected = server.extensionCorsHeaders({ headers: { origin: 'https://evil.example' } });
  assert.equal(rejected['Access-Control-Allow-Origin'], undefined);
});

test('buildDistributionArgs only creates allowlisted transfer commands', () => {
  assert.deepEqual(
    server.buildDistributionArgs({ action: 'device-restock', device: '5号', type: 'traffic' }),
    ['--device', '5号', '--type', '泛流量']
  );
  assert.deepEqual(
    server.buildDistributionArgs({ action: 'official-reserve', type: 'conversion' }),
    ['--official-account', '--type', '团建转化']
  );
  assert.deepEqual(
    server.buildDistributionArgs({
      action: 'device-restock',
      device: '5号',
      type: 'traffic',
      collection: '作品集_015[泛]'
    }),
    ['--device', '5号', '--type', '泛流量', '--collection', '作品集_015[泛]']
  );
  assert.throws(
    () => server.buildDistributionArgs({ action: 'run-anything', device: '5号' }),
    /不支持的分发操作/
  );
  assert.throws(
    () => server.buildDistributionArgs({ action: 'device-restock', device: '--help' }),
    /设备名称无效/
  );
});
