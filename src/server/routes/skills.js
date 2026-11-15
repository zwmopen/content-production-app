"use strict";

// Skill 入口只负责把本地技能、私有配置和授权执行器接到工作台。
// 业务规则仍由 wechat-teambuilding-conversion 技能本体负责；本文件不读出
// token、Cookie、完整聊天记录，也不在缺少执行器时伪造同步结果。

const fs = require("fs");
const path = require("path");
const http = require("http");
const childProcess = require("child_process");
const crypto = require("crypto");
const os = require("os");
const materialDownloadRoute = require("./material-download");
const xhsTemplateCollector = require("../../lib/xhs-template-collector");

const SKILL_ID = "wechat-teambuilding-conversion";
const MATERIAL_INGESTION_SKILL_ID = "jianghu-toolbox-material-ingestion";
const TEMPLATE_REPOSITORY_SKILL_ID = "template-repository-maintainer";
const MOMENTS_SKILL_ID = "wechat-moments-library";
const DEVICE_TRANSFER_SKILL_ID = "device-folder-transfer";
const MAINTENANCE_SKILL_ROOT = process.env.TEAMBUILDING_MAINTENANCE_SKILL_ROOT
  || "D:\\AICode\\AI\\skills\\技能包\\技能";
const MATERIAL_INGESTION_SKILL_ROOT = process.env.TEAMBUILDING_MATERIAL_INGESTION_SKILL_ROOT
  || path.join(MAINTENANCE_SKILL_ROOT, MATERIAL_INGESTION_SKILL_ID);
const MATERIAL_INGESTION_SCRIPT = process.env.TEAMBUILDING_MATERIAL_INGESTION_SCRIPT
  || path.join(MATERIAL_INGESTION_SKILL_ROOT, "scripts", "organize-downloaded-materials.ps1");
const MATERIAL_INGESTION_CONFIG = process.env.TEAMBUILDING_MATERIAL_INGESTION_CONFIG
  || "D:\\AICode\\AI\\private-config\\skills\\jianghu-toolbox-material-ingestion\\profile.json";
const TEMPLATE_REPOSITORY_SKILL_ROOT = process.env.TEAMBUILDING_TEMPLATE_REPOSITORY_SKILL_ROOT
  || path.join(MAINTENANCE_SKILL_ROOT, "template-repository-maintainer");
const TEMPLATE_REPOSITORY_PROJECT_ROOT = process.env.TEAMBUILDING_TEMPLATE_PROJECT_ROOT
  || "D:\\AICode\\项目推进\\projects\\江湖有旅人\\主项目";
const TEMPLATE_REPOSITORY_ROOT = process.env.TEAMBUILDING_TEMPLATE_REPOSITORY_ROOT
  || "D:\\AICode\\项目推进\\模板仓库";
const TEMPLATE_REPOSITORY_WORKFLOW_ROOT = path.join(TEMPLATE_REPOSITORY_PROJECT_ROOT, "04-技能库", "workflow-dashboard");
const TEMPLATE_REPOSITORY_INTAKE_ROOT = path.join(TEMPLATE_REPOSITORY_ROOT, "待分析");
const TEMPLATE_REPOSITORY_MATERIAL_ROOT = path.join(TEMPLATE_REPOSITORY_PROJECT_ROOT, "01-素材库", "0");
const TEMPLATE_REPOSITORY_HTML = process.env.TEAMBUILDING_TEMPLATE_REPOSITORY_HTML
  || path.join(TEMPLATE_REPOSITORY_ROOT, "模板仓库.html");
const TEMPLATE_COLLECTOR_LEDGER = process.env.TEAMBUILDING_TEMPLATE_COLLECTOR_LEDGER
  || path.join(TEMPLATE_REPOSITORY_ROOT, "采集", "聚光作品采集索引.json");
const TEMPLATE_COLLECTOR_BRIDGE_URL = String(process.env.TEAMBUILDING_TEMPLATE_COLLECTOR_BRIDGE_URL
  || "http://127.0.0.1:8766").replace(/\/$/, "");
const TEMPLATE_COLLECTOR_BRIDGE_ROOT = process.env.TEAMBUILDING_XHS_DOWNLOADER_ROOT
  || path.resolve(__dirname, "..", "..", "..", "..", "xhs-dl");
const TEMPLATE_PROJECT_LEDGER_HTML = process.env.TEAMBUILDING_TEMPLATE_PROJECT_HTML
  || path.join(TEMPLATE_REPOSITORY_PROJECT_ROOT, "02-模板库", "模板仓库.html");
const TEMPLATE_GALLERY_REGISTRY = path.join(TEMPLATE_REPOSITORY_PROJECT_ROOT, "02-模板库", "templates-registry.json");
const TEMPLATE_GALLERY_ROOT = path.join(TEMPLATE_REPOSITORY_PROJECT_ROOT, "02-模板库");
const TEMPLATE_GALLERY_TEAMBUILDING_ROOT = path.join(TEMPLATE_GALLERY_ROOT, "团建类模板");
const TEMPLATE_GALLERY_BUILD_SCRIPT = path.join(TEMPLATE_GALLERY_ROOT, "scripts", "build_template_gallery.py");
const DEVICE_TRANSFER_SKILL_ROOT = process.env.DEVICE_TRANSFER_SKILL_ROOT
  || path.join(MAINTENANCE_SKILL_ROOT, DEVICE_TRANSFER_SKILL_ID);
const DEVICE_TRANSFER_SCRIPT = path.join(DEVICE_TRANSFER_SKILL_ROOT, "scripts", "send_to_device.py");
const DEVICE_TRANSFER_REGISTRY = path.join(DEVICE_TRANSFER_SKILL_ROOT, "references", "device-registry.json");
const CONVERSION_KNOWLEDGE_BASE_ROOT = process.env.TEAMBUILDING_KNOWLEDGE_BASE_ROOT
  || "D:\\AICode\\AI\\repos\\江湖团建企业转化知识库";
const CONVERSION_KNOWLEDGE_REPORT_PATH = process.env.TEAMBUILDING_KNOWLEDGE_REPORT
  || path.join(CONVERSION_KNOWLEDGE_BASE_ROOT, "05-分析与复盘", "团建项目全链路知识库.html");
const CONVERSION_KNOWLEDGE_MAINTAINER_PATH = process.env.TEAMBUILDING_KNOWLEDGE_MAINTAINER
  || path.join(MAINTENANCE_SKILL_ROOT, "团建知识库维护", "SKILL.md");
const CONVERSION_KNOWLEDGE_MODULES = Object.freeze([
  { id: "summary", title: "执行摘要", state: "integrate", target: "全链路知识库", purpose: "快速看当前判断" },
  { id: "funnel", title: "全量漏斗", state: "integrate", target: "用户旅程", purpose: "定位漏水点和判断分支" },
  { id: "success", title: "成交分析", state: "reference", target: "流量转化模块", purpose: "复盘成交案例和产出" },
  { id: "failure", title: "避坑指南", state: "integrate", target: "转化 SOP / 用户旅程", purpose: "作为风险节点提醒" },
  { id: "sop", title: "转化 SOP", state: "integrate", target: "转化 SOP", purpose: "新人照着执行" },
  { id: "faq", title: "百问百答", state: "integrate", target: "客户怎么回", purpose: "直接复制回复" },
  { id: "ai", title: "AI 自动化", state: "reference", target: "流量转化模块", purpose: "识别可自动化机会" },
  { id: "team", title: "团队分析", state: "reference", target: "流量转化模块", purpose: "管理和培训复盘" },
  { id: "god", title: "上帝视角", state: "integrate", target: "全链路知识库", purpose: "按经营面看机会" },
  { id: "sync", title: "工作台同步", state: "integrate", target: "工作台同步", purpose: "核对 API、候选层和正式层边界" },
  { id: "method", title: "方法论沉淀", state: "maintainer", target: "本维护技能", purpose: "维护规则和更新路径" }
]);
const CONVERSION_KNOWLEDGE_SOURCE = Object.freeze({
  id: "teambuilding-full-chain-html",
  title: "团建项目全链路知识库（来源材料）",
  path: CONVERSION_KNOWLEDGE_REPORT_PATH,
  maintainerPath: CONVERSION_KNOWLEDGE_MAINTAINER_PATH,
  modules: CONVERSION_KNOWLEDGE_MODULES,
  selectionNote: "全链路知识库是流量转化模块里的经营展示层，不是新的聊天真源；日常更新只运行本维护技能，来源材料仅用于追溯和校准。"
});
const NATIVE_SKILLS = {
  [MATERIAL_INGESTION_SKILL_ID]: {
    id: MATERIAL_INGESTION_SKILL_ID,
    title: "素材处理",
    category: "内容制作",
    description: "把江湖工具箱已经下载的完整图文帖子整理进图文工作台素材区，统一 20 字命名、评论点赞前缀、标签和批次台账。",
    background: "江湖工具箱负责下载；这个本地技能负责下载后的扫描、清理、打标和整包入库。",
    usage: "先预览扫描结果，再确认执行移动与空目录清理；视频、散落 TXT 和超相似素材保留给人工判断。",
    invocation: "从技能中心手动触发；设置开关关闭时不允许执行。",
    operation: "扫描下载区 → 识别完整图文帖 → 规范 20 字名称与指标 → 写标签台账 → 预览 → 确认移动。",
    output: "完整帖子数、移动数、空目录数、残留数、标签同步状态和下一步。",
    sourcePath: path.join(MATERIAL_INGESTION_SKILL_ROOT, "SKILL.md"),
    mode: "material_ingestion",
    runLabel: "扫描素材（先预览）",
    flow: ["扫描江湖工具箱下载区", "识别完整图文帖子", "规范名称与标签", "预览移动/清理计划", "确认后整包入库"],
    safety: "必须预览后确认；只删除确认的空目录，不自动删除视频、TXT、超相似或非空残留。",
    settings: {
      section: "skills",
      configurable: true,
      pathFields: ["sourceRoot", "materialRoot"]
    }
  },
  "wechat-chat-analysis": {
    id: "wechat-chat-analysis",
    title: "微信聊天记录提取",
    description: "从已授权的本地微信聊天源提取新增候选和证据入口；原始聊天保持不动，正式 SOP 仍需人工确认。",
    background: "聊天记录里有客户线索、真实问题和成交/流失证据，但原文不能直接当成正式知识；这个技能负责把可复核候选先捞出来。",
    usage: "确认聊天源已授权后，点击“开始提取”；系统会检查来源、扫描新增记录，并把候选和证据指针交给流量转化模块继续判断。",
    input: "已授权的本地聊天源、上次扫描水位和聊天源状态；不会读取浏览器 Cookie 或未授权会话。",
    invocation: "从技能中心点击“开始提取”立即启动；不是预览按钮，也不会等待另一个页面的确认。",
    operation: "检查聊天源 → 扫描新增记录 → 生成候选 → 保留证据指针 → 回读扫描水位和结果。",
    output: "扫描前后水位、候选数量、候选索引、证据入口、未处理原因和下一步人工确认提示。",
    sourcePath: path.join(MAINTENANCE_SKILL_ROOT, "微信聊天分析技能", "SKILL.md"),
    mode: "readonly_chat_scan",
    runLabel: "开始提取",
    flow: ["检查聊天源", "扫描新增记录", "生成候选", "保留证据指针", "等待人工确认"],
    safety: "只更新运行层候选/索引；不修改 WeFlow 原始数据，不推进未经验证的正式知识。"
  },
  "jianghu-sop-maintainer": {
    id: "jianghu-sop-maintainer",
    title: "流量转化模块维护",
    description: "维护流量转化模块的聊天候选、正式 SOP、用户旅程、方案索引和全链路经营展示，让新增信息回到同一条可追溯链路。",
    background: "流量转化模块负责日常执行；全链路知识库只是模块内的经营总览和派生展示。本技能维护源数据、正式层与展示层之间的关系，避免重复维护两套知识库。",
    usage: "先运行维护检查核对服务、正式层、旅程和候选证据；再按上帝视角校准经营判断，必要时更新流量转化模块，人工确认后才写回正式层。",
    input: "新增聊天候选、已确认话术、成交/流失证据、正式 SOP、工作台快照和来源材料。",
    invocation: "从图文项目工作台的技能中心手动触发；更新知识库或发现工作台不同步时优先运行。",
    operation: "建立基线 → 核对服务与正式层 → 校准上帝视角 → 更新流量转化模块 → 报告缺口 → 人工确认后再写回正式资产。",
    output: "服务、正式层、候选/证据缺口、模块去向和下一步。",
    sourcePath: path.join(MAINTENANCE_SKILL_ROOT, "jianghu-sop-maintainer", "SKILL.md"),
    mode: "conversion_maintenance_check",
    runLabel: "运行维护检查",
    flow: ["建立现场基线", "检查服务健康", "核对正式 SOP", "校准上帝视角", "更新流量转化模块", "输出下一步"],
    linkedSkills: ["微信聊天记录提取", "用户旅程决策树", "方案索引"],
    knowledgeSource: CONVERSION_KNOWLEDGE_SOURCE,
    safety: "默认只读核验；发现 API 未刷新、数量异常、来源材料缺失或证据不足时停在报告，不自动写正式内容。"
  },
  [TEMPLATE_REPOSITORY_SKILL_ID]: {
    id: TEMPLATE_REPOSITORY_SKILL_ID,
    title: "模板仓库添加整理",
    category: "模板",
    description: "把模板链接、图片和本地文件夹收进可复用模板仓库，并保留来源、标签和缺口。",
    background: "它是模板资产维护技能，不是流量转化或普通素材下载；来源、模板事实和缺口都回到仓库里。",
    usage: "粘贴公开链接、拖入文件夹或图片，点击直接执行；无法确认的名称、标签、账号和预览会保留待分析。",
    input: "公开笔记/GPT 分享链接、模板名称或备注、本地模板文件夹、封面/内页图片。",
    output: "待分析收件箱、模板候选、来源/全局注册表同步结果、标签描述和缺口报告。",
    invocation: "从技能中心的模板模块触发，也可直接打开全局模板仓库查看结果。",
    operation: "识别输入 → 采集或接收入库 → 保留来源 → 写入候选 → 同步来源与全局模板库 → 回报缺口。",
    sourcePath: path.join(TEMPLATE_REPOSITORY_SKILL_ROOT, "SKILL.md"),
    mode: "template_repository_maintenance",
    runLabel: "维护模板仓库",
    flow: ["接收链接、文件夹或图片", "保存来源与原始素材", "登记模板候选", "同步项目与全局仓库", "报告预览、标签和缺口"],
    safety: "原始素材只复制不覆盖；公开链接不读取浏览器登录态；无法确认的模板名、标签和账号保留为待确认。"
  },
  [MOMENTS_SKILL_ID]: {
    id: MOMENTS_SKILL_ID,
    title: "朋友圈采集整理与发布",
    category: "朋友圈",
    description: "把 WeFlow 历史朋友圈采集、作品库标签整理和微信待发布准备收进同一个可执行入口。",
    background: "朋友圈素材、标签维护和微信准备曾经分散在命令行、面板和本地目录里；技能中心现在只提供统一入口，底层仍复用同一套安全流程。",
    usage: "点击卡片里的入口：采集、整理标签、朋友圈仓库或触发发送；自动准备次数和微信前提在技能专属设置中维护。",
    input: "微信号或微信昵称、可选 WeFlow UID、采集数量、朋友圈作品库路径和当前微信登录状态。",
    invocation: "从技能中心按钮触发；采集与整理写入 D 盘私有作品库，发布准备停在微信最终发表前。",
    operation: "WeFlow 采集 → 每条落盘/去重 → asset.json 整理 → 日期策略选材 → 微信填图填文案 → 人工发表。",
    output: "采集摘要、标签整理结果、作品库刷新状态或 PREPARED_FOR_HUMAN_CONFIRM。",
    sourcePath: path.join(MAINTENANCE_SKILL_ROOT, MOMENTS_SKILL_ID, "SKILL.md"),
    mode: "moments_workspace",
    runLabel: "触发发送",
    flow: ["采集历史朋友圈", "打开朋友圈仓库", "触发发送并停在发表前"],
    safety: "默认采集 10 条，也可切换为全部；采集前可要求人工确认微信/WeFlow 已打开并加载目标朋友圈；定时触发按每日自动准备额度执行，手动触发不消耗该额度；失败立即停止并保留日志；发布准备绝不点击最终发表，也不并发覆盖等待确认的微信窗口。",
    settings: {
      section: "moments",
      configurable: true,
      pathFields: ["libraryRoot"]
    }
  },
  [DEVICE_TRANSFER_SKILL_ID]: {
    id: DEVICE_TRANSFER_SKILL_ID,
    title: "设备发现与作品分发",
    category: "文件传输",
    description: "检查在线设备和库存，在安全门禁通过时复用现有自动分发流程发送作品并回写接收记录。",
    background: "设备发现、库存判断、作品去重、传输进度和接收确认已经由文件传输模块负责；这个技能把它接进技能中心，作为同一个可执行入口。",
    usage: "点击“检查并触发分发”。系统先刷新设备状态，再按现有自动分发设置判断；设备离线、库存未知、未授权或已有分发记录时只停在检查结果。",
    input: "本机设备发现结果、设备注册表、作品仓库、分发设置和接收端状态。",
    invocation: "从技能中心点击一次执行有界检查；后台已有的 10 秒监测继续复用同一套分发引擎，不会创建第二个调度器。",
    operation: "刷新设备 → 检查库存/能力/审批 → 执行既有分发门禁 → 接收端确认 → 写入分发账本。",
    output: "在线设备摘要、自动分发是否触发、跳过原因、任务入口、日志和账本结果。",
    sourcePath: path.join(DEVICE_TRANSFER_SKILL_ROOT, "SKILL.md"),
    mode: "device_transfer_check",
    runLabel: "检查并触发分发",
    flow: ["刷新设备状态", "检查库存与门禁", "按设置触发分发", "回读接收与账本"],
    linkedSkills: ["作品仓库", "自动补货", "分发记录"],
    safety: "只调用现有分发引擎；扫描失败、设备不明确、库存未知、接收端忙或已有成功记录时停止，不换设备、不重复发送、不删除源素材。"
  }
};

