(function templateMigrationPanel() {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const state = { session: null };
  const labels = {
    idle: "未建立批次",
    ready: "批次已建立",
    confirmed: "已确认，待生产",
    paused: "已暂停",
    completed: "批次完成"
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || `请求失败（${response.status}）`);
      error.code = payload.code || "TEMPLATE_MIGRATION_REQUEST_FAILED";
      throw error;
    }
    return payload;
  }

  function setMessage(selector, message, tone = "") {
    const element = $(selector);
    if (!element) return;
    element.textContent = message;
    if (tone) element.dataset.tone = tone;
    else delete element.dataset.tone;
  }

  function setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      button.dataset.originalText = button.textContent;
      button.textContent = busyText || "处理中…";
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      delete button.dataset.originalText;
      button.disabled = false;
    }
  }

  function inputValues() {
    return {
      templatePath: $("#templateMigrationTemplatePath")?.value.trim() || "",
      materialRoot: $("#templateMigrationMaterialRoot")?.value.trim() || "",
      outputRoot: $("#templateMigrationOutputRoot")?.value.trim() || ""
    };
  }

  function saveInputs() {
    try { localStorage.setItem("template-migration-inputs-v1", JSON.stringify(inputValues())); } catch (_) {}
  }

  function restoreInputs() {
    try {
      const saved = JSON.parse(localStorage.getItem("template-migration-inputs-v1") || "{}");
      ["templatePath", "materialRoot", "outputRoot"].forEach((key) => {
        const element = $(`#templateMigration${key[0].toUpperCase()}${key.slice(1)}`);
        if (element && saved[key]) element.value = saved[key];
      });
    } catch (_) {}
  }

  function selectedMaterialPaths() {
    return [...document.querySelectorAll("#templateMigrationMaterials input[type=checkbox]:checked")]
      .map((input) => input.value)
      .filter(Boolean);
  }

  function renderMaterialList(session) {
    const categories = $("#templateMigrationCategories");
    const materials = $("#templateMigrationMaterials");
    const list = Array.isArray(session?.scan?.materials) ? session.scan.materials : [];
    const categoryList = Array.isArray(session?.scan?.categories) ? session.scan.categories : [];
    if (categories) {
      categories.innerHTML = categoryList.length
        ? categoryList.map((item) => `<span class="template-migration-category">${escapeHtml(item.name)} · ${item.materialCount}</span>`).join("")
        : `<span class="template-migration-category">根目录 · ${list.length}</span>`;
    }
    if (!materials) return;
    if (!list.length) {
      materials.innerHTML = `<div class="template-migration-material-empty">没有找到包含图片或文案的素材包。</div>`;
      return;
    }
    materials.innerHTML = list.map((item, index) => {
      const tags = Array.isArray(item.tags) && item.tags.length ? item.tags.slice(0, 3).join(" · ") : "未读取到标签";
      return `<label class="template-migration-material-item">
        <input type="checkbox" value="${escapeHtml(item.path)}" checked aria-label="选择 ${escapeHtml(item.name)}" />
        <span><strong>${escapeHtml(item.name || `素材包 ${index + 1}`)}</strong><small>${escapeHtml(item.relativePath || item.path)} · ${escapeHtml(tags)}</small></span>
        <span class="template-migration-material-count">图 ${Number(item.imageCount || 0)} · 文 ${Number(item.textCount || 0)}</span>
      </label>`;
    }).join("");
  }

  function renderPlan(session) {
    const plan = $("#templateMigrationPlan");
    const item = session?.scan?.materials?.[session?.progress?.currentIndex];
    if (!plan) return;
    if (!session) {
      plan.innerHTML = `<strong>计划规则</strong><p>模板控制视觉结构；素材控制事实、图片、文案和原有标签；单套最多 10 页；不补写未知事实。</p><p class="template-migration-confirm-hint">建立批次后，这里会显示逐套计划，并等待输入 <b>1</b>。</p>`;
      return;
    }
    const tags = item?.tags?.length ? item.tags.join("、") : "暂无原有标签";
    const waiting = session.plan?.waitingForConfirmation;
    plan.innerHTML = `<strong>当前套计划${item ? ` · ${escapeHtml(item.name)}` : ""}</strong>
      <p>模板：${escapeHtml(session.template?.name || "未命名模板")}（已锁定视觉骨架）</p>
      <p>素材：${item ? `${Number(item.imageCount || 0)} 张图 / ${Number(item.textCount || 0)} 个文本文件` : "无"}；原有标签：${escapeHtml(tags)}</p>
      <p>页数：最多 ${Number(session.plan?.maxPagesPerSet || 10)} 页；事实：只取素材明确内容，不补写。</p>
      <p class="template-migration-confirm-hint">${waiting ? "等待输入 1，暂不正式出图。" : "计划已确认，可以进入当前窗口的单套生产。"}</p>`;
  }

  function renderSession(session) {
    state.session = session || null;
    const badge = $("#templateMigrationStateBadge");
    const status = session?.status || "idle";
    if (badge) {
      badge.textContent = labels[status] || status;
      badge.dataset.state = status;
    }
    const materials = session?.scan?.materials || [];
    const progress = session?.progress || {};
    const total = Number(progress.total || materials.length || 0);
    const index = Number(progress.currentIndex ?? -1);
    const completed = Number(progress.completed || 0);
    const percent = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    const current = index >= 0 ? materials[index] : null;
    const outputLibrary = session?.outputLibrary || "成品库\\_套板迁移";
    if ($("#templateMigrationOutputLibrary")) $("#templateMigrationOutputLibrary").textContent = outputLibrary;
    if ($("#templateMigrationTemplateName")) $("#templateMigrationTemplateName").textContent = session?.template?.name || "未选择";
    if ($("#templateMigrationCurrentMaterial")) $("#templateMigrationCurrentMaterial").textContent = current?.name || (status === "completed" ? "批次已完成" : "未开始");
    if ($("#templateMigrationCurrentSet")) $("#templateMigrationCurrentSet").textContent = total ? `${Math.min(index + 1, total)} / ${total}` : "0 / 0";
    if ($("#templateMigrationCurrentFolder")) $("#templateMigrationCurrentFolder").textContent = progress.currentWorkFolder || "确认后创建";
    if ($("#templateMigrationProgressBar")) $("#templateMigrationProgressBar").style.width = `${percent}%`;
    if ($("#templateMigrationProgressPercent")) $("#templateMigrationProgressPercent").textContent = `${percent}%`;
    if ($("#templateMigrationProgressLabel")) $("#templateMigrationProgressLabel").textContent = session ? `${completed} 套已完成 · ${Math.max(0, total - completed)} 套待处理` : "等待建立批次";
    if ($("#templateMigrationMaterialSummary")) $("#templateMigrationMaterialSummary").textContent = session ? `${materials.length} 个素材包 · ${session.scan?.truncated ? "扫描已到上限" : "递归扫描完成"}` : "尚未扫描";
    renderMaterialList(session);
    renderPlan(session);
    const hasSession = Boolean(session);
    const canConfirm = hasSession && session.status === "ready" && total > 0;
    const canComplete = hasSession && session.status === "confirmed" && index >= 0 && index < total;
    if ($("#templateMigrationConfirmBtn")) $("#templateMigrationConfirmBtn").disabled = !canConfirm;
    if ($("#templateMigrationCompleteBtn")) $("#templateMigrationCompleteBtn").disabled = !canComplete;
    if ($("#templateMigrationRescanBtn")) $("#templateMigrationRescanBtn").disabled = !hasSession;
    if ($("#templateMigrationSelectAllBtn")) $("#templateMigrationSelectAllBtn").disabled = !materials.length;
    if ($("#templateMigrationStatus")) {
      const message = !session
        ? "尚未建立生产批次。"
        : session.status === "ready"
          ? "批次已建立，计划等待输入 1。"
          : session.status === "confirmed"
            ? "计划已确认；当前面板只负责批次状态，正式出图仍由内容生产单窗口执行。"
            : session.status === "completed"
              ? "本批次已完成。"
              : `当前状态：${labels[session.status] || session.status}`;
      setMessage("#templateMigrationStatus", message, session.status === "completed" ? "success" : "");
    }
  }

  async function loadState() {
    try {
      const payload = await request("/api/template-migration/session");
      renderSession(payload.session);
    } catch (error) {
      setMessage("#templateMigrationStatus", `读取状态失败：${error.message}`, "error");
    }
  }

  async function createBatch() {
    const button = $("#templateMigrationCreateBtn");
    const values = inputValues();
    saveInputs();
    if (Object.values(values).some((value) => !value)) {
      setMessage("#templateMigrationInputStatus", "模板、素材库、成品库三条路径都要填写。", "error");
      return;
    }
    setBusy(button, true, "扫描中…");
    try {
      const payload = await request("/api/template-migration/session", {
        method: "POST",
        body: JSON.stringify({ ...values, selectedMaterialPaths: selectedMaterialPaths() })
      });
      renderSession(payload.session);
      setMessage("#templateMigrationInputStatus", `已建立批次：${payload.session.scan.materials.length} 个素材包；固定落位已准备。`, "success");
    } catch (error) {
      setMessage("#templateMigrationInputStatus", `建立批次失败：${error.message}`, "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function refreshScan() {
    const button = $("#templateMigrationRescanBtn");
    setBusy(button, true, "扫描中…");
    try {
      const payload = await request("/api/template-migration/session/refresh", { method: "POST", body: "{}" });
      renderSession(payload.session);
      setMessage("#templateMigrationInputStatus", `素材库已重新扫描：${payload.session.scan.materials.length} 个素材包。`, "success");
    } catch (error) {
      setMessage("#templateMigrationInputStatus", `重新扫描失败：${error.message}`, "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function confirmBatch() {
    const button = $("#templateMigrationConfirmBtn");
    setBusy(button, true, "确认中…");
    try {
      const payload = await request("/api/template-migration/session/confirm", {
        method: "POST",
        body: JSON.stringify({ confirmation: "1", selectedMaterialPaths: selectedMaterialPaths() })
      });
      renderSession(payload.session);
      setMessage("#templateMigrationStatus", "已收到 1：模板锁定，当前套文件夹已创建，等待单窗口正式生产。", "success");
    } catch (error) {
      setMessage("#templateMigrationStatus", `确认失败：${error.message}`, "error");
    } finally {
      setBusy(button, false);
      button.disabled = !state.session || state.session.status !== "ready";
    }
  }

  async function completeCurrent() {
    const button = $("#templateMigrationCompleteBtn");
    setBusy(button, true, "推进中…");
    try {
      const payload = await request("/api/template-migration/session/advance", { method: "POST", body: JSON.stringify({ action: "complete" }) });
      renderSession(payload.session);
      setMessage("#templateMigrationStatus", "当前套已登记完成，已切换到下一套。", "success");
    } catch (error) {
      setMessage("#templateMigrationStatus", `推进失败：${error.message}`, "error");
    } finally {
      setBusy(button, false);
      button.disabled = !state.session || state.session.status !== "confirmed";
    }
  }

  function bind() {
    if (!$("#templateMigrationView") || document.body.dataset.templateMigrationReady === "true") return;
    document.body.dataset.templateMigrationReady = "true";
    restoreInputs();
    $("#templateMigrationCreateBtn")?.addEventListener("click", createBatch);
    $("#templateMigrationRescanBtn")?.addEventListener("click", refreshScan);
    $("#templateMigrationConfirmBtn")?.addEventListener("click", confirmBatch);
    $("#templateMigrationCompleteBtn")?.addEventListener("click", completeCurrent);
    $("#templateMigrationRefreshBtn")?.addEventListener("click", loadState);
    $("#templateMigrationSelectAllBtn")?.addEventListener("click", () => {
      document.querySelectorAll("#templateMigrationMaterials input[type=checkbox]").forEach((input) => { input.checked = true; });
    });
    ["#templateMigrationTemplatePath", "#templateMigrationMaterialRoot", "#templateMigrationOutputRoot"].forEach((selector) => {
      $(selector)?.addEventListener("change", saveInputs);
    });
    loadState();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})();
