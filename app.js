// Registro do Service Worker (PWA)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(() => console.log("AgentPro: PWA Ativo!"))
        .catch(err => console.error("Erro SW:", err));
}

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

let tasks = JSON.parse(localStorage.getItem('tasks_modern')) || [];

// ─── Chat history (mantém contexto entre turnos) ───
let chatHistory = [];

// ─── Active filter state ───
let activeFilter = 'today';

const filterConfig = {
    today:    { label: 'Agenda de Hoje',      icon: 'calendar-check' },
    tomorrow: { label: 'Agenda de Amanhã',    icon: 'calendar-clock' },
    week:     { label: 'Próximos 7 Dias',     icon: 'calendar-range' },
    all:      { label: 'Toda a Agenda',       icon: 'calendar' },
};

const personalities = {
    motivacional: "Você é um Coach motivacional épico. Use gritos de guerra, emojis de fogo 🔥 e motive o usuário a aniquilar as tarefas!",
    sarcastico: "Você é um assistente extremamente irônico, realista e sarcástico. Critique a procrastinação do usuário com humor ácido. 😼",
    militar: "Você é um comandante tático. Dê ordens curtas, diretas e sem enrolação. Foco na missão! 🪖",
    gentil: "Você é um assistente calmo, zen e acolhedor. Ajude o usuário a se organizar sem pressa ou ansiedade, com positividade. 🌸"
};

function updateApiUI() {
    const saved = localStorage.getItem('groq_key_modern');
    const apiInputBlock = document.getElementById('apiInputBlock');
    const apiSavedBlock = document.getElementById('apiSavedBlock');
    if (saved) {
        apiInputBlock.style.display = 'none';
        apiSavedBlock.style.display = 'flex';
    } else {
        apiInputBlock.style.display = 'block';
        apiSavedBlock.style.display = 'none';
    }
}

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
    tasks.forEach(t => { if (!t.date) t.date = today; });

    const range = getDateRange(filter);
    if (!range.from && !range.to) return [...tasks];

    return tasks.filter(t => {
        const d = t.date || today;
        return d >= range.from && d <= range.to;
    });
}

function updateTaskStats() {
    const count = tasks.length;
    const filtered = filterTasks(activeFilter);
    const badge = document.getElementById('taskBadge');
    const stat  = document.getElementById('statTaskCount');
    if (badge) badge.textContent = filtered.length;
    if (stat)  stat.textContent  = count + (count === 1 ? ' tarefa' : ' tarefas');
}