// 项目相关技能的“说明/注册”层。它们先以只读方式接入技能中心：
// 技能中心可以展示来源、调用契约和联动关系，但不会因为发现了 SKILL.md
// 就擅自执行脚本。真正可执行的技能仍必须显式加入 NATIVE_SKILLS 并提供
// 对应的安全适配器。
const PROJECT_SKILLS = {
  "content-production": {
    id: "content-production",
    title: "GPT 内容制作",
    category: "内容制作",
    description: "把素材、模板和生产规则交给 GPT 生产图片、文案，并在下载、校验和打包后形成作品。",
    input: "选中的素材、模板、账号窗口和本次生产要求。",
    background: "替代选素材、切窗口、发提示词、下载和归档的重复操作。",
    usage: "选择素材、模板和生产模式后启动；需要调整时在设置中心编辑每一步提示词。",
    invocation: "由用户启动或由无人值守模式按队列续跑；每个阶段都有检查点和暂停边界。",
    operation: "上传 → 计划/确认 → 生图 → 文案 → 下载 → 校验 → 打包 → 作品仓库。",
    output: "图片、TXT 文案、workId、质量校验结果和可分发作品。",
    sourcePath: path.join(MAINTENANCE_SKILL_ROOT, "内容创作技能", "SKILL.md"),
    mode: "documentation_only",
    runLabel: "查看调用说明",
    documentationOnly: true,
    linkedSkills: ["素材扫描与标签", "作品仓库", "文件传输"],
    safety: "额度触顶、低图数、脚本拼图或阶段不明确时停在边界，不把残缺结果归档。"
  },
  "backup-workflow": {
    id: "backup-workflow",
    title: "备份与恢复",
    category: "系统维护",
    description: "为源码、配置和业务数据建立可验证备份，并提供恢复前检查和回滚路径。",
    input: "源码、配置、业务数据、版本号和备份目标。",
    background: "升级界面或生产链路前必须能恢复，避免热更新破坏登录态和队列。",
    usage: "大版本或结构变更前执行备份；恢复前先核对版本、路径和校验值。",
    invocation: "手动备份或按设置的周期执行；备份失败只提示，不宣称已完成。",
    operation: "采集 → 打包 → SHA-256 校验 → 记录版本 → 恢复演练。",
    output: "源码包、校验值、恢复点和备份结果。",
    sourcePath: path.join(MAINTENANCE_SKILL_ROOT, "备份工作流技能", "SKILL.md"),
    mode: "documentation_only",
    runLabel: "查看调用说明",
    documentationOnly: true,
    linkedSkills: ["系统自检", "版本发布"],
    safety: "不读取或保存密码、Cookie、Token；恢复和覆盖动作必须明确确认。"
  },
  "aicode-system-quality-check": {
    id: "aicode-system-quality-check",
    title: "系统自检与质量审查",
    category: "系统维护",
    description: "检查技能入口、版本、测试、运行依赖和文档是否一致，输出可追踪的修复清单。",
    input: "项目源码、Git 状态、运行版本、测试结果和说明文档。",
    background: "解决“界面看起来有按钮，但实际没有生效”以及版本漂移问题。",
    usage: "在升级、发布或出现异常时运行；先看报告，再决定是否修改。",
    invocation: "只读检查代码、注册表、运行状态和测试结果，不自动覆盖工作区。",
    operation: "入口扫描 → 版本核对 → 测试核对 → 依赖检查 → 风险分级。",
    output: "通过项、警告项、阻塞项、证据路径和下一步建议。",
    sourcePath: path.join(MAINTENANCE_SKILL_ROOT, "aicode-system-quality-check", "SKILL.md"),
    mode: "documentation_only",
    runLabel: "查看调用说明",
    documentationOnly: true,
    linkedSkills: ["备份与恢复", "版本发布", "技能库检查"],
    safety: "只读诊断；不自动删除缓存、重置 Git 或覆盖未提交修改。"
  },
  "skill-library-check": {
    id: "skill-library-check",
    title: "技能库检查",
    category: "系统维护",
    description: "检查共享技能真源、运行时联接、说明书和注册表是否一致，避免多份源码漂移。",
    input: "技能真源目录、SKILL.md、注册表和运行副本。",
    background: "技能会被多个 AI 和项目调用，必须明确唯一真源和当前可用状态。",
    usage: "升级技能或发现不同 AI 行为不一致时，先运行检查再修改共享真源。",
    invocation: "只读比较目录联接、SKILL.md、注册表和运行副本。",
    operation: "定位真源 → 检查联接 → 检查说明 → 检查注册 → 输出漂移项。",
    output: "技能状态、缺失说明、漂移文件和修复建议。",
    sourcePath: path.join(MAINTENANCE_SKILL_ROOT, "技能库检查技能", "SKILL.md"),
    mode: "documentation_only",
    runLabel: "查看调用说明",
    documentationOnly: true,
    linkedSkills: ["系统自检", "备份与恢复"],
    safety: "发现普通目录或冲突时停止，不静默删除、覆盖或反向同步。"
  },
  "cross-ai-project-status": {
    id: "cross-ai-project-status",
    title: "跨 AI 项目状态",
    category: "系统维护",
    description: "读取项目交接、第二大脑和本地运行证据，生成下一位 AI 可以继续执行的状态摘要。",
    input: "权威入口、任务文件、Git 状态、运行日志摘要和测试证据。",
    background: "避免多个 AI 根据过时聊天片段重复施工或误覆盖正在进行的修改。",
    usage: "交接、换窗口或重新启动开发时先读取；以本地代码和真实测试为最终证据。",
    invocation: "读取权威入口、Git 状态、任务文件和运行报告，不读取完整聊天缓存。",
    operation: "定位任务 → 核对分支 → 汇总事实 → 标记阻塞 → 给出唯一下一步。",
    output: "当前版本、已完成、未完成、阻塞、验证证据和下一动作。",
    sourcePath: path.join(MAINTENANCE_SKILL_ROOT, "跨AI项目状态梳理", "SKILL.md"),
    mode: "documentation_only",
    runLabel: "查看调用说明",
    documentationOnly: true,
    linkedSkills: ["系统自检", "备份与恢复", "项目交接"],
    safety: "工作区脏、分支冲突或事实冲突时只报告，不自动拉取、重置或覆盖。"
  }
};
const tasks = new Map();
const MAX_TASKS = 20;

function now() {
  return new Date().toISOString();
}

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function knowledgeSourceStatus(source = null) {
  if (!source) return null;
  const reportAvailable = Boolean(source.path && exists(source.path));
  const maintainerAvailable = Boolean(source.maintainerPath && exists(source.maintainerPath));
  return {
    ...source,
    path: reportAvailable ? source.path : "",
    maintainerPath: maintainerAvailable ? source.maintainerPath : "",
    available: reportAvailable,
    maintainerAvailable
  };
}

function readMaterialIngestionProfile() {
  if (!exists(MATERIAL_INGESTION_CONFIG)) return null;
  try {
    return JSON.parse(fs.readFileSync(MATERIAL_INGESTION_CONFIG, "utf8"));
  } catch {
    return null;
  }
}

function isDirectory(filePath) {
  try { return fs.statSync(filePath).isDirectory(); } catch { return false; }
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateMaterialIngestionRoots(sourceRoot, materialRoot) {
  const source = String(sourceRoot || "").trim();
  const material = String(materialRoot || "").trim();
  if (!source || !material) throw new Error("请同时提供江湖工具箱下载区和素材库目录");
  if (!path.isAbsolute(source) || !path.isAbsolute(material)) throw new Error("技能路径必须是绝对路径");
  if (!isDirectory(source)) throw new Error("江湖工具箱下载区不存在或不是文件夹");
  if (!isDirectory(material)) throw new Error("图文工作台素材库不存在或不是文件夹");
  if (!isDirectory(path.join(source, "关键词作品"))) throw new Error("下载区缺少 关键词作品 目录");
  const resolvedSource = path.resolve(source);
  const resolvedMaterial = path.resolve(material);
  if (isPathInside(resolvedSource, resolvedMaterial) || isPathInside(resolvedMaterial, resolvedSource)) {
    throw new Error("下载区和素材库不能互相嵌套，避免整理时误扫目标目录");
  }
  return { sourceRoot: resolvedSource, materialRoot: resolvedMaterial };
}

function materialIngestionSkillSettings() {
  const profile = readMaterialIngestionProfile();
  return {
    skillId: MATERIAL_INGESTION_SKILL_ID,
    configPath: exists(MATERIAL_INGESTION_CONFIG) ? MATERIAL_INGESTION_CONFIG : "",
    sourceRoot: String(profile?.paths?.source_root || "").trim(),
    materialRoot: String(profile?.paths?.material_root || "").trim(),
    editable: Boolean(profile && exists(MATERIAL_INGESTION_CONFIG)),
    pathFields: ["sourceRoot", "materialRoot"]
  };
}

function saveMaterialIngestionSkillSettings(body = {}) {
  const profile = readMaterialIngestionProfile();
  if (!profile) throw new Error("素材技能个性化配置不存在或无法读取");
  const roots = validateMaterialIngestionRoots(
    body.sourceRoot ?? profile?.paths?.source_root,
    body.materialRoot ?? profile?.paths?.material_root
  );
  profile.paths = {
    ...(profile.paths || {}),
    source_root: roots.sourceRoot,
    material_root: roots.materialRoot
  };
  fs.writeFileSync(MATERIAL_INGESTION_CONFIG, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  return materialIngestionSkillSettings();
}

function defaultPaths() {
  const agentRoot = process.env.TEAMBUILDING_LEAD_AGENT_ROOT
    || "D:\\AICode\\AI\\private-config\\agents\\jianghu-teambuilding-lead";
  const skillRoot = process.env.TEAMBUILDING_LEAD_SKILL_ROOT
    || "D:\\AICode\\AI\\skills\\技能包\\技能\\wechat-teambuilding-conversion";
  const runtimeRoot = process.env.TEAMBUILDING_LEAD_RUNTIME_ROOT
    || "D:\\AICode\\运行数据\\江湖有旅人\\微信团建客资月度统计";
  return {
    agentRoot,
    skillFile: path.join(skillRoot, "SKILL.md"),
    handoffManifest: path.join(agentRoot, "handoff-manifest.json"),
    profile: path.join(agentRoot, "profile.yaml"),
    secretReferences: path.join(agentRoot, "secret-references.yaml"),
    runtimeState: path.join(runtimeRoot, "state.json"),
    reportRoot: path.join(runtimeRoot, "reports"),
    runtimeValidator: path.join(skillRoot, "scripts", "validate_runtime_state.py"),
    weflowHealthUrl: process.env.TEAMBUILDING_WEFLOW_HEALTH_URL || "http://127.0.0.1:5031/health",
    runner: process.env.TB_LEAD_SYNC_RUNNER
      || path.join(skillRoot, "scripts", "run_lead_sync.py"),
    weflowExecutable: process.env.TEAMBUILDING_WEFLOW_EXECUTABLE
      || "D:\\Program Files\\WeFlow\\WeFlow.exe",
    wechatExecutable: process.env.TEAMBUILDING_WECHAT_EXECUTABLE
      || "D:\\Program Files\\Tencent\\Weixin\\Weixin.exe",
    weflowProcessName: process.env.TEAMBUILDING_WEFLOW_PROCESS || "WeFlow",
    wechatProcessName: process.env.TEAMBUILDING_WECHAT_PROCESS || "Weixin"
  };
}

function leadUrlFromInput(value) {
  const target = String(value || "").trim();
  if (!target) throw new Error("请填写飞书表格链接");
  let parsed;
  try { parsed = new URL(target); } catch { throw new Error("飞书表格链接格式不正确"); }
  if (parsed.protocol !== "https:" || parsed.hostname !== "my.feishu.cn") {
    throw new Error("只允许保存 my.feishu.cn 的 HTTPS 飞书链接");
  }
  const sheetId = String(parsed.searchParams.get("sheet") || "").trim();
  if (!sheetId || !/^[A-Za-z0-9_-]{2,160}$/.test(sheetId)) {
    throw new Error("飞书链接必须包含可用的 sheet 参数，避免运行时写错目标表");
  }
  return { url: parsed.toString(), sheetId };
}

function readLeadRuntimeToken() {
  const fromEnv = String(process.env.WEFLOW_ACCESS_TOKEN || process.env.WEFLOW_API_TOKEN || "").trim();
  if (fromEnv) return fromEnv;
  const configPath = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "WeFlow", "WeFlow-config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const match = raw.match(/"httpApiToken"\s*:\s*"([^"]+)"/);
    return String(match?.[1] || "").trim();
  } catch {
    return "";
  }
}

function readLeadTargetUrl(pageSettings = {}) {
  const fallback = "https://my.feishu.cn/wiki/SCBSw1mcLio8J4kBXricJsK0nDe?sheet=kdUboo";
  const configured = String(process.env.TEAMBUILDING_LEAD_TARGET_URL || "").trim();
  if (configured) return leadUrlFromInput(configured).url;
  const pageConfigured = String(pageSettings?.skills?.leadTargetUrl || "").trim();
  if (pageConfigured) return leadUrlFromInput(pageConfigured).url;
  const profilePath = defaultPaths().profile;
  try {
    const raw = fs.readFileSync(profilePath, "utf8");
    const match = raw.match(/^\s+url:\s*(https:\/\/my\.feishu\.cn\/[^\s]+)\s*$/m);
    return match?.[1] || fallback;
  } catch {
    return fallback;
  }
}

function leadSettings(pageSettings = {}) {
  const targetUrl = readLeadTargetUrl(pageSettings);
  return {
    skillId: SKILL_ID,
    targetUrl,
    targetLabel: String(pageSettings?.skills?.leadTargetLabel || "客资统计表（当前月度 Sheet）").trim() || "客资统计表（当前月度 Sheet）",
    autoStartDependencies: pageSettings?.skills?.leadAutoStartDependencies !== false,
    editable: true,
    pathFields: ["targetUrl"],
    message: "目标表链接属于客资统计技能的专属配置；保存后，技能卡的“打开飞书表格”和下一次预览/写回都会使用同一目标。"
  };
}

function updateLeadProfileTarget(profilePath, targetUrl, sheetId) {
  if (!exists(profilePath)) throw new Error("客资技能 profile 不存在，无法保存飞书目标表");
  const raw = fs.readFileSync(profilePath, "utf8");
  const lines = raw.split(/\r?\n/);
  let inFeishu = false;
  let inLegacy = false;
  let topUrlUpdated = false;
  let legacyUrlUpdated = false;
  let legacySheetUpdated = false;
  const next = lines.map((line) => {
    const indent = (line.match(/^\s*/) || [""])[0].length;
    const trimmed = line.trim();
    if (indent === 2 && trimmed === "feishu:") {
      inFeishu = true;
      inLegacy = false;
      return line;
    }
    if (inFeishu && indent === 2 && trimmed && trimmed !== "feishu:") {
      inFeishu = false;
      inLegacy = false;
    }
    if (inFeishu && indent === 4 && trimmed === "legacy_spreadsheet:") {
      inLegacy = true;
      return line;
    }
    if (inLegacy && indent === 4 && trimmed && trimmed !== "legacy_spreadsheet:") {
      inLegacy = false;
    }
    if (inFeishu && !inLegacy && !topUrlUpdated && /^\s{4}url:\s*/.test(line)) {
      topUrlUpdated = true;
      return line.replace(/^(\s{4}url:\s*).*/, `$1${targetUrl}`);
    }
    if (inLegacy && /^\s{6}url:\s*/.test(line)) {
      legacyUrlUpdated = true;
      return line.replace(/^(\s{6}url:\s*).*/, `$1${targetUrl}`);
    }
    if (inLegacy && /^\s{6}sheet_id:\s*/.test(line)) {
      legacySheetUpdated = true;
      return line.replace(/^(\s{6}sheet_id:\s*).*/, `$1${sheetId}`);
    }
    return line;
  });
  if (!topUrlUpdated || !legacyUrlUpdated || !legacySheetUpdated) {
    throw new Error("客资 profile 缺少 legacy_spreadsheet 目标字段，未保存任何修改");
  }
  const tempPath = `${profilePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, next.join("\n"), "utf8");
  fs.renameSync(tempPath, profilePath);
}

function saveLeadSettings(body = {}, pageSettings = {}) {
  const parsed = leadUrlFromInput(body.targetUrl);
  const label = String(body.targetLabel || "客资统计表（当前月度 Sheet）").trim().slice(0, 120) || "客资统计表（当前月度 Sheet）";
  const profilePath = defaultPaths().profile;
  updateLeadProfileTarget(profilePath, parsed.url, parsed.sheetId);
  const settings = {
    ...(pageSettings.skills || {}),
    leadTargetUrl: parsed.url,
    leadTargetLabel: label,
    leadAutoStartDependencies: body.autoStartDependencies !== false
  };
  const updatedPageSettings = { ...pageSettings, skills: settings };
  return { settings: updatedPageSettings, lead: leadSettings(updatedPageSettings) };
}

function leadOpenTargets({ pageSettings = {} } = {}) {
  const paths = defaultPaths();
  const settings = leadSettings(pageSettings);
  return {
    targetUrl: settings.targetUrl,
    targetLabel: settings.targetLabel,
    reportPath: paths.reportRoot,
    reportLabel: "客资历史运行报告",
    profilePath: paths.profile,
    settings
  };
}

function probeHttp(url, timeoutMs = 1_800) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let request;
    try {
      request = http.get(url, { headers: { Accept: "application/json" } }, (response) => {
        response.resume();
        response.on("end", () => finish({ ok: response.statusCode >= 200 && response.statusCode < 300, statusCode: response.statusCode }));
      });
      request.on("error", (error) => finish({ ok: false, code: error.code || "WEFLOW_UNREACHABLE" }));
      request.setTimeout(timeoutMs, () => {
        request.destroy();
        finish({ ok: false, code: "WEFLOW_HEALTH_TIMEOUT" });
      });
    } catch (error) {
      finish({ ok: false, code: error.code || "WEFLOW_HEALTH_FAILED" });
    }
  });
}

function processRunning(processName) {
  const normalized = String(processName || "").trim().replace(/\.exe$/i, "");
  if (!normalized) return Promise.resolve(false);
  return new Promise((resolve) => {
    childProcess.execFile("tasklist", ["/FI", `IMAGENAME eq ${normalized}.exe`, "/FO", "CSV", "/NH"], { windowsHide: true }, (error, stdout = "") => {
      if (error) return resolve(false);
      resolve(String(stdout).toLowerCase().includes(`"${normalized.toLowerCase()}.exe"`));
    });
  });
}

function launchConfiguredProcess(executable) {
  if (!executable || !exists(executable)) return { ok: false, reason: "executable_missing" };
  try {
    const child = childProcess.spawn(executable, [], { detached: true, windowsHide: false, stdio: "ignore" });
    child.unref();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.code || "launch_failed" };
  }
}

async function waitForHealth(url, attempts = 12, intervalMs = 650) {
  let result = await probeHttp(url);
  for (let index = 0; index < attempts && !result.ok; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    result = await probeHttp(url);
  }
  return result;
}

function publicLeadPreflight(result = {}) {
  return {
    wechat: result.wechat || { running: false, started: false },
    weflow: result.weflow || { running: false, started: false, healthy: false },
    actions: Array.isArray(result.actions) ? result.actions : [],
    message: result.message || "已完成运行前检查"
  };
}

async function prepareLeadDependencies(paths, { autoStart = true } = {}) {
  const actions = [];
  const wechatWasRunning = await processRunning(paths.wechatProcessName);
  let wechatRunning = wechatWasRunning;
  if (!wechatRunning && autoStart) {
    const launched = launchConfiguredProcess(paths.wechatExecutable);
    if (launched.ok) {
      actions.push("已启动微信，等待本机登录态");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      wechatRunning = await processRunning(paths.wechatProcessName);
    } else {
      actions.push(launched.reason === "executable_missing" ? "未找到微信可执行文件" : "微信启动失败");
    }
  } else if (!wechatRunning) {
    actions.push("微信未启动，已按设置跳过自动启动");
  }

  let health = await probeHttp(paths.weflowHealthUrl);
  const weflowWasRunning = await processRunning(paths.weflowProcessName);
  let weflowRunning = weflowWasRunning;
  if (!health.ok && autoStart) {
    const launched = launchConfiguredProcess(paths.weflowExecutable);
    if (launched.ok) {
      actions.push("已启动 WeFlow，等待本地 API");
      health = await waitForHealth(paths.weflowHealthUrl);
      weflowRunning = await processRunning(paths.weflowProcessName);
    } else {
      actions.push(launched.reason === "executable_missing" ? "未找到 WeFlow 可执行文件" : "WeFlow 启动失败");
    }
  } else if (!health.ok) {
    actions.push("WeFlow API 未连接，已按设置跳过自动启动");
  } else {
    actions.push("WeFlow 本地 API 已连接");
  }
  if (!wechatRunning) actions.push("微信尚未确认运行；如果 WeFlow 需要微信数据，请先登录并打开目标会话");
  if (!health.ok) actions.push("WeFlow 未就绪，未读取聊天、未读取飞书、未写回表格");
  return {
    wechat: { running: wechatRunning, started: !wechatWasRunning && wechatRunning },
    weflow: { running: weflowRunning, started: !weflowWasRunning && weflowRunning, healthy: Boolean(health.ok), healthCode: health.code || "OK" },
    actions,
    message: health.ok ? "依赖检查完成，继续检查授权与运行水位" : "依赖检查未通过，已停止在安全边界"
  };
}

function publicStep(id, label, state = "pending", detail = "") {
  return { id, label, state, detail };
}

function initialSteps() {
  return [
    publicStep("prepare", "读取技能与专属配置"),
    publicStep("authorize", "检查 WeFlow 与飞书授权"),
    publicStep("read", "读取上次水位之后的新消息"),
    publicStep("normalize", "提取字段并区分本人、同事"),
    publicStep("dedupe", "按联系方式与证据查重"),
    publicStep("preview", "生成新增、重复、复核预览"),
    publicStep("commit", "追加到目标表并回读核验"),
    publicStep("advance", "仅在回读通过后推进水位")
  ];
}

function publicTask(task) {
  return {
    id: task.id,
    skillId: task.skillId,
    mode: task.mode,
    state: task.state,
    progress: task.progress,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    steps: task.steps,
    preflight: task.preflight || null,
    result: task.result || null,
    error: task.error || null
  };
}

function publicRunnerResult(result) {
  if (!result || typeof result !== "object") return null;
  const allowed = [
    "receivedMessages", "images", "candidateCount", "colleagueFiltered",
    "qualified", "review", "excluded", "duplicates", "newLeads",
    "historicalSkipped", "relatedGroupsReadFailed", "written", "readBack", "watermarkAdvanced", "reportPath", "status",
    "code", "nextStep", "targetUrl", "targetSheet"
  ];
  const output = {};
  for (const key of allowed) {
    if (result[key] !== undefined) output[key] = result[key];
  }
  return output;
}

function nativeSkill(id) {
  return NATIVE_SKILLS[id] || null;
}

function projectSkill(id) {
  return PROJECT_SKILLS[id] || null;
}

function projectSkillStatus(skill) {
  const sourceAvailable = Boolean(skill && exists(skill.sourcePath));
  return {
    overallStatus: sourceAvailable ? "docs_only" : "blocked",
    sourceAvailable,
    sourcePath: sourceAvailable ? skill.sourcePath : "",
    canRun: false,
    documentationOnly: true,
    checkedAt: now(),
    issues: sourceAvailable ? [{ code: "DOCUMENTATION_ONLY", label: "当前为说明入口，尚未绑定安全执行器" }] : [{ code: "SKILL_DOC_MISSING", label: "技能说明书不存在" }]
  };
}

function publicProjectSkill(skill) {
  return {
    ...skill,
    status: projectSkillStatus(skill)
  };
}

function baseNativeSkillStatus(skill) {
  const sourceAvailable = Boolean(skill && exists(skill.sourcePath));
  return {
    overallStatus: sourceAvailable ? "ready" : "blocked",
    sourceAvailable,
    sourcePath: sourceAvailable ? skill.sourcePath : "",
    knowledgeSource: knowledgeSourceStatus(skill?.knowledgeSource),
    canRun: sourceAvailable,
    checkedAt: now()
  };
}

function deviceFolderTransferSkillStatus(skill = NATIVE_SKILLS[DEVICE_TRANSFER_SKILL_ID]) {
  const sourceAvailable = Boolean(skill && exists(skill.sourcePath));
  const transferScriptAvailable = exists(DEVICE_TRANSFER_SCRIPT);
  const registryAvailable = exists(DEVICE_TRANSFER_REGISTRY);
  const issues = [];
  if (!sourceAvailable) issues.push({ code: "SKILL_DOC_MISSING", label: "设备分发技能说明书不存在" });
  if (!transferScriptAvailable) issues.push({ code: "DEVICE_TRANSFER_SCRIPT_MISSING", label: "设备传输执行器不存在" });
  if (!registryAvailable) issues.push({ code: "DEVICE_REGISTRY_MISSING", label: "设备注册表不存在" });
  return {
    overallStatus: sourceAvailable && transferScriptAvailable && registryAvailable ? "ready" : "blocked",
    sourceAvailable,
    transferScriptAvailable,
    registryAvailable,
    sourcePath: sourceAvailable ? skill.sourcePath : "",
    canRun: sourceAvailable && transferScriptAvailable && registryAvailable,
    documentationOnly: false,
    mode: "device_transfer_check",
    issues,
    checkedAt: now()
  };
}

function materialIngestionSkillStatus(skill = NATIVE_SKILLS[MATERIAL_INGESTION_SKILL_ID], options = {}) {
  const sourceAvailable = Boolean(skill && exists(skill.sourcePath));
  const scriptAvailable = exists(MATERIAL_INGESTION_SCRIPT);
  const configAvailable = exists(MATERIAL_INGESTION_CONFIG);
  const profile = readMaterialIngestionProfile();
  const sourceRoot = String(profile?.paths?.source_root || "").trim();
  const targetRoot = String(profile?.paths?.material_root || "").trim();
  const sourceStructureAvailable = Boolean(sourceRoot && exists(path.join(sourceRoot, "关键词作品")));
  const enabled = options.enabled !== false;
  const canRun = enabled && sourceAvailable && scriptAvailable && configAvailable && sourceStructureAvailable && Boolean(targetRoot && exists(targetRoot));
  const issues = [];
  if (!enabled) issues.push({ code: "SKILL_DISABLED", label: "技能已在技能中心的专属设置中关闭" });
  if (!sourceAvailable) issues.push({ code: "SKILL_DOC_MISSING", label: "技能说明书不存在" });
  if (!scriptAvailable) issues.push({ code: "MATERIAL_SCRIPT_MISSING", label: "素材整理脚本不存在" });
  if (!configAvailable) issues.push({ code: "MATERIAL_CONFIG_MISSING", label: "素材技能个性化配置不存在" });
  if (configAvailable && !sourceStructureAvailable) issues.push({ code: "MATERIAL_SOURCE_UNAVAILABLE", label: "下载区缺少 关键词作品 目录" });
  if (configAvailable && (!targetRoot || !exists(targetRoot))) issues.push({ code: "MATERIAL_TARGET_UNAVAILABLE", label: "图文工作台素材库目录不存在" });
  return {
    overallStatus: !enabled ? "disabled" : canRun ? "ready" : "blocked",
    sourceAvailable,
    scriptAvailable,
    configAvailable,
    sourceStructureAvailable,
    sourceRoot,
    targetRoot,
    sourcePath: sourceAvailable ? skill.sourcePath : "",
    configPath: configAvailable ? MATERIAL_INGESTION_CONFIG : "",
    canRun,
    documentationOnly: false,
    mode: "preview_then_commit",
    settings: materialIngestionSkillSettings(),
    checkedAt: now(),
    issues
  };
}

function nativeSkillStatus(skill, options = {}) {
  if (skill?.id === MATERIAL_INGESTION_SKILL_ID) return materialIngestionSkillStatus(skill, options);
  if (skill?.id === TEMPLATE_REPOSITORY_SKILL_ID) return templateRepositorySkillStatus(skill);
  if (skill?.id === DEVICE_TRANSFER_SKILL_ID) return deviceFolderTransferSkillStatus(skill);
  return baseNativeSkillStatus(skill);
}

function nativeSteps(skill) {
  return (skill?.flow || []).map((label, index) => publicStep(`native-${index}`, label));
}

function templateRepositorySkillStatus(skill = NATIVE_SKILLS[TEMPLATE_REPOSITORY_SKILL_ID]) {
  const base = baseNativeSkillStatus(skill);
  const required = [TEMPLATE_REPOSITORY_PROJECT_ROOT, TEMPLATE_REPOSITORY_WORKFLOW_ROOT, TEMPLATE_REPOSITORY_ROOT];
  const rootsAvailable = required.every((item) => exists(item));
  return {
    ...base,
    overallStatus: base.sourceAvailable && rootsAvailable ? "ready" : "blocked",
    rootsAvailable,
    canRun: base.sourceAvailable && rootsAvailable,
    intakeRoot: rootsAvailable ? TEMPLATE_REPOSITORY_INTAKE_ROOT : "",
    repository: templateRepositoryEntry(),
    checkedAt: now()
  };
}

function templateRepositoryEntry() {
  const candidates = [
    { scope: "global", label: "全局模板仓库", path: TEMPLATE_REPOSITORY_HTML },
    { scope: "project", label: "当前项目模板仓库", path: TEMPLATE_PROJECT_LEDGER_HTML }
  ];
  const selected = candidates.find((item) => exists(item.path)) || candidates[0];
  return {
    available: exists(selected.path),
    scope: selected.scope,
    label: selected.label,
    path: selected.path,
    globalPath: TEMPLATE_REPOSITORY_HTML,
    projectPath: TEMPLATE_PROJECT_LEDGER_HTML
  };
}

function readTemplateGalleryMetadata() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TEMPLATE_GALLERY_REGISTRY, "utf8"));
    const templates = Array.isArray(parsed?.templates) ? parsed.templates : [];
    return {
      path: TEMPLATE_GALLERY_REGISTRY,
      records: templates.map((item) => ({
        id: String(item?.id || item?.templateId || ""),
        updatedAt: String(item?.updatedAt || ""),
        mtime: String(item?.mtime || ""),
        addedAt: String(item?.addedAt || "")
      })).filter((item) => item.id)
    };
  } catch {
    return { path: TEMPLATE_GALLERY_REGISTRY, records: [] };
  }
}

function readTemplateCollectorLedger() {
  if (!exists(TEMPLATE_COLLECTOR_LEDGER)) return { schemaVersion: 1, records: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(TEMPLATE_COLLECTOR_LEDGER, "utf8"));
    return {
      schemaVersion: 1,
      records: Array.isArray(parsed?.records) ? parsed.records.filter((item) => item && typeof item === "object") : []
    };
  } catch {
    return { schemaVersion: 1, records: [] };
  }
}

function writeTemplateCollectorLedger(ledger) {
  fs.mkdirSync(path.dirname(TEMPLATE_COLLECTOR_LEDGER), { recursive: true });
  const temp = `${TEMPLATE_COLLECTOR_LEDGER}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify({ schemaVersion: 1, records: ledger.records || [] }, null, 2)}\n`, "utf8");
  fs.renameSync(temp, TEMPLATE_COLLECTOR_LEDGER);
  return TEMPLATE_COLLECTOR_LEDGER;
}

function isAllowedXhsUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["xhslink.cn", "www.xhslink.cn", "xhslink.com", "www.xhslink.com", "xiaohongshu.com", "www.xiaohongshu.com"]
      .includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizeTemplateCollectorRequest(body = {}) {
  const explicitSourceUrl = String(body.sourceUrl || body.shareUrl || "").trim().slice(0, 2000);
  const rawText = String(body.text || "").trim();
  const textUrl = !explicitSourceUrl
    ? (rawText.match(/https?:\/\/[^\s<>"'，。！？；、：,;\)\]}）】》]+/i)?.[0] || "").replace(/[），。！？；;,)\]}）】》]+$/g, "")
    : "";
  const inputUrl = explicitSourceUrl || textUrl;
  const textId = /^[a-f0-9]{24}$/i.test(rawText) ? rawText : "";
  const urlNoteId = xhsTemplateCollector.parseNoteIdFromHref(inputUrl);
  const normalized = xhsTemplateCollector.normalizeCollectorInput({
    ...body,
    noteId: body.noteId || urlNoteId || textId,
    sourceUrl: inputUrl || body.sourceUrl || body.shareUrl || "",
    stats: body.stats || body
  });
  if (inputUrl && !isAllowedXhsUrl(inputUrl)) {
    throw Object.assign(new Error("来源链接必须是小红书或 xhslink.cn 公开链接"), { code: "TEMPLATE_COLLECTOR_SOURCE_URL_INVALID" });
  }
  if (!normalized.noteId && !inputUrl) {
    throw Object.assign(new Error("请输入 24 位笔记 ID，或粘贴小红书公开分享链接"), { code: "TEMPLATE_COLLECTOR_INPUT_INVALID" });
  }
  const sourceUrl = inputUrl || normalized.canonicalUrl;
  if (!sourceUrl) throw Object.assign(new Error("没有可供下载器尝试的笔记地址"), { code: "TEMPLATE_COLLECTOR_SOURCE_URL_INVALID" });
  return {
    ...normalized,
    sourceUrl,
    sourceUrlProvided: Boolean(inputUrl),
    sourcePageUrl: normalized.sourcePageUrl || "",
    requestedAt: now()
  };
}

function collectorStatusLabel(status) {
  return ({
    queued: "已加入下载队列",
    running: "正在下载",
    downloaded: "已下载并登记",
    candidate_ready: "已入模板库·待确认",
    blocked: "采集器已暂停，等待恢复",
    needs_source_link: "待补真实小红书链接",
    download_failed: "下载失败，可补链后重试"
  })[status] || "已登记";
}

function publicCollectorRecord(record) {
  if (!record) return null;
  return {
    dedupeKey: record.dedupeKey,
    noteId: record.noteId,
    title: record.title,
    imageCount: record.imageCount,
    stats: record.stats,
    status: record.status,
    statusLabel: record.statusLabel || collectorStatusLabel(record.status),
    taskId: record.taskId || "",
    sourcePageUrl: record.sourcePageUrl || "",
    sourceUrl: record.sourceUrl || "",
    sourceLinkStatus: record.sourceLinkStatus || "",
    intakePath: record.intakePath || "",
    bridgeJobId: record.bridgeJobId || "",
    progress: Number.isFinite(Number(record.progress)) ? Number(record.progress) : null,
    step: record.step || "",
    error: record.error && typeof record.error === "object"
      ? { code: String(record.error.code || ""), message: String(record.error.message || "").slice(0, 240) }
      : null,
    createdAt: record.createdAt || "",
    updatedAt: record.updatedAt || ""
  };
}

function findTemplateCollectorRecord(ledger, dedupeKey) {
  return ledger.records.find((item) => item.dedupeKey === dedupeKey) || null;
}

function updateTemplateCollectorRecord(task, result, error = null) {
  const collector = task?.collector;
  if (!collector?.dedupeKey) return null;
  const ledger = readTemplateCollectorLedger();
  const record = findTemplateCollectorRecord(ledger, collector.dedupeKey);
  if (!record) return null;
  const status = error
    ? "download_failed"
    : result?.status === "blocked" ? "blocked"
      : result?.status === "candidate_ready" ? "candidate_ready"
      : result?.status === "download_failed" ? "download_failed"
        : result?.status === "sync_incomplete" ? "downloaded"
          : "downloaded";
  Object.assign(record, {
    status,
    statusLabel: collectorStatusLabel(status),
    taskId: task.id,
    updatedAt: now(),
    intakePath: result?.intakePath || record.intakePath || "",
    bridgeJobId: result?.download?.bridgeJobId || result?.bridgeJobId || record.bridgeJobId || "",
    progress: Number.isFinite(Number(task.progress)) ? Number(task.progress) : record.progress,
    step: task.steps?.find((item) => item.state === "running")?.label || result?.nextStep || record.step || "",
    error: error
      ? { code: error.code || "TEMPLATE_COLLECTOR_FAILED", message: String(error.message || "下载失败").slice(0, 240) }
      : (["blocked", "download_failed"].includes(status) && result?.download?.error
        ? { code: result.download.bridgeStatus === "blocked" ? "COLLECTOR_BRIDGE_BLOCKED" : "TEMPLATE_COLLECTOR_FAILED", message: String(result.download.error).slice(0, 240) }
        : null)
  });
  writeTemplateCollectorLedger(ledger);
  return record;
}

function createTemplateCollectorTask(input, collector, ctx) {
  const skill = NATIVE_SKILLS[TEMPLATE_REPOSITORY_SKILL_ID];
  const task = {
    id: `template-collector-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    skillId: TEMPLATE_REPOSITORY_SKILL_ID,
    mode: skill.mode,
    state: "queued",
    progress: 0,
    createdAt: now(),
    updatedAt: now(),
    steps: nativeSteps(skill),
    input: { text: input.sourceUrl },
    collector,
    persistCollectorLedger: false
  };
  tasks.set(task.id, task);
  while (tasks.size > MAX_TASKS) tasks.delete(tasks.keys().next().value);
  executeNativeTask(task, ctx).catch((error) => {
    updateTask(task, { state: "failed", error: { code: error.code || "SKILL_EXECUTION_FAILED", message: "模板采集任务异常结束，未宣称下载完成。" } });
    if (task.persistCollectorLedger !== false) updateTemplateCollectorRecord(task, null, error);
  });
  return task;
}

