// ═══════════════════════════════════════════════════════════════
//  app.js — AgentPro v3.1
//  Melhorias: recorrência, categorias/prioridade, busca, arquivar,
//  drag-and-drop, exportar .ics, datetime picker, memória entre
//  sessões, editar via chat, listar tarefas, typing indicator,
//  limpeza automática de histórico, sync em tempo real (onSnapshot),
//  seletor de modelo de IA.
// ═══════════════════════════════════════════════════════════════

import {
  initAuth,
  saveTaskToFirestore,
  deleteTaskFromFirestore,
  saveChatHistory,
  loadChatHistory,
  saveAgentMemory,
  loadAgentMemory,
  subscribeToTasks
} from './auth.js';

// ── Registro do Service Worker (PWA) ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log("AgentPro: PWA Ativo!"))
    .catch(err => console.error("Erro SW:", err));
}

// ─── Ícones tema ───
const ICON_MOON = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
const ICON_SUN  = `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  const icon  = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (theme === 'dark') {
    icon.innerHTML  = ICON_SUN;
    label.innerText = 'Modo Claro';
  } else {
    icon.innerHTML  = ICON_MOON;
    label.innerText = 'Modo Escuro';
  }
}

// ─── Personalidades visuais ───
// Cada personalidade aplica data-personality no <html> para que o CSS
// ajuste cores de accent, blobs e badges sem tocar no tema claro/escuro.
const PERSONALITY_THEMES = {
  motivacional: { accent: '#f97316', blob: '#f9731620', label: 'Coach Épico 🔥'    },
  sarcastico:   { accent: '#22d3ee', blob: '#22d3ee18', label: 'Realista Ácido 😼' },
  militar:      { accent: '#4ade80', blob: '#4ade8018', label: 'Comando Tático ⚔️' },
  gentil:       { accent: '#f472b6', blob: '#f472b618', label: 'Zênite da Paz 🌸'  },
};

function setPersonality(key) {
  const p = PERSONALITY_THEMES[key] || PERSONALITY_THEMES.motivacional;
  document.documentElement.setAttribute('data-personality', key);
  // Injeta variáveis CSS de accent dinamicamente
  document.documentElement.style.setProperty('--personality-accent', p.accent);
  document.documentElement.style.setProperty('--personality-blob',   p.blob);
}

// ─── Cor de destaque personalizada ───
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return { r, g, b };
}
function colorWithAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function applyAccentColor(hex) {
  const root = document.documentElement;
  root.style.setProperty('--primary',      hex);
  root.style.setProperty('--primary-dim',  colorWithAlpha(hex, 0.15));
  root.style.setProperty('--primary-glow', colorWithAlpha(hex, 0.35));
  // Atualiza cor do theme-color da PWA
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hex);
  // Marca o swatch ativo
  document.querySelectorAll('.accent-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color?.toLowerCase() === hex.toLowerCase());
  });
  // Sincroniza o color picker
  const picker = document.getElementById('accentColorPicker');
  if (picker) picker.value = hex;
}

function initAccentColor() {
  const saved = localStorage.getItem('accent_color') || '#6C63FF';
  applyAccentColor(saved);

  document.getElementById('accentSwatches')?.addEventListener('click', e => {
    const swatch = e.target.closest('.accent-swatch[data-color]');
    if (!swatch) return;
    const color = swatch.dataset.color;
    applyAccentColor(color);
    localStorage.setItem('accent_color', color);
  });

  const picker = document.getElementById('accentColorPicker');
  picker?.addEventListener('input', e => {
    applyAccentColor(e.target.value);
  });
  picker?.addEventListener('change', e => {
    applyAccentColor(e.target.value);
    localStorage.setItem('accent_color', e.target.value);
    // Marca swatch custom como ativo
    document.querySelectorAll('.accent-swatch').forEach(s => s.classList.remove('active'));
    picker.closest('.accent-custom')?.classList.add('active');
  });
}

// ─── Notificações — botão de ativar ───
function updateNotifUI() {
  const btn   = document.getElementById('notifToggleBtn');
  const label = document.getElementById('notifToggleLabel');
  const dot   = document.getElementById('notifStatusDot');
  if (!btn) return;
  const perm = Notification.permission;
  if (perm === 'granted') {
    label.textContent = 'Lembretes ativos';
    dot.className = 'notif-status-dot active';
    btn.classList.add('notif-active');
  } else if (perm === 'denied') {
    label.textContent = 'Bloqueado pelo sistema';
    dot.className = 'notif-status-dot denied';
    btn.classList.remove('notif-active');
  } else {
    label.textContent = 'Ativar lembretes';
    dot.className = 'notif-status-dot';
    btn.classList.remove('notif-active');
  }
}

function initNotifButton() {
  updateNotifUI();
  document.getElementById('notifToggleBtn')?.addEventListener('click', async () => {
    if (Notification.permission === 'granted') {
      // Já ativo — dispara notif de teste
      new Notification('AgentPro 🤖', {
        body: 'Lembretes já estão ativos! Você receberá avisos nas tarefas agendadas.',
        icon: 'https://cdn-icons-png.flaticon.com/512/8943/8943377.png',
      });
      return;
    }
    if (Notification.permission === 'denied') {
      showToast('Notificações bloqueadas. Libere nas configurações do navegador.', 'error');
      return;
    }
    const result = await Notification.requestPermission();
    updateNotifUI();
    if (result === 'granted') {
      new Notification('AgentPro 🤖', {
        body: '✅ Lembretes ativados! Você será avisado na hora das tarefas.',
        icon: 'https://cdn-icons-png.flaticon.com/512/8943/8943377.png',
      });
      syncTasksToSW();
      showToast('Lembretes ativados com sucesso!', 'success');
    } else {
      showToast('Permissão negada. Sem lembretes por enquanto.', 'error');
    }
  });
}

// ─── Estado global ───
let tasks        = [];
let chatHistory  = [];
let agentMemory  = {};   // #11 memória persistente entre sessões
let activeFilter = 'today';
let searchQuery  = '';   // #6 busca por texto

const CATEGORIES = {
  trabalho:  { label: 'Trabalho',  emoji: '💼', color: '#7c5cfc' },
  pessoal:   { label: 'Pessoal',   emoji: '🏠', color: '#10b981' },
  saude:     { label: 'Saúde',     emoji: '❤️', color: '#f43f5e' },
  estudos:   { label: 'Estudos',   emoji: '📚', color: '#f59e0b' },
  outros:    { label: 'Outros',    emoji: '📌', color: '#22d3ee' },
};

const PRIORITIES = {
  urgente: { label: 'Urgente',  emoji: '🔴', order: 0 },
  alta:    { label: 'Alta',     emoji: '🟠', order: 1 },
  normal:  { label: 'Normal',   emoji: '🟡', order: 2 },
  baixa:   { label: 'Baixa',    emoji: '🟢', order: 3 },
};

const RECURRENCE_LABELS = {
  none:    'Sem recorrência',
  daily:   'Todo dia',
  weekly:  'Toda semana',
  monthly: 'Todo mês',
};

const filterConfig = {
  today:    { label: 'Agenda de Hoje',   icon: 'calendar-check' },
  tomorrow: { label: 'Agenda de Amanhã', icon: 'calendar-clock' },
  week:     { label: 'Próximos 7 Dias',  icon: 'calendar-range' },
  all:      { label: 'Toda a Agenda',    icon: 'calendar' },
};

const personalities = {
  motivacional: "Você é um Coach motivacional épico. Use gritos de guerra, emojis de fogo 🔥 e motive o usuário a aniquilar as tarefas!",
  sarcastico:   "Você é um assistente extremamente irônico, realista e sarcástico. Critique a procrastinação do usuário com humor ácido. 😼",
  militar:      "Você é um comandante tático. Dê ordens curtas, diretas e sem enrolação. Foco na missão! 🪖",
  gentil:       "Você é um assistente calmo, zen e acolhedor. Ajude o usuário a se organizar sem pressa ou ansiedade, com positividade. 🌸"
};

// ─────────────────────────────────────────────────────────────
//  PERSISTÊNCIA
// ─────────────────────────────────────────────────────────────

async function persistTask(task) {
  await saveTaskToFirestore(task);
  // Mantém o SW sempre atualizado com o estado mais recente da agenda
  syncTasksToSW();
}

// ─────────────────────────────────────────────────────────────
//  RECORRÊNCIA — gera ocorrências futuras de tarefas recorrentes
// ─────────────────────────────────────────────────────────────

function expandRecurringTasks(baseTasks) {
  const today  = new Date().toISOString().slice(0, 10);
  const maxDay = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const result = [...baseTasks.filter(t => !t.recurrence || t.recurrence === 'none')];

  baseTasks.filter(t => t.recurrence && t.recurrence !== 'none').forEach(base => {
    let cur = new Date(base.date + 'T12:00:00');
    const end = new Date(maxDay + 'T12:00:00');

    // Gerar ocorrências dentro da janela visível
    let iterations = 0;
    while (cur <= end && iterations < 60) {
      iterations++;
      const ds = cur.toISOString().slice(0, 10);
      // Pula datas anteriores a hoje (exceto a original)
      if (ds >= today) {
        result.push({
          ...base,
          id: `${base.id}_r_${ds}`,
          date: ds,
          _isRecurrence: true,
          _baseId: base.id,
        });
      }
      if (base.recurrence === 'daily')        cur = new Date(cur.getTime() + 86400000);
      else if (base.recurrence === 'weekly')  cur = new Date(cur.getTime() + 7 * 86400000);
      else if (base.recurrence === 'monthly') { cur = new Date(cur); cur.setMonth(cur.getMonth() + 1); }
      else break;

      if (ds === base.date) continue; // skip first already added
    }
  });

  return result;
}

// ─────────────────────────────────────────────────────────────
//  UI helpers
// ─────────────────────────────────────────────────────────────

function getDateRange(filter) {
  const today    = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const in7days  = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  switch (filter) {
    case 'today':    return { from: today,    to: today };
    case 'tomorrow': return { from: tomorrow, to: tomorrow };
    case 'week':     return { from: today,    to: in7days };
    case 'all':      return { from: null,     to: null };
    default:         return { from: today,    to: today };
  }
}

function filterTasks(filter) {
  const today = new Date().toISOString().slice(0, 10);
  const expanded = expandRecurringTasks(tasks);

  // Apply text search (#6)
  let list = expanded;
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    list = list.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.category && CATEGORIES[t.category]?.label.toLowerCase().includes(q))
    );
  }

  // Filter out archived unless viewing "all" (#7)
  if (filter !== 'all') {
    list = list.filter(t => !t.archived);
  }

  list.forEach(t => { if (!t.date) t.date = today; });
  const range = getDateRange(filter);
  if (!range.from && !range.to) return list;
  return list.filter(t => {
    const d = t.date || today;
    return d >= range.from && d <= range.to;
  });
}

function updateTaskStats() {
  const filtered = filterTasks(activeFilter);
  const badge = document.getElementById('taskBadge');
  const stat  = document.getElementById('statTaskCount');
  if (badge) badge.textContent = filtered.length;
  if (stat)  stat.textContent  = tasks.length + (tasks.length === 1 ? ' tarefa' : ' tarefas');
}

// ─────────────────────────────────────────────────────────────
//  ESTATÍSTICAS DE PRODUTIVIDADE
// ─────────────────────────────────────────────────────────────

function computeStats() {
  const today   = new Date().toISOString().slice(0, 10);
  const real    = tasks.filter(t => !t._isRecurrence);

  // Janelas de tempo
  const d7  = new Date(Date.now() - 7  * 86400000).toISOString().slice(0, 10);
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const inRange = (t, from) => (t.date || today) >= from && (t.date || today) <= today;

  const week7  = real.filter(t => inRange(t, d7));
  const week30 = real.filter(t => inRange(t, d30));

  const done7  = week7.filter(t => t.completed).length;
  const done30 = week30.filter(t => t.completed).length;
  const total7 = week7.length;
  const total30 = week30.length;

  // Taxa de conclusão
  const rate7  = total7  ? Math.round((done7  / total7)  * 100) : 0;
  const rate30 = total30 ? Math.round((done30 / total30) * 100) : 0;

  // Categoria mais ativa (últimos 30 dias)
  const catCount = {};
  week30.forEach(t => { const c = t.category || 'outros'; catCount[c] = (catCount[c] || 0) + 1; });
  const topCat = Object.entries(catCount).sort((a,b) => b[1]-a[1])[0];

  // Prioridade mais criada
  const priCount = {};
  week30.forEach(t => { const p = t.priority || 'normal'; priCount[p] = (priCount[p] || 0) + 1; });
  const topPri = Object.entries(priCount).sort((a,b) => b[1]-a[1])[0];

  // Streak de dias produtivos (dias com ≥1 tarefa concluída)
  let streak = 0;
  let cur = new Date(today);
  while (streak < 365) {
    const ds = cur.toISOString().slice(0, 10);
    const hadDone = real.some(t => (t.date || today) === ds && t.completed);
    if (!hadDone) break;
    streak++;
    cur = new Date(cur.getTime() - 86400000);
  }

  // Tarefas por dia da semana (últimos 30 dias, concluídas)
  const dowDone = [0,0,0,0,0,0,0]; // dom-sáb
  week30.filter(t => t.completed).forEach(t => {
    const dow = new Date((t.date || today) + 'T12:00:00').getDay();
    dowDone[dow]++;
  });
  const dowLabels = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  return { done7, total7, rate7, done30, total30, rate30, streak, topCat, topPri, dowDone, dowLabels };
}

function openStatsModal() {
  const s = computeStats();
  const catInfo  = s.topCat  ? `${CATEGORIES[s.topCat[0]]?.emoji || '📌'} ${CATEGORIES[s.topCat[0]]?.label || s.topCat[0]} (${s.topCat[1]}x)` : '—';
  const priInfo  = s.topPri  ? `${PRIORITIES[s.topPri[0]]?.emoji || '🟡'} ${PRIORITIES[s.topPri[0]]?.label || s.topPri[0]}` : '—';
  const maxDow   = Math.max(...s.dowDone, 1);

  const bars = s.dowLabels.map((label, i) => {
    const h = Math.round((s.dowDone[i] / maxDow) * 56);
    const active = new Date().getDay() === i ? ' bar-today' : '';
    return `
      <div class="stats-bar-col">
        <span class="stats-bar-val">${s.dowDone[i]}</span>
        <div class="stats-bar-track">
          <div class="stats-bar-fill${active}" style="height:${h}px"></div>
        </div>
        <span class="stats-bar-label">${label}</span>
      </div>`;
  }).join('');

  let modal = document.getElementById('statsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'statsModalOverlay';
    modal.className = 'stats-modal-overlay';
    document.body.appendChild(modal);
  } else {
    modal = document.getElementById('statsModalOverlay');
  }

  modal.innerHTML = `
    <div class="stats-modal" id="statsModal">
      <div class="stats-modal-header">
        <span><i data-lucide="bar-chart-2"></i> Estatísticas de Produtividade</span>
        <button class="stats-close" id="statsClose"><i data-lucide="x"></i></button>
      </div>
      <div class="stats-body">
        <div class="stats-grid-top">
          <div class="stats-card">
            <span class="stats-card-val">${s.done7}</span>
            <span class="stats-card-label">Concluídas (7d)</span>
            <span class="stats-card-sub">${s.rate7}% de ${s.total7} criadas</span>
          </div>
          <div class="stats-card">
            <span class="stats-card-val">${s.done30}</span>
            <span class="stats-card-label">Concluídas (30d)</span>
            <span class="stats-card-sub">${s.rate30}% de ${s.total30} criadas</span>
          </div>
          <div class="stats-card stats-card-accent">
            <span class="stats-card-val">${s.streak}</span>
            <span class="stats-card-label">🔥 Streak atual</span>
            <span class="stats-card-sub">dias produtivos seguidos</span>
          </div>
        </div>

        <div class="stats-row-2">
          <div class="stats-info-card">
            <span class="stats-info-label">Categoria mais ativa</span>
            <span class="stats-info-val">${catInfo}</span>
          </div>
          <div class="stats-info-card">
            <span class="stats-info-label">Prioridade frequente</span>
            <span class="stats-info-val">${priInfo}</span>
          </div>
        </div>

        <div class="stats-chart-wrap">
          <div class="stats-chart-title">Tarefas concluídas por dia (últimos 30d)</div>
          <div class="stats-bars">${bars}</div>
        </div>

        <div class="stats-rate-wrap">
          <div class="stats-rate-label">Taxa de conclusão — 30 dias</div>
          <div class="stats-rate-bar">
            <div class="stats-rate-fill" style="width:${s.rate30}%"></div>
          </div>
          <div class="stats-rate-pct">${s.rate30}%</div>
        </div>
      </div>
    </div>`;

  modal.classList.add('open');
  if (window.lucide) lucide.createIcons({ nodes: [modal] });

  document.getElementById('statsClose').addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
}

window.openStatsModal = openStatsModal;

function updateAgendaTitle() {
  const cfg = filterConfig[activeFilter];
  const el  = document.getElementById('agendaTitle');
  if (el) el.textContent = cfg.label;
}

function formatDate(dateStr) {
  if (!dateStr) return 'Hoje';
  const today    = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dateStr === today)    return 'Hoje';
  if (dateStr === tomorrow) return 'Amanhã';
  const [y, m, d] = dateStr.split('-');
  const dateObj = new Date(dateStr + 'T12:00:00');
  const dow = dateObj.toLocaleDateString('pt-BR', { weekday: 'short' });
  return `${dow}, ${d}/${m}/${y}`;
}

function getDateStatus(dateStr) {
  const today    = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (dateStr < today)      return 'past';
  if (dateStr === today)    return 'today';
  if (dateStr === tomorrow) return 'tomorrow';
  return 'future';
}

function showAgendaLoading() {
  const list = document.getElementById('taskList');
  if (!list) return;
  list.innerHTML = `
    <div class="agenda-loading">
      <div class="agenda-skeleton"></div>
      <div class="agenda-skeleton" style="width:75%"></div>
      <div class="agenda-skeleton" style="width:85%"></div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────
