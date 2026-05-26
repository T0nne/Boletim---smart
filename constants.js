/**
 * CONSTANTS.JS
 * Configurações globais, constantes e padrões de validação
 * Importado por state.js e utils.js
 */

/**
 * Configurações gerais da aplicação
 */
export const APP_CONFIG = {
  name: 'Meu Boletim',
  version: '1.0.0',
  dataSchemaVersion: 1,

  // Bimestres padrão (4 bimestres)
  bimestresDefault: 4,

  // Limite do histórico de chat
  chatMaxHistory: 100,

  // Nota mínima padrão para aprovação
  defaultMinGrade: 6,

  // Ícones disponíveis para matérias
  subjectIcons: ['📚', '🔢', '🔬', '🌍', '🎨', '🏃', '🎵', '💻', '📖', '⚗️', '🧬', '📐', '🗺️', '🌎', '✏️'],
};

/**
 * Chaves usadas no localStorage
 */
export const STORAGE_KEYS = {
  profile:      'meuboletim_profile',
  subjects:     'meuboletim_subjects',
  provas:       'meuboletim_provas',
  tarefas:      'meuboletim_tarefas',
  theme:        'meuboletim_theme',
  bimestres:    'meuboletim_bimestres',
  streak:       'meuboletim_streak',
  chatHistory:  'meuboletim_chat_history',
  apiKey:       'meuboletim_api_key',
  achievements: 'meuboletim_achievements',
  schemaVersion:'meuboletim_schema_version',
};

/**
 * Padrões de validação (usados em utils.js)
 */
export const VALIDATION_PATTERNS = {
  email:  /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  apiKey: /^sk-ant-[a-zA-Z0-9\-_]{20,}$/,
  name:   /^[\p{L}\s'-]{1,100}$/u,
};

/**
 * Mensagens de erro padrão
 */
export const ERROR_MESSAGES = {
  required:       'Este campo é obrigatório.',
  invalidEmail:   'E-mail inválido.',
  invalidApiKey:  'Chave de API inválida. Deve começar com sk-ant-',
  invalidGrade:   'Nota deve estar entre 0 e 10.',
  loadFailed:     'Erro ao carregar dados.',
  saveFailed:     'Erro ao salvar dados.',
  networkError:   'Sem conexão. Verifique sua internet.',
};

/**
 * Configuração dos achievements/conquistas
 */
export const ACHIEVEMENTS = {
  FIRST_SUBJECT:    { id: 'FIRST_SUBJECT',    label: 'Primeira Matéria',  icon: '📚', desc: 'Adicionou a primeira matéria.' },
  FIRST_GRADE:      { id: 'FIRST_GRADE',       label: 'Primeira Nota',     icon: '✏️', desc: 'Registrou a primeira nota.' },
  ALL_APPROVED:     { id: 'ALL_APPROVED',      label: 'Aprovado em Tudo',  icon: '🏆', desc: 'Todas as matérias acima da média.' },
  STREAK_7:         { id: 'STREAK_7',          label: '7 Dias Seguidos',   icon: '🔥', desc: 'Acessou o app 7 dias seguidos.' },
  CHAT_FIRST:       { id: 'CHAT_FIRST',        label: 'Perguntou à IA',    icon: '🤖', desc: 'Fez a primeira pergunta ao assistente.' },
};

/**
 * Páginas disponíveis no app
 */
export const PAGES = {
  DASHBOARD: 'dashboard',
  SUBJECTS:  'subjects',
  AGENDA:    'agenda',
  CHAT:      'chat',
  CONFIG:    'config',
};

/**
 * Tabs de navegação
 */
export const NAV_TABS = [
  { id: PAGES.DASHBOARD, label: 'Início',    icon: '🏠' },
  { id: PAGES.SUBJECTS,  label: 'Matérias',  icon: '📚' },
  { id: PAGES.AGENDA,    label: 'Agenda',    icon: '📅' },
  { id: PAGES.CHAT,      label: 'IA',        icon: '🤖' },
  { id: PAGES.CONFIG,    label: 'Perfil',    icon: '⚙️' },
];

export default {
  APP_CONFIG,
  STORAGE_KEYS,
  VALIDATION_PATTERNS,
  ERROR_MESSAGES,
  ACHIEVEMENTS,
  PAGES,
  NAV_TABS,
};
