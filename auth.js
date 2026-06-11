// ═══════════════════════════════════════════════════════════════
//  auth.js — Firebase Auth + Firestore para AgentPro v3.0
//  Adicionado: saveAgentMemory / loadAgentMemory (#11)
//              limpeza automática de histórico antigo (#15)
// ═══════════════════════════════════════════════════════════════

import { initializeApp }          from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { firebaseConfig }          from "./firebase-config.js";
import { getAuth, onAuthStateChanged, signOut }
                                   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

let currentUser = null;

// ─────────────────────────────────────────────────────────────
//  Helpers Firestore — Tarefas
// ─────────────────────────────────────────────────────────────

function tasksCol() {
  return collection(db, 'users', currentUser.uid, 'tasks');
}

export async function saveTaskToFirestore(task) {
  if (!currentUser) return;
  await setDoc(doc(tasksCol(), String(task.id)), {
    ...task,
    updatedAt: serverTimestamp()
  });
}

export async function deleteTaskFromFirestore(taskId) {
  if (!currentUser) return;
  await deleteDoc(doc(tasksCol(), String(taskId)));
}

export async function loadTasksFromFirestore() {
  if (!currentUser) return [];
  const snap = await getDocs(tasksCol());
  return snap.docs.map(d => d.data());
}

// ─────────────────────────────────────────────────────────────
//  Histórico do chat — com limpeza automática (#15)
// ─────────────────────────────────────────────────────────────

function chatCol() {
  return collection(db, 'users', currentUser.uid, 'chatHistory');
}

/**
 * Salva histórico no Firestore.
 * Automaticamente limpa: mantém apenas as 40 mensagens mais recentes
 * e remove entradas de tool que ocupam espaço desnecessário. (#15)
 */
export async function saveChatHistory(history) {
  if (!currentUser) return;
  try {
    // #15 Strip tool messages (role === 'tool') from persisted history to save space
    const clean = history
      .filter(m => m.role === 'user' || (m.role === 'assistant' && m.content))
      .slice(-40); // Keep only last 40 meaningful messages

    await setDoc(doc(chatCol(), 'current'), {
      messages:  clean,
      updatedAt: serverTimestamp()
    });
  } catch(e) { console.warn('AgentPro: erro ao salvar chat', e); }
}

export async function loadChatHistory() {
  if (!currentUser) return [];
  try {
    const snap  = await getDocs(chatCol());
    const found = snap.docs.find(d => d.id === 'current');
    return found ? (found.data().messages || []) : [];
  } catch { return []; }
}

export function subscribeToTasks(callback) {
  if (!currentUser) return () => {};
  return onSnapshot(tasksCol(), (snap) => {
    callback(snap.docs.map(d => d.data()));
  });
}

// ─────────────────────────────────────────────────────────────
//  Memória do agente — persiste fatos do usuário entre sessões (#11)
// ─────────────────────────────────────────────────────────────

function memoryDoc() {
  return doc(db, 'users', currentUser.uid, 'agentData', 'memory');
}

/**
 * Salva o objeto de memória do agente no Firestore.
 * @param {Object} memory — chave: valor, ex: { "horário de acordar": "6h" }
 */
export async function saveAgentMemory(memory) {
  if (!currentUser) return;
  try {
    await setDoc(memoryDoc(), {
      facts:     memory,
      updatedAt: serverTimestamp()
    });
  } catch(e) { console.warn('AgentPro: erro ao salvar memória', e); }
}

/**
 * Carrega a memória do agente do Firestore.
 * @returns {Object} — objeto com fatos ou {}
 */
export async function loadAgentMemory() {
  if (!currentUser) return {};
  try {
    const snap = await getDocs(collection(db, 'users', currentUser.uid, 'agentData'));
    const found = snap.docs.find(d => d.id === 'memory');
    return found ? (found.data().facts || {}) : {};
  } catch { return {}; }
}

// ─────────────────────────────────────────────────────────────
//  Migração localStorage → Firestore
// ─────────────────────────────────────────────────────────────

async function migrateLegacyTasks() {
  const legacyKey  = 'tasks_modern';
  const migratedKey = `migrated_${currentUser.uid}`;
  if (localStorage.getItem(migratedKey)) return;
  const legacy = JSON.parse(localStorage.getItem(legacyKey) || '[]');
  if (!legacy.length) { localStorage.setItem(migratedKey, '1'); return; }
  console.log(`AgentPro: migrando ${legacy.length} tarefa(s)…`);
  await Promise.all(legacy.map(t => saveTaskToFirestore(t)));
  localStorage.setItem(migratedKey, '1');
  console.log('AgentPro: migração concluída.');
}

// ─────────────────────────────────────────────────────────────
//  User chip
// ─────────────────────────────────────────────────────────────

function injectUserChip(user) {
  const header = document.querySelector('.header-stats');
  if (!header || document.getElementById('userChip')) return;
  const name   = user.displayName || user.email.split('@')[0];
  const avatar = user.photoURL
    ? `<img src="${user.photoURL}" alt="${name}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;">`
    : `<span style="width:22px;height:22px;border-radius:50%;background:var(--violet);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">${name[0].toUpperCase()}</span>`;
  const chip = document.createElement('div');
  chip.id = 'userChip';
  chip.className = 'stat-pill';
  chip.style.cssText = 'cursor:pointer;gap:8px;';
  chip.title = `Sair da conta (${user.email})`;
  chip.innerHTML = `${avatar}<span style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>`;
  chip.addEventListener('click', () => {
    if (confirm(`Sair da conta ${user.email}?`)) {
      signOut(auth).then(() => window.location.href = './login.html');
    }
  });
  header.appendChild(chip);
}

// ─────────────────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────────────────

export function initAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) { window.location.href = './login.html'; return; }
      currentUser = user;
      console.log(`AgentPro: usuário autenticado — ${user.email}`);
      injectUserChip(user);
      await migrateLegacyTasks();
      const tasks = await loadTasksFromFirestore();
      resolve({ user, tasks });
    });
  });
}

export function logout() {
  return signOut(auth).then(() => { window.location.href = './login.html'; });
}

export function getFirebaseAuth() { return auth; }