document.addEventListener('DOMContentLoaded', () => {
    let currentTheme = localStorage.getItem('theme') || 'dark';
    setTheme(currentTheme);

    document.getElementById('apiKey').value = localStorage.getItem('groq_key_modern') || '';
    document.getElementById('personality').value = localStorage.getItem('agent_personality_modern') || 'motivacional';
    updateApiUI();
    renderTasks();

    document.getElementById('themeToggle').addEventListener('click', () => {
        currentTheme = currentTheme === 'light' ? 'dark' : 'light';
        setTheme(currentTheme);
    });

    document.getElementById('saveApiBtn').addEventListener('click', () => {
        const key = document.getElementById('apiKey').value.trim();
        if (!key) { alert('Cole sua chave da API primeiro.'); return; }
        localStorage.setItem('groq_key_modern', key);
        updateApiUI();
    });

    document.getElementById('changeApiBtn').addEventListener('click', () => {
        localStorage.removeItem('groq_key_modern');
        document.getElementById('apiKey').value = '';
        updateApiUI();
    });

    document.getElementById('addTaskBtn').addEventListener('click', addTask);
    document.getElementById('sendBtn').addEventListener('click', sendMessage);

    // ─── Edit modal ───
    document.getElementById('editClose').addEventListener('click', closeEditModal);
    document.getElementById('editSaveBtn').addEventListener('click', saveEdit);
    document.getElementById('editOverlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('editOverlay')) closeEditModal();
    });
    document.getElementById('editTaskTitle').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') saveEdit();
    });

    // ─── FAB modal ───
    const fabBtn     = document.getElementById('fabBtn');
    const fabOverlay = document.getElementById('fabOverlay');
    const fabModal   = document.getElementById('fabModal');

    function openFab() {
        fabOverlay.classList.add('open');
        fabBtn.classList.add('open');
        setTimeout(() => document.getElementById('fabTaskTitle').focus(), 320);
    }
    function closeFab() {
        fabOverlay.classList.remove('open');
        fabBtn.classList.remove('open');
    }

    fabBtn.addEventListener('click', () => {
        fabOverlay.classList.contains('open') ? closeFab() : openFab();
    });
    document.getElementById('fabClose').addEventListener('click', closeFab);
    fabOverlay.addEventListener('click', (e) => { if (e.target === fabOverlay) closeFab(); });

    document.getElementById('fabAddBtn').addEventListener('click', () => {
        const title = document.getElementById('fabTaskTitle').value.trim();
        const time  = document.getElementById('fabTaskTime').value;
        const date  = document.getElementById('fabTaskDate').value || new Date().toISOString().slice(0, 10);
        if (!title || !time) return;

        // Reuse addTask logic by temporarily filling sidebar fields
        document.getElementById('taskTitle').value = title;
        document.getElementById('taskTime').value  = time;
        document.getElementById('taskDate').value  = date;
        addTask();

        // Clear FAB fields and close
        document.getElementById('fabTaskTitle').value = '';
        document.getElementById('fabTaskTime').value  = '';
        document.getElementById('fabTaskDate').value  = '';
        closeFab();
    });

    document.getElementById('fabTaskTitle').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('fabAddBtn').click();
    });

    document.getElementById('apiKey').addEventListener('change', (e) => localStorage.setItem('groq_key_modern', e.target.value));
    document.getElementById('personality').addEventListener('change', (e) => localStorage.setItem('agent_personality_modern', e.target.value));

    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // ─── Microfone / reconhecimento de voz ───
    initMic();

    // ─── Agenda filter tabs ───
    document.querySelectorAll('.agenda-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.agenda-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.dataset.filter;
            updateAgendaTitle();
            renderTasks();
        });
    });
});

function updateAgendaTitle() {
    const cfg = filterConfig[activeFilter];
    const titleEl = document.getElementById('agendaTitle');
    if (titleEl) titleEl.textContent = cfg.label;
}

function addTask() {
    const titleInput = document.getElementById('taskTitle');
    const timeInput  = document.getElementById('taskTime');
    const dateInput  = document.getElementById('taskDate');
    const title = titleInput.value.trim();
    const time  = timeInput.value;
    const date  = dateInput.value || new Date().toISOString().slice(0, 10);
    if (!title || !time) return;

    const newTask = { id: Date.now(), title, time, date, notified: false, completed: false };
    tasks.push(newTask);
    localStorage.setItem('tasks_modern', JSON.stringify(tasks));
    titleInput.value = '';
    timeInput.value  = '';
    dateInput.value  = '';

    // Switch to the relevant tab automatically
    const today    = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const in7days  = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    let targetFilter = 'all';
    if (date === today)           targetFilter = 'today';
    else if (date === tomorrow)   targetFilter = 'tomorrow';
    else if (date <= in7days)     targetFilter = 'week';

    // Switch tab if needed
    document.querySelectorAll('.agenda-tab').forEach(b => {
        const match = b.dataset.filter === targetFilter;
        b.classList.toggle('active', match);
    });
    activeFilter = targetFilter;
    updateAgendaTitle();

    renderTasks();
    updateTaskStats();
    checkNotificationPermission();

    // Flash feedback on the new task
    setTimeout(() => {
        const cards = document.querySelectorAll('.task-card');
        if (cards.length) {
            const last = [...cards].find(c => c.dataset.id == newTask.id);
            if (last) last.classList.add('task-new');
        }
    }, 50);
}

function formatDate(dateStr) {
    if (!dateStr) return 'Hoje';
    const today    = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (dateStr === today)    return 'Hoje';
    if (dateStr === tomorrow) return 'Amanhã';
    const [y, m, d] = dateStr.split('-');
    // Add day-of-week for nearby dates
    const dateObj = new Date(dateStr + 'T12:00:00');
    const dow = dateObj.toLocaleDateString('pt-BR', { weekday: 'short' });
    return `${dow}, ${d}/${m}/${y}`;
}

