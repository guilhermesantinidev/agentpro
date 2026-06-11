const CACHE_NAME = 'agentpro-v7';
const STATIC_ASSETS = [
  './',
  './index.html',
  './login.html',
  './style.css',
  './app.js',
  './auth.js',
  './manifest.json'
];

// ─── IndexedDB helpers (SW não tem localStorage) ───
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('agentpro-sw', 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('kv');
    };
    req.onsuccess  = (e) => resolve(e.target.result);
    req.onerror    = (e) => reject(e.target.error);
  });
}

async function dbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ─── Install ───
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate ───
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => {
      self.clients.claim();
      // Inicia o loop de checagem assim que o SW ativa
      startNotificationLoop();
    })
  );
});

// ─── Fetch: Network-first ───
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== location.origin) return;

  if (request.headers.get('accept')?.includes('text/html')) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return res;
      })
      .catch(() => caches.match(request))
  );
});

// ─── Message: recebe tarefas do app ───
// O app envia { type: 'SYNC_TASKS', tasks: [...] } sempre que a agenda muda.
self.addEventListener('message', async (e) => {
  if (e.data?.type === 'SYNC_TASKS') {
    await dbSet('tasks', e.data.tasks);
    // Agenda imediata para tarefas futuras sem esperar o próximo tick do loop
    await scheduleUpcoming(e.data.tasks);
  }
});

// ─── Loop de notificações (roda no SW, funciona com app fechado) ───
// Usa setInterval dentro do SW para checar a cada 30s.
// NOTA: SWs podem ser terminados pelo browser em background; para
// garantia máxima também registramos um periodicsync quando disponível.
let _notifLoop = null;

function startNotificationLoop() {
  if (_notifLoop) return; // evita duplicatas
  _notifLoop = setInterval(checkAndNotify, 30_000);
  checkAndNotify(); // roda imediatamente na primeira vez
}

async function checkAndNotify() {
  const tasks = await dbGet('tasks');
  if (!Array.isArray(tasks) || tasks.length === 0) return;

  const now   = new Date();
  const hoje  = now.toISOString().slice(0, 10);
  const agora = now.toTimeString().slice(0, 5); // "HH:MM"

  // Janela de ±1 minuto para não perder se o SW estava dormindo
  const [hh, mm] = agora.split(':').map(Number);
  const windowStart = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  const next = new Date(now.getTime() + 60_000);
  const windowEnd = next.toTimeString().slice(0, 5);

  for (const task of tasks) {
    if (task.completed || task.archived || task.notified) continue;
    if ((task.date || hoje) !== hoje) continue;

    const t = task.time || '00:00';
    if (t < windowStart || t > windowEnd) continue;

    // Dispara notificação via SW — funciona mesmo com o app fechado
    await self.registration.showNotification('AgentPro 🤖', {
      body: `Está na hora de: ${task.title}`,
      icon:  'https://cdn-icons-png.flaticon.com/512/8943/8943377.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/8943/8943377.png',
      tag:   `task-${task.id}`,       // evita duplicatas
      renotify: false,
      data: { taskId: task.id }
    });

    // Marca como notificado no IndexedDB para não repetir
    task.notified = true;
  }
  await dbSet('tasks', tasks);
}

// Agenda checagens pontuais para tarefas próximas (usando setTimeout)
// Isso garante precisão mesmo que o setInterval esteja adormecido.
async function scheduleUpcoming(tasks) {
  const now   = new Date();
  const hoje  = now.toISOString().slice(0, 10);

  for (const task of tasks) {
    if (task.completed || task.archived || task.notified) continue;
    if ((task.date || hoje) !== hoje) continue;
    if (!task.time) continue;

    const taskMs = new Date(hoje + 'T' + task.time + ':00').getTime();
    const diff   = taskMs - now.getTime();

    // Agenda tarefas nas próximas 24h (antes era 60min)
    if (diff > 0 && diff <= 24 * 60 * 60_000) {
      setTimeout(async () => {
        const stored = await dbGet('tasks');
        const t = stored?.find(t => t.id == task.id);
        if (t && !t.notified && !t.completed) {
          await self.registration.showNotification('AgentPro 🤖', {
            body:    `⏰ Está na hora: ${t.title}`,
            icon:    'https://cdn-icons-png.flaticon.com/512/8943/8943377.png',
            badge:   'https://cdn-icons-png.flaticon.com/512/8943/8943377.png',
            tag:     `task-${t.id}`,
            renotify: false,
            vibrate: [200, 100, 200],
            actions: [
              { action: 'done',   title: '✅ Concluir' },
              { action: 'snooze', title: '⏱️ +10 min'  },
            ],
            data: { taskId: t.id }
          });
          t.notified = true;
          await dbSet('tasks', stored);
        }
      }, diff);

      // Lembrete antecipado de 15min para tarefas >= 30min no futuro
      if (diff >= 30 * 60_000) {
        setTimeout(async () => {
          const stored = await dbGet('tasks');
          const t = stored?.find(t => t.id == task.id);
          if (t && !t.notified && !t.completed) {
            await self.registration.showNotification('AgentPro 🤖', {
              body:    `🔔 Em 15 minutos: ${t.title}`,
              icon:    'https://cdn-icons-png.flaticon.com/512/8943/8943377.png',
              badge:   'https://cdn-icons-png.flaticon.com/512/8943/8943377.png',
              tag:     `task-pre-${t.id}`,
              renotify: false,
              vibrate: [100],
              data: { taskId: t.id }
            });
          }
        }, diff - 15 * 60_000);
      }
    }
  }
}

// ─── Periodic Background Sync (Chrome/Android) ───
// Oferece uma segunda camada de garantia em browsers que suportam.
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'agentpro-notif-check') {
    e.waitUntil(checkAndNotify());
  }
});

// ─── Clique na notificação — abre/foca o app ───
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const action = e.action;
  const taskId = e.notification.data?.taskId;

  if (action === 'done' && taskId) {
    // Marca como concluída no IndexedDB
    e.waitUntil((async () => {
      const tasks = await dbGet('tasks');
      if (Array.isArray(tasks)) {
        const t = tasks.find(t => t.id == taskId);
        if (t) { t.completed = true; t.notified = true; }
        await dbSet('tasks', tasks);
      }
      // Foca o app para sincronizar com Firestore
      const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of list) { if (c.url.includes('index.html') || c.url.endsWith('/')) { c.postMessage({ type: 'TASK_DONE', taskId }); return c.focus(); } }
    })());
    return;
  }

  if (action === 'snooze' && taskId) {
    // Reagenda notificação em 10 minutos
    e.waitUntil((async () => {
      const tasks = await dbGet('tasks');
      const t = tasks?.find(t => t.id == taskId);
      if (t) {
        setTimeout(async () => {
          await self.registration.showNotification('AgentPro 🤖', {
            body:    `⏰ Agora sim: ${t.title}`,
            icon:    'https://cdn-icons-png.flaticon.com/512/8943/8943377.png',
            badge:   'https://cdn-icons-png.flaticon.com/512/8943/8943377.png',
            tag:     `task-snooze-${t.id}`,
            vibrate: [200, 100, 200],
            data: { taskId: t.id }
          });
        }, 10 * 60_000);
      }
    })());
    return;
  }

  // Clique normal — abre o app
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes('index.html') || client.url.endsWith('/')) {
          return client.focus();
        }
      }
      return clients.openWindow('./index.html');
    })
  );
});