function normalizeTemplateRepositoryInput(body = {}) {
  const text = String(body.text || "").trim().slice(0, 240_000);
  const paths = [...new Set((Array.isArray(body.paths) ? body.paths : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean))].slice(0, 24);
  const files = (Array.isArray(body.files) ? body.files : []).slice(0, 8).map((file, index) => ({
    name: String(file?.name || `粘贴图片-${index + 1}.png`).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 120),
    dataUrl: String(file?.dataUrl || "").slice(0, 8_000_000)
  })).filter((file) => /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(file.dataUrl));
  // 分享文案经常用中文逗号、分号或顿号连续粘贴多个链接；这些分隔符
  // 不能被吞进上一个 URL，否则多个素材会被错误地当成一条链接提交。
  const urls = [...new Set((text.match(/https?:\/\/[^\s<>"'，。！？；、：,;\)\]}）】》」』]+/gi) || [])
    .map((url) => url.replace(/[），。！？；;,\)\]}）】》」』]+$/g, "")))].slice(0, 20);
  return { text, paths, files, urls };
}

function hasTemplateRepositoryInput(input = {}) {
  return Boolean(String(input.text || "").trim())
    || input.urls.length > 0
    || input.paths.length > 0
    || input.files.length > 0;
}

function isInsideAnyTemplateRoot(target, roots) {
  const resolved = path.resolve(target);
  return roots.some((root) => {
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(`${base}${path.sep}`);
  });
}

function validateTemplateRepositoryPaths(paths = []) {
  const allowedRoots = [
    TEMPLATE_REPOSITORY_PROJECT_ROOT,
    TEMPLATE_REPOSITORY_ROOT,
    "D:\\Download",
    process.env.USERPROFILE || ""
  ].filter(Boolean);
  const accepted = [];
  const rejected = [];
  paths.forEach((candidate) => {
    const resolved = path.resolve(candidate);
    if (!isInsideAnyTemplateRoot(resolved, allowedRoots) || !exists(resolved)) {
      rejected.push({ path: candidate, reason: "路径不存在，或不在允许的本地范围内" });
      return;
    }
    accepted.push(resolved);
  });
  return { accepted, rejected };
}

function parseProcessJson(stdout = "") {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const start = text.lastIndexOf("{");
  if (start >= 0) {
    try { return JSON.parse(text.slice(start)); } catch {}
  }
  return null;
}

function runChild(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = childProcess.spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ ok: false, code: "PROCESS_TIMEOUT", stdout, stderr });
    }, Number(options.timeoutMs || 15 * 60 * 1000));
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-2_000_000); });
    child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-40_000); });
    child.on("error", (error) => finish({ ok: false, code: error.code || "PROCESS_ERROR", stdout, stderr, error: error.message }));
    child.on("close", (code) => finish({ ok: code === 0, code, stdout, stderr }));
  });
}

function runWorkflowNpmScript(script, options = {}) {
  if (process.platform === "win32") {
    return runChild(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm.cmd run ${script}`], options);
  }
  return runChild("npm", ["run", script], options);
}

function materialIngestionCommandArgs(mode = "preview") {
  const quote = (value) => `'${String(value || "").replace(/'/g, "''")}'`;
  const preview = mode !== "commit" ? " -Preview" : "";
  const command = `$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); & ${quote(MATERIAL_INGESTION_SCRIPT)} -ConfigPath ${quote(MATERIAL_INGESTION_CONFIG)}${preview}; exit $LASTEXITCODE`;
  return ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command];
}

function resolvePowerShellExecutable() {
  if (process.env.TB_POWERSHELL) return process.env.TB_POWERSHELL;
  const candidates = process.platform === "win32" ? ["pwsh", "powershell.exe"] : ["pwsh", "powershell"];
  for (const candidate of candidates) {
    try {
      const probe = childProcess.spawnSync(candidate, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore", windowsHide: true });
      if (!probe.error && probe.status === 0) return candidate;
    } catch { /* try the next installed PowerShell */ }
  }
  return candidates[candidates.length - 1];
}

function parseMaterialIngestionOutput(output = "", mode = "preview") {
  const text = String(output || "");
  const identified = text.match(/识别到：\s*(\d+)\s*个可入库帖子，\s*(\d+)\s*个空帖子目录，\s*(\d+)\s*个残留待确认目录/);
  const completed = text.match(/已移动\s*(\d+)\s*个帖子；已删除\s*(\d+)\s*个空帖子目录；保留\s*(\d+)\s*个残留目录/);
  return {
    kind: "material_ingestion",
    mode,
    status: mode === "preview" ? "preview_ready" : "completed",
    completePosts: Number(identified?.[1] || completed?.[1] || 0),
    emptyPosts: Number(identified?.[2] || completed?.[2] || 0),
    residualDirs: Number(identified?.[3] || completed?.[3] || 0),
    moved: Number(completed?.[1] || 0),
    removedEmptyPosts: Number(completed?.[2] || 0),
    preservedResidualDirs: Number(completed?.[3] || identified?.[3] || 0),
    previewPreserved: mode === "preview"
  };
}

async function runMaterialIngestionSkill(task) {
  const status = materialIngestionSkillStatus(NATIVE_SKILLS[MATERIAL_INGESTION_SKILL_ID]);
  if (!status.canRun) {
    const error = new Error(status.issues.map((item) => item.label).join("；") || "素材处理技能当前不可运行");
    error.code = status.overallStatus === "disabled" ? "SKILL_DISABLED" : "MATERIAL_PRECHECK_BLOCKED";
    throw error;
  }
  const powershell = resolvePowerShellExecutable();
  const mode = task.mode === "commit" ? "commit" : "preview";
  const child = await runChild(powershell, materialIngestionCommandArgs(mode), {
    cwd: MATERIAL_INGESTION_SKILL_ROOT,
    timeoutMs: 15 * 60 * 1000,
    env: { PYTHONIOENCODING: "utf-8" }
  });
  if (!child.ok) {
    const error = new Error((child.stderr || child.stdout || child.error || "素材整理脚本运行失败")
      .split(/\r?\n/).find(Boolean)?.slice(0, 360) || "素材整理脚本运行失败");
    error.code = child.code === "PROCESS_TIMEOUT" ? "MATERIAL_PROCESS_TIMEOUT" : "MATERIAL_PROCESS_FAILED";
    throw error;
  }
  const result = parseMaterialIngestionOutput(`${child.stdout}\n${child.stderr}`, mode);
  return {
    ...result,
    sourceRoot: status.sourceRoot,
    targetRoot: status.targetRoot,
    configPath: status.configPath,
    nextStep: mode === "preview"
      ? "预览已完成；核对完整帖子、20 字命名、标签和残留后，再点击“确认整理”。"
      : "回到内容制作的素材区刷新，查看批次、标签台账和残留清单。"
  };
}

async function requestTemplateCollectorBridge(pathname, options = {}, timeoutMs = 15_000) {
  if (typeof fetch !== "function") {
    return { ok: false, code: "COLLECTOR_BRIDGE_FETCH_UNAVAILABLE", error: "当前 Node 运行时没有可用的 HTTP fetch" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${TEMPLATE_COLLECTOR_BRIDGE_URL}${pathname}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { error: text.slice(0, 500) }; }
    return response.ok
      ? { ok: true, status: response.status, payload }
      : { ok: false, status: response.status, code: payload?.code || "COLLECTOR_BRIDGE_HTTP_ERROR", error: payload?.error || `采集桥接器 HTTP ${response.status}`, payload };
  } catch (error) {
    return { ok: false, code: error?.name === "AbortError" ? "COLLECTOR_BRIDGE_TIMEOUT" : (error?.cause?.code || error?.code || "COLLECTOR_BRIDGE_UNAVAILABLE"), error: String(error?.message || "采集桥接器无响应").slice(0, 360) };
  } finally {
    clearTimeout(timer);
  }
}

let templateCollectorBridgeStartPromise = null;
async function ensureTemplateCollectorBridge() {
  if (templateCollectorBridgeStartPromise) return templateCollectorBridgeStartPromise;
  templateCollectorBridgeStartPromise = (async () => {
    const script = path.join(TEMPLATE_COLLECTOR_BRIDGE_ROOT, "collector_bridge_api.py");
    if (!exists(script)) throw Object.assign(new Error(`万能采集器 API 启动脚本不存在：${script}`), { code: "COLLECTOR_BRIDGE_SCRIPT_MISSING" });
    const port = Number(new URL(TEMPLATE_COLLECTOR_BRIDGE_URL).port || 8766);
    let childError = null;
    let child;
    try {
      child = childProcess.spawn(process.env.TEAMBUILDING_COLLECTOR_PYTHON || "python", [script, "--host", "127.0.0.1", "--port", String(port)], {
        cwd: TEMPLATE_COLLECTOR_BRIDGE_ROOT,
        windowsHide: true,
        detached: process.platform === "win32",
        env: {
          ...process.env,
          XHS_DL_CLAIM_DIR: process.env.XHS_DL_CLAIM_DIR
            || path.join(TEMPLATE_COLLECTOR_BRIDGE_ROOT, "runtime", "download_claims")
        },
        stdio: "ignore"
      });
      child.once("error", (error) => { childError = error; });
      child.unref();
    } catch (error) {
      throw Object.assign(new Error(`万能采集器 API 启动失败：${error.message}`), { code: error.code || "COLLECTOR_BRIDGE_START_FAILED" });
    }
    const deadline = Date.now() + 15_000;
    let lastProbe = null;
    while (Date.now() < deadline) {
      if (childError) throw Object.assign(new Error(`万能采集器 API 启动失败：${childError.message}`), { code: childError.code || "COLLECTOR_BRIDGE_START_FAILED" });
      lastProbe = await requestTemplateCollectorBridge("/api/v1/status", {}, 1800);
      if (lastProbe.ok && lastProbe.payload?.api_online !== false) return lastProbe;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw Object.assign(new Error(`万能采集器 API 未能在 15 秒内启动：${lastProbe?.error || "健康检查超时"}`), { code: "COLLECTOR_BRIDGE_START_TIMEOUT" });
  })().finally(() => { templateCollectorBridgeStartPromise = null; });
  return templateCollectorBridgeStartPromise;
}

function updateTemplateCollectorBridgeTask(task, bridgeJob) {
  if (!task || !bridgeJob) return;
  const links = Array.isArray(bridgeJob.links) ? bridgeJob.links : [];
  const total = Math.max(1, links.length || Number(bridgeJob.result?.total || 1));
  const terminal = new Set(["completed", "failed", "blocked", "validated"]);
  const finished = links.filter((link) => terminal.has(String(link?.status || ""))).length;
  const current = links.find((link) => String(link?.status || "") === "running") || links.find((link) => !terminal.has(String(link?.status || "")));
  const bridgeStatus = String(bridgeJob.status || "queued");
  let progress = 20 + Math.round((finished / total) * 60);
  if (bridgeStatus === "completed" || bridgeStatus === "partial") progress = 82;
  if (bridgeStatus === "blocked" || bridgeStatus === "failed") progress = 42;
  const detail = current?.error
    ? `桥接器：${String(current.error).slice(0, 180)}`
    : current?.status === "running"
      ? `桥接器正在处理：${String(current.title_hint || current.url || "当前链接").slice(0, 120)}`
      : `桥接器状态：${bridgeStatus}（${finished}/${total}）`;
  updateTask(task, { progress, result: { ...(task.result || {}), bridgeJobId: bridgeJob.job_id || "", bridgeStatus, bridgeProgress: progress } });
  const step = task.steps?.[1];
  if (step) setStep(task, step.id, terminal.has(bridgeStatus) ? (bridgeStatus === "completed" || bridgeStatus === "partial" ? "completed" : "failed") : "running", detail);
}

function templateCollectorBridgePayload(bridgeJob, outputDir) {
  const links = Array.isArray(bridgeJob?.links) ? bridgeJob.links : [];
  const items = links.map((link) => {
    const metadata = link?.metadata && typeof link.metadata === "object" ? link.metadata : {};
    const assets = Array.isArray(link?.assets) ? link.assets : [];
    const imageCount = Number(metadata.images_count || metadata.image_count || assets.filter((asset) => asset?.kind === "image").length || 0);
    const saveDir = String(metadata.target_dir || (assets[0]?.path ? path.dirname(String(assets[0].path)) : ""));
    return {
      url: String(link?.url || ""),
      success: link?.success === true || link?.status === "completed",
      title: String(metadata.title || link?.title_hint || ""),
      note_id: String(metadata.note_id || ""),
      save_dir: saveDir,
      image_count: imageCount,
      stats: {
        likes: String(metadata.stats?.likes || metadata.likes || ""),
        collections: String(metadata.stats?.collections || metadata.collections || metadata.favorites || ""),
        comments: String(metadata.stats?.comments || metadata.comments || "")
      },
      media_format: imageCount ? "image" : "",
      assets: assets.map((asset) => ({
        index: Number.isInteger(Number(asset?.index)) ? Number(asset.index) : null,
        name: String(asset?.name || ""),
        kind: String(asset?.kind || ""),
        size: Number(asset?.size || 0)
      })),
      error: String(link?.error || "")
    };
  });
  const success = items.filter((item) => item.success).length;
  const failed = items.length - success;
  const firstError = items.find((item) => item.error)?.error || String(bridgeJob?.error || "");
  return {
    bridgeJobId: String(bridgeJob?.job_id || ""),
    bridgeStatus: String(bridgeJob?.status || ""),
    success,
    failed,
    total: items.length,
    output_dir: outputDir,
    items,
    error: firstError
  };
}

async function runTemplateRepositoryDownload(text, outputDir, task = null) {
  const capabilities = await requestTemplateCollectorBridge("/api/v1/capabilities");
  if (!capabilities.ok) {
    return { ok: false, code: capabilities.code, payload: { error: capabilities.error || "采集桥接器不可用" } };
  }
  const authentication = capabilities.payload?.authentication && typeof capabilities.payload.authentication === "object"
    ? { ...capabilities.payload.authentication }
    : {};
  const submitted = await requestTemplateCollectorBridge("/api/v1/jobs", {
    method: "POST",
    body: JSON.stringify({
      text,
      client: { name: "template-gallery", version: "1" },
      conversation_id: `template-gallery-${Date.now()}`,
      options: {
        image_format: "keep",
        max_images: 30,
        template_library: true,
        // 只有用户明确提交带 xsec_token 的分享长链，才允许单次手动绕过
        // 后台暂停标记；ID/普通链接在未暂停时会直接尝试公开笔记页。
        manual_override: /[?&]xsec_token=[^&\s]+/i.test(text)
      }
    })
  }, 30_000);
  if (!submitted.ok || !submitted.payload?.job_id) {
    return { ok: false, code: submitted.code || "COLLECTOR_BRIDGE_SUBMIT_FAILED", payload: { error: submitted.error || "采集任务没有进入桥接器" } };
  }

  let bridgeJob = submitted.payload;
  updateTemplateCollectorBridgeTask(task, bridgeJob);
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const status = await requestTemplateCollectorBridge(`/api/v1/jobs/${encodeURIComponent(bridgeJob.job_id)}`, {}, 30_000);
    if (!status.ok || !status.payload) {
      return { ok: false, code: status.code || "COLLECTOR_BRIDGE_STATUS_FAILED", payload: { error: status.error || "采集任务状态读取失败", bridgeJobId: bridgeJob.job_id } };
    }
    bridgeJob = status.payload;
    updateTemplateCollectorBridgeTask(task, bridgeJob);
    if (["completed", "partial", "blocked", "failed"].includes(String(bridgeJob.status || ""))) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!["completed", "partial", "blocked", "failed"].includes(String(bridgeJob.status || ""))) {
    return { ok: false, code: "COLLECTOR_BRIDGE_TIMEOUT", payload: { ...templateCollectorBridgePayload(bridgeJob, outputDir), error: "采集桥接任务超过 15 分钟，已停止等待" } };
  }
  const payload = templateCollectorBridgePayload(bridgeJob, outputDir);
  payload.authentication = authentication;
  const status = String(bridgeJob.status || "");
  return {
    ok: status === "completed" && payload.success > 0 && payload.failed === 0,
    code: status === "blocked" ? "COLLECTOR_BRIDGE_BLOCKED" : (status === "failed" ? "COLLECTOR_BRIDGE_FAILED" : (payload.failed ? "DOWNLOAD_PARTIAL" : "OK")),
    payload
  };
}

async function fetchTemplateCollectorAssets(downloadPayload = {}) {
  const jobId = String(downloadPayload.bridgeJobId || "");
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(jobId)) {
    throw Object.assign(new Error("采集回执缺少有效任务编号，无法取回已下载图片"), { code: "COLLECTOR_ASSET_JOB_INVALID" });
  }
  const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".avif", ".mp4", ".mov", ".webm", ".txt", ".md"]);
  const assets = [];
  let totalBytes = 0;
  for (const item of Array.isArray(downloadPayload.items) ? downloadPayload.items : []) {
    for (const asset of Array.isArray(item?.assets) ? item.assets : []) {
      const index = Number(asset?.index);
      if (!Number.isInteger(index) || index < 0) continue;
      const originalName = path.basename(String(asset.name || `asset-${index + 1}`));
      const extension = path.extname(originalName).toLowerCase();
      if (!allowedExtensions.has(extension)) continue;
      const expectedSize = Number(asset.size || 0);
      if (expectedSize > 100 * 1024 * 1024) {
        throw Object.assign(new Error(`采集文件过大，已停止写入：${originalName}`), { code: "COLLECTOR_ASSET_TOO_LARGE" });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      let response;
      try {
        response = await fetch(`${TEMPLATE_COLLECTOR_BRIDGE_URL}/api/v1/jobs/${encodeURIComponent(jobId)}/files/${index}`, {
          signal: controller.signal,
          cache: "no-store"
        });
      } catch (error) {
        throw Object.assign(new Error(`读取采集文件失败：${originalName}（${String(error?.message || "本机 API 无响应").slice(0, 180)}）`), { code: "COLLECTOR_ASSET_FETCH_FAILED" });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        throw Object.assign(new Error(`读取采集文件失败：${originalName}（HTTP ${response.status}）`), { code: "COLLECTOR_ASSET_FETCH_FAILED" });
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) {
        throw Object.assign(new Error(`采集文件为空：${originalName}`), { code: "COLLECTOR_ASSET_EMPTY" });
      }
      if (bytes.length > 100 * 1024 * 1024 || totalBytes + bytes.length > 350 * 1024 * 1024) {
        throw Object.assign(new Error("本次采集素材超过本地收件箱安全容量，已停止写入"), { code: "COLLECTOR_ASSET_BUNDLE_TOO_LARGE" });
      }
      totalBytes += bytes.length;
      assets.push({ name: originalName, kind: String(asset.kind || "media"), size: bytes.length, bytes });
    }
  }
  if (!assets.length) {
    throw Object.assign(new Error("下载器回执没有可复制的图片/视频文件，不能标记为采集成功"), { code: "COLLECTOR_ASSET_NONE" });
  }
  return assets;
}

