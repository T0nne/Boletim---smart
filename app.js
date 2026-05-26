/**
 * APP.JS — Meu Boletim
 * Versão completa: multi-provider IA, modais, conquistas, streak, gráficos
 */

import { appState } from './state.js';
import { loadAll, autoSaveMiddleware, getApiKey, setApiKey as storageSaveApiKey, removeApiKey, exportData as storageExport, importData as storageImport, clearAll as storageClearAll } from './storage.js';
import { NAV_TABS, PAGES, ACHIEVEMENTS, APP_CONFIG } from './constants.js';

// ═══════════════════════════════════
// PROVIDERS DE IA
// ═══════════════════════════════════

const AI_PROVIDERS = {
  claude: {
    name: 'Claude (Anthropic)',
    placeholder: 'sk-ant-...',
    detect: (k) => k.startsWith('sk-ant-'),
    call: async (apiKey, systemPrompt, messages) => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 600,
          system: systemPrompt,
          messages,
        }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error.message);
      return d.content?.[0]?.text || '';
    },
  },
  gemini: {
    name: 'Gemini (Google)',
    placeholder: 'AIza...',
    detect: (k) => k.startsWith('AIza'),
    call: async (apiKey, systemPrompt, messages) => {
      const contents = messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents,
          }),
        }
      );
      const d = await res.json();
      if (d.error) throw new Error(d.error.message);
      return d.candidates?.[0]?.content?.parts?.[0]?.text || '';
    },
  },
  openai: {
    name: 'GPT (OpenAI)',
    placeholder: 'sk-...',
    detect: (k) => k.startsWith('sk-') && !k.startsWith('sk-ant-'),
    call: async (apiKey, systemPrompt, messages) => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 600,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
        }),
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error.message);
      return d.choices?.[0]?.message?.content || '';
    },
  },
};

function detectProvider(key) {
  for (const [id, p] of Object.entries(AI_PROVIDERS)) {
    if (p.detect(key)) return id;
  }
  return 'custom';
}

async function callAI(userMessage) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Sem chave de API configurada.');

  const providerId = detectProvider(apiKey);
  const provider = AI_PROVIDERS[providerId];

  const s = appState.getState();
  const systemPrompt = buildSystemPrompt(s);

  // Monta histórico (últimas 10 mensagens)
  const history = s.chatHistory
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content }));

  const messages = [...history, { role: 'user', content: userMessage }];

  if (!provider) {
    // Fallback genérico: tenta OpenAI-compat
    return callOpenAICompat(apiKey, systemPrompt, messages);
  }

  return provider.call(apiKey, systemPrompt, messages);
}

async function callOpenAICompat(apiKey, systemPrompt, messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 600,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
    }),
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return d.choices?.[0]?.message?.content || '';
}

function buildSystemPrompt(s) {
  const subjectsInfo = s.subjects.map((sub) => {
    const valid = sub.grades?.filter((g) => g !== null && g !== undefined) || [];
    const avg = valid.length ? (valid.reduce((a, b) => a + parseFloat(b), 0) / valid.length).toFixed(1) : 'sem notas';
    const status = valid.length && parseFloat(avg) >= s.profile.minGrade ? 'aprovado' : (valid.length ? 'em risco' : 'sem dados');
    return `${sub.name} (média: ${avg}, status: ${status})`;
  }).join('; ');

  const provasProximas = s.provas
    .filter((p) => p.date >= new Date().toISOString().split('T')[0])
    .map((p) => `${p.subject} - ${p.name} em ${p.date}`)
    .join('; ') || 'nenhuma';

  return `Você é o assistente de estudos do app "Meu Boletim". Seja direto, motivador e use linguagem jovem.
Aluno: ${s.profile.name}${s.profile.school ? ` | Escola: ${s.profile.school}` : ''}.
Nota mínima para aprovação: ${s.profile.minGrade}.
Matérias: ${subjectsInfo || 'nenhuma cadastrada'}.
Provas próximas: ${provasProximas}.
Responda sempre em português. Seja conciso (máx 3 parágrafos). Use emojis com moderação.`;
}

// ═══════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════

async function init() {
  try {
    appState.use(autoSaveMiddleware);
    loadAll();
    updateStreak();
    renderNav();
    renderPages();
    navigateTo(PAGES.DASHBOARD);

    appState.subscribe((state, action) => {
      if (action.type === 'SET_PAGE') showPage(state.currentPage);
      if (action.type === 'SET_THEME') applyThemeAttr(state.theme);
      renderHeader(state);
    });

    hideLoadingScreen();
  } catch (err) {
    console.error('[App]', err);
    showFatalError(err);
  }
}

function applyThemeAttr(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
}

// ═══════════════════════════════════
// STREAK
// ═══════════════════════════════════

function updateStreak() {
  const s = appState.getState();
  const today = new Date().toISOString().split('T')[0];
  const last = s.streak?.lastUpdate;

  if (last === today) return; // já atualizou hoje

  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const days = last === yesterday ? (s.streak.days || 0) + 1 : 1;

  appState.dispatch({ type: 'SET_STREAK', payload: { days, lastUpdate: today } });

  if (days >= 7) checkAchievement('STREAK_7');
}

// ═══════════════════════════════════
// CONQUISTAS
// ═══════════════════════════════════