//  RENDER TASKS — com drag-and-drop (#8), categoria/prioridade (#5), arquivar (#7)
// ─────────────────────────────────────────────────────────────

let dragSrcId = null;

function renderTasks() {
  const list = document.getElementById('taskList');
  list.innerHTML = '';

  const filtered = filterTasks(activeFilter);

  if (filtered.length === 0) {
    const emptyMessages = {
      today:    'Nenhuma tarefa para hoje.<br>Que dia tranquilo! 🎉',
      tomorrow: 'Nenhuma tarefa para amanhã.<br>Aproveite o descanso! 😌',
      week:     'Nada nos próximos 7 dias.<br>Agenda livre! 🌴',
      all:      'Nenhuma tarefa ainda.<br>Adicione algo na barra lateral.',
    };
    list.innerHTML = `
      <div class="empty-state">
        <i data-lucide="calendar-x-2"></i>
        <span>${emptyMessages[activeFilter] || emptyMessages.all}</span>
      </div>`;
    if (window.lucide) lucide.createIcons();
    updateTaskStats();
    return;
  }

  const today  = new Date().toISOString().slice(0, 10);

  // Sort by date, then priority, then time
  const sorted = [...filtered].sort((a, b) => {
    const dc = (a.date || today).localeCompare(b.date || today);
    if (dc !== 0) return dc;
    const pa = PRIORITIES[a.priority]?.order ?? 2;
    const pb = PRIORITIES[b.priority]?.order ?? 2;
    if (pa !== pb) return pa - pb;
    return (a.time || '').localeCompare(b.time || '');
  });

  const groups = {};
  sorted.forEach(t => {
    const key = t.date || today;
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });

  Object.entries(groups).forEach(([dateKey, group]) => {
    const status = getDateStatus(dateKey);
    const header = document.createElement('div');
    header.className = `task-date-header status-${status}`;
    const badge = {
      past:     '<span class="date-status-badge past">Passado</span>',
      today:    '<span class="date-status-badge today">Hoje</span>',
      tomorrow: '<span class="date-status-badge tomorrow">Amanhã</span>',
      future:   '<span class="date-status-badge future">Em breve</span>',
    }[status] || '';
    header.innerHTML = `
      <div class="date-header-left">
        <span class="date-header-label">${formatDate(dateKey)}</span>
        ${badge}
      </div>
      <span class="task-date-count">${group.length}</span>`;
    list.appendChild(header);

    group.forEach(task => {
      const baseId    = task._isRecurrence ? task._baseId : task.id;
      const cat       = CATEGORIES[task.category] || CATEGORIES.outros;
      const pri       = PRIORITIES[task.priority] || PRIORITIES.normal;
      const isArchived = !!task.archived;
      const recLabel   = task.recurrence && task.recurrence !== 'none'
        ? `<span class="task-badge-rec" title="${RECURRENCE_LABELS[task.recurrence]}">🔁</span>` : '';

      const card = document.createElement('div');
      card.className = `task-card status-${status}${task.completed ? ' completed' : ''}${isArchived ? ' archived-task' : ''}`;
      card.dataset.id = task.id;
      card.draggable = !task._isRecurrence; // #8 drag-and-drop (only real tasks)

      card.innerHTML = `
        <div class="task-left">
          <button class="task-checkbox${task.completed ? ' checked' : ''}" onclick="toggleComplete('${task.id}')" title="${task.completed ? 'Desmarcar' : 'Concluir'}">
            <i data-lucide="check"></i>
          </button>
          <span class="time-badge">${task.time || '00:00'}</span>
          <span class="task-cat-dot" style="background:${cat.color}" title="${cat.label}">${cat.emoji}</span>
          <span class="task-title">${task.title}</span>
          ${recLabel}
          <span class="task-pri-badge pri-${task.priority || 'normal'}" title="Prioridade: ${pri.label}">${pri.emoji}</span>
        </div>
        <div class="task-card-actions">
          ${status === 'past' && !isArchived ? `<button class="btn-archive" onclick="archiveTask('${baseId}')" title="Arquivar"><i data-lucide="archive"></i></button>` : ''}
          ${isArchived ? `<button class="btn-archive unarchive" onclick="unarchiveTask('${baseId}')" title="Desarquivar"><i data-lucide="archive-restore"></i></button>` : ''}
          <button class="btn-share" onclick="shareTask('${baseId}')" title="Compartilhar tarefa">
            <i data-lucide="share-2"></i>
          </button>
          <button class="btn-edit" onclick="openEditModal('${baseId}')" title="Editar tarefa">
            <i data-lucide="pencil"></i>
          </button>
          <button class="btn-delete" onclick="deleteTask('${baseId}')" title="Remover tarefa">
            <i data-lucide="trash-2"></i>
          </button>
        </div>`;

      // #8 drag-and-drop within same day group
      if (!task._isRecurrence) {
        card.setAttribute('data-task-id', task.id);
        card.addEventListener('dragstart', (e) => {
          dragSrcId = task.id;
          card.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
        card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
        card.addEventListener('drop', (e) => {
          e.preventDefault();
          card.classList.remove('drag-over');
          if (dragSrcId && dragSrcId !== task.id) swapTaskOrder(dragSrcId, task.id);
        });
        // Touch drag-and-drop (mobile)
        initTouchDrag(card, task.id);
      }

      list.appendChild(card);
    });
  });

  if (window.lucide) lucide.createIcons();
  updateTaskStats();
}

// Swap order (store sortOrder field)
async function swapTaskOrder(idA, idB) {
  const a = tasks.find(t => t.id == idA);
  const b = tasks.find(t => t.id == idB);
  if (!a || !b) return;
  const tempOrder = a.sortOrder ?? a.id;
  a.sortOrder = b.sortOrder ?? b.id;
  b.sortOrder = tempOrder;
  await persistTask(a);
  await persistTask(b);
  renderTasks();
}

// ─── Touch drag-and-drop ───────────────────────────────────────
let touchDragId   = null;
let touchClone    = null;
let touchOverId   = null;

function initTouchDrag(card, taskId) {
  let startX, startY, startScrollY;
  let longPressTimer = null;
  const LONG_PRESS_MS = 400;

  card.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    startScrollY = window.scrollY;

    longPressTimer = setTimeout(() => {
      // Haptic feedback
      if (navigator.vibrate) navigator.vibrate(30);

      touchDragId = taskId;
      card.classList.add('dragging');

      // Clone flutuante
      touchClone = card.cloneNode(true);
      const rect = card.getBoundingClientRect();
      touchClone.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        opacity: 0.85;
        pointer-events: none;
        z-index: 9999;
        transform: scale(1.03);
        box-shadow: 0 12px 40px rgba(0,0,0,0.4);
        transition: none;
        border-radius: 12px;
      `;
      document.body.appendChild(touchClone);
    }, LONG_PRESS_MS);
  }, { passive: true });

  card.addEventListener('touchmove', (e) => {
    if (!touchDragId) {
      // Cancela long press se moveu demais
      const t = e.touches[0];
      if (Math.abs(t.clientX - startX) > 8 || Math.abs(t.clientY - startY) > 8) {
        clearTimeout(longPressTimer);
      }
      return;
    }
    e.preventDefault();
    const t = e.touches[0];
    const rect = touchClone && touchClone.getBoundingClientRect();
    if (touchClone && rect) {
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const origRect = card.getBoundingClientRect();
      touchClone.style.left = (origRect.left + dx) + 'px';
      touchClone.style.top  = (origRect.top  + dy) + 'px';
    }

    // Encontrar card sob o dedo
    touchClone && (touchClone.style.display = 'none');
    const el = document.elementFromPoint(t.clientX, t.clientY);
    touchClone && (touchClone.style.display = '');

    const overCard = el?.closest('.task-card');
    const overId   = overCard?.dataset?.taskId;

    if (overId && overId !== touchDragId && overId !== touchOverId) {
      document.querySelectorAll('.task-card.drag-over').forEach(c => c.classList.remove('drag-over'));
      overCard.classList.add('drag-over');
      touchOverId = overId;
    }
  }, { passive: false });

  const endDrag = () => {
    clearTimeout(longPressTimer);
    if (!touchDragId) return;

    document.querySelectorAll('.task-card.drag-over').forEach(c => c.classList.remove('drag-over'));
    card.classList.remove('dragging');
    touchClone?.remove();
    touchClone = null;

    if (touchOverId && touchOverId !== touchDragId) {
      swapTaskOrder(touchDragId, touchOverId);
    }
    touchDragId = null;
    touchOverId = null;
  };

  card.addEventListener('touchend',    endDrag, { passive: true });
  card.addEventListener('touchcancel', endDrag, { passive: true });
}

// ─── Compartilhar tarefa ──────────────────────────────────────
window.shareTask = function(taskId) {
  const task = tasks.find(t => t.id == taskId);
  if (!task) return;

  const CATS = { trabalho: '💼', pessoal: '🏠', saude: '🏋️', financeiro: '💰', estudos: '📚', outros: '🚀' };
  const PRIS = { urgente: '🔴 Urgente', alta: '🟠 Alta', normal: '🟡 Normal', baixa: '🟢 Baixa' };

  const cat  = CATS[task.category] || '📌';
  const pri  = PRIS[task.priority]  || '';
  const date = task.date  ? new Date(task.date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Sem data';
  const time = task.time  ? ` às ${task.time}` : '';
  const rec  = task.recurrence && task.recurrence !== 'none' ? `\n🔁 Recorrência: ${task.recurrence}` : '';

  const text =
`${cat} *${task.title}*
📅 ${date}${time}${rec}
${pri ? '⚡ Prioridade: ' + pri : ''}

_Enviado via AgentPro 🤖_`.trim();

  // Tenta Web Share API (mobile)
  if (navigator.share) {
    navigator.share({ title: task.title, text }).catch(() => {});
    return;
  }

  // Fallback: copia + abre WhatsApp Web
  navigator.clipboard.writeText(text).then(() => {
    showToast('📋 Texto copiado! Abrindo WhatsApp…', 'success');
    setTimeout(() => {
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
    }, 600);
  }).catch(() => {
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  });
};

// ─────────────────────────────────────────────────────────────
//  CRUD de tarefas
// ─────────────────────────────────────────────────────────────

function getFormValues(prefix = '') {
  const dt = document.getElementById(`${prefix}taskDatetime`)?.value;
  let date = '', time = '';
  if (dt) {
    [date, time] = dt.split('T');
  } else {
    date = document.getElementById(`${prefix}taskDate`)?.value || '';
    time = document.getElementById(`${prefix}taskTime`)?.value || '';
  }
  return {
    title:      document.getElementById(`${prefix}taskTitle`)?.value.trim() || '',
    date:       date || new Date().toISOString().slice(0, 10),
    time:       time || '00:00',
    category:   document.getElementById(`${prefix}taskCategory`)?.value || 'outros',
    priority:   document.getElementById(`${prefix}taskPriority`)?.value || 'normal',
    recurrence: document.getElementById(`${prefix}taskRecurrence`)?.value || 'none',
  };
}

async function addTask(prefix = '') {
  const { title, date, time, category, priority, recurrence } = getFormValues(prefix);
  if (!title || !time) return;

  const newTask = {
    id: Date.now(),
    title, time, date,
    category, priority, recurrence,
    notified: false, completed: false, archived: false,
    sortOrder: Date.now()
  };
  tasks.push(newTask);
  await persistTask(newTask);

  // Clear form
  ['taskTitle','taskDate','taskTime','taskDatetime'].forEach(id => {
    const el = document.getElementById(`${prefix}${id}`);
    if (el) el.value = '';
  });

  const today    = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const in7days  = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  let targetFilter = 'all';
  if (date === today)         targetFilter = 'today';
  else if (date === tomorrow) targetFilter = 'tomorrow';
  else if (date <= in7days)   targetFilter = 'week';

  document.querySelectorAll('.agenda-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === targetFilter);
  });
  activeFilter = targetFilter;
  updateAgendaTitle();
  renderTasks();
  updateTaskStats();
  // permissão já solicitada no boot

  setTimeout(() => {
    const cards = document.querySelectorAll('.task-card');
    const last  = [...cards].find(c => c.dataset.id == newTask.id);
    if (last) last.classList.add('task-new');
  }, 50);
}

window.deleteTask = async function(id) {
  tasks = tasks.filter(t => t.id != id);
  await deleteTaskFromFirestore(id);
  syncTasksToSW();
  renderTasks();
};

window.toggleComplete = async function(id) {
  // Handle recurrence virtual ids like "123_r_2025-01-15"
  const realId = String(id).includes('_r_') ? String(id).split('_r_')[0] : id;
  const task = tasks.find(t => t.id == realId);
  if (!task) return;
  task.completed = !task.completed;
  await persistTask(task);

  const card = document.querySelector(`.task-card[data-id="${id}"]`);
  if (card) {
    card.classList.add('completing');
    card.addEventListener('animationend', () => card.classList.remove('completing'), { once: true });
  }
  if (task.completed) launchConfetti();
  renderTasks();
};

// #7 Archive past tasks
window.archiveTask = async function(id) {
  const task = tasks.find(t => t.id == id);
  if (!task) return;
  task.archived = true;
  await persistTask(task);
  renderTasks();
};

window.unarchiveTask = async function(id) {
  const task = tasks.find(t => t.id == id);
  if (!task) return;
  task.archived = false;
  await persistTask(task);
  renderTasks();
};

// ─── Edit Modal ───
let editingTaskId = null;

window.openEditModal = function(id) {
  const task = tasks.find(t => t.id == id);
  if (!task) return;
  editingTaskId = id;
  document.getElementById('editTaskTitle').value    = task.title;
  document.getElementById('editTaskCategory').value  = task.category || 'outros';
  document.getElementById('editTaskPriority').value  = task.priority || 'normal';
  document.getElementById('editTaskRecurrence').value = task.recurrence || 'none';
  const dtEl = document.getElementById('editTaskDatetime');
  if (dtEl && task.date && task.time) {
    dtEl.value = `${task.date}T${task.time}`;
  }
  document.getElementById('editOverlay').classList.add('open');
  setTimeout(() => document.getElementById('editTaskTitle').focus(), 300);
};

function closeEditModal() {
  const overlay = document.getElementById('editOverlay');
  const modal   = document.getElementById('editModal');
  modal.style.transform = 'translateY(110%)';
  setTimeout(() => {
    overlay.classList.remove('open');
    modal.style.transform = '';
    editingTaskId = null;
  }, 360);
}

async function saveEdit() {
  if (!editingTaskId) return;
  const title     = document.getElementById('editTaskTitle').value.trim();
  const dtVal     = document.getElementById('editTaskDatetime').value;
  const category  = document.getElementById('editTaskCategory').value;
  const priority  = document.getElementById('editTaskPriority').value;
  const recurrence = document.getElementById('editTaskRecurrence').value;
  if (!title || !dtVal) return;

  const [date, time] = dtVal.split('T');
  const task = tasks.find(t => t.id == editingTaskId);
  if (task) {
    task.title      = title;
    task.date       = date;
    task.time       = time || '00:00';
    task.category   = category;
    task.priority   = priority;
    task.recurrence = recurrence;
    await persistTask(task);
  }
  closeEditModal();
  renderTasks();
}

// #9 Export .ics
function exportICS() {
  const visibleTasks = filterTasks(activeFilter).filter(t => !t.archived);
  if (!visibleTasks.length) {
    alert('Nenhuma tarefa para exportar na vista atual.');
    return;
  }

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AgentPro//PT', 'CALSCALE:GREGORIAN'];

  visibleTasks.forEach(t => {
    const dtStart = `${(t.date || '').replace(/-/g,'')}T${(t.time || '0000').replace(':','')}00`;
    const uid     = `${t.id}@agentpro`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`SUMMARY:${t.title}`);
    if (t.category) lines.push(`CATEGORIES:${CATEGORIES[t.category]?.label || t.category}`);
    if (t.priority && t.priority !== 'normal') {
      const priMap = { urgente: 1, alta: 3, normal: 5, baixa: 9 };
      lines.push(`PRIORITY:${priMap[t.priority] || 5}`);
    }
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'agentpro-agenda.ics';
  a.click();
}

// ─────────────────────────────────────────────────────────────
//  Confetti
// ─────────────────────────────────────────────────────────────

function launchConfetti() {
  const canvas = document.getElementById('confettiCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#7c5cfc','#22d3ee','#10b981','#f59e0b','#f43f5e','#a78bfa','#34d399'];
  const pieces = Array.from({ length: 90 }, () => ({
    x: Math.random() * canvas.width, y: -10 - Math.random() * 80,
    w: 7 + Math.random() * 9, h: 5 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    vx: (Math.random() - 0.5) * 4, vy: 2.5 + Math.random() * 4,
    rot: Math.random() * Math.PI * 2, rSpeed: (Math.random() - 0.5) * 0.18, opacity: 1
  }));

  let frame, start = null;
  const DURATION = 2600;
  function draw(ts) {
    if (!start) start = ts;
    const elapsed = ts - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.07; p.rot += p.rSpeed;
      p.opacity = Math.max(0, 1 - (elapsed / DURATION));
      if (p.y < canvas.height + 20) alive = true;
      ctx.save(); ctx.globalAlpha = p.opacity;
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
      ctx.restore();
    });
    if (alive && elapsed < DURATION + 600) frame = requestAnimationFrame(draw);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (frame) cancelAnimationFrame(frame);
  frame = requestAnimationFrame(draw);
}

// ─────────────────────────────────────────────────────────────
//  Notificações
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
//  NOTIFICAÇÕES — Service Worker + fallback em primeiro plano
// ─────────────────────────────────────────────────────────────

// Pede permissão e registra Periodic Background Sync (se disponível).
async function checkNotificationPermission() {
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  // Periodic Background Sync — garante checagem mesmo com app fechado (Chrome/Android)
  if ('serviceWorker' in navigator && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker.ready;
      if ('periodicSync' in reg) {
        const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        if (status.state === 'granted') {
          await reg.periodicSync.register('agentpro-notif-check', { minInterval: 60_000 });
        }
      }
    } catch { /* silently ignore — browser não suporta */ }
  }
}

// Envia a lista de tarefas ao Service Worker para ele guardar no IndexedDB
// e fazer as checagens mesmo com o app fechado.
async function syncTasksToSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.active) {
      reg.active.postMessage({ type: 'SYNC_TASKS', tasks });
    }
  } catch { /* silently ignore */ }
}

// Ouve mensagens do SW (ex: tarefa concluída via botão na notificação)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', async (e) => {
    if (e.data?.type === 'TASK_DONE') {
      const task = tasks.find(t => t.id == e.data.taskId);
      if (task && !task.completed) {
        task.completed = true;
        await persistTask(task);
        renderTasks();
        showToast(`✅ "${task.title}" concluída!`, 'success');
      }
    }
  });
}

// Fallback: setInterval para quando o app está em primeiro plano.
// O SW cuida do background; este loop garante precisão extra quando visível.
setInterval(async () => {
  const agora = new Date().toTimeString().slice(0, 5);
  const hoje  = new Date().toISOString().slice(0, 10);
  for (const task of tasks) {
    if ((task.date || hoje) === hoje && task.time === agora && !task.notified) {
      if (Notification.permission === 'granted') {
        new Notification('AgentPro 🤖', {
          body: `Está na hora de: ${task.title}`,
          icon: 'https://cdn-icons-png.flaticon.com/512/8943/8943377.png',
          tag:  `task-${task.id}`,
        });
      }
      task.notified = true;
      await persistTask(task);
      // Mantém o SW sincronizado com o estado mais recente
      await syncTasksToSW();
    }
  }
}, 15_000);

// ─────────────────────────────────────────────────────────────
//  Chat / Groq API
// ─────────────────────────────────────────────────────────────

function friendlyApiError(data, status) {
  if (status === 401) return "❌ Chave API inválida. Verifique na barra lateral.";
  if (status === 429) return "⏳ Limite de requisições atingido. Aguarde e tente novamente.";
  if (status === 503 || status === 500) return "🔧 Servidor da IA instável. Tente em instantes.";
  if (data?.error?.message) {
    const msg = data.error.message.toLowerCase();
    if (msg.includes('invalid api key') || msg.includes('auth'))
      return "❌ Chave API inválida. Verifique na barra lateral.";
    if (msg.includes('rate limit') || msg.includes('quota'))
      return "⏳ Limite de uso atingido. Aguarde e tente novamente.";
  }
  return "⚠️ Algo deu errado ao contatar a IA. Tente novamente.";
}

function appendMessage(text, sender, className = '') {
  const box = document.getElementById('chatBox');
  const msg = document.createElement('div');
  msg.className = `message ${sender} ${className}`;
  msg.innerText = text;
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
  return msg;
}

// #14 Animated typing indicator
function showTypingIndicator() {
  const box = document.getElementById('chatBox');
  const el  = document.createElement('div');
  el.className = 'message agent typing-indicator';
  el.id = 'typingIndicator';
  el.innerHTML = `<span></span><span></span><span></span>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function removeTypingIndicator() {
  document.getElementById('typingIndicator')?.remove();
}

function appendVoiceMessage(text) {
  const box = document.getElementById('chatBox');
  const msg = document.createElement('div');
  msg.className = 'message user audio-user';
  msg.innerHTML = `<span class="audio-label"><i data-lucide="mic" style="width:11px;height:11px"></i> áudio</span><span>${text}</span>`;
  box.appendChild(msg);
  box.scrollTop = box.scrollHeight;
  if (window.lucide) lucide.createIcons({ nodes: [msg] });
}

async function addTaskFromChat({ title, date, time, category, priority, recurrence }) {
  const today    = new Date().toISOString().slice(0, 10);
  const taskDate = date || today;
  const taskTime = time || '00:00';
  const newTask  = {
    id: Date.now(), title, time: taskTime, date: taskDate,
    category: category || 'outros',
    priority: priority || 'normal',
    recurrence: recurrence || 'none',
    notified: false, completed: false, archived: false, sortOrder: Date.now()
  };
  tasks.push(newTask);
  await persistTask(newTask);

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const in7days  = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  let targetFilter = 'all';
  if (taskDate === today)         targetFilter = 'today';
  else if (taskDate === tomorrow) targetFilter = 'tomorrow';
  else if (taskDate <= in7days)   targetFilter = 'week';

  document.querySelectorAll('.agenda-tab').forEach(b => b.classList.toggle('active', b.dataset.filter === targetFilter));
  activeFilter = targetFilter;
  updateAgendaTitle();
  renderTasks();
  updateTaskStats();
  // permissão já solicitada no boot
  return newTask;
}

// #12 Edit task via chat
async function editTaskFromChat({ title, newTitle, newDate, newTime, newPriority, newCategory }) {
  const lower = title.toLowerCase();
  const task  = tasks.find(t => t.title.toLowerCase().includes(lower));
  if (!task) return null;
  if (newTitle)    task.title    = newTitle;
  if (newDate)     task.date     = newDate;
  if (newTime)     task.time     = newTime;
  if (newPriority) task.priority = newPriority;
  if (newCategory) task.category = newCategory;
  await persistTask(task);
  renderTasks();
  return task;
}

function confirmDeleteModal(taskTitle) {
  return new Promise((resolve) => {
    const box = document.getElementById('chatBox');
    const wrapper = document.createElement('div');
    wrapper.className = 'message agent confirm-delete-msg';
    wrapper.innerHTML = `
      <span>Confirma remover <strong>"${taskTitle}"</strong>?</span>
      <div class="confirm-delete-btns">
        <button class="btn-confirm-yes">Sim, remover</button>
        <button class="btn-confirm-no">Cancelar</button>
      </div>`;
    box.appendChild(wrapper);
    box.scrollTop = box.scrollHeight;
    wrapper.querySelector('.btn-confirm-yes').addEventListener('click', () => { wrapper.remove(); resolve(true); });
    wrapper.querySelector('.btn-confirm-no').addEventListener('click',  () => { wrapper.remove(); resolve(false); });
  });
}

async function deleteTaskFromChat({ title }) {
  const lower = title.toLowerCase();
  const idx   = tasks.findIndex(t => t.title.toLowerCase().includes(lower));
  if (idx === -1) return null;
  const removed = tasks.splice(idx, 1)[0];
  await deleteTaskFromFirestore(removed.id);
  renderTasks();
  updateTaskStats();
  return removed;
}

// #13 Structured "list tasks" tool
function listTasksForChat(filter = 'all') {
  const today = new Date().toISOString().slice(0, 10);
  let list = expandRecurringTasks(tasks).filter(t => !t.archived);

  if (filter === 'today') {
    list = list.filter(t => (t.date || today) === today);
  } else if (filter === 'week') {
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    list = list.filter(t => (t.date || today) >= today && (t.date || today) <= in7);
  }

  if (!list.length) return 'Nenhuma tarefa encontrada.';

  return list
    .sort((a, b) => (a.date||today).localeCompare(b.date||today) || (a.time||'').localeCompare(b.time||''))
    .map(t => {
      const cat = CATEGORIES[t.category]?.emoji || '📌';
      const pri = PRIORITIES[t.priority]?.emoji || '🟡';
      return `${pri} ${cat} [${formatDate(t.date||today)} ${t.time||'00:00'}] ${t.title}${t.completed ? ' ✅' : ''}`;
    })
    .join('\n');
}

function buildTools() {
  const today = new Date().toISOString().slice(0, 10);
  return [
    {
      type: "function",
      function: {
        name: "adicionar_tarefa",
        description: "Adiciona uma tarefa/evento/lembrete à agenda do usuário.",
        parameters: {
          type: "object",
          properties: {
            title:      { type: "string", description: "Título claro e descritivo." },
            date:       { type: "string", description: `Data YYYY-MM-DD. Hoje é ${today}.` },
            time:       { type: "string", description: "Horário HH:MM (24h). Se não informado, use 00:00." },
            category:   { type: "string", enum: ["trabalho","pessoal","saude","estudos","outros"], description: "Categoria da tarefa." },
            priority:   { type: "string", enum: ["urgente","alta","normal","baixa"], description: "Prioridade." },
            recurrence: { type: "string", enum: ["none","daily","weekly","monthly"], description: "Recorrência." }
          },
          required: ["title", "date", "time"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "remover_tarefa",
        description: "Remove uma tarefa da agenda.",
        parameters: {
          type: "object",
          properties: { title: { type: "string", description: "Parte do título da tarefa a remover." } },
          required: ["title"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "editar_tarefa",      // #12
        description: "Edita uma tarefa existente na agenda (título, data, horário, prioridade ou categoria).",
        parameters: {
          type: "object",
          properties: {
            title:       { type: "string", description: "Parte do título atual da tarefa a editar." },
            newTitle:    { type: "string", description: "Novo título (opcional)." },
            newDate:     { type: "string", description: `Nova data YYYY-MM-DD (opcional). Hoje é ${today}.` },
            newTime:     { type: "string", description: "Novo horário HH:MM (opcional)." },
            newPriority: { type: "string", enum: ["urgente","alta","normal","baixa"], description: "Nova prioridade (opcional)." },
            newCategory: { type: "string", enum: ["trabalho","pessoal","saude","estudos","outros"], description: "Nova categoria (opcional)." }
          },
          required: ["title"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "listar_tarefas",     // #13
        description: "Lista as tarefas da agenda de forma estruturada.",
        parameters: {
          type: "object",
          properties: {
            filter: { type: "string", enum: ["today","week","all"], description: "Filtro de período." }
          },
          required: []
        }
      }
    }
  ];
}

// ─── Modelos disponíveis na Groq ───
const GROQ_MODELS = [
  { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B",   badge: "⚡ Rápido"    },
  { id: "meta-llama/llama-4-maverick-17b-128e-instruct", label: "Llama 4 Maverick 17B", badge: "🧠 Avançado" },
  { id: "llama-3.3-70b-versatile",                   label: "Llama 3.3 70B",       badge: "🏆 Potente"   },
  { id: "mixtral-8x7b-32768",                        label: "Mixtral 8×7B",        badge: "📚 Contexto"  },
];
const DEFAULT_MODEL = GROQ_MODELS[0].id;

function getSelectedModel() {
  return localStorage.getItem('groq_model') || DEFAULT_MODEL;
}

async function callGroq(apiKey, messages, tools = null) {
  const model = getSelectedModel();
  const body = { model, messages };
  if (tools) { body.tools = tools; body.tool_choice = "auto"; }
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  return { response, data: await response.json() };
}

async function sendMessage() {
  const input  = document.getElementById('chatInput');
  const text   = input.value.trim();
  const apiKey = localStorage.getItem('groq_api_key');
  const personalityKey = document.getElementById('personality').value;

  if (!text) return;
  if (!apiKey) {
    appendMessage("⚠️ Insira sua chave API Groq na barra lateral antes de usar o agente.", 'agent');
    return;
  }

  appendMessage(text, 'user');
  input.value = '';
  chatHistory.push({ role: "user", content: text });
  await runAgentTurn(apiKey, personalityKey);
}

async function sendVoiceMessage(text) {
  document.getElementById('chatInput').value = '';
  const apiKey = localStorage.getItem('groq_api_key');
  const personalityKey = document.getElementById('personality').value;
  if (!apiKey) {
    appendMessage("⚠️ Insira sua chave API Groq na barra lateral antes de usar o agente.", 'agent');
    return;
  }
  appendVoiceMessage(text);
  chatHistory.push({ role: "user", content: text });
  await runAgentTurn(apiKey, personalityKey, true);
}

async function runAgentTurn(apiKey, personalityKey, isVoice = false) {
  const today = new Date().toISOString().slice(0, 10);
  const futureTasks = expandRecurringTasks(tasks)
    .filter(t => (t.date || today) >= today)
    .sort((a, b) => (a.date||today).localeCompare(b.date||today) || (a.time||'').localeCompare(b.time||''));

  const agendaContexto = futureTasks.length
    ? futureTasks.map(t => {
        const pri = PRIORITIES[t.priority]?.emoji || '🟡';
        const cat = CATEGORIES[t.category]?.emoji || '📌';
        return `- ${pri}${cat} [${formatDate(t.date||today)} ${t.time}] ${t.title}${t.completed ? ' ✅' : ''}`;
      }).join('\n')
    : 'Nenhuma tarefa futura.';

  // #11 Inject agent memory into system prompt
  const memoryCtx = Object.keys(agentMemory).length
    ? `\nMemória do usuário:\n${Object.entries(agentMemory).map(([k,v]) => `- ${k}: ${v}`).join('\n')}`
    : '';

  const voiceHint = isVoice ? '\nO usuário enviou mensagem por VOZ (transcrita). Pode ter pequenos erros de transcrição.' : '';

  const userName = localStorage.getItem('agent_nickname') || window._agentUserName || 'usuário';
  const systemPrompt = `${personalities[personalityKey]}

O nome pelo qual o usuário quer ser chamado é: ${userName}. Chame-o pelo nome naturalmente, sem exagerar.
Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${today}).
Agenda atual:\n${agendaContexto}${memoryCtx}${voiceHint}
Quando pedir para adicionar/agendar algo, USE adicionar_tarefa.
Para remover, USE remover_tarefa.
Para editar/alterar uma tarefa existente, USE editar_tarefa.
Para listar tarefas de forma estruturada, USE listar_tarefas.
Se o usuário mencionar preferências, hábitos ou informações pessoais relevantes (ex: "eu acordo às 6h", "trabalho de manhã"), guarde internamente para personalizar respostas.`;

  const tools = buildTools();

  // #15 Keep chat history lean — max 30 messages, clean tool noise
  if (chatHistory.length > 30) {
    // Keep system-relevant context: drop oldest non-recent turns
    chatHistory = chatHistory.slice(-30);
  }

  try {
    showTypingIndicator(); // #14

    const { response, data } = await callGroq(apiKey, [
      { role: "system", content: systemPrompt },
      ...chatHistory
    ], tools);

    removeTypingIndicator();

    if (!response.ok || data.error) {
      appendMessage(friendlyApiError(data, response.status), 'agent');
      chatHistory.pop();
      return;
    }

    const message = data.choices?.[0]?.message;
    if (!message) {
      appendMessage("⚠️ Resposta inesperada da IA.", 'agent');
      chatHistory.pop();
      return;
    }

    if (message.tool_calls?.length > 0) {
      const toolResults = [];
      for (const tc of message.tool_calls) {
        let args; try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
        let resultContent = '';

        if (tc.function.name === 'adicionar_tarefa') {
          const task = await addTaskFromChat(args);
          resultContent = JSON.stringify({ sucesso: true, tarefa: task.title, data: task.date, horario: task.time });

        } else if (tc.function.name === 'remover_tarefa') {
          const lower = args.title.toLowerCase();
          const found = tasks.find(t => t.title.toLowerCase().includes(lower));
          if (!found) {
            resultContent = JSON.stringify({ sucesso: false, motivo: 'Não encontrada.' });
          } else {
            const confirmed = await confirmDeleteModal(found.title);
            if (confirmed) {
              const removed = await deleteTaskFromChat(args);
              resultContent = JSON.stringify({ sucesso: true, tarefa_removida: removed.title });
            } else {
              resultContent = JSON.stringify({ sucesso: false, motivo: 'Usuário cancelou a remoção.' });
            }
          }

        } else if (tc.function.name === 'editar_tarefa') { // #12
          const edited = await editTaskFromChat(args);
          if (edited) resultContent = JSON.stringify({ sucesso: true, tarefa: edited.title });
          else resultContent = JSON.stringify({ sucesso: false, motivo: 'Tarefa não encontrada.' });

        } else if (tc.function.name === 'listar_tarefas') { // #13
          const listing = listTasksForChat(args.filter || 'all');
          resultContent = JSON.stringify({ tarefas: listing });
        }

        toolResults.push({ role: "tool", tool_call_id: tc.id, content: resultContent });
      }

      showTypingIndicator(); // #14 second call
      const { response: r2, data: d2 } = await callGroq(apiKey, [
        { role: "system",    content: systemPrompt },
        ...chatHistory,
        { role: "assistant", content: null, tool_calls: message.tool_calls },
        ...toolResults
      ]);
      removeTypingIndicator();

      if (!r2.ok || d2.error) {
        appendMessage(friendlyApiError(d2, r2.status), 'agent');
        chatHistory.pop();
        return;
      }

      const reply = d2.choices?.[0]?.message?.content || "Feito! ✅";
      appendMessage(reply, 'agent');
      chatHistory.push({ role: "assistant", content: null, tool_calls: message.tool_calls });
      toolResults.forEach(r => chatHistory.push(r));
      chatHistory.push({ role: "assistant", content: reply });

    } else {
      appendMessage(message.content, 'agent');
      chatHistory.push({ role: "assistant", content: message.content });
    }

    // #15 Prune before saving — strip tool messages from persisted history to save Firestore space
    const persistHistory = chatHistory.filter(m => m.role === 'user' || (m.role === 'assistant' && m.content));
    const MAX_PERSIST = 40;
    saveChatHistory(persistHistory.slice(-MAX_PERSIST));

    // #11 Async memory update every 5 user turns
    const userTurns = chatHistory.filter(m => m.role === 'user').length;
    if (userTurns > 0 && userTurns % 5 === 0) {
      updateAgentMemory(apiKey, personalityKey);
    }

  } catch (err) {
    removeTypingIndicator();
    appendMessage("📡 Sem conexão com a IA. Verifique sua internet e a chave API.", 'agent');
    chatHistory.pop();
    console.error(err);
  }
}

// #11 — Update agent memory from recent conversation
async function updateAgentMemory(apiKey) {
  try {
    const recentMessages = chatHistory.slice(-10);
    const { response, data } = await callGroq(apiKey, [
      { role: "system", content: `Analise a conversa e extraia fatos concretos sobre o usuário (preferências, horários, hábitos, nome, profissão, etc). Responda APENAS com JSON no formato: {"fato_chave": "valor", ...}. Máximo 8 fatos. Se não houver nada relevante, responda {}.` },
      ...recentMessages
    ]);
    if (!response.ok) return;
    const text = data.choices?.[0]?.message?.content || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    const newFacts = JSON.parse(clean);
    agentMemory = { ...agentMemory, ...newFacts };
    await saveAgentMemory(agentMemory);
  } catch { /* silently fail */ }
}

// ─────────────────────────────────────────────────────────────
//  Microfone — Web Speech API
// ─────────────────────────────────────────────────────────────

function showMicToast(msg) {
  let toast = document.getElementById('micToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'micToast';
    toast.className = 'mic-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function initMic() {
  const micBtn    = document.getElementById('micBtn');
  const chatInput = document.getElementById('chatInput');
  if (!micBtn) return;

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    micBtn.title = 'Gravação não suportada neste navegador';
    micBtn.style.opacity = '0.45';
    micBtn.style.cursor  = 'not-allowed';
    micBtn.addEventListener('click', () => showMicToast('🎤 Gravação não suportada neste navegador.'));
    return;
  }

  micBtn.title = 'Segure para gravar • Solte para enviar';
  let mediaRecorder = null, audioChunks = [], isRecording = false, stream = null, holdTimer = null;

  function setRecordingUI(on) {
    isRecording = on;
    micBtn.classList.toggle('recording', on);
    micBtn.innerHTML = on ? '<i data-lucide="mic-off"></i>' : '<i data-lucide="mic"></i>';
    if (window.lucide) lucide.createIcons({ nodes: [micBtn] });
    chatInput.placeholder = on ? '🎙️ Gravando… solte para enviar' : 'Pergunte algo ou segure o microfone…';
  }

  function setTranscribingUI(on) {
    micBtn.classList.toggle('transcribing', on);
    micBtn.innerHTML = on ? '<i data-lucide="loader"></i>' : '<i data-lucide="mic"></i>';
    if (window.lucide) lucide.createIcons({ nodes: [micBtn] });
    chatInput.placeholder = on ? '⏳ Transcrevendo…' : 'Pergunte algo ou segure o microfone…';
  }

  async function transcribeAudio(blob) {
    const apiKey = localStorage.getItem('groq_api_key');
    if (!apiKey) { showMicToast('⚠️ Salve sua chave API Groq antes de usar o microfone.'); return; }
    setTranscribingUI(true);
    try {
      const mimeType = blob.type || 'audio/webm';
      const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      const formData = new FormData();
      formData.append('file', new File([blob], `audio.${ext}`, { type: mimeType }));
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('language', 'pt');
      formData.append('response_format', 'json');
      const res  = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: formData });
      const data = await res.json();
      setTranscribingUI(false);
      const text = data?.text?.trim();
      if (!text) { showMicToast('Nada foi captado. Tente falar mais perto.'); return; }
      chatInput.value = text;
      sendVoiceMessage(text);
    } catch (err) {
      setTranscribingUI(false);
      showMicToast('📡 Erro ao transcrever. Verifique sua conexão.');
    }
  }

  async function startRecording() {
    if (isRecording) return;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { showMicToast('🎤 Permissão de microfone negada.'); return; }
    const preferredTypes = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus','audio/ogg'];
    const mimeType = preferredTypes.find(t => MediaRecorder.isTypeSupported(t)) || '';
    audioChunks   = [];
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    mediaRecorder.addEventListener('dataavailable', e => { if (e.data.size > 0) audioChunks.push(e.data); });
    mediaRecorder.addEventListener('stop', () => {
      stream.getTracks().forEach(t => t.stop()); stream = null;
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
      transcribeAudio(blob);
    });
    mediaRecorder.start();
    setRecordingUI(true);
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    setRecordingUI(false);
    mediaRecorder.stop();
  }

  micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); holdTimer = setTimeout(() => startRecording(), 120); }, { passive: false });
  micBtn.addEventListener('touchend',   (e) => { e.preventDefault(); clearTimeout(holdTimer); stopRecording(); }, { passive: false });
  micBtn.addEventListener('mousedown',  ()  => { holdTimer = setTimeout(() => startRecording(), 120); });
  micBtn.addEventListener('mouseup',    ()  => { clearTimeout(holdTimer); if (isRecording) stopRecording(); else if (!mediaRecorder) startRecording(); });
  micBtn.addEventListener('mouseleave', ()  => { clearTimeout(holdTimer); if (isRecording) stopRecording(); });
}

// ─────────────────────────────────────────────────────────────
//  Custom Select (Personalidade)
// ─────────────────────────────────────────────────────────────

function initCustomSelect() {
  const trigger    = document.getElementById('personalityTrigger');
  const dropdown   = document.getElementById('personalityDropdown');
  const label      = document.getElementById('personalityLabel');
  const realSelect = document.getElementById('personality');
  const options    = dropdown.querySelectorAll('.custom-select-option');

  const labels = { motivacional: 'Coach Épico 🔥', sarcastico: 'Realista Ácido 😼', militar: 'Comando Tático 🪖', gentil: 'Zênite da Paz 🌸' };
  const saved = localStorage.getItem('agent_personality_modern') || 'motivacional';
  setCustomOption(saved);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    dropdown.classList.toggle('open', !isOpen);
    trigger.setAttribute('aria-expanded', String(!isOpen));
    if (!isOpen && window.lucide) lucide.createIcons();
  });

  options.forEach(opt => {
    opt.addEventListener('click', () => {
      const val = opt.dataset.value;
      setCustomOption(val);
      dropdown.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      localStorage.setItem('agent_personality_modern', val);
      realSelect.value = val;
      realSelect.dispatchEvent(new Event('change'));
    });
  });

  document.addEventListener('click', (e) => {
    if (!trigger.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  function setCustomOption(val) {
    options.forEach(o => o.classList.toggle('selected', o.dataset.value === val));
    label.textContent = labels[val] || labels.motivacional;
    realSelect.value  = val;
    if (window.lucide) lucide.createIcons();
  }
}

// ─────────────────────────────────────────────────────────────
//  Nickname
// ─────────────────────────────────────────────────────────────

function initNickname() {
  const savedBlock = document.getElementById('nicknameSavedBlock');
  const inputBlock = document.getElementById('nicknameInputBlock');
  const savedLabel = document.getElementById('nicknameSavedLabel');
  const input      = document.getElementById('userNickname');
  const saveBtn    = document.getElementById('saveNicknameBtn');
  const changeBtn  = document.getElementById('changeNicknameBtn');

  function getWelcome(name, personality) {
    const n = name || 'você';
    const msgs = {
      motivacional: `🔥 E AÍ, ${n.toUpperCase()}! Pronto pra DOMINAR o dia? Me fala o que quer agendar e vamos nessa!`,
      sarcastico:   `😼 Ah, então é ${n}. Que surpresa você aparecer aqui em vez de procrastinar. O que vamos ignorar hoje?`,
      militar:      `⚔️ Soldado ${n}! Presença confirmada. Aguardando ordens. Qual é a missão?`,
      gentil:       `🌸 Que bom ter você aqui, ${n}! Respire fundo — vamos organizar seu dia com calma. Como posso ajudar?`
    };
    return msgs[personality] || msgs.motivacional;
  }

  function showSaved(name) {
    savedLabel.textContent = name;
    savedBlock.style.display = 'flex';
    inputBlock.style.display = 'none';
    if (window.lucide) lucide.createIcons({ nodes: [savedBlock] });
  }

  function showInput() {
    savedBlock.style.display = 'none';
    inputBlock.style.display = 'block';
    input.focus();
  }

  function confirmName() {
    const val = input.value.trim();
    if (!val) return;
    const isFirstTime = !localStorage.getItem('agent_nickname');
    localStorage.setItem('agent_nickname', val);
    window._agentUserName = val;
    showSaved(val);
    if (chatHistory.filter(m => m.role === 'user').length === 0) {
      const personality = localStorage.getItem('agent_personality_modern') || 'motivacional';
      chatHistory = [];
      document.getElementById('chatBox').innerHTML = '';
      appendMessage(getWelcome(val, personality), 'agent');
    } else if (isFirstTime) {
      const personality = localStorage.getItem('agent_personality_modern') || 'motivacional';
      const acks = { motivacional: `🔥 Nome salvo! A partir de agora te chamo de ${val}. Bora continuar!`, sarcastico: `😼 ${val}. Ok. Anotado. Finalmente.`, militar: `⚔️ Identidade confirmada: ${val}. Prosseguindo missão.`, gentil: `🌸 Que nome bonito, ${val}! Já vou usar assim.` };
      appendMessage(acks[personality] || acks.motivacional, 'agent');
    }
  }

  const saved = localStorage.getItem('agent_nickname');
  if (saved) { input.value = saved; showSaved(saved); } else { showInput(); }

  saveBtn.addEventListener('click', confirmName);
  input.addEventListener('keypress', (e) => { if (e.key === 'Enter') confirmName(); });
  changeBtn.addEventListener('click', () => { showInput(); input.select(); });
}

// ─────────────────────────────────────────────────────────────
//  API Key
// ─────────────────────────────────────────────────────────────

function initApiKey() {
  const savedBlock = document.getElementById('apiSavedBlock');
  const inputBlock = document.getElementById('apiInputBlock');
  const keyInput   = document.getElementById('apiKeyInput');
  const saveBtn    = document.getElementById('saveApiBtn');
  const changeBtn  = document.getElementById('changeApiBtn');

  function showSaved() { savedBlock.style.display = 'flex'; inputBlock.style.display = 'none'; }
  function showInput() { savedBlock.style.display = 'none'; inputBlock.style.display = 'block'; keyInput.focus(); }

  if (localStorage.getItem('groq_api_key')) showSaved(); else showInput();

  saveBtn.addEventListener('click', () => {
    const val = keyInput.value.trim();
    if (!val) return;
    localStorage.setItem('groq_api_key', val);
    keyInput.value = '';
    showSaved();
  });
  keyInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') saveBtn.click(); });
  changeBtn.addEventListener('click', () => { localStorage.removeItem('groq_api_key'); showInput(); });
}

// ─────────────────────────────────────────────────────────────
//  #24 — Limpar histórico do chat com confirmação
// ─────────────────────────────────────────────────────────────

window.clearChatHistory = clearChatHistory;
function clearChatHistory() {
  showNativeConfirm(
    '🗑️ Limpar histórico',
    'Tem certeza que deseja apagar todo o histórico de conversa? Esta ação não pode ser desfeita.',
    async () => {
      chatHistory = [];
      const box = document.getElementById('chatBox');
      box.innerHTML = '';
      await saveChatHistory([]);
      const personality = localStorage.getItem('agent_personality_modern') || 'motivacional';
      const name = localStorage.getItem('agent_nickname') || window._agentUserName || '';
      const farewell = {
        motivacional: `🔥 Histórico limpo! Começo zerado, mente fresca. Bora dominar, ${name || 'campeão'}!`,
        sarcastico:   `😼 Pronto, deletei tudo. Como se a memória resolvesse seus problemas.`,
        militar:      `⚔️ Histórico apagado. Base limpa. Pronto para nova missão, soldado.`,
        gentil:       `🌸 Tudo limpo, ${name || 'amigo'}! Um novo começo. Como posso ajudar?`,
      };
      appendMessage(farewell[personality] || farewell.motivacional, 'agent');
    }
  );
}

// Diálogo de confirmação estilizado (evita window.confirm feio)
function showNativeConfirm(title, message, onConfirm) {
  let overlay = document.getElementById('confirmDialogOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'confirmDialogOverlay';
    overlay.innerHTML = `
      <div class="confirm-dialog" id="confirmDialog">
        <div class="confirm-dialog-icon" id="confirmDialogIcon">🗑️</div>
        <h3 class="confirm-dialog-title" id="confirmDialogTitle"></h3>
        <p class="confirm-dialog-msg" id="confirmDialogMsg"></p>
        <div class="confirm-dialog-btns">
          <button class="confirm-dialog-cancel" id="confirmDialogCancel">Cancelar</button>
          <button class="confirm-dialog-ok" id="confirmDialogOk">Confirmar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  document.getElementById('confirmDialogTitle').textContent = title;
  document.getElementById('confirmDialogMsg').textContent = message;
  overlay.classList.add('open');

  const ok     = document.getElementById('confirmDialogOk');
  const cancel = document.getElementById('confirmDialogCancel');

  const close = () => overlay.classList.remove('open');
  const okClone = ok.cloneNode(true);
  ok.parentNode.replaceChild(okClone, ok);
  const cancelClone = cancel.cloneNode(true);
  cancel.parentNode.replaceChild(cancelClone, cancel);

  document.getElementById('confirmDialogOk').addEventListener('click', () => { close(); onConfirm(); });
  document.getElementById('confirmDialogCancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

// ─────────────────────────────────────────────────────────────
//  Seletor de modelo de IA
// ─────────────────────────────────────────────────────────────

function initModelSelector() {
  const wrapper = document.getElementById('modelSelectorWrap');
  if (!wrapper) return;

  const saved = getSelectedModel();
  const active = GROQ_MODELS.find(m => m.id === saved) || GROQ_MODELS[0];

  wrapper.innerHTML = `
    <div class="custom-select-wrapper" id="modelWrapper">
      <button class="custom-select-trigger" id="modelTrigger" type="button" aria-haspopup="listbox" aria-expanded="false">
        <span class="custom-select-icon" style="font-size:15px;">${active.badge.split(' ')[0]}</span>
        <span class="custom-select-label" id="modelLabel">${active.badge} ${active.label}</span>
        <span class="custom-select-arrow"><i data-lucide="chevron-down"></i></span>
      </button>
      <ul class="custom-select-dropdown" id="modelDropdown" role="listbox">
        ${GROQ_MODELS.map(m => `
          <li class="custom-select-option${m.id === saved ? ' selected' : ''}" data-model="${m.id}" role="option">
            <span class="option-emoji">${m.badge.split(' ')[0]}</span>
            <span class="option-text">${m.badge.split(' ').slice(1).join(' ')} ${m.label}</span>
            <span class="option-check"><i data-lucide="check"></i></span>
          </li>
        `).join('')}
      </ul>
    </div>
  `;

  if (window.lucide) lucide.createIcons();

  const trigger  = document.getElementById('modelTrigger');
  const dropdown = document.getElementById('modelDropdown');
  const label    = document.getElementById('modelLabel');

  trigger.addEventListener('click', () => {
    const isOpen = dropdown.classList.contains('open');
    dropdown.classList.toggle('open', !isOpen);
    trigger.setAttribute('aria-expanded', String(!isOpen));
    if (window.lucide) lucide.createIcons();
  });

  dropdown.querySelectorAll('.custom-select-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const modelId = opt.dataset.model;
      const model   = GROQ_MODELS.find(m => m.id === modelId);
      localStorage.setItem('groq_model', modelId);
      dropdown.querySelectorAll('.custom-select-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      label.textContent = `${model.badge} ${model.label}`;
      trigger.querySelector('.custom-select-icon').textContent = model.badge.split(' ')[0];
      dropdown.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      if (window.lucide) lucide.createIcons();
    });
  });

  document.addEventListener('click', (e) => {
    const modelWrapper = document.getElementById('modelWrapper');
    if (modelWrapper && !modelWrapper.contains(e.target)) {
      dropdown.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
}

// ─────────────────────────────────────────────────────────────
//  ONBOARDING — modal passo a passo para novos usuários
// ─────────────────────────────────────────────────────────────

function initOnboarding() {
  // Só abre se não tiver API key salva (usuário realmente novo)
  const hasApi  = !!localStorage.getItem('groq_api_key');
  const hasName = !!localStorage.getItem('agent_nickname');
  if (hasApi && hasName) return;

  const overlay = document.createElement('div');
  overlay.id = 'onboardingOverlay';
  overlay.className = 'onb-overlay';
  overlay.innerHTML = `
    <div class="onb-modal" id="onbModal">
      <!-- Progresso -->
      <div class="onb-progress">
        <div class="onb-progress-bar" id="onbBar"></div>
      </div>

      <!-- Passo 1 — Boas-vindas -->
      <div class="onb-step" id="onbStep1">
        <div class="onb-icon">🚀</div>
        <h2 class="onb-title">Bem-vindo ao AgentPro!</h2>
        <p class="onb-desc">Seu assistente pessoal com IA para organizar a agenda por texto ou voz. Vamos configurar tudo em 3 passos rápidos.</p>
        <div class="onb-feature-list">
          <div class="onb-feature"><span>📅</span><span>Agenda inteligente com IA</span></div>
          <div class="onb-feature"><span>🎙️</span><span>Comandos por voz</span></div>
          <div class="onb-feature"><span>🔔</span><span>Lembretes automáticos</span></div>
        </div>
        <button class="onb-btn-primary" id="onbStart">Começar configuração →</button>
        <button class="onb-btn-skip" id="onbSkip1">Já conheço, pular</button>
      </div>

      <!-- Passo 2 — API Key -->
      <div class="onb-step onb-hidden" id="onbStep2">
        <div class="onb-step-num">Passo 1 de 2</div>
        <div class="onb-icon">🔑</div>
        <h2 class="onb-title">Chave API Groq</h2>
        <p class="onb-desc">O AgentPro usa a IA da Groq — rápida e gratuita. Crie sua chave em <a href="https://console.groq.com/keys" target="_blank" rel="noopener" class="onb-link">console.groq.com/keys</a> (leva ~30 segundos).</p>
        <div class="onb-input-wrap">
          <input type="password" id="onbApiInput" class="onb-input" placeholder="Cole sua chave aqui: gsk_…" autocomplete="off">
          <button class="onb-eye-btn" id="onbEyeBtn" type="button">👁️</button>
        </div>
        <p class="onb-hint" id="onbApiHint"></p>
        <button class="onb-btn-primary" id="onbApiNext">Confirmar chave →</button>
        <button class="onb-btn-skip" id="onbSkip2">Configurar depois</button>
      </div>

      <!-- Passo 3 — Nome -->
      <div class="onb-step onb-hidden" id="onbStep3">
        <div class="onb-step-num">Passo 2 de 2</div>
        <div class="onb-icon">👤</div>
        <h2 class="onb-title">Como quer ser chamado?</h2>
        <p class="onb-desc">O agente vai usar seu nome nas mensagens para deixar tudo mais pessoal.</p>
        <input type="text" id="onbNameInput" class="onb-input" placeholder="Ex: João, Chefe, Capitão…" maxlength="30" autocomplete="off">
        <p class="onb-hint" id="onbNameHint"></p>
        <button class="onb-btn-primary" id="onbNameNext">Quase lá →</button>
        <button class="onb-btn-skip" id="onbSkip3">Pular</button>
      </div>

      <!-- Passo 4 — Pronto -->
      <div class="onb-step onb-hidden" id="onbStep4">
        <div class="onb-icon onb-icon-success">✅</div>
        <h2 class="onb-title">Tudo pronto!</h2>
        <p class="onb-desc" id="onbFinalMsg">Configuração concluída. Agora é só mandar mensagem para o agente ou adicionar tarefas na barra lateral.</p>
        <div class="onb-tip-box">
          <strong>💡 Dica rápida</strong>
          <p>Tente dizer: <em>"Adiciona reunião amanhã às 10h"</em></p>
        </div>
        <button class="onb-btn-primary" id="onbFinish">Abrir o AgentPro 🚀</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  let currentStep = 1;

  function setBar(pct) {
    document.getElementById('onbBar').style.width = pct + '%';
  }

  function goTo(step) {
    document.getElementById(`onbStep${currentStep}`).classList.add('onb-hidden');
    currentStep = step;
    document.getElementById(`onbStep${currentStep}`).classList.remove('onb-hidden');
    const bars = { 1: 0, 2: 33, 3: 66, 4: 100 };
    setBar(bars[step] || 0);
  }

  function finish() {
    localStorage.setItem('onboarding_done', '1');
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 400);
  }

  // Step 1
  document.getElementById('onbStart').addEventListener('click', () => goTo(2));
  document.getElementById('onbSkip1').addEventListener('click', () => { finish(); });

  // Step 2 — API key
  const onbEye = document.getElementById('onbEyeBtn');
  const onbApiInput = document.getElementById('onbApiInput');
  onbEye.addEventListener('click', () => {
    const isHidden = onbApiInput.type === 'password';
    onbApiInput.type = isHidden ? 'text' : 'password';
    onbEye.textContent = isHidden ? '🙈' : '👁️';
  });

  // Pre-fill if already saved
  const existingApi = localStorage.getItem('groq_api_key');
  if (existingApi) onbApiInput.value = existingApi;

  document.getElementById('onbApiNext').addEventListener('click', () => {
    const val = onbApiInput.value.trim();
    const hint = document.getElementById('onbApiHint');
    if (!val) { hint.textContent = '⚠️ Cole sua chave para continuar, ou clique em "Configurar depois".'; hint.className = 'onb-hint onb-hint-error'; return; }
    if (!val.startsWith('gsk_')) { hint.textContent = '⚠️ Chaves Groq começam com gsk_. Verifique e tente novamente.'; hint.className = 'onb-hint onb-hint-error'; return; }
    localStorage.setItem('groq_api_key', val);
    // Atualiza o campo da sidebar também
    const sidebarInput = document.getElementById('apiKeyInput');
    if (sidebarInput) { sidebarInput.value = val; sidebarInput.dispatchEvent(new Event('input')); }
    hint.textContent = '✅ Chave salva!';
    hint.className = 'onb-hint onb-hint-ok';
    setTimeout(() => goTo(3), 600);
  });
  document.getElementById('onbSkip2').addEventListener('click', () => goTo(3));

  // Step 3 — Name
  const existingName = localStorage.getItem('agent_nickname') || window._agentUserName || '';
  if (existingName) document.getElementById('onbNameInput').value = existingName;

  function confirmOnbName() {
    const val = document.getElementById('onbNameInput').value.trim();
    const hint = document.getElementById('onbNameHint');
    if (!val) { hint.textContent = '⚠️ Digite um nome ou clique em "Pular".'; hint.className = 'onb-hint onb-hint-error'; return; }
    localStorage.setItem('agent_nickname', val);
    window._agentUserName = val;
    // Atualiza sidebar
    const sidebarInput = document.getElementById('userNickname');
    if (sidebarInput) sidebarInput.value = val;
    const savedBlock = document.getElementById('nicknameSavedBlock');
    const inputBlock = document.getElementById('nicknameInputBlock');
    const savedLabel = document.getElementById('nicknameSavedLabel');
    if (savedLabel) savedLabel.textContent = val;
    if (savedBlock) savedBlock.style.display = 'flex';
    if (inputBlock) inputBlock.style.display = 'none';
    const finalMsg = document.getElementById('onbFinalMsg');
    if (finalMsg) finalMsg.textContent = `Tudo configurado, ${val}! Agora é só mandar mensagem para o agente ou adicionar tarefas na barra lateral.`;
    goTo(4);
  }
  document.getElementById('onbNameNext').addEventListener('click', confirmOnbName);
  document.getElementById('onbNameInput').addEventListener('keypress', e => { if (e.key === 'Enter') confirmOnbName(); });
  document.getElementById('onbSkip3').addEventListener('click', () => goTo(4));

  // Step 4
  document.getElementById('onbFinish').addEventListener('click', () => {
    finish();
    // Dispara mensagem de boas-vindas no chat se vazio
    const name = localStorage.getItem('agent_nickname') || '';
    const personality = localStorage.getItem('agent_personality_modern') || 'motivacional';
    if (chatHistory.filter(m => m.role === 'user').length === 0) {
      const msgs = {
        motivacional: `🔥 E AÍ${name ? ', ' + name.toUpperCase() : ''}! Pronto pra DOMINAR o dia? Me fala o que quer agendar!`,
        sarcastico:   `😼 ${name || 'Usuário'}, bem-vindo. O que vamos procrastinar hoje?`,
        militar:      `⚔️ Soldado ${name || ''}! Relatório de agenda aguardado. Qual é a missão?`,
        gentil:       `🌸 Olá${name ? ', ' + name : ''}! Que bom ter você aqui. Como posso ajudar?`
      };
      document.getElementById('chatBox').innerHTML = '';
      appendMessage(msgs[personality] || msgs.motivacional, 'agent');
    }
  });
}

// ─────────────────────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  showAgendaLoading();

  const { tasks: firestoreTasks, user } = await initAuth();
  tasks = firestoreTasks;
  window._agentUserName = user.displayName || user.email.split('@')[0];

  // ── Sync em tempo real via onSnapshot ──
  // Quando outra aba ou dispositivo altera tarefas no Firestore,
  // o array local é atualizado automaticamente e a UI re-renderiza.
  subscribeToTasks((updatedTasks) => {
    tasks = updatedTasks;
    renderTasks();
    updateTaskStats();
    syncTasksToSW(); // mantém o SW sempre com a lista mais recente
  });

  // Envia a lista inicial ao SW (necessário para notificações com app fechado)
  await checkNotificationPermission();
  syncTasksToSW();
  if (!localStorage.getItem('agent_nickname')) {
    document.getElementById('userNickname').value = window._agentUserName;
  }

  // #25 — Respeita prefers-color-scheme na primeira visita
  const savedTheme = localStorage.getItem('theme');
  let currentTheme = savedTheme
    ? savedTheme
    : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  setTheme(currentTheme);

  // Monitora mudança do sistema em tempo real (só se o usuário nunca escolheu manualmente)
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
    if (!localStorage.getItem('theme')) {
      currentTheme = e.matches ? 'light' : 'dark';
      setTheme(currentTheme);
    }
  });

  document.getElementById('personality').value  = localStorage.getItem('agent_personality_modern') || 'motivacional';
  document.getElementById('userNickname').value = localStorage.getItem('agent_nickname') || window._agentUserName || '';

  // Aplica o tema visual da personalidade salva
  setPersonality(localStorage.getItem('agent_personality_modern') || 'motivacional');

  // Load chat history
  chatHistory = await loadChatHistory();
  if (chatHistory.length > 0) {
    chatHistory.forEach(msg => {
      if (msg.role === 'user') appendMessage(msg.content, 'user');
      else if (msg.role === 'assistant' && msg.content) appendMessage(msg.content, 'agent');
    });
  } else {
    const savedPersonality = localStorage.getItem('agent_personality_modern') || 'motivacional';
    const welcomeMessages = {
      motivacional: `🔥 E AÍ, ${window._agentUserName?.toUpperCase() || 'CAMPEÃO'}! Pronto pra DOMINAR o dia? Me fala o que quer agendar e vamos nessa!`,
      sarcastico:   `😼 Olha quem apareceu. ${window._agentUserName || 'Usuário'}, vejo que você abriu o app em vez de procrastinar no celular. Progresso. Qual tarefa você vai ignorar hoje?`,
      militar:      `⚔️ Soldado ${window._agentUserName || ''}! Relatório de agenda aguardado. Qual é a missão do dia?`,
      gentil:       `🌸 Olá, ${window._agentUserName || ''}! Que bom ter você aqui. Respire fundo — vamos organizar seu dia com calma. Como posso ajudar?`
    };
    document.getElementById('chatBox').innerHTML = '';
    appendMessage(welcomeMessages[savedPersonality] || welcomeMessages.motivacional, 'agent');
  }

  // #11 Load agent memory
  agentMemory = await loadAgentMemory();

  renderTasks();
  initMic();
  initCustomSelect();
  initApiKey();
  initNickname();
  initModelSelector();
  initOnboarding(); // #22
  initAccentColor();
  initNotifButton();

  // ── Event listeners ──
  document.getElementById('themeToggle').addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', currentTheme); // #25 — grava como escolha manual
    setTheme(currentTheme);
  });

  document.getElementById('addTaskBtn').addEventListener('click', () => addTask(''));
  document.getElementById('sendBtn').addEventListener('click', sendMessage);

  // #9 Export ICS button
  document.getElementById('exportIcsBtn')?.addEventListener('click', exportICS);

  // Edit modal
  document.getElementById('editClose').addEventListener('click', closeEditModal);
  document.getElementById('editSaveBtn').addEventListener('click', saveEdit);
  document.getElementById('editOverlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('editOverlay')) closeEditModal();
  });
  document.getElementById('editTaskTitle').addEventListener('keypress', (e) => { if (e.key === 'Enter') saveEdit(); });

  // Drag-to-dismiss no edit modal
  (function setupEditDrag() {
    const overlay = document.getElementById('editOverlay');
    const modal   = document.getElementById('editModal');
    let startY = 0, currentY = 0, dragging = false;
    function onStart(e) {
      if (!overlay.classList.contains('open')) return;
      startY = e.touches ? e.touches[0].clientY : e.clientY;
      currentY = 0; dragging = true;
      modal.classList.add('dragging');
    }
    function onMove(e) {
      if (!dragging) return;
      const y = (e.touches ? e.touches[0].clientY : e.clientY) - startY;
      if (y < 0) return;
      currentY = y;
      modal.style.transform = `translateY(${y}px)`;
      const ratio = Math.max(0, 1 - y / (modal.offsetHeight * 0.6));
      overlay.style.background = `rgba(0,0,0,${(0.65 * ratio).toFixed(2)})`;
    }
    function onEnd() {
      if (!dragging) return;
      dragging = false; modal.classList.remove('dragging');
      overlay.style.background = '';
      if (currentY > modal.offsetHeight * 0.32) {
        closeEditModal();
      } else {
        modal.style.transform = 'translateY(0)';
      }
    }
    const handle = modal.querySelector('.sheet-drag-area') || modal;
    handle.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove',  onMove, { passive: true });
    document.addEventListener('touchend',   onEnd);
    handle.addEventListener('mousedown',  onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onEnd);
  })();

  // FAB modal — bottom sheet com drag-to-dismiss
  const fabBtn     = document.getElementById('fabBtn');
  const fabOverlay = document.getElementById('fabOverlay');
  const fabModal   = document.getElementById('fabModal');

  function openFab() {
    fabOverlay.classList.add('open');
    fabBtn.classList.add('open');
    setTimeout(() => document.getElementById('fabTaskTitle').focus(), 320);
  }
  function closeFab(instant) {
    if (instant) {
      fabModal.style.transition = 'none';
      fabModal.style.transform  = 'translateY(110%)';
      fabOverlay.classList.remove('open');
      setTimeout(() => { fabModal.style.transition = ''; fabModal.style.transform = ''; }, 50);
    } else {
      fabModal.style.transform = 'translateY(110%)';
      setTimeout(() => {
        fabOverlay.classList.remove('open');
        fabModal.style.transform = '';
      }, 380);
    }
    fabBtn.classList.remove('open');
  }

  // Drag-to-dismiss
  (function setupSheetDrag(overlay, modal, closeFn) {
    let startY = 0, currentY = 0, dragging = false;

    function onStart(e) {
      if (!overlay.classList.contains('open')) return;
      startY  = e.touches ? e.touches[0].clientY : e.clientY;
      currentY = 0;
      dragging = true;
      modal.classList.add('dragging');
    }
    function onMove(e) {
      if (!dragging) return;
      const y = (e.touches ? e.touches[0].clientY : e.clientY) - startY;
      if (y < 0) return; // não deixa subir
      currentY = y;
      modal.style.transform = `translateY(${y}px)`;
      // escurece o overlay proporcionalmente
      const ratio = Math.max(0, 1 - y / (modal.offsetHeight * 0.6));
      overlay.style.background = `rgba(0,0,0,${(0.65 * ratio).toFixed(2)})`;
    }
    function onEnd() {
      if (!dragging) return;
      dragging = false;
      modal.classList.remove('dragging');
      overlay.style.background = '';
      const threshold = modal.offsetHeight * 0.32;
      if (currentY > threshold) {
        modal.style.transform = `translateY(${modal.offsetHeight}px)`;
        setTimeout(() => {
          overlay.classList.remove('open');
          modal.style.transform = '';
        }, 320);
        if (typeof fabBtn !== 'undefined') fabBtn.classList.remove('open');
      } else {
        modal.style.transform = 'translateY(0)';
      }
    }

    const dragArea = modal.querySelector('.sheet-drag-area');
    const handle   = dragArea || modal;
    handle.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove',  onMove,  { passive: true });
    document.addEventListener('touchend',   onEnd);
    handle.addEventListener('mousedown',  onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onEnd);
  })(fabOverlay, fabModal, closeFab);

  fabBtn.addEventListener('click', () => fabOverlay.classList.contains('open') ? closeFab() : openFab());
  document.getElementById('fabClose').addEventListener('click', () => closeFab());
  fabOverlay.addEventListener('click', (e) => { if (e.target === fabOverlay) closeFab(); });
  document.getElementById('fabAddBtn').addEventListener('click', () => {
    const title = document.getElementById('fabTaskTitle').value.trim();
    const dt    = document.getElementById('fabTaskDatetime')?.value;
    let date = new Date().toISOString().slice(0, 10), time = '00:00';
    if (dt) { [date, time] = dt.split('T'); }
    else {
      date = document.getElementById('fabTaskDate')?.value || date;
      time = document.getElementById('fabTaskTime')?.value || time;
    }
    if (!title || !time) return;
    document.getElementById('taskTitle').value = title;
    document.getElementById('taskDate').value  = date;
    document.getElementById('taskTime').value  = time;
    addTask('');
    document.getElementById('fabTaskTitle').value = '';
    const dtEl = document.getElementById('fabTaskDatetime');
    if (dtEl) dtEl.value = '';
    closeFab();
  });
  document.getElementById('fabTaskTitle').addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('fabAddBtn').click(); });

  document.getElementById('personality').addEventListener('change', (e) => {
    localStorage.setItem('agent_personality_modern', e.target.value);
    setPersonality(e.target.value);
    if (chatHistory.filter(m => m.role === 'user').length === 0) {
      const welcomeMessages = {
        motivacional: `🔥 E AÍ, ${window._agentUserName?.toUpperCase() || 'CAMPEÃO'}! Pronto pra DOMINAR o dia?`,
        sarcastico:   `😼 Olha quem apareceu. ${window._agentUserName || 'Usuário'}, qual tarefa vamos ignorar hoje?`,
        militar:      `⚔️ Soldado ${window._agentUserName || ''}! Aguardando ordens.`,
        gentil:       `🌸 Olá, ${window._agentUserName || ''}! Como posso ajudar?`
      };
      chatHistory = [];
      document.getElementById('chatBox').innerHTML = '';
      appendMessage(welcomeMessages[e.target.value] || welcomeMessages.motivacional, 'agent');
    }
  });

  document.getElementById('chatInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

  // #23 — Atalhos de teclado globais
  document.addEventListener('keydown', (e) => {
    // Esc — fecha qualquer modal aberto
    if (e.key === 'Escape') {
      const statsOverlay = document.getElementById('statsModalOverlay');
      if (statsOverlay && statsOverlay.classList.contains('open')) {
        statsOverlay.classList.remove('open'); return;
      }
      if (document.getElementById('editOverlay').classList.contains('open')) {
        closeEditModal(); return;
      }
      if (document.getElementById('fabOverlay').classList.contains('open')) {
        document.getElementById('fabOverlay').classList.remove('open');
        document.getElementById('fabBtn').classList.remove('open'); return;
      }
      const onboard = document.getElementById('onboardingOverlay');
      if (onboard && onboard.classList.contains('open')) {
        onboard.classList.remove('open'); return;
      }
    }
    // Ctrl/Cmd + Enter — envia mensagem do chat
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendMessage(); return;
    }
    // Ctrl/Cmd + K — foca o campo de busca de tarefas
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const s = document.getElementById('taskSearchInput');
      if (s) { s.focus(); s.select(); } return;
    }
    // Ctrl/Cmd + N — foca o campo de nova tarefa
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      const t = document.getElementById('taskTitle');
      if (t) { t.focus(); t.select(); } return;
    }
  });

  // Agenda filter tabs
  document.querySelectorAll('.agenda-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.agenda-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      updateAgendaTitle();
      renderTasks();
    });
  });

  // #6 Search input
  const searchInput = document.getElementById('taskSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderTasks();
    });
  }

  // ── Pull-to-refresh ──────────────────────────────────────────
  (function setupPullToRefresh() {
    const list      = document.getElementById('taskList');
    const indicator = document.getElementById('ptrIndicator');
    const label     = document.getElementById('ptrLabel');
    const arrow     = document.getElementById('ptrArrow');
    const spinner   = document.getElementById('ptrSpinner');
    const iconWrap  = indicator?.querySelector('.ptr-icon-wrap');
    if (!list || !indicator) return;

    const THRESHOLD  = 72;   // px para disparar o refresh
    const MAX_PULL   = 100;  // px máximo de deslocamento visual
    let startY       = 0;
    let pulling      = false;
    let refreshing   = false;
    let currentPull  = 0;

    function setPull(y) {
      currentPull = Math.min(y, MAX_PULL);
      const ratio    = Math.min(currentPull / THRESHOLD, 1);
      const showPx   = currentPull - 56; // indicador começa a aparecer depois de 56px
      const indY     = Math.min(showPx, 0);  // sobe de -100% para 0
      const listY    = Math.max(currentPull - 0, 0);

      indicator.style.transform = `translateY(calc(-100% + ${Math.max(currentPull, 0)}px))`;
      list.style.transform      = `translateY(${listY * 0.45}px)`;

      if (currentPull >= THRESHOLD) {
        label.textContent = 'Solte para atualizar';
        iconWrap?.classList.add('ptr-ready');
      } else {
        label.textContent = 'Puxe para atualizar';
        iconWrap?.classList.remove('ptr-ready');
      }
    }

    function doRefresh() {
      refreshing = true;
      // mostra indicador fixo
      indicator.classList.add('ptr-snap', 'ptr-visible');
      indicator.style.transform = '';
      list.classList.add('ptr-snap');
      list.style.transform = 'translateY(56px)';

      // troca seta por spinner
      arrow.style.display   = 'none';
      spinner.style.display = 'block';
      label.textContent     = 'Atualizando…';

      // vibração háptica
      if (navigator.vibrate) navigator.vibrate(10);

      // re-render das tarefas (inclui re-sync se houver Firebase)
      setTimeout(() => {
        renderTasks();
        if (window.lucide) lucide.createIcons();

        // fecha o indicador
        list.style.transform = '';
        indicator.classList.remove('ptr-visible');

        setTimeout(() => {
          indicator.classList.remove('ptr-snap');
          list.classList.remove('ptr-snap');
          arrow.style.display   = '';
          spinner.style.display = 'none';
          label.textContent     = 'Puxe para atualizar';
          iconWrap?.classList.remove('ptr-ready');
          refreshing = false;
        }, 300);
      }, 700);
    }

    list.addEventListener('touchstart', (e) => {
      if (refreshing || list.scrollTop > 0) return;
      startY  = e.touches[0].clientY;
      pulling = true;
      list.classList.add('ptr-pulled');
      indicator.classList.remove('ptr-snap');
    }, { passive: true });

    list.addEventListener('touchmove', (e) => {
      if (!pulling || refreshing) return;
      if (list.scrollTop > 0) { pulling = false; setPull(0); return; }
      const delta = e.touches[0].clientY - startY;
      if (delta <= 0) { pulling = false; setPull(0); return; }
      setPull(delta);
    }, { passive: true });

    list.addEventListener('touchend', () => {
      if (!pulling || refreshing) return;
      pulling = false;
      list.classList.remove('ptr-pulled');

      if (currentPull >= THRESHOLD) {
        doRefresh();
      } else {
        // snap de volta sem refresh
        indicator.classList.add('ptr-snap');
        list.classList.add('ptr-snap');
        indicator.style.transform = '';
        list.style.transform      = '';
        iconWrap?.classList.remove('ptr-ready');
        setTimeout(() => {
          indicator.classList.remove('ptr-snap');
          list.classList.remove('ptr-snap');
        }, 300);
      }
      currentPull = 0;
    });
  })();
});