const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  hashText,
  isDownloadedText,
  productionHistoryStatus,
  syncDedupLedger
} = require("./dedup-ledger");

test("读取新版作品历史库时以图片组为生产去重真源", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tb-history-"));
  const history = path.join(root, "作品历史数据库.json");
  fs.writeFileSync(history, JSON.stringify({
    schemaVersion: 2,
    updatedAt: "2026-07-26T00:00:00.000Z",
    entries: [
      {
        imageSetSha256: "a".repeat(64),
        imageCount: 9,
        imageSha256: ["b".repeat(64)],
        imagePerceptualHash: ["0123456789abcdef"]
      },
      {
        imageSetSha256: "c".repeat(64),
        imageCount: 8,
        imageSha256: ["d".repeat(64)],
        imagePerceptualHash: []
      }
    ]
  }), "utf8");

  assert.deepEqual(productionHistoryStatus(history), {
    historyPath: history,
    schemaVersion: 2,
    uniqueImageGroups: 2,
    exactHashGroups: 2,
    perceptualHashGroups: 1,
    updatedAt: "2026-07-26T00:00:00.000Z",
    available: true
  });
});

test("文案哈希与旧一键工作包保持 UTF-8 SHA-256 兼容", () => {
  assert.equal(
    hashText("同一篇文案"),
    "da74fc0cb72912b86cd6c136458e9f0552fc0b2ae275c9a4af98557f6af5f87e"
  );
});

test("同步旧 TXT、手机分发、公众号和已发送压缩包记录", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dedup-ledger-"));
  const libraryRoot = path.join(root, "library");
  const downloadRoot = path.join(root, "download");
  const publishRoot = path.join(libraryRoot, "发布空间");
  const ledgerFile = path.join(root, "runtime", "dedup-ledger.json");

  try {
    const work = path.join(libraryRoot, "作品集_001[泛]", "帖子A");
    fs.mkdirSync(work, { recursive: true });
    fs.mkdirSync(downloadRoot, { recursive: true });
    fs.mkdirSync(publishRoot, { recursive: true });
    fs.mkdirSync(path.join(libraryRoot, "已发送"), { recursive: true });
    fs.writeFileSync(path.join(work, "文案_001.txt"), "已经做过的文案", "utf8");
    fs.writeFileSync(
      path.join(downloadRoot, ".workpkg_last_text.sha256"),
      hashText("上一条文案"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(publishRoot, "device-usage-log.csv"),
      [
        "时间,设备名,设备型号,源作品集,源路径,文件数,字节数,传输协议,接收确认,操作",
        `2026-07-25T10:14:36,1号,Redmi,作品集_001[泛],${path.join(libraryRoot, "作品集_001[泛]")},143,100,Wi-Fi,作品数 1→15,删除小红书+抖音 Junction`
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(publishRoot, "official-account-usage-log.csv"),
      [
        "时间,公众号账号,承载设备,作品集,源路径,文件数,字节数,小红书抖音连接剩余数,状态,操作",
        `2026-07-25T11:00:00,公众号,2号,作品集_001[泛],${path.join(libraryRoot, "作品集_001[泛]")},143,100,0,公众号已使用,人工确认电脑上传完成`
      ].join("\n"),
      "utf8"
    );
    fs.writeFileSync(
      path.join(libraryRoot, "已发送", "cleanup-log.csv"),
      [
        "时间,作品集,已发送ZIP,ZIP SHA-256,删除源文件数,删除源字节数,ZIP文件数,ZIP解压字节数,操作",
        `2026-07-25T12:00:00,作品集_001[泛],${path.join(libraryRoot, "已发送", "作品集_001.zip")},abc123,10,100,10,100,移动ZIP后删除源目录`
      ].join("\n"),
      "utf8"
    );

    const ledger = syncDedupLedger({
      ledgerFile,
      libraryRoot,
      downloadRoot,
      publishRoot
    });

    assert.equal(ledger.downloads.length, 2);
    assert.equal(ledger.distributions.filter((item) => item.group === "mobile" && item.used).length, 1);
    assert.equal(ledger.distributions.filter((item) => item.group === "official" && item.used).length, 1);
    assert.equal(ledger.archives.length, 1);
    assert.equal(isDownloadedText(ledger, "已经做过的文案").duplicate, true);
    assert.equal(fs.existsSync(ledgerFile), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