function getDateStatus(dateStr) {
    const today    = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (dateStr < today)    return 'past';
    if (dateStr === today)  return 'today';
    if (dateStr === tomorrow) return 'tomorrow';
    return 'future';
}

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

    const today = new Date().toISOString().slice(0, 10);

    // Sort by date then time
    const sorted = [...filtered].sort((a, b) => {
        const dateCmp = (a.date || today).localeCompare(b.date || today);
        return dateCmp !== 0 ? dateCmp : a.time.localeCompare(b.time);
    });

    // Group by date
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

        const statusBadge = {
            past:     '<span class="date-status-badge past">Passado</span>',
            today:    '<span class="date-status-badge today">Hoje</span>',
            tomorrow: '<span class="date-status-badge tomorrow">Amanhã</span>',
            future:   '<span class="date-status-badge future">Em breve</span>',
        }[status] || '';

        header.innerHTML = `
            <div class="date-header-left">
                <span class="date-header-label">${formatDate(dateKey)}</span>
                ${statusBadge}
            </div>
            <span class="task-date-count">${group.length}</span>`;
        list.appendChild(header);

        group.forEach(task => {
            const card = document.createElement('div');
            card.className = `task-card status-${status}${task.completed ? ' completed' : ''}`;
            card.dataset.id = task.id;
            card.innerHTML = `
                <div class="task-left">
                    <button class="task-checkbox${task.completed ? ' checked' : ''}" onclick="toggleComplete(${task.id})" title="${task.completed ? 'Desmarcar' : 'Concluir'}">
                        <i data-lucide="check"></i>
                    </button>
                    <span class="time-badge">${task.time}</span>
                    <span class="task-title">${task.title}</span>
                </div>
                <div class="task-card-actions">
                    <button class="btn-edit" onclick="openEditModal(${task.id})" title="Editar tarefa">
                        <i data-lucide="pencil"></i>
                    </button>
                    <button class="btn-delete" onclick="deleteTask(${task.id})" title="Remover tarefa">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>`;
            list.appendChild(card);
        });
    });

    if (window.lucide) lucide.createIcons();
    updateTaskStats();
}

function deleteTask(id) {
    tasks = tasks.filter(t => t.id !== id);
    localStorage.setItem('tasks_modern', JSON.stringify(tasks));
    renderTasks();
}

function toggleComplete(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    task.completed = !task.completed;
    localStorage.setItem('tasks_modern', JSON.stringify(tasks));

    const card = document.querySelector(`.task-card[data-id="${id}"]`);
    if (card) {
        card.classList.add('completing');
        card.addEventListener('animationend', () => card.classList.remove('completing'), { once: true });
    }

    if (task.completed) launchConfetti();
    renderTasks();
}

// ─── Confetti ───
function launchConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#7c5cfc','#22d3ee','#10b981','#f59e0b','#f43f5e','#a78bfa','#34d399'];
    const pieces = Array.from({ length: 90 }, () => ({
        x: Math.random() * canvas.width,
        y: -10 - Math.random() * 80,
        w: 7 + Math.random() * 9,
        h: 5 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 4,
        vy: 2.5 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        rSpeed: (Math.random() - 0.5) * 0.18,
        opacity: 1
    }));

    let frame;
    let start = null;
    const DURATION = 2600;

    function draw(ts) {
        if (!start) start = ts;
        const elapsed = ts - start;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let alive = false;
        pieces.forEach(p => {
            p.x  += p.vx;
            p.y  += p.vy;
            p.vy += 0.07;
            p.rot += p.rSpeed;
            p.opacity = Math.max(0, 1 - (elapsed / DURATION));
            if (p.y < canvas.height + 20) alive = true;

            ctx.save();
            ctx.globalAlpha = p.opacity;
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        });

        if (alive && elapsed < DURATION + 600) {
            frame = requestAnimationFrame(draw);
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
}

// ─── Edit Modal ───
let editingTaskId = null;

function openEditModal(id) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    editingTaskId = id;
    document.getElementById('editTaskTitle').value = task.title;
    document.getElementById('editTaskDate').value  = task.date || '';
    document.getElementById('editTaskTime').value  = task.time || '';
    document.getElementById('editOverlay').classList.add('open');
    setTimeout(() => document.getElementById('editTaskTitle').focus(), 300);
}

