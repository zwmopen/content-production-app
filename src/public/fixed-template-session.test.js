const test = require("node:test");
const assert = require("node:assert/strict");
const { project, conversationUrl, buildTemplateSetupPrompt, buildMaterialPrompt } = require("./fixed-template-session");
const sha = "a".repeat(64);
const template = { id: "T79", name: "四宫格母版", references: [
  { path: "template-P1.jpg", name: "模板-P1.jpg", sha256: sha, physicalVerified: true },
  { path: "template-P2.jpg", name: "模板-P2.jpg", sha256: sha, physicalVerified: true }
] };
const profile = { accountId: "account-a", selectedTemplateId: "T79", templateConversationUrl: "https://chatgpt.com/c/6a9b0a9f-853c-83e8-9e81-b41697d14063" };
const bindingReceipt = { ...profile, templateId: "T79", conversationUrl: profile.templateConversationUrl, status: "READY", physicalVerified: true, receiptPath: "init-receipt.json", receiptSha256: sha };

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const appSource = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
const renderSource = appSource.slice(appSource.indexOf("function renderGptWorkflowVariantControl()"), appSource.indexOf("async function apiWithTimeout("));
function renderVariant(account, templates, projector = { project }) {
  const nodes = { "#gptWorkflowVariant": {}, "#gptWorkflowVariantHint": { hidden: true, textContent: "" } };
  const context = vm.createContext({
    window: { TBFixedTemplateSession: projector }, gptAccounts: account ? [account] : [],
    activeGptAccountId: account?.id || "none", gptAutoRunning: false,
    $(selector) { return nodes[selector]; }, availableGptTestTemplates() { return templates; },
    fetch() { throw new Error("Network forbidden"); }
  });
  vm.runInContext(renderSource + "\nrenderGptWorkflowVariantControl();", context);
  return nodes;
}

test("real renderer shows verified fresh template steps rather than hiding its hint", () => {
  const nodes = renderVariant({ ...profile, id: "account-a", workflowVariant: "fresh-session-fixed-template" }, [template]);
  assert.equal(nodes["#gptWorkflowVariantHint"].hidden, false);
  assert.match(nodes["#gptWorkflowVariantHint"].textContent, /固定母版已核实，每套新对话/);
  assert.match(nodes["#gptWorkflowVariantHint"].textContent, /每套新建网页对话并发送母版/);
  assert.equal(nodes["#gptWorkflowVariant"].value, "fresh-session-fixed-template");
});
test("real renderer keeps fresh template missing or empty references visibly pending", () => {
  const account = { ...profile, id: "account-a", workflowVariant: "fresh-session-fixed-template" };
  for (const templates of [[], [{ id: "T79", references: [] }]]) {
    const nodes = renderVariant(account, templates);
    assert.equal(nodes["#gptWorkflowVariantHint"].hidden, false);
    assert.match(nodes["#gptWorkflowVariantHint"].textContent, /固定母版待核实/);
    assert.doesNotMatch(nodes["#gptWorkflowVariantHint"].textContent, /已核实/);
  }
});
test("real renderer updates legacy and no-account states and fresh fallback truthfully", () => {
  const legacy = renderVariant({ ...profile, id: "account-a" }, [template]);
  assert.match(legacy["#gptWorkflowVariantHint"].textContent, /已配置母版会话，待核实/);
  const missing = renderVariant(null, []);
  assert.equal(missing["#gptWorkflowVariantHint"].textContent, "先选择一个浏览器账号窗口");
  const fallback = renderVariant({ ...profile, id: "account-a", workflowVariant: "fresh-session-fixed-template" }, [template], null);
  assert.equal(fallback["#gptWorkflowVariantHint"].hidden, false);
  assert.match(fallback["#gptWorkflowVariantHint"].textContent, /每套新建对话发送母版/);
});

