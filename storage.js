/**
 * STORAGE.JS
 * Camada de persistência — lê e salva dados no localStorage
 * Usa os STORAGE_KEYS de constants.js e o appState de state.js
 */

import { STORAGE_KEYS, APP_CONFIG } from './constants.js';
import { appState } from './state.js';

/**
 * ═══════════════════════════════════
 * HELPERS INTERNOS
 * ═══════════════════════════════════
 */

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(`[Storage] Erro ao salvar "${key}":`, err);
    return false;
  }
}

function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.warn(`[Storage] Erro ao ler "${key}":`, err);
    return fallback;
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (err) {
    console.error(`[Storage] Erro ao remover "${key}":`, err);
    return false;
  }
}

/**
 * ═══════════════════════════════════
 * SAVE — salva fatias do estado
 * ═══════════════════════════════════
 */

export function saveProfile(profile) {
  return save(STORAGE_KEYS.profile, profile);
}

export function saveSubjects(subjects) {
  return save(STORAGE_KEYS.subjects, subjects);
}

export function saveProvas(provas) {
  return save(STORAGE_KEYS.provas, provas);
}

export function saveTarefas(tarefas) {
  return save(STORAGE_KEYS.tarefas, tarefas);
}

export function saveTheme(theme) {
  return save(STORAGE_KEYS.theme, theme);
}

export function saveBimestres(bimestres) {
  return save(STORAGE_KEYS.bimestres, bimestres);
}

export function saveStreak(streak) {
  return save(STORAGE_KEYS.streak, streak);
}

export function saveChatHistory(history) {
  return save(STORAGE_KEYS.chatHistory, history);
}

export function saveApiKey(key) {
  return save(STORAGE_KEYS.apiKey, key);
}

export function saveAchievements(achievements) {
  return save(STORAGE_KEYS.achievements, achievements);
}

/**
 * Salva tudo de uma vez (snapshot completo)
 */
export function saveAll() {
  const s = appState.getState();
  saveProfile(s.profile);
  saveSubjects(s.subjects);
  saveProvas(s.provas);
  saveTarefas(s.tarefas);
  saveTheme(s.theme);
  saveBimestres(s.bimestres);
  saveStreak(s.streak);
  saveChatHistory(s.chatHistory);
  saveAchievements(s.achievements);
  save(STORAGE_KEYS.schemaVersion, APP_CONFIG.dataSchemaVersion);
}

/**
 * ═══════════════════════════════════
 * LOAD — carrega e hidrata o estado
 * ═══════════════════════════════════
 */

export function loadAll() {
  const storedVersion = load(STORAGE_KEYS.schemaVersion, 0);

  // Se schema mudou, limpa tudo (migração futura pode ser feita aqui)
  if (storedVersion < APP_CONFIG.dataSchemaVersion) {
    console.warn('[Storage] Schema desatualizado. Resetando dados...');
    clearAll();
    return false;
  }

  const profile      = load(STORAGE_KEYS.profile,      null);
  const subjects     = load(STORAGE_KEYS.subjects,     []);
  const provas       = load(STORAGE_KEYS.provas,       []);
  const tarefas      = load(STORAGE_KEYS.tarefas,      []);
  const theme        = load(STORAGE_KEYS.theme,        'dark');
  const bimestres    = load(STORAGE_KEYS.bimestres,    APP_CONFIG.bimestresDefault);
  const streak       = load(STORAGE_KEYS.streak,       { days: 0, lastUpdate: null });
  const chatHistory  = load(STORAGE_KEYS.chatHistory,  []);
  const achievements = load(STORAGE_KEYS.achievements, {});

  // Carrega chave de API (apenas verifica existência, não expõe valor)
  const apiKey = load(STORAGE_KEYS.apiKey, null);

  // Hidrata o appState com o que foi carregado
  const payload = {
    subjects,
    provas,
    tarefas,
    theme,
    bimestres,
    streak,
    chatHistory,
    achievements,
    apiKeyConfigured: !!apiKey,
    schemaVersion: APP_CONFIG.dataSchemaVersion,
  };

  if (profile) {
    payload.profile = profile;
  }

  appState.dispatch({ type: 'SET_STATE', payload });

  // Aplica tema salvo no HTML
  applyTheme(theme);

  console.log('[Storage] Dados carregados com sucesso.');
  return true;
}