function checkAchievement(id) {
  const s = appState.getState();
  if (s.achievements[id]) return;
  appState.dispatch({ type: 'UNLOCK_ACHIEVEMENT', payload: id });
  const ach = ACHIEVEMENTS[id];
  if (ach) showToast(`🏆 Conquista: ${ach.label}!`, 'success');
}

function checkAllAchievements() {
  const s = appState.getState();
  if (s.subjects.length > 0) checkAchievement('FIRST_SUBJECT');
  const hasGrade = s.subjects.some((sub) => sub.grades?.some((g) => g !== null));
  if (hasGrade) checkAchievement('FIRST_GRADE');
  if (s.subjects.length > 0 && appState.getAtRiskSubjectsCount() === 0 && appState.getApprovedSubjectsCount() === s.subjects.length) {
    checkAchievement('ALL_APPROVED');
  }
}

// ═══════════════════════════════════
// TOAST
// ═══════════════════════════════════

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast toast-${type} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ═══════════════════════════════════
// NAVEGAÇÃO
// ═══════════════════════════════════

function navigateTo(page) {
  appState.dispatch({ type: 'SET_PAGE', payload: page });
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    const active = btn.dataset.page === page;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active);
  });
  refreshPage(page);
}

function showPage(pageId) {
  document.querySelectorAll('.page').forEach((el) => {
    el.classList.toggle('active', el.id === `page-${pageId}`);
  });
}

// ═══════════════════════════════════
// HEADER
// ═══════════════════════════════════

function renderHeader(state) {
  const header = document.getElementById('header');
  if (!header) return;
  const name = state.profile?.nick || state.profile?.name || 'Aluno(a)';
  const avg = appState.getGeneralAverage();
  const avgText = avg !== null ? avg.toFixed(1) : '—';
  const streak = state.streak?.days || 0;

  header.innerHTML = `
    <div class="header-inner">
      <div class="header-brand">
        <span class="header-logo">📊</span>
        <span class="header-title">Meu Boletim</span>
      </div>
      <div class="header-info">
        ${streak > 1 ? `<span class="header-streak" title="${streak} dias seguidos">🔥 ${streak}</span>` : ''}
        <span class="header-avg" title="Média geral">⭐ ${avgText}</span>
        <span class="header-name">${escHtml(name)}</span>
      </div>
    </div>`;
}

// ═══════════════════════════════════
// MODAL ENGINE
// ═══════════════════════════════════

function openModal(html, onSubmit) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.id = 'modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <button class="modal-close" onclick="window.__app.closeModal()" aria-label="Fechar">✕</button>
      ${html}
    </div>`;

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.getElementById('modals').appendChild(overlay);

  // Store submit handler
  overlay._onSubmit = onSubmit;

  // Focus first input
  requestAnimationFrame(() => {
    overlay.querySelector('input, select, textarea')?.focus();
  });
}

function closeModal() {
  document.getElementById('modal-overlay')?.remove();
}

function submitModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay?._onSubmit?.();
}

// ═══════════════════════════════════
// NAV
// ═══════════════════════════════════

function renderNav() {
  const nav = document.getElementById('tabs');
  if (!nav) return;
  nav.innerHTML = NAV_TABS.map((tab) => `
    <button class="tab-btn" data-page="${tab.id}" role="tab" aria-selected="false"
      onclick="window.__app.navigateTo('${tab.id}')">
      <span class="tab-icon">${tab.icon}</span>
      <span class="tab-label">${tab.label}</span>
    </button>`).join('');
}

// ═══════════════════════════════════
// PAGES SHELL
// ═══════════════════════════════════

function renderPages() {
  const container = document.getElementById('pages');
  if (!container) return;
  container.innerHTML = Object.values(PAGES).map((id) => `
    <section class="page" id="page-${id}" role="tabpanel"></section>`).join('');
}

function refreshPage(pageId) {
  const el = document.getElementById(`page-${pageId}`);
  if (!el) return;
  const map = {
    [PAGES.DASHBOARD]: renderDashboardPage,
    [PAGES.SUBJECTS]:  renderSubjectsPage,
    [PAGES.AGENDA]:    renderAgendaPage,
    [PAGES.CHAT]:      renderChatPage,
    [PAGES.CONFIG]:    renderConfigPage,
  };
  if (map[pageId]) el.innerHTML = map[pageId]();
  if (pageId === PAGES.DASHBOARD) renderChart();
}

// ═══════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════

function renderDashboardPage() {
  const s = appState.getState();
  const avg = appState.getGeneralAverage();
  const approved = appState.getApprovedSubjectsCount();
  const atRisk = appState.getAtRiskSubjectsCount();
  const pending = s.tarefas.filter((t) => !t.done).length;

  const provasHoje = s.provas.filter((p) => {
    const diff = Math.ceil((new Date(p.date + 'T12:00') - new Date()) / 86400000);
    return diff >= 0 && diff <= 3;
  });

  return `
    <div class="page-content">
      <h2 class="page-title">Olá, ${escHtml(s.profile.nick || s.profile.name)} 👋</h2>
      <p class="page-subtitle">Aqui está o seu resumo de hoje.</p>

      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-icon">⭐</span>
          <span class="stat-value ${avg !== null ? (avg >= s.profile.minGrade ? 'val-ok' : 'val-risk') : ''}">${avg !== null ? avg.toFixed(1) : '—'}</span>
          <span class="stat-label">Média Geral</span>
        </div>
        <div class="stat-card">
          <span class="stat-icon">✅</span>
          <span class="stat-value val-ok">${approved}</span>
          <span class="stat-label">Aprovado</span>
        </div>
        <div class="stat-card">
          <span class="stat-icon">⚠️</span>
          <span class="stat-value ${atRisk > 0 ? 'val-risk' : ''}">${atRisk}</span>
          <span class="stat-label">Em Risco</span>
        </div>
        <div class="stat-card">
          <span class="stat-icon">📋</span>
          <span class="stat-value ${pending > 0 ? 'val-warn' : ''}">${pending}</span>
          <span class="stat-label">Tarefas</span>
        </div>
      </div>

      ${provasHoje.length > 0 ? `
        <div class="alert alert-warning">
          <span>📝</span>
          <div>
            <strong>Atenção!</strong> ${provasHoje.length} prova(s) nos próximos 3 dias:
            ${provasHoje.map((p) => `<br>• ${escHtml(p.subject)} — ${formatDateBR(p.date)}`).join('')}
          </div>
        </div>` : ''}

      ${s.subjects.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">📚</div>
          <div class="empty-state-title">Nenhuma matéria cadastrada</div>
          <div class="empty-state-desc">Comece adicionando suas matérias!</div>
          <button class="btn btn-primary" onclick="window.__app.navigateTo('subjects')">Adicionar Matéria</button>
        </div>` : `
        <div class="section-header-row">
          <h3 class="section-title">Desempenho por Matéria</h3>
        </div>
        <canvas id="chart-perf" height="200" style="margin-bottom:var(--space-20)"></canvas>
        ${renderSubjectsList(s)}`}

      ${renderAchievementsBadges(s)}
    </div>`;
}