test("configured CDP URL does not prove the template was learned", () => {
  const result = project({ pipeline: "cdp-a", profile, template, sourcePath: "source" });
  assert.equal(result.bindingStatus, "CONFIGURED_UNVERIFIED");
  assert.equal(result.canSubmitSelectedMaterial, false);
});
test("CDP without a bound URL visibly stays unbound", () => {
  assert.equal(project({ pipeline: "cdp", profile: { accountId: "a" }, template }).bindingStatus, "UNBOUND");
});
test("exact account, template and conversation receipt enables readiness", () => {
  assert.equal(project({ pipeline: "cdp", profile, template, bindingReceipt, sourcePath: "source" }).canSubmitSelectedMaterial, true);
  for (const change of [{ accountId: "account-b" }, { templateId: "T80" }, { conversationUrl: "https://chatgpt.com/c/other" }, { status: "PENDING" }, { receiptSha256: "bad" }, { physicalVerified: false }]) {
    assert.equal(project({ pipeline: "cdp", profile, template, bindingReceipt: { ...bindingReceipt, ...change } }).readyForMaterial, false);
  }
});
test("Codex never exposes a web session URL or initialization action", () => {
  const result = project({ pipeline: "codex-api", profile, template, bindingReceipt, sourcePath: "source" });
  assert.equal(result.canInitializeConversation, false);
  assert.equal(result.conversationUrl, "");
  assert.equal(result.workflow, "native-reference-per-call");
  assert.equal(result.bindingStatus, "REFERENCES_VERIFIED");
});
test("fresh-session requires physical references, rejects virtual empty master", () => {
  const fresh = { ...profile, workflowVariant: "fresh-session-fixed-template" };
  assert.equal(project({ pipeline: "cdp", profile: fresh, template: { id: "current-master-v1", references: [] } }).readyForMaterial, false);
  assert.equal(project({ pipeline: "cdp", profile: fresh, template }).readyForMaterial, true);
});
test("reference hashes and physical verification are both required", () => {
  for (const change of [{ physicalVerified: false }, { sha256: "" }, { path: "" }]) {
    const altered = { ...template, references: [{ ...template.references[0], ...change }] };
    assert.equal(project({ pipeline: "codex", template: altered }).readyForMaterial, false);
  }
});
test("unknown pipelines remain unsupported; absent source never enables submission", () => {
  assert.equal(project({ pipeline: "gemini", template }).bindingStatus, "UNSUPPORTED");
  assert.equal(project({ pipeline: "codex", template }).canSubmitSelectedMaterial, false);
});
test("only canonical private ChatGPT conversations are accepted", () => {
  assert.equal(conversationUrl("https://chatgpt.com/share/abc"), "");
  assert.equal(conversationUrl("https://chatgpt.com.evil.test/c/abc"), "");
  assert.equal(conversationUrl("http://chatgpt.com/c/abc"), "");
  assert.equal(conversationUrl("https://chatgpt.com/c/abc/?x=1"), "https://chatgpt.com/c/abc");
});

test("manual fixed-template setup prompt asks for actual P1/P2 attachments without claiming training or generation", () => {
  const result = buildTemplateSetupPrompt({ template });
  assert.equal(result.ready, true);
  assert.deepEqual(result.referencePages.map((item) => item.path), ["template-P1.jpg", "template-P2.jpg"]);
  assert.match(result.text, /P1 是封面，P2 是内页/);
  assert.match(result.text, /不要生成作品/);
  assert.match(result.text, /不要声称训练了永久模型记忆/);
  assert.match(result.text, /新对话.*重新附上 P1\/P2/);
  assert.equal(buildTemplateSetupPrompt({ template: { id: "T80", images: [] } }).ready, false);
});

test("manual per-set prompt binds exactly one whole folder and makes attachment and delivery limits explicit", () => {
  const result = buildMaterialPrompt({ template, sourcePath: "D:\\素材\\作品 A", sourceFiles: ["cover.jpg", { name: "p1.jpg" }] });
  assert.equal(result.ready, true);
  assert.match(result.text, /只制作这一套完整作品/);
  assert.match(result.text, /禁止混入其他文件夹/);
  assert.match(result.text, /每个有效源图对应一张成品/);
  assert.match(result.text, /11 版本双协议文案/);
  assert.match(result.text, /不是附件回执，请确认实际收到完整源图/);
  assert.equal(buildMaterialPrompt({ template, sourcePath: "D:\\素材\\作品 A" }).ready, true);
  assert.equal(buildMaterialPrompt({ template, sourcePath: "", sourceFiles: ["x.jpg"] }).ready, false);
});