/**
 * ═══════════════════════════════════
 * THEME
 * ═══════════════════════════════════
 */

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
}

/**
 * ═══════════════════════════════════
 * API KEY (separado por segurança)
 * ═══════════════════════════════════
 */

export function getApiKey() {
  return load(STORAGE_KEYS.apiKey, null);
}

export function setApiKey(key) {
  const ok = save(STORAGE_KEYS.apiKey, key);
  if (ok) {
    appState.dispatch({ type: 'SET_API_KEY_CONFIGURED', payload: true });
  }
  return ok;
}

export function removeApiKey() {
  remove(STORAGE_KEYS.apiKey);
  appState.dispatch({ type: 'SET_API_KEY_CONFIGURED', payload: false });
}

/**
 * ═══════════════════════════════════
 * EXPORT / IMPORT de dados do usuário
 * ═══════════════════════════════════
 */

export function exportData() {
  const s = appState.getState();
  return {
    schemaVersion: APP_CONFIG.dataSchemaVersion,
    exportedAt: new Date().toISOString(),
    profile: s.profile,
    subjects: s.subjects,
    provas: s.provas,
    tarefas: s.tarefas,
    achievements: s.achievements,
    bimestres: s.bimestres,
    streak: s.streak,
  };
}

export function importData(data) {
  if (!data || !data.profile) {
    throw new Error('Arquivo de backup inválido.');
  }

  appState.dispatch({
    type: 'SET_STATE',
    payload: {
      profile:      data.profile      || appState.getState().profile,
      subjects:     data.subjects     || [],
      provas:       data.provas       || [],
      tarefas:      data.tarefas      || [],
      achievements: data.achievements || {},
      bimestres:    data.bimestres    || APP_CONFIG.bimestresDefault,
      streak:       data.streak       || { days: 0, lastUpdate: null },
    },
  });

  saveAll();
}

/**
 * ═══════════════════════════════════
 * CLEAR
 * ═══════════════════════════════════
 */

export function clearAll() {
  Object.values(STORAGE_KEYS).forEach((key) => remove(key));
  appState.dispatch({ type: 'RESET_STATE' });
}

/**
 * Middleware automático: salva no storage sempre que o estado muda
 * Registre com: appState.use(autoSaveMiddleware)
 */
export const autoSaveMiddleware = {
  after(action, state) {
    const saveMap = {
      SET_PROFILE:       () => saveProfile(state.profile),
      ADD_SUBJECT:       () => saveSubjects(state.subjects),
      UPDATE_SUBJECT:    () => saveSubjects(state.subjects),
      DELETE_SUBJECT:    () => saveSubjects(state.subjects),
      SET_SUBJECTS:      () => saveSubjects(state.subjects),
      ADD_PROVA:         () => saveProvas(state.provas),
      DELETE_PROVA:      () => saveProvas(state.provas),
      SET_PROVAS:        () => saveProvas(state.provas),
      ADD_TAREFA:        () => saveTarefas(state.tarefas),
      UPDATE_TAREFA:     () => saveTarefas(state.tarefas),
      DELETE_TAREFA:     () => saveTarefas(state.tarefas),
      SET_TAREFAS:       () => saveTarefas(state.tarefas),
      SET_THEME:         () => { saveTheme(state.theme); applyTheme(state.theme); },
      SET_BIMESTRES:     () => saveBimestres(state.bimestres),
      SET_STREAK:        () => saveStreak(state.streak),
      ADD_CHAT_MESSAGE:  () => saveChatHistory(state.chatHistory),
      SET_CHAT_HISTORY:  () => saveChatHistory(state.chatHistory),
      UNLOCK_ACHIEVEMENT:() => saveAchievements(state.achievements),
      SET_ACHIEVEMENTS:  () => saveAchievements(state.achievements),
      SET_STATE:         () => saveAll(),
    };

    if (saveMap[action.type]) {
      saveMap[action.type]();
    }
  },
};

export default {
  saveAll,
  loadAll,
  clearAll,
  exportData,
  importData,
  getApiKey,
  setApiKey,
  removeApiKey,
  applyTheme,
  autoSaveMiddleware,
};