function closeEditModal() {
    document.getElementById('editOverlay').classList.remove('open');
    editingTaskId = null;
}

function saveEdit() {
    if (!editingTaskId) return;
    const title = document.getElementById('editTaskTitle').value.trim();
    const date  = document.getElementById('editTaskDate').value;
    const time  = document.getElementById('editTaskTime').value;
    if (!title || !time) return;

    const task = tasks.find(t => t.id === editingTaskId);
    if (task) {
        task.title = title;
        task.date  = date || new Date().toISOString().slice(0, 10);
        task.time  = time;
        localStorage.setItem('tasks_modern', JSON.stringify(tasks));
    }
    closeEditModal();
    renderTasks();
}

// ─── Tool: add task from chat ───
function addTaskFromChat({ title, date, time }) {
    const today = new Date().toISOString().slice(0, 10);
    const taskDate = date || today;
    const taskTime = time || '00:00';

    const newTask = { id: Date.now(), title, time: taskTime, date: taskDate, notified: false, completed: false };
    tasks.push(newTask);
    localStorage.setItem('tasks_modern', JSON.stringify(tasks));

    // Switch to the relevant tab automatically
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const in7days  = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    let targetFilter = 'all';
    if (taskDate === today)         targetFilter = 'today';
    else if (taskDate === tomorrow) targetFilter = 'tomorrow';
    else if (taskDate <= in7days)   targetFilter = 'week';

    document.querySelectorAll('.agenda-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === targetFilter);
    });
    activeFilter = targetFilter;
    updateAgendaTitle();
    renderTasks();
    updateTaskStats();
    checkNotificationPermission();

    // Flash animation on new card
    setTimeout(() => {
        const cards = document.querySelectorAll('.task-card');
        const last  = [...cards].find(c => c.dataset.id == newTask.id);
        if (last) last.classList.add('task-new');
    }, 50);

    return newTask;
}

// ─── Tool: delete task from chat ───
function deleteTaskFromChat({ title }) {
    const lower = title.toLowerCase();
    const idx = tasks.findIndex(t => t.title.toLowerCase().includes(lower));
    if (idx === -1) return null;
    const removed = tasks.splice(idx, 1)[0];
    localStorage.setItem('tasks_modern', JSON.stringify(tasks));
    renderTasks();
    updateTaskStats();
    return removed;
}

