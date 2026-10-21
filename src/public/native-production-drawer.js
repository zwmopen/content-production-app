/**
 * 内容制作原生抽屉与全屏视口交互控制器 (Native Production Drawer & Contextual Preview Controller)
 * 2026-10-20 重构实装：完全独立自包含、三模式动态联动、真机实盘数据驱动
 */
(function() {
  'use strict';

  const state = {
    lineId: 'cdp-a',
    port: window.location.port || '4331',
    mode: '2_random_template',
    fixedTemplateId: 'T51',
    fixedTemplateName: '',
    p1Url: '',
    p2Url: '',
    templates: [],
    material: null,
    isAutoRunning: false,
    isPaused: false,
    drawerCollapsed: false,
    searchTerm: '',
    selectedCategory: 'all'
  };

  function resolveLineId() {
    const urlParams = new URLSearchParams(window.location.search);
    const paramLine = urlParams.get('lineId');
    if (paramLine) return paramLine.toLowerCase();

    const p = parseInt(window.location.port || '4331', 10);
    if (p === 4331 || p === 9431) return 'cdp-a';
    if (p === 4332 || p === 9432) return 'cdp-b';
    if (p === 4333 || p === 9433) return 'cdp-c';
    if (p === 4334 || p === 9434) return 'cdp-d';
    return 'cdp-a';
  }

  async function apiFetch(endpoint, options = {}) {
    try {
      const res = await fetch(endpoint, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      return await res.json();
    } catch (err) {
      console.warn(`[native-drawer] API call failed: ${endpoint}`, err);
      return { ok: false, error: err.message };
    }
  }

  // 1. 初始化数据加载
  async function init() {
    state.lineId = resolveLineId();
    state.port = window.location.port || '4331';

    // 读取本地折叠偏好
    try {
      const savedCollapsed = localStorage.getItem('pts_prod_drawer_collapsed');
      if (savedCollapsed === 'true') {
        state.drawerCollapsed = true;
      }
    } catch (_) {}

    // 并行拉取配置与数据
    const [configData, catalogData, materialData, statusData] = await Promise.all([
      apiFetch(`/api/pipeline-mode-config?lineId=${state.lineId}`),
      apiFetch('/api/templates/catalog'),
      apiFetch('/api/materials/current-detail'),
      apiFetch('/api/pipeline/producer-status')
    ]);

    if (configData && configData.ok) {
      state.mode = configData.mode || '2_random_template';
      state.fixedTemplateId = configData.fixedTemplateId || '';
      state.fixedTemplateName = configData.fixedTemplateName || '';
      state.p1Url = configData.p1Url || '';
      state.p2Url = configData.p2Url || '';
    }

    if (catalogData && catalogData.ok && Array.isArray(catalogData.templates)) {
      state.templates = catalogData.templates;
    }

    if (materialData && materialData.ok) {
      state.material = materialData;
    }

    if (statusData && statusData.ok) {
      state.isAutoRunning = statusData.isRunning;
      state.isPaused = statusData.isPaused;
    }

    // 绑定事件与首次渲染
    bindEvents();
    renderAll();

    // 定期 5 秒轮询调度守护与状态
    setInterval(pollStatus, 5000);
  }

  async function pollStatus() {
    const statusData = await apiFetch('/api/pipeline/producer-status');
    if (statusData && statusData.ok) {
      if (state.isAutoRunning !== statusData.isRunning || state.isPaused !== statusData.isPaused) {
        state.isAutoRunning = statusData.isRunning;
        state.isPaused = statusData.isPaused;
        renderAutoManualControls();
      }
    }
  }

  // 2. 界面总渲染
  function renderAll() {
    renderTopBar();
    renderDrawerCollapseState();
    renderModeCards();
    renderDynamicSection();
    renderMaterialSection();
    renderAutoManualControls();
  }

  // 顶栏状态与徽章
  function renderTopBar() {
    const instLetter = state.lineId === 'cdp-b' ? 'B' : (state.lineId === 'cdp-c' ? 'C' : (state.lineId === 'cdp-d' ? 'D' : 'A'));
    const instBadge = document.getElementById('topbarInstanceBadge');
    if (instBadge) {
      instBadge.textContent = `🟢 实例 ${instLetter} · (${state.port})`;
    }

    const modeIndicator = document.getElementById('topbarModeIndicator');
    if (modeIndicator) {
      let icon = '🎲';
      let title = '2·随机母版 (推荐)';
      if (state.mode === '1_replica_shuffle') {
        icon = '🔀';
        title = '1·复刻重组 (原版)';
      } else if (state.mode === '3_fixed_template') {
        icon = '📌';
        title = `3·固定母版 [${state.fixedTemplateId || '未锁定'}]`;
      }
      modeIndicator.innerHTML = `<span class="mode-icon">${icon}</span><span class="mode-text">${title}</span>`;
    }
  }

  // 抽屉折叠展开
  function renderDrawerCollapseState() {
    const grid = document.getElementById('gptProductionMainGrid');
    const toggleBtn = document.getElementById('btnToggleProdDrawer');
    if (grid) {
      grid.classList.toggle('drawer-collapsed', state.drawerCollapsed);
    }
    if (toggleBtn) {
      const arrow = toggleBtn.querySelector('.drawer-arrow');
      if (arrow) arrow.textContent = state.drawerCollapsed ? '▶' : '◀';
      toggleBtn.title = state.drawerCollapsed ? '点击展开右侧制作抽屉' : '点击收起右侧制作抽屉';
    }
  }

  // 01 生产模式三卡片
  function renderModeCards() {
    const cards = document.querySelectorAll('#ptsModeCards .pts-mode-card');
    cards.forEach(card => {
      const cardMode = card.dataset.mode;
      card.classList.toggle('active', cardMode === state.mode);
    });
  }

  // 02 模式动态感知与联动面板
  function renderDynamicSection() {
    const p1 = document.getElementById('panelMode1Replica');
    const p2 = document.getElementById('panelMode2Random');
    const p3 = document.getElementById('panelMode3Fixed');

    if (state.mode === '1_replica_shuffle') {
      if (p1) p1.style.display = 'block';
      if (p2) p2.style.display = 'none';
      if (p3) p3.style.display = 'none';
      renderRawMaterialThumbs();
    } else if (state.mode === '2_random_template') {
      if (p1) p1.style.display = 'none';
      if (p2) p2.style.display = 'block';
      if (p3) p3.style.display = 'none';
      renderRandomPoolStatus();
    } else {
      if (p1) p1.style.display = 'none';
      if (p2) p2.style.display = 'none';
      if (p3) p3.style.display = 'block';
      renderFixedTemplateView();
    }
  }

  // 模式1：原素材缩略图网格
  function renderRawMaterialThumbs() {
    const grid = document.getElementById('rawMaterialThumbsGrid');
    const countTag = document.getElementById('rawMaterialCountTag');
    if (!grid) return;

    grid.replaceChildren();
    const imgs = state.material?.images || [];
    if (countTag) countTag.textContent = `${imgs.length} 张照片`;

    if (imgs.length === 0) {
      grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #64748b; font-size: 11px; padding: 16px;">当前素材包内暂无可用实拍图片</div>';
      return;
    }

    imgs.forEach(img => {
      const item = document.createElement('div');
      item.className = 'raw-thumb-item';
      item.title = `点击放大：${img.name}`;
      item.innerHTML = `<img src="${img.url}" alt="${img.name}" loading="lazy" />`;
      item.addEventListener('click', () => openLightbox(img.url));
      grid.appendChild(item);
    });
  }

  // 模式2：随机池状态
  function renderRandomPoolStatus() {
    const textEl = document.getElementById('randomPoolRecentText');
    if (textEl) {
      textEl.textContent = `全库 89 套母版轮巡已就绪 · 每套自动派选高分母版`;
    }
  }

  // 模式3：固定母版双图与模板列表
  function renderFixedTemplateView() {
    const nameEl = document.getElementById('fixedTemplateNameText');
    const imgP1 = document.getElementById('ptsPreviewImgP1');
    const imgP2 = document.getElementById('ptsPreviewImgP2');

    let currentTpl = state.templates.find(t => t.id === state.fixedTemplateId);
    if (!currentTpl && state.templates.length > 0) {
      currentTpl = state.templates[0];
      state.fixedTemplateId = currentTpl.id;
      state.fixedTemplateName = currentTpl.name;
      state.p1Url = currentTpl.p1Url;
      state.p2Url = currentTpl.p2Url;
    }

    if (nameEl) {
      nameEl.textContent = currentTpl ? `当前锁定：[${currentTpl.id}] ${currentTpl.name}` : '未锁定母版';
    }

    if (imgP1) {
      imgP1.src = (currentTpl && currentTpl.p1Url) || state.p1Url || '';
    }
    if (imgP2) {
      imgP2.src = (currentTpl && currentTpl.p2Url) || state.p2Url || '';
    }

    renderTemplateCardList();
  }

  // 渲染 89 套母版列表
  function renderTemplateCardList() {
    const listEl = document.getElementById('ptsTemplateList');
    if (!listEl) return;

    listEl.replaceChildren();

    const search = state.searchTerm.toLowerCase().trim();
    const cat = state.selectedCategory;

    const filtered = state.templates.filter(t => {
      if (cat !== 'all') {
        const tCat = t.category || '';
        if (cat === '精准流量·团建方案' && !tCat.includes('团建') && !tCat.includes('精准')) return false;
        if (cat === '泛流量·个人攻略' && !tCat.includes('攻略') && !tCat.includes('泛流')) return false;
        if (cat === '互动破冰·小游戏' && !tCat.includes('游戏')) return false;
      }
      if (search) {
        const idMatch = (t.id || '').toLowerCase().includes(search);
        const nameMatch = (t.name || '').toLowerCase().includes(search);
        if (!idMatch && !nameMatch) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      listEl.innerHTML = '<div style="text-align: center; color: #64748b; font-size: 11px; padding: 20px;">没有找到匹配的母版</div>';
      return;
    }

    filtered.forEach(tpl => {
      const item = document.createElement('div');
      item.className = 'pts-tpl-item';
      if (tpl.id === state.fixedTemplateId) {
        item.classList.add('active');
      }

      item.innerHTML = `
        <img class="pts-tpl-thumb" src="${tpl.p1Url}" alt="${tpl.id}" loading="lazy" />
        <div class="pts-tpl-info">
          <div class="pts-tpl-title" title="${tpl.name}">[${tpl.id}] ${tpl.name}</div>
          <div class="pts-tpl-meta">
            <span class="pts-tpl-id">${tpl.id}</span>
            <span>${tpl.category || '方案母版'}</span>
          </div>
        </div>
      `;

      item.addEventListener('click', async () => {
        state.fixedTemplateId = tpl.id;
        state.fixedTemplateName = tpl.name;
        state.p1Url = tpl.p1Url;
        state.p2Url = tpl.p2Url;

        // 重新渲染固定预览与高亮
        renderFixedTemplateView();

        // 立即向后端提交保存
        await apiFetch('/api/pipeline-mode-config', {
          method: 'POST',
          body: JSON.stringify({
            lineId: state.lineId,
            mode: '3_fixed_template',
            fixedTemplateId: tpl.id
          })
        });
        renderTopBar();
      });

      listEl.appendChild(item);
    });
  }

  // 03 素材区域
  function renderMaterialSection() {
    const nameEl = document.getElementById('ptsSelectedMaterialName');
    const pathEl = document.getElementById('ptsSelectedMaterialPath');
    const badgeEl = document.getElementById('ptsMaterialCountBadge');

    if (state.material) {
      if (nameEl) nameEl.textContent = state.material.name || '未选定素材';
      if (pathEl) {
        pathEl.textContent = state.material.path || '';
        pathEl.title = state.material.path || '';
      }
      if (badgeEl) badgeEl.textContent = `${state.material.count || 0} 张素材`;
    }
  }

  // 04 自动 / 手动控制与状态机
  function renderAutoManualControls() {
    const btnAuto = document.getElementById('btnSwitchAuto');
    const btnManual = document.getElementById('btnSwitchManual');
    const statusBadge = document.getElementById('ptsSendStatusBadge');
    const hintText = document.getElementById('ptsSendHintText');

    const isRunning = state.isAutoRunning && !state.isPaused;

    if (btnAuto) btnAuto.classList.toggle('active', isRunning);
    if (btnManual) btnManual.classList.toggle('active', !isRunning);

    if (statusBadge) {
      statusBadge.textContent = isRunning ? '● 自动流水线运转中' : '⏸ 手动暂停';
      statusBadge.style.color = isRunning ? '#34d399' : '#fbbf24';
      statusBadge.style.background = isRunning ? 'rgba(16, 185, 129, 0.18)' : 'rgba(245, 158, 11, 0.18)';
    }

    if (hintText) {
      hintText.textContent = isRunning
        ? '流水线源源不断自动跑；点击“手动干预”可直接在画面中操作'
        : '当前处于手动模式：已释放键盘鼠标，可直接在画面中点击/输入';
    }
  }

  // 3. 事件绑定
  function bindEvents() {
    // 抽屉折叠 / 展开
    const toggleBtn = document.getElementById('btnToggleProdDrawer');
    const closeBtn = document.getElementById('btnCloseProdDrawer');
    const handleToggleDrawer = () => {
      state.drawerCollapsed = !state.drawerCollapsed;
      try { localStorage.setItem('pts_prod_drawer_collapsed', String(state.drawerCollapsed)); } catch (_) {}
      renderDrawerCollapseState();
    };
    toggleBtn?.addEventListener('click', handleToggleDrawer);
    closeBtn?.addEventListener('click', handleToggleDrawer);

    // 三大核心生产模式卡片点击切换
    const modeCards = document.querySelectorAll('#ptsModeCards .pts-mode-card');
    modeCards.forEach(card => {
      card.addEventListener('click', async () => {
        const targetMode = card.dataset.mode;
        if (!targetMode || targetMode === state.mode) return;

        state.mode = targetMode;
        renderModeCards();
        renderDynamicSection();
        renderTopBar();

        // 提交后端持久化
        await apiFetch('/api/pipeline-mode-config', {
          method: 'POST',
          body: JSON.stringify({
            lineId: state.lineId,
            mode: state.mode,
            fixedTemplateId: state.fixedTemplateId
          })
        });

        // 联动旧兼容隐藏 input
        const legacySelect = document.getElementById('gptContentTemplateMode');
        if (legacySelect) {
          legacySelect.value = state.mode;
          legacySelect.dispatchEvent(new Event('change'));
        }
      });
    });

    // 自动持续生产 vs 手动干预二元开关
    const btnAuto = document.getElementById('btnSwitchAuto');
    const btnManual = document.getElementById('btnSwitchManual');

    btnAuto?.addEventListener('click', async () => {
      state.isAutoRunning = true;
      state.isPaused = false;
      renderAutoManualControls();
      await apiFetch('/api/pipeline/producer-control', {
        method: 'POST',
        body: JSON.stringify({ action: 'resume' })
      });
    });

    btnManual?.addEventListener('click', async () => {
      state.isPaused = true;
      renderAutoManualControls();
      await apiFetch('/api/pipeline/producer-control', {
        method: 'POST',
        body: JSON.stringify({ action: 'pause' })
      });
    });

    // 换一套素材
    const btnRandomMat = document.getElementById('btnSidebarRandomMaterial');
    btnRandomMat?.addEventListener('click', async () => {
      const res = await apiFetch('/api/materials/switch-random', { method: 'POST' });
      if (res && res.ok) {
        state.material = res;
        renderMaterialSection();
        if (state.mode === '1_replica_shuffle') {
          renderRawMaterialThumbs();
        }
      }
    });

    // 素材库挑选（调用本地资源管理器）
    const btnPickMat = document.getElementById('btnSidebarPickMaterial');
    btnPickMat?.addEventListener('click', async () => {
      const target = state.material?.path || 'D:\\AICode\\项目推进\\projects\\江湖有旅人\\主项目\\01-素材库';
      await apiFetch('/api/open', {
        method: 'POST',
        body: JSON.stringify({ path: target })
      });
    });

    // 辅助动作：重试与跳过
    const btnRetry = document.getElementById('btnSidebarRetryStep');
    btnRetry?.addEventListener('click', async () => {
      await apiFetch('/api/pipeline/producer-control', {
        method: 'POST',
        body: JSON.stringify({ action: 'retry' })
      });
    });

    const btnSkip = document.getElementById('btnSidebarSkipWork');
    btnSkip?.addEventListener('click', async () => {
      await apiFetch('/api/pipeline/producer-control', {
        method: 'POST',
        body: JSON.stringify({ action: 'skip' })
      });
    });

    // 模板搜索输入与分类选择
    const searchInput = document.getElementById('ptsTemplateSearchInput');
    searchInput?.addEventListener('input', (e) => {
      state.searchTerm = e.target.value;
      renderTemplateCardList();
    });

    const catSelect = document.getElementById('ptsTemplateCatSelect');
    catSelect?.addEventListener('change', (e) => {
      state.selectedCategory = e.target.value;
      renderTemplateCardList();
    });

    // P1 / P2 双图预览点击放大
    const p1Box = document.getElementById('ptsPreviewBoxP1');
    const p2Box = document.getElementById('ptsPreviewBoxP2');
    p1Box?.addEventListener('click', () => {
      const src = document.getElementById('ptsPreviewImgP1')?.src;
      if (src) openLightbox(src);
    });
    p2Box?.addEventListener('click', () => {
      const src = document.getElementById('ptsPreviewImgP2')?.src;
      if (src) openLightbox(src);
    });

    // Lightbox 关闭事件
    const lightboxModal = document.getElementById('ptsLightboxModal');
    const lightboxClose = document.getElementById('ptsLightboxCloseBtn');
    const lightboxBackdrop = document.getElementById('ptsLightboxBackdrop');
    const handleCloseLightbox = () => {
      if (lightboxModal) {
        lightboxModal.classList.remove('active');
        lightboxModal.style.display = 'none';
      }
    };
    lightboxClose?.addEventListener('click', handleCloseLightbox);
    lightboxBackdrop?.addEventListener('click', handleCloseLightbox);
  }

  function openLightbox(url) {
    const modal = document.getElementById('ptsLightboxModal');
    const img = document.getElementById('ptsLightboxImg');
    if (modal && img && url) {
      img.src = url;
      modal.classList.add('active');
      modal.style.display = 'flex';
    }
  }

  // 启动自初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
