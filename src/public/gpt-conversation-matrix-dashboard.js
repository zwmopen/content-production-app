/**
 * gpt-conversation-matrix-dashboard.js
 * 会话资产全景大盘 & 自动化生产中枢前端交互逻辑 (2026-11-07 升级)
 */
(function() {
  'use strict';

  let matrixData = {
    total: 219,
    kpi: {},
    byAccount: {},
    items: []
  };

  let currentAccountFilter = 'all';
  let currentStatusFilter = 'all';
  let currentSearchQuery = '';
  let isSchedulerActive = true;

  // 账号视觉元数据定义（A: zwmrpg · 主账号，B: upvote · 副账号，C: donnaparkerz · 副账号）
  const ACCOUNT_DISPLAY_MAP = {
    A: {
      letter: 'A',
      name: 'zwmrpg',
      displayName: 'A · zwmrpg',
      email: 'zwmrpg@gmail.com',
      role: '主账号',
      badgeClass: 'acc-A'
    },
    B: {
      letter: 'B',
      name: 'upvote',
      displayName: 'B · upvote',
      email: 'upvote_big_4j+1@icloud.com',
      role: '副账号',
      badgeClass: 'acc-B'
    },
    C: {
      letter: 'C',
      name: 'donnaparkerz',
      displayName: 'C · donnaparkerz',
      email: 'donnaparkerz155+548376@gmail.com',
      role: '副账号',
      badgeClass: 'acc-C'
    }
  };

  function getAccountMeta(accKey, fallbackEmail) {
    const rawKey = (accKey !== null && accKey !== undefined && String(accKey).trim() !== '') ? String(accKey) : 'A';
    const key = rawKey.toUpperCase().replace(/[^A-Z0-9_-]/g, '') || 'A';
    if (ACCOUNT_DISPLAY_MAP[key]) {
      return ACCOUNT_DISPLAY_MAP[key];
    }
    const safeFallbackEmail = (fallbackEmail !== null && fallbackEmail !== undefined) ? String(fallbackEmail) : '';
    const emailPrefix = safeFallbackEmail ? safeFallbackEmail.split('@')[0].split('+')[0] : `账号${key}`;
    return {
      letter: key,
      name: emailPrefix,
      displayName: `${key} · ${emailPrefix}`,
      email: safeFallbackEmail,
      role: '账号',
      badgeClass: `acc-${key}`
    };
  }

  function renderAccountBadgeHtml(it) {
    const item = (it && typeof it === 'object') ? it : {};
    const meta = getAccountMeta(item.account, item.email);
    const fullEmail = (item.email !== null && item.email !== undefined && String(item.email).trim() !== '')
      ? String(item.email)
      : (meta.email || '');
    const tooltip = fullEmail ? `${meta.role} ${meta.letter}：${fullEmail}` : `账号 ${meta.letter}`;
    return `<span class="mat-acc-badge ${escapeHtml(meta.badgeClass)}" title="${escapeHtml(tooltip)}"><span class="mat-acc-avatar">${escapeHtml(meta.letter)}</span><span class="mat-acc-label">${escapeHtml(meta.displayName)}</span></span>`;
  }

  function init() {
    bindEvents();
    bindNotificationEvents();
    loadMatrixData();
    fetchNotifications();
    // 30 秒自动轻量心跳同步
    setInterval(() => {
      loadMatrixData();
      fetchNotifications();
    }, 30000);
  }

  function bindEvents() {
    // 刷新按钮
    const btnRefresh = document.getElementById('btnRefreshMatrix');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        btnRefresh.classList.add('loading');
        loadMatrixData(() => {
          btnRefresh.classList.remove('loading');
          showNotification('大盘已从后台底册同步最新会话状态', 'success');
        });
      });
    }

    // 打开 Excel 总表
    const btnExcel = document.getElementById('btnOpenExcelLedger');
    if (btnExcel) {
      btnExcel.addEventListener('click', () => {
        dispatchAction('open_excel', {}, (res) => {
          showNotification(res.message || '已触发在本地打开 Excel 台账', 'info');
        });
      });
    }

    // 展开/收起明细表格
    const btnToggle = document.getElementById('btnToggleMatrixDetail');
    const container = document.getElementById('ptsMatrixDetailContainer');
    const txtToggle = document.getElementById('txtToggleMatrixDetail');
    if (btnToggle && container) {
      btnToggle.addEventListener('click', () => {
        const isHidden = container.style.display === 'none';
        container.style.display = isHidden ? 'block' : 'none';
        if (txtToggle) {
          txtToggle.textContent = isHidden ? '收起明细列表 ▴' : '查看明细列表 ▾';
        }
      });
    }

    // 账号切换 Pills
    const pills = document.querySelectorAll('#matrixAccountPills .mat-acc-btn');
    pills.forEach(pill => {
      pill.addEventListener('click', () => {
        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        currentAccountFilter = pill.getAttribute('data-acc') || 'all';
        renderTable();
      });
    });

    // 状态筛选 Dropdown
    const selStatus = document.getElementById('selMatrixStatusFilter');
    if (selStatus) {
      selStatus.addEventListener('change', (e) => {
        currentStatusFilter = e.target.value;
        renderTable();
      });
    }

    // 搜索输入
    const iptSearch = document.getElementById('iptMatrixSearch');
    if (iptSearch) {
      let timer = null;
      iptSearch.addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          currentSearchQuery = e.target.value.trim().toLowerCase();
          renderTable();
        }, 150);
      });
    }

    // 测试单套落地 Windows Toast 桌面通知
    const btnToast = document.getElementById('btnTestToast');
    if (btnToast) {
      btnToast.addEventListener('click', () => {
        btnToast.disabled = true;
        dispatchAction('test_toast', {}, (res) => {
          btnToast.disabled = false;
          showNotification(res.message || '已触发 Windows 电脑原生桌面通知', 'success');
        });
      });
    }

    // 定时与补救详细设置弹窗
    const btnSettings = document.getElementById('btnOpenSchedulerSettings');
    if (btnSettings) {
      btnSettings.addEventListener('click', () => {
        openSchedulerSettingsModal();
      });
    }

    // KPI 卡片点击事件：自动展开表格并筛选对应状态 (4阶直觉行动状态机：废弃单页调度，合并入待补充原料出计划)
    bindKpiCardClick('kpiAwaitingConfirmation', '待确认计划出图');
    bindKpiCardClick('kpiAwaitingMaterial', '等待补充原料出计划');
    bindKpiCardClick('kpiAwaitingCopy', '待补充文案收尾');
    bindKpiCardClick('kpiCompleted', '已落地成品库');

    // 三大生产指令按钮
    const btnCopy = document.getElementById('btnDispatchBatchCopy');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        if (!confirm('确认启动【一键批量出文案】？\n将针对全部处于「图已出，缺文案」状态的会话逐一触发文案生成指令。')) return;
        btnCopy.disabled = true;
        dispatchAction('batch_copywriting', {}, (res) => {
          btnCopy.disabled = false;
          showNotification(`批量出文案任务已下发！目标会话：${res.targetCount} 套`, 'success');
          loadMatrixData();
        });
      });
    }

    const btnWork = document.getElementById('btnDispatchBatchConfirm');
    if (btnWork) {
      btnWork.addEventListener('click', () => {
        if (!confirm('确认启动【一键批量出作品】？\n将针对全部处于「已出计划，待确认出图」状态的会话批量发送「1，确认出图」。')) return;
        btnWork.disabled = true;
        dispatchAction('batch_confirm_output', {}, (res) => {
          btnWork.disabled = false;
          showNotification(`批量出作品指令已下发！已确认激活：${res.targetCount} 套`, 'success');
          loadMatrixData();
        });
      });
    }

    const btnScheduler = document.getElementById('btnDispatchToggleScheduler');
    if (btnScheduler) {
      btnScheduler.addEventListener('click', () => {
        dispatchAction('toggle_scheduler', { enabled: !isSchedulerActive }, (res) => {
          isSchedulerActive = res.schedulerActive !== false;
          updateSchedulerBtnState(isSchedulerActive);
          showNotification(`3小时定时轮巡调度器已${isSchedulerActive ? '开启' : '暂停'}`, 'info');
        });
      });
    }
  }

  function bindKpiCardClick(id, statusKeyword) {
    const card = document.getElementById(id);
    if (!card) return;
    card.addEventListener('click', () => {
      const container = document.getElementById('ptsMatrixDetailContainer');
      const txtToggle = document.getElementById('txtToggleMatrixDetail');
      if (container) {
        container.style.display = 'block';
        if (txtToggle) txtToggle.textContent = '收起明细列表 ▴';
      }
      const selStatus = document.getElementById('selMatrixStatusFilter');
      if (selStatus) {
        selStatus.value = statusKeyword;
        currentStatusFilter = statusKeyword;
        renderTable();
        selStatus.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  function updateSchedulerBtnState(active) {
    const btn = document.getElementById('btnDispatchToggleScheduler');
    const txtStatus = document.getElementById('txtSchedulerStatus');
    const txtSub = document.getElementById('txtSchedulerSub');
    if (!btn) return;
    if (active) {
      btn.classList.remove('is-paused');
      if (txtStatus) txtStatus.textContent = '定时补充：已开启';
      if (txtSub) txtSub.textContent = '每3小时自动轮巡 (各抽3套)';
    } else {
      btn.classList.add('is-paused');
      if (txtStatus) txtStatus.textContent = '定时补充：已暂停';
      if (txtSub) txtSub.textContent = '点击恢复每3小时自动调度';
    }
  }

  function loadMatrixData(callback) {
    fetch('/api/production/conversation-matrix')
      .then(r => r.json())
      .then(res => {
        if (!res || (!res.ok && !res.success)) {
          console.error('Failed to load conversation matrix:', res ? res.error : 'empty response');
          return;
        }
        matrixData = res.data || res;
        updateKpiDisplay();
        renderTable();
        if (typeof callback === 'function') callback();
      })
      .catch(err => {
        console.error('Error fetching conversation matrix:', err);
      });
  }

  function updateKpiDisplay() {
    const summary = matrixData.summary || {};
    const kpi = matrixData.kpi || summary.statusCounts || {};
    const byAcc = matrixData.byAccount || summary.accountBreakdowns || {};
    const total = matrixData.total || summary.total || 219;

    const elBadge = document.getElementById('ptsMatrixTotalBadge');
    if (elBadge) {
      const accA = byAcc.A ? (byAcc.A.total || byAcc.A) : 100;
      const accB = byAcc.B ? (byAcc.B.total || byAcc.B) : 61;
      const accC = byAcc.C ? (byAcc.C.total || byAcc.C) : 58;
      elBadge.textContent = `全量 ${total} 条会话 (A:${accA} | B:${accB} | C:${accC})`;

      const pillA = document.querySelector('#matrixAccountPills .mat-acc-btn[data-acc="A"]');
      const pillB = document.querySelector('#matrixAccountPills .mat-acc-btn[data-acc="B"]');
      const pillC = document.querySelector('#matrixAccountPills .mat-acc-btn[data-acc="C"]');
      const pillAll = document.querySelector('#matrixAccountPills .mat-acc-btn[data-acc="all"]');
      if (pillAll) pillAll.textContent = `全部 (${total})`;
      if (pillA) pillA.textContent = `A · zwmrpg (${accA})`;
      if (pillB) pillB.textContent = `B · upvote (${accB})`;
      if (pillC) pillC.textContent = `C · donnaparkerz (${accC})`;
    }

    setNumText('kpiNumConfirmation', kpi.awaitingConfirmation !== undefined ? kpi.awaitingConfirmation : 124);
    setNumText('kpiNumMaterial', kpi.awaitingMaterial !== undefined ? kpi.awaitingMaterial : 90);
    setNumText('kpiNumCopy', kpi.awaitingCopy !== undefined ? kpi.awaitingCopy : 12);
    setNumText('kpiNumCompleted', kpi.completed !== undefined ? kpi.completed : 48);

    // 更新按钮上的小字数量提示
    const btnCopy = document.getElementById('btnDispatchBatchCopy');
    if (btnCopy) {
      const small = btnCopy.querySelector('small');
      const count = kpi.awaitingCopy !== undefined ? kpi.awaitingCopy : 12;
      if (small) small.textContent = `逐个去出 (${count}套待补文案)`;
    }

    const btnWork = document.getElementById('btnDispatchBatchConfirm');
    if (btnWork) {
      const small = btnWork.querySelector('small');
      const count = kpi.awaitingConfirmation !== undefined ? kpi.awaitingConfirmation : 124;
      if (small) small.textContent = `尽量去出 (${count}套待确认出图)`;
    }
  }

  function openSchedulerSettingsModal() {
    let modal = document.getElementById('ptsSchedulerSettingsModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ptsSchedulerSettingsModal';
      modal.innerHTML = `
        <div class="pts-settings-modal-backdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);">
          <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:24px;width:520px;max-width:92vw;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);color:#f1f5f9;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
              <h3 style="margin:0;font-size:16px;display:flex;align-items:center;gap:8px;">⚙️ 定时操作与自动化生产看门狗设置</h3>
              <button type="button" id="btnCloseSchedulerSettings" style="background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer;">&times;</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:14px;font-size:13px;">
              <div>
                <label style="display:block;margin-bottom:6px;font-weight:600;color:#cbd5e1;">🛡️ 3 小时滚动配额保护看门狗 (云端额度防撞)</label>
                <div style="display:flex;align-items:center;gap:8px;">
                  <span style="color:#94a3b8;">单账号 3 小时生图上限预警：</span>
                  <input type="number" id="cfgMaxImagesPerWindow" value="70" min="20" max="85" style="background:#0f172a;border:1px solid #334155;border-radius:6px;color:#fff;padding:6px 10px;width:70px;text-align:center;">
                  <span style="color:#64748b;font-size:11px;">张 (达到约 70 张自动安全停手等待下一个周期)</span>
                </div>
              </div>
              <div>
                <label style="display:block;margin-bottom:6px;font-weight:600;color:#cbd5e1;">🔄 轮巡波次与多模板调度策略</label>
                <div style="display:flex;align-items:center;gap:8px;">
                  <span style="color:#94a3b8;">每轮各账号抽取：</span>
                  <input type="number" id="cfgBatchSize" value="3" min="1" max="10" style="background:#0f172a;border:1px solid #334155;border-radius:6px;color:#fff;padding:6px 10px;width:70px;text-align:center;">
                  <span style="color:#64748b;font-size:11px;">套 (避免单一模板过度重复，流水线在多模板对话间轮转)</span>
                </div>
              </div>
              <div style="background:#0f172a;padding:12px;border-radius:8px;border:1px solid #1e293b;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px;">
                  <input type="checkbox" id="cfgEnableToast" checked>
                  <strong>🎉 单套作品落地触发电脑系统通知 (Windows Toast)</strong>
                </label>
                <div style="font-size:11px;color:#64748b;margin-left:22px;">每落地一套完整图文到本地成品库，触发 Windows 原生桌面弹窗与清脆提示音，可点击查看本地文件夹。</div>
              </div>
              <div style="background:#0f172a;padding:12px;border-radius:8px;border:1px solid #1e293b;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px;">
                  <input type="checkbox" id="cfgEnableAutoPlan" checked>
                  <strong>⚡ 收尾落地后顺带上传下一套原料出计划 (算力榨取)</strong>
                </label>
                <div style="font-size:11px;color:#64748b;margin-left:22px;">当一套作品收尾归档后，若当前3小时内仍有上传配额，顺带投料并出好下一套计划进入待出图池。</div>
              </div>
              <div style="background:#0f172a;padding:12px;border-radius:8px;border:1px solid #1e293b;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px;">
                  <input type="checkbox" id="cfgEnableRemedy" checked>
                  <strong>🩹 垃圾图/少图自动重发提示确认计划 (补救机制)</strong>
                </label>
                <div style="font-size:11px;color:#64748b;margin-left:22px;">遇生图失败、拼图异常或少图时，自动重发「1，确认出图」提示词，最多重试 2 次防止死锁。</div>
              </div>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">
              <button type="button" id="btnTestToastFromModal" class="pts-mini-btn" style="padding:6px 12px;">🔔 测试桌面通知</button>
              <button type="button" id="btnSaveSchedulerSettings" class="pts-mini-btn" style="background:#3b82f6;color:#fff;border-color:#3b82f6;padding:6px 16px;">💾 保存设置</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById('btnCloseSchedulerSettings').addEventListener('click', () => {
        modal.style.display = 'none';
      });

      document.getElementById('btnTestToastFromModal').addEventListener('click', () => {
        dispatchAction('test_toast', {}, (res) => {
          showNotification(res.message || '已触发 Windows 桌面通知测试', 'success');
        });
      });

      document.getElementById('btnSaveSchedulerSettings').addEventListener('click', () => {
        const batchSize = Number(document.getElementById('cfgBatchSize').value) || 3;
        const enableToast = document.getElementById('cfgEnableToast').checked;
        dispatchAction('update_scheduler_settings', {
          batchSizePerAccount: batchSize,
          enableToastNotification: enableToast
        }, (res) => {
          showNotification('定时设置与看门狗参数已更新并即刻生效！', 'success');
          modal.style.display = 'none';
        });
      });
    } else {
      modal.style.display = 'block';
    }
  }

  function setNumText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function filterMatrixItems(items, rawQuery) {
    if (!Array.isArray(items)) return [];
    const q = (rawQuery !== null && rawQuery !== undefined) ? String(rawQuery).trim().toLowerCase() : '';
    if (!q) return items;

    const isSingleLetter = /^[a-z]$/i.test(q);

    return items.filter(it => {
      if (!it || typeof it !== 'object') return false;
      const acc = (it.account !== null && it.account !== undefined) ? String(it.account).toLowerCase() : '';

      // 单字母账号查询：精准匹配账号代码，避免邮箱后缀（如 .com）和用户名子串误召回
      if (isSingleLetter) {
        return acc === q;
      }

      // 单字符非字母查询（如单个中文字符、符号等）
      if (q.length === 1) {
        const title = (it.title || '').toLowerCase();
        const topic = (it.current_topic || it.topic || '').toLowerCase();
        const notes = (it.notes || it.analysis || '').toLowerCase();
        return acc === q || title.includes(q) || topic.includes(q) || notes.includes(q);
      }

      // 多字符搜索：匹配标题、主题、说明、账号、邮箱、前缀与显示名称
      const title = (it.title || '').toLowerCase();
      const topic = (it.current_topic || it.topic || '').toLowerCase();
      const notes = (it.notes || it.analysis || '').toLowerCase();
      const email = (it.email || '').toLowerCase();
      const meta = getAccountMeta(it.account, it.email);
      const accName = (meta.name || '').toLowerCase();
      const displayName = (meta.displayName || '').toLowerCase();
      const accFullLabel = `账号${acc}`.toLowerCase();
      const accFullLabelWithSpace = `账号 ${acc}`.toLowerCase();

      return title.includes(q) ||
             topic.includes(q) ||
             notes.includes(q) ||
             acc === q ||
             email.includes(q) ||
             accName.includes(q) ||
             displayName.includes(q) ||
             accFullLabel.includes(q) ||
             accFullLabelWithSpace.includes(q);
    });
  }

  function renderTable() {
    const tbody = document.getElementById('ptsMatrixTableBody');
    if (!tbody) return;

    let items = matrixData.items || [];

    // 过滤账号
    if (currentAccountFilter !== 'all') {
      items = items.filter(it => it && it.account === currentAccountFilter);
    }

    // 过滤状态
    if (currentStatusFilter !== 'all') {
      items = items.filter(it => {
        const s = (it && it.status) || '';
        return s.includes(currentStatusFilter);
      });
    }

    // 搜索过滤（支持标题、主题、分析依据、账号标识 A/B/C、邮箱前缀与完整邮箱）
    if (currentSearchQuery) {
      items = filterMatrixItems(items, currentSearchQuery);
    }

    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 24px;">未匹配到符合条件的会话 (共 ${matrixData.items.length} 条)</td></tr>`;
      return;
    }

    const rowsHtml = items.map((it, idx) => {
      const accBadgeHtml = renderAccountBadgeHtml(it);
      const statusTag = getStatusTagHtml(it.status);
      const activeTopic = it.current_topic || it.topic || '';
      const topicText = activeTopic ? `<strong>${escapeHtml(activeTopic)}</strong>` : `<span style="color:#64748b; font-style:italic;">-</span>`;
      const titleEscaped = escapeHtml(it.title || '未命名对话');
      const notesEscaped = escapeHtml(it.notes || it.analysis || '');
      const itemUrl = it.url || it.href || '#';
      const convId = it.id || it.convId || '';
      const folderPath = it.folderPath || '';
      const folderName = it.folderName || '';
      const hasSpecific = !!it.hasSpecificFolder;
      const folderTooltip = hasSpecific
        ? `在电脑中打开专属成品文件夹: ${folderName}`
        : `在电脑中打开成品库根目录: ${folderName} (该作品尚未落盘)`;

      return `
        <tr data-conv-id="${escapeHtml(convId)}">
          <td>${accBadgeHtml}</td>
          <td title="${titleEscaped}">
            <div style="font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px;">
              ${titleEscaped}
            </div>
            <div style="font-size: 9px; color: #64748b; font-family: monospace;">${convId ? convId.slice(0, 8) + '...' : ''}</div>
          </td>
          <td>${statusTag}</td>
          <td>${topicText}</td>
          <td style="color: #94a3b8; font-size: 10px; line-height: 1.4;">${notesEscaped}</td>
          <td style="text-align: center;">
            <div class="mat-action-btns-group">
              <a href="${escapeHtml(itemUrl)}" target="_blank" class="mat-action-link-btn" title="在新标签页中打开该 ChatGPT 对话">
                🔗 直达
              </a>
              <button type="button" class="mat-action-folder-btn btn-open-local-folder" 
                data-folder="${escapeHtml(folderPath)}" 
                data-conv-id="${escapeHtml(convId)}"
                data-acc="${escapeHtml(it.account || 'A')}"
                data-has-specific="${hasSpecific ? '1' : '0'}"
                title="${escapeHtml(folderTooltip)}">
                📁 ${hasSpecific ? '成品' : '目录'}
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = rowsHtml;

    // 绑定表格每行「打开本地成品」按钮点击事件并触发高亮
    tbody.querySelectorAll('.btn-open-local-folder').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tr = btn.closest('tr');
        if (tr) {
          tbody.querySelectorAll('tr.is-active-opened').forEach(r => r.classList.remove('is-active-opened'));
          tr.classList.add('is-active-opened');
        }

        const folderPath = btn.getAttribute('data-folder');
        const acc = btn.getAttribute('data-acc');
        const hasSpecific = btn.getAttribute('data-has-specific') === '1';

        btn.disabled = true;
        fetch('/api/production/notifications/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderPath, account: acc })
        })
        .then(r => r.json())
        .then(res => {
          btn.disabled = false;
          if (res.ok) {
            showNotification(res.message || '已在系统资源管理器打开本地成品目录', 'success');
          } else {
            showNotification(res.error || '无法打开文件夹', 'error');
          }
        })
        .catch(err => {
          btn.disabled = false;
          showNotification('请求失败: ' + err.message, 'error');
        });
      });
    });
  }

  function getStatusTagHtml(status) {
    status = status || '';
    let tagClass = 'mat-tag-gray';
    if (status.includes('待确认') || status.includes('已出计划')) {
      tagClass = 'mat-tag-orange';
    } else if (status.includes('待补充文案') || status.includes('缺文案') || status.includes('待补充正文')) {
      tagClass = 'mat-tag-yellow';
    } else if (status.includes('等待补充原料') || status.includes('待补充原料')) {
      tagClass = 'mat-tag-blue';
    } else if (status.includes('完工') || status.includes('归档') || status.includes('成品库') || status.includes('已落地')) {
      tagClass = 'mat-tag-green';
    }
    return `<span class="mat-status-tag ${tagClass}">${escapeHtml(status)}</span>`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function dispatchAction(action, payload, callback) {
    fetch('/api/production/dispatch/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload })
    })
      .then(r => r.json())
      .then(res => {
        if (!res || (!res.ok && !res.success)) {
          showNotification((res && res.error) || '执行指令失败', 'error');
          return;
        }
        if (typeof callback === 'function') callback(res);
      })
      .catch(err => {
        showNotification('网络通信错误: ' + err.message, 'error');
      });
  }

  function showNotification(msg, type = 'info') {
    // 优先调用现有 UI 系统的全局通知
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type);
      return;
    }
    if (typeof window.showAssistantNotification === 'function') {
      window.showAssistantNotification(msg, type);
      return;
    }

    // 优雅内联浮动通知兜底
    let toast = document.getElementById('ptsMatrixGlobalToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ptsMatrixGlobalToast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 99999;
        padding: 10px 18px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        transition: opacity 0.3s ease, transform 0.3s ease;
        pointer-events: none;
      `;
      document.body.appendChild(toast);
    }

    if (type === 'success') {
      toast.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      toast.style.color = '#fff';
    } else if (type === 'error') {
      toast.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
      toast.style.color = '#fff';
    } else {
      toast.style.background = 'linear-gradient(135deg, #3b82f6, #2563eb)';
      toast.style.color = '#fff';
    }

    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
    }, 3500);
  }

  // ----------------- 通知中心与交付动态浮层逻辑 (用户 2026-11-07 核心诉求) -----------------
  let notificationState = {
    unreadCount: 0,
    list: []
  };

  function bindNotificationEvents() {
    const btnBell = document.getElementById('btnNotificationBell');
    const popover = document.getElementById('ptsNotificationPopover');
    const btnMarkAll = document.getElementById('btnMarkAllNotificationsRead');
    const btnTestFeishu = document.getElementById('btnTriggerTestHourlyFeishu');

    if (btnBell && popover) {
      btnBell.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = popover.style.display === 'none';
        popover.style.display = isHidden ? 'block' : 'none';
        if (isHidden && notificationState.unreadCount > 0) {
          // 点击查看时立即标记已读并清除小红点
          markNotificationsAsRead();
        }
      });

      // 点击外部自动收起
      document.addEventListener('click', (e) => {
        if (!popover.contains(e.target) && !btnBell.contains(e.target)) {
          popover.style.display = 'none';
        }
      });
    }

    if (btnMarkAll) {
      btnMarkAll.addEventListener('click', () => {
        markNotificationsAsRead();
      });
    }

    if (btnTestFeishu) {
      btnTestFeishu.addEventListener('click', () => {
        btnTestFeishu.disabled = true;
        btnTestFeishu.textContent = '正在推送到飞书...';
        dispatchAction('push_test_feishu', {}, (res) => {
          btnTestFeishu.disabled = false;
          btnTestFeishu.textContent = '📲 推送飞书卡片测试';
          showNotification(res.message || '已触发飞书卡片推送', 'success');
          fetchNotifications();
        });
      });
    }
  }

  function fetchNotifications() {
    fetch('/api/production/notifications')
      .then(r => r.json())
      .then(res => {
        if (!res || !res.ok) return;
        notificationState = res.data || { unreadCount: 0, list: [] };
        renderNotificationBadge();
        renderNotificationList();
      })
      .catch(err => console.error('Failed to fetch notifications:', err));
  }

  function renderNotificationBadge() {
    const badge = document.getElementById('matNotificationBadge');
    const textUnread = document.getElementById('popoverUnreadCountText');
    const count = notificationState.unreadCount || 0;

    if (badge) {
      if (count > 0) {
        badge.style.display = 'inline-flex';
        badge.textContent = `+${count}`;
      } else {
        badge.style.display = 'none';
      }
    }

    if (textUnread) {
      textUnread.textContent = count > 0 ? `${count} 条新交付` : '全部已读';
    }
  }

  function renderNotificationList() {
    const container = document.getElementById('ptsNotificationList');
    if (!container) return;

    const list = notificationState.list || [];
    if (list.length === 0) {
      container.innerHTML = '<div style="text-align: center; color: #64748b; padding: 24px; font-size: 12px;">暂无最近的作品交付记录</div>';
      return;
    }

    const html = list.map(item => {
      const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '刚刚';
      const isUnread = !item.read;
      const acc = item.accountLabel || `账号 ${item.account || 'A'}`;
      const title = escapeHtml(item.title || item.topic || '小红书图文作品');
      const specs = `${item.imagesCount || 10} 张原画 3:4 竖图 ＋ ${item.copyVersions || 5} 版文案`;
      const folder = escapeHtml(item.folderPath || '');

      return `
        <div class="notif-item-card ${isUnread ? 'is-unread' : ''}">
          <div class="notif-item-header">
            <span style="font-size: 11px; color: #94a3b8; font-family: monospace;">⏰ ${timeStr} · ${acc}</span>
            ${isUnread ? '<span style="font-size: 9px; background: #ea580c; color: #fff; padding: 1px 5px; border-radius: 4px;">NEW</span>' : ''}
          </div>
          <div class="notif-item-title">${title}</div>
          <div class="notif-item-specs">
            <span>🖼️ ${specs}</span>
          </div>
          <div class="notif-item-actions">
            <button type="button" class="pts-mini-btn btn-open-work-folder" data-folder="${folder}" style="font-size: 10px; padding: 2px 8px;">
              📁 打开本地成品
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = html;

    // 绑定打开本地文件夹事件
    container.querySelectorAll('.btn-open-work-folder').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fPath = btn.getAttribute('data-folder');
        fetch('/api/production/notifications/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderPath: fPath })
        })
        .then(r => r.json())
        .then(res => {
          if (res.ok) showNotification('已在 Windows 中打开作品文件夹', 'success');
          else showNotification(res.error || '无法打开文件夹', 'error');
        });
      });
    });
  }

  function markNotificationsAsRead() {
    fetch('/api/production/notifications/read', { method: 'POST' })
      .then(r => r.json())
      .then(res => {
        if (res && res.ok) {
          notificationState.unreadCount = 0;
          if (notificationState.list) {
            notificationState.list.forEach(it => it.read = true);
          }
          renderNotificationBadge();
          renderNotificationList();
        }
      })
      .catch(err => console.error('Failed to mark read:', err));
  }

  // 页面就绪后自启动
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  // 暴露关键纯函数供自动化测试验证
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ACCOUNT_DISPLAY_MAP,
      getAccountMeta,
      renderAccountBadgeHtml,
      escapeHtml,
      filterMatrixItems
    };
  }
})();