// ─── Tradução de erros da API ───
function friendlyApiError(data, status) {
    if (status === 401) return "❌ Chave API inválida. Verifique se copiou corretamente na barra lateral.";
    if (status === 429) return "⏳ Limite de requisições atingido. Aguarde alguns segundos e tente novamente.";
    if (status === 503 || status === 500) return "🔧 O servidor da IA está instável. Tente novamente em instantes.";
    if (data?.error?.message) {
        // Mensagem bruta da Groq — traduzir os casos mais comuns
        const msg = data.error.message.toLowerCase();
        if (msg.includes('invalid api key') || msg.includes('auth'))
            return "❌ Chave API inválida. Verifique se copiou corretamente na barra lateral.";
        if (msg.includes('rate limit') || msg.includes('quota'))
            return "⏳ Limite de uso atingido. Aguarde alguns segundos e tente novamente.";
        if (msg.includes('model') && msg.includes('not'))
            return "🤖 Modelo não disponível no momento. Tente novamente em instantes.";
    }
    return "⚠️ Algo deu errado ao contatar a IA. Tente novamente.";
}

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const text  = input.value.trim();
    const apiKey = document.getElementById('apiKey').value;
    const personalityKey = document.getElementById('personality').value;

    if (!text) return;
    if (!apiKey) return alert("Configure sua Chave API na barra lateral.");

    appendMessage(text, 'user');
    input.value = '';

    // ── BUG FIX: adicionar mensagem ao histórico ──
    chatHistory.push({ role: "user", content: text });

    const today = new Date().toISOString().slice(0, 10);
    const futureTasks = tasks
        .filter(t => (t.date || today) >= today)
        .sort((a, b) => (a.date || today).localeCompare(b.date || today) || a.time.localeCompare(b.time));

    const agendaContexto = futureTasks.length
        ? futureTasks.map(t => `- [${formatDate(t.date || today)} ${t.time}] ${t.title}`).join('\n')
        : 'Nenhuma tarefa futura.';

    // Tool definitions
    const tools = [
        {
            type: "function",
            function: {
                name: "adicionar_tarefa",
                description: "Adiciona uma tarefa/evento/lembrete à agenda do usuário. Use quando o usuário pedir para adicionar, agendar, marcar, lembrar ou criar uma tarefa, reunião, compromisso ou evento.",
                parameters: {
                    type: "object",
                    properties: {
                        title: {
                            type: "string",
                            description: "Título claro e descritivo da tarefa ou evento."
                        },
                        date: {
                            type: "string",
                            description: `Data no formato YYYY-MM-DD. Hoje é ${today}. Interprete 'hoje', 'amanhã', dias da semana, etc. Se não informado, use hoje.`
                        },
                        time: {
                            type: "string",
                            description: "Horário no formato HH:MM (24h). Se não informado, use 00:00."
                        }
                    },
                    required: ["title", "date", "time"]
                }
            }
        },
        {
            type: "function",
            function: {
                name: "remover_tarefa",
                description: "Remove uma tarefa da agenda quando o usuário pedir para deletar, remover, cancelar ou excluir um item.",
                parameters: {
                    type: "object",
                    properties: {
                        title: {
                            type: "string",
                            description: "Parte do título da tarefa a ser removida."
                        }
                    },
                    required: ["title"]
                }
            }
        }
    ];

    // O systemPrompt é reconstruído a cada turno para ter a agenda sempre atualizada.
    // O histórico de mensagens (chatHistory) carrega o contexto conversacional.
    const systemPrompt = `${personalities[personalityKey]}

Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${today}).
Agenda atual do usuário:\n${agendaContexto}

Quando o usuário pedir para adicionar, agendar, marcar ou lembrar de algo, USE a função adicionar_tarefa.
Quando pedir para remover, cancelar ou excluir uma tarefa, USE a função remover_tarefa.
Interprete expressões como 'hoje', 'amanhã', 'segunda', 'próxima semana' corretamente.`;

    try {
        appendMessage("Consultando o agente…", 'agent', 'loading');

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "meta-llama/llama-4-scout-17b-16e-instruct",
                // BUG FIX: enviar histórico completo para manter contexto entre turnos
                messages: [
                    { role: "system", content: systemPrompt },
                    ...chatHistory
                ],
                tools,
                tool_choice: "auto"
            })
        });

        const data = await response.json();
        document.querySelector('.loading')?.remove();

        // BUG FIX: erros com mensagens amigáveis em português
        if (!response.ok || data.error) {
            const msg = friendlyApiError(data, response.status);
            appendMessage(msg, 'agent');
            // Remover a mensagem do usuário do histórico se a API falhou
            chatHistory.pop();
            return;
        }

        if (!data.choices || !data.choices[0]) {
            appendMessage("⚠️ Resposta inesperada da IA. Tente novamente.", 'agent');
            chatHistory.pop();
            return;
        }

        const choice  = data.choices[0];
        const message = choice.message;

        // ── Handle tool calls ──
        if (message.tool_calls && message.tool_calls.length > 0) {
            const toolResults = [];

            for (const toolCall of message.tool_calls) {
                const fnName = toolCall.function.name;
                let args;
                try { args = JSON.parse(toolCall.function.arguments); } catch { args = {}; }

                let resultContent = '';

                if (fnName === 'adicionar_tarefa') {
                    const task = addTaskFromChat(args);
                    resultContent = JSON.stringify({
                        sucesso: true,
                        tarefa: task.title,
                        data: task.date,
                        horario: task.time
                    });
                } else if (fnName === 'remover_tarefa') {
                    const removed = deleteTaskFromChat(args);
                    resultContent = JSON.stringify(
                        removed
                            ? { sucesso: true, tarefa_removida: removed.title }
                            : { sucesso: false, motivo: 'Tarefa não encontrada.' }
                    );
                }

                toolResults.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: resultContent
                });
            }

            // Second call so the AI can reply naturally — inclui histórico completo
            const followUp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "meta-llama/llama-4-scout-17b-16e-instruct",
                    messages: [
                        { role: "system",    content: systemPrompt },
                        ...chatHistory,
                        { role: "assistant", content: null, tool_calls: message.tool_calls },
                        ...toolResults
                    ]
                })
            });

            const followData = await followUp.json();

            if (!followUp.ok || followData.error) {
                const msg = friendlyApiError(followData, followUp.status);
                appendMessage(msg, 'agent');
                chatHistory.pop();
                return;
            }

            const reply = followData.choices?.[0]?.message?.content;
            const finalReply = reply || "Feito! ✅";
            appendMessage(finalReply, 'agent');

            // BUG FIX: registrar no histórico o turno completo (tool call + resposta final)
            chatHistory.push({ role: "assistant", content: null, tool_calls: message.tool_calls });
            toolResults.forEach(r => chatHistory.push(r));
            chatHistory.push({ role: "assistant", content: finalReply });

        } else {
            // Normal text reply
            appendMessage(message.content, 'agent');
            // BUG FIX: registrar resposta no histórico
            chatHistory.push({ role: "assistant", content: message.content });
        }

    } catch (error) {
        document.querySelector('.loading')?.remove();
        appendMessage("📡 Sem conexão com a IA. Verifique sua internet e a chave API.", 'agent');
        chatHistory.pop();
        console.error(error);
    }
}