function renderSubjectsList(s) {
  return `
    <div class="subjects-list" style="margin-top:var(--space-16)">
      <h3 class="section-title">Suas Matérias</h3>
      ${s.subjects.map((sub) => {
        const valid = sub.grades?.filter((g) => g !== null && g !== undefined) || [];
        const avg = valid.length ? (valid.reduce((a, b) => a + parseFloat(b), 0) / valid.length) : null;
        const passed = avg !== null && avg >= s.profile.minGrade;
        return `
          <div class="subject-row" onclick="window.__app.navigateTo('subjects')" style="cursor:pointer">
            <span class="subject-icon">${sub.icon || '📚'}</span>
            <span class="subject-name">${escHtml(sub.name)}</span>
            <span class="subject-avg ${avg !== null ? (passed ? 'avg-ok' : 'avg-risk') : ''}">${avg !== null ? avg.toFixed(1) : '—'}</span>
            <span class="badge ${passed ? 'badge-success' : (avg === null ? 'badge-primary' : 'badge-danger')}">
              ${avg === null ? 'sem notas' : (passed ? 'aprovado' : 'em risco')}
            </span>
          </div>`;
      }).join('')}
    </div>`;
}

function renderAchievementsBadges(s) {
  const unlocked = Object.keys(s.achievements).filter((k) => s.achievements[k]);
  if (unlocked.length === 0) return '';
  return `
    <div style="margin-top:var(--space-24)">
      <h3 class="section-title">🏆 Conquistas</h3>
      <div style="display:flex;flex-wrap:wrap;gap:var(--space-8);margin-top:var(--space-8)">
        ${unlocked.map((id) => {
          const a = ACHIEVEMENTS[id];
          return a ? `<span class="badge badge-warning" title="${a.desc}">${a.icon} ${a.label}</span>` : '';
        }).join('')}
      </div>
    </div>`;
}

function renderChart() {
  const canvas = document.getElementById('chart-perf');
  if (!canvas || typeof Chart === 'undefined') return;

  const s = appState.getState();
  if (s.subjects.length === 0) return;

  const labels = s.subjects.map((sub) => sub.name.length > 10 ? sub.name.slice(0, 10) + '…' : sub.name);
  const data = s.subjects.map((sub) => {
    const valid = sub.grades?.filter((g) => g !== null && g !== undefined) || [];
    return valid.length ? +(valid.reduce((a, b) => a + parseFloat(b), 0) / valid.length).toFixed(1) : 0;
  });
  const colors = data.map((v) => v >= s.profile.minGrade ? 'rgba(74,222,128,0.7)' : 'rgba(248,113,113,0.7)');

  if (canvas._chart) canvas._chart.destroy();

  canvas._chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Média',
        data,
        backgroundColor: colors,
        borderColor: colors.map((c) => c.replace('0.7', '1')),
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` Média: ${ctx.raw}` } },
      },
      scales: {
        y: {
          min: 0, max: 10,
          ticks: { color: '#999', stepSize: 2 },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        x: {
          ticks: { color: '#999', font: { size: 11 } },
          grid: { display: false },
        },
      },
    },
  });
}

// ═══════════════════════════════════
// MATÉRIAS
// ═══════════════════════════════════

