(function exposeWorkbenchCommandBus(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WorkbenchCommandBus = factory();
})(typeof globalThis === "object" ? globalThis : window, () => {
  const SOURCES = new Set(["ui", "assistant", "voice", "ai", "automation", "mcp"]);

  function normalizeSource(value) {
    const source = String(value || "assistant").trim().toLowerCase();
    return SOURCES.has(source) ? source : "assistant";
  }

  function normalizeDefinition(definition = {}) {
    const id = String(definition.id || "").trim();
    if (!/^[a-z][a-z0-9._-]{1,80}$/i.test(id)) {
      throw new Error(`无效的工作台动作编号：${id || "空"}`);
    }
    return Object.freeze({
      id,
      label: String(definition.label || id).trim().slice(0, 80),
      description: String(definition.description || "").trim().slice(0, 240),
      readOnly: definition.readOnly === true,
      confirm: definition.confirm === true,
      sources: Array.isArray(definition.sources)
        ? [...new Set(definition.sources.map(normalizeSource))]
        : ["ui", "assistant", "voice", "ai"]
    });
  }

  function createWorkbenchCommandBus() {
    const commands = new Map();

    function register(definition, handler) {
      const definitionValue = normalizeDefinition(definition);
      if (typeof handler !== "function") throw new TypeError(`动作没有处理器：${definitionValue.id}`);
      if (commands.has(definitionValue.id)) throw new Error(`动作已注册：${definitionValue.id}`);
      commands.set(definitionValue.id, { definition: definitionValue, handler });
      return definitionValue;
    }

    function describe() {
      return [...commands.values()].map((entry) => entry.definition);
    }

    async function dispatch(input = {}) {
      const id = String(input.actionId || input.id || "").trim();
      const entry = commands.get(id);
      const source = normalizeSource(input.source);
      const requestId = String(input.requestId || `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 120);
      if (!entry) return { ok: false, requestId, actionId: id, source, error: `未登记的工作台动作：${id || "空"}` };
      if (entry.definition.sources.length && !entry.definition.sources.includes(source)) {
        return { ok: false, requestId, actionId: id, source, error: `动作不允许从${source}入口调用：${entry.definition.label}` };
      }
      const args = input.args && typeof input.args === "object" ? input.args : {};
      try {
        const result = await entry.handler(args, { actionId: id, requestId, source, definition: entry.definition });
        if (result && typeof result === "object" && result.ok === false) {
          return {
            ok: false,
            requestId,
            actionId: id,
            source,
            error: String(result.error || result.reason || `${entry.definition.label}未执行`),
            result
          };
        }
        return { ok: true, requestId, actionId: id, source, result };
      } catch (error) {
        return { ok: false, requestId, actionId: id, source, error: error?.message || String(error) };
      }
    }

    return Object.freeze({ register, describe, dispatch });
  }

  return Object.freeze({ createWorkbenchCommandBus, normalizeSource });
});