function appendMessage(text, sender, className = '') {
    const box = document.getElementById('chatBox');
    const msg = document.createElement('div');
    msg.className = `message ${sender} ${className}`;
    msg.innerText = text;
    box.appendChild(msg);
    box.scrollTop = box.scrollHeight;
}

function checkNotificationPermission() {
    if (Notification.permission !== "granted") {
        Notification.requestPermission();
    }
}

setInterval(() => {
    const agora = new Date().toTimeString().slice(0, 5);
    const hoje  = new Date().toISOString().slice(0, 10);
    tasks.forEach(task => {
        if ((task.date || hoje) === hoje && task.time === agora && !task.notified) {
            if (Notification.permission === "granted") {
                new Notification(`AgentPro`, { body: `Está na hora de: ${task.title}` });
            } else {
                alert(`🚨 Alerta AgentPro: ${task.title}`);
            }
            task.notified = true;
            // BUG FIX: persistir notified=true no localStorage
            localStorage.setItem('tasks_modern', JSON.stringify(tasks));
        }
    });
}, 15000);

// ─── Microfone: Web Speech API ───
function showMicToast(msg, icon = 'mic-off') {
    let toast = document.getElementById('micToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'micToast';
        toast.className = 'mic-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<i data-lucide="${icon}"></i> ${msg}`;
    if (window.lucide) lucide.createIcons({ nodes: [toast] });
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function initMic() {
    const micBtn = document.getElementById('micBtn');
    if (!micBtn) return;

    // Verificar suporte
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        micBtn.title = 'Reconhecimento de voz não suportado neste navegador';
        micBtn.style.opacity = '0.35';
        micBtn.style.cursor = 'not-allowed';
        micBtn.addEventListener('click', () =>
            showMicToast('Use Chrome ou Edge para falar com o agente.'));
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.interimResults = true;   // mostra texto em tempo real no input
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    let isRecording = false;
    let finalTranscript = '';

    function startRecording() {
        finalTranscript = '';
        document.getElementById('chatInput').value = '';
        document.getElementById('chatInput').placeholder = '🎙️ Ouvindo…';
        micBtn.classList.add('recording');
        // Troca ícone para mic pulsando
        micBtn.innerHTML = '<i data-lucide="mic"></i>';
        if (window.lucide) lucide.createIcons({ nodes: [micBtn] });
        isRecording = true;
        recognition.start();
    }

    function stopRecording() {
        isRecording = false;
        micBtn.classList.remove('recording');
        micBtn.innerHTML = '<i data-lucide="mic"></i>';
        if (window.lucide) lucide.createIcons({ nodes: [micBtn] });
        document.getElementById('chatInput').placeholder = 'Pergunte algo ou use o microfone…';
        recognition.stop();
    }

    micBtn.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    // Atualizar input com o texto em tempo real (interim)
    recognition.addEventListener('result', (e) => {
        let interim = '';
        finalTranscript = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) finalTranscript += t;
            else interim += t;
        }
        document.getElementById('chatInput').value = finalTranscript || interim;
    });

    // Quando o reconhecimento termina de vez
    recognition.addEventListener('end', () => {
        isRecording = false;
        micBtn.classList.remove('recording');
        micBtn.innerHTML = '<i data-lucide="mic"></i>';
        if (window.lucide) lucide.createIcons({ nodes: [micBtn] });
        document.getElementById('chatInput').placeholder = 'Pergunte algo ou use o microfone…';

        const text = finalTranscript.trim();
        if (text) {
            // Enviar automaticamente como mensagem de voz
            document.getElementById('chatInput').value = text;
            sendVoiceMessage(text);
        } else {
            showMicToast('Nada foi captado. Tente falar mais perto.');
        }
    });

    recognition.addEventListener('error', (e) => {
        stopRecording();
        const msgs = {
            'not-allowed':      '🎤 Permissão de microfone negada.',
            'no-speech':        'Nenhuma fala detectada. Tente novamente.',
            'audio-capture':    '🎤 Microfone não encontrado.',
            'network':          '📡 Erro de rede no reconhecimento de voz.',
            'service-not-allowed': '🎤 Permissão de microfone negada.',
        };
        showMicToast(msgs[e.error] || `Erro de voz: ${e.error}`);
        document.getElementById('chatInput').value = '';
    });
}

