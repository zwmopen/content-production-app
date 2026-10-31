/**
 * 内容制作原生抽屉与全屏视口交互控制器 (Native Production Drawer & Contextual Preview Controller)
 * 2026-10-31 重构实装：基于《轮播母版迁移器 V4.8.8》与人机双轨 4 步流
 */
(function() {
  'use strict';

  const state = {
    accountId: '',
    accountName: '',
    slot: '',
    port: window.location.port || '4331',
    templates: [],
    material: null,
    materialsList: [],
    selectedTemplateId: 'T51',
    selectedMaterialPath: '',
    drawerCollapsed: false,
    viewMode: 'big-panel', // 'big-panel' (默认大面板·低显存) 或 'browser-view' (前台网页巡检)
    workflowState: '状态二 · 等待素材',
    prompts: {
      v488: '',
      step1: '',
      step2: '',
      step3: ''
    },
    planItems: [],
    generatedImages: [],
    copywriting: {
      xhs1: '',
      xhs2: '',
      dy: '',
      multi: ''
    },
    activeCopyTab: 'xhs1',
    isStepBusy: false
  };

  async function apiFetch(endpoint, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(endpoint, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
        signal: controller.signal
      });
      return await res.json();
    } catch (err) {
      console.warn(`[native-drawer] API call failed: ${endpoint}`, err);
      return { ok: false, error: err.message };
    } finally {
      clearTimeout(timeout);
    }
  }

  function showToast(message, type = 'info') {
    if (window.showWorkbenchAssistantBubble) {
      window.showWorkbenchAssistantBubble(message, { tone: type === 'error' ? 'danger' : (type === 'success' ? 'success' : 'info'), duration: 2500 });
      return;
    }
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#1e293b;color:#f8fafc;padding:8px 16px;border-radius:6px;font-size:12px;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.5);border:1px solid #3b82f6;';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  // 1. 初始化数据加载
  async function init() {
    state.port = window.location.port || '4331';

    try {
      const savedMode = localStorage.getItem('pts_view_mode');
      state.viewMode = savedMode === 'online' ? 'online' : 'local'; // 默认进入本地模式 (大面板)
    } catch (_) {
      state.viewMode = 'local';
    }

    applyViewMode(state.viewMode, false);
    bindGlobalDrawerEvents();
    bindWorkflowEvents();

    // 并行加载提示词、模板目录与当前素材
    await loadInitialData();

    // 监听账号切换
    window.addEventListener('tb-gpt-accounts-changed', selectAccount);
    void selectAccount();

    // 初始化计划面板
    initPlanSectionAndModal();
  }

  async function loadInitialData() {
    const [promptsRes, catalogRes, materialRes] = await Promise.all([
      apiFetch('/api/production/prompts'),
      apiFetch('/api/templates/catalog'),
      apiFetch('/api/materials/current-detail')
    ]);

    if (promptsRes && promptsRes.ok && promptsRes.prompts) {
      state.prompts = promptsRes.prompts;
    }

    if (catalogRes && catalogRes.ok && Array.isArray(catalogRes.templates)) {
      state.templates = catalogRes.templates;
      renderTemplateSelector();
    }

    if (materialRes && materialRes.ok) {
      state.material = materialRes;
      renderMaterialInfo();
    }
  }

  function renderTemplateSelector() {
    const sel = document.getElementById('selStep1Template');
    if (!sel) return;
    sel.replaceChildren();

    state.templates.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `[${t.id}] ${t.name || '方案母版'}`;
      if (t.id === state.selectedTemplateId) opt.selected = true;
      sel.appendChild(opt);
    });

    updateStep1TemplatePreview();
  }

  function updateStep1TemplatePreview() {
    const currentTpl = state.templates.find(t => t.id === state.selectedTemplateId) || state.templates[0];
    const p1Img = document.getElementById('step1P1Thumb');
    const p2Img = document.getElementById('step1P2Thumb');
    const metaEl = document.getElementById('step1TplMeta');

    if (currentTpl) {
      if (p1Img) {
        p1Img.src = currentTpl.p1Url || '';
        p1Img.onclick = () => openLightbox(currentTpl.p1Url);
      }
      if (p2Img) {
        p2Img.src = currentTpl.p2Url || '';
        p2Img.onclick = () => openLightbox(currentTpl.p2Url);
      }
      if (metaEl) {
        metaEl.innerHTML = `<strong>${currentTpl.id} · ${currentTpl.name || '方案母版'}</strong><br><span style="font-size:10px;color:#64748b;">${currentTpl.category || '方案母版'} · 已加载 V4.8.8 提示词</span>`;
      }
    }
  }

  function renderMaterialInfo() {
    const sel = document.getElementById('selStep2Material');
    const countEl = document.getElementById('step2MaterialCountText');
    const txtEl = document.getElementById('step2HasTxtText');
    const mdEl = document.getElementById('step2HasMdText');

    if (sel && sel.options.length === 0) {
      const opt = document.createElement('option');
      opt.value = state.material?.path || '';
      opt.textContent = state.material?.name || '当前选中素材包';
      opt.selected = true;
      sel.appendChild(opt);
    }

    if (state.material) {
      if (countEl) countEl.textContent = `${state.material.count || (state.material.images ? state.material.images.length : 0)} 张实拍照片`;
      if (txtEl) txtEl.textContent = state.material.hasTxt !== false ? '文案TXT: 存在' : '文案TXT: 缺失';
      if (mdEl) mdEl.textContent = state.material.hasMd !== false ? '行程MD: 存在' : '行程MD: 缺失';
    }
  }

  function selectAccount() {
    const context = window.getGptProductionDrawerContext?.() || {};
    const profiles = Array.isArray(context.profiles) ? context.profiles : [];
    const index = profiles.findIndex(profile => profile.id === context.accountId);
    state.accountId = index >= 0 ? context.accountId : '';
    state.accountName = index >= 0 ? profiles[index].name || state.accountId : '';
    state.slot = index >= 0 ? String.fromCharCode(97 + index) : ''; // 小写字母 a~f

    const badge = document.getElementById('ptsWorkflowStateBadge');
    if (badge) {
      badge.textContent = `${state.slot ? `[${state.slot}] ` : ''}${state.workflowState}`;
    }
  }

  // 核心模式切换控制器：【本地模式】vs【在线模式】
  // (a) 本地模式：操作大面板界面，纯粹后台 CDP 静默运行，无前端网页渲染，零显存占用
  // (b) 在线模式：打开浏览器可视化界面，显示 GPT 原生网页界面，供人工查看与操作
  async function applyViewMode(mode, userInitiated = false) {
    state.viewMode = mode === 'online' ? 'online' : 'local';
    try { localStorage.setItem('pts_view_mode', state.viewMode); } catch (_) {}

    const modeIcon = document.getElementById('topbarModeIcon');
    const modeLabel = document.getElementById('topbarModeLabel');
    const modeTag = document.getElementById('topbarModeTag');
    const subBadge = document.getElementById('ptsSubModeBadge');
    const headerSwitchBtn = document.getElementById('btnHeaderSwitchView');

    if (state.viewMode === 'local') {
      // 1. 【本地模式】：大面板独占前台，GPT 网页完全转入纯后台隐藏模式，释放显存与显卡
      document.body.classList.add('production-panel-active');

      // 强行关闭前台原生 BrowserView，纯靠后台 CDP 穿透静默驱动
      if (window.gptWorkbench?.hide) {
        await window.gptWorkbench.hide().catch(() => {});
      }

      if (modeIcon) modeIcon.textContent = '🖥️';
      if (modeLabel) modeLabel.textContent = '模式：本地模式';
      if (modeTag) {
        modeTag.textContent = '切至在线模式 ➔';
        modeTag.style.background = 'rgba(59, 130, 246, 0.2)';
        modeTag.style.color = '#93c5fd';
      }
      if (subBadge) {
        subBadge.textContent = '⚡ 本地模式 · 纯CDP后台静默运行 (零显存占用)';
        subBadge.style.color = '#4ade80';
      }
      if (headerSwitchBtn) {
        headerSwitchBtn.innerHTML = '<span>🌐 切换在线模式 (浏览器网页)</span>';
      }

      if (userInitiated) {
        showToast('已切换至【本地模式】：大面板控制中枢激活，GPT 网页纯后台静默运行，零显存占用！', 'success');
      }
    } else {
      // 2. 【在线模式】：打开浏览器可视化界面，展示 ChatGPT 原生网页画面供人工查看与操作
      document.body.classList.remove('production-panel-active');

      // 恢复前台原生 BrowserView
      restoreEmbeddedGptViewSafely();

      if (modeIcon) modeIcon.textContent = '🌐';
      if (modeLabel) modeLabel.textContent = '模式：在线模式';
      if (modeTag) {
        modeTag.textContent = '切至本地模式 ➔';
        modeTag.style.background = 'rgba(234, 179, 8, 0.2)';
        modeTag.style.color = '#fde047';
      }
      if (subBadge) {
        subBadge.textContent = '🌐 在线模式 · 浏览器画面已呈现 (人工巡检)';
        subBadge.style.color = '#fde047';
      }
      if (headerSwitchBtn) {
        headerSwitchBtn.innerHTML = '<span>🖥️ 切换本地模式 (操作大面板)</span>';
      }

      if (userInitiated) {
        showToast('已切换至【在线模式】：浏览器可视化界面已打开，可直接人工操作网页！', 'info');
      }
    }
  }

  function restoreEmbeddedGptViewSafely() {
    try {
      const host = document.getElementById('gptEmbeddedHost');
      if (host && window.gptWorkbench?.show) {
        const rect = host.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50) {
          const bounds = {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          };
          window.gptWorkbench.show(bounds, state.accountId).catch(() => {});
        }
      }
    } catch (_) {}
  }

  // 绑定全局抽屉与展开折叠
  function bindGlobalDrawerEvents() {
    const btnSwitchMode = document.getElementById('btnSwitchViewMode') || document.getElementById('btnSwitchProdViewMode');
    const btnHeaderSwitch = document.getElementById('btnHeaderSwitchView') || document.getElementById('btnHeaderSwitchToWeb');

    const toggleMode = () => {
      const targetMode = state.viewMode === 'local' ? 'online' : 'local';
      applyViewMode(targetMode, true);
    };

    btnSwitchMode?.addEventListener('click', toggleMode);
    btnHeaderSwitch?.addEventListener('click', toggleMode);

    // Lightbox 关闭
    const lightboxModal = document.getElementById('ptsLightboxModal');
    const lightboxBackdrop = document.getElementById('ptsLightboxBackdrop');
    const btnCloseLightbox = document.getElementById('btnCloseLightbox');
    const closeLightbox = () => { if (lightboxModal) lightboxModal.style.display = 'none'; };
    lightboxBackdrop?.addEventListener('click', closeLightbox);
    btnCloseLightbox?.addEventListener('click', closeLightbox);
  }

  function renderDrawerCollapseState() {
    const sidebar = document.getElementById('prodTemplateSidebar');
    const grid = document.querySelector('.gpt-production-test-grid') || document.getElementById('gptProductionMainGrid');
    const btnToggle = document.getElementById('btnToggleProdDrawer');

    if (grid) grid.classList.toggle('drawer-collapsed', state.drawerCollapsed);
    if (sidebar) sidebar.style.display = state.drawerCollapsed ? 'none' : 'flex';
    if (btnToggle) {
      btnToggle.setAttribute('aria-expanded', String(!state.drawerCollapsed));
    }
  }

  function openLightbox(url) {
    if (!url) return;
    const modal = document.getElementById('ptsLightboxModal');
    const img = document.getElementById('ptsLightboxImage');
    const caption = document.getElementById('ptsLightboxCaption');
    if (modal && img) {
      img.src = url;
      if (caption) caption.textContent = url.split('/').pop() || '图片预览';
      modal.style.display = 'flex';
    }
  }

  // 绑定 4 步流事件
  function bindWorkflowEvents() {
    // 步骤 1：母版选择切换
    const selTpl = document.getElementById('selStep1Template');
    selTpl?.addEventListener('change', () => {
      state.selectedTemplateId = selTpl.value;
      updateStep1TemplatePreview();
    });

    // 步骤 1：发送母版学习
    const btnLock = document.getElementById('btnStep1LockTemplate');
    const step1Badge = document.getElementById('step1StatusBadge');
    btnLock?.addEventListener('click', async () => {
      if (state.isStepBusy) return;
      state.isStepBusy = true;
      if (step1Badge) {
        step1Badge.textContent = '⏳ 学习锁定中...';
        step1Badge.className = 'pts-step-status busy';
      }
      showToast('正在向当前 ChatGPT 窗口发送母版与 V4.8.8 提示词...', 'info');

      const currentTpl = state.templates.find(t => t.id === state.selectedTemplateId);
      const files = currentTpl?.files || [];
      const res = await apiFetch('/api/production/step/execute', {
        method: 'POST',
        body: JSON.stringify({
          promptText: state.prompts.v488,
          files: files
        })
      });

      state.isStepBusy = false;
      if (res && res.ok) {
        state.workflowState = '状态二 · 等待素材';
        if (step1Badge) {
          step1Badge.textContent = '✅ 已锁定';
          step1Badge.className = 'pts-step-status locked';
        }
        showToast('母版学习指令已成功发送至 ChatGPT！', 'success');
      } else {
        if (step1Badge) {
          step1Badge.textContent = '❌ 发送失败';
          step1Badge.className = 'pts-step-status';
        }
        showToast(res?.error || '发送失败，请检查 ChatGPT 页面连接', 'error');
      }
    });

    // 步骤 1：复制完整提示词
    const btnCopyV488 = document.getElementById('btnStep1CopyPrompt');
    btnCopyV488?.addEventListener('click', () => {
      if (!state.prompts.v488) {
        showToast('提示词正在加载中，请稍候', 'warning');
        return;
      }
      navigator.clipboard.writeText(state.prompts.v488).then(() => {
        showToast('已成功复制《轮播母版迁移器 V4.8.8》完整提示词至剪切板！', 'success');
      });
    });

    // 步骤 2：派发素材出计划
    const btnDispatch = document.getElementById('btnStep2Dispatch');
    const step2Badge = document.getElementById('step2StatusBadge');
    const planAccBody = document.getElementById('step2PlanAccBody');
    const planContent = document.getElementById('step2PlanContent');
    const planCountBadge = document.getElementById('step2PlanCountBadge');

    btnDispatch?.addEventListener('click', async () => {
      if (state.isStepBusy) return;
      state.isStepBusy = true;
      if (step2Badge) {
        step2Badge.textContent = '⏳ 正在出计划...';
        step2Badge.className = 'pts-step-status busy';
      }
      showToast('正在上传选题素材与派发指令，等待 GPT 梳理逐页迁移计划...', 'info');

      const res = await apiFetch('/api/production/step/execute', {
        method: 'POST',
        body: JSON.stringify({
          promptText: state.prompts.step1,
          files: state.material?.files || []
        })
      });

      if (res && res.ok) {
        showToast('素材派发指令已发送，正在轮询计划结果...', 'info');
        // 开启轮询计划
        pollPlanResult();
      } else {
        state.isStepBusy = false;
        if (step2Badge) {
          step2Badge.textContent = '❌ 派发失败';
          step2Badge.className = 'pts-step-status';
        }
        showToast(res?.error || '素材派发失败', 'error');
      }
    });

    // 步骤 2：复制派发词
    const btnCopyStep1 = document.getElementById('btnStep2CopyPrompt');
    btnCopyStep1?.addEventListener('click', () => {
      navigator.clipboard.writeText(state.prompts.step1).then(() => {
        showToast('已复制《1. 和素材一起发》提示词至剪切板！', 'success');
      });
    });

    // 步骤 2：展开/折叠计划折叠卡
    const planAccHead = document.getElementById('step2PlanAccHead');
    planAccHead?.addEventListener('click', () => {
      if (!planAccBody) return;
      planAccBody.style.display = planAccBody.style.display === 'none' ? 'block' : 'none';
    });

    // 步骤 3：确认全量出图 (回复 1)
    const btnConfirmGen = document.getElementById('btnStep3ConfirmGenerate');
    const step3Badge = document.getElementById('step3StatusBadge');

    btnConfirmGen?.addEventListener('click', async () => {
      if (state.isStepBusy) return;
      state.isStepBusy = true;
      if (step3Badge) {
        step3Badge.textContent = '⏳ 全量出图中...';
        step3Badge.className = 'pts-step-status busy';
      }
      showToast('已发送确认出图指令（回复 1），GPT 正在一气呵成批量成图中...', 'info');

      const res = await apiFetch('/api/production/step/execute', {
        method: 'POST',
        body: JSON.stringify({
          promptText: state.prompts.step2
        })
      });

      if (res && res.ok) {
        pollImageResults();
      } else {
        state.isStepBusy = false;
        if (step3Badge) {
          step3Badge.textContent = '❌ 出图失败';
          step3Badge.className = 'pts-step-status';
        }
        showToast(res?.error || '出图指令发送失败', 'error');
      }
    });

    // 步骤 3：复制确认词
    const btnCopyStep2 = document.getElementById('btnStep3CopyPrompt');
    btnCopyStep2?.addEventListener('click', () => {
      navigator.clipboard.writeText(state.prompts.step2).then(() => {
        showToast('已复制《2. 出图阶段，确认计划》提示词至剪切板！', 'success');
      });
    });

    // 步骤 4：生成五版文案
    const btnGenCopy = document.getElementById('btnStep4GenerateCopy');
    const step4Badge = document.getElementById('step4StatusBadge');
    const copyPreview = document.getElementById('step4CopyPreview');

    btnGenCopy?.addEventListener('click', async () => {
      if (state.isStepBusy) return;
      state.isStepBusy = true;
      if (step4Badge) {
        step4Badge.textContent = '⏳ 生成文案中...';
        step4Badge.className = 'pts-step-status busy';
      }
      showToast('正在发送文案生成指令 (调用 teambuilding-copywriter 技能)...', 'info');

      const res = await apiFetch('/api/production/step/execute', {
        method: 'POST',
        body: JSON.stringify({
          promptText: state.prompts.step3
        })
      });

      if (res && res.ok) {
        pollCopyResults();
      } else {
        state.isStepBusy = false;
        if (step4Badge) {
          step4Badge.textContent = '❌ 文案失败';
          step4Badge.className = 'pts-step-status';
        }
        showToast(res?.error || '文案指令发送失败', 'error');
      }
    });

    // 步骤 4：复制文案词
    const btnCopyStep3 = document.getElementById('btnStep4CopyPrompt');
    btnCopyStep3?.addEventListener('click', () => {
      navigator.clipboard.writeText(state.prompts.step3).then(() => {
        showToast('已复制《3. 文案》提示词至剪切板！', 'success');
      });
    });

    // 步骤 4：打开成品夹
    const btnOpenFolder = document.getElementById('btnStep4OpenFolder');
    btnOpenFolder?.addEventListener('click', () => {
      showToast('成品库根目录：D:\\AICode\\项目推进\\projects\\江湖有旅人\\主项目\\03-成品库', 'info');
    });

    // 步骤 4：文案 Tab 切换
    const copyTabs = document.getElementById('step4CopyTabs');
    copyTabs?.addEventListener('click', (e) => {
      const btn = e.target.closest('.pts-tab-btn');
      if (!btn) return;
      copyTabs.querySelectorAll('.pts-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeCopyTab = btn.dataset.tab;
      updateCopyTextarea();
    });
  }

  // 轮询逐页计划
  async function pollPlanResult() {
    let retries = 0;
    const step2Badge = document.getElementById('step2StatusBadge');
    const planAccBody = document.getElementById('step2PlanAccBody');
    const planContent = document.getElementById('step2PlanContent');
    const planCountBadge = document.getElementById('step2PlanCountBadge');

    const timer = setInterval(async () => {
      retries++;
      if (retries > 60) {
        clearInterval(timer);
        state.isStepBusy = false;
        if (step2Badge) step2Badge.textContent = '⚠️ 计划超时';
        return;
      }

      const st = await apiFetch('/api/production/step/status');
      if (st && st.ok && st.state) {
        const text = st.state.lastText || '';
        if (text.includes('计划') || text.includes('P1') || text.includes('封面')) {
          if (!st.state.isGenerating) {
            clearInterval(timer);
            state.isStepBusy = false;
            if (step2Badge) {
              step2Badge.textContent = '✅ 计划就绪';
              step2Badge.className = 'pts-step-status done';
            }
            if (planAccBody) planAccBody.style.display = 'block';
            if (planContent) {
              planContent.innerHTML = formatPlanText(text);
            }
            if (planCountBadge) planCountBadge.textContent = '已生成';
            showToast('逐页迁移计划已生成！请核对后点击步骤3确认批量出图。', 'success');
          }
        }
      }
    }, 3000);
  }

  function formatPlanText(raw) {
    const lines = raw.split('\n');
    let html = '<div style="display:flex;flex-direction:column;gap:6px;">';
    lines.forEach(line => {
      const trimmed = line.trim();
      if (/^[-*•]?\s*P\d+/i.test(trimmed) || trimmed.includes('封面') || trimmed.includes('内页')) {
        html += `<div style="background:rgba(255,255,255,0.05);padding:6px 8px;border-radius:4px;border-left:3px solid #3b82f6;"><strong>${trimmed}</strong></div>`;
      } else if (trimmed) {
        html += `<div style="padding:2px 8px;color:#94a3b8;font-size:11px;">${trimmed}</div>`;
      }
    });
    html += '</div>';
    return html;
  }

  // 轮询批量成图
  async function pollImageResults() {
    let retries = 0;
    const step3Badge = document.getElementById('step3StatusBadge');
    const grid = document.getElementById('step3WaterfallGrid');
    const countBadge = document.getElementById('step3ImageCountBadge');

    const timer = setInterval(async () => {
      retries++;
      if (retries > 120) {
        clearInterval(timer);
        state.isStepBusy = false;
        if (step3Badge) step3Badge.textContent = '⚠️ 出图完成或超时';
        return;
      }

      const st = await apiFetch('/api/production/step/status');
      if (st && st.ok && st.state) {
        const imgs = st.state.images || [];
        if (countBadge) countBadge.textContent = `${imgs.length} 张`;
        if (imgs.length > 0 && grid) {
          renderWaterfallImages(imgs);
        }

        if (!st.state.isGenerating && imgs.length >= 6) {
          clearInterval(timer);
          state.isStepBusy = false;
          if (step3Badge) {
            step3Badge.textContent = `✅ 出齐 ${imgs.length} 张`;
            step3Badge.className = 'pts-step-status done';
          }
          showToast(`GPT 已全量出齐整套 ${imgs.length} 张独立竖图！请点击步骤 4 提取文案。`, 'success');
        }
      }
    }, 3000);
  }

  function renderWaterfallImages(images) {
    const grid = document.getElementById('step3WaterfallGrid');
    if (!grid) return;
    grid.replaceChildren();

    images.forEach((imgUrl, idx) => {
      const card = document.createElement('div');
      card.className = 'pts-thumb-card';
      card.title = `第 P${idx + 1} 页 (点击放大查看)`;
      card.innerHTML = `
        <span class="page-tag">P${idx + 1}</span>
        <img src="${imgUrl}" alt="P${idx + 1}" loading="lazy" />
      `;
      card.addEventListener('click', () => openLightbox(imgUrl));
      grid.appendChild(card);
    });
  }

  // 轮询文案结果
  async function pollCopyResults() {
    let retries = 0;
    const step4Badge = document.getElementById('step4StatusBadge');
    const copyPreview = document.getElementById('step4CopyPreview');

    const timer = setInterval(async () => {
      retries++;
      if (retries > 60) {
        clearInterval(timer);
        state.isStepBusy = false;
        if (step4Badge) step4Badge.textContent = '⚠️ 文案超时';
        return;
      }

      const st = await apiFetch('/api/production/step/status');
      if (st && st.ok && st.state) {
        const text = st.state.lastText || '';
        if (text.includes('小红书') || text.includes('抖音') || text.includes('MULTI') || text.includes('文案.txt')) {
          if (!st.state.isGenerating) {
            clearInterval(timer);
            state.isStepBusy = false;
            if (step4Badge) {
              step4Badge.textContent = '✅ 文案已就绪';
              step4Badge.className = 'pts-step-status done';
            }
            if (copyPreview) copyPreview.style.display = 'block';
            parseCopyText(text);
            updateCopyTextarea();
            showToast('五版文案与文案.txt已成功生成并落地！', 'success');
          }
        }
      }
    }, 3000);
  }

  function parseCopyText(raw) {
    state.copywriting.multi = raw;
    state.copywriting.xhs1 = extractSection(raw, '小红书1', '小红书2') || raw.slice(0, 800);
    state.copywriting.xhs2 = extractSection(raw, '小红书2', '抖音') || raw.slice(400, 1200);
    state.copywriting.dy = extractSection(raw, '抖音', 'MULTI') || raw.slice(800, 1600);
  }

  function extractSection(text, startKeyword, endKeyword) {
    const startIdx = text.indexOf(startKeyword);
    if (startIdx === -1) return '';
    const endIdx = endKeyword ? text.indexOf(endKeyword, startIdx) : -1;
    if (endIdx === -1) return text.slice(startIdx);
    return text.slice(startIdx, endIdx).trim();
  }

  function updateCopyTextarea() {
    const ta = document.getElementById('step4CopyTextarea');
    if (!ta) return;
    ta.value = state.copywriting[state.activeCopyTab] || state.copywriting.multi || '';
  }

  // 生产计划与批次模态框
  function initPlanSectionAndModal() {
    const planSelect = document.getElementById('ptsPlanSelect');
    const btnRefresh = document.getElementById('btnRefreshPlanProgress');
    planSelect?.addEventListener('change', async () => {
      const fileName = planSelect.value;
      await apiFetch('/api/production-realtime/switch', {
        method: 'POST',
        body: JSON.stringify({ fileName })
      });
    });
    btnRefresh?.addEventListener('click', () => {
      showToast('生产批次进度已刷新', 'info');
    });
  }

  // DOM 就绪后启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