async function syncTemplateRepository() {
  const commands = [
    ["sync:template-registry", "同步来源项目模板库"],
    ["maintain:global-template-repository", "同步全局模板仓库"]
  ];
  const results = [];
  for (const [script, label] of commands) {
    const result = await runWorkflowNpmScript(script, {
      cwd: TEMPLATE_REPOSITORY_WORKFLOW_ROOT,
      timeoutMs: 5 * 60 * 1000
    });
    const payload = parseProcessJson(result.stdout);
    results.push({ label, script, ok: result.ok, summary: payload?.summary || payload?.catalog?.summary || null, diagnostic: result.ok ? "完成" : (result.stderr || result.stdout).split(/\r?\n/).find(Boolean)?.slice(0, 200) || "脚本失败" });
    if (!result.ok) break;
  }
  return { ok: results.every((item) => item.ok), results };
}

function saveTemplateIntake(task, input, extra = {}) {
  fs.mkdirSync(TEMPLATE_REPOSITORY_INTAKE_ROOT, { recursive: true });
  const folder = path.join(TEMPLATE_REPOSITORY_INTAKE_ROOT, task.id);
  fs.mkdirSync(folder, { recursive: true });
  const downloadedAssets = Array.isArray(extra.downloadedAssets) ? extra.downloadedAssets : [];
  const manifestExtra = { ...extra };
  delete manifestExtra.downloadedAssets;
  const savedImages = [];
  const savedAssets = [];
  input.files.forEach((file, index) => {
    const match = file.dataUrl.match(/^data:image\/([a-z0-9+.-]+);base64,(.+)$/i);
    if (!match) return;
    const ext = ({ jpeg: ".jpg", jpg: ".jpg", png: ".png", webp: ".webp", gif: ".gif" }[match[1].toLowerCase()] || ".png");
    const name = `${String(index + 1).padStart(2, "0")}-${path.basename(file.name, path.extname(file.name))}${ext}`;
    const target = path.join(folder, name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_"));
    fs.writeFileSync(target, Buffer.from(match[2], "base64"));
    savedImages.push(path.basename(target));
    savedAssets.push({ name: path.basename(target), kind: "image", size: fs.statSync(target).size });
  });
  const downloadFolder = path.join(folder, "downloaded");
  if (downloadedAssets.length) fs.mkdirSync(downloadFolder, { recursive: true });
  const downloadedImageDigests = new Set();
  downloadedAssets.forEach((asset, index) => {
    if (!Buffer.isBuffer(asset?.bytes) || !asset.bytes.length) return;
    const original = path.basename(String(asset.name || `来源素材-${index + 1}`));
    const ext = path.extname(original).toLowerCase();
    const isImage = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".avif"].includes(ext);
    const digest = isImage ? crypto.createHash("sha256").update(asset.bytes).digest("hex") : "";
    const duplicateImage = Boolean(digest && downloadedImageDigests.has(digest));
    if (digest && !duplicateImage) downloadedImageDigests.add(digest);
    const safeStem = path.basename(original, ext).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 100) || `来源素材-${index + 1}`;
    const filename = `${String(index + 1).padStart(2, "0")}-${safeStem}${ext}`;
    const relativeFolder = duplicateImage ? path.join("downloaded", ".duplicate-source-images") : "downloaded";
    const target = path.join(folder, relativeFolder, filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, asset.bytes);
    const relative = path.join(relativeFolder, filename).replace(/\\/g, "/");
    const kind = duplicateImage ? "duplicate-image" : String(asset.kind || "media");
    savedAssets.push({ name: relative, kind, size: asset.bytes.length });
    if (isImage && !duplicateImage) savedImages.push(relative);
  });
  const downloadItems = Array.isArray(manifestExtra.download?.items) ? manifestExtra.download.items : [];
  const downloadedItem = downloadItems.find((item) => item?.success) || {};
  const sourceTitle = String(downloadedItem.title || manifestExtra.collector?.title || "").trim();
  const noteId = String(manifestExtra.collector?.noteId || "").trim();
  const collectorStats = manifestExtra.collector?.stats || {};
  const downloadedStats = downloadedItem.stats || {};
  const sourceStats = {
    likes: String(collectorStats.likes || downloadedStats.likes || ""),
    collections: String(collectorStats.collections || downloadedStats.collections || ""),
    comments: String(collectorStats.comments || downloadedStats.comments || "")
  };
  const template = {
    id: noteId ? `XHS-${noteId}` : `XHS-${task.id}`,
    name: sourceTitle || `小红书模板待分析${noteId ? `-${noteId}` : ""}`,
    sourceTitle,
    sourcePlatform: "小红书",
    sourceUrl: String(manifestExtra.collector?.sourceUrl || input.urls[0] || ""),
    sourcePageUrl: String(manifestExtra.collector?.sourcePageUrl || ""),
    stats: sourceStats,
    project: "江湖有旅人",
    category: "待确认",
    localPath: folder,
    imageCount: savedImages.length,
    status: "pending-analysis",
    tags: ["小红书", "待确认"]
  };
  const manifest = {
    schemaVersion: 1,
    status: "pending-analysis",
    createdAt: now(),
    skillId: TEMPLATE_REPOSITORY_SKILL_ID,
    source: { inputText: input.text, links: input.urls, paths: extra.acceptedPaths || [], rejectedPaths: extra.rejectedPaths || [] },
    images: savedImages,
    media: savedAssets,
    tags: ["待确认"],
    templateDescription: "待分析：等待模板名称、封面/内页结构和可确认视觉特征。",
    ...manifestExtra,
    template
  };
  fs.writeFileSync(path.join(folder, "intake.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(folder, "template.json"), `${JSON.stringify({ schemaVersion: 1, template }, null, 2)}\n`, "utf8");
  return {
    folder,
    manifestPath: path.join(folder, "intake.json"),
    templatePath: path.join(folder, "template.json"),
    savedImages,
    savedAssets,
    sourceTitle,
    template,
    manifest
  };
}

function writeTemplateGalleryJsonAtomically(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function safeTemplateGalleryFolderPart(value, fallback = "小红书待确认") {
  const normalized = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 72);
  return normalized && normalized !== "." && normalized !== ".." ? normalized : fallback;
}

function isInsideRealDirectory(root, target) {
  const rootResolved = path.resolve(root);
  const targetResolved = path.resolve(target);
  const relative = path.relative(rootResolved, targetResolved);
  return Boolean(relative && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

function galleryImageExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".avif"].includes(ext) ? ext : ".png";
}

function sortCollectedImagePaths(paths) {
  return [...paths].sort((left, right) => {
    const leftName = path.basename(String(left || ""));
    const rightName = path.basename(String(right || ""));
    const leftCover = /封面|cover/i.test(leftName) ? 0 : 1;
    const rightCover = /封面|cover/i.test(rightName) ? 0 : 1;
    if (leftCover !== rightCover) return leftCover - rightCover;
    const leftNumber = Number((leftName.match(/^(\d+)/) || [])[1] || 9999);
    const rightNumber = Number((rightName.match(/^(\d+)/) || [])[1] || 9999);
    return leftNumber - rightNumber || leftName.localeCompare(rightName, "zh-CN");
  });
}

function uniqueCollectedImagePaths(paths) {
  const seen = new Set();
  return paths.filter(source => {
    try {
      const digest = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
      if (seen.has(digest)) return false;
      seen.add(digest);
      return true;
    } catch {
      return false;
    }
  });
}

function copyCollectedTemplateToGallery(intake, template, targetFolder) {
  const intakeRoot = path.resolve(intake.folder);
  if (!isInsideRealDirectory(TEMPLATE_REPOSITORY_INTAKE_ROOT, intakeRoot)) {
    throw new Error("采集收件箱路径不在允许范围内");
  }
  if (!exists(intakeRoot) || !fs.statSync(intakeRoot).isDirectory()) {
    throw new Error("采集收件箱目录不存在");
  }
  const targetRoot = path.resolve(targetFolder);
  if (!isInsideRealDirectory(TEMPLATE_GALLERY_TEAMBUILDING_ROOT, targetRoot)) {
    throw new Error("模板入库目录不在团建模板库范围内");
  }
  fs.mkdirSync(targetRoot, { recursive: true });
  const sourceImages = uniqueCollectedImagePaths(sortCollectedImagePaths(Array.isArray(intake.savedImages) ? intake.savedImages : [])
    .map(relative => {
      const cleanRelative = String(relative || "").replace(/^[/\\]+/, "");
      const source = path.resolve(intakeRoot, cleanRelative);
      return isInsideRealDirectory(intakeRoot, source) && exists(source) && fs.statSync(source).isFile() ? source : "";
    })
    .filter(Boolean));
  if (!sourceImages.length) throw new Error("采集结果没有可入库的图片");

  const imageNames = [];
  sourceImages.forEach((source, index) => {
    const sourceName = path.basename(source, path.extname(source));
    const kind = index === 0 ? "封面" : "内页";
    const targetName = `${String(index + 1).padStart(2, "0")}-${kind}-${safeTemplateGalleryFolderPart(sourceName, `采集图${index + 1}`).slice(0, 72)}${galleryImageExtension(source)}`;
    const target = path.join(targetRoot, targetName);
    fs.copyFileSync(source, target);
    imageNames.push(targetName);
  });

  const currentImages = fs.readdirSync(targetRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^\d{2}-(封面|内页)-.+\.(jpe?g|png|webp|gif|heic|avif)$/i.test(entry.name))
    .map(entry => entry.name);
  const staleImages = currentImages.filter(name => !imageNames.includes(name));
  if (staleImages.length) {
    const duplicateRoot = path.join(targetRoot, ".duplicate-source-images");
    fs.mkdirSync(duplicateRoot, { recursive: true });
    staleImages.forEach(name => {
      const source = path.join(targetRoot, name);
      let destination = path.join(duplicateRoot, name);
      if (exists(destination)) destination = path.join(duplicateRoot, `${Date.now()}-${name}`);
      fs.renameSync(source, destination);
    });
  }

  for (const name of ["intake.json", "template.json"]) {
    const source = path.join(intakeRoot, name);
    if (exists(source) && fs.statSync(source).isFile()) fs.copyFileSync(source, path.join(targetRoot, name));
  }
  const localPath = targetRoot.replace(/\\/g, "/");
  const relPath = path.relative(TEMPLATE_GALLERY_ROOT, targetRoot).replace(/\\/g, "/");
  const updatedAt = now();
  const galleryTemplate = {
    templateId: String(template.id || "").trim(),
    id: String(template.id || "").trim(),
    name: String(template.name || template.id || "小红书待确认模板").trim(),
    category: "团建类模板",
    folderGroup: "待确认采集",
    layout: "待分析",
    layoutType: "pending_analysis",
    addedAt: updatedAt.slice(0, 10),
    mtime: updatedAt,
    updatedAt,
    enabled: true,
    localPath,
    localFolderPath: targetRoot,
    relPath,
    p1: imageNames[0] || "",
    p2: imageNames[1] || imageNames[0] || "",
    cover: imageNames[0] ? `${relPath}/${imageNames[0]}` : "",
    inner: imageNames[1] ? `${relPath}/${imageNames[1]}` : (imageNames[0] ? `${relPath}/${imageNames[0]}` : ""),
    imageCount: imageNames.length,
    images: imageNames.map(name => `${relPath}/${name}`),
    textCount: 0,
    description: "小红书采集成功，等待确认封面、内页结构和分类",
    tags: ["小红书", "待分析", "待确认"],
    flowType: "精准流量",
    contentType: "团建方案",
    stats: template.stats || {},
    sourceTitle: template.sourceTitle || template.name || "",
    sourceUrl: template.sourceUrl || "",
    sourcePlatform: "小红书",
    status: "pending-analysis",
    metadataStatus: "待确认"
  };
  const targetTemplate = {
    schemaVersion: 1,
    status: "pending-analysis",
    createdAt: updatedAt,
    template: { ...template, localPath: targetRoot, status: "pending-analysis", imageCount: imageNames.length }
  };
  fs.writeFileSync(path.join(targetRoot, "template.json"), `${JSON.stringify(targetTemplate, null, 2)}\n`, "utf8");
  return { galleryTemplate, targetRoot, imageNames, updatedAt };
}

function rebuildTemplateGallery() {
  if (!exists(TEMPLATE_GALLERY_BUILD_SCRIPT)) throw new Error("模板库生成脚本不存在");
  const python = process.env.TEAMBUILDING_PYTHON || "python.exe";
  const result = childProcess.spawnSync(python, [TEMPLATE_GALLERY_BUILD_SCRIPT], {
    cwd: TEMPLATE_GALLERY_ROOT,
    windowsHide: true,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(`模板库页面生成失败：${String(result.error?.message || result.stderr || result.stdout || "未知错误").trim().slice(0, 320)}`);
  }
  return { ok: true, output: String(result.stdout || "").trim().slice(-500) };
}

function registerCollectedTemplateInGallery(intake) {
  const template = intake?.template || {};
  const templateId = String(template.id || "").trim().toUpperCase();
  if (!/^XHS-[A-F0-9]{24}$/i.test(templateId)) throw new Error("采集结果缺少有效的小红书模板编号");
  if (!exists(TEMPLATE_GALLERY_ROOT) || !exists(TEMPLATE_GALLERY_TEAMBUILDING_ROOT)) {
    throw new Error("项目模板库目录不存在");
  }
  if (!exists(TEMPLATE_GALLERY_REGISTRY)) throw new Error("项目模板登记表不存在");
  let registry;
  try { registry = JSON.parse(fs.readFileSync(TEMPLATE_GALLERY_REGISTRY, "utf8").replace(/^\uFEFF/, "")); }
  catch (error) { throw new Error(`项目模板登记表无法读取：${error.message}`); }
  if (!Array.isArray(registry.templates)) throw new Error("项目模板登记表缺少 templates 列表");
  const existingIndex = registry.templates.findIndex(item => String(item?.templateId || item?.id || "").trim().toUpperCase() === templateId);
  if (existingIndex >= 0) {
    const existing = registry.templates[existingIndex];
    const existingPath = String(existing.localPath || existing.localFolderPath || "").trim();
    if (existingPath && exists(existingPath)) {
      let existingRoot = path.resolve(existingPath);
      const folderPart = safeTemplateGalleryFolderPart(`${templateId} ${template.name || "小红书待确认模板"}`);
      const preferredRoot = path.join(TEMPLATE_GALLERY_TEAMBUILDING_ROOT, folderPart);
      const sourceImages = uniqueCollectedImagePaths(sortCollectedImagePaths(Array.isArray(intake.savedImages) ? intake.savedImages : [])
        .map(relative => {
          const source = path.resolve(intake.folder, String(relative || "").replace(/^[/\\]+/, ""));
          return isInsideRealDirectory(intake.folder, source) && exists(source) && fs.statSync(source).isFile() ? source : "";
        }).filter(Boolean));
      if (sourceImages.length && isInsideRealDirectory(TEMPLATE_GALLERY_TEAMBUILDING_ROOT, existingRoot)) {
        let previousRoot = "";
        if (existingRoot.toLowerCase() !== preferredRoot.toLowerCase() && !exists(preferredRoot)) {
          previousRoot = existingRoot;
          fs.renameSync(existingRoot, preferredRoot);
          existingRoot = preferredRoot;
        }
        let copied;
        try {
          copied = copyCollectedTemplateToGallery(intake, template, existingRoot);
        } catch (error) {
          if (previousRoot && exists(existingRoot) && !exists(previousRoot)) fs.renameSync(existingRoot, previousRoot);
          throw error;
        }
        const galleryEntry = { ...existing, ...copied.galleryTemplate, templateId: existing.templateId || templateId, id: existing.id || templateId };
        registry.templates[existingIndex] = galleryEntry;
        registry.totalCount = registry.templates.length;
        registry.updatedAt = copied.updatedAt;
        writeTemplateGalleryJsonAtomically(TEMPLATE_GALLERY_REGISTRY, registry);
        const rebuilt = rebuildTemplateGallery();
        return { ok: true, alreadyRegistered: true, templateId, path: existingRoot, imageCount: copied.imageNames.length, rebuilt: rebuilt.ok, repaired: true };
      }
    }
    registry.templates.splice(existingIndex, 1);
  }
  const folderPart = safeTemplateGalleryFolderPart(`${templateId} ${template.name || "小红书待确认模板"}`);
  const targetFolder = path.join(TEMPLATE_GALLERY_TEAMBUILDING_ROOT, folderPart);
  const copied = copyCollectedTemplateToGallery(intake, template, targetFolder);
  registry.templates.push(copied.galleryTemplate);
  registry.totalCount = registry.templates.length;
  registry.updatedAt = copied.updatedAt;
  writeTemplateGalleryJsonAtomically(TEMPLATE_GALLERY_REGISTRY, registry);
  const rebuilt = rebuildTemplateGallery();
  return { ok: true, alreadyRegistered: false, templateId, path: copied.targetRoot, imageCount: copied.imageNames.length, rebuilt: rebuilt.ok };
}

async function runTemplateRepositorySkill(task) {
  const input = normalizeTemplateRepositoryInput(task.input || {});
  const collector = task.collector || null;
  const validated = validateTemplateRepositoryPaths(input.paths);
  if (!hasTemplateRepositoryInput({ ...input, paths: validated.accepted })) {
    throw Object.assign(new Error("请粘贴公开链接、拖入本地文件/文件夹，或粘贴图片"), { code: "TEMPLATE_INPUT_EMPTY" });
  }
  setStep(task, task.steps[0]?.id, "completed", `${input.urls.length} 个链接 · ${validated.accepted.length} 个本地路径 · ${input.files.length} 张图片`);
  updateTask(task, { progress: 18 });
  let download = null;
  let downloadedAssets = [];
  if (input.urls.length) {
    setStep(task, task.steps[1]?.id, "running", "正在调用万能下载器（谨慎频率）");
    download = await runTemplateRepositoryDownload(input.text, TEMPLATE_REPOSITORY_MATERIAL_ROOT, task);
    if (Number(download.payload?.success || 0) > 0) {
      try {
        downloadedAssets = await fetchTemplateCollectorAssets(download.payload);
      } catch (error) {
        download = {
          ...download,
          ok: false,
          code: error.code || "COLLECTOR_ASSET_COPY_FAILED",
          payload: { ...(download.payload || {}), success: 0, error: String(error.message || "采集素材复制失败").slice(0, 360) }
        };
      }
    }
    if (!download.ok && Number(download.payload?.success || 0) === 0) {
      setStep(task, task.steps[1]?.id, "failed", download.payload?.error || "下载没有成功，未写入待分析目录");
      const blocked = download.code === "COLLECTOR_BRIDGE_BLOCKED" || download.payload?.bridgeStatus === "blocked";
      const needsLogin = download.payload?.authentication?.cookies_used === false;
      return {
        status: blocked ? "blocked" : "download_failed",
        download: download.payload || download,
        nextStep: blocked
          ? "采集器当前因小红书公开链接/登录状态暂停；恢复桥接器后可在原记录上重试。"
          : needsLogin
            ? "模板页已接通万能采集器，但这条公开链接没有返回图片；当前采集器未配置小红书登录 Cookie。请粘贴小红书可公开访问的分享长链（含有效访问参数），或在万能采集器登录后重试。"
            : "模板页已接通万能采集器，但这条链接没有返回图片；请检查笔记是否仍可公开访问后重试。"
      };
    }
    const imageCount = downloadedAssets.filter((asset) => [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".avif"].includes(path.extname(asset.name).toLowerCase())).length;
    setStep(task, task.steps[1]?.id, "completed", `实际取回 ${downloadedAssets.length} 个文件，其中 ${imageCount} 张图片；下载链接成功 ${Number(download.payload?.success || 0)} · 失败 ${Number(download.payload?.failed || 0)}`);
  } else {
    setStep(task, task.steps[1]?.id, "completed", "没有链接，使用本地输入/粘贴图片");
  }
  setStep(task, task.steps[2]?.id, "running", "复制原图、文案和来源信息到模板仓库待分析收件箱");
  const intake = saveTemplateIntake(task, input, {
    acceptedPaths: validated.accepted,
    rejectedPaths: validated.rejected,
    download: download?.payload || null,
    collector,
    downloadedFolders: (download?.payload?.items || []).filter((item) => item.success && item.save_dir).map((item) => item.save_dir),
    downloadedAssets
  });
  setStep(task, task.steps[2]?.id, "completed", `${intake.savedImages.length} 张图片、${intake.savedAssets.length} 个来源文件已写入待分析目录`);
  let galleryRegistration = { ok: false, skipped: true, reason: "本地输入等待人工确认" };
  if (collector?.noteId) {
    setStep(task, task.steps[3]?.id, "running", "同步到项目模板库，标记为待确认");
    galleryRegistration = registerCollectedTemplateInGallery(intake);
    setStep(task, task.steps[3]?.id, "completed", `已写入模板库：${galleryRegistration.path}`);
    setStep(task, task.steps[4]?.id, "completed", "已显示在模板库最新列表；来源分类和视觉标签仍待确认");
  } else {
    setStep(task, task.steps[3]?.id, "completed", `待分析 template.json 已写入：${intake.templatePath}`);
    setStep(task, task.steps[4]?.id, "completed", "来源分类和视觉标签待确认；本地输入保留在待分析收件箱");
  }
  setStep(task, task.steps[5]?.id, "completed", validated.rejected.length ? `${validated.rejected.length} 个路径未采用，已显示缺口` : "模板名、视觉标签和预览仍以证据为准");
  const partialFailure = Number(download?.payload?.failed || 0);
  return {
    status: "candidate_ready",
    intakePath: intake.manifestPath,
    templatePath: intake.templatePath,
    repositoryPath: templateRepositoryEntry().path,
    repositoryLabel: templateRepositoryEntry().label,
    acceptedPaths: validated.accepted,
    rejectedPaths: validated.rejected,
    savedImages: intake.savedImages,
    savedAssets: intake.savedAssets,
    downloaded: download?.payload || null,
    galleryRegistration,
    sync: { ok: true, stage: "template-gallery" },
    nextStep: partialFailure
      ? `已采集的文件已进入模板仓库待分析；另有 ${partialFailure} 条下载失败，请检查原链接后重试。`
      : "实图、来源信息已进入待分析收件箱，并已在模板库以“待确认”状态显示；确认分类后可继续完善。"
  };
}

function publicDeviceRecord(record = {}) {
  return {
    id: String(record.id || ""),
    name: String(record.name || "").trim(),
    model: String(record.model || "").trim(),
    state: String(record.state || record.transferState || "").trim(),
    online: record.online !== false,
    current: record.current !== false,
    workCount: Number.isFinite(Number(record.workCount)) ? Number(record.workCount) : null,
    workCounts: record.workCounts && typeof record.workCounts === "object"
      ? Object.fromEntries(Object.entries(record.workCounts)
        .filter(([, value]) => Number.isFinite(Number(value)))
        .map(([key, value]) => [key, Number(value)]))
      : null,
    note: String(record.note || "").trim()
  };
}

async function runDeviceFolderTransferSkill(task, ctx = {}) {
  const skill = NATIVE_SKILLS[DEVICE_TRANSFER_SKILL_ID];
  const status = deviceFolderTransferSkillStatus(skill);
  if (!status.canRun) {
    throw Object.assign(new Error(status.issues.map((item) => item.label).join("；") || "设备分发技能当前不可运行"), {
      code: "DEVICE_TRANSFER_PRECHECK_BLOCKED"
    });
  }
  if (typeof ctx.getDeviceStatus !== "function") {
    throw Object.assign(new Error("工作台没有绑定设备状态扫描器，已停止在发送前"), {
      code: "DEVICE_STATUS_SCANNER_NOT_BOUND"
    });
  }
  const snapshot = await ctx.getDeviceStatus(true);
  if (snapshot?.stale === true || snapshot?.scanError) {
    throw Object.assign(new Error(String(snapshot.scanError || "设备在线状态扫描失败，未触发分发")), {
      code: "DEVICE_STATUS_SCAN_FAILED"
    });
  }
  const onlineDevices = (Array.isArray(snapshot?.onlineDevices) ? snapshot.onlineDevices : [])
    .filter((device) => device && device.current !== false)
    .map(publicDeviceRecord);
  const settings = ctx.getPageSettings?.().distribution || {};
  const registered = typeof ctx.registeredDevices === "function" ? ctx.registeredDevices() : [];
  const checkOnly = task?.input?.checkOnly === true || task?.input?.dryRun === true;
  // 这是一次有界的手动检查，不另建 scheduler。实际是否发送仍由既有的
  // 自动分发门禁决定：设置开关、首次设备审批、库存可信度、设备空闲、
  // 候选作品和 work-level claim 都由 server.js 的同一入口负责。
  const triggered = !checkOnly && typeof ctx.maybeStartAutomaticDistribution === "function"
    ? (ctx.maybeStartAutomaticDistribution(onlineDevices) || [])
    : [];
  return {
    kind: "device_transfer",
    deviceTransferAction: "check_and_auto_dispatch",
    status: "device_checked",
    scannedAt: now(),
    registeredDeviceCount: Array.isArray(registered) ? registered.length : null,
    onlineDeviceCount: onlineDevices.length,
    onlineDevices,
    automation: {
      enabled: settings.autoDistributionEnabled === true,
      detectOnConnection: settings.detectOnConnection === true,
      eventMode: String(ctx.getAutomaticDistributionMonitorState?.().eventMode || "扫描兜底"),
      eventPort: Number(ctx.getAutomaticDistributionMonitorState?.().eventPort || 45834),
      lastEventAt: String(ctx.getAutomaticDistributionMonitorState?.().lastEventAt || ""),
      category: String(settings.autoCategory || "all"),
      reserveThreshold: Number.isFinite(Number(settings.phoneReserveThreshold)) ? Number(settings.phoneReserveThreshold) : null,
      checkOnly,
      triggered: Array.isArray(triggered) ? triggered.map((item) => ({
        deviceId: String(item.deviceId || ""),
        device: String(item.device || "").trim(),
        count: Number(item.count || 0)
      })) : []
    },
    presencePath: String(ctx.DEVICE_PRESENCE_FILE || ""),
    automationLogPath: String(ctx.DISTRIBUTION_AUTOMATION_LOG_FILE || ""),
    nextStep: checkOnly
      ? "只读检查完成；本次没有触发真实分发。"
      : triggered.length
      ? "已按现有自动分发门禁触发任务；请到文件传输面板查看接收进度和最终账本记录。"
      : onlineDevices.length
        ? "设备已刷新；本次没有满足自动分发门禁的设备或作品，系统没有盲目发送。"
        : "当前没有在线设备；已完成扫描，未触发发送。"
  };
}

function conversionCount(payload, candidates = []) {
  if (!payload || typeof payload !== "object") return null;
  for (const key of candidates) {
    const value = payload[key];
    if (Array.isArray(value)) return value.length;
    if (Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function summarizeConversionSnapshot(snapshot, maintenance) {
  const sopData = snapshot?.sop?.数据;
  const searchData = snapshot?.search?.数据;
  const planData = snapshot?.plans?.数据;
  const sopCount = conversionCount(sopData, ["总数", "数量", "条数"])
    ?? Object.values(sopData || {}).reduce((total, value) => total + (Array.isArray(value) ? value.length : 0), 0);
  const searchCount = conversionCount(searchData, ["候选", "问答", "items"]);
  const planCount = conversionCount(planData, ["方案", "items"]);
  const sync = snapshot?.sync || {};
  return {
    mode: "后端维护",
    status: snapshot?.ok ? (sync.status === "candidate_pending" ? "candidate_pending" : "verified") : "not_refreshed",
    service: snapshot?.ok ? "reachable" : "unavailable",
    serviceOrigin: snapshot?.serviceOrigin || "",
    formalSopCount: sopCount,
    searchCandidateCount: searchCount,
    planCount,
    journeyAvailable: Boolean(snapshot?.journey),
    syncStatus: sync.status || "unknown",
    syncMessage: sync.message || sync.reason || "",
    maintenanceReady: Boolean(maintenance?.数据?.技能可用),
    handoffAvailable: Boolean(maintenance?.数据?.交接文档可用),
    error: snapshot?.error || ""
  };
}

async function runNativeSkill(skillId, ctx) {
  const skill = nativeSkill(skillId);
  if (!skill) throw Object.assign(new Error("skill not found"), { code: "SKILL_NOT_FOUND" });
  if (!exists(skill.sourcePath)) {
    throw Object.assign(new Error("技能说明文件不存在，已停止运行"), { code: "SKILL_SOURCE_UNAVAILABLE" });
  }
  if (skillId === MATERIAL_INGESTION_SKILL_ID) {
    return runMaterialIngestionSkill(ctx.task);
  }
  if (skillId === TEMPLATE_REPOSITORY_SKILL_ID) {
    return runTemplateRepositorySkill(ctx.task);
  }
  if (skillId === DEVICE_TRANSFER_SKILL_ID) {
    return runDeviceFolderTransferSkill(ctx.task, ctx);
  }
  if (skillId === "wechat-chat-analysis") {
    const before = await ctx.requestConversionService("/api/聊天源状态", { timeoutMs: 12_000 });
    const scan = await ctx.requestConversionService("/api/扫描聊天源", {
      method: "POST",
      body: {},
      timeoutMs: 120_000
    });
    const after = scan?.数据 || await ctx.requestConversionService("/api/聊天源状态", { timeoutMs: 12_000 });
    return {
      mode: skill.mode,
      status: "candidate_ready",
      before: {
        directoryExists: Boolean(before?.目录存在),
        sourceDirectory: before?.目录 || "",
        indexed: before?.已入库统计 || {}
      },
      after: {
        directoryExists: Boolean(after?.目录存在),
        sourceDirectory: after?.目录 || "",
        scanStats: after?.扫描统计 || {},
        indexed: after?.已入库统计 || {},
        lastScanAt: after?.配置?.上次扫描时间 || ""
      },
      formalWrite: false,
      cursorAdvanced: false,
      nextStep: "回到流量转化模块维护页核对候选；只有人工确认后才进入正式 SOP。"
    };
  }
  const [snapshot, maintenance] = await Promise.all([
    ctx.getConversionSnapshot({ includeLargeIndexes: true }),
    ctx.requestConversionService("/api/开发维护状态", { timeoutMs: 12_000 })
  ]);
  return {
    ...summarizeConversionSnapshot(snapshot, maintenance),
    skillPath: maintenance?.数据?.技能路径 || skill.sourcePath,
    sourceTruth: maintenance?.数据?.业务知识库真源 || "",
    runtimeRoot: maintenance?.数据?.运行数据 || "",
    knowledgeSource: knowledgeSourceStatus(skill.knowledgeSource),
    nextStep: snapshot?.ok
      ? "如果有新候选，先在正式知识库与聊天证据之间查重/确认，再重建派生索引。"
      : "先恢复转化助手服务或聊天源，再重新运行维护检查。"
  };
}

async function validateRuntime(paths) {
  if (!exists(paths.runtimeValidator) || !exists(paths.runtimeState)) {
    return { ok: false, code: "RUNTIME_STATE_UNAVAILABLE" };
  }
  const python = process.env.TB_PYTHON || process.env.PYTHON || "python";
  return new Promise((resolve) => {
    const child = childProcess.spawn(python, [paths.runtimeValidator, paths.runtimeState], {
      cwd: path.dirname(paths.runtimeValidator),
      env: { ...process.env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => resolve({ ok: false, code: error.code || "RUNTIME_VALIDATOR_FAILED" }));
    child.on("close", (code) => resolve({
      ok: code === 0,
      recoveryRequired: code === 2,
      code: code === 0 ? "OK" : code === 2 ? "RECOVERY_REQUIRED" : "RUNTIME_STATE_INVALID",
      // Do not return stdout/stderr: a malformed export must not leak raw data.
      diagnostic: code === 0 ? "valid" : (stderr || stdout).split(/\r?\n/).find(Boolean)?.slice(0, 160) || "validator failed"
    }));
  });
}

async function inspectSkill(options = {}) {
  const paths = { ...defaultPaths(), ...(options.paths || {}) };
  const health = options.healthProbe ? await options.healthProbe(paths.weflowHealthUrl) : await probeHttp(paths.weflowHealthUrl);
  const runtime = options.runtimeValidator ? await options.runtimeValidator(paths) : await validateRuntime(paths);
  const packageReady = exists(paths.skillFile) && exists(paths.profile) && exists(paths.secretReferences);
  const runnerBound = Boolean(paths.runner && exists(paths.runner));
  const runtimeAuthPresent = Boolean(readLeadRuntimeToken());
  const issues = [];
  if (!packageReady) issues.push({ code: "SKILL_PACKAGE_INCOMPLETE", label: "技能本体或专属配置不完整" });
  if (!health.ok) issues.push({ code: health.code || "WEFLOW_UNAVAILABLE", label: "WeFlow 当前不可达" });
  if (!runtime.ok) issues.push({ code: runtime.code || "RUNTIME_STATE_INVALID", label: runtime.recoveryRequired ? "运行水位需要只读恢复" : "运行水位未通过校验" });
  if (!runtimeAuthPresent) issues.push({ code: "WEFLOW_RUNTIME_AUTH_MISSING", label: "当前工作台进程没有 WeFlow 运行时授权" });
  if (!runnerBound) issues.push({ code: "LEAD_SYNC_RUNNER_NOT_BOUND", label: "尚未绑定授权的客资执行器" });
  const blocked = runtime.recoveryRequired || !packageReady;
  return {
    skillId: SKILL_ID,
    paths: {
      skill: packageReady && exists(paths.skillFile),
      profile: exists(paths.profile),
      secretReferences: exists(paths.secretReferences),
      runtimeState: exists(paths.runtimeState),
      handoffManifest: exists(paths.handoffManifest)
    },
    connectors: {
      weflow: { status: health.ok && runtimeAuthPresent ? "ready" : "needs_user", healthCode: health.ok ? "OK" : (health.code || "unavailable"), runtimeAuthPresent },
      feishu: { status: runnerBound ? "ready" : "needs_user", authValuesHidden: true }
    },
    runner: { bound: runnerBound },
    runtime: { status: runtime.ok ? "valid" : runtime.recoveryRequired ? "recovery_required" : "invalid" },
    overallStatus: blocked ? "blocked" : issues.length ? "needs_user" : "ready",
    canPreview: !blocked && health.ok && runtime.ok && runtimeAuthPresent,
    canCommit: !blocked && health.ok && runtime.ok && runtimeAuthPresent && runnerBound,
    issues,
    checkedAt: now()
  };
}

function catalogSkillStatus() {
  const paths = defaultPaths();
  const packageReady = exists(paths.skillFile) && exists(paths.profile) && exists(paths.secretReferences);
  const runnerBound = Boolean(paths.runner && exists(paths.runner));
  return {
    skillId: SKILL_ID,
    overallStatus: packageReady ? "needs_user" : "blocked",
    packageReady,
    runner: { bound: runnerBound },
    canPreview: false,
    canCommit: false,
    livePrecheck: "click_to_check",
    issues: [{ code: "LIVE_PRECHECK_ON_RUN", label: "点击运行后执行 WeFlow 与运行水位实时预检" }],
    checkedAt: now()
  };
}

function updateTask(task, patch) {
  Object.assign(task, patch, { updatedAt: now() });
  return publicTask(task);
}

function setStep(task, id, state, detail = "") {
  const step = task.steps.find((item) => item.id === id);
  if (step) Object.assign(step, { state, detail });
}

function resolveRunnerCommand(runner) {
  if (!runner) return null;
  const ext = path.extname(runner).toLowerCase();
  if (ext === ".ps1") return { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", runner] };
  if (ext === ".py") return { command: process.env.TB_PYTHON || process.env.PYTHON || "python", args: [runner] };
  return { command: runner, args: [] };
}

function invokeRunner(paths, mode) {
  const resolved = resolveRunnerCommand(paths.runner);
  if (!resolved) return Promise.resolve({ ok: false, code: "LEAD_SYNC_RUNNER_NOT_BOUND" });
  const runtimeToken = readLeadRuntimeToken();
  return new Promise((resolve) => {
    // A normal run scans media plus related groups. The old 120s limit cut off
    // healthy runs after the preflight had already passed, making the skill
    // center look broken even though the canonical runner could finish.
    const timeoutMs = 5 * 60 * 1000;
    let settled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = childProcess.spawn(resolved.command, [...resolved.args, "--mode", mode, "--output", "json"], {
      cwd: path.dirname(paths.runner),
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        ...(runtimeToken ? { WEFLOW_API_TOKEN: runtimeToken } : {}),
        TB_LEAD_SKILL_ID: SKILL_ID
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({
        ok: false,
        code: "LEAD_SYNC_TIMEOUT",
        result: publicRunnerResult({
          code: "LEAD_SYNC_TIMEOUT",
          nextStep: "客资执行器超过 5 分钟未返回，请检查 WeFlow API 与运行日志后重试。"
        }),
        diagnostic: "客资执行器超过 5 分钟未返回"
      });
    }, timeoutMs);
    child.on("error", (error) => finish({ ok: false, code: error.code || "LEAD_SYNC_RUNNER_FAILED", diagnostic: error.message }));
      child.on("close", (code) => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      let result = null;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try { result = JSON.parse(lines[i]); break; } catch { /* runner may log before its final JSON */ }
      }
       finish({
         ok: code === 0 && result?.ok !== false,
         code: code === 0 ? (result?.ok === false ? (result?.code || "LEAD_SYNC_REJECTED") : "OK") : "LEAD_SYNC_RUNNER_FAILED",
        result: publicRunnerResult(result),
        diagnostic: code === 0 ? "runner completed" : (stderr || stdout).split(/\r?\n/).find(Boolean)?.slice(0, 160) || "runner failed"
      });
    });
  });
}

async function executeTask(task) {
  const paths = { ...defaultPaths(), ...(task.paths || {}) };
  updateTask(task, { state: "running", progress: 5 });
  setStep(task, "prepare", "running");
  const preflight = await prepareLeadDependencies(paths, { autoStart: task.autoStartDependencies !== false });
  task.preflight = publicLeadPreflight(preflight);
  updateTask(task, { progress: 10, preflight: task.preflight });
  const inspection = await inspectSkill({ paths });
  task.inspection = inspection;
  if (inspection.overallStatus === "blocked") {
    setStep(task, "prepare", "failed", inspection.issues.map((item) => item.label).join("，"));
    return updateTask(task, { state: "blocked", progress: 12, error: { code: "SKILL_PRECHECK_BLOCKED", message: "客资技能未通过安全预检，未读取或写入外部数据。" } });
  }
  setStep(task, "prepare", "completed");
  updateTask(task, { progress: 18 });
  setStep(task, "authorize", inspection.canPreview ? "completed" : "failed", inspection.issues.map((item) => item.label).join("，"));
  if (!inspection.canPreview) {
    return updateTask(task, { state: "needs_user", progress: 20, error: { code: "SKILL_AUTHORIZATION_REQUIRED", message: inspection.issues.map((item) => item.label).join("，") || "请先完成 WeFlow/飞书授权，工作台不会猜测联系人或写表。" } });
  }
  if (!inspection.runner.bound) {
    return updateTask(task, { state: "needs_user", progress: 20, error: { code: "LEAD_SYNC_RUNNER_NOT_BOUND", message: "技能规则和配置已找到，但实际客资同步执行器尚未绑定。" } });
  }
  for (const id of ["read", "normalize", "dedupe", "preview"]) setStep(task, id, "running");
  updateTask(task, { progress: 55 });
  const result = await invokeRunner(paths, task.mode);
  if (!result.ok) {
    setStep(task, "read", "failed", result.diagnostic);
    const needsUser = ["WEFLOW_RUNTIME_AUTH_MISSING", "WEFLOW_RUNTIME_AUTH_INVALID", "FEISHU_CLI_UNAVAILABLE", "FEISHU_CLI_TIMEOUT"].includes(result.code);
    return updateTask(task, { state: needsUser ? "needs_user" : "failed", progress: 55, result: result.result, error: { code: result.code, message: needsUser ? (result.result?.nextStep || "需要重新授权或检查连接器。") : "客资执行器没有完成本次运行，未宣称表格已更新。" } });
  }
  for (const id of ["read", "normalize", "dedupe", "preview"]) setStep(task, id, "completed");
  if (task.mode === "preview") {
    setStep(task, "commit", "waiting", "预览完成，确认后才允许写表");
    setStep(task, "advance", "waiting", "写入回读通过后才推进水位");
    return updateTask(task, { state: "preview_ready", progress: 72, result: result.result });
  }
  setStep(task, "commit", "completed");
  const partialCommit = task.mode === "commit" && (
    result.result?.status === "partial" ||
    result.result?.readBack === false ||
    result.result?.watermarkAdvanced === false
  );
  if (partialCommit) {
    setStep(task, "advance", "failed", result.result?.nextStep || "写入或回读未完整通过，水位未推进");
    return updateTask(task, {
      state: "needs_user",
      progress: 92,
      result: result.result,
      error: {
        code: "LEAD_SYNC_PARTIAL",
        message: result.result?.nextStep || "本次只完成部分处理，已停止推进水位，请复核后再续跑。"
      }
    });
  }
  setStep(task, "advance", "completed");
  return updateTask(task, { state: "completed", progress: 100, result: result.result });
}

async function executeNativeTask(task, ctx) {
  updateTask(task, { state: "running", progress: 5 });
  setStep(task, task.steps[0]?.id, "running");
  try {
    const result = await runNativeSkill(task.skillId, { ...ctx, task });
    if (task.collector && task.persistCollectorLedger !== false) updateTemplateCollectorRecord(task, result);
    if (task.skillId === TEMPLATE_REPOSITORY_SKILL_ID && result?.status === "download_failed") {
      return updateTask(task, { state: "failed", progress: 42, result });
    }
    if (task.skillId === TEMPLATE_REPOSITORY_SKILL_ID && result?.status === "blocked") {
      return updateTask(task, {
        state: "blocked",
        progress: 42,
        result,
        error: { code: "COLLECTOR_BRIDGE_BLOCKED", message: result.nextStep || "采集桥接器当前暂停，未宣称下载完成。" }
      });
    }
    if (task.skillId === TEMPLATE_REPOSITORY_SKILL_ID && result?.status === "sync_incomplete") {
      return updateTask(task, { state: "needs_user", progress: 88, result });
    }
    task.steps.forEach((step, index) => {
      Object.assign(step, {
        state: result?.status === "preview_ready" && index === task.steps.length - 1 ? "waiting" : "completed",
        detail: index === task.steps.length - 1 ? result.nextStep || "运行完成" : "已完成"
      });
    });
    if (result?.status === "preview_ready") {
      return updateTask(task, { state: "preview_ready", progress: 82, result });
    }
    return updateTask(task, { state: "completed", progress: 100, result });
  } catch (error) {
    if (task.collector && task.persistCollectorLedger !== false) updateTemplateCollectorRecord(task, null, error);
    const message = String(error?.message || "技能运行失败").slice(0, 360);
    const failedStep = task.steps.find((step) => step.state === "running") || task.steps[0];
    if (failedStep) Object.assign(failedStep, { state: "failed", detail: message });
    return updateTask(task, {
      state: error?.code === "SKILL_SOURCE_UNAVAILABLE" ? "blocked" : "failed",
      progress: Math.max(8, Math.min(92, task.progress || 8)),
      error: { code: error?.code || "SKILL_EXECUTION_FAILED", message }
    });
  }
}

async function readJsonBody(getBody, req, maxBytes = 16_000) {
  const raw = await getBody(req, maxBytes);
  try { return JSON.parse(raw || "{}"); } catch { throw new Error("请求体不是有效 JSON"); }
}

async function handle(req, res, pathname, parsed, ctx) {
  if (pathname.startsWith("/api/skills/material-download")) {
    return materialDownloadRoute.handle(req, res, pathname, parsed, ctx);
  }
  const {
    send, sendJson, sendExtensionJson, getBody, requestConversionService, getConversionSnapshot,
    getPageSettings, savePageSettings, getDeviceStatus, maybeStartAutomaticDistribution,
    getAutomaticDistributionMonitorState,
    registeredDevices, DEVICE_PRESENCE_FILE, DISTRIBUTION_AUTOMATION_LOG_FILE
  } = ctx;
  if (pathname === "/api/template-collector/collect" && req.method === "POST") {
    try {
      const body = await readJsonBody(getBody, req, 64_000);
      const collector = normalizeTemplateCollectorRequest(body);
      let bridgeProbe = await requestTemplateCollectorBridge("/api/v1/capabilities", {}, 3000);
      if (!bridgeProbe.ok && ["ECONNREFUSED", "COLLECTOR_BRIDGE_UNAVAILABLE", "COLLECTOR_BRIDGE_TIMEOUT"].includes(bridgeProbe.code)) {
        try { bridgeProbe = await ensureTemplateCollectorBridge(); }
        catch (error) { bridgeProbe = { ok: false, code: error.code || "COLLECTOR_BRIDGE_START_FAILED", error: error.message }; }
      }
      if (!bridgeProbe.ok) {
        const error = Object.assign(new Error(`万能采集器 API 未连接：${bridgeProbe.error || "本机下载器无响应"}`), {
          code: bridgeProbe.code || "COLLECTOR_BRIDGE_UNAVAILABLE",
          httpStatus: 503
        });
        throw error;
      }
      const active = [...tasks.values()].find((task) => task.collector?.dedupeKey === collector.dedupeKey
        && ["queued", "running"].includes(task.state));
      const task = active || createTemplateCollectorTask(collector, collector, { requestConversionService, getConversionSnapshot });
      const payload = {
        ok: true,
        status: active ? "already_running" : "started",
        message: "已连接万能采集器；下载和写入模板待分析目录完成后会通知结果。",
        task: publicTask(task)
      };
      if (sendExtensionJson) sendExtensionJson(req, res, payload, 202);
      else send(res, 202, JSON.stringify(payload), "application/json; charset=utf-8");
      return true;
    } catch (error) {
      const payload = { ok: false, error: error.message, code: error.code || "TEMPLATE_COLLECTOR_REQUEST_INVALID" };
      const status = Number(error.httpStatus) || 400;
      if (sendExtensionJson) sendExtensionJson(req, res, payload, status);
      else send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
      return true;
    }
  }
  if (pathname === "/api/template-collector/ledger" && req.method === "GET") {
    const ledger = readTemplateCollectorLedger();
    const records = [...ledger.records].sort((a, b) => {
      const bt = Date.parse(b.updatedAt || b.createdAt || "") || 0;
      const at = Date.parse(a.updatedAt || a.createdAt || "") || 0;
      return (bt - at) || String(b.noteId || "").localeCompare(String(a.noteId || ""));
    });
    const bridgeProbe = await requestTemplateCollectorBridge("/api/v1/status", {}, 3000);
    const bridgeStatus = bridgeProbe.ok && bridgeProbe.payload?.collector ? {
      available: true,
      paused: Boolean(bridgeProbe.payload.collector.pause?.paused),
      pauseReason: String(bridgeProbe.payload.collector.pause?.reason || ""),
      queueCount: Number(bridgeProbe.payload.collector.queue_count || 0),
      worker: String(bridgeProbe.payload.bridge?.worker || "")
    } : {
      available: false,
      paused: false,
      pauseReason: bridgeProbe.error || "采集桥接器不可用",
      queueCount: 0,
      worker: ""
    };
    const payload = {
      ok: true,
      path: TEMPLATE_COLLECTOR_LEDGER,
      intakeRoot: TEMPLATE_REPOSITORY_INTAKE_ROOT,
      repository: templateRepositoryEntry(),
      bridge: bridgeStatus,
      total: ledger.records.length,
      records: records.slice(0, 200).map(publicCollectorRecord)
    };
    if (sendExtensionJson) sendExtensionJson(req, res, payload);
    else sendJson(res, payload);
    return true;
  }
  if (pathname === "/api/template-gallery/metadata" && req.method === "GET") {
    const metadata = readTemplateGalleryMetadata();
    // 模板仓库既可能以 4327 页面打开，也可能直接双击 file:// HTML；两种入口都需要本机 CORS。
    if (sendExtensionJson) sendExtensionJson(req, res, { ok: true, ...metadata, generatedAt: now() });
    else sendJson(res, { ok: true, ...metadata, generatedAt: now() });
    return true;
  }
  if (pathname === "/api/template-collector/queue" && req.method === "POST") {
    try {
      const body = await readJsonBody(getBody, req, 64_000);
      const collector = normalizeTemplateCollectorRequest(body);
      const ledger = readTemplateCollectorLedger();
      const existing = findTemplateCollectorRecord(ledger, collector.dedupeKey);
      const canRetry = existing && ["needs_source_link", "download_failed", "blocked"].includes(existing.status)
        && (collector.sourceUrlProvided || existing.status === "needs_source_link" || existing.sourceUrl === collector.sourceUrl);
      if (existing && !canRetry) {
      const payload = { ok: true, status: existing.status === "candidate_ready" ? "candidate_ready" : "already_registered", record: publicCollectorRecord(existing) };
        if (sendExtensionJson) sendExtensionJson(req, res, payload);
        else sendJson(res, payload);
        return true;
      }
      const record = existing || {
        dedupeKey: collector.dedupeKey,
        noteId: collector.noteId,
        title: collector.title,
        imageCount: collector.imageCount,
        stats: collector.stats,
        sourcePageUrl: collector.sourcePageUrl,
        createdAt: now()
      };
      Object.assign(record, {
        title: collector.title || record.title,
        imageCount: collector.imageCount || record.imageCount,
        stats: collector.stats,
        sourcePageUrl: collector.sourcePageUrl || record.sourcePageUrl,
        sourceUrl: collector.sourceUrl,
        sourceLinkStatus: collector.sourceUrlProvided ? "provided" : "derived_from_note_id",
        status: "queued",
        statusLabel: collectorStatusLabel("queued"),
        updatedAt: now(),
        error: null
      });
      if (!existing) ledger.records.push(record);
      // ID-only requests are converted to the canonical note page and attempted.
      // The worker reports a real download/login failure instead of falsely
      // requiring a token before the downloader has had a chance to try.
      const bridgeProbe = await requestTemplateCollectorBridge("/api/v1/capabilities", {}, 3000);
      if (!bridgeProbe.ok) {
        const message = `采集 API 未连接：${bridgeProbe.error || "本机采集桥没有响应"}`;
        Object.assign(record, {
          status: "blocked",
          statusLabel: "采集 API 未连接",
          taskId: "",
          bridgeJobId: "",
          progress: 0,
          step: "等待采集 API",
          error: message,
          updatedAt: now()
        });
        writeTemplateCollectorLedger(ledger);
        const payload = { ok: false, status: "blocked", error: message, record: publicCollectorRecord(record) };
        if (sendExtensionJson) sendExtensionJson(req, res, payload, 503);
        else send(res, 503, JSON.stringify(payload), "application/json; charset=utf-8");
        return true;
      }
      writeTemplateCollectorLedger(ledger);
      const task = createTemplateCollectorTask(collector, collector, { requestConversionService, getConversionSnapshot });
      record.taskId = task.id;
      writeTemplateCollectorLedger(ledger);
      const payload = { ok: true, status: "queued", task: publicTask(task), record: publicCollectorRecord(record) };
      if (sendExtensionJson) sendExtensionJson(req, res, payload, 202);
      else send(res, 202, JSON.stringify(payload), "application/json; charset=utf-8");
      return true;
    } catch (error) {
      const payload = { ok: false, error: error.message, code: error.code || "TEMPLATE_COLLECTOR_REQUEST_INVALID" };
      if (sendExtensionJson) sendExtensionJson(req, res, payload, 400);
      else send(res, 400, JSON.stringify(payload), "application/json; charset=utf-8");
      return true;
    }
  }
  const match = pathname.match(/^\/api\/skills(?:\/([^/]+))?(?:\/([^/]+))?$/);
  if (!match) return false;
  const skillId = match[1] || "";
  const action = match[2] || "";
  if (skillId && skillId !== SKILL_ID && !nativeSkill(skillId) && !projectSkill(skillId)) {
    send(res, 404, JSON.stringify({ error: "skill not found", code: "SKILL_NOT_FOUND" }), "application/json; charset=utf-8");
    return true;
  }
  if (!skillId && req.method === "GET") {
    const status = catalogSkillStatus();
    const materialEnabled = getPageSettings?.().skills?.materialIngestionEnabled !== false;
      const nativeSkills = Object.values(NATIVE_SKILLS).map((skill) => ({
      id: skill.id,
      title: skill.title,
      category: skill.category || "流量转化",
      description: skill.description,
      background: skill.background,
      usage: skill.usage,
      input: skill.input,
      invocation: skill.invocation,
      operation: skill.operation,
      output: skill.output,
      linkedSkills: skill.linkedSkills,
      policyDescription: skill.policyDescription,
      sourcePath: skill.sourcePath,
      mode: skill.mode,
      runLabel: skill.runLabel,
      flow: skill.flow,
       safety: skill.safety,
       knowledgeSource: knowledgeSourceStatus(skill.knowledgeSource),
       settings: skill.settings || { section: "skills", configurable: false, pathFields: [] },
       status: nativeSkillStatus(skill, { enabled: skill.id !== MATERIAL_INGESTION_SKILL_ID || materialEnabled })
    }));
    const projectSkills = Object.values(PROJECT_SKILLS).map(publicProjectSkill);
    const download = materialDownloadRoute.catalog()[0] || {};
       const downloadSkill = {
      id: download.id || "material-download",
      skillId: download.skillId || "universal-downloader",
       title: download.displayName || download.name || "素材下载",
       description: download.description || "粘贴公开素材分享文案或链接，运行本地下载器。",
      background: "公开素材下载是素材进入工作台的第一步；下载器只处理你主动提供的公开分享内容，不把技能中心变成浏览器登录态代理。",
      usage: "先在卡片输入框粘贴公开链接或分享文案，点击“下载”；结果会保存到素材下载设置指定的目录并回读任务结果。",
      input: download.input || "分享文案 / 一个或多个公开链接",
      output: download.output || "图片、视频、文案.txt 与集中历史记录",
      invocation: "从技能中心素材下载卡片直接触发；点击后先预检本地下载器，再执行真实下载任务。",
      operation: "读取公开输入 → 预检下载器 → 识别平台 → 下载并保存 → 回读每个资源结果。",
      defaultOutputDir: download.defaultOutputDir || "",
      mode: "material_download",
      runLabel: "执行素材下载",
       flow: ["粘贴公开链接", "谨慎解析", "保存到已配置目录", "返回真实结果"],
      safety: "只处理你主动提供的公开链接；不读取浏览器 Cookie，不绕过登录、私密内容或验证码。",
      available: Boolean(download.available),
      loginRequired: Boolean(download.loginRequired),
       destructive: Boolean(download.destructive),
       settings: {
         section: "skills",
         configurable: true,
         pathFields: ["outputDir"]
       },
      status: {
        overallStatus: download.available ? "ready" : "blocked",
        sourceAvailable: Boolean(download.available),
        canRun: Boolean(download.available),
        checkedAt: now()
      }
    };
    sendJson(res, {
      generatedAt: now(),
      skills: [...nativeSkills, ...projectSkills, downloadSkill, {
        id: SKILL_ID,
         title: "团建客资统计",
         category: "客资",
        description: "从已授权的 WeFlow 会话读取本人客资，区分同事、提取字段、查重、预览并安全写回飞书。",
        background: "把每天重复的客资整理从对话框提升为可重复运行的业务技能。",
        usage: "进入技能页点击“一键运行（先预检）”。预览完成后，人工确认新增、重复和待复核项，再点击确认写入表格。",
        input: "已授权的 WeFlow 会话、运行水位、客资识别规则和飞书目标表配置。",
        invocation: "从技能中心点击“一键运行（先预检）”启动；写表前一定停在预览确认。",
        operation: "预检 → 增量读取 → 身份与来源判断 → 字段抽取 → 查重 → 预览 → 人工确认 → 写入回读。",
        flow: ["预检", "增量读取", "身份与来源判断", "字段抽取", "查重", "预览", "写入回读", "推进水位"],
        qualification: "只统计 10 人及以上、非个人团建；未标注来源默认小红书。",
         contactPriority: "联系方式优先级：手机号 > 微信号 > 原始微信 ID；只有昵称时保留为待复核，不冒认账号。",
         sourcePath: defaultPaths().skillFile,
         output: "预览摘要、运行报告、目标表入口和写回/回读证据。",
         runLabel: "一键运行（先预检）",
         writePolicy: "preview_then_commit_then_read_back",
         policyDescription: "写表采用预览 → 人工确认 → 追加 → 回读核验 → 推进水位；任何一步失败都不宣称完成。",
         settings: {
           section: "private-config",
           configurable: true,
           pathFields: ["targetUrl"],
           profilePath: defaultPaths().profile,
           targetUrl: leadSettings(getPageSettings?.()).targetUrl,
           targetLabel: leadSettings(getPageSettings?.()).targetLabel,
           message: leadSettings(getPageSettings?.()).message
         },
         openTargets: leadOpenTargets({ pageSettings: getPageSettings?.() }),
         status
      }]
    });
    return true;
  }
  if (skillId === SKILL_ID && action === "settings") {
    try {
      if (req.method === "GET") {
        sendJson(res, { ok: true, settings: leadSettings(getPageSettings?.()) });
        return true;
      }
      if (req.method === "POST") {
        const body = await readJsonBody(getBody, req, 16_000);
        const current = getPageSettings?.() || {};
        const saved = saveLeadSettings(body, current);
        const pageSettings = savePageSettings ? savePageSettings({ skills: saved.settings.skills }) : saved.settings;
        sendJson(res, { ok: true, settings: leadSettings(pageSettings), openTargets: leadOpenTargets({ pageSettings }) });
        return true;
      }
      send(res, 405, JSON.stringify({ error: "method not allowed", code: "SKILL_SETTINGS_METHOD_NOT_ALLOWED" }), "application/json; charset=utf-8");
      return true;
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message, code: "SKILL_SETTINGS_INVALID" }), "application/json; charset=utf-8");
      return true;
    }
  }
  if (skillId && nativeSkill(skillId) && action === "status" && req.method === "GET") {
    const enabled = skillId !== MATERIAL_INGESTION_SKILL_ID || getPageSettings?.().skills?.materialIngestionEnabled !== false;
    sendJson(res, {
      ...nativeSkill(skillId),
      knowledgeSource: knowledgeSourceStatus(nativeSkill(skillId).knowledgeSource),
      status: nativeSkillStatus(nativeSkill(skillId), { enabled })
    });
    return true;
  }
  if (skillId === TEMPLATE_REPOSITORY_SKILL_ID && action === "repository" && req.method === "GET") {
    sendJson(res, { ok: true, repository: templateRepositoryEntry() });
    return true;
  }
  if (skillId && nativeSkill(skillId) && action === "settings") {
    if (skillId !== MATERIAL_INGESTION_SKILL_ID) {
      sendJson(res, {
        ok: true,
        settings: nativeSkill(skillId).settings || { section: "skills", configurable: false, pathFields: [] },
        message: "这个技能暂时没有可编辑的本机路径设置。"
      });
      return true;
    }
    try {
      if (req.method === "GET") {
        sendJson(res, { ok: true, settings: materialIngestionSkillSettings(), status: nativeSkillStatus(nativeSkill(skillId)) });
        return true;
      }
      if (req.method === "POST") {
        const body = await readJsonBody(getBody, req, 64_000);
        const settings = saveMaterialIngestionSkillSettings(body);
        sendJson(res, { ok: true, settings, status: nativeSkillStatus(nativeSkill(skillId)) });
        return true;
      }
      send(res, 405, JSON.stringify({ error: "method not allowed", code: "SKILL_SETTINGS_METHOD_NOT_ALLOWED" }), "application/json; charset=utf-8");
      return true;
    } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message, code: "SKILL_SETTINGS_INVALID" }), "application/json; charset=utf-8");
      return true;
    }
  }
  if (skillId && projectSkill(skillId) && action === "status" && req.method === "GET") {
    sendJson(res, publicProjectSkill(projectSkill(skillId)));
    return true;
  }
  if (skillId && projectSkill(skillId) && action === "run" && req.method === "POST") {
    send(res, 409, JSON.stringify({
      error: "该技能当前只有说明书和调用契约，尚未绑定安全执行器",
      code: "SKILL_DOCUMENTATION_ONLY"
    }), "application/json; charset=utf-8");
    return true;
  }
  if (skillId && nativeSkill(skillId) && action === "tasks" && req.method === "GET") {
    sendJson(res, [...tasks.values()]
      .filter((task) => task.skillId === skillId)
      .slice(-MAX_TASKS)
      .reverse()
      .map(publicTask));
    return true;
  }
  if (skillId && nativeSkill(skillId) && action === "run" && req.method === "POST") {
    const skill = nativeSkill(skillId);
    let input = null;
    let materialMode = "preview";
    let materialPreviewTaskId = "";
    if (skillId === MATERIAL_INGESTION_SKILL_ID) {
      let body = {};
      try { body = await readJsonBody(getBody, req, 64_000); } catch (error) {
        send(res, 400, JSON.stringify({ error: error.message, code: "SKILL_REQUEST_INVALID" }), "application/json; charset=utf-8");
        return true;
      }
      const enabled = getPageSettings?.().skills?.materialIngestionEnabled !== false;
      if (!enabled) {
        send(res, 409, JSON.stringify({ error: "素材处理技能已在技能中心的专属设置中关闭", code: "SKILL_DISABLED" }), "application/json; charset=utf-8");
        return true;
      }
      materialMode = body.mode === "commit" ? "commit" : "preview";
      materialPreviewTaskId = String(body.previewTaskId || "").trim();
      if (materialMode === "commit" && body.confirm !== true) {
        send(res, 409, JSON.stringify({ error: "执行整理前需要确认预览结果", code: "SKILL_CONFIRMATION_REQUIRED" }), "application/json; charset=utf-8");
        return true;
      }
      if (materialMode === "commit") {
        const preview = tasks.get(materialPreviewTaskId);
        if (!preview || preview.skillId !== MATERIAL_INGESTION_SKILL_ID || preview.state !== "preview_ready") {
          send(res, 409, JSON.stringify({ error: "请先完成一次素材预览，再确认整理", code: "SKILL_PREVIEW_REQUIRED" }), "application/json; charset=utf-8");
          return true;
        }
      }
    }
    if (skillId === TEMPLATE_REPOSITORY_SKILL_ID) {
      try {
        input = await readJsonBody(getBody, req, 10_000_000);
      } catch (error) {
        send(res, 400, JSON.stringify({ error: error.message, code: "SKILL_REQUEST_INVALID" }), "application/json; charset=utf-8");
        return true;
      }
      const normalized = normalizeTemplateRepositoryInput(input);
      if (!hasTemplateRepositoryInput(normalized)) {
        send(res, 400, JSON.stringify({ error: "请粘贴公开链接、拖入本地文件/文件夹，或粘贴图片", code: "TEMPLATE_INPUT_EMPTY" }), "application/json; charset=utf-8");
        return true;
      }
    }
    if (skillId === DEVICE_TRANSFER_SKILL_ID) {
      try {
        input = await readJsonBody(getBody, req, 16_000);
      } catch (error) {
        send(res, 400, JSON.stringify({ error: error.message, code: "SKILL_REQUEST_INVALID" }), "application/json; charset=utf-8");
        return true;
      }
    }
    const task = {
      id: `native-skill-${skillId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      skillId,
      mode: skillId === MATERIAL_INGESTION_SKILL_ID ? materialMode : skill.mode,
      state: "queued",
      progress: 0,
      createdAt: now(),
      updatedAt: now(),
      steps: nativeSteps(skill),
      ...(input ? { input } : {}),
      ...(materialPreviewTaskId ? { previewTaskId: materialPreviewTaskId } : {})
    };
    tasks.set(task.id, task);
    while (tasks.size > MAX_TASKS) tasks.delete(tasks.keys().next().value);
    executeNativeTask(task, {
      requestConversionService,
      getConversionSnapshot,
      getDeviceStatus,
      maybeStartAutomaticDistribution,
      getAutomaticDistributionMonitorState,
      getPageSettings,
      registeredDevices,
      DEVICE_PRESENCE_FILE,
      DISTRIBUTION_AUTOMATION_LOG_FILE
    }).catch((error) => updateTask(task, {
      state: "failed",
      error: { code: error.code || "SKILL_EXECUTION_FAILED", message: skillId === TEMPLATE_REPOSITORY_SKILL_ID ? "模板仓库任务异常结束，未宣称模板已完成同步。" : "技能任务异常结束，未宣称正式知识已更新。" }
    }));
    send(res, 202, JSON.stringify(publicTask(task)), "application/json; charset=utf-8");
    return true;
  }
  if (skillId === SKILL_ID && action === "status" && req.method === "GET") {
    sendJson(res, await inspectSkill());
    return true;
  }
  if (skillId === SKILL_ID && action === "tasks" && req.method === "GET") {
    sendJson(res, [...tasks.values()].slice(-MAX_TASKS).reverse().map(publicTask));
    return true;
  }
  if (skillId === SKILL_ID && action === "run" && req.method === "POST") {
    let body;
    try { body = await readJsonBody(getBody, req); } catch (error) {
      send(res, 400, JSON.stringify({ error: error.message, code: "SKILL_REQUEST_INVALID" }), "application/json; charset=utf-8");
      return true;
    }
    const mode = body.mode === "commit" ? "commit" : "preview";
    if (mode === "commit" && body.confirm !== true) {
      send(res, 409, JSON.stringify({ error: "写表前需要确认预览结果", code: "SKILL_CONFIRMATION_REQUIRED" }), "application/json; charset=utf-8");
      return true;
    }
    const task = {
      id: `lead-skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      skillId: SKILL_ID,
      mode,
      state: "queued",
      progress: 0,
      createdAt: now(),
      updatedAt: now(),
      steps: initialSteps(),
      paths: defaultPaths(),
      autoStartDependencies: getPageSettings?.().skills?.leadAutoStartDependencies !== false
    };
    tasks.set(task.id, task);
    while (tasks.size > MAX_TASKS) tasks.delete(tasks.keys().next().value);
    executeTask(task).catch((error) => updateTask(task, {
      state: "failed",
      error: { code: error.code || "SKILL_EXECUTION_FAILED", message: "技能任务异常结束，未宣称外部写入成功。" }
    }));
    sendJson(res, publicTask(task), 202);
    return true;
  }
  send(res, 404, JSON.stringify({ error: "skill route not found", code: "SKILL_ROUTE_NOT_FOUND" }), "application/json; charset=utf-8");
  return true;
}