function renderSubjectsPage() {
  const s = appState.getState();
  return `
    <div class="page-content">
      <div class="page-header-row">
        <h2 class="page-title">Matérias</h2>
        <button class="btn btn-primary btn-sm" onclick="window.__app.openAddSubjectModal()">+ Adicionar</button>
      </div>
      <div id="subjects-container">
        ${s.subjects.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">📚</div>
            <div class="empty-state-title">Nenhuma matéria ainda</div>
            <div class="empty-state-desc">Toque em Adicionar para começar.</div>
          </div>` :
          s.subjects.map((sub) => renderSubjectCard(sub, s.profile.minGrade, s.bimestres)).join('')}
      </div>
    </div>`;
}

function renderSubjectCard(sub, minGrade, bimestres) {
  const valid = sub.grades?.filter((g) => g !== null && g !== undefined) || [];
  const avg = valid.length ? (valid.reduce((a, b) => a + parseFloat(b), 0) / valid.length) : null;
  const passed = avg !== null && avg >= minGrade;

  const gradesHtml = Array.from({ length: bimestres }, (_, i) => `
    <div class="grade-slot">
      <label class="grade-label">B${i + 1}</label>
      <input type="number" min="0" max="10" step="0.1"
        class="grade-input" value="${sub.grades?.[i] ?? ''}" placeholder="—"
        onchange="window.__app.updateGrade(${sub.id}, ${i}, this.value)"
        oninput="this.style.borderColor = this.value !== '' ? (parseFloat(this.value) >= ${minGrade} ? 'var(--success)' : 'var(--danger)') : ''" />
    </div>`).join('');

  const faltasHtml = `
    <div class="grade-slot">
      <label class="grade-label">Faltas</label>
      <input type="number" min="0" step="1"
        class="grade-input" style="border-color:${sub.faltas > 0 ? 'var(--warning)' : ''}"
        value="${sub.faltas || 0}"
        onchange="window.__app.updateFaltas(${sub.id}, this.value)" />
    </div>`;

  return `
    <div class="subject-card ${avg !== null ? (passed ? 'card-ok' : 'card-risk') : ''}">
      <div class="subject-card-header">
        <span class="subject-icon-lg">${sub.icon || '📚'}</span>
        <div class="subject-card-info">
          <span class="subject-card-name">${escHtml(sub.name)}</span>
          <span class="subject-card-avg ${avg !== null ? (passed ? 'avg-ok' : 'avg-risk') : ''}">
            ${avg !== null ? `Média: ${avg.toFixed(1)} — ${passed ? '✅ Aprovado' : '⚠️ Em risco'}` : 'Sem notas ainda'}
          </span>
        </div>
        <button class="btn btn-danger btn-sm" onclick="window.__app.deleteSubject(${sub.id})" title="Remover matéria">🗑</button>
      </div>
      <div class="grades-row">${gradesHtml}${faltasHtml}</div>
    </div>`;
}

// ═══════════════════════════════════
// AGENDA
// ═══════════════════════════════════

function renderAgendaPage() {
  const s = appState.getState();
  const hoje = new Date().toISOString().split('T')[0];

  const todasProvas = s.provas.sort((a, b) => a.date.localeCompare(b.date));
  const passadas = todasProvas.filter((p) => p.date < hoje);
  const futuras = todasProvas.filter((p) => p.date >= hoje);

  const pendentes = s.tarefas.filter((t) => !t.done).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const feitas = s.tarefas.filter((t) => t.done);

  return `
    <div class="page-content">
      <h2 class="page-title">Agenda</h2>

      <section class="agenda-section">
        <div class="section-header-row">
          <h3 class="section-title">📝 Provas & Avaliações</h3>
          <button class="btn btn-outline btn-sm" onclick="window.__app.openAddProvaModal()">+ Prova</button>
        </div>
        ${futuras.length === 0 && passadas.length === 0 ? `<p class="text-muted">Nenhuma prova registrada.</p>` : ''}
        ${futuras.map((p) => renderAgendaProva(p, false)).join('')}
        ${passadas.length > 0 ? `
          <details style="margin-top:var(--space-8)">
            <summary class="text-muted" style="cursor:pointer;font-size:var(--text-xs);letter-spacing:var(--ls-wide);text-transform:uppercase">
              ${passadas.length} prova(s) passada(s)
            </summary>
            <div style="margin-top:var(--space-8);opacity:0.6">
              ${passadas.map((p) => renderAgendaProva(p, true)).join('')}
            </div>
          </details>` : ''}
      </section>

      <section class="agenda-section">
        <div class="section-header-row">
          <h3 class="section-title">✅ Tarefas</h3>
          <button class="btn btn-outline btn-sm" onclick="window.__app.openAddTarefaModal()">+ Tarefa</button>
        </div>
        ${pendentes.length === 0 && feitas.length === 0 ? `<p class="text-muted">Nenhuma tarefa registrada.</p>` : ''}
        ${pendentes.map(renderAgendaTarefa).join('')}
        ${feitas.length > 0 ? `
          <details style="margin-top:var(--space-8)">
            <summary class="text-muted" style="cursor:pointer;font-size:var(--text-xs);letter-spacing:var(--ls-wide);text-transform:uppercase">
              ${feitas.length} concluída(s)
            </summary>
            <div style="margin-top:var(--space-8);opacity:0.5">
              ${feitas.map(renderAgendaTarefa).join('')}
            </div>
          </details>` : ''}
      </section>
    </div>`;
}

function renderAgendaProva(p, past) {
  const diff = Math.ceil((new Date(p.date + 'T12:00') - new Date()) / 86400000);
  const urgency = !past && diff <= 1 ? 'border-color:var(--danger)' : diff <= 3 ? 'border-color:var(--warning)' : '';
  const diffText = past ? `há ${Math.abs(diff)} dia(s)` : diff === 0 ? '🚨 HOJE!' : diff === 1 ? '⚠️ Amanhã' : `em ${diff} dias`;

  return `
    <div class="agenda-item" style="${urgency}">
      <span class="agenda-icon">📝</span>
      <div class="agenda-info">
        <span class="agenda-name">${escHtml(p.subject)} — ${escHtml(p.name || 'Prova')}</span>
        <span class="agenda-date">${formatDateBR(p.date)} <em>(${diffText})</em></span>
      </div>
      <button class="btn btn-danger btn-sm" onclick="window.__app.deleteProva('${p.id}')">✕</button>
    </div>`;
}

function renderAgendaTarefa(t) {
  const diff = t.date ? Math.ceil((new Date(t.date + 'T12:00') - new Date()) / 86400000) : null;
  const overdue = diff !== null && diff < 0 && !t.done;

  return `
    <div class="agenda-item ${overdue ? 'agenda-overdue' : ''}">
      <input type="checkbox" ${t.done ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;flex-shrink:0"
        onchange="window.__app.toggleTarefa('${t.id}')">
      <div class="agenda-info" style="flex:1">
        <span class="agenda-name ${t.done ? 'done' : ''}">${escHtml(t.name)}</span>
        ${t.date ? `<span class="agenda-date ${overdue ? 'text-danger' : ''}">${formatDateBR(t.date)}${overdue ? ' — atrasada!' : ''}</span>` : ''}
      </div>
      <button class="btn btn-danger btn-sm" onclick="window.__app.deleteTarefa('${t.id}')">✕</button>
    </div>`;
}

// ═══════════════════════════════════
// CHAT
// ═══════════════════════════════════

function renderChatPage() {
  const s = appState.getState();
  const apiKey = getApiKey();
  const providerId = apiKey ? detectProvider(apiKey) : null;
  const providerName = providerId && AI_PROVIDERS[providerId] ? AI_PROVIDERS[providerId].name : 'IA';

  const historyHtml = s.chatHistory.slice(-20).map((m) => `
    <div class="chat-bubble ${m.role}">${escHtml(m.content)}</div>`).join('');

  return `
    <div class="page-content chat-page">
      <div class="page-header-row">
        <h2 class="page-title">Assistente IA 🤖</h2>
        ${apiKey ? `<span class="badge badge-success">${providerName}</span>` : `<span class="badge badge-danger">Sem chave</span>`}
      </div>

      ${!apiKey ? `
        <div class="alert alert-warning">
          <span>⚠️</span>
          <div>Configure uma chave de API em <strong>Configurações</strong> para usar o chat.
          Suporte: Claude, Gemini, GPT.</div>
        </div>` : ''}

      <div class="chat-messages" id="chat-messages">
        ${historyHtml || `<div class="chat-bubble assistant">Olá! Sou seu assistente de estudos. Como posso te ajudar hoje? 📚</div>`}
      </div>

      <div class="chat-suggestions">
        ${['Como estou em cada matéria?', 'Quais provas estão chegando?', 'Me dê dicas de estudo'].map((q) => `
          <button class="suggestion-chip" onclick="window.__app.sendSuggestion('${q}')">${q}</button>`).join('')}
      </div>

      <div class="chat-input-row">
        <input type="text" id="chat-input" class="form-input" placeholder="Digite sua dúvida..."
          ${!apiKey ? 'disabled' : ''}
          onkeydown="if(event.key==='Enter' && !event.shiftKey){ event.preventDefault(); window.__app.sendChatMessage(); }" />
        <button class="btn btn-primary" onclick="window.__app.sendChatMessage()" ${!apiKey ? 'disabled' : ''}>➤</button>
      </div>
    </div>`;
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input?.value?.trim();
  if (!text) return;
  input.value = '';
  await doSendMessage(text);
}

async function sendSuggestion(text) {
  await doSendMessage(text);
}

async function doSendMessage(text) {
  appendChatBubble(text, 'user');
  checkAchievement('CHAT_FIRST');

  const typing = appendChatBubble('…', 'assistant typing');
  const chatEl = document.getElementById('chat-messages');
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;

  try {
    const reply = await callAI(text);
    if (typing) typing.className = 'chat-bubble assistant';
    if (typing) typing.textContent = reply;

    appState.dispatch({ type: 'ADD_CHAT_MESSAGE', payload: { role: 'user', content: text, ts: Date.now() } });
    appState.dispatch({ type: 'ADD_CHAT_MESSAGE', payload: { role: 'assistant', content: reply, ts: Date.now() } });
  } catch (err) {
    if (typing) typing.className = 'chat-bubble assistant';
    if (typing) typing.textContent = `Erro: ${err.message}`;
  }

  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
}

function appendChatBubble(text, role) {
  const container = document.getElementById('chat-messages');
  if (!container) return null;
  const el = document.createElement('div');
  el.className = `chat-bubble ${role}`;
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

// ═══════════════════════════════════
// CONFIGURAÇÕES
// ═══════════════════════════════════

function renderConfigPage() {
  const s = appState.getState();
  const apiKey = getApiKey();
  const providerId = apiKey ? detectProvider(apiKey) : null;
  const providerName = providerId && AI_PROVIDERS[providerId] ? AI_PROVIDERS[providerId].name : '—';

  const achHtml = Object.values(ACHIEVEMENTS).map((a) => {
    const unlocked = !!s.achievements[a.id];
    return `
      <div class="ach-item ${unlocked ? 'ach-unlocked' : 'ach-locked'}">
        <span class="ach-icon">${a.icon}</span>
        <div>
          <div class="ach-label">${a.label}</div>
          <div class="ach-desc">${a.desc}</div>
        </div>
        ${unlocked ? `<span class="badge badge-success">✓</span>` : `<span class="badge badge-primary">🔒</span>`}
      </div>`;
  }).join('');

  return `
    <div class="page-content">
      <h2 class="page-title">Configurações</h2>

      <section class="config-section">
        <h3 class="section-title">👤 Perfil</h3>
        <div class="form-group">
          <label class="form-label">Nome completo</label>
          <input class="form-input" type="text" value="${escHtml(s.profile.name)}"
            onchange="window.__app.updateProfile('name', this.value)" />
        </div>
        <div class="form-group">
          <label class="form-label">Apelido (aparece no app)</label>
          <input class="form-input" type="text" value="${escHtml(s.profile.nick || '')}" placeholder="Opcional"
            onchange="window.__app.updateProfile('nick', this.value)" />
        </div>
        <div class="form-group">
          <label class="form-label">Escola</label>
          <input class="form-input" type="text" value="${escHtml(s.profile.school || '')}"
            onchange="window.__app.updateProfile('school', this.value)" />
        </div>
        <div class="form-group">
          <label class="form-label">Turma / Série</label>
          <input class="form-input" type="text" value="${escHtml(s.profile.class || '')}"
            onchange="window.__app.updateProfile('class', this.value)" />
        </div>
        <div class="form-group">
          <label class="form-label">Nota mínima para aprovação</label>
          <input class="form-input" type="number" min="0" max="10" step="0.5"
            value="${s.profile.minGrade}"
            onchange="window.__app.updateProfile('minGrade', parseFloat(this.value))" />
        </div>
        <div class="form-group">
          <label class="form-label">Quantidade de bimestres</label>
          <select class="form-select" onchange="window.__app.updateBimestres(parseInt(this.value))">
            ${[2,3,4].map((n) => `<option value="${n}" ${n === s.bimestres ? 'selected' : ''}>${n} bimestres</option>`).join('')}
          </select>
        </div>
      </section>

      <section class="config-section">
        <h3 class="section-title">🎨 Aparência</h3>
        <div class="form-group">
          <label class="form-label">Tema</label>
          <select class="form-select" onchange="window.__app.setTheme(this.value)">
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>🌙 Escuro</option>
            <option value="light" ${s.theme === 'light' ? 'selected' : ''}>☀️ Claro</option>
          </select>
        </div>
      </section>

      <section class="config-section">
        <h3 class="section-title">🤖 Inteligência Artificial</h3>
        <p class="form-help" style="margin-bottom:var(--space-12)">
          Suporte a <strong>Claude</strong> (sk-ant-…), <strong>Gemini</strong> (AIza…) e <strong>GPT</strong> (sk-…).
          Cole sua chave abaixo — ela é salva apenas no seu dispositivo.
        </p>
        ${apiKey ? `
          <div class="alert alert-success" style="margin-bottom:var(--space-12)">
            <span>✅</span>
            <div>Chave configurada — provedor detectado: <strong>${providerName}</strong></div>
          </div>` : ''}
        <div class="form-group">
          <label class="form-label">Chave de API</label>
          <input class="form-input" type="password" id="cfg-apikey"
            placeholder="${apiKey ? '••••••••••••• (já configurada)' : 'Cole sua chave aqui...'}" />
          <span class="form-help">Formatos aceitos: sk-ant-… | AIza… | sk-… (OpenAI-compat)</span>
        </div>
        <div class="btn-group">
          <button class="btn btn-primary btn-sm" onclick="window.__app.saveApiKey()">💾 Salvar Chave</button>
          ${apiKey ? `<button class="btn btn-danger btn-sm" onclick="window.__app.clearApiKey()">🗑 Remover Chave</button>` : ''}
        </div>
      </section>

      <section class="config-section">
        <h3 class="section-title">🏆 Conquistas</h3>
        <div class="achievements-list">${achHtml}</div>
      </section>

      <section class="config-section">
        <h3 class="section-title">💾 Dados</h3>
        <div class="btn-group">
          <button class="btn btn-outline" onclick="window.__app.exportData()">📤 Exportar Backup</button>
          <label class="btn btn-outline" style="cursor:pointer">
            📥 Importar Backup
            <input type="file" accept=".json" style="display:none" onchange="window.__app.importData(this)">
          </label>
          <button class="btn btn-danger" onclick="window.__app.confirmClearData()">🗑 Limpar Tudo</button>
        </div>
      </section>
    </div>`;
}

// ═══════════════════════════════════
// MODAIS — MATÉRIAS
// ═══════════════════════════════════

function openAddSubjectModal() {
  openModal(`
    <h3 class="modal-title">Nova Matéria</h3>
    <div class="form-group">
      <label class="form-label">Nome</label>
      <input class="form-input" id="m-sub-name" type="text" placeholder="Ex: Matemática" maxlength="50" />
    </div>
    <div class="form-group">
      <label class="form-label">Ícone (emoji)</label>
      <div class="icon-picker">
        ${APP_CONFIG.subjectIcons.map((ic) => `
          <button class="icon-opt" type="button" onclick="document.getElementById('m-sub-icon').value='${ic}';document.querySelectorAll('.icon-opt').forEach(b=>b.classList.remove('selected'));this.classList.add('selected')">${ic}</button>`).join('')}
      </div>
      <input id="m-sub-icon" type="hidden" value="📚" />
    </div>
    <button class="btn btn-primary btn-block" onclick="window.__app.submitModal()">Adicionar</button>`,
  () => {
    const name = document.getElementById('m-sub-name')?.value?.trim();
    const icon = document.getElementById('m-sub-icon')?.value || '📚';
    if (!name) { showToast('Digite o nome da matéria.', 'error'); return; }
    const s = appState.getState();
    appState.dispatch({
      type: 'ADD_SUBJECT',
      payload: { id: Date.now(), name, icon, grades: Array(s.bimestres).fill(null), faltas: 0, meta: null },
    });
    checkAchievement('FIRST_SUBJECT');
    closeModal();
    refreshPage(PAGES.SUBJECTS);
    refreshPage(PAGES.DASHBOARD);
    showToast(`📚 ${name} adicionada!`);
  });
}

// ═══════════════════════════════════
// MODAIS — AGENDA
// ═══════════════════════════════════

function openAddProvaModal() {
  const s = appState.getState();
  const opts = s.subjects.length
    ? s.subjects.map((sub) => `<option value="${escHtml(sub.name)}">${sub.icon || ''} ${escHtml(sub.name)}</option>`).join('')
    : `<option value="">— Nenhuma matéria cadastrada —</option>`;

  openModal(`
    <h3 class="modal-title">Nova Prova</h3>
    <div class="form-group">
      <label class="form-label">Matéria</label>
      <select class="form-select" id="m-prova-sub">${opts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Descrição</label>
      <input class="form-input" id="m-prova-name" type="text" placeholder="Ex: 1ª Prova Bimestral" />
    </div>
    <div class="form-group">
      <label class="form-label">Data</label>
      <input class="form-input" id="m-prova-date" type="date" />
    </div>
    <button class="btn btn-primary btn-block" onclick="window.__app.submitModal()">Salvar</button>`,
  () => {
    const subject = document.getElementById('m-prova-sub')?.value;
    const name = document.getElementById('m-prova-name')?.value?.trim() || 'Prova';
    const date = document.getElementById('m-prova-date')?.value;
    if (!subject || !date) { showToast('Preencha matéria e data.', 'error'); return; }
    appState.dispatch({ type: 'ADD_PROVA', payload: { id: String(Date.now()), subject, name, date } });
    closeModal();
    refreshPage(PAGES.AGENDA);
    refreshPage(PAGES.DASHBOARD);
    showToast(`📝 Prova de ${subject} agendada!`);
  });
}

function openAddTarefaModal() {
  openModal(`
    <h3 class="modal-title">Nova Tarefa</h3>
    <div class="form-group">
      <label class="form-label">Descrição</label>
      <input class="form-input" id="m-tar-name" type="text" placeholder="Ex: Estudar capítulo 3" />
    </div>
    <div class="form-group">
      <label class="form-label">Prazo (opcional)</label>
      <input class="form-input" id="m-tar-date" type="date" />
    </div>
    <button class="btn btn-primary btn-block" onclick="window.__app.submitModal()">Salvar</button>`,
  () => {
    const name = document.getElementById('m-tar-name')?.value?.trim();
    const date = document.getElementById('m-tar-date')?.value || null;
    if (!name) { showToast('Digite a descrição da tarefa.', 'error'); return; }
    appState.dispatch({ type: 'ADD_TAREFA', payload: { id: String(Date.now()), name, date, done: false } });
    closeModal();
    refreshPage(PAGES.AGENDA);
    showToast('✅ Tarefa adicionada!');
  });
}

// ═══════════════════════════════════
// AÇÕES — MATÉRIAS
// ═══════════════════════════════════

function updateGrade(subjectId, bimIndex, value) {
  const s = appState.getState();
  const sub = s.subjects.find((s) => s.id === subjectId);
  if (!sub) return;
  const grades = [...(sub.grades || Array(s.bimestres).fill(null))];
  grades[bimIndex] = value === '' ? null : parseFloat(value);
  appState.dispatch({ type: 'UPDATE_SUBJECT', payload: { id: subjectId, grades } });
  checkAchievement('FIRST_GRADE');
  checkAllAchievements();
  renderHeader(appState.getState());
}

function updateFaltas(subjectId, value) {
  appState.dispatch({ type: 'UPDATE_SUBJECT', payload: { id: subjectId, faltas: parseInt(value) || 0 } });
}

function deleteSubject(id) {
  const s = appState.getState();
  const sub = s.subjects.find((s) => s.id === id);
  if (!sub) return;
  openModal(`
    <h3 class="modal-title">Remover Matéria</h3>
    <p>Tem certeza que deseja remover <strong>${escHtml(sub.name)}</strong>? Todas as notas serão perdidas.</p>
    <div class="btn-group" style="margin-top:var(--space-16)">
      <button class="btn btn-danger" onclick="window.__app._confirmDeleteSubject(${id})">Sim, remover</button>
      <button class="btn btn-secondary" onclick="window.__app.closeModal()">Cancelar</button>
    </div>`, () => {});
}

function _confirmDeleteSubject(id) {
  appState.dispatch({ type: 'DELETE_SUBJECT', payload: id });
  closeModal();
  refreshPage(PAGES.SUBJECTS);
  refreshPage(PAGES.DASHBOARD);
  showToast('Matéria removida.', 'info');
}

// ═══════════════════════════════════
// AÇÕES — AGENDA
// ═══════════════════════════════════

function deleteProva(id) {
  appState.dispatch({ type: 'DELETE_PROVA', payload: id });
  refreshPage(PAGES.AGENDA);
  refreshPage(PAGES.DASHBOARD);
}

function deleteTarefa(id) {
  appState.dispatch({ type: 'DELETE_TAREFA', payload: id });
  refreshPage(PAGES.AGENDA);
}

function toggleTarefa(id) {
  const s = appState.getState();
  const t = s.tarefas.find((t) => t.id === id);
  if (!t) return;
  appState.dispatch({ type: 'UPDATE_TAREFA', payload: { id, done: !t.done } });
  if (!t.done) showToast('✅ Tarefa concluída!');
  refreshPage(PAGES.AGENDA);
}

// ═══════════════════════════════════
// AÇÕES — CONFIGURAÇÕES
// ═══════════════════════════════════

function updateProfile(key, value) {
  appState.dispatch({ type: 'SET_PROFILE', payload: { [key]: value } });
  renderHeader(appState.getState());
}

function updateBimestres(value) {
  appState.dispatch({ type: 'SET_BIMESTRES', payload: value });
}

function setTheme(theme) {
  appState.dispatch({ type: 'SET_THEME', payload: theme });
}

function saveApiKey() {
  const key = document.getElementById('cfg-apikey')?.value?.trim();
  if (!key) { showToast('Cole a chave no campo antes de salvar.', 'error'); return; }
  storageSaveApiKey(key);
  const pid = detectProvider(key);
  const name = AI_PROVIDERS[pid]?.name || 'IA desconhecida';
  showToast(`🤖 Chave salva! Provedor: ${name}`);
  refreshPage(PAGES.CONFIG);
  refreshPage(PAGES.CHAT);
}

function clearApiKey() {
  removeApiKey();
  showToast('Chave removida.', 'info');
  refreshPage(PAGES.CONFIG);
  refreshPage(PAGES.CHAT);
}

function exportData() {
  const data = storageExport();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meuboletim_backup_${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📤 Backup exportado!');
}

function importData(input) {
  const file = input?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      storageImport(data);
      showToast('📥 Dados importados com sucesso!');
      location.reload();
    } catch {
      showToast('Arquivo inválido.', 'error');
    }
  };
  reader.readAsText(file);
}

function confirmClearData() {
  openModal(`
    <h3 class="modal-title" style="color:var(--danger)">⚠️ Limpar Todos os Dados</h3>
    <p>Isso apagará <strong>permanentemente</strong> todas as matérias, notas, tarefas, provas e configurações.</p>
    <div class="btn-group" style="margin-top:var(--space-16)">
      <button class="btn btn-danger" onclick="window.__app._confirmClear()">Sim, apagar tudo</button>
      <button class="btn btn-secondary" onclick="window.__app.closeModal()">Cancelar</button>
    </div>`, () => {});
}

function _confirmClear() {
  storageClearAll();
  location.reload();
}

// ═══════════════════════════════════
// LOADING
// ═══════════════════════════════════

function hideLoadingScreen() {
  const screen = document.getElementById('loading-screen');
  if (screen) {
    screen.style.opacity = '0';
    setTimeout(() => screen.remove(), 400);
  }
}

function showFatalError(err) {
  const screen = document.getElementById('loading-screen');
  if (screen) screen.innerHTML = `
    <div style="text-align:center;color:var(--danger);padding:2rem">
      <h2>Erro ao inicializar</h2>
      <p style="margin:1rem 0;color:var(--text-muted)">${err.message}</p>
      <button onclick="location.reload()" class="btn btn-primary">Tentar novamente</button>
    </div>`;
}

// ═══════════════════════════════════
// HELPERS
// ═══════════════════════════════════

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDateBR(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('pt-BR');
}

// ═══════════════════════════════════
// API GLOBAL
// ═══════════════════════════════════

window.__app = {
  navigateTo,
  updateProfile,
  updateBimestres,
  setTheme,
  updateGrade,
  updateFaltas,
  deleteSubject,
  _confirmDeleteSubject,
  deleteProva,
  deleteTarefa,
  toggleTarefa,
  openAddSubjectModal,
  openAddProvaModal,
  openAddTarefaModal,
  saveApiKey,
  clearApiKey,
  sendChatMessage,
  sendSuggestion,
  exportData,
  importData,
  confirmClearData,
  _confirmClear,
  closeModal,
  submitModal,
};

init();