// Variante de sendMessage que mostra badge "🎙 Áudio" na bolha do chat
async function sendVoiceMessage(text) {
    const input = document.getElementById('chatInput');
    input.value = '';

    const apiKey = document.getElementById('apiKey').value;
    const personalityKey = document.getElementById('personality').value;
    if (!apiKey) { alert("Configure sua Chave API na barra lateral."); return; }

    // Bolha do usuário com indicador de áudio
    appendVoiceMessage(text);

    // Adicionar ao histórico igual ao sendMessage normal
    chatHistory.push({ role: "user", content: text });

    const today = new Date().toISOString().slice(0, 10);
    const futureTasks = tasks
        .filter(t => (t.date || today) >= today)
        .sort((a, b) => (a.date || today).localeCompare(b.date || today) || a.time.localeCompare(b.time));

    const agendaContexto = futureTasks.length
        ? futureTasks.map(t => `- [${formatDate(t.date || today)} ${t.time}] ${t.title}`).join('\n')
        : 'Nenhuma tarefa futura.';

    const tools = [
        {
            type: "function",
            function: {
                name: "adicionar_tarefa",
                description: "Adiciona uma tarefa/evento/lembrete à agenda do usuário.",
                parameters: {
                    type: "object",
                    properties: {
                        title: { type: "string", description: "Título claro da tarefa." },
                        date: { type: "string", description: `Data YYYY-MM-DD. Hoje é ${today}.` },
                        time: { type: "string", description: "Horário HH:MM (24h). Se não informado, use 00:00." }
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
                    properties: {
                        title: { type: "string", description: "Parte do título da tarefa a remover." }
                    },
                    required: ["title"]
                }
            }
        }
    ];

    const systemPrompt = `${personalities[personalityKey]}

Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${today}).
Agenda atual do usuário:\n${agendaContexto}

O usuário enviou uma mensagem por VOZ (transcrita automaticamente). Pode ter pequenos erros de transcrição.
Quando pedir para adicionar/agendar algo, USE adicionar_tarefa. Para remover, USE remover_tarefa.
Interprete 'hoje', 'amanhã', dias da semana corretamente.`;

    try {
        appendMessage("Consultando o agente…", 'agent', 'loading');

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "meta-llama/llama-4-scout-17b-16e-instruct",
                messages: [{ role: "system", content: systemPrompt }, ...chatHistory],
                tools,
                tool_choice: "auto"
            })
        });

        const data = await response.json();
        document.querySelector('.loading')?.remove();

        if (!response.ok || data.error) {
            appendMessage(friendlyApiError(data, response.status), 'agent');
            chatHistory.pop();
            return;
        }

        const choice  = data.choices?.[0];
        const message = choice?.message;
        if (!message) { appendMessage("⚠️ Resposta inesperada da IA.", 'agent'); chatHistory.pop(); return; }

        if (message.tool_calls?.length > 0) {
            const toolResults = [];
            for (const tc of message.tool_calls) {
                let args; try { args = JSON.parse(tc.function.arguments); } catch { args = {}; }
                let resultContent = '';
                if (tc.function.name === 'adicionar_tarefa') {
                    const task = addTaskFromChat(args);
                    resultContent = JSON.stringify({ sucesso: true, tarefa: task.title, data: task.date, horario: task.time });
                } else if (tc.function.name === 'remover_tarefa') {
                    const removed = deleteTaskFromChat(args);
                    resultContent = JSON.stringify(removed
                        ? { sucesso: true, tarefa_removida: removed.title }
                        : { sucesso: false, motivo: 'Não encontrada.' });
                }
                toolResults.push({ role: "tool", tool_call_id: tc.id, content: resultContent });
            }

            const followUp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: "meta-llama/llama-4-scout-17b-16e-instruct",
                    messages: [
                        { role: "system", content: systemPrompt },
                        ...chatHistory,
                        { role: "assistant", content: null, tool_calls: message.tool_calls },
                        ...toolResults
                    ]
                })
            });

            const followData = await followUp.json();
            if (!followUp.ok || followData.error) { appendMessage(friendlyApiError(followData, followUp.status), 'agent'); chatHistory.pop(); return; }

            const reply = followData.choices?.[0]?.message?.content || "Feito! ✅";
            appendMessage(reply, 'agent');
            chatHistory.push({ role: "assistant", content: null, tool_calls: message.tool_calls });
            toolResults.forEach(r => chatHistory.push(r));
            chatHistory.push({ role: "assistant", content: reply });

        } else {
            appendMessage(message.content, 'agent');
            chatHistory.push({ role: "assistant", content: message.content });
        }

    } catch (err) {
        document.querySelector('.loading')?.remove();
        appendMessage("📡 Sem conexão com a IA. Verifique sua internet e a chave API.", 'agent');
        chatHistory.pop();
        console.error(err);
    }
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