module.exports = {
  SKILL_ID,
  MATERIAL_INGESTION_SKILL_ID,
  TEMPLATE_REPOSITORY_SKILL_ID,
  MOMENTS_SKILL_ID,
  DEVICE_TRANSFER_SKILL_ID,
  CONVERSION_KNOWLEDGE_MODULES,
  CONVERSION_KNOWLEDGE_SOURCE,
  NATIVE_SKILLS,
  PROJECT_SKILLS,
  catalogSkillStatus,
  defaultPaths,
  leadOpenTargets,
  inspectSkill,
  nativeSkillStatus,
  deviceFolderTransferSkillStatus,
  runDeviceFolderTransferSkill,
  knowledgeSourceStatus,
  materialIngestionSkillStatus,
  materialIngestionSkillSettings,
  saveMaterialIngestionSkillSettings,
  validateMaterialIngestionRoots,
  materialIngestionCommandArgs,
  parseMaterialIngestionOutput,
  projectSkillStatus,
  templateRepositorySkillStatus,
  templateRepositoryEntry,
  normalizeTemplateRepositoryInput,
  hasTemplateRepositoryInput,
  normalizeTemplateCollectorRequest,
  publicCollectorRecord,
  collectorStatusLabel,
  registerCollectedTemplateInGallery,
  validateTemplateRepositoryPaths,
  materialDownloadCatalog: materialDownloadRoute.catalog,
  publicTask,
  handle
};
