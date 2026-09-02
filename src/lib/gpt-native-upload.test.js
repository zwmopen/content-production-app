const test = require("node:test");
const assert = require("node:assert/strict");
const {
  planGptFileInputOperations,
  prepareGptTaskUpload,
  reconcileGptAttachmentPaths,
  selectGptFileInputCandidate
} = require("./gpt-native-upload");

const candidates = [
  { id: "generic", accept: "", multiple: false },
  { id: "images", accept: "image/*", multiple: true }
];

const chatGptCandidates = [
  { id: "upload-files", accept: "", multiple: true, dataPhotoUploadEnabled: "true" },
  { id: "upload-photos", accept: "image/*", multiple: true },
  { id: "upload-camera", accept: "image/*", multiple: true }
];

test("mixed GPT uploads use the generic input for TXT and the image input for images", () => {
  assert.equal(selectGptFileInputCandidate(candidates, ["文案.txt"], "document").id, "generic");
  assert.equal(selectGptFileInputCandidate(candidates, ["1.jpg", "2.png"], "image").id, "images");
  const plan = planGptFileInputOperations(candidates, ["模板\\文案.txt", "素材\\文案.txt", "1.jpg", "2.jpg"]);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.operations, [
    { kind: "document", files: ["模板\\文案.txt"] },
    { kind: "document", files: ["素材\\文案.txt"] },
    { kind: "image", files: ["1.jpg", "2.jpg"] }
  ]);
});

test("ChatGPT production composer prefers the unified photo-enabled upload input", () => {
  assert.equal(selectGptFileInputCandidate(chatGptCandidates, ["1.jpg", "2.png"], "image").id, "upload-files");
  assert.equal(selectGptFileInputCandidate(chatGptCandidates, ["文案.txt"], "document").id, "upload-files");
});

test("production upload keeps cover, two inner pages and tail while embedding both TXT files", () => {
  const templateRoot = "C:\\template";
  const materialRoot = "C:\\material";
  const task = {
    prompt: "请完整读取本轮内容",
    templateAttachments: ["1.jpg", "10.jpg", "2.jpg", "3.jpg", "4.jpg", "文案.txt"].map((name) => `${templateRoot}\\${name}`),
    attachments: [
      ...["1.jpg", "10.jpg", "2.jpg", "3.jpg", "4.jpg", "文案.txt"].map((name) => `${templateRoot}\\${name}`),
      ...["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg", "文案.txt"].map((name) => `${materialRoot}\\${name}`)
    ]
  };
  const result = prepareGptTaskUpload(task, (filePath) => filePath.includes("template") ? "模板事实" : "素材事实");
  assert.deepEqual(result.templateAttachments.map((filePath) => filePath.split("\\").pop()), ["1.jpg", "2.jpg", "3.jpg", "10.jpg"]);
  assert.equal(result.attachments.length, 9);
  assert.equal(result.attachments.some((filePath) => filePath.endsWith(".txt")), false);
  assert.equal(result.embeddedTextCount, 2);
  assert.equal(result.removedTemplateImageCount, 1);
  assert.match(result.prompt, /母版文案[\s\S]*模板事实[\s\S]*本轮素材文案[\s\S]*素材事实/);
});

test("large image sets are injected in bounded batches", () => {
  const images = Array.from({ length: 12 }, (_, index) => `${index + 1}.jpg`);
  const plan = planGptFileInputOperations(candidates, images);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.operations.map((operation) => operation.files.length), [2, 2, 2, 2, 2, 2]);
});

test("production upload never exceeds ten images after retaining the four-page template", () => {
  const templateRoot = "C:\\template";
  const materialRoot = "C:\\material";
  const template = ["1.jpg", "10.jpg", "2.jpg", "3.jpg", "4.jpg", "文案.txt"].map((name) => `${templateRoot}\\${name}`);
  const material = [...Array.from({ length: 8 }, (_, index) => `${materialRoot}\\${index + 1}.jpg`), `${materialRoot}\\文案.txt`];
  const result = prepareGptTaskUpload({ prompt: "x", templateAttachments: template, attachments: [...template, ...material] }, () => "txt");
  assert.equal(result.attachments.length, 10);
  assert.equal(result.templateAttachments.length, 4);
  assert.equal(result.removedMaterialImageCount, 2);
});

test("a 12-image partial composer only uploads the two missing TXT files", () => {
  const paths = [
    "模板\\1.jpg", "模板\\10.jpg", "模板\\2.jpg", "模板\\3.jpg", "模板\\4.jpg", "模板\\文案.txt",
    "素材\\1.jpg", "素材\\2.jpg", "素材\\3.jpg", "素材\\4.jpg", "素材\\5.jpg", "素材\\6.jpg", "素材\\7.jpg", "素材\\文案.txt"
  ];
  const previews = ["1.jpg", "10.jpg", "2.jpg", "3.jpg", "4.jpg", "1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg", "6.jpg", "7.jpg"]
    .map((name, index) => `移除文件${index + 1}：${name}`);
  const result = reconcileGptAttachmentPaths(paths, previews);
  assert.equal(result.ok, true);
  assert.equal(result.existingCount, 12);
  assert.deepEqual(result.missingPaths, ["模板\\文案.txt", "素材\\文案.txt"]);
});

test("an unrelated composer attachment blocks native upload instead of duplicating files", () => {
  const result = reconcileGptAttachmentPaths(["1.jpg", "文案.txt"], ["移除文件1：other.jpg"]);
  assert.equal(result.ok, false);
  assert.match(result.error, /不属于当前任务/);
});