// ─── Custom Select Dropdown ───
function initCustomSelect() {
  const trigger    = document.getElementById('personalityTrigger');
  const dropdown   = document.getElementById('personalityDropdown');
  const label      = document.getElementById('personalityLabel');
  const realSelect = document.getElementById('personality');
  const options    = dropdown.querySelectorAll('.custom-select-option');

  const labels = {
    motivacional: 'Coach Épico 🔥',
    sarcastico:   'Realista Ácido 😼',
    militar:      'Comando Tático 🪖',
    gentil:       'Zênite da Paz 🌸'
  };

  const saved = localStorage.getItem('agent_personality_modern') || 'motivacional';
  setCustomOption(saved);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');

    if (window.innerWidth <= 768) {
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      if (spaceBelow < 200 && spaceAbove > spaceBelow) {
        dropdown.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
        dropdown.style.top = 'auto';
      } else {
        dropdown.style.top = (rect.bottom + 8) + 'px';
        dropdown.style.bottom = 'auto';
      }
    }

    dropdown.classList.toggle('open', !isOpen);
    trigger.setAttribute('aria-expanded', String(!isOpen));
    if (!isOpen) lucide.createIcons();
  });

  options.forEach(opt => {
    opt.addEventListener('click', () => {
      const val = opt.dataset.value;
      setCustomOption(val);
      dropdown.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      localStorage.setItem('agent_personality_modern', val);
      realSelect.value = val;
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
    realSelect.value = val;
    lucide.createIcons();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initCustomSelect();
});