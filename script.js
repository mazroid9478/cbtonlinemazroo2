/**
 * ============================================================================
 * CBT ONLINE — Core Application Logic (Vanilla ES6+ JavaScript)
 * ============================================================================
 * Fitur Utama:
 * - Manajemen Identitas Siswa & Sesi Ujian via Local Storage
 * - Mendukung 4 Jenis Soal: Pilihan Ganda (A-E), PG Kompleks (Checkbox),
 *   Isian Singkat (Angka), dan Benar/Salah
 * - Pengacakan Soal (Fisher-Yates), Navigasi Nomor, Flag Ragu-ragu, Auto-save
 * - Timer Hitung Mundur 120 Menit dengan Auto-submit saat waktu habis
 * - Penilaian Otomatis (Skor = Benar / Total * 100, KKM 75)
 * - Halaman Hasil dengan Diagram Batang Canvas, Ringkasan Jawaban, Cetak & PDF
 * - Portal Admin: Rekap Hasil Penilaian, Halaman Hasil Siswa, & CRUD Bank Soal
 * ============================================================================
 */

const STORAGE_KEYS = {
  STUDENT: 'cbt_mazro_student',
  QUESTIONS: 'cbt_mazro_questions',
  SESSION: 'cbt_mazro_session',
  RESULTS: 'cbt_mazro_results',
  USED_IDENTITIES: 'cbt_mazro_used_identities',
  MONITORING: 'cbt_mazro_monitoring',
  TOKEN: 'cbt_mazro_token',
  SETTINGS: 'cbt_mazro_settings',
  STUDENT_QUESTIONS: 'cbt_mazro_student_questions',
  RESET_EPOCH: 'cbt_mazro_reset_epoch',
  PAPER_TEST: 'cbt_mazro_paper_test_config',
  KISI_KISI: 'cbt_mazro_kisi_kisi_config',
};

const DEFAULT_PAPER_TEST_CONFIG = {
  institution: "YAYASAN PENDIDIKAN ISLAM MAZRO'ATUL ULUM",
  schoolName: "MADRASAH ALIYAH MAZRO'ATUL ULUM (M2KM)",
  address: 'Evaluasi Terpadu M2KM · Tahun Ajaran 2026/2027',
  examTitle: 'LEMBAR SOAL PENILAIAN (PAPER TEST MANUAL)',
  studentName: '',
  studentClass: '',
  studentAbsen: '',
  examDate: '',
  orderMode: 'follow',
  includeInstructions: true,
};

const DEFAULT_KISI_KISI_CONFIG = {
  institution: "YAYASAN PENDIDIKAN ISLAM MAZRO'ATUL ULUM",
  schoolName: "MADRASAH ALIYAH MAZRO'ATUL ULUM (M2KM)",
  address: 'Evaluasi Terpadu M2KM · Tahun Pelajaran 2026/2027',
  docTitle: '',
  subject: '',
  mainTopic: '',
  teacherName: '',
  academicYear: '2026/2027',
  classLevel: 'X, XI, XII / Ganjil',
  questionScope: 'all_bank',
  includeKeyCol: false,
  includeSignature: true,
  logoDataUrl: '',
  logoWidth: 0,
  logoHeight: 0,
};

const DEFAULT_SETTINGS = {
  subject: 'INFORMATIKA',
  mainTopic: 'Informatika & Ketrampilan Umum Serta Berpikir Komputasional',
  heroSubtitle: '',
  durationMinutes: 120,
  syllabusItems: [
    'Apa Itu Informatika dan delapan pilar keilmuannya',
    'Keterampilan Generik dalam kolaborasi dan komunikasi digital',
    'Fondasi Berpikir Komputasional: Dekomposisi, Pola, Abstraksi, Algoritma',
    'Algoritma Pencarian (Linear Search & Binary Search)',
    'Algoritma Pengurutan (Bubble, Insertion, dan Selection Sort)',
    'Struktur Data Tumpukan (Stack) dan Antrean (Queue)',
  ],
};

const EXAM_DURATION_MINUTES = 120;
const DEFAULT_STUDENT_QUESTION_COUNT = 50;
const PASSING_GRADE = 75;
const MAX_EXAM_WARNINGS = 6;

const TOPICS = [
  'Apa Itu Informatika?',
  'Apa itu Ketrampilan Generik?',
  'BERPIKIR KOMPUTASIONAL',
  'Mengenal Berpikir Komputasional',
  'Pencarian (Searching)',
  'Pengurutan (Sorting)',
  'Tumpukan (Stack) dan Antrean (Queue)',
];

const TYPE_LABELS = {
  pg: 'Pilihan Ganda',
  pg_kompleks: 'Pilihan Ganda Kompleks',
  isian: 'Isian Singkat',
  benar_salah: 'Benar atau Salah',
};

/* ==================== APPLICATION STATE ==================== */
const state = {
  questions: [],
  student: null,
  session: null,
  results: [],
  usedIdentities: [],
  monitoring: [],
  activeResult: null,
  lastSubmission: null,
  resultOpenedFromAdmin: false,
  resultFilter: 'all',
  currentView: 'login',
  adminTab: 'results',
  adminUnlocked: false,
  adminToken: null,
  adminPinConfigured: true,
  adminSyncInFlight: false,
  pendingFinishSyncPromise: null,
  progressSyncTimer: null,
  resetEpoch: 0,
  timerIntervalId: null,
  monitoringIntervalId: null,
  resumePollIntervalId: null,
  confirmCallback: null,
  pendingImportedQuestions: [],
  pendingBankImport: { questions: [], settings: null },
  settings: null,
  tokenConfig: null,
  draftSyllabusItems: [],
  studentQuestionConfig: null,
  draftStudentQuestionConfig: null,
  studentQMenuOpen: true,
  aiGenMenuOpen: true,
  aiGenerating: false,
  aiAbortController: null,
  previousQuestionsBeforeAi: null,
  examSubmittingLock: false,
  lastExamViolationAt: 0,
  examSecurityListenersBound: false,
  adminClassGradeFilter: 'ALL',
  adminResultClassFilter: 'ALL',
  materialResources: [],
  previewMaterialId: null,
  activeReaderMaterialId: null,
  paperTestConfig: null,
  paperTestOrderIds: null,
  kisiKisiConfig: null,
};

/* ==================== STORAGE HELPERS ==================== */
function readStorage(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('Gagal menyimpan ke Local Storage:', err);
  }
}

function removeStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Abaikan jika gagal
  }
}

/* ==================== SERVER SYNC HELPERS ==================== */
function getAdminRequestHeaders(extraHeaders = {}) {
  return {
    'X-Requested-With': 'CBT-Online-Admin',
    ...(state.adminToken ? { Authorization: `Bearer ${state.adminToken}` } : {}),
    ...extraHeaders,
  };
}

function isAdminRouteUrl() {
  try {
    const pathname = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
    const hash = (window.location.hash || '').toLowerCase();
    const params = new URLSearchParams(window.location.search || '');
    return (
      pathname === '/admin' ||
      pathname.startsWith('/admin/') ||
      hash === '#admin' ||
      hash === '#/admin' ||
      params.get('portal') === 'admin' ||
      params.has('admin')
    );
  } catch {
    return false;
  }
}

function getDedicatedAdminUrl() {
  try {
    return `${window.location.origin}/admin`;
  } catch {
    return '/admin';
  }
}

function getMaterialRouteId() {
  try {
    const pathname = (window.location.pathname || '/').replace(/\/+$/, '');
    if (pathname.startsWith('/materi/')) {
      const id = pathname.slice('/materi/'.length).split('/')[0].trim();
      if (/^[a-zA-Z0-9_-]{6,64}$/.test(id)) return id;
    }
    const params = new URLSearchParams(window.location.search || '');
    const qId = (params.get('materi') || '').trim();
    if (/^[a-zA-Z0-9_-]{6,64}$/.test(qId)) return qId;
    const hash = window.location.hash || '';
    if (hash.startsWith('#materi=')) {
      const hId = hash.slice('#materi='.length).trim();
      if (/^[a-zA-Z0-9_-]{6,64}$/.test(hId)) return hId;
    }
  } catch {
    // Ignore
  }
  return null;
}

function getMaterialAccessUrl(materialId) {
  const id = String(materialId || '').trim();
  if (!id) return '';
  try {
    return `${window.location.origin}/materi/${encodeURIComponent(id)}`;
  } catch {
    return `/materi/${encodeURIComponent(id)}`;
  }
}

function sanitizeHttpHref(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/materi/') || trimmed.startsWith('/api/cbt/materials/')) return trimmed;
  return '';
}

function navigateToStudentFrontWeb() {
  try {
    if ((isAdminRouteUrl() || getMaterialRouteId()) && window.history && typeof window.history.pushState === 'function') {
      window.history.pushState({}, '', '/');
    }
  } catch {
    // Abaikan jika history API dibatasi
  }
  if (state.student) {
    switchView('dashboard');
  } else {
    switchView('login');
  }
}

function handleAdminUnauthorized(message = 'Sesi Admin telah berakhir. Silakan masukkan PIN Admin kembali.') {
  state.adminToken = null;
  state.adminUnlocked = false;
  if (state.currentView === 'admin' || state.currentView === 'result') {
    state.currentView = isAdminRouteUrl() ? 'admin-gate' : state.student ? 'dashboard' : 'login';
    document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
    const fallbackEl = document.getElementById(`view-${state.currentView}`);
    if (fallbackEl) fallbackEl.classList.add('active');
    if (state.monitoringIntervalId) {
      clearInterval(state.monitoringIntervalId);
      state.monitoringIntervalId = null;
    }
    updateTopbar();
  }
  showToast(message, 'error');
  openAdminPortal();
}

function applyResetEpochFromServer(serverEpoch) {
  const nextEpoch = Number(serverEpoch || 0);
  const localEpoch = Number(readStorage(STORAGE_KEYS.RESET_EPOCH, 0) || 0);
  if (nextEpoch > localEpoch) {
    if (localEpoch > 0) {
      state.results = [];
      state.usedIdentities = [];
      state.monitoring = [];
      writeStorage(STORAGE_KEYS.RESULTS, []);
      writeStorage(STORAGE_KEYS.USED_IDENTITIES, []);
      writeStorage(STORAGE_KEYS.MONITORING, []);
    }
    state.resetEpoch = nextEpoch;
    writeStorage(STORAGE_KEYS.RESET_EPOCH, nextEpoch);
    return true;
  }
  if (nextEpoch > 0) {
    state.resetEpoch = nextEpoch;
  }
  return false;
}

async function syncBootstrapFromServer() {
  try {
    const response = await fetch('/api/cbt/bootstrap', { cache: 'no-store' });
    if (!response.ok) return false;
    const data = await response.json();
    if (!data || typeof data !== 'object') return false;

    applyResetEpochFromServer(data.resetEpoch);

    if (data.settings && typeof data.settings === 'object') {
      state.settings = {
        subject: data.settings.subject || DEFAULT_SETTINGS.subject,
        mainTopic: data.settings.mainTopic || DEFAULT_SETTINGS.mainTopic,
        heroSubtitle: typeof data.settings.heroSubtitle === 'string' ? data.settings.heroSubtitle : '',
        durationMinutes: Number(data.settings.durationMinutes) > 0 ? Number(data.settings.durationMinutes) : DEFAULT_SETTINGS.durationMinutes,
        syllabusItems:
          Array.isArray(data.settings.syllabusItems) && data.settings.syllabusItems.length > 0
            ? data.settings.syllabusItems
            : [...DEFAULT_SETTINGS.syllabusItems],
        pedomanPenulisan: typeof data.settings.pedomanPenulisan === 'string' ? data.settings.pedomanPenulisan : '',
        activeMaterialId: typeof data.settings.activeMaterialId === 'string' ? data.settings.activeMaterialId : null,
        activeMaterialTitle: typeof data.settings.activeMaterialTitle === 'string' ? data.settings.activeMaterialTitle : '',
        activeMaterialUrl: typeof data.settings.activeMaterialUrl === 'string' ? data.settings.activeMaterialUrl : '',
      };
      writeStorage(STORAGE_KEYS.SETTINGS, state.settings);
    }

    if (Array.isArray(data.questions) && data.questions.length > 0) {
      state.questions = data.questions;
      writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);
    }

    if (data.studentQuestionConfig && typeof data.studentQuestionConfig === 'object') {
      state.studentQuestionConfig = data.studentQuestionConfig;
      writeStorage(STORAGE_KEYS.STUDENT_QUESTIONS, state.studentQuestionConfig);
    }

    if (data.tokenPublic && typeof data.tokenPublic === 'object') {
      const prev = state.tokenConfig || {};
      const publicClassTokens = data.tokenPublic.classTokensPublic || {};
      state.tokenConfig = {
        ...prev,
        ...data.tokenPublic,
        tokenMode: data.tokenPublic.tokenMode === 'global' ? 'global' : 'per_class',
        classList:
          Array.isArray(data.tokenPublic.classList) && data.tokenPublic.classList.length > 0
            ? data.tokenPublic.classList
            : prev.classList || [...DEFAULT_CLASS_LIST],
        requireNewTokenPerClass: data.tokenPublic.requireNewTokenPerClass !== false,
        boundClass: data.tokenPublic.boundClass || null,
        classTokensPublic: publicClassTokens,
        classTokens: state.adminUnlocked && prev.classTokens ? prev.classTokens : publicClassTokens,
        code: data.tokenPublic.showOnLogin
          ? (data.tokenPublic.code || prev.code || '')
          : '',
      };
      writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
      renderClassDropdowns();
    }

    return true;
  } catch {
    return false;
  }
}

function buildSessionSnapshot(session = state.session, student = state.student) {
  if (!session || !Array.isArray(session.questionOrder) || session.questionOrder.length === 0) {
    return null;
  }
  const now = Date.now();
  const endTime = Number(session.endTime || now);
  const rawRem = endTime - now;
  const remainingMs = rawRem > 0 ? rawRem : 60000;
  return {
    studentNama: session.studentNama || student?.nama || '',
    studentUsername: session.studentUsername || student?.username || '',
    studentNisn: session.studentNisn || student?.nisn || '',
    studentAbsen: session.studentAbsen || student?.absen || '-',
    questionOrder: [...session.questionOrder],
    answers: session.answers && typeof session.answers === 'object' ? { ...session.answers } : {},
    flagged: session.flagged && typeof session.flagged === 'object' ? { ...session.flagged } : {},
    currentIndex: Math.max(0, Number(session.currentIndex) || 0),
    warningCount: Math.max(0, Number(session.warningCount) || 0),
    violations: Array.isArray(session.violations) ? session.violations.slice(-20) : [],
    startTime: Number(session.startTime || now),
    endTime,
    remainingMs: Math.max(15000, Math.floor(remainingMs)),
  };
}

function buildCurrentProgressPayload(statusLabel = 'Sedang Mengerjakan') {
  if (!state.student) return null;
  if (state.session) {
    const total = Array.isArray(state.session.questionOrder) ? state.session.questionOrder.length : 0;
    const answered = countAnsweredQuestions(state.session);
    const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
    return {
      student: {
        nama: state.student.nama,
        username: state.student.username,
        nisn: state.student.nisn,
        absen: state.student.absen || '-',
      },
      progress: {
        status: statusLabel,
        answeredCount: answered,
        totalQuestions: total,
        percentage: pct,
        currentNumber: (state.session.currentIndex || 0) + 1,
        flaggedCount: Object.keys(state.session.flagged || {}).length,
        warningCount: Number(state.session.warningCount || 0),
        startTime: state.session.startTime,
        endTime: state.session.endTime,
      },
      sessionSnapshot: buildSessionSnapshot(state.session, state.student),
    };
  }
  return {
    student: {
      nama: state.student.nama,
      username: state.student.username,
      nisn: state.student.nisn,
      absen: state.student.absen || '-',
    },
    progress: {
      status: statusLabel,
      answeredCount: 0,
      totalQuestions: getActiveStudentQuestions().length,
      percentage: 0,
      currentNumber: 0,
      flaggedCount: 0,
      warningCount: 0,
    },
  };
}

function syncStudentProgressToServer(immediate = false, statusLabel = 'Sedang Mengerjakan') {
  const payload = buildCurrentProgressPayload(statusLabel);
  if (!payload) return;

  const sendNow = () => {
    fetch('/api/cbt/student/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.resetEpoch) {
          applyResetEpochFromServer(data.resetEpoch);
        }
      })
      .catch(() => {
        // Abaikan kegagalan jaringan sementara; localStorage tetap menyimpan state
      });
  };

  if (immediate) {
    if (state.progressSyncTimer) {
      clearTimeout(state.progressSyncTimer);
      state.progressSyncTimer = null;
    }
    sendNow();
    return;
  }

  if (state.progressSyncTimer) {
    clearTimeout(state.progressSyncTimer);
  }
  state.progressSyncTimer = setTimeout(() => {
    state.progressSyncTimer = null;
    sendNow();
  }, 250);
}

async function syncFinishExamToServer(student, resultRecord, answeredCount, terminatedByViolation, sessionSnapshot = null) {
  try {
    const response = await fetch('/api/cbt/student/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student,
        resultRecord,
        answeredCount,
        terminatedByViolation: Boolean(terminatedByViolation),
        sessionSnapshot,
      }),
      keepalive: true,
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data && data.ok) {
      if (data.resetEpoch) applyResetEpochFromServer(data.resetEpoch);
      if (typeof data.nomorUrut === 'number') {
        const resIdx = state.results.findIndex((r) => r.id === resultRecord.id);
        if (resIdx >= 0) {
          state.results[resIdx].nomorUrut = data.nomorUrut;
          writeStorage(STORAGE_KEYS.RESULTS, state.results);
        }
        if (state.lastSubmission && identityMatchesEntry(state.lastSubmission, resultRecord)) {
          state.lastSubmission.nomorUrut = data.nomorUrut;
        }
      }
      if (data.tokenPublic && typeof data.tokenPublic === 'object') {
        const publicClassTokens = data.tokenPublic.classTokensPublic || {};
        state.tokenConfig = {
          ...(state.tokenConfig || {}),
          ...data.tokenPublic,
          tokenMode: data.tokenPublic.tokenMode === 'global' ? 'global' : 'per_class',
          classList:
            Array.isArray(data.tokenPublic.classList) && data.tokenPublic.classList.length > 0
              ? data.tokenPublic.classList
              : state.tokenConfig?.classList || [...DEFAULT_CLASS_LIST],
          classTokensPublic: publicClassTokens,
          classTokens:
            state.adminUnlocked && state.tokenConfig?.classTokens
              ? state.tokenConfig.classTokens
              : publicClassTokens,
          code: data.tokenPublic.showOnLogin
            ? (data.tokenPublic.code || state.tokenConfig?.code || '')
            : '',
        };
        writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
        renderClassDropdowns();
        renderLoginTokenField();
      }
    }
    return data;
  } catch {
    return null;
  }
}

function mergeMonitoringLists(serverList, localList) {
  const rank = { 'Sedang Mengerjakan': 1, 'Belum Mulai': 0, Selesai: 2 };
  const merged = Array.isArray(serverList) ? serverList.map((item) => ({ ...item })) : [];

  (Array.isArray(localList) ? localList : []).forEach((localItem) => {
    const idx = merged.findIndex((m) => identityMatchesEntry(m, localItem));
    if (idx < 0) {
      merged.push({ ...localItem });
      return;
    }
    const existing = merged[idx];
    const serverResetAt = Number(existing.loginResetAt || 0);
    const localTime = Number(localItem.lastActivityAt || 0);
    if (serverResetAt > 0 && localTime <= serverResetAt) {
      return;
    }
    const rExist = rank[existing.status] ?? 0;
    const rLocal = rank[localItem.status] ?? 0;
    const localNewer = localTime > Number(existing.lastActivityAt || 0);
    if (rLocal > rExist || (rLocal === rExist && localNewer)) {
      merged[idx] = { ...existing, ...localItem };
    }
  });

  return merged;
}

function mergeResultLists(serverList, localList, serverMonitoring = []) {
  const merged = Array.isArray(serverList) ? serverList.map((item) => ({ ...item })) : [];
  (Array.isArray(localList) ? localList : []).forEach((localItem) => {
    const resetMon = (Array.isArray(serverMonitoring) ? serverMonitoring : []).find(
      (m) => identityMatchesEntry(m, localItem) && Number(m.loginResetAt || 0) > 0
    );
    if (resetMon) {
      const completedMs = localItem.completedAt ? new Date(localItem.completedAt).getTime() : 0;
      if (completedMs <= Number(resetMon.loginResetAt || 0) || resetMon.status !== 'Selesai') {
        return;
      }
    }
    const exists = merged.some((r) => r.id === localItem.id || identityMatchesEntry(r, localItem));
    if (!exists) {
      merged.push({ ...localItem });
    }
  });
  return merged;
}

function mergeIdentityLists(serverList, localList, serverMonitoring = []) {
  const merged = Array.isArray(serverList) ? serverList.map((item) => ({ ...item })) : [];
  (Array.isArray(localList) ? localList : []).forEach((localItem) => {
    const resetMon = (Array.isArray(serverMonitoring) ? serverMonitoring : []).find(
      (m) => identityMatchesEntry(m, localItem) && Number(m.loginResetAt || 0) > 0
    );
    if (resetMon && Number(localItem.registeredAt || 0) <= Number(resetMon.loginResetAt || 0)) {
      return;
    }
    if (!merged.some((u) => identityMatchesEntry(u, localItem))) {
      merged.push({ ...localItem });
    }
  });
  return merged;
}

async function syncAdminStateFromServer(showFeedbackToast = false) {
  if (!state.adminUnlocked || !state.adminToken || state.adminSyncInFlight) return false;
  state.adminSyncInFlight = true;
  try {
    if (state.pendingFinishSyncPromise) {
      await state.pendingFinishSyncPromise.catch(() => {});
    }
    const response = await fetch('/api/cbt/admin/state', {
      headers: getAdminRequestHeaders(),
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) {
      handleAdminUnauthorized();
      return false;
    }
    if (!response.ok) return false;
    const data = await response.json();
    if (!data || typeof data !== 'object') return false;

    const epochAdvanced = applyResetEpochFromServer(data.resetEpoch);
    const localMon = epochAdvanced ? [] : readStorage(STORAGE_KEYS.MONITORING, []);
    const localRes = epochAdvanced ? [] : readStorage(STORAGE_KEYS.RESULTS, []);
    const localUsed = epochAdvanced ? [] : readStorage(STORAGE_KEYS.USED_IDENTITIES, []);

    state.monitoring = mergeMonitoringLists(data.monitoring, localMon);
    state.results = mergeResultLists(data.results, localRes, data.monitoring);
    state.usedIdentities = mergeIdentityLists(data.usedIdentities, localUsed, data.monitoring);

    writeStorage(STORAGE_KEYS.MONITORING, state.monitoring);
    writeStorage(STORAGE_KEYS.RESULTS, state.results);
    writeStorage(STORAGE_KEYS.USED_IDENTITIES, state.usedIdentities);

    if (data.tokenConfig && typeof data.tokenConfig === 'object') {
      state.tokenConfig = {
        ...data.tokenConfig,
        classTokensPublic: data.tokenConfig.classTokens || {},
      };
      writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
      renderClassDropdowns();
    }

    if (Array.isArray(data.materialResources)) {
      state.materialResources = data.materialResources;
    }

    if (data.settings && typeof data.settings === 'object' && !isSyllabusDirty()) {
      state.settings = {
        ...state.settings,
        ...data.settings,
      };
      writeStorage(STORAGE_KEYS.SETTINGS, state.settings);
    }

    if (state.currentView === 'admin') {
      renderAdminResultsTable();
      renderAdminMonitoringTable();
      renderAdminTokenPanel();
      renderAdminMaterialResources();
    }

    if (showFeedbackToast) {
      showToast('Data monitoring dan hasil siswa diperbarui dari server.', 'success');
    }
    return true;
  } catch {
    if (showFeedbackToast) {
      renderAdminMonitoringTable();
      renderAdminResultsTable();
      showToast('Menampilkan data monitoring lokal (koneksi server tidak tersedia).', 'default');
    }
    return false;
  } finally {
    state.adminSyncInFlight = false;
  }
}

async function pushAdminConfigToServer(payload = {}) {
  if (!state.adminUnlocked || !state.adminToken) return false;
  try {
    const response = await fetch('/api/cbt/admin/config', {
      method: 'POST',
      headers: getAdminRequestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (response.status === 401 || response.status === 403) {
      handleAdminUnauthorized();
      return false;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (data?.error) {
        showToast(data.error, 'error');
      }
      await syncAdminStateFromServer();
      return false;
    }
    if (data?.tokenConfig) {
      state.tokenConfig = {
        ...data.tokenConfig,
        classTokensPublic: data.tokenConfig.classTokens || {},
      };
      writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
      renderClassDropdowns();
      if (state.currentView === 'admin') renderAdminTokenPanel();
      renderLoginTokenField();
    }
    return true;
  } catch {
    return false;
  }
}

/* ==================== INITIALIZATION ==================== */
async function initApp() {
  state.student = readStorage(STORAGE_KEYS.STUDENT, null);
  state.session = readStorage(STORAGE_KEYS.SESSION, null);
  state.results = readStorage(STORAGE_KEYS.RESULTS, []);
  state.usedIdentities = readStorage(STORAGE_KEYS.USED_IDENTITIES, []);
  state.monitoring = readStorage(STORAGE_KEYS.MONITORING, []);
  state.resetEpoch = Number(readStorage(STORAGE_KEYS.RESET_EPOCH, 0) || 0);
  state.adminUnlocked = false;
  state.adminToken = null;
  loadExamSettings();
  loadTokenConfig();

  await loadQuestionBank();
  await syncBootstrapFromServer();
  loadStudentQuestionConfig();
  syncTopicSelectElements();
  bindEvents();
  updateGlobalMetaCounts();
  applySettingsToUI();
  renderLoginSyllabus();
  renderClassDropdowns();
  renderLoginTokenField();

  // Restore view logically (/materi/:id reader, /admin gate, or student session)
  const materialRouteId = getMaterialRouteId();
  if (materialRouteId) {
    state.activeReaderMaterialId = materialRouteId;
    switchView('material-reader');
    openMaterialReaderView(materialRouteId);
  } else if (isAdminRouteUrl()) {
    switchView('admin-gate');
    openAdminPortal();
  } else if (state.session && state.student && state.session.studentNisn === state.student.nisn) {
    // Check if expired while away
    if (Date.now() >= state.session.endTime) {
      finishExam(true);
    } else {
      syncSessionToMonitoring('Sedang Mengerjakan', true);
      switchView('dashboard');
    }
  } else if (state.student) {
    if (!hasStudentCompletedExam(state.student)) {
      syncStudentProgressToServer(true, 'Belum Mulai');
    }
    switchView('dashboard');
  } else {
    switchView('login');
  }
}

async function loadQuestionBank(forceDefault = false) {
  if (!forceDefault) {
    const cached = readStorage(STORAGE_KEYS.QUESTIONS, null);
    const isLegacyDefaultBank65 =
      Array.isArray(cached) &&
      cached.length === 65 &&
      cached[0]?.id === 'Q001' &&
      cached[64]?.id === 'Q065';
    if (Array.isArray(cached) && cached.length > 0 && !isLegacyDefaultBank65) {
      state.questions = cached;
      return;
    }
  }

  try {
    const response = await fetch('/questions.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Gagal memuat questions.json');
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      state.questions = data;
      writeStorage(STORAGE_KEYS.QUESTIONS, data);
    }
  } catch (error) {
    console.error('Error memuat bank soal:', error);
    showToast('Gagal memuat bank soal dari questions.json.', 'error');
  }
}

function loadExamSettings() {
  const saved = readStorage(STORAGE_KEYS.SETTINGS, null);
  state.settings = {
    subject: saved?.subject || DEFAULT_SETTINGS.subject,
    mainTopic: saved?.mainTopic || DEFAULT_SETTINGS.mainTopic,
    heroSubtitle: typeof saved?.heroSubtitle === 'string' ? saved.heroSubtitle : DEFAULT_SETTINGS.heroSubtitle,
    durationMinutes: Number(saved?.durationMinutes) > 0 ? Number(saved.durationMinutes) : DEFAULT_SETTINGS.durationMinutes,
    syllabusItems:
      Array.isArray(saved?.syllabusItems) && saved.syllabusItems.length > 0
        ? saved.syllabusItems
        : [...DEFAULT_SETTINGS.syllabusItems],
    pedomanPenulisan: typeof saved?.pedomanPenulisan === 'string' ? saved.pedomanPenulisan : '',
    activeMaterialId: typeof saved?.activeMaterialId === 'string' ? saved.activeMaterialId : null,
    activeMaterialTitle: typeof saved?.activeMaterialTitle === 'string' ? saved.activeMaterialTitle : '',
    activeMaterialUrl: typeof saved?.activeMaterialUrl === 'string' ? saved.activeMaterialUrl : '',
  };
}

function renderLoginSyllabus() {
  if (!state.settings) loadExamSettings();
  const listEl = document.getElementById('login-syllabus-list');
  if (listEl) {
    listEl.innerHTML = state.settings.syllabusItems
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');
  }

  const subjectEl = document.getElementById('login-subject-label');
  if (subjectEl) subjectEl.textContent = state.settings.subject;

  const loginHeadingEl = document.getElementById('login-heading');
  if (loginHeadingEl) {
    loginHeadingEl.textContent = `Ujian Online ${state.settings.subject}`;
  }
}

function getDefaultStudentQuestionIds() {
  return state.questions
    .slice(0, Math.min(DEFAULT_STUDENT_QUESTION_COUNT, state.questions.length))
    .map((q) => q.id);
}

function loadStudentQuestionConfig() {
  const saved = readStorage(STORAGE_KEYS.STUDENT_QUESTIONS, null);
  const validIds = new Set(state.questions.map((q) => q.id));
  const defaultIds = getDefaultStudentQuestionIds();
  const isLegacyDefault = !saved || (saved.version !== 2 && !saved.userCustomized);

  if (isLegacyDefault) {
    state.studentQuestionConfig = {
      mode: 'preset50',
      selectedIds: defaultIds,
      orderMode: saved?.orderMode === 'ordered' ? 'ordered' : 'shuffle',
      version: 2,
      userCustomized: false,
      updatedAt: saved?.updatedAt || null,
    };
  } else {
    const mode = saved.mode === 'custom' || saved.mode === 'all' || saved.mode === 'preset50' ? saved.mode : 'preset50';
    let rawSelected = Array.isArray(saved.selectedIds)
      ? saved.selectedIds.filter((id) => validIds.has(id))
      : defaultIds;
    if (mode === 'preset50') {
      rawSelected = defaultIds;
    } else if (mode === 'all') {
      rawSelected = state.questions.map((q) => q.id);
    } else if (rawSelected.length === 0 && defaultIds.length > 0) {
      rawSelected = defaultIds;
    }

    state.studentQuestionConfig = {
      mode,
      selectedIds: rawSelected,
      orderMode: saved.orderMode === 'ordered' ? 'ordered' : 'shuffle',
      version: 2,
      userCustomized: Boolean(saved.userCustomized),
      updatedAt: saved.updatedAt || null,
    };
  }

  state.draftStudentQuestionConfig = {
    mode: state.studentQuestionConfig.mode,
    selectedIds: [...state.studentQuestionConfig.selectedIds],
    orderMode: state.studentQuestionConfig.orderMode,
  };
}

function getActiveStudentQuestions() {
  if (!state.studentQuestionConfig) loadStudentQuestionConfig();
  if (state.studentQuestionConfig.mode === 'all') {
    return [...state.questions];
  }
  if (state.studentQuestionConfig.mode === 'preset50') {
    return state.questions.slice(0, Math.min(DEFAULT_STUDENT_QUESTION_COUNT, state.questions.length));
  }
  const selectedSet = new Set(state.studentQuestionConfig.selectedIds || []);
  return state.questions.filter((q) => selectedSet.has(q.id));
}

function updateGlobalMetaCounts() {
  const total = getActiveStudentQuestions().length;
  const duration = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;
  const loginCountEl = document.getElementById('login-question-count');
  if (loginCountEl) {
    loginCountEl.textContent = `${total} Butir Soal · ${duration} Menit`;
  }
}

function applySettingsToUI() {
  if (!state.settings) loadExamSettings();
  renderLoginSyllabus();
  updateGlobalMetaCounts();

  const dashSubject = document.getElementById('dash-subject');
  const dashTopic = document.getElementById('dash-main-topic');
  const dashDuration = document.getElementById('dash-duration');
  if (dashSubject) dashSubject.textContent = state.settings.subject;
  if (dashTopic) dashTopic.textContent = state.settings.mainTopic;
  if (dashDuration) dashDuration.textContent = `${state.settings.durationMinutes} Menit`;

  if (state.currentView === 'submitted') renderSubmittedView();
  if (state.currentView === 'result') renderResultView();
}

/* ==================== NAVIGATION & VIEW SWITCHING ==================== */
function switchView(viewName) {
  if (viewName === 'admin' && !state.adminUnlocked) {
    openAdminPortal();
    return;
  }
  if (viewName === 'result' && !state.adminUnlocked) {
    viewName = state.student ? 'dashboard' : 'login';
  }
  if (
    state.currentView === 'exam' &&
    state.session &&
    viewName !== 'exam' &&
    viewName !== 'submitted' &&
    !(viewName === 'admin' && state.adminUnlocked)
  ) {
    showToast('Selesaikan dan kumpulkan ujian terlebih dahulu sebelum keluar dari ruang ujian.', 'error');
    return;
  }

  state.currentView = viewName;

  document.querySelectorAll('.view').forEach((el) => {
    el.classList.remove('active');
  });

  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.classList.add('active');
  }

  // Stop timer if leaving exam view (timer timestamp stays accurate in localStorage)
  if (viewName !== 'exam' && state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }

  // Stop monitoring refresh loop if leaving admin view
  if (viewName !== 'admin' && state.monitoringIntervalId) {
    clearInterval(state.monitoringIntervalId);
    state.monitoringIntervalId = null;
  }

  // Stop submitted resume poll if leaving submitted view
  if (viewName !== 'submitted' && state.resumePollIntervalId) {
    clearInterval(state.resumePollIntervalId);
    state.resumePollIntervalId = null;
  }

  // Render view-specific data
  if (viewName === 'login') {
    renderLoginTokenField();
    syncBootstrapFromServer().then((ok) => {
      if (ok && state.currentView === 'login') {
        loadStudentQuestionConfig();
        applySettingsToUI();
        renderLoginSyllabus();
        renderLoginTokenField();
      }
    });
  }
  if (viewName === 'dashboard') renderDashboard();
  if (viewName === 'exam') renderExamView();
  if (viewName === 'submitted') renderSubmittedView();
  if (viewName === 'result') renderResultView();
  if (viewName === 'admin') {
    renderAdminView();
    startMonitoringRefreshLoop();
  }

  updateTopbar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateTopbar() {
  const navLogin = document.getElementById('nav-login');
  const navDashboard = document.getElementById('nav-dashboard');
  const navExam = document.getElementById('nav-exam');
  const navAdmin = document.getElementById('nav-admin');
  const topbarBtn = document.getElementById('topbar-primary-btn');

  const hasStudent = Boolean(state.student);
  const hasSession = Boolean(state.session && state.student && state.session.studentNisn === state.student.nisn);
  const inActiveExam = state.currentView === 'exam' && hasSession;
  const onAdminRoute = isAdminRouteUrl();
  const isReaderScreen = state.currentView === 'material-reader';
  const isAdminScreen =
    state.currentView === 'admin' ||
    state.currentView === 'result' ||
    state.currentView === 'admin-gate';

  navLogin.classList.toggle('hidden', hasStudent || isAdminScreen || onAdminRoute || isReaderScreen);
  navDashboard.classList.toggle('hidden', !hasStudent || inActiveExam || isAdminScreen || isReaderScreen);
  navExam.classList.toggle('hidden', !hasSession || isAdminScreen || isReaderScreen);
  navAdmin.classList.toggle('hidden', !state.adminUnlocked && !onAdminRoute && state.currentView !== 'admin-gate');

  [navLogin, navDashboard, navExam, navAdmin].forEach((btn) => {
    const isAdminTab = btn.dataset.nav === 'admin';
    const isActive = isAdminTab
      ? state.currentView === 'admin' || state.currentView === 'admin-gate'
      : btn.dataset.nav === state.currentView;
    btn.classList.toggle('active', isActive);
  });

  if (state.currentView === 'admin' || state.currentView === 'result') {
    topbarBtn.classList.remove('hidden');
    topbarBtn.textContent = 'Keluar Admin';
  } else if (state.currentView === 'admin-gate') {
    topbarBtn.classList.remove('hidden');
    topbarBtn.textContent = 'Masuk Admin';
  } else if (hasStudent && !inActiveExam && !isReaderScreen) {
    topbarBtn.classList.remove('hidden');
    topbarBtn.textContent = 'Ganti Akun';
  } else {
    topbarBtn.classList.add('hidden');
  }
}

/* ==================== EVENT BINDINGS ==================== */
function bindEvents() {
  // Brand Home
  document.getElementById('brand-home-link').addEventListener('click', (e) => {
    e.preventDefault();
    if (state.currentView === 'exam') return;
    if (state.adminUnlocked) {
      switchView('admin');
      return;
    }
    if (isAdminRouteUrl() || state.currentView === 'admin-gate') {
      switchView('admin-gate');
      openAdminPortal();
      return;
    }
    navigateToStudentFrontWeb();
  });

  // Topbar Nav Links
  document.querySelectorAll('.nav-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.nav;
      if (target === 'admin') {
        openAdminPortal();
      } else {
        switchView(target);
      }
    });
  });

  // Topbar Primary Action
  document.getElementById('topbar-primary-btn').addEventListener('click', () => {
    if (state.currentView === 'admin' || state.currentView === 'result') {
      exitAdmin();
    } else if (state.currentView === 'admin-gate') {
      openAdminPortal();
    } else if (state.student) {
      logoutStudent();
    }
  });

  // Login Form (khusus siswa, tanpa akses Portal Admin)
  document.getElementById('login-form').addEventListener('submit', handleStudentLogin);

  // Dedicated Admin Gate (/admin) & Material Reader (/materi/:id)
  document.getElementById('btn-admin-gate-login')?.addEventListener('click', openAdminPortal);
  document.getElementById('btn-admin-gate-to-student')?.addEventListener('click', navigateToStudentFrontWeb);
  document.getElementById('btn-copy-admin-url')?.addEventListener('click', () => {
    copyTextToClipboard(getDedicatedAdminUrl(), 'Link khusus Portal Admin berhasil disalin.');
  });
  document.getElementById('btn-copy-reader-link')?.addEventListener('click', () => {
    const url = state.activeReaderMaterialId ? getMaterialAccessUrl(state.activeReaderMaterialId) : window.location.href;
    copyTextToClipboard(url, 'Link akses materi berhasil disalin.');
  });
  document.getElementById('btn-reader-back-home')?.addEventListener('click', navigateToStudentFrontWeb);

  const handleRouteSync = () => {
    if (state.currentView === 'exam') return;
    const matId = getMaterialRouteId();
    if (matId) {
      state.activeReaderMaterialId = matId;
      switchView('material-reader');
      openMaterialReaderView(matId);
      return;
    }
    if (isAdminRouteUrl()) {
      if (state.adminUnlocked) {
        switchView('admin');
      } else {
        switchView('admin-gate');
        openAdminPortal();
      }
    } else if (state.currentView === 'admin-gate' || state.currentView === 'material-reader') {
      navigateToStudentFrontWeb();
    }
  };
  window.addEventListener('hashchange', handleRouteSync);
  window.addEventListener('popstate', handleRouteSync);

  // Dashboard Actions
  document.getElementById('btn-logout-student').addEventListener('click', logoutStudent);
  document.getElementById('btn-start-exam').addEventListener('click', handleStartOrResumeExam);
  document.getElementById('btn-reset-session').addEventListener('click', () => {
    const durationMins = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;
    openConfirmModal(
      'Mulai Ulang Sesi Baru?',
      `Progres ujian yang tersimpan sebelumnya akan dihapus dan soal akan diacak ulang dengan waktu ${durationMins} menit penuh.`,
      () => {
        removeStorage(STORAGE_KEYS.SESSION);
        state.session = null;
        startNewExamSession();
      }
    );
  });

  // Exam Controls
  document.getElementById('btn-prev-question').addEventListener('click', () => navigateQuestion(-1));
  document.getElementById('btn-next-question').addEventListener('click', () => navigateQuestion(1));
  document.getElementById('btn-flag-question').addEventListener('click', toggleFlagCurrentQuestion);
  document.getElementById('btn-finish-exam-top').addEventListener('click', promptFinishExam);
  document.getElementById('btn-finish-exam-sidebar').addEventListener('click', promptFinishExam);
  document.getElementById('btn-submit-exam-last').addEventListener('click', promptFinishExam);

  // Submitted Confirmation Controls
  document.getElementById('btn-submitted-check-resume')?.addEventListener('click', () => {
    checkAndResumeUnlockedExam(true);
  });
  document.getElementById('btn-submitted-dashboard').addEventListener('click', () => {
    switchView('dashboard');
  });
  document.getElementById('btn-submitted-logout').addEventListener('click', logoutStudent);

  // Result Controls (Admin)
  document.getElementById('btn-result-back-admin').addEventListener('click', () => {
    state.resultOpenedFromAdmin = false;
    switchView('admin');
  });
  document.getElementById('btn-print-result').addEventListener('click', () => window.print());
  document.getElementById('btn-download-pdf').addEventListener('click', handleDownloadPdf);
  document.getElementById('btn-retake-test').addEventListener('click', () => {
    const durationMins = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;
    openConfirmModal(
      'Ulangi Tes Sekarang?',
      `Anda akan memulai tes baru dengan urutan soal acak dan timer ${durationMins} menit.`,
      () => {
        if (!state.student && state.activeResult) {
          state.student = {
            nama: state.activeResult.nama,
            username: state.activeResult.username,
            nisn: state.activeResult.nisn,
            absen: state.activeResult.absen || '-',
            loggedInAt: Date.now(),
          };
          writeStorage(STORAGE_KEYS.STUDENT, state.student);
        }
        startNewExamSession();
      }
    );
  });

  document.querySelectorAll('[data-res-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.resultFilter = btn.dataset.resFilter;
      document.querySelectorAll('[data-res-filter]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderResultSummaryList();
    });
  });

  // Admin Tabs & Actions
  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.adminTab = btn.dataset.adminTab;
      document.querySelectorAll('[data-admin-tab]').forEach((b) => {
        const isActive = b.dataset.adminTab === state.adminTab;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', String(isActive));
      });
      document.getElementById('admin-panel-results').classList.toggle('active', state.adminTab === 'results');
      document.getElementById('admin-panel-monitoring').classList.toggle('active', state.adminTab === 'monitoring');
      document.getElementById('admin-panel-questions').classList.toggle('active', state.adminTab === 'questions');
      document.getElementById('admin-panel-syllabus').classList.toggle('active', state.adminTab === 'syllabus');
      document.getElementById('admin-panel-token').classList.toggle('active', state.adminTab === 'token');
      if (state.adminTab === 'results') {
        renderAdminResultsTable();
        syncAdminStateFromServer();
      }
      if (state.adminTab === 'monitoring') {
        renderAdminMonitoringTable();
        syncAdminStateFromServer();
      }
      if (state.adminTab === 'questions') {
        renderAiGeneratorPanel();
        renderAdminQuestionList();
      }
      if (state.adminTab === 'syllabus') {
        renderAdminSyllabusPanel();
      }
      if (state.adminTab === 'token') {
        renderAdminTokenPanel();
        syncAdminStateFromServer();
      }
    });
  });

  document.getElementById('btn-add-syllabus-item').addEventListener('click', handleAddSyllabusItem);
  document.getElementById('admin-new-syllabus-item').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddSyllabusItem();
    }
  });
  document.getElementById('admin-syllabus-form').addEventListener('submit', handleSaveSyllabus);
  document.getElementById('btn-save-syllabus').addEventListener('click', handleSaveSyllabus);
  document.getElementById('btn-cancel-syllabus-edit').addEventListener('click', handleCancelSyllabusEdit);
  ['admin-set-subject', 'admin-set-duration', 'admin-set-main-topic', 'admin-set-pedoman'].forEach((fieldId) => {
    document.getElementById(fieldId)?.addEventListener('input', updateSyllabusDirtyState);
  });

  // Upload Materi PDF & Link Website + Generate Link Akses
  document.getElementById('btn-upload-pdf-material')?.addEventListener('click', handleUploadPdfMaterial);
  document.getElementById('btn-extract-url-material')?.addEventListener('click', () => handleSubmitUrlMaterial(true));
  document.getElementById('btn-generate-url-link-only')?.addEventListener('click', () => handleSubmitUrlMaterial(false));
  document.getElementById('btn-copy-preview-access-link')?.addEventListener('click', () => {
    const linkText = (document.getElementById('admin-material-preview-link')?.textContent || '').trim();
    if (linkText && linkText !== '-') {
      copyTextToClipboard(linkText, 'Link akses materi berhasil disalin.');
    }
  });
  document.getElementById('btn-apply-material-to-syllabus')?.addEventListener('click', () => {
    if (state.previewMaterialId) {
      applyMaterialResourceToSyllabus(state.previewMaterialId, true);
    }
  });
  document.getElementById('btn-import-material-questions')?.addEventListener('click', () => {
    if (state.previewMaterialId) {
      importDetectedQuestionsFromMaterial(state.previewMaterialId);
    }
  });
  document.getElementById('btn-reset-syllabus').addEventListener('click', () => {
    openConfirmModal(
      'Reset Cakupan Materi ke Default?',
      'Mata pelajaran, materi pokok, waktu ujian, dan daftar cakupan materi akan dikembalikan ke pengaturan awal.',
      () => {
        removeStorage(STORAGE_KEYS.SETTINGS);
        loadExamSettings();
        renderAdminSyllabusPanel();
        applySettingsToUI();
        pushAdminConfigToServer({ settings: state.settings });
        showToast('Cakupan materi berhasil dikembalikan ke default.', 'success');
      }
    );
  });

  document.getElementById('btn-exit-admin').addEventListener('click', exitAdmin);
  const btnAdminPinManage = document.getElementById('btn-admin-pin-manage');
  if (btnAdminPinManage) {
    btnAdminPinManage.addEventListener('click', openAdminPinManageModal);
  }
  const resultClassFilterEl = document.getElementById('admin-result-filter-class');
  if (resultClassFilterEl) {
    resultClassFilterEl.addEventListener('change', (e) => {
      state.adminResultClassFilter = e.target.value || 'ALL';
      renderAdminResultsTable();
    });
  }
  document.getElementById('admin-result-search').addEventListener('input', renderAdminResultsTable);
  document.getElementById('btn-export-results-xls').addEventListener('click', exportResultsToExcel);
  document.getElementById('btn-export-results-csv').addEventListener('click', exportResultsToCsv);
  document.getElementById('btn-reset-login-locks').addEventListener('click', () => {
    openConfirmModal(
      'Reset Akses Login Peserta?',
      'Daftar identitas peserta yang sudah pernah login akan dibuka kembali sehingga siswa dapat melakukan login ulang jika diperlukan.',
      async () => {
        try {
          const response = await fetch('/api/cbt/admin/reset-locks', {
            method: 'POST',
            headers: getAdminRequestHeaders(),
          });
          if (response.status === 401 || response.status === 403) {
            handleAdminUnauthorized();
            return;
          }
          const data = await response.json().catch(() => ({}));
          if (data?.resetEpoch) {
            state.resetEpoch = Number(data.resetEpoch);
            writeStorage(STORAGE_KEYS.RESET_EPOCH, state.resetEpoch);
          }
        } catch {
          // Lanjutkan reset lokal jika server tidak terjangkau
        }
        state.usedIdentities = [];
        writeStorage(STORAGE_KEYS.USED_IDENTITIES, []);
        renderAdminMonitoringTable();
        showToast('Akses login peserta berhasil direset.', 'success');
      }
    );
  });
  document.getElementById('btn-clear-results').addEventListener('click', () => {
    openConfirmModal(
      'Hapus Semua Hasil Penilaian?',
      'Seluruh riwayat nilai siswa, data monitoring pengerjaan, dan kunci akses login peserta yang tersimpan akan dihapus permanen.',
      async () => {
        try {
          const response = await fetch('/api/cbt/admin/clear-results', {
            method: 'POST',
            headers: getAdminRequestHeaders(),
          });
          if (response.status === 401 || response.status === 403) {
            handleAdminUnauthorized();
            return;
          }
          const data = await response.json().catch(() => ({}));
          if (data?.resetEpoch) {
            state.resetEpoch = Number(data.resetEpoch);
            writeStorage(STORAGE_KEYS.RESET_EPOCH, state.resetEpoch);
          }
          if (data?.tokenConfig) {
            state.tokenConfig = data.tokenConfig;
            writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
          }
        } catch {
          // Lanjutkan reset lokal jika server tidak terjangkau
        }
        state.results = [];
        state.usedIdentities = [];
        state.monitoring = [];
        writeStorage(STORAGE_KEYS.RESULTS, []);
        writeStorage(STORAGE_KEYS.USED_IDENTITIES, []);
        writeStorage(STORAGE_KEYS.MONITORING, []);
        renderAdminResultsTable();
        renderAdminMonitoringTable();
        renderAdminTokenPanel();
        renderLoginTokenField();
        showToast('Seluruh hasil penilaian, monitoring, dan akses login telah direset.', 'success');
      }
    );
  });

  // Admin Monitoring Filters & Refresh
  document.getElementById('admin-monitoring-search').addEventListener('input', renderAdminMonitoringTable);
  document.getElementById('admin-monitoring-filter-status').addEventListener('change', renderAdminMonitoringTable);
  document.getElementById('btn-refresh-monitoring').addEventListener('click', () => {
    syncAdminStateFromServer(true);
  });

  // Admin Bank Soal Filters, Menu Perubahan Soal Siswa & CRUD
  document.getElementById('admin-q-search').addEventListener('input', renderAdminQuestionList);
  document.getElementById('admin-q-filter-type').addEventListener('change', renderAdminQuestionList);
  document.getElementById('admin-q-filter-topic').addEventListener('change', renderAdminQuestionList);
  document.getElementById('admin-q-filter-student-status').addEventListener('change', renderAdminQuestionList);
  document.getElementById('btn-toggle-ai-gen-menu').addEventListener('click', () => {
    state.aiGenMenuOpen = !state.aiGenMenuOpen;
    const panel = document.getElementById('ai-generate-menu-panel');
    if (panel) panel.classList.toggle('hidden', !state.aiGenMenuOpen);
  });
  document.getElementById('btn-ai-goto-syllabus').addEventListener('click', () => {
    const syllabusTabBtn = document.querySelector('[data-admin-tab="syllabus"]');
    if (syllabusTabBtn) syllabusTabBtn.click();
  });
  document.getElementById('btn-open-kisi-kisi-header')?.addEventListener('click', openKisiKisiModal);
  document.getElementById('btn-open-kisi-kisi-modal')?.addEventListener('click', openKisiKisiModal);
  document.getElementById('kisi-logo-file')?.addEventListener('change', handleKisiLogoFileChange);
  document.getElementById('btn-kisi-logo-clear')?.addEventListener('click', clearKisiLogo);
  document.getElementById('btn-refresh-kisi-preview')?.addEventListener('click', renderKisiKisiPreview);
  document.getElementById('btn-download-kisi-pdf')?.addEventListener('click', downloadKisiKisiPdf);
  [
    'kisi-kop-institution',
    'kisi-kop-school',
    'kisi-kop-address',
    'kisi-title',
    'kisi-subject',
    'kisi-main-topic',
    'kisi-teacher-name',
    'kisi-academic-year',
    'kisi-class-level',
    'kisi-question-scope',
    'kisi-include-key-col',
    'kisi-include-signature',
  ].forEach((fieldId) => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    const evtName = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(evtName, () => {
      saveKisiKisiFormToStorage();
      renderKisiKisiPreview();
    });
  });
  document.getElementById('ai-gen-target-mode').addEventListener('change', (e) => {
    const customBox = document.getElementById('ai-gen-custom-counts');
    if (customBox) customBox.classList.toggle('hidden', e.target.value !== 'custom');
  });
  document.getElementById('btn-run-ai-generate').addEventListener('click', promptGenerateAiQuestions);
  document.getElementById('btn-cancel-ai-gen').addEventListener('click', cancelAiQuestionGeneration);
  document.getElementById('btn-undo-ai-gen').addEventListener('click', undoAiQuestionGeneration);

  document.getElementById('btn-toggle-student-q-menu').addEventListener('click', () => {
    state.studentQMenuOpen = !state.studentQMenuOpen;
    const panel = document.getElementById('student-q-menu-panel');
    if (panel) panel.classList.toggle('hidden', !state.studentQMenuOpen);
  });
  document.querySelectorAll('input[name="student-q-mode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
      const val = e.target.value;
      const mode = val === 'custom' || val === 'all' ? val : 'preset50';
      state.draftStudentQuestionConfig.mode = mode;
      if (mode === 'preset50') {
        state.draftStudentQuestionConfig.selectedIds = getDefaultStudentQuestionIds();
      } else if (mode === 'all') {
        state.draftStudentQuestionConfig.selectedIds = state.questions.map((q) => q.id);
      } else if (state.draftStudentQuestionConfig.selectedIds.length === 0) {
        state.draftStudentQuestionConfig.selectedIds = getDefaultStudentQuestionIds();
      }
      renderStudentQuestionMenu();
      renderAdminQuestionList();
    });
  });
  document.getElementById('student-q-order-mode').addEventListener('change', (e) => {
    if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
    state.draftStudentQuestionConfig.orderMode = e.target.value === 'ordered' ? 'ordered' : 'shuffle';
    updateStudentQuestionDirtyState();
  });
  document.getElementById('btn-student-q-random-pick').addEventListener('click', handleRandomPickStudentQuestions);
  document.getElementById('btn-student-q-preset-50').addEventListener('click', () => {
    if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
    state.draftStudentQuestionConfig.mode = 'preset50';
    state.draftStudentQuestionConfig.selectedIds = getDefaultStudentQuestionIds();
    renderStudentQuestionMenu();
    renderAdminQuestionList();
  });
  document.getElementById('btn-student-q-select-all').addEventListener('click', () => {
    if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
    state.draftStudentQuestionConfig.mode = 'all';
    state.draftStudentQuestionConfig.selectedIds = state.questions.map((q) => q.id);
    renderStudentQuestionMenu();
    renderAdminQuestionList();
  });
  document.getElementById('btn-student-q-select-filtered').addEventListener('click', () => {
    if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
    const { list: filtered } = getFilteredAdminQuestions();
    state.draftStudentQuestionConfig.mode = 'custom';
    state.draftStudentQuestionConfig.selectedIds = filtered.map((q) => q.id);
    renderStudentQuestionMenu();
    renderAdminQuestionList();
    showToast(`${filtered.length} soal sesuai filter dipilih dalam draf. Klik Simpan Perubahan untuk menerapkan.`, 'default');
  });
  document.getElementById('btn-student-q-clear-all').addEventListener('click', () => {
    if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
    state.draftStudentQuestionConfig.mode = 'custom';
    state.draftStudentQuestionConfig.selectedIds = [];
    renderStudentQuestionMenu();
    renderAdminQuestionList();
  });
  document.getElementById('btn-cancel-student-q').addEventListener('click', handleCancelStudentQuestionsConfig);
  document.getElementById('btn-save-student-q').addEventListener('click', handleSaveStudentQuestionsConfig);

  document.getElementById('btn-add-question').addEventListener('click', () => openQuestionEditorModal(null));
  document.getElementById('btn-shuffle-question-bank').addEventListener('click', promptShuffleQuestionBank);
  document.getElementById('btn-open-paper-test-export')?.addEventListener('click', openPaperTestExportModal);
  document.getElementById('btn-student-q-open-paper-test')?.addEventListener('click', openPaperTestExportModal);
  document.getElementById('btn-download-paper-test-pdf')?.addEventListener('click', downloadPaperTestPdf);
  document.getElementById('btn-refresh-paper-preview')?.addEventListener('click', () => renderPaperTestPreview(true));
  document.getElementById('btn-paper-reshuffle')?.addEventListener('click', () => {
    state.paperTestOrderIds = null;
    renderPaperTestPreview(true);
    showToast('Urutan soal Paper Test diacak ulang.', 'default');
  });
  [
    'paper-kop-institution',
    'paper-kop-school',
    'paper-kop-address',
    'paper-kop-title',
    'paper-student-name',
    'paper-student-class',
    'paper-student-absen',
    'paper-exam-date',
    'paper-order-mode',
    'paper-include-instructions',
  ].forEach((fieldId) => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    const evtName = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(evtName, () => {
      if (fieldId === 'paper-order-mode') {
        state.paperTestOrderIds = null;
      }
      savePaperTestFormToStorage();
      renderPaperTestPreview(false);
    });
  });
  document.getElementById('btn-export-questions-pdf').addEventListener('click', exportQuestionBankToPdf);
  document.getElementById('btn-bank-export-import').addEventListener('click', openBankExportImportModal);
  document.getElementById('btn-export-bank-json').addEventListener('click', exportQuestionBankJson);
  document.getElementById('btn-export-bank-csv').addEventListener('click', exportQuestionBankCsv);
  document.getElementById('bank-import-file-input').addEventListener('change', handleBankImportFileSelect);
  document.getElementById('btn-confirm-bank-import').addEventListener('click', handleConfirmBankImport);
  document.getElementById('btn-pg-template').addEventListener('click', openPgTemplateModal);
  document.getElementById('btn-download-pg-csv').addEventListener('click', downloadPgCsvTemplate);
  document.getElementById('btn-download-pg-json').addEventListener('click', downloadPgJsonTemplate);
  document.getElementById('pg-template-file-input').addEventListener('change', handlePgTemplateFileSelect);
  document.getElementById('btn-import-pg-template').addEventListener('click', handleImportPgTemplate);
  document.getElementById('btn-apply-pg-template').addEventListener('click', applyQuickPgTemplate);
  document.getElementById('btn-reset-default-questions').addEventListener('click', () => {
    openConfirmModal(
      'Reset ke Bank Soal Default?',
      'Semua perubahan soal yang dibuat di Admin akan dikembalikan ke bank soal awal (100 soal) dengan paket ujian siswa default 50 soal.',
      async () => {
        await loadQuestionBank(true);
        resetStudentQuestionConfigToDefault();
        updateGlobalMetaCounts();
        renderStudentQuestionMenu();
        renderAdminQuestionList();
        pushAdminConfigToServer({
          questions: state.questions,
          studentQuestionConfig: state.studentQuestionConfig,
        });
        showToast('Bank soal berhasil dikembalikan ke default (50 soal aktif untuk siswa).', 'success');
      }
    );
  });

  // Question Editor Type Change & Submit
  document.getElementById('edit-q-type').addEventListener('change', () => {
    const selectedType = document.getElementById('edit-q-type').value;
    const isNew = !document.getElementById('edit-q-id').value;
    document.getElementById('pg-quick-template-bar').classList.toggle('hidden', !isNew || selectedType !== 'pg');
    renderDynamicQuestionEditor(selectedType, null);
  });
  document.getElementById('question-editor-form').addEventListener('submit', handleSaveQuestion);

  // Admin Auth Form & PIN Generator
  document.getElementById('admin-auth-form').addEventListener('submit', handleAdminLoginSubmit);
  document.getElementById('btn-toggle-admin-pin-visibility')?.addEventListener('click', () => {
    const pinInput = document.getElementById('input-admin-pin');
    const confirmInput = document.getElementById('input-admin-pin-confirm');
    const toggleBtn = document.getElementById('btn-toggle-admin-pin-visibility');
    if (!pinInput || !toggleBtn) return;
    const isHidden = pinInput.type === 'password';
    pinInput.type = isHidden ? 'text' : 'password';
    if (confirmInput && !state.adminPinConfigured) {
      confirmInput.type = isHidden ? 'text' : 'password';
    }
    toggleBtn.textContent = isHidden ? 'Sembunyikan' : 'Lihat';
  });
  document.getElementById('btn-setup-generate-admin-pin')?.addEventListener('click', () => {
    const generated = generateCryptoRandomAdminPin(8);
    const pinInput = document.getElementById('input-admin-pin');
    const confirmInput = document.getElementById('input-admin-pin-confirm');
    const toggleBtn = document.getElementById('btn-toggle-admin-pin-visibility');
    const copyBtn = document.getElementById('btn-setup-copy-admin-pin');
    const errEl = document.getElementById('admin-auth-error');
    if (pinInput) {
      pinInput.value = generated;
      pinInput.type = 'text';
    }
    if (confirmInput) {
      confirmInput.value = generated;
      confirmInput.type = 'text';
    }
    if (toggleBtn) toggleBtn.textContent = 'Sembunyikan';
    if (copyBtn) copyBtn.classList.remove('hidden');
    if (errEl) errEl.classList.add('hidden');
    showToast('PIN Admin berhasil di-generate. Salin PIN lalu klik Simpan PIN & Masuk.', 'success');
  });
  document.getElementById('btn-setup-copy-admin-pin')?.addEventListener('click', () => {
    const pinVal = (document.getElementById('input-admin-pin')?.value || '').trim();
    if (!pinVal) return;
    copyTextToClipboard(pinVal, 'PIN Admin berhasil disalin.');
  });

  // Admin PIN Manage Modal (Generate & Ubah PIN dari dalam Portal Admin)
  document.getElementById('btn-generate-new-admin-pin')?.addEventListener('click', () => {
    const generated = generateCryptoRandomAdminPin(8);
    const newPinInput = document.getElementById('input-new-admin-pin');
    const confirmPinInput = document.getElementById('input-new-admin-pin-confirm');
    const errEl = document.getElementById('admin-pin-manage-error');
    const savedBox = document.getElementById('admin-pin-saved-box');
    const savedExitBtn = document.getElementById('btn-pin-saved-exit-admin');
    if (newPinInput) newPinInput.value = generated;
    if (confirmPinInput) confirmPinInput.value = generated;
    if (errEl) errEl.classList.add('hidden');
    if (savedBox) savedBox.classList.add('hidden');
    if (savedExitBtn) savedExitBtn.classList.add('hidden');
    showToast('PIN Admin baru siap. Klik "Simpan PIN Baru" untuk mengaktifkan.', 'success');
  });
  document.getElementById('btn-copy-new-admin-pin')?.addEventListener('click', () => {
    const val = (document.getElementById('input-new-admin-pin')?.value || '').trim();
    if (!val) {
      showToast('Isi atau Generate PIN terlebih dahulu.', 'error');
      return;
    }
    copyTextToClipboard(val, 'PIN Admin baru berhasil disalin.');
  });
  document.getElementById('btn-instant-generate-admin-pin')?.addEventListener('click', () => {
    submitAdminPinChange({ mode: 'generate' });
  });
  document.getElementById('admin-pin-manage-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const newPin = (document.getElementById('input-new-admin-pin')?.value || '').trim();
    const confirmPin = (document.getElementById('input-new-admin-pin-confirm')?.value || '').trim();
    const errEl = document.getElementById('admin-pin-manage-error');
    if (newPin.length < 6) {
      if (errEl) {
        errEl.textContent = 'PIN Admin baru harus terdiri dari minimal 6 karakter.';
        errEl.classList.remove('hidden');
      }
      return;
    }
    if (newPin !== confirmPin) {
      if (errEl) {
        errEl.textContent = 'Konfirmasi PIN Admin baru tidak sama.';
        errEl.classList.remove('hidden');
      }
      return;
    }
    submitAdminPinChange({ mode: 'custom', pin: newPin });
  });
  document.getElementById('btn-copy-saved-admin-pin')?.addEventListener('click', () => {
    const code = (document.getElementById('admin-pin-saved-code')?.textContent || '').trim();
    if (!code || code === '--------') return;
    copyTextToClipboard(code, 'PIN Admin aktif berhasil disalin.');
  });
  document.getElementById('btn-pin-saved-exit-admin')?.addEventListener('click', () => {
    closeModal('modal-admin-pin-manage');
    exitAdmin();
    showToast(
      'Anda telah keluar dari Portal Admin. Buka link khusus Portal Admin dan masukkan PIN baru Anda.',
      'success'
    );
  });

  // Token Login Input Uppercase Formatting & Class Live Token Hint
  document.getElementById('input-token').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  const classSelectEl = document.getElementById('input-nisn');
  classSelectEl.addEventListener('change', () => {
    renderLoginTokenField();
    if (classSelectEl.value) {
      syncBootstrapFromServer().then((ok) => {
        if (ok && state.currentView === 'login') {
          renderLoginTokenField();
        }
      });
    }
  });
  classSelectEl.addEventListener('input', () => {
    renderLoginTokenField();
  });

  // Admin Token Actions & Mode Per Kelas
  document.querySelectorAll('[data-token-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleSwitchTokenMode(btn.dataset.tokenMode);
    });
  });
  document.querySelectorAll('[data-class-grade-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.adminClassGradeFilter = btn.dataset.classGradeFilter || 'ALL';
      document.querySelectorAll('[data-class-grade-filter]').forEach((b) => {
        b.classList.toggle('active', b.dataset.classGradeFilter === state.adminClassGradeFilter);
      });
      renderAdminClassTokensTable();
    });
  });
  document.getElementById('btn-apply-class-preset')?.addEventListener('click', handleApplyClassPreset);
  document.getElementById('btn-add-class-to-list')?.addEventListener('click', handleAddClassToList);
  document.getElementById('admin-add-class-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddClassToList();
    }
  });
  document.getElementById('btn-batch-generate-class-tokens')?.addEventListener('click', handleBatchGenerateClassTokens);
  document.getElementById('btn-batch-enable-class-tokens')?.addEventListener('click', () => handleBatchToggleClassTokens(true));
  document.getElementById('btn-batch-disable-class-tokens')?.addEventListener('click', () => handleBatchToggleClassTokens(false));

  document.getElementById('btn-reset-token').addEventListener('click', handleResetExamToken);
  document.getElementById('btn-reactivate-token').addEventListener('click', handleReactivateExamToken);
  document.getElementById('btn-copy-token').addEventListener('click', handleCopyExamToken);
  document.getElementById('btn-save-custom-token').addEventListener('click', handleSaveCustomToken);
  document.getElementById('btn-save-token-target').addEventListener('click', handleSaveTokenTargetCount);
  document.getElementById('admin-token-required').addEventListener('change', handleTokenVisibilityOrRequiredChange);
  document.getElementById('admin-token-show-on-login').addEventListener('change', handleTokenVisibilityOrRequiredChange);
  document.getElementById('admin-token-per-class')?.addEventListener('change', handleTokenVisibilityOrRequiredChange);
  document.getElementById('admin-token-auto-stop').addEventListener('change', handleTokenVisibilityOrRequiredChange);
  document.getElementById('admin-class-token-code')?.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  document.getElementById('btn-add-class-token')?.addEventListener('click', handleAddOrGenerateClassToken);

  // Modal Close Buttons
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });

  // Confirm Modal Actions
  document.getElementById('btn-confirm-cancel').addEventListener('click', () => closeModal('modal-confirm'));
  document.getElementById('btn-confirm-ok').addEventListener('click', () => {
    const cb = state.confirmCallback;
    closeModal('modal-confirm');
    if (typeof cb === 'function') cb();
  });

  // Exam Security Warning Modal Action
  document.getElementById('btn-ack-exam-warning').addEventListener('click', () => {
    closeModal('modal-exam-warning');
    requestExamFullscreen();
  });

  // Initialize anti-new-tab & 6x warning listeners
  initExamSecurityListeners();

  // Window resize redraw charts if in result view
  window.addEventListener('resize', () => {
    if (state.currentView === 'result' && state.activeResult) {
      drawResultCharts(state.activeResult);
    }
  });

  // Live cross-tab sync for Admin Monitoring, Results & Exam Settings
  window.addEventListener('storage', (e) => {
    if (
      e.key === STORAGE_KEYS.MONITORING ||
      e.key === STORAGE_KEYS.RESULTS ||
      e.key === STORAGE_KEYS.SESSION ||
      e.key === STORAGE_KEYS.USED_IDENTITIES ||
      e.key === STORAGE_KEYS.TOKEN ||
      e.key === STORAGE_KEYS.SETTINGS ||
      e.key === STORAGE_KEYS.QUESTIONS ||
      e.key === STORAGE_KEYS.STUDENT_QUESTIONS
    ) {
      state.results = readStorage(STORAGE_KEYS.RESULTS, []);
      state.usedIdentities = readStorage(STORAGE_KEYS.USED_IDENTITIES, []);
      state.monitoring = readStorage(STORAGE_KEYS.MONITORING, []);
      const cachedQ = readStorage(STORAGE_KEYS.QUESTIONS, null);
      if (Array.isArray(cachedQ) && cachedQ.length > 0) state.questions = cachedQ;
      loadExamSettings();
      loadStudentQuestionConfig();
      applySettingsToUI();
      loadTokenConfig();
      renderClassDropdowns();
      renderLoginTokenField();
      if (state.currentView === 'dashboard') {
        renderDashboard();
      }
      if (state.currentView === 'admin') {
        renderAdminResultsTable();
        renderAdminMonitoringTable();
        syncTopicSelectElements();
        renderAiGeneratorPanel();
        renderStudentQuestionMenu();
        renderAdminQuestionList();
        renderAdminSyllabusPanel();
        renderAdminTokenPanel();
      }
    }
  });
}

/* ==================== LOGIN & DASHBOARD ==================== */
function normalizeIdentityVal(val) {
  return String(val || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function identityMatchesEntry(entry, candidate) {
  if (!entry || !candidate) return false;
  const eUser = normalizeIdentityVal(entry.username);
  const cUser = normalizeIdentityVal(candidate.username);
  const eNama = normalizeIdentityVal(entry.nama);
  const cNama = normalizeIdentityVal(candidate.nama);
  const eKelas = normalizeIdentityVal(entry.nisn);
  const cKelas = normalizeIdentityVal(candidate.nisn);
  const eAbsen = String(entry.absen || '').trim();
  const cAbsen = String(candidate.absen || '').trim();

  if (eUser && cUser && eUser === cUser) return true;
  if (eKelas && cKelas && eAbsen && cAbsen && eKelas === cKelas && eAbsen === cAbsen) return true;
  if (eNama && cNama && eKelas && cKelas && eNama === cNama && eKelas === cKelas) return true;
  return false;
}

function isStudentIdentityUsed(candidate) {
  const usedList = state.usedIdentities || [];
  const resultsList = state.results || [];
  return (
    usedList.some((entry) => identityMatchesEntry(entry, candidate)) ||
    resultsList.some((entry) => identityMatchesEntry(entry, candidate))
  );
}

function hasStudentCompletedExam(student) {
  if (!student) return false;
  return (state.results || []).some((entry) => identityMatchesEntry(entry, student));
}

async function handleStudentLogin(e) {
  e.preventDefault();
  loadTokenConfig();

  const nama = document.getElementById('input-nama').value.trim();
  const username = document.getElementById('input-username').value.trim();
  const nisn = document.getElementById('input-nisn').value.trim();
  const absen = document.getElementById('input-absen').value.trim();
  const tokenInput = (document.getElementById('input-token')?.value || '').trim().toUpperCase();
  const errorEl = document.getElementById('login-error');

  if (!nama || !username || !nisn || !absen) {
    errorEl.textContent = 'Nama Lengkap Siswa, Username, Kelas (Dropdown), dan Nomor Absen Siswa wajib diisi lengkap.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (username.length < 2) {
    errorEl.textContent = 'Username minimal 2 karakter.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (!nisn) {
    errorEl.textContent = 'Silakan pilih Kelas terlebih dahulu dari menu dropdown.';
    errorEl.classList.remove('hidden');
    return;
  }

  const absenNum = Number(absen);
  if (!Number.isInteger(absenNum) || absenNum < 1 || absenNum > 999) {
    errorEl.textContent = 'Nomor Absen Siswa harus berupa angka bulat antara 1 sampai 999.';
    errorEl.classList.remove('hidden');
    return;
  }

  let tokenInputNow = tokenInput;
  if (state.tokenConfig?.required) {
    if (state.tokenConfig.isActive === false) {
      await syncBootstrapFromServer();
      renderLoginTokenField();
      tokenInputNow = (document.getElementById('input-token')?.value || '').trim().toUpperCase();
    }
    if (state.tokenConfig?.required && state.tokenConfig.isActive !== false && !tokenInputNow) {
      errorEl.textContent = 'Token Ujian wajib diisi sebelum masuk ruang tes.';
      errorEl.classList.remove('hidden');
      return;
    }
  }

  const candidate = {
    nama,
    username,
    nisn,
    absen: String(absenNum),
  };

  const totalActiveQuestions = getActiveStudentQuestions().length;
  let loggedInStudent = {
    ...candidate,
    loggedInAt: Date.now(),
  };
  let serverResumedSession = null;
  let serverLoginSucceeded = false;

  const submitBtn = document.querySelector('#login-form button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const response = await fetch('/api/cbt/student/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...candidate,
        tokenCode: tokenInputNow,
        totalQuestions: totalActiveQuestions,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const errMsg = data?.error || 'Gagal memverifikasi login siswa.';
      errorEl.textContent = errMsg;
      errorEl.classList.remove('hidden');
      showToast(errMsg, 'error');
      if (response.status === 403) {
        await syncBootstrapFromServer();
        renderLoginTokenField();
      }
      return;
    }

    serverLoginSucceeded = true;
    if (data?.resetEpoch) {
      applyResetEpochFromServer(data.resetEpoch);
    }
    if (data?.tokenPublic && typeof data.tokenPublic === 'object') {
      const publicClassTokens = data.tokenPublic.classTokensPublic || {};
      state.tokenConfig = {
        ...(state.tokenConfig || {}),
        ...data.tokenPublic,
        tokenMode: data.tokenPublic.tokenMode === 'global' ? 'global' : 'per_class',
        classList:
          Array.isArray(data.tokenPublic.classList) && data.tokenPublic.classList.length > 0
            ? data.tokenPublic.classList
            : state.tokenConfig?.classList || [...DEFAULT_CLASS_LIST],
        requireNewTokenPerClass: data.tokenPublic.requireNewTokenPerClass !== false,
        boundClass: data.tokenPublic.boundClass || null,
        classTokensPublic: publicClassTokens,
        classTokens:
          state.adminUnlocked && state.tokenConfig?.classTokens
            ? state.tokenConfig.classTokens
            : publicClassTokens,
      };
      writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
      renderClassDropdowns();
    }
    if (data?.student) {
      loggedInStudent = data.student;
    }
    if (data?.resumedSession && Array.isArray(data.resumedSession.questionOrder) && data.resumedSession.questionOrder.length > 0) {
      serverResumedSession = data.resumedSession;
    }
  } catch {
    // Fallback offline ke validasi lokal bila server tidak dapat dijangkau
    const classKey = normalizeClassKey(nisn);
    const classMap =
      (state.tokenConfig?.classTokens && Object.keys(state.tokenConfig.classTokens).length > 0
        ? state.tokenConfig.classTokens
        : state.tokenConfig?.classTokensPublic) || {};
    const dedicated = classMap[classKey];
    const isPerClassMode = state.tokenConfig?.tokenMode === 'per_class';

    if (state.tokenConfig?.required) {
      if (isPerClassMode) {
        if (!dedicated || dedicated.isActive === false) {
          errorEl.textContent = `Token Ujian untuk kelas ${classKey} belum diaktifkan atau dinonaktifkan oleh Admin.`;
          errorEl.classList.remove('hidden');
          return;
        }
        if (dedicated.code && tokenInputNow !== dedicated.code) {
          errorEl.textContent = `Token Ujian untuk kelas ${classKey} tidak sesuai.`;
          errorEl.classList.remove('hidden');
          showToast('Token Ujian kelas tidak valid.', 'error');
          return;
        }
      } else if (dedicated) {
        if (dedicated.isActive === false) {
          errorEl.textContent = `Token Ujian untuk kelas ${classKey} dinonaktifkan.`;
          errorEl.classList.remove('hidden');
          return;
        }
        if (dedicated.code && tokenInputNow !== dedicated.code) {
          errorEl.textContent = `Token Ujian untuk kelas ${classKey} tidak sesuai.`;
          errorEl.classList.remove('hidden');
          showToast('Token Ujian kelas tidak valid.', 'error');
          return;
        }
      } else {
        if (state.tokenConfig.isActive === false) {
          errorEl.textContent =
            'Token Ujian telah dihentikan. Hubungi Admin untuk mengaktifkan sesi baru.';
          errorEl.classList.remove('hidden');
          showToast('Token Ujian telah dihentikan.', 'error');
          return;
        }
        if (state.tokenConfig.code && tokenInputNow !== state.tokenConfig.code) {
          errorEl.textContent = 'Token Ujian tidak sesuai atau sudah direset. Periksa kembali kode Token Ujian aktif.';
          errorEl.classList.remove('hidden');
          showToast('Token Ujian tidak valid.', 'error');
          return;
        }
        if (
          state.tokenConfig.requireNewTokenPerClass !== false &&
          state.tokenConfig.boundClass &&
          normalizeClassKey(state.tokenConfig.boundClass) !== classKey
        ) {
          errorEl.textContent = `Token ${state.tokenConfig.code} sudah dipakai oleh kelas ${state.tokenConfig.boundClass}. Kelas ${classKey} wajib memakai token baru.`;
          errorEl.classList.remove('hidden');
          showToast('Token kelas wajib berubah.', 'error');
          return;
        }
      }
    }

    if (isStudentIdentityUsed(candidate)) {
      errorEl.textContent =
        'Identitas peserta ini sudah melengkapi data sebelumnya dan telah tercatat masuk, sehingga tidak dapat login kembali.';
      errorEl.classList.remove('hidden');
      showToast('Peserta ini sudah pernah login dan tidak dapat masuk kembali.', 'error');
      return;
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }

  errorEl.classList.add('hidden');

  state.adminUnlocked = false;
  state.adminToken = null;
  state.student = loggedInStudent;
  state.lastSubmission = null;
  writeStorage(STORAGE_KEYS.STUDENT, state.student);

  if (serverLoginSucceeded) {
    // Pastikan hasil auto-submit 6x lama di perangkat ini dibersihkan bila Admin mereset login siswa
    const cleanedResults = (state.results || []).filter((r) => !identityMatchesEntry(r, state.student));
    if (cleanedResults.length !== (state.results || []).length) {
      state.results = cleanedResults;
      writeStorage(STORAGE_KEYS.RESULTS, state.results);
    }
  }

  if (!state.usedIdentities.some((u) => identityMatchesEntry(u, state.student))) {
    state.usedIdentities = [
      ...(state.usedIdentities || []),
      {
        nama: state.student.nama,
        username: state.student.username,
        nisn: state.student.nisn,
        absen: state.student.absen,
        registeredAt: state.student.loggedInAt,
      },
    ];
    writeStorage(STORAGE_KEYS.USED_IDENTITIES, state.usedIdentities);
  }

  if (serverResumedSession) {
    state.session = serverResumedSession;
    state.examSubmittingLock = false;
    state.lastExamViolationAt = 0;
    writeStorage(STORAGE_KEYS.SESSION, state.session);

    const resumedTotal = serverResumedSession.questionOrder.length;
    const resumedAnswered = countAnsweredQuestions(serverResumedSession);
    const resumedPct = resumedTotal > 0 ? Math.round((resumedAnswered / resumedTotal) * 100) : 0;

    upsertMonitoringRecord(state.student, {
      status: 'Belum Mulai',
      answeredCount: resumedAnswered,
      totalQuestions: resumedTotal,
      percentage: resumedPct,
      currentNumber: (serverResumedSession.currentIndex || 0) + 1,
      flaggedCount: Object.keys(serverResumedSession.flagged || {}).length,
      warningCount: 0,
      terminatedByViolation: false,
      loginResetAt: Date.now(),
      startTime: serverResumedSession.startTime,
      endTime: serverResumedSession.endTime,
      lastActivityAt: Date.now(),
    });

    showToast(`Selamat datang kembali, ${nama}. Sesi ujian (${resumedAnswered} soal terjawab) siap dilanjutkan.`, 'success');
    switchView('dashboard');
    return;
  }

  // Clear previous session if belonged to different student
  if (
    state.session &&
    (state.session.studentNisn !== nisn || (state.session.studentAbsen && state.session.studentAbsen !== String(absenNum)))
  ) {
    state.session = null;
    removeStorage(STORAGE_KEYS.SESSION);
  }

  upsertMonitoringRecord(state.student, {
    status: 'Belum Mulai',
    answeredCount: 0,
    totalQuestions: totalActiveQuestions,
    percentage: 0,
    currentNumber: 0,
    flaggedCount: 0,
    warningCount: 0,
    terminatedByViolation: false,
    lastActivityAt: Date.now(),
  });

  showToast(`Selamat datang, ${nama}.`, 'success');
  switchView('dashboard');
}

function logoutStudent() {
  if (state.currentView === 'exam') {
    openConfirmModal(
      'Keluar dari Ujian?',
      'Jawaban Anda sejauh ini tetap tersimpan sementara, namun identitas ini tidak dapat digunakan untuk login kembali.',
      () => {
        removeStorage(STORAGE_KEYS.STUDENT);
        state.student = null;
        document.getElementById('login-form').reset();
        renderLoginTokenField();
        switchView('login');
      }
    );
    return;
  }

  if (state.currentView === 'dashboard' && state.student && !hasStudentCompletedExam(state.student)) {
    openConfirmModal(
      'Keluar dari Akun Peserta?',
      'Identitas peserta ini sudah terdaftar dan tidak dapat digunakan untuk login kembali. Yakin ingin keluar?',
      () => {
        removeStorage(STORAGE_KEYS.STUDENT);
        state.student = null;
        document.getElementById('login-form').reset();
        renderLoginTokenField();
        switchView('login');
      }
    );
    return;
  }

  removeStorage(STORAGE_KEYS.STUDENT);
  state.student = null;
  document.getElementById('login-form').reset();
  renderLoginTokenField();
  switchView('login');
}

function renderDashboard() {
  if (!state.student) return switchView('login');

  document.getElementById('dash-nama').textContent = state.student.nama;
  document.getElementById('dash-nisn').textContent = state.student.nisn;
  document.getElementById('dash-absen').textContent = state.student.absen || '-';
  document.getElementById('dash-username').textContent = state.student.username;
  document.getElementById('dash-subject').textContent = state.settings?.subject || DEFAULT_SETTINGS.subject;
  document.getElementById('dash-main-topic').textContent = state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;
  const activeQuestions = getActiveStudentQuestions();
  document.getElementById('dash-total-soal').textContent = activeQuestions.length;
  document.getElementById('dash-duration').textContent = `${state.settings?.durationMinutes || EXAM_DURATION_MINUTES} Menit`;

  // Type breakdown
  const counts = { pg: 0, pg_kompleks: 0, isian: 0, benar_salah: 0 };
  activeQuestions.forEach((q) => {
    if (counts[q.type] !== undefined) counts[q.type]++;
  });

  const breakdownEl = document.getElementById('dash-type-breakdown');
  breakdownEl.innerHTML = `
    <div class="type-box">
      <span class="type-box-count">${counts.pg}</span>
      <span class="type-box-label">Pilihan Ganda</span>
    </div>
    <div class="type-box">
      <span class="type-box-count">${counts.pg_kompleks}</span>
      <span class="type-box-label">PG Kompleks</span>
    </div>
    <div class="type-box">
      <span class="type-box-count">${counts.isian}</span>
      <span class="type-box-label">Isian Singkat</span>
    </div>
    <div class="type-box">
      <span class="type-box-count">${counts.benar_salah}</span>
      <span class="type-box-label">Benar / Salah</span>
    </div>
  `;

  const completedNotice = document.getElementById('dash-completed-notice');
  const resumeNotice = document.getElementById('dash-resume-notice');
  const startBtn = document.getElementById('btn-start-exam');
  const startLabel = document.getElementById('btn-start-exam-label');
  const resetBtn = document.getElementById('btn-reset-session');

  if (hasStudentCompletedExam(state.student)) {
    completedNotice.classList.remove('hidden');
    resumeNotice.classList.add('hidden');
    startBtn.classList.add('hidden');
    resetBtn.classList.add('hidden');
    return;
  }

  completedNotice.classList.add('hidden');
  startBtn.classList.remove('hidden');

  // Check active session
  const hasActiveSession = Boolean(
    state.session &&
      state.session.studentNisn === state.student.nisn &&
      Date.now() < state.session.endTime
  );

  if (hasActiveSession) {
    const answeredCount = countAnsweredQuestions(state.session);
    const warnCount = Number(state.session.warningCount || 0);
    document.getElementById('dash-resume-answered').textContent = answeredCount;
    const warnEl = document.getElementById('dash-resume-warnings');
    if (warnEl) {
      warnEl.textContent = warnCount > 0 ? ` · ${warnCount}/${MAX_EXAM_WARNINGS} peringatan` : '';
    }
    resumeNotice.classList.remove('hidden');
    startLabel.textContent = 'Lanjutkan Tes';
    resetBtn.classList.remove('hidden');
  } else {
    resumeNotice.classList.add('hidden');
    startLabel.textContent = 'Mulai Tes';
    resetBtn.classList.add('hidden');
  }
}

/* ==================== EXAM ENGINE ==================== */
function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function handleStartOrResumeExam() {
  if (hasStudentCompletedExam(state.student)) {
    showToast('Ujian untuk peserta ini sudah diselesaikan dan tidak dapat diulang.', 'error');
    return;
  }
  const activeQuestions = getActiveStudentQuestions();
  if (activeQuestions.length === 0) {
    showToast('Belum ada soal aktif untuk dikerjakan. Silakan hubungi Admin/Pengawas ujian.', 'error');
    return;
  }

  const hasValidSession = Boolean(
    state.session &&
      state.student &&
      state.session.studentNisn === state.student.nisn &&
      Date.now() < state.session.endTime
  );

  if (hasValidSession) {
    syncSessionToMonitoring('Sedang Mengerjakan', true);
    requestExamFullscreen();
    switchView('exam');
  } else {
    startNewExamSession();
  }
}

function startNewExamSession() {
  if (!state.student) return switchView('login');
  const activeQuestions = getActiveStudentQuestions();
  if (activeQuestions.length === 0) {
    showToast('Belum ada soal aktif untuk dikerjakan siswa.', 'error');
    return;
  }

  const orderMode = state.studentQuestionConfig?.orderMode || 'shuffle';
  const orderedIds =
    orderMode === 'ordered'
      ? activeQuestions.map((q) => q.id)
      : shuffleArray(activeQuestions.map((q) => q.id));
  const now = Date.now();
  const durationMinutes = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;
  const durationMs = durationMinutes * 60 * 1000;

  state.examSubmittingLock = false;
  state.lastExamViolationAt = 0;

  state.session = {
    studentNama: state.student.nama,
    studentUsername: state.student.username,
    studentNisn: state.student.nisn,
    studentAbsen: state.student.absen || '-',
    questionOrder: orderedIds,
    answers: {},
    flagged: {},
    currentIndex: 0,
    warningCount: 0,
    violations: [],
    startTime: now,
    endTime: now + durationMs,
  };

  writeStorage(STORAGE_KEYS.SESSION, state.session);
  syncSessionToMonitoring('Sedang Mengerjakan', true);
  requestExamFullscreen();
  switchView('exam');
}

function getSessionQuestions() {
  if (!state.session) return [];
  const mapById = new Map(state.questions.map((q) => [q.id, q]));
  return state.session.questionOrder.map((id) => mapById.get(id)).filter(Boolean);
}

function isQuestionAnswered(question, answerVal) {
  if (answerVal === undefined || answerVal === null) return false;
  if (question.type === 'pg_kompleks') {
    return Array.isArray(answerVal) && answerVal.length > 0;
  }
  if (question.type === 'isian') {
    return String(answerVal).trim() !== '';
  }
  return String(answerVal).trim() !== '';
}

function countAnsweredQuestions(session) {
  if (!session) return 0;
  const mapById = new Map(state.questions.map((q) => [q.id, q]));
  let count = 0;
  for (const qId of session.questionOrder) {
    const q = mapById.get(qId);
    if (q && isQuestionAnswered(q, session.answers[qId])) {
      count++;
    }
  }
  return count;
}

function renderExamView() {
  if (!state.student || !state.session) {
    return switchView('dashboard');
  }

  if (Number(state.session.warningCount || 0) >= MAX_EXAM_WARNINGS && !state.examSubmittingLock) {
    state.examSubmittingLock = true;
    finishExam(false, {
      autoSubmittedByViolation: true,
      violationReason: `Batas maksimal ${MAX_EXAM_WARNINGS} kali peringatan telah tercapai.`,
      warningCount: Number(state.session.warningCount || MAX_EXAM_WARNINGS),
    });
    return;
  }

  document.getElementById('exam-student-name').textContent = state.student.nama;
  document.getElementById('exam-student-nisn').textContent = `Kelas ${state.student.nisn} · Absen ${state.student.absen || '-'}`;

  updateExamWarningBadge();
  startCountdownTimer();
  renderCurrentQuestion(false);
  renderNavigatorGrid();
  updateExamProgress();
}

/* ==================== EXAM SECURITY (ANTI-NEW-TAB & 3X WARNING) ==================== */
function requestExamFullscreen() {
  try {
    const docEl = document.documentElement;
    if (!document.fullscreenElement && typeof docEl?.requestFullscreen === 'function') {
      const p = docEl.requestFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch {
    // Abaikan jika browser/iframe membatasi fullscreen otomatis
  }
}

function exitExamFullscreen() {
  try {
    if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
      const p = document.exitFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch {
    // Abaikan jika gagal keluar fullscreen
  }
}

function isExamSecurityActive() {
  return state.currentView === 'exam' && Boolean(state.session) && Boolean(state.student) && !state.examSubmittingLock;
}

function isAdminAuthModalOpen() {
  const modal = document.getElementById('modal-admin-auth');
  return Boolean(modal && !modal.classList.contains('hidden'));
}

function updateExamWarningBadge() {
  const badge = document.getElementById('exam-warning-badge');
  const textEl = document.getElementById('exam-warning-text');
  if (!badge || !textEl) return;

  const count = Math.min(MAX_EXAM_WARNINGS, Math.max(0, Number(state.session?.warningCount || 0)));
  textEl.textContent = `Peringatan: ${count}/${MAX_EXAM_WARNINGS}`;
  badge.classList.remove('is-warning', 'is-danger');
  if (count >= MAX_EXAM_WARNINGS) {
    badge.classList.add('is-danger');
  } else if (count >= 1) {
    badge.classList.add('is-warning');
  }
}

function showExamWarningModal(warningNumber, reasonText) {
  const modal = document.getElementById('modal-exam-warning');
  const card = modal?.querySelector('.exam-warning-modal');
  const pill = document.getElementById('modal-exam-warning-pill');
  const titleEl = document.getElementById('modal-exam-warning-title');
  const reasonEl = document.getElementById('modal-exam-warning-reason');
  const noteEl = document.getElementById('modal-exam-warning-note');
  if (!modal || !pill || !titleEl || !reasonEl || !noteEl) return;

  const remaining = Math.max(0, MAX_EXAM_WARNINGS - warningNumber);
  const isSecondWarning = warningNumber === MAX_EXAM_WARNINGS - 1;

  if (card) card.classList.toggle('is-critical', isSecondWarning);
  pill.textContent = `Peringatan ${warningNumber} dari ${MAX_EXAM_WARNINGS}`;
  titleEl.textContent = isSecondWarning
    ? 'Peringatan Keras Terakhir!'
    : 'Dilarang Membuka Tab Baru';
  reasonEl.textContent = reasonText || 'Terdeteksi upaya membuka tab baru atau meninggalkan ruang ujian.';
  noteEl.innerHTML = isSecondWarning
    ? `<strong>Sisa kesempatan: ${remaining} kali lagi.</strong> Jika Anda membuka tab baru atau meninggalkan layar ujian 1 kali lagi, ujian akan otomatis dihentikan dan jawaban langsung dikumpulkan.`
    : `Sisa kesempatan peringatan: <strong>${remaining} kali lagi</strong>. Pada peringatan ke-${MAX_EXAM_WARNINGS}, ujian otomatis dihentikan dan jawaban langsung dikumpulkan.`;

  openModal('modal-exam-warning');
}

function registerExamViolation(reason) {
  if (!isExamSecurityActive() || isAdminAuthModalOpen()) return;

  const now = Date.now();
  if (now - state.lastExamViolationAt < 1500) {
    return;
  }
  state.lastExamViolationAt = now;

  if (!Array.isArray(state.session.violations)) {
    state.session.violations = [];
  }

  const nextCount = Number(state.session.warningCount || 0) + 1;
  state.session.warningCount = nextCount;
  state.session.violations.push({
    count: nextCount,
    reason,
    timestamp: new Date().toISOString(),
  });

  writeStorage(STORAGE_KEYS.SESSION, state.session);
  syncSessionToMonitoring('Sedang Mengerjakan', true);
  updateExamWarningBadge();

  if (nextCount >= MAX_EXAM_WARNINGS) {
    state.examSubmittingLock = true;
    closeModal('modal-exam-warning');
    closeModal('modal-confirm');
    finishExam(false, {
      autoSubmittedByViolation: true,
      violationReason: reason,
      warningCount: nextCount,
    });
  } else {
    showExamWarningModal(nextCount, reason);
  }
}

function initExamSecurityListeners() {
  if (state.examSecurityListenersBound) return;
  state.examSecurityListenersBound = true;

  if (typeof window.open === 'function') {
    const nativeWindowOpen = window.open.bind(window);
    window.open = function (...args) {
      if (isExamSecurityActive()) {
        registerExamViolation('Upaya membuka tab atau jendela baru diblokir oleh sistem ujian.');
        return null;
      }
      return nativeWindowOpen(...args);
    };
  }

  document.addEventListener('contextmenu', (e) => {
    if (!isExamSecurityActive()) return;
    e.preventDefault();
  });

  document.addEventListener(
    'auxclick',
    (e) => {
      if (!isExamSecurityActive()) return;
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        registerExamViolation('Upaya membuka tab baru (klik tengah mouse) diblokir sistem.');
      }
    },
    true
  );

  document.addEventListener(
    'click',
    (e) => {
      if (!isExamSecurityActive()) return;
      const anchor = e.target?.closest?.('a');
      if (anchor && (anchor.target === '_blank' || e.ctrlKey || e.metaKey || e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        registerExamViolation('Upaya membuka tautan di tab atau jendela baru diblokir sistem.');
      }
    },
    true
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (!isExamSecurityActive() || isAdminAuthModalOpen()) return;
      const key = String(e.key || '').toLowerCase();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && key === 't') {
        e.preventDefault();
        e.stopPropagation();
        registerExamViolation('Upaya membuka tab baru (Ctrl/Cmd + T) diblokir sistem.');
        return;
      }

      if (mod && key === 'n') {
        e.preventDefault();
        e.stopPropagation();
        registerExamViolation('Upaya membuka jendela baru (Ctrl/Cmd + N) diblokir sistem.');
        return;
      }

      if (mod && e.shiftKey && key === 't') {
        e.preventDefault();
        e.stopPropagation();
        registerExamViolation('Upaya membuka kembali tab (Ctrl/Cmd + Shift + T) diblokir sistem.');
        return;
      }

      if (mod && key === 'w') {
        e.preventDefault();
        e.stopPropagation();
        registerExamViolation('Upaya menutup tab ujian (Ctrl/Cmd + W) diblokir sistem.');
        return;
      }

      if ((e.ctrlKey && key === 'tab') || (e.ctrlKey && (key === 'pageup' || key === 'pagedown'))) {
        e.preventDefault();
        e.stopPropagation();
        registerExamViolation('Upaya berpindah tab browser diblokir sistem.');
        return;
      }

      if ((mod && key === 'l') || (e.altKey && key === 'd') || key === 'f6') {
        e.preventDefault();
        e.stopPropagation();
        registerExamViolation('Akses bilah alamat untuk membuka tab baru diblokir selama ujian.');
        return;
      }

      if (
        key === 'f12' ||
        (mod && e.shiftKey && (key === 'i' || key === 'j' || key === 'c')) ||
        (mod && key === 'u')
      ) {
        e.preventDefault();
        e.stopPropagation();
        showToast('Akses inspeksi halaman dinonaktifkan selama ujian berlangsung.', 'error');
      }
    },
    true
  );

  document.addEventListener('visibilitychange', () => {
    if (!isExamSecurityActive() || isAdminAuthModalOpen()) return;
    if (document.visibilityState === 'hidden') {
      registerExamViolation('Terdeteksi membuka tab baru atau meninggalkan tab ujian.');
    }
  });

  window.addEventListener('blur', () => {
    if (!isExamSecurityActive() || isAdminAuthModalOpen()) return;
    setTimeout(() => {
      if (!isExamSecurityActive() || isAdminAuthModalOpen()) return;
      if (document.hidden || !document.hasFocus()) {
        registerExamViolation('Terdeteksi berpindah keluar dari jendela ujian atau membuka tab baru.');
      }
    }, 160);
  });

  window.addEventListener('beforeunload', (e) => {
    if (isExamSecurityActive()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

function startCountdownTimer() {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
  }

  const updateTick = () => {
    if (!state.session) return;
    const remainingMs = state.session.endTime - Date.now();
    const timerBox = document.getElementById('exam-timer-box');
    const timerDisplay = document.getElementById('exam-timer-display');
    const timerStatus = document.getElementById('exam-timer-status');

    if (remainingMs <= 0) {
      timerDisplay.textContent = '00:00';
      clearInterval(state.timerIntervalId);
      state.timerIntervalId = null;
      finishExam(true);
      return;
    }

    const totalSec = Math.ceil(remainingMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    timerBox.classList.remove('is-warning', 'is-danger');
    if (totalSec <= 300) {
      timerBox.classList.add('is-danger');
      timerStatus.textContent = 'Segera Habis';
    } else if (totalSec <= 900) {
      timerBox.classList.add('is-warning');
      timerStatus.textContent = 'Waktu Terbatas';
    } else {
      timerStatus.textContent = 'Sisa Waktu';
    }
  };

  updateTick();
  state.timerIntervalId = setInterval(updateTick, 1000);
}

function renderCurrentQuestion(animate = true) {
  const orderedQuestions = getSessionQuestions();
  if (orderedQuestions.length === 0) return;

  if (state.session.currentIndex >= orderedQuestions.length) {
    state.session.currentIndex = 0;
  }

  const idx = state.session.currentIndex;
  const q = orderedQuestions[idx];
  const total = orderedQuestions.length;

  document.getElementById('q-number-label').textContent = `Soal ${idx + 1} dari ${total}`;
  document.getElementById('q-type-label').textContent = TYPE_LABELS[q.type] || q.type;
  document.getElementById('q-topic-label').textContent = q.topic;

  // Instruction line for multi-select or numeric input
  const instructionEl = document.getElementById('q-instruction');
  if (q.type === 'pg_kompleks') {
    instructionEl.textContent = 'Pilih lebih dari satu jawaban yang menurut Anda benar (gunakan kotak centang).';
    instructionEl.classList.remove('hidden');
  } else if (q.type === 'isian') {
    instructionEl.textContent = 'Ketikkan jawaban berupa angka saja pada kolom di bawah ini.';
    instructionEl.classList.remove('hidden');
  } else if (q.type === 'benar_salah') {
    instructionEl.textContent = 'Tentukan apakah pernyataan berikut Benar atau Salah.';
    instructionEl.classList.remove('hidden');
  } else {
    instructionEl.classList.add('hidden');
  }

  // Flag state
  const isFlagged = Boolean(state.session.flagged[q.id]);
  const flagBtn = document.getElementById('btn-flag-question');
  flagBtn.classList.toggle('active', isFlagged);
  flagBtn.setAttribute('aria-pressed', String(isFlagged));

  // Question text & options
  document.getElementById('q-text').textContent = q.question;
  const answerArea = document.getElementById('q-answer-area');
  answerArea.innerHTML = '';

  const savedAns = state.session.answers[q.id];

  if (q.type === 'pg') {
    const keys = ['A', 'B', 'C', 'D', 'E'];
    keys.forEach((key) => {
      if (!q.options || !q.options[key]) return;
      const isSelected = savedAns === key;
      const label = document.createElement('label');
      label.className = `option-card${isSelected ? ' selected' : ''}`;
      label.innerHTML = `
        <input type="radio" name="q-${q.id}" value="${key}" ${isSelected ? 'checked' : ''} />
        <span class="option-key">${key}</span>
        <span class="option-label-text">${escapeHtml(q.options[key])}</span>
      `;
      label.querySelector('input').addEventListener('change', () => {
        saveQuestionAnswer(q.id, key);
        renderCurrentQuestion(false);
      });
      answerArea.appendChild(label);
    });
  } else if (q.type === 'pg_kompleks') {
    const selectedArr = Array.isArray(savedAns) ? savedAns : [];
    const keys = ['A', 'B', 'C', 'D', 'E'];
    keys.forEach((key) => {
      if (!q.options || !q.options[key]) return;
      const isSelected = selectedArr.includes(key);
      const label = document.createElement('label');
      label.className = `option-card${isSelected ? ' selected' : ''}`;
      label.innerHTML = `
        <input type="checkbox" name="q-${q.id}" value="${key}" ${isSelected ? 'checked' : ''} />
        <span class="option-checkbox-indicator" aria-hidden="true">
          ${isSelected ? '✓' : ''}
        </span>
        <span class="option-key">${key}</span>
        <span class="option-label-text">${escapeHtml(q.options[key])}</span>
      `;
      label.querySelector('input').addEventListener('change', (e) => {
        const current = Array.isArray(state.session.answers[q.id])
          ? [...state.session.answers[q.id]]
          : [];
        if (e.target.checked) {
          if (!current.includes(key)) current.push(key);
        } else {
          const pos = current.indexOf(key);
          if (pos !== -1) current.splice(pos, 1);
        }
        current.sort();
        saveQuestionAnswer(q.id, current);
        renderCurrentQuestion(false);
      });
      answerArea.appendChild(label);
    });
  } else if (q.type === 'isian') {
    const wrap = document.createElement('div');
    wrap.className = 'isian-input-wrap';
    wrap.innerHTML = `
      <label for="isian-field-${q.id}" class="form-label">Jawaban Angka</label>
      <input
        type="number"
        step="any"
        id="isian-field-${q.id}"
        class="form-input mono-input isian-input"
        placeholder="Masukkan angka..."
        value="${savedAns !== undefined && savedAns !== null ? escapeHtml(String(savedAns)) : ''}"
      />
    `;
    const inputEl = wrap.querySelector('input');
    inputEl.addEventListener('input', (e) => {
      saveQuestionAnswer(q.id, e.target.value);
    });
    answerArea.appendChild(wrap);
  } else if (q.type === 'benar_salah') {
    const grid = document.createElement('div');
    grid.className = 'tf-grid';
    ['Benar', 'Salah'].forEach((choice) => {
      const isSelected = savedAns === choice;
      const label = document.createElement('label');
      label.className = `option-card tf-card${isSelected ? ' selected' : ''}`;
      label.innerHTML = `
        <input type="radio" name="q-${q.id}" value="${choice}" ${isSelected ? 'checked' : ''} />
        <span>${choice}</span>
      `;
      label.querySelector('input').addEventListener('change', () => {
        saveQuestionAnswer(q.id, choice);
        renderCurrentQuestion(false);
      });
      grid.appendChild(label);
    });
    answerArea.appendChild(grid);
  }

  // Smooth transition animation
  if (animate) {
    const bodyEl = document.getElementById('question-animated-body');
    bodyEl.classList.remove('animating');
    void bodyEl.offsetWidth; // trigger reflow
    bodyEl.classList.add('animating');
  }

  // Navigation button states
  document.getElementById('btn-prev-question').disabled = idx === 0;
  const isLast = idx === total - 1;
  document.getElementById('btn-next-question').classList.toggle('hidden', isLast);
  document.getElementById('btn-submit-exam-last').classList.toggle('hidden', !isLast);

  renderNavigatorGrid();
}

function saveQuestionAnswer(qId, value) {
  if (!state.session) return;
  state.session.answers[qId] = value;
  writeStorage(STORAGE_KEYS.SESSION, state.session);
  const qObj = state.questions.find((item) => item.id === qId);
  syncSessionToMonitoring('Sedang Mengerjakan', qObj?.type !== 'isian');
  updateExamProgress();
  renderNavigatorGrid();

  const hint = document.getElementById('autosave-hint');
  if (hint) {
    hint.textContent = 'Jawaban tersimpan';
    clearTimeout(hint._t);
    hint._t = setTimeout(() => {
      hint.textContent = 'Tersimpan otomatis';
    }, 1200);
  }
}

function navigateQuestion(delta) {
  if (!state.session) return;
  const ordered = getSessionQuestions();
  const nextIdx = state.session.currentIndex + delta;
  if (nextIdx >= 0 && nextIdx < ordered.length) {
    state.session.currentIndex = nextIdx;
    writeStorage(STORAGE_KEYS.SESSION, state.session);
    syncSessionToMonitoring('Sedang Mengerjakan', true);
    renderCurrentQuestion(true);
  }
}

function jumpToQuestion(index) {
  if (!state.session) return;
  state.session.currentIndex = index;
  writeStorage(STORAGE_KEYS.SESSION, state.session);
  syncSessionToMonitoring('Sedang Mengerjakan', true);
  renderCurrentQuestion(true);
}

function toggleFlagCurrentQuestion() {
  if (!state.session) return;
  const ordered = getSessionQuestions();
  const q = ordered[state.session.currentIndex];
  if (!q) return;

  if (state.session.flagged[q.id]) {
    delete state.session.flagged[q.id];
  } else {
    state.session.flagged[q.id] = true;
  }
  writeStorage(STORAGE_KEYS.SESSION, state.session);
  syncSessionToMonitoring('Sedang Mengerjakan', true);
  renderCurrentQuestion(false);
}

function updateExamProgress() {
  if (!state.session) return;
  const total = state.session.questionOrder.length;
  const answered = countAnsweredQuestions(state.session);
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;

  document.getElementById('exam-progress-text').textContent = `${answered} / ${total} Terjawab (${pct}%)`;
  document.getElementById('exam-progress-fill').style.width = `${pct}%`;
  document.getElementById('exam-progress-bar-wrap').setAttribute('aria-valuenow', String(pct));
  document.getElementById('nav-summary-count').textContent = `${answered}/${total}`;
}

function renderNavigatorGrid() {
  if (!state.session) return;
  const grid = document.getElementById('question-navigator-grid');
  const ordered = getSessionQuestions();

  grid.innerHTML = '';
  ordered.forEach((q, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'num-btn';
    btn.textContent = String(i + 1);
    btn.setAttribute('aria-label', `Nomor ${i + 1}`);

    const answered = isQuestionAnswered(q, state.session.answers[q.id]);
    const flagged = Boolean(state.session.flagged[q.id]);

    if (flagged) {
      btn.classList.add('is-flagged');
    } else if (answered) {
      btn.classList.add('is-answered');
    }

    if (i === state.session.currentIndex) {
      btn.classList.add('is-current');
    }

    btn.addEventListener('click', () => jumpToQuestion(i));
    grid.appendChild(btn);
  });
}

function promptFinishExam() {
  if (!state.session) return;
  const total = state.session.questionOrder.length;
  const answered = countAnsweredQuestions(state.session);
  const unanswered = total - answered;

  const message =
    unanswered > 0
      ? `Masih ada ${unanswered} soal yang belum terjawab dari total ${total} soal. Apakah Anda yakin ingin mengumpulkan ujian sekarang?`
      : `Seluruh ${total} soal telah terjawab. Kumpulkan ujian dan lihat hasil penilaian sekarang?`;

  openConfirmModal('Kumpulkan Jawaban Ujian?', message, () => finishExam(false));
}

/* ==================== GRADING & RESULT ENGINE ==================== */
function checkAnswerCorrectness(question, userAns) {
  if (!isQuestionAnswered(question, userAns)) return false;

  if (question.type === 'pg' || question.type === 'benar_salah') {
    return String(userAns).trim() === String(question.answer).trim();
  }

  if (question.type === 'pg_kompleks') {
    const userArr = Array.isArray(userAns) ? [...userAns].sort() : [];
    const keyArr = Array.isArray(question.answer) ? [...question.answer].sort() : [];
    if (userArr.length !== keyArr.length) return false;
    return userArr.every((val, i) => val === keyArr[i]);
  }

  if (question.type === 'isian') {
    const uNum = Number(String(userAns).trim());
    const kNum = Number(String(question.answer).trim());
    return !Number.isNaN(uNum) && !Number.isNaN(kNum) && uNum === kNum;
  }

  return false;
}

function formatAnswerDisplay(question, ans) {
  if (!isQuestionAnswered(question, ans)) return '(Tidak dijawab)';
  if (question.type === 'pg_kompleks') {
    return Array.isArray(ans) ? ans.join(', ') : String(ans);
  }
  return String(ans);
}

function finishExam(isAutoTimeout = false, securityMeta = null) {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }

  if (!state.session || !state.student) {
    state.examSubmittingLock = false;
    return;
  }

  const warningCount = Number(state.session.warningCount || securityMeta?.warningCount || 0);
  const autoSubmittedByViolation = Boolean(securityMeta?.autoSubmittedByViolation);
  const violationReason = securityMeta?.violationReason || '';

  const orderedQuestions = getSessionQuestions();
  const totalQuestions = orderedQuestions.length;
  let correctCount = 0;

  const topicMap = {};
  TOPICS.forEach((t) => {
    topicMap[t] = { topic: t, correct: 0, total: 0 };
  });

  const details = orderedQuestions.map((q, idx) => {
    const userAns = state.session.answers[q.id];
    const isCorrect = checkAnswerCorrectness(q, userAns);
    if (isCorrect) correctCount++;

    if (!topicMap[q.topic]) {
      topicMap[q.topic] = { topic: q.topic, correct: 0, total: 0 };
    }
    topicMap[q.topic].total++;
    if (isCorrect) topicMap[q.topic].correct++;

    return {
      no: idx + 1,
      id: q.id,
      type: q.type,
      topic: q.topic,
      question: q.question,
      userAnswerText: formatAnswerDisplay(q, userAns),
      correctAnswerText: formatAnswerDisplay(q, q.answer),
      isCorrect,
      explanation: q.explanation || '',
    };
  });

  const wrongCount = totalQuestions - correctCount;
  const rawScore = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;
  const score = Number.isInteger(rawScore) ? rawScore : Number(rawScore.toFixed(2));
  const percentage = totalQuestions > 0 ? Number(((correctCount / totalQuestions) * 100).toFixed(1)) : 0;
  const status = rawScore >= PASSING_GRADE ? 'Lulus' : 'Belum Lulus';

  const topicStats = Object.values(topicMap).filter((item) => item.total > 0);
  const nomorUrut = state.results.length + 1;

  const subject = state.settings?.subject || DEFAULT_SETTINGS.subject;
  const mainTopic = state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;

  const resultRecord = {
    id: `RES-${Date.now()}`,
    nomorUrut,
    nama: state.student.nama,
    username: state.student.username,
    nisn: state.student.nisn,
    absen: state.student.absen || '-',
    subject,
    mainTopic,
    score,
    correctCount,
    wrongCount,
    totalQuestions,
    percentage,
    status,
    warningCount,
    autoSubmittedByViolation,
    completedAt: new Date().toISOString(),
    topicStats,
    details,
  };

  const answeredCount = countAnsweredQuestions(state.session);
  resultRecord.answeredCount = answeredCount;

  state.results.push(resultRecord);
  writeStorage(STORAGE_KEYS.RESULTS, state.results);

  const completedPct = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;
  const studentSnapshot = { ...state.student };

  upsertMonitoringRecord(studentSnapshot, {
    status: 'Selesai',
    answeredCount,
    totalQuestions,
    percentage: completedPct,
    currentNumber: totalQuestions,
    flaggedCount: Object.keys(state.session.flagged || {}).length,
    warningCount,
    terminatedByViolation: autoSubmittedByViolation,
    completedAt: resultRecord.completedAt,
    lastActivityAt: Date.now(),
  });

  // Store non-grade submission summary for student confirmation screen
  state.lastSubmission = {
    nama: resultRecord.nama,
    username: resultRecord.username,
    nisn: resultRecord.nisn,
    absen: resultRecord.absen,
    subject: resultRecord.subject,
    mainTopic: resultRecord.mainTopic,
    nomorUrut: resultRecord.nomorUrut,
    answeredCount,
    totalQuestions: resultRecord.totalQuestions,
    completedAt: resultRecord.completedAt,
    warningCount,
    autoSubmittedByViolation,
    violationReason,
  };

  const finalSessionSnapshot = buildSessionSnapshot(state.session, studentSnapshot);

  // Clear active exam session & pending progress debounce
  if (state.progressSyncTimer) {
    clearTimeout(state.progressSyncTimer);
    state.progressSyncTimer = null;
  }
  removeStorage(STORAGE_KEYS.SESSION);
  state.session = null;
  state.activeResult = null;
  state.resultOpenedFromAdmin = false;
  state.resultFilter = 'all';
  state.examSubmittingLock = false;
  exitExamFullscreen();

  // Sync result & monitoring status to backend server (including snapshot for possible Admin Reset Login resume)
  const finishSync = syncFinishExamToServer(
    studentSnapshot,
    resultRecord,
    answeredCount,
    autoSubmittedByViolation,
    finalSessionSnapshot
  )
    .finally(() => {
      if (state.pendingFinishSyncPromise === finishSync) {
        state.pendingFinishSyncPromise = null;
      }
    });
  state.pendingFinishSyncPromise = finishSync;

  // Auto-stop token if target participants reached
  evaluateTokenAutoStop();

  if (autoSubmittedByViolation) {
    showToast(`Peringatan ke-${MAX_EXAM_WARNINGS} tercapai! Ujian dihentikan otomatis dan jawaban langsung dikumpulkan.`, 'error');
  } else if (isAutoTimeout) {
    showToast('Waktu ujian habis! Jawaban Anda berhasil dikirim ke Portal Admin.', 'error');
  } else {
    showToast('Ujian selesai! Jawaban Anda berhasil dikumpulkan.', 'success');
  }

  switchView('submitted');
}

async function checkAndResumeUnlockedExam(manualClick = false) {
  const identity = state.lastSubmission || state.student;
  if (!identity) {
    if (manualClick) showToast('Identitas siswa tidak ditemukan. Silakan masuk melalui halaman Login.', 'error');
    return false;
  }

  try {
    const response = await fetch('/api/cbt/student/check-resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nama: identity.nama,
        username: identity.username || state.student?.username || '',
        nisn: identity.nisn,
        absen: identity.absen || '-',
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data?.unlocked && data?.resumedSession) {
      if (state.resumePollIntervalId) {
        clearInterval(state.resumePollIntervalId);
        state.resumePollIntervalId = null;
      }

      const nextStudent = data.student || state.student || {
        nama: identity.nama,
        username: identity.username || '',
        nisn: identity.nisn,
        absen: identity.absen || '-',
        loggedInAt: Date.now(),
      };

      state.student = nextStudent;
      state.session = data.resumedSession;
      state.lastSubmission = null;
      state.examSubmittingLock = false;
      state.lastExamViolationAt = 0;

      state.results = (state.results || []).filter((r) => !identityMatchesEntry(r, nextStudent));
      writeStorage(STORAGE_KEYS.RESULTS, state.results);
      writeStorage(STORAGE_KEYS.STUDENT, state.student);
      writeStorage(STORAGE_KEYS.SESSION, state.session);

      if (!state.usedIdentities.some((u) => identityMatchesEntry(u, nextStudent))) {
        state.usedIdentities = [
          ...(state.usedIdentities || []),
          {
            nama: nextStudent.nama,
            username: nextStudent.username,
            nisn: nextStudent.nisn,
            absen: nextStudent.absen,
            registeredAt: nextStudent.loggedInAt || Date.now(),
          },
        ];
        writeStorage(STORAGE_KEYS.USED_IDENTITIES, state.usedIdentities);
      }

      const resumedTotal = state.session.questionOrder.length;
      const resumedAnswered = countAnsweredQuestions(state.session);
      const resumedPct = resumedTotal > 0 ? Math.round((resumedAnswered / resumedTotal) * 100) : 0;

      upsertMonitoringRecord(nextStudent, {
        status: 'Belum Mulai',
        answeredCount: resumedAnswered,
        totalQuestions: resumedTotal,
        percentage: resumedPct,
        currentNumber: (state.session.currentIndex || 0) + 1,
        flaggedCount: Object.keys(state.session.flagged || {}).length,
        warningCount: 0,
        terminatedByViolation: false,
        loginResetAt: Date.now(),
        startTime: state.session.startTime,
        endTime: state.session.endTime,
        lastActivityAt: Date.now(),
      });

      showToast(
        `Login direset oleh Admin! Klik "Lanjutkan Tes" untuk meneruskan ${resumedAnswered} soal yang telah dijawab.`,
        'success'
      );
      switchView('dashboard');
      return true;
    }

    if (manualClick) {
      showToast(
        'Akses login belum direset oleh Admin. Hubungi pengawas untuk menekan Reset Login Siswa di Portal Admin.',
        'default'
      );
    }
    return false;
  } catch {
    if (manualClick) {
      showToast('Gagal memeriksa status reset ke server. Periksa koneksi jaringan Anda.', 'error');
    }
    return false;
  }
}

function startSubmittedResumePoll() {
  if (state.resumePollIntervalId) {
    clearInterval(state.resumePollIntervalId);
  }
  state.resumePollIntervalId = setInterval(() => {
    if (state.currentView === 'submitted' && state.lastSubmission?.autoSubmittedByViolation) {
      checkAndResumeUnlockedExam(false);
    } else {
      clearInterval(state.resumePollIntervalId);
      state.resumePollIntervalId = null;
    }
  }, 5000);
}

function renderSubmittedView() {
  const sub = state.lastSubmission;
  if (!sub) return switchView('dashboard');

  const subject = sub.subject || state.settings?.subject || DEFAULT_SETTINGS.subject;
  const mainTopic = sub.mainTopic || state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;

  const headingEl = document.getElementById('submitted-heading');
  const subtitleEl = document.querySelector('#view-submitted .submitted-subtitle');
  const noticeEl = document.querySelector('#view-submitted .submitted-notice');
  const checkResumeBtn = document.getElementById('btn-submitted-check-resume');

  if (sub.autoSubmittedByViolation) {
    const warnLimit = Math.max(MAX_EXAM_WARNINGS, Number(sub.warningCount || MAX_EXAM_WARNINGS));
    if (headingEl) headingEl.textContent = `Ujian Dihentikan Otomatis (${warnLimit}/${MAX_EXAM_WARNINGS} Peringatan)`;
    if (subtitleEl) {
      subtitleEl.textContent =
        `Sistem mendeteksi pelanggaran membuka tab baru atau meninggalkan ruang ujian sebanyak ${MAX_EXAM_WARNINGS} kali. Jawaban terakhir Anda telah otomatis disimpan.`;
    }
    if (noticeEl) {
      noticeEl.classList.add('is-danger');
      noticeEl.textContent =
        `Ujian terproteksi karena batas maksimal ${MAX_EXAM_WARNINGS}x peringatan. Jika Admin menekan Reset Login Siswa pada Monitoring, Anda dapat langsung melanjutkan kembali soal sebelumnya.`;
    }
    if (checkResumeBtn) checkResumeBtn.classList.remove('hidden');
    startSubmittedResumePoll();
  } else {
    if (headingEl) headingEl.textContent = 'Ujian Telah Diselesaikan';
    if (subtitleEl) {
      subtitleEl.textContent =
        'Terima kasih, jawaban Anda telah berhasil disimpan dan direkam ke sistem evaluasi.';
    }
    if (noticeEl) {
      noticeEl.classList.remove('is-danger');
      noticeEl.textContent =
        'Selamat Ananda Telah Menyelesaikan Ujian CBT Online. Semoga Mendapatkan Nilai Hasil Terbaik. Aamiin.';
    }
    if (checkResumeBtn) checkResumeBtn.classList.add('hidden');
    if (state.resumePollIntervalId) {
      clearInterval(state.resumePollIntervalId);
      state.resumePollIntervalId = null;
    }
  }

  document.getElementById('sub-nama').textContent = sub.nama;
  document.getElementById('sub-nisn').textContent = sub.nisn;
  document.getElementById('sub-absen').textContent = sub.absen || '-';
  document.getElementById('sub-nomor-urut').textContent = `#${sub.nomorUrut}`;
  document.getElementById('sub-subject').textContent = subject;
  document.getElementById('sub-main-topic').textContent = mainTopic;
  document.getElementById('sub-answered').textContent = `${sub.answeredCount} / ${sub.totalQuestions} Soal`;
  document.getElementById('sub-timestamp').textContent = formatDateTimeID(sub.completedAt);
}

/* ==================== RESULT PAGE & BAR CHARTS (ADMIN) ==================== */
function renderResultView() {
  const res = state.activeResult;
  if (!res || !state.adminUnlocked) return switchView('admin');

  const subject = res.subject || state.settings?.subject || DEFAULT_SETTINGS.subject;
  const mainTopic = res.mainTopic || state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;

  document.getElementById('btn-result-back-admin').classList.toggle('hidden', !state.resultOpenedFromAdmin);
  document.getElementById('btn-retake-test').classList.toggle('hidden', state.resultOpenedFromAdmin);

  document.getElementById('result-heading').textContent = `Hasil Ujian ${subject}`;
  document.getElementById('res-nama').textContent = res.nama;
  document.getElementById('res-nisn').textContent = res.nisn;
  document.getElementById('res-absen').textContent = res.absen || '-';
  document.getElementById('res-nomor-urut').textContent = `#${res.nomorUrut}`;
  document.getElementById('res-subject').textContent = subject;
  document.getElementById('res-main-topic').textContent = mainTopic;
  document.getElementById('res-timestamp').textContent = formatDateTimeID(res.completedAt);

  document.getElementById('res-score').textContent = res.score;
  document.getElementById('res-correct').textContent = res.correctCount;
  document.getElementById('res-wrong').textContent = res.wrongCount;
  document.getElementById('res-percent').textContent = `${res.percentage}%`;

  const statusBox = document.getElementById('res-status-box');
  const statusText = document.getElementById('res-status-text');
  const isPass = res.score >= PASSING_GRADE;
  statusBox.classList.remove('is-pass', 'is-fail');
  statusBox.classList.add(isPass ? 'is-pass' : 'is-fail');
  statusText.textContent = isPass ? '✓ Lulus (≥ 75)' : '✕ Belum Lulus (< 75)';

  // Reset filter tabs
  document.querySelectorAll('[data-res-filter]').forEach((b) => {
    b.classList.toggle('active', b.dataset.resFilter === state.resultFilter);
  });

  renderResultSummaryList();
  requestAnimationFrame(() => drawResultCharts(res));
}

function renderResultSummaryList() {
  const res = state.activeResult;
  const container = document.getElementById('result-summary-list');
  if (!res || !Array.isArray(res.details)) {
    container.innerHTML = '<div class="empty-state">Tidak ada ringkasan jawaban.</div>';
    return;
  }

  const filtered = res.details.filter((d) => {
    if (state.resultFilter === 'correct') return d.isCorrect;
    if (state.resultFilter === 'wrong') return !d.isCorrect;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">Tidak ada butir soal untuk filter yang dipilih.</div>';
    return;
  }

  container.innerHTML = filtered
    .map(
      (item) => `
    <div class="summary-item">
      <div class="summary-item-top">
        <span class="meta-text">
          <strong>No. ${item.no}</strong> · ${escapeHtml(TYPE_LABELS[item.type] || item.type)} · ${escapeHtml(item.topic)}
        </span>
        <span class="summary-item-status ${item.isCorrect ? 'is-correct' : 'is-wrong'}">
          ${item.isCorrect ? '✓ Benar' : '✕ Salah'}
        </span>
      </div>
      <p class="summary-item-q">${escapeHtml(item.question)}</p>
      <div class="summary-item-answers">
        <div>
          <span class="meta-text">Jawaban Peserta:</span><br />
          <strong>${escapeHtml(item.userAnswerText)}</strong>
        </div>
        <div>
          <span class="meta-text">Kunci Jawaban:</span><br />
          <strong>${escapeHtml(item.correctAnswerText)}</strong>
        </div>
      </div>
      ${item.explanation ? `<p class="summary-item-exp">Pembahasan: ${escapeHtml(item.explanation)}</p>` : ''}
    </div>
  `
    )
    .join('');
}

function drawResultCharts(res) {
  drawSummaryBarChart(res);
  drawTopicsBarChart(res);
}

function setupHighDpiCanvas(canvas, logicalW, logicalH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = logicalW * dpr;
  canvas.height = logicalH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function drawSummaryBarChart(res) {
  const canvas = document.getElementById('chart-summary');
  if (!canvas) return;
  const W = 480;
  const H = 250;
  const ctx = setupHighDpiCanvas(canvas, W, H);

  ctx.clearRect(0, 0, W, H);

  const pad = { top: 28, right: 20, bottom: 44, left: 42 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Grid & Y-axis (0..100)
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.font = '500 11px "JetBrains Mono", monospace';
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'right';

  [0, 25, 50, 75, 100].forEach((val) => {
    const y = pad.top + plotH - (val / 100) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillText(String(val), pad.left - 8, y + 4);
  });

  // Bars data
  const correctPct = res.totalQuestions > 0 ? (res.correctCount / res.totalQuestions) * 100 : 0;
  const wrongPct = res.totalQuestions > 0 ? (res.wrongCount / res.totalQuestions) * 100 : 0;
  const bars = [
    { label: 'Nilai Akhir', value: res.score, display: `${res.score}`, color: '#1d4ed8' },
    { label: 'KKM Lulus', value: PASSING_GRADE, display: `${PASSING_GRADE}`, color: '#94a3b8' },
    { label: 'Benar (%)', value: correctPct, display: `${correctPct.toFixed(0)}%`, color: '#059669' },
    { label: 'Salah (%)', value: wrongPct, display: `${wrongPct.toFixed(0)}%`, color: '#dc2626' },
  ];

  const slotW = plotW / bars.length;
  const barW = Math.min(48, slotW * 0.56);

  bars.forEach((b, idx) => {
    const x = pad.left + idx * slotW + (slotW - barW) / 2;
    const barH = Math.max(2, (b.value / 100) * plotH);
    const y = pad.top + plotH - barH;

    // Rounded top bar
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [6, 6, 0, 0]);
    ctx.fill();

    // Value label
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(b.display, x + barW / 2, y - 8);

    // X label
    ctx.fillStyle = '#475569';
    ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(b.label, x + barW / 2, pad.top + plotH + 20);
  });

  // KKM dashed line
  const kkmY = pad.top + plotH - (PASSING_GRADE / 100) * plotH;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad.left, kkmY);
  ctx.lineTo(W - pad.right, kkmY);
  ctx.stroke();
  ctx.restore();
}

function drawTopicsBarChart(res) {
  const canvas = document.getElementById('chart-topics');
  if (!canvas) return;
  const stats = res.topicStats || [];
  const W = 560;
  const H = Math.max(250, stats.length * 36 + 32);
  const ctx = setupHighDpiCanvas(canvas, W, H);

  ctx.clearRect(0, 0, W, H);

  if (stats.length === 0) return;

  const pad = { top: 14, right: 54, bottom: 24, left: 205 };
  const plotW = W - pad.left - pad.right;
  const rowH = (H - pad.top - pad.bottom) / stats.length;
  const barH = Math.min(18, rowH * 0.56);

  // Vertical grid lines (0, 50, 100)
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  [0, 50, 75, 100].forEach((val) => {
    const x = pad.left + (val / 100) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, H - pad.bottom);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${val}%`, x, H - 8);
  });

  stats.forEach((item, idx) => {
    const pct = item.total > 0 ? Math.round((item.correct / item.total) * 100) : 0;
    const centerY = pad.top + idx * rowH + rowH / 2;
    const y = centerY - barH / 2;

    // Topic label (truncated cleanly)
    const shortTopic = item.topic.length > 27 ? item.topic.slice(0, 26) + '…' : item.topic;
    ctx.fillStyle = '#334155';
    ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(shortTopic, pad.left - 10, centerY + 4);

    // Track
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.roundRect(pad.left, y, plotW, barH, 4);
    ctx.fill();

    // Fill
    const fillW = Math.max(4, (pct / 100) * plotW);
    ctx.fillStyle = pct >= PASSING_GRADE ? '#1d4ed8' : '#0284c7';
    ctx.beginPath();
    ctx.roundRect(pad.left, y, fillW, barH, 4);
    ctx.fill();

    // Value label
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${pct}%`, pad.left + plotW + 8, centerY + 4);
  });
}

/* ==================== PURE JS PDF GENERATOR (NO CDN NEEDED) ==================== */
function sanitizePdfText(str) {
  return String(str || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, (ch) => {
      if (ch === '≥') return '>=';
      if (ch === '≤') return '<=';
      if (ch === '≠') return '!=';
      if (ch === '±') return '+/-';
      if (ch === '×') return 'x';
      if (ch === '÷') return '/';
      if (ch === '²') return '^2';
      if (ch === '³') return '^3';
      if (ch === '→') return '->';
      if (ch === '←') return '<-';
      if (ch === '✓') return '[BENAR]';
      if (ch === '✕') return '[SALAH]';
      if (ch === '·' || ch === '•') return '-';
      if (ch === '–' || ch === '—') return '-';
      if (ch === '…') return '...';
      if (ch === '“' || ch === '”') return '"';
      if (ch === '‘' || ch === '’') return "'";
      return ' ';
    })
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(text, maxChars) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxChars) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function generateResultPdfBlob(res) {
  // Page dimensions: A4 (595 x 842 pt)
  const pageStreams = [];
  let commands = [];
  let y = 785;

  const newPage = () => {
    if (commands.length > 0) pageStreams.push(commands.join('\n'));
    commands = [];
    y = 790;
  };

  const drawText = (x, yPos, text, font = 'F1', size = 10, color = '0.06 0.09 0.16') => {
    commands.push(`BT /${font} ${size} Tf ${color} rg ${x} ${yPos} Td (${sanitizePdfText(text)}) Tj ET`);
  };

  // Header Banner
  const pdfSubject = res.subject || state.settings?.subject || DEFAULT_SETTINGS.subject;
  const pdfMainTopic = res.mainTopic || state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;
  commands.push('0.114 0.306 0.847 rg 40 755 515 56 re f');
  drawText(56, 786, 'CBT ONLINE - LAPORAN HASIL UJIAN', 'F2', 14, '1 1 1');
  drawText(56, 768, `Mata Pelajaran: ${pdfSubject} | Materi: ${pdfMainTopic}`, 'F1', 9.5, '0.88 0.94 1');

  y = 732;
  // Student Identity Box
  commands.push('0.97 0.98 0.99 rg 40 626 515 92 re f');
  commands.push('0.88 0.91 0.94 RG 0.8 w 40 626 515 92 re S');

  drawText(54, 698, `Nama Siswa   : ${res.nama}`, 'F2', 10.5);
  drawText(54, 680, `Kelas / Absen: ${res.nisn} / No. ${res.absen || '-'}`, 'F1', 10);
  drawText(54, 662, `Nomor Urut   : #${res.nomorUrut}`, 'F1', 10);
  drawText(54, 644, `Waktu Selesai: ${formatDateTimeID(res.completedAt)}`, 'F1', 10);

  // Score Summary on right half of Identity Box
  drawText(340, 696, `NILAI AKHIR : ${res.score}`, 'F2', 14, '0.114 0.306 0.847');
  drawText(
    340,
    676,
    `Status      : ${res.status.toUpperCase()} (KKM ${PASSING_GRADE})`,
    'F2',
    10.5,
    res.score >= PASSING_GRADE ? '0.02 0.47 0.34' : '0.72 0.11 0.11'
  );
  drawText(340, 658, `Benar / Salah: ${res.correctCount} Benar / ${res.wrongCount} Salah`, 'F1', 10);
  drawText(340, 642, `Persentase  : ${res.percentage}% (${res.totalQuestions} Soal)`, 'F1', 10);

  // Topic Mastery Vector Bar Chart
  y = 602;
  drawText(40, y, 'DIAGRAM CAPAIAN PER MATERI (%)', 'F2', 11, '0.114 0.306 0.847');
  y -= 18;

  (res.topicStats || []).forEach((t) => {
    const pct = t.total > 0 ? Math.round((t.correct / t.total) * 100) : 0;
    const label = t.topic.length > 34 ? t.topic.slice(0, 33) + '...' : t.topic;
    drawText(40, y, label, 'F1', 9);
    // Bar track
    commands.push(`0.91 0.93 0.96 rg 245 ${y - 2} 250 10 re f`);
    // Bar fill
    const fillW = Math.max(2, (pct / 100) * 250);
    commands.push(`0.114 0.306 0.847 rg 245 ${y - 2} ${fillW.toFixed(1)} 10 re f`);
    drawText(505, y, `${pct}% (${t.correct}/${t.total})`, 'F2', 8.5);
    y -= 18;
  });

  // Answer Summary Section
  y -= 12;
  drawText(40, y, 'RINGKASAN JAWABAN PESERTA', 'F2', 11, '0.114 0.306 0.847');
  y -= 14;

  (res.details || []).forEach((item) => {
    const qLines = wrapText(`${item.no}. ${item.question}`, 84);
    const neededHeight = qLines.length * 12 + 24;
    if (y - neededHeight < 55) {
      newPage();
      drawText(40, y, 'RINGKASAN JAWABAN PESERTA (Lanjutan)', 'F2', 10, '0.114 0.306 0.847');
      y -= 18;
    }

    const statusTag = item.isCorrect ? 'BENAR' : 'SALAH';
    const statusColor = item.isCorrect ? '0.02 0.47 0.34' : '0.72 0.11 0.11';

    qLines.forEach((line) => {
      drawText(40, y, line, 'F1', 9);
      y -= 12;
    });

    drawText(
      52,
      y,
      `[${statusTag}] Jawaban: ${item.userAnswerText} | Kunci: ${item.correctAnswerText}`,
      'F2',
      8.5,
      statusColor
    );
    y -= 16;
  });

  if (commands.length > 0) pageStreams.push(commands.join('\n'));
  return buildPdfBlobFromPageStreams(pageStreams);
}

function dataUrlToUint8Array(dataUrl) {
  const commaIdx = String(dataUrl || '').indexOf(',');
  if (commaIdx === -1) return null;
  try {
    const binStr = atob(dataUrl.slice(commaIdx + 1));
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
      bytes[i] = binStr.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function buildPdfBlobFromPageStreams(pageStreams, imageSpecs = []) {
  const encoder = new TextEncoder();
  const objectChunks = [];
  const addObj = (parts) => {
    objectChunks.push(parts.map((p) => (typeof p === 'string' ? encoder.encode(p) : p)));
    return objectChunks.length;
  };

  const font1Id = addObj(['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']);
  const font2Id = addObj(['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>']);
  const pagesPlaceholderId = addObj(['']); // filled later

  const xObjectRefs = [];
  (imageSpecs || []).forEach((img) => {
    if (!img || !(img.bytes instanceof Uint8Array) || img.bytes.byteLength === 0) return;
    const imgId = addObj([
      `<< /Type /XObject /Subtype /Image /Width ${Math.max(1, Math.round(img.width))} /Height ${Math.max(1, Math.round(img.height))} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.byteLength} >>\nstream\n`,
      img.bytes,
      '\nendstream',
    ]);
    xObjectRefs.push(`/${img.name || 'Im1'} ${imgId} 0 R`);
  });

  const xObjectDict = xObjectRefs.length > 0 ? ` /XObject << ${xObjectRefs.join(' ')} >>` : '';

  const pageIds = [];
  pageStreams.forEach((stream) => {
    const streamBytes = encoder.encode(stream);
    const contentId = addObj([`<< /Length ${streamBytes.byteLength} >>\nstream\n`, streamBytes, '\nendstream']);
    const pageId = addObj([
      `<< /Type /Page /Parent ${pagesPlaceholderId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font1Id} 0 R /F2 ${font2Id} 0 R >>${xObjectDict} >> /Contents ${contentId} 0 R >>`,
    ]);
    pageIds.push(pageId);
  });

  objectChunks[pagesPlaceholderId - 1] = [
    encoder.encode(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`),
  ];
  const catalogId = addObj([`<< /Type /Catalog /Pages ${pagesPlaceholderId} 0 R >>`]);

  const chunks = [];
  let byteOffset = 0;
  const pushAscii = (str) => {
    const u8 = encoder.encode(str);
    chunks.push(u8);
    byteOffset += u8.byteLength;
  };
  const pushU8 = (u8) => {
    chunks.push(u8);
    byteOffset += u8.byteLength;
  };

  pushAscii('%PDF-1.4\n');
  const offsets = [0];
  objectChunks.forEach((parts, idx) => {
    offsets.push(byteOffset);
    pushAscii(`${idx + 1} 0 obj\n`);
    parts.forEach((u8) => pushU8(u8));
    pushAscii('\nendobj\n');
  });

  const xrefStart = byteOffset;
  let trailerStr = `xref\n0 ${objectChunks.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    trailerStr += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  trailerStr += `trailer\n<< /Size ${objectChunks.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  pushAscii(trailerStr);

  return new Blob(chunks, { type: 'application/pdf' });
}

function handleDownloadPdf() {
  if (!state.activeResult) return;
  const blob = generateResultPdfBlob(state.activeResult);
  const url = URL.createObjectURL(blob);
  const safeName = state.activeResult.nama.replace(/[^a-zA-Z0-9]+/g, '_');
  const a = document.createElement('a');
  a.href = url;
  a.download = `Hasil_CBT_ONLINE_${safeName}_${state.activeResult.nisn}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('File PDF hasil ujian berhasil diunduh.', 'success');
}

function formatCorrectAnswerWithDetail(q) {
  if (q.type === 'pg') {
    const key = String(q.answer || '').trim();
    const optText = q.options && q.options[key] ? q.options[key] : '';
    return optText ? `${key}. ${optText}` : key;
  }
  if (q.type === 'pg_kompleks') {
    const keys = Array.isArray(q.answer) ? q.answer : [];
    return keys
      .map((k) => {
        const optText = q.options && q.options[k] ? q.options[k] : '';
        return optText ? `${k} (${optText})` : k;
      })
      .join('; ');
  }
  if (q.type === 'isian') {
    return String(q.answer ?? '');
  }
  if (q.type === 'benar_salah') {
    return String(q.answer ?? '');
  }
  return formatAnswerDisplay(q, q.answer);
}

function generateQuestionBankPdfBlob(questionsList, filterMeta = {}) {
  const pageCommandLists = [];
  let commands = [];
  let y = 785;
  const bottomLimit = 56;

  const pushTextCmd = (target, x, yPos, text, font = 'F1', size = 9.5, color = '0.06 0.09 0.16') => {
    target.push(`BT /${font} ${size} Tf ${color} rg ${x} ${yPos} Td (${sanitizePdfText(text)}) Tj ET`);
  };

  const drawText = (x, yPos, text, font = 'F1', size = 9.5, color = '0.06 0.09 0.16') => {
    pushTextCmd(commands, x, yPos, text, font, size, color);
  };

  const startNewPage = () => {
    if (commands.length > 0) pageCommandLists.push(commands);
    commands = [];
    // Compact running header on continuation pages
    commands.push('0.96 0.98 1 rg 40 792 515 24 re f');
    commands.push('0.84 0.89 0.96 RG 0.6 w 40 792 515 24 re S');
    drawText(50, 800, 'CBT ONLINE - BANK SOAL & KUNCI JAWABAN', 'F2', 9, '0.114 0.306 0.847');
    drawText(425, 800, state.settings?.subject || DEFAULT_SETTINGS.subject, 'F2', 8.5, '0.28 0.34 0.43');
    y = 772;
  };

  // Page 1 Header Banner
  const subject = state.settings?.subject || DEFAULT_SETTINGS.subject;
  const mainTopic = state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;
  const duration = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;

  commands.push('0.114 0.306 0.847 rg 40 754 515 58 re f');
  drawText(54, 788, 'CBT ONLINE - BANK SOAL & KUNCI JAWABAN', 'F2', 13.5, '1 1 1');
  drawText(54, 770, `Mata Pelajaran: ${subject} | Materi: ${mainTopic}`, 'F1', 9, '0.88 0.94 1');

  // Summary Meta Box
  const counts = { pg: 0, pg_kompleks: 0, isian: 0, benar_salah: 0 };
  questionsList.forEach((q) => {
    if (counts[q.type] !== undefined) counts[q.type]++;
  });

  const hasFilter = Boolean(
    filterMeta.search ||
      (filterMeta.type && filterMeta.type !== 'all') ||
      (filterMeta.topic && filterMeta.topic !== 'all')
  );
  const boxHeight = hasFilter ? 68 : 54;
  const boxBottom = 742 - boxHeight;

  commands.push(`0.97 0.98 0.99 rg 40 ${boxBottom} 515 ${boxHeight} re f`);
  commands.push(`0.88 0.91 0.94 RG 0.8 w 40 ${boxBottom} 515 ${boxHeight} re S`);

  drawText(52, 725, `Jumlah Soal: ${questionsList.length} Butir | Durasi Ujian: ${duration} Menit`, 'F2', 9.5);
  drawText(340, 725, `Diekspor: ${formatDateTimeID(new Date().toISOString())}`, 'F1', 8.5, '0.33 0.39 0.48');
  drawText(
    52,
    708,
    `Komposisi: PG (${counts.pg}) | PG Kompleks (${counts.pg_kompleks}) | Isian (${counts.isian}) | Benar/Salah (${counts.benar_salah})`,
    'F1',
    8.8,
    '0.20 0.25 0.33'
  );

  if (hasFilter) {
    const filterParts = [];
    if (filterMeta.type && filterMeta.type !== 'all') filterParts.push(`Jenis: ${TYPE_LABELS[filterMeta.type] || filterMeta.type}`);
    if (filterMeta.topic && filterMeta.topic !== 'all') filterParts.push(`Materi: ${filterMeta.topic}`);
    if (filterMeta.search) filterParts.push(`Kata kunci: "${filterMeta.search}"`);
    drawText(52, 691, `Filter Aktif: ${filterParts.join(' | ')}`, 'F2', 8.3, '0.114 0.306 0.847');
  }

  y = boxBottom - 20;

  questionsList.forEach((q, idx) => {
    const typeLabel = TYPE_LABELS[q.type] || q.type;
    const headerText = `${idx + 1}. [${q.id}] ${typeLabel} - ${q.topic}`;
    const qLines = wrapText(q.question, 86);

    // Prepare options lines
    const optionEntries = [];
    if ((q.type === 'pg' || q.type === 'pg_kompleks') && q.options) {
      const keys = Object.keys(q.options);
      const correctKeys =
        q.type === 'pg'
          ? [String(q.answer || '').trim()]
          : Array.isArray(q.answer)
            ? q.answer
            : [];

      keys.forEach((key) => {
        const isCorrectOpt = correctKeys.includes(key);
        const prefix = isCorrectOpt ? `${key}. [KUNCI] ` : `${key}. `;
        const wrapped = wrapText(`${prefix}${q.options[key]}`, 80);
        optionEntries.push({ lines: wrapped, isCorrect: isCorrectOpt });
      });
    } else if (q.type === 'benar_salah') {
      const ansStr = String(q.answer || '').trim();
      optionEntries.push({
        lines: [`Opsi: Benar${ansStr === 'Benar' ? ' [KUNCI]' : ''}  /  Salah${ansStr === 'Salah' ? ' [KUNCI]' : ''}`],
        isCorrect: false,
      });
    }

    const answerLines = wrapText(`Kunci Jawaban Benar: ${formatCorrectAnswerWithDetail(q)}`, 82);
    const expLines = q.explanation ? wrapText(`Pembahasan: ${q.explanation}`, 84) : [];

    // Estimate exact height required for this question block
    let blockHeight = 14; // header line
    blockHeight += qLines.length * 12 + 3;
    optionEntries.forEach((opt) => {
      blockHeight += opt.lines.length * 11.5 + 1.5;
    });
    blockHeight += 4 + answerLines.length * 12;
    if (expLines.length > 0) {
      blockHeight += 2 + expLines.length * 11;
    }
    blockHeight += 14; // divider + spacing

    if (y - blockHeight < bottomLimit && y < 740) {
      startNewPage();
    }

    // Question metadata line
    drawText(40, y, headerText, 'F2', 8.8, '0.114 0.306 0.847');
    y -= 14;

    // Question body
    qLines.forEach((line) => {
      if (y < bottomLimit) startNewPage();
      drawText(40, y, line, 'F2', 9.5, '0.06 0.09 0.16');
      y -= 12;
    });
    y -= 3;

    // Options
    optionEntries.forEach((opt) => {
      opt.lines.forEach((line, lIdx) => {
        if (y < bottomLimit) startNewPage();
        drawText(
          lIdx === 0 ? 52 : 66,
          y,
          line,
          opt.isCorrect ? 'F2' : 'F1',
          9,
          opt.isCorrect ? '0.02 0.47 0.34' : '0.20 0.25 0.33'
        );
        y -= 11.5;
      });
      y -= 1.5;
    });

    y -= 3;
    // Correct Answer highlight bar
    answerLines.forEach((line) => {
      if (y < bottomLimit) startNewPage();
      drawText(48, y, line, 'F2', 9, '0.02 0.47 0.34');
      y -= 12;
    });

    // Explanation
    if (expLines.length > 0) {
      y -= 2;
      expLines.forEach((line) => {
        if (y < bottomLimit) startNewPage();
        drawText(48, y, line, 'F1', 8.5, '0.35 0.42 0.51');
        y -= 11;
      });
    }

    // Subtle divider line
    y -= 4;
    if (y >= bottomLimit) {
      commands.push(`0.88 0.91 0.94 RG 0.6 w 40 ${y} m 555 ${y} l S`);
      y -= 12;
    }
  });

  if (commands.length > 0) pageCommandLists.push(commands);

  const totalPages = pageCommandLists.length;
  const pageStreams = pageCommandLists.map((cmds, pIdx) => {
    const pageCmds = [...cmds];
    pageCmds.push('0.88 0.91 0.94 RG 0.6 w 40 38 m 555 38 l S');
    pushTextCmd(pageCmds, 40, 24, 'CBT ONLINE - Bank Soal & Kunci Jawaban Resmi', 'F1', 8, '0.45 0.51 0.60');
    pushTextCmd(pageCmds, 488, 24, `Halaman ${pIdx + 1} dari ${totalPages}`, 'F1', 8, '0.45 0.51 0.60');
    return pageCmds.join('\n');
  });

  return buildPdfBlobFromPageStreams(pageStreams);
}

function exportQuestionBankToPdf() {
  const { list, meta } = getFilteredAdminQuestions();
  if (list.length === 0) {
    showToast('Tidak ada soal yang dapat diekspor ke PDF.', 'error');
    return;
  }

  const blob = generateQuestionBankPdfBlob(list, meta);
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerFileDownload(blob, `Bank_Soal_dan_Kunci_CBT_ONLINE_${dateTag}.pdf`);
  showToast(`Berhasil mengekspor ${list.length} soal beserta kunci jawaban ke PDF.`, 'success');
}

/* ==================== EKSPOR PAPER TEST MANUAL SISWA (PDF + PREVIEW) ==================== */
function loadPaperTestConfig() {
  const saved = readStorage(STORAGE_KEYS.PAPER_TEST, null);
  state.paperTestConfig = {
    institution: typeof saved?.institution === 'string' && saved.institution.trim()
      ? saved.institution.trim()
      : DEFAULT_PAPER_TEST_CONFIG.institution,
    schoolName: typeof saved?.schoolName === 'string' && saved.schoolName.trim()
      ? saved.schoolName.trim()
      : DEFAULT_PAPER_TEST_CONFIG.schoolName,
    address: typeof saved?.address === 'string' && saved.address.trim()
      ? saved.address.trim()
      : DEFAULT_PAPER_TEST_CONFIG.address,
    examTitle: typeof saved?.examTitle === 'string' && saved.examTitle.trim()
      ? saved.examTitle.trim()
      : DEFAULT_PAPER_TEST_CONFIG.examTitle,
    studentName: typeof saved?.studentName === 'string' ? saved.studentName : '',
    studentClass: typeof saved?.studentClass === 'string' ? saved.studentClass : '',
    studentAbsen: typeof saved?.studentAbsen === 'string' ? saved.studentAbsen : '',
    examDate: typeof saved?.examDate === 'string' ? saved.examDate : '',
    orderMode: ['follow', 'ordered', 'shuffle'].includes(saved?.orderMode) ? saved.orderMode : 'follow',
    includeInstructions: saved?.includeInstructions !== false,
  };
  return state.paperTestConfig;
}

function readPaperTestFormConfig() {
  if (!state.paperTestConfig) loadPaperTestConfig();
  const institution = (document.getElementById('paper-kop-institution')?.value ?? state.paperTestConfig.institution).trim();
  const schoolName = (document.getElementById('paper-kop-school')?.value ?? state.paperTestConfig.schoolName).trim();
  const address = (document.getElementById('paper-kop-address')?.value ?? state.paperTestConfig.address).trim();
  const examTitle = (document.getElementById('paper-kop-title')?.value ?? state.paperTestConfig.examTitle).trim();
  const studentName = (document.getElementById('paper-student-name')?.value ?? state.paperTestConfig.studentName).trim();
  const studentClass = (document.getElementById('paper-student-class')?.value ?? state.paperTestConfig.studentClass).trim();
  const studentAbsen = (document.getElementById('paper-student-absen')?.value ?? state.paperTestConfig.studentAbsen).trim();
  const examDate = (document.getElementById('paper-exam-date')?.value ?? state.paperTestConfig.examDate).trim();
  const orderModeEl = document.getElementById('paper-order-mode');
  const orderMode = orderModeEl ? orderModeEl.value : state.paperTestConfig.orderMode;
  const instrEl = document.getElementById('paper-include-instructions');
  const includeInstructions = instrEl ? instrEl.checked : state.paperTestConfig.includeInstructions;

  return {
    institution,
    schoolName: schoolName || DEFAULT_PAPER_TEST_CONFIG.schoolName,
    address,
    examTitle: examTitle || DEFAULT_PAPER_TEST_CONFIG.examTitle,
    studentName,
    studentClass,
    studentAbsen,
    examDate,
    orderMode: ['follow', 'ordered', 'shuffle'].includes(orderMode) ? orderMode : 'follow',
    includeInstructions,
  };
}

function savePaperTestFormToStorage() {
  const cfg = readPaperTestFormConfig();
  state.paperTestConfig = cfg;
  writeStorage(STORAGE_KEYS.PAPER_TEST, cfg);
  return cfg;
}

function populatePaperTestClassDropdown(selectedValue = '') {
  const selectEl = document.getElementById('paper-student-class');
  if (!selectEl) return;

  const classList = typeof getEffectiveClassList === 'function'
    ? getEffectiveClassList()
    : [...DEFAULT_CLASS_LIST];

  const grouped = { X: [], XI: [], XII: [], OTHER: [] };
  classList.forEach((cls) => {
    const g = typeof getClassGrade === 'function' ? getClassGrade(cls) : '';
    if (g === 'X' || g === 'XI' || g === 'XII') {
      grouped[g].push(cls);
    } else {
      grouped.OTHER.push(cls);
    }
  });

  const opts = [
    '<option value="">Kosongkan — Diisi Manual oleh Siswa (........)</option>',
    '<optgroup label="Pilihan Tingkat Kelas">',
    '<option value="TINGKAT:X">Kelas X (Subkelas diisi manual siswa)</option>',
    '<option value="TINGKAT:XI">Kelas XI (Subkelas diisi manual siswa)</option>',
    '<option value="TINGKAT:XII">Kelas XII (Subkelas diisi manual siswa)</option>',
    '</optgroup>',
  ];

  (['X', 'XI', 'XII']).forEach((grade) => {
    if (grouped[grade].length > 0) {
      opts.push(`<optgroup label="Kelas ${grade} (${grouped[grade][0]} – ${grouped[grade][grouped[grade].length - 1]})">`);
      grouped[grade].forEach((cls) => {
        opts.push(`<option value="${escapeHtml(cls)}">${escapeHtml(cls)}</option>`);
      });
      opts.push('</optgroup>');
    }
  });

  if (grouped.OTHER.length > 0) {
    opts.push('<optgroup label="Kelas Lainnya">');
    grouped.OTHER.forEach((cls) => {
      opts.push(`<option value="${escapeHtml(cls)}">${escapeHtml(cls)}</option>`);
    });
    opts.push('</optgroup>');
  }

  selectEl.innerHTML = opts.join('');
  if (selectedValue && Array.from(selectEl.options).some((o) => o.value === selectedValue)) {
    selectEl.value = selectedValue;
  } else {
    selectEl.value = '';
  }
}

function getPaperTestClassDisplayText(rawClassValue) {
  const val = String(rawClassValue || '').trim();
  if (!val) return '';
  if (val.startsWith('TINGKAT:')) {
    return `${val.slice('TINGKAT:'.length)} - ........`;
  }
  return val;
}

function getPaperTestPackageInfo(forceReshuffle = false) {
  if (!state.studentQuestionConfig) loadStudentQuestionConfig();
  const activeCfg = state.draftStudentQuestionConfig || state.studentQuestionConfig;
  const activeIdSet = typeof getDraftSelectedQuestionIdSet === 'function'
    ? getDraftSelectedQuestionIdSet()
    : new Set(getActiveStudentQuestions().map((q) => q.id));

  let baseQuestions = (state.questions || []).filter((q) => activeIdSet.has(q.id));
  if (activeCfg.mode === 'preset50') {
    baseQuestions = (state.questions || []).slice(0, Math.min(DEFAULT_STUDENT_QUESTION_COUNT, state.questions.length));
  } else if (activeCfg.mode === 'all') {
    baseQuestions = [...(state.questions || [])];
  }

  const cfg = readPaperTestFormConfig();
  const effectiveShuffle =
    cfg.orderMode === 'shuffle' || (cfg.orderMode === 'follow' && activeCfg.orderMode === 'shuffle');

  let finalQuestions = [...baseQuestions];
  if (effectiveShuffle && finalQuestions.length > 1) {
    const baseIdSet = new Set(finalQuestions.map((q) => q.id));
    const canReuseCachedOrder =
      !forceReshuffle &&
      Array.isArray(state.paperTestOrderIds) &&
      state.paperTestOrderIds.length === finalQuestions.length &&
      state.paperTestOrderIds.every((id) => baseIdSet.has(id));

    if (!canReuseCachedOrder) {
      const shuffled = shuffleArray(finalQuestions);
      state.paperTestOrderIds = shuffled.map((q) => q.id);
    }

    const qById = new Map(finalQuestions.map((q) => [q.id, q]));
    finalQuestions = state.paperTestOrderIds.map((id) => qById.get(id)).filter(Boolean);
  } else {
    state.paperTestOrderIds = null;
  }

  const modeLabels = {
    preset50: `Paket ${DEFAULT_STUDENT_QUESTION_COUNT} Soal`,
    custom: 'Pilihan Soal Tertentu (Checklist)',
    all: `Semua Soal Bank Soal (${state.questions.length} Soal)`,
  };
  const modeLabel = modeLabels[activeCfg.mode] || 'Paket Soal Siswa';
  const orderLabel = effectiveShuffle ? 'Urutan Acak' : 'Berurutan';
  const isDraftDirty = typeof isStudentQuestionConfigDirty === 'function' && isStudentQuestionConfigDirty();

  return {
    questions: finalQuestions,
    mode: activeCfg.mode,
    modeLabel,
    orderLabel,
    effectiveShuffle,
    isDraftDirty,
  };
}

function estimatePaperTestPageCount(questionsList, config) {
  let y = 595 - (config.includeInstructions ? 45 : 0);
  let pages = 1;
  const bottomLimit = 56;
  questionsList.forEach((q) => {
    const qLines = wrapText(q.question, 84);
    let h = qLines.length * 12.5 + 8;
    if ((q.type === 'pg' || q.type === 'pg_kompleks') && q.options) {
      Object.keys(q.options).forEach((k) => {
        if (q.options[k]) h += wrapText(`${k}. ${q.options[k]}`, 78).length * 11.5 + 2;
      });
    } else if (q.type === 'isian') {
      h += 18;
    } else if (q.type === 'benar_salah') {
      h += 16;
    }
    h += 10;
    if (y - h < bottomLimit && y < 740) {
      pages += 1;
      y = 772;
    }
    y -= h;
  });
  return pages;
}

function openPaperTestExportModal() {
  const cfg = loadPaperTestConfig();
  state.paperTestOrderIds = null;

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? '';
  };

  setVal('paper-kop-institution', cfg.institution);
  setVal('paper-kop-school', cfg.schoolName);
  setVal('paper-kop-address', cfg.address);
  setVal('paper-kop-title', cfg.examTitle);
  setVal('paper-student-name', cfg.studentName);
  setVal('paper-student-absen', cfg.studentAbsen);
  setVal('paper-exam-date', cfg.examDate);
  setVal('paper-order-mode', cfg.orderMode);

  const instrEl = document.getElementById('paper-include-instructions');
  if (instrEl) instrEl.checked = cfg.includeInstructions !== false;

  populatePaperTestClassDropdown(cfg.studentClass);
  renderPaperTestPreview(true);
  openModal('modal-paper-test-export');
}

function renderPaperTestPreview(forceReshuffle = false) {
  const cfg = readPaperTestFormConfig();
  const pkg = getPaperTestPackageInfo(forceReshuffle);
  const questionsList = pkg.questions;

  const sourceBadge = document.getElementById('paper-test-source-badge');
  if (sourceBadge) {
    sourceBadge.innerHTML = `
      <strong>Paket Menu Perubahan Soal Siswa:</strong> ${escapeHtml(String(questionsList.length))} Soal Tes
      <br />
      <span>Mode: ${escapeHtml(pkg.modeLabel)} · ${escapeHtml(pkg.orderLabel)}${pkg.isDraftDirty ? ' <em>(mengikuti pilihan draf aktif)</em>' : ''}</span>
    `;
  }

  const reshuffleBtn = document.getElementById('btn-paper-reshuffle');
  if (reshuffleBtn) {
    reshuffleBtn.classList.toggle('hidden', !pkg.effectiveShuffle);
  }

  const subject = state.settings?.subject || DEFAULT_SETTINGS.subject;
  const mainTopic = state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;
  const duration = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;
  const classDisplay = getPaperTestClassDisplayText(cfg.studentClass);
  const estPages = questionsList.length > 0 ? estimatePaperTestPageCount(questionsList, cfg) : 1;

  const previewMeta = document.getElementById('paper-preview-meta');
  if (previewMeta) {
    previewMeta.textContent = `${questionsList.length} Butir Soal · Estimasi ${estPages} Halaman PDF · Tanpa Kunci Jawaban`;
  }

  const sheetEl = document.getElementById('paper-test-preview-sheet');
  if (!sheetEl) return;

  if (questionsList.length === 0) {
    sheetEl.innerHTML = `
      <div class="empty-state">
        Belum ada soal yang dipilih pada <strong>Menu Perubahan Soal Siswa</strong>. Pilih minimal 1 soal terlebih dahulu untuk melihat pratinjau Paper Test.
      </div>
    `;
    return;
  }

  const questionsHtml = questionsList
    .map((q, idx) => {
      let typeNote = '';
      if (q.type === 'pg_kompleks') typeNote = '[PG Kompleks — Pilih lebih dari satu]';
      else if (q.type === 'isian') typeNote = '[Isian Singkat — Angka]';
      else if (q.type === 'benar_salah') typeNote = '[Benar / Salah]';

      let bodyHtml = '';
      if ((q.type === 'pg' || q.type === 'pg_kompleks') && q.options) {
        const isMulti = q.type === 'pg_kompleks';
        const keys = ['A', 'B', 'C', 'D', 'E'].filter((k) => Boolean(q.options[k]));
        bodyHtml = `
          <div class="paper-q-options">
            ${keys
              .map(
                (k) => `
              <div class="paper-q-option">
                <span class="paper-q-opt-marker">${isMulti ? `[ ] ${k}.` : `${k}.`}</span>
                <span>${escapeHtml(q.options[k])}</span>
              </div>
            `
              )
              .join('')}
          </div>
        `;
      } else if (q.type === 'isian') {
        bodyHtml = `
          <div class="paper-q-isian-line">
            Jawaban: __________________________________________
          </div>
        `;
      } else if (q.type === 'benar_salah') {
        bodyHtml = `
          <div class="paper-q-tf-row">
            <span>[  ] Benar</span>
            <span>[  ] Salah</span>
          </div>
        `;
      }

      return `
        <div class="paper-q-item">
          <div class="paper-q-prompt">
            <span class="paper-q-num">${idx + 1}.</span>
            <div>
              <span>${escapeHtml(q.question)}</span>
              ${typeNote ? `<span class="paper-q-type-note">${escapeHtml(typeNote)}</span>` : ''}
            </div>
          </div>
          ${bodyHtml}
        </div>
      `;
    })
    .join('');

  const instructionsHtml = cfg.includeInstructions
    ? `
      <div class="paper-instructions-box">
        <strong>PETUNJUK PENGERJAAN:</strong>
        <ol>
          <li>Tuliskan Nama Lengkap, Kelas, dan Nomor Absen pada kolom identitas di atas sebelum mengerjakan soal.</li>
          <li>Bacalah setiap butir soal dengan teliti. Pada soal Pilihan Ganda pilih satu jawaban paling tepat; pada PG Kompleks beri tanda pada lebih dari satu pilihan benar.</li>
          <li>Untuk soal Isian Singkat tuliskan angka pada garis jawaban, dan untuk Benar/Salah beri tanda pada salah satu pilihan.</li>
        </ol>
      </div>
    `
    : '';

  sheetEl.innerHTML = `
    <header class="paper-kop">
      ${cfg.institution ? `<div class="paper-kop-institution">${escapeHtml(cfg.institution)}</div>` : ''}
      <div class="paper-kop-school">${escapeHtml(cfg.schoolName)}</div>
      ${cfg.address ? `<div class="paper-kop-address">${escapeHtml(cfg.address)}</div>` : ''}
    </header>

    <div class="paper-exam-title-block">
      <h4 class="paper-exam-title">${escapeHtml(cfg.examTitle)}</h4>
      <div class="paper-exam-subtitle">${escapeHtml(subject)} — ${escapeHtml(mainTopic)}</div>
    </div>

    <div class="paper-identity-box">
      <div class="paper-id-row">
        <span class="paper-id-label">Nama Siswa</span>
        <span>:</span>
        <span class="paper-id-value${cfg.studentName ? ' is-solid' : ''}">${cfg.studentName ? escapeHtml(cfg.studentName) : '&nbsp;'}</span>
      </div>
      <div class="paper-id-row">
        <span class="paper-id-label">Mata Pelajaran</span>
        <span>:</span>
        <span class="paper-id-value is-solid">${escapeHtml(subject)}</span>
      </div>
      <div class="paper-id-row">
        <span class="paper-id-label">Kelas</span>
        <span>:</span>
        <span class="paper-id-value${classDisplay ? ' is-solid' : ''}">${classDisplay ? escapeHtml(classDisplay) : '&nbsp;'}</span>
      </div>
      <div class="paper-id-row">
        <span class="paper-id-label">Waktu / Soal</span>
        <span>:</span>
        <span class="paper-id-value is-solid">${escapeHtml(String(duration))} Menit · ${escapeHtml(String(questionsList.length))} Soal (${escapeHtml(pkg.modeLabel)})</span>
      </div>
      <div class="paper-id-row">
        <span class="paper-id-label">Nomor Absen</span>
        <span>:</span>
        <span class="paper-id-value${cfg.studentAbsen ? ' is-solid' : ''}">${cfg.studentAbsen ? escapeHtml(cfg.studentAbsen) : '&nbsp;'}</span>
      </div>
      <div class="paper-id-row">
        <span class="paper-id-label">Hari / Tanggal</span>
        <span>:</span>
        <span class="paper-id-value${cfg.examDate ? ' is-solid' : ''}">${cfg.examDate ? escapeHtml(cfg.examDate) : '&nbsp;'}</span>
      </div>
    </div>

    ${instructionsHtml}

    <div class="paper-questions-list">
      ${questionsHtml}
    </div>
  `;
}

function generatePaperTestPdfBlob(questionsList, config, pkgInfo) {
  const pageCommandLists = [];
  let commands = [];
  let y = 795;
  const bottomLimit = 56;

  const subject = state.settings?.subject || DEFAULT_SETTINGS.subject;
  const mainTopic = state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;
  const duration = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;
  const classDisplay = getPaperTestClassDisplayText(config.studentClass);

  const pushTextCmd = (target, x, yPos, text, font = 'F1', size = 9.5, color = '0.06 0.09 0.16') => {
    target.push(`BT /${font} ${size} Tf ${color} rg ${x} ${yPos} Td (${sanitizePdfText(text)}) Tj ET`);
  };

  const drawText = (x, yPos, text, font = 'F1', size = 9.5, color = '0.06 0.09 0.16') => {
    pushTextCmd(commands, x, yPos, text, font, size, color);
  };

  const drawCenteredText = (yPos, text, font = 'F1', size = 10, color = '0.06 0.09 0.16') => {
    const clean = sanitizePdfText(text);
    const charFactor = font === 'F2' ? 0.54 : 0.50;
    const estWidth = clean.length * size * charFactor;
    const x = Math.max(40, Math.round((595 - estWidth) / 2));
    pushTextCmd(commands, x, yPos, text, font, size, color);
  };

  const startNewPage = () => {
    if (commands.length > 0) pageCommandLists.push(commands);
    commands = [];
    // Running header on continuation pages so printed sheets keep student identity & school context
    commands.push('0.97 0.98 0.99 rg 40 792 515 24 re f');
    commands.push('0.80 0.85 0.92 RG 0.6 w 40 792 515 24 re S');
    const shortSchool = config.schoolName.length > 36 ? `${config.schoolName.slice(0, 35)}...` : config.schoolName;
    drawText(48, 800, `${shortSchool} - ${subject}`, 'F2', 8.5, '0.12 0.16 0.24');
    const idInline = `Nama: ${config.studentName || '....................'} | Kelas: ${classDisplay || '........'}`;
    drawText(318, 800, idInline, 'F1', 8.3, '0.28 0.34 0.43');
    y = 772;
  };

  // Page 1: KOP SEKOLAH
  if (config.institution) {
    drawCenteredText(y, config.institution.toUpperCase(), 'F2', 9.5, '0.18 0.23 0.32');
    y -= 15;
  }
  drawCenteredText(y, config.schoolName.toUpperCase(), 'F2', 13, '0.06 0.09 0.16');
  y -= 13;
  if (config.address) {
    drawCenteredText(y, config.address, 'F1', 8.5, '0.32 0.38 0.48');
    y -= 10;
  } else {
    y -= 4;
  }

  // Classic Indonesian Kop Sekolah double divider line
  commands.push(`0.06 0.09 0.16 RG 2.0 w 40 ${y} m 555 ${y} l S`);
  commands.push(`0.06 0.09 0.16 RG 0.7 w 40 ${y - 3} m 555 ${y - 3} l S`);
  y -= 18;

  // Judul Lembar Soal
  drawCenteredText(y, config.examTitle.toUpperCase(), 'F2', 11, '0.06 0.09 0.16');
  y -= 13;
  const subTitleLine = `${subject} - ${mainTopic}`;
  const subWrapped = wrapText(subTitleLine, 84);
  subWrapped.slice(0, 2).forEach((line) => {
    drawCenteredText(y, line, 'F1', 8.8, '0.24 0.30 0.40');
    y -= 11;
  });
  y -= 4;

  // Kotak Identitas Siswa & Ujian (Nama Siswa, Kelas, No. Absen, Mata Pelajaran, Waktu, Paket)
  const idBoxHeight = 64;
  const idBoxBottom = y - idBoxHeight;
  commands.push(`0.97 0.98 0.99 rg 40 ${idBoxBottom} 515 ${idBoxHeight} re f`);
  commands.push(`0.25 0.31 0.40 RG 0.9 w 40 ${idBoxBottom} 515 ${idBoxHeight} re S`);

  const row1Y = y - 16;
  const row2Y = y - 35;
  const row3Y = y - 54;

  drawText(50, row1Y, `Nama Siswa  : ${config.studentName || '......................................'}`, config.studentName ? 'F2' : 'F1', 9.2);
  drawText(50, row2Y, `Kelas       : ${classDisplay || '......................'}`, classDisplay ? 'F2' : 'F1', 9.2);
  drawText(50, row3Y, `No. Absen   : ${config.studentAbsen || '..........'}   Tgl: ${config.examDate || '..............'}`, 'F1', 8.8);

  drawText(315, row1Y, `Mata Pelajaran: ${subject.slice(0, 26)}`, 'F2', 9.0);
  drawText(315, row2Y, `Waktu / Soal  : ${duration} Menit (${questionsList.length} Soal)`, 'F1', 9.0);
  drawText(315, row3Y, `Paket Soal    : ${pkgInfo.modeLabel.slice(0, 28)}`, 'F1', 8.6, '0.25 0.32 0.42');

  y = idBoxBottom - 14;

  // Petunjuk Singkat Pengerjaan
  if (config.includeInstructions) {
    const instrBoxH = 46;
    const instrBottom = y - instrBoxH;
    commands.push(`0.98 0.99 1 rg 40 ${instrBottom} 515 ${instrBoxH} re f`);
    commands.push(`0.82 0.86 0.92 RG 0.6 w 40 ${instrBottom} 515 ${instrBoxH} re S`);
    drawText(48, y - 12, 'PETUNJUK PENGERJAAN:', 'F2', 8.2, '0.08 0.12 0.20');
    drawText(48, y - 23, '1. Tuliskan Nama Siswa, Kelas, dan No. Absen pada kotak identitas di atas sebelum mulai mengerjakan.', 'F1', 8, '0.24 0.30 0.40');
    drawText(48, y - 34, '2. Pilih jawaban paling tepat untuk PG, beri tanda pada >1 opsi untuk PG Kompleks, atau isi angka/Benar-Salah.', 'F1', 8, '0.24 0.30 0.40');
    y = instrBottom - 16;
  }

  // Render Soal Tes Saja (Tanpa Kunci & Pembahasan)
  questionsList.forEach((q, idx) => {
    let typeBadge = '';
    if (q.type === 'pg_kompleks') typeBadge = ' [PG Kompleks - Pilih >1]';
    else if (q.type === 'isian') typeBadge = ' [Isian Angka]';
    else if (q.type === 'benar_salah') typeBadge = ' [Benar / Salah]';

    const promptText = `${idx + 1}. ${q.question}${typeBadge}`;
    const qLines = wrapText(promptText, 86);

    const optionRows = [];
    if ((q.type === 'pg' || q.type === 'pg_kompleks') && q.options) {
      const isMulti = q.type === 'pg_kompleks';
      ['A', 'B', 'C', 'D', 'E'].forEach((key) => {
        if (!q.options[key]) return;
        const prefix = isMulti ? `[ ] ${key}. ` : `${key}. `;
        const wrapped = wrapText(`${prefix}${q.options[key]}`, 80);
        optionRows.push(wrapped);
      });
    } else if (q.type === 'isian') {
      optionRows.push(['Jawaban: __________________________________________']);
    } else if (q.type === 'benar_salah') {
      optionRows.push(['[  ] Benar          [  ] Salah']);
    }

    let blockHeight = qLines.length * 12 + 4;
    optionRows.forEach((lines) => {
      blockHeight += lines.length * 11.5 + 1.5;
    });
    blockHeight += 8;

    if (y - blockHeight < bottomLimit && y < 740) {
      startNewPage();
    }

    qLines.forEach((line) => {
      if (y < bottomLimit) startNewPage();
      drawText(40, y, line, 'F2', 9.3, '0.06 0.09 0.16');
      y -= 12;
    });
    y -= 2;

    optionRows.forEach((lines) => {
      lines.forEach((line, lIdx) => {
        if (y < bottomLimit) startNewPage();
        drawText(lIdx === 0 ? 54 : 70, y, line, 'F1', 9.0, '0.16 0.21 0.30');
        y -= 11.5;
      });
      y -= 1.5;
    });

    y -= 7;
  });

  if (commands.length > 0) pageCommandLists.push(commands);

  const totalPages = pageCommandLists.length;
  const pageStreams = pageCommandLists.map((cmds, pIdx) => {
    const pageCmds = [...cmds];
    pageCmds.push('0.88 0.91 0.94 RG 0.6 w 40 38 m 555 38 l S');
    pushTextCmd(
      pageCmds,
      40,
      24,
      `${config.schoolName.slice(0, 44)} - Lembar Soal Paper Test Siswa`,
      'F1',
      8,
      '0.45 0.51 0.60'
    );
    pushTextCmd(pageCmds, 488, 24, `Halaman ${pIdx + 1} dari ${totalPages}`, 'F1', 8, '0.45 0.51 0.60');
    return pageCmds.join('\n');
  });

  return buildPdfBlobFromPageStreams(pageStreams);
}

function downloadPaperTestPdf() {
  const cfg = savePaperTestFormToStorage();
  const pkg = getPaperTestPackageInfo(false);
  if (pkg.questions.length === 0) {
    showToast('Tidak ada soal aktif di Menu Perubahan Soal Siswa untuk diekspor.', 'error');
    return;
  }

  const blob = generatePaperTestPdfBlob(pkg.questions, cfg, pkg);
  const dateTag = new Date().toISOString().slice(0, 10);
  const rawSubj = (state.settings?.subject || 'INFORMATIKA').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const rawClass = (getPaperTestClassDisplayText(cfg.studentClass) || 'Siswa')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  triggerFileDownload(blob, `Paper_Test_${rawSubj}_${rawClass}_${dateTag}.pdf`);
  showToast(`PDF Paper Test (${pkg.questions.length} soal tanpa kunci jawaban) berhasil diunduh.`, 'success');
}

/* ==================== MENU KISI-KISI SOAL (PDF + PREVIEW + LOGO) ==================== */
function loadKisiKisiConfig() {
  const saved = readStorage(STORAGE_KEYS.KISI_KISI, null);
  const paperSaved = readStorage(STORAGE_KEYS.PAPER_TEST, null);
  const activeSubject = state.settings?.subject || DEFAULT_SETTINGS.subject;
  const activeMainTopic = state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;
  const defaultTitle = `KISI-KISI PENULISAN SOAL MATA PELAJARAN ${activeSubject.toUpperCase()}`;

  state.kisiKisiConfig = {
    institution:
      typeof saved?.institution === 'string' && saved.institution.trim()
        ? saved.institution.trim()
        : paperSaved?.institution || DEFAULT_KISI_KISI_CONFIG.institution,
    schoolName:
      typeof saved?.schoolName === 'string' && saved.schoolName.trim()
        ? saved.schoolName.trim()
        : paperSaved?.schoolName || DEFAULT_KISI_KISI_CONFIG.schoolName,
    address:
      typeof saved?.address === 'string' && saved.address.trim()
        ? saved.address.trim()
        : paperSaved?.address || DEFAULT_KISI_KISI_CONFIG.address,
    docTitle:
      typeof saved?.docTitle === 'string' && saved.docTitle.trim()
        ? saved.docTitle.trim()
        : defaultTitle,
    subject:
      typeof saved?.subject === 'string' && saved.subject.trim()
        ? saved.subject.trim()
        : activeSubject,
    mainTopic:
      typeof saved?.mainTopic === 'string' && saved.mainTopic.trim()
        ? saved.mainTopic.trim()
        : activeMainTopic,
    teacherName: typeof saved?.teacherName === 'string' ? saved.teacherName : '',
    academicYear:
      typeof saved?.academicYear === 'string' && saved.academicYear.trim()
        ? saved.academicYear.trim()
        : DEFAULT_KISI_KISI_CONFIG.academicYear,
    classLevel:
      typeof saved?.classLevel === 'string' && saved.classLevel.trim()
        ? saved.classLevel.trim()
        : DEFAULT_KISI_KISI_CONFIG.classLevel,
    questionScope: saved?.questionScope === 'active_student' ? 'active_student' : 'all_bank',
    includeKeyCol: Boolean(saved?.includeKeyCol),
    includeSignature: saved?.includeSignature !== false,
    logoDataUrl: typeof saved?.logoDataUrl === 'string' ? saved.logoDataUrl : '',
    logoWidth: Number(saved?.logoWidth) > 0 ? Number(saved.logoWidth) : 0,
    logoHeight: Number(saved?.logoHeight) > 0 ? Number(saved.logoHeight) : 0,
  };
  return state.kisiKisiConfig;
}

function readKisiKisiFormConfig() {
  if (!state.kisiKisiConfig) loadKisiKisiConfig();
  const activeSubject = state.settings?.subject || DEFAULT_SETTINGS.subject;
  const activeMainTopic = state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;

  const valOr = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : fallback;
  };

  const subject = valOr('kisi-subject', state.kisiKisiConfig.subject) || activeSubject;
  const mainTopic = valOr('kisi-main-topic', state.kisiKisiConfig.mainTopic) || activeMainTopic;
  const docTitle =
    valOr('kisi-title', state.kisiKisiConfig.docTitle) ||
    `KISI-KISI PENULISAN SOAL MATA PELAJARAN ${subject.toUpperCase()}`;

  const scopeEl = document.getElementById('kisi-question-scope');
  const keyColEl = document.getElementById('kisi-include-key-col');
  const sigEl = document.getElementById('kisi-include-signature');

  return {
    institution: valOr('kisi-kop-institution', state.kisiKisiConfig.institution),
    schoolName: valOr('kisi-kop-school', state.kisiKisiConfig.schoolName) || DEFAULT_KISI_KISI_CONFIG.schoolName,
    address: valOr('kisi-kop-address', state.kisiKisiConfig.address),
    docTitle,
    subject,
    mainTopic,
    teacherName: valOr('kisi-teacher-name', state.kisiKisiConfig.teacherName),
    academicYear: valOr('kisi-academic-year', state.kisiKisiConfig.academicYear) || DEFAULT_KISI_KISI_CONFIG.academicYear,
    classLevel: valOr('kisi-class-level', state.kisiKisiConfig.classLevel),
    questionScope: scopeEl ? scopeEl.value : state.kisiKisiConfig.questionScope,
    includeKeyCol: keyColEl ? keyColEl.checked : state.kisiKisiConfig.includeKeyCol,
    includeSignature: sigEl ? sigEl.checked : state.kisiKisiConfig.includeSignature,
    logoDataUrl: state.kisiKisiConfig.logoDataUrl || '',
    logoWidth: state.kisiKisiConfig.logoWidth || 0,
    logoHeight: state.kisiKisiConfig.logoHeight || 0,
  };
}

function saveKisiKisiFormToStorage() {
  const cfg = readKisiKisiFormConfig();
  state.kisiKisiConfig = cfg;
  writeStorage(STORAGE_KEYS.KISI_KISI, cfg);
  return cfg;
}

function sanitizeLogoDataUrl(url) {
  const s = String(url || '').trim();
  return /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(s) ? s : '';
}

function updateKisiLogoThumbUI() {
  const cfg = state.kisiKisiConfig || loadKisiKisiConfig();
  const safeLogo = sanitizeLogoDataUrl(cfg.logoDataUrl);
  const thumb = document.getElementById('kisi-logo-thumb');
  const placeholder = document.getElementById('kisi-logo-placeholder');
  const clearBtn = document.getElementById('btn-kisi-logo-clear');

  if (safeLogo && thumb) {
    thumb.src = safeLogo;
    thumb.classList.remove('hidden');
    if (placeholder) placeholder.classList.add('hidden');
    if (clearBtn) clearBtn.classList.remove('hidden');
  } else {
    if (thumb) {
      thumb.removeAttribute('src');
      thumb.classList.add('hidden');
    }
    if (placeholder) placeholder.classList.remove('hidden');
    if (clearBtn) clearBtn.classList.add('hidden');
  }
}

function convertImageFileToJpegDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca berkas gambar logo sekolah.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar logo sekolah tidak didukung.'));
      img.onload = () => {
        const maxDim = 200;
        const srcW = Math.max(1, img.naturalWidth || img.width || 160);
        const srcH = Math.max(1, img.naturalHeight || img.height || 160);
        const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
        const targetW = Math.max(24, Math.round(srcW * scale));
        const targetH = Math.max(24, Math.round(srcH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas tidak tersedia di browser ini.'));
          return;
        }
        // Fill white background so transparent PNG/SVG renders cleanly in PDF DCTDecode
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
        resolve({ dataUrl: jpegDataUrl, width: targetW, height: targetH });
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

async function handleKisiLogoFileChange(e) {
  const file = e.target?.files?.[0];
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) {
    showToast('Ukuran gambar logo maksimal 4 MB.', 'error');
    e.target.value = '';
    return;
  }

  try {
    const converted = await convertImageFileToJpegDataUrl(file);
    if (!state.kisiKisiConfig) loadKisiKisiConfig();
    state.kisiKisiConfig.logoDataUrl = converted.dataUrl;
    state.kisiKisiConfig.logoWidth = converted.width;
    state.kisiKisiConfig.logoHeight = converted.height;
    writeStorage(STORAGE_KEYS.KISI_KISI, state.kisiKisiConfig);
    updateKisiLogoThumbUI();
    renderKisiKisiPreview();
    showToast('Logo sekolah berhasil ditambahkan ke Kop Kisi-Kisi.', 'success');
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Gagal memproses logo sekolah.', 'error');
  }
}

function clearKisiLogo() {
  if (!state.kisiKisiConfig) loadKisiKisiConfig();
  state.kisiKisiConfig.logoDataUrl = '';
  state.kisiKisiConfig.logoWidth = 0;
  state.kisiKisiConfig.logoHeight = 0;
  writeStorage(STORAGE_KEYS.KISI_KISI, state.kisiKisiConfig);
  const input = document.getElementById('kisi-logo-file');
  if (input) input.value = '';
  updateKisiLogoThumbUI();
  renderKisiKisiPreview();
  showToast('Logo sekolah dihapus dari Kop Kisi-Kisi.', 'default');
}

function getKisiKisiQuestions(scope) {
  if (scope === 'active_student') {
    const pkg = getPaperTestPackageInfo(false);
    return pkg.questions || [];
  }
  return [...(state.questions || [])];
}

function matchTopicToSyllabus(topicText, syllabusItems) {
  const cleanTopic = String(topicText || '').trim();
  if (!Array.isArray(syllabusItems) || syllabusItems.length === 0) return cleanTopic || 'Materi Umum';
  if (!cleanTopic) return syllabusItems[0];

  const tLower = cleanTopic.toLowerCase();
  const exact = syllabusItems.find((s) => s.toLowerCase() === tLower);
  if (exact) return exact;

  const partial = syllabusItems.find(
    (s) => s.toLowerCase().includes(tLower) || tLower.includes(s.toLowerCase())
  );
  if (partial) return partial;

  const words = tLower.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  if (words.length > 0) {
    let best = '';
    let bestScore = 0;
    syllabusItems.forEach((s) => {
      const sLower = s.toLowerCase();
      const score = words.reduce((acc, w) => (sLower.includes(w) ? acc + 1 : acc), 0);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    });
    if (bestScore > 0) return best;
  }

  return cleanTopic;
}

function inferCognitiveLevel(q) {
  const txt = String(q?.question || '').toLowerCase();
  if (
    q?.type === 'pg_kompleks' ||
    /(analisis|bandingkan|evaluasi|kesimpulan|mengapa|dampak|studi kasus|kasus berikut|urutkan langkah|perhatikan skenario|manakah pernyataan yang benar)/i.test(txt)
  ) {
    return 'L3 (C4)';
  }
  if (
    q?.type === 'isian' ||
    /(hitung|hasil|keluaran|output|simulasi|langkah ke|berapa|jika diberikan|diterapkan|implementasi)/i.test(txt)
  ) {
    return 'L2 (C3)';
  }
  return 'L1 (C1-C2)';
}

function buildQuestionIndicatorText(q, topicLabel) {
  const rawStem = String(q?.question || '')
    .replace(/\s+/g, ' ')
    .replace(/\.{2,}|\?+$/g, '')
    .trim();

  const shortStem = rawStem.length > 98 ? `${rawStem.slice(0, 95)}...` : rawStem;
  const lvl = inferCognitiveLevel(q);

  let verb = 'mengidentifikasi konsep tentang';
  if (lvl.startsWith('L3')) verb = 'menganalisis dan mengevaluasi';
  else if (lvl.startsWith('L2')) verb = 'menentukan hasil atau menerapkan';

  const typePhrase =
    q?.type === 'pg_kompleks'
      ? 'beberapa pernyataan benar terkait'
      : q?.type === 'isian'
        ? 'nilai atau hasil perhitungan terkait'
        : q?.type === 'benar_salah'
          ? 'kebenaran pernyataan mengenai'
          : verb;

  const topicCtx = topicLabel ? `pada materi ${topicLabel}` : '';
  return `Disajikan soal/ilustrasi ${topicCtx}, peserta didik mampu menentukan ${typePhrase}: "${shortStem}".`
    .replace(/\s+/g, ' ')
    .trim();
}

function formatShortAnswerForKisi(q) {
  if (q.type === 'pg_kompleks' && Array.isArray(q.answer)) {
    return q.answer.join(', ');
  }
  return String(q.answer ?? '-');
}

function buildKisiKisiRows(questionsList, syllabusItems) {
  const typeShortLabels = {
    pg: 'PG',
    pg_kompleks: 'PG Kompleks',
    isian: 'Isian',
    benar_salah: 'Benar/Salah',
  };

  return (questionsList || []).map((q, idx) => {
    const matchedMateri = matchTopicToSyllabus(q.topic, syllabusItems);
    const displayMateri =
      matchedMateri && q.topic && matchedMateri.toLowerCase() !== String(q.topic).toLowerCase()
        ? `${q.topic} (${matchedMateri})`
        : matchedMateri || q.topic || '-';

    return {
      no: idx + 1,
      materi: displayMateri,
      indikator: buildQuestionIndicatorText(q, q.topic || matchedMateri),
      level: inferCognitiveLevel(q),
      bentuk: typeShortLabels[q.type] || 'PG',
      noSoal: idx + 1,
      kunci: formatShortAnswerForKisi(q),
    };
  });
}

function openKisiKisiModal() {
  if (!state.settings) loadExamSettings();
  const cfg = loadKisiKisiConfig();
  const activeSubject = state.settings?.subject || DEFAULT_SETTINGS.subject;
  const activeMainTopic = state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;

  // Always sync subject & main topic with latest Cakupan Materi settings
  cfg.subject = activeSubject;
  cfg.mainTopic = activeMainTopic;
  if (!cfg.docTitle || /^KISI-KISI PENULISAN SOAL MATA PELAJARAN\b/i.test(cfg.docTitle)) {
    cfg.docTitle = `KISI-KISI PENULISAN SOAL MATA PELAJARAN ${activeSubject.toUpperCase()}`;
  }

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val ?? '';
  };

  setVal('kisi-kop-institution', cfg.institution);
  setVal('kisi-kop-school', cfg.schoolName);
  setVal('kisi-kop-address', cfg.address);
  setVal('kisi-title', cfg.docTitle);
  setVal('kisi-subject', cfg.subject);
  setVal('kisi-main-topic', cfg.mainTopic);
  setVal('kisi-teacher-name', cfg.teacherName);
  setVal('kisi-academic-year', cfg.academicYear);
  setVal('kisi-class-level', cfg.classLevel);

  const scopeEl = document.getElementById('kisi-question-scope');
  if (scopeEl) {
    const activeCount = getActiveStudentQuestions().length;
    const totalCount = (state.questions || []).length;
    const optAll = scopeEl.querySelector('option[value="all_bank"]');
    const optActive = scopeEl.querySelector('option[value="active_student"]');
    if (optAll) optAll.textContent = `Seluruh Bank Soal (${totalCount} Soal)`;
    if (optActive) optActive.textContent = `Paket Soal Aktif Siswa (${activeCount} Soal — Menu Perubahan Soal)`;
    scopeEl.value = cfg.questionScope;
  }

  const keyColEl = document.getElementById('kisi-include-key-col');
  if (keyColEl) keyColEl.checked = Boolean(cfg.includeKeyCol);
  const sigEl = document.getElementById('kisi-include-signature');
  if (sigEl) sigEl.checked = cfg.includeSignature !== false;

  updateKisiLogoThumbUI();
  renderKisiKisiPreview();
  openModal('modal-kisi-kisi-export');
}

function renderKisiKisiPreview() {
  const cfg = readKisiKisiFormConfig();
  const syllabusItems = state.settings?.syllabusItems || DEFAULT_SETTINGS.syllabusItems;
  const duration = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;
  const questionsList = getKisiKisiQuestions(cfg.questionScope);
  const rows = buildKisiKisiRows(questionsList, syllabusItems);

  const sourceBadge = document.getElementById('kisi-source-badge');
  if (sourceBadge) {
    sourceBadge.innerHTML = `
      <strong>Sumber Cakupan Materi:</strong> ${escapeHtml(cfg.subject)} (${escapeHtml(String(syllabusItems.length))} Poin Cakupan)
      <br />
      <span>Memetakan <strong>${escapeHtml(String(rows.length))} butir soal</strong> sesuai Materi Pokok &amp; Bank Soal aktif.</span>
    `;
  }

  const safeLogo = sanitizeLogoDataUrl(cfg.logoDataUrl);
  const previewMeta = document.getElementById('kisi-preview-meta');
  if (previewMeta) {
    previewMeta.textContent = `${rows.length} Baris Kisi-Kisi · ${safeLogo ? 'Dengan Logo Sekolah' : 'Tanpa Logo'} · Siap Unduh PDF`;
  }

  const sheetEl = document.getElementById('kisi-preview-sheet');
  if (!sheetEl) return;

  const kopInnerHtml = `
    ${cfg.institution ? `<div class="paper-kop-institution">${escapeHtml(cfg.institution)}</div>` : ''}
    <div class="paper-kop-school">${escapeHtml(cfg.schoolName)}</div>
    ${cfg.address ? `<div class="paper-kop-address">${escapeHtml(cfg.address)}</div>` : ''}
  `;

  const kopHtml = safeLogo
    ? `
      <header class="paper-kop paper-kop-with-logo">
        <img src="${escapeHtml(safeLogo)}" alt="Logo Sekolah" class="paper-kop-logo" />
        <div class="paper-kop-text-col">${kopInnerHtml}</div>
      </header>
    `
    : `<header class="paper-kop">${kopInnerHtml}</header>`;

  const rowsHtml =
    rows.length > 0
      ? rows
          .map(
            (r) => `
          <tr>
            <td class="kisi-col-center">${r.no}</td>
            <td>${escapeHtml(r.materi)}</td>
            <td>${escapeHtml(r.indikator)}</td>
            <td class="kisi-col-center">${escapeHtml(r.level)}</td>
            <td class="kisi-col-center">${escapeHtml(r.bentuk)}</td>
            <td class="kisi-col-center">${r.noSoal}</td>
            ${cfg.includeKeyCol ? `<td class="kisi-col-center">${escapeHtml(r.kunci)}</td>` : ''}
          </tr>
        `
          )
          .join('')
      : `
        <tr>
          <td colspan="${cfg.includeKeyCol ? 7 : 6}" class="empty-state">
            Belum ada butir soal pada sumber yang dipilih.
          </td>
        </tr>
      `;

  const syllabusListHtml =
    syllabusItems.length > 0
      ? `
      <div class="kisi-syllabus-strip">
        <strong>Cakupan Materi Ujian (${escapeHtml(cfg.subject)}):</strong>
        <ol class="kisi-syllabus-tags">
          ${syllabusItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ol>
      </div>
    `
      : '';

  const sigHtml = cfg.includeSignature
    ? `
      <div class="kisi-signature-block">
        <div class="kisi-signature-inner">
          <div>Mengetahui / Penyusun,</div>
          <div>Guru Pengampu Mata Pelajaran ${escapeHtml(cfg.subject)}</div>
          <div class="kisi-signature-space"></div>
          <div class="kisi-signature-name">${escapeHtml(cfg.teacherName || '..............................................')}</div>
        </div>
      </div>
    `
    : '';

  sheetEl.innerHTML = `
    ${kopHtml}

    <div class="paper-exam-title-block">
      <h4 class="paper-exam-title">${escapeHtml(cfg.docTitle)}</h4>
    </div>

    <div class="paper-identity-box">
      <div class="paper-id-row">
        <span class="paper-id-label">Mata Pelajaran</span>
        <span>:</span>
        <span class="paper-id-value is-solid">${escapeHtml(cfg.subject)}</span>
      </div>
      <div class="paper-id-row">
        <span class="paper-id-label">Tahun Pelajaran</span>
        <span>:</span>
        <span class="paper-id-value is-solid">${escapeHtml(cfg.academicYear)}</span>
      </div>
      <div class="paper-id-row">
        <span class="paper-id-label">Materi Pokok</span>
        <span>:</span>
        <span class="paper-id-value is-solid">${escapeHtml(cfg.mainTopic)}</span>
      </div>
      <div class="paper-id-row">
        <span class="paper-id-label">Kelas / Semester</span>
        <span>:</span>
        <span class="paper-id-value is-solid">${escapeHtml(cfg.classLevel || '-')}</span>
      </div>
      <div class="paper-id-row">
        <span class="paper-id-label">Guru Pengampu</span>
        <span>:</span>
        <span class="paper-id-value${cfg.teacherName ? ' is-solid' : ''}">${cfg.teacherName ? escapeHtml(cfg.teacherName) : '....................................'}</span>
      </div>
      <div class="paper-id-row">
        <span class="paper-id-label">Jumlah / Waktu</span>
        <span>:</span>
        <span class="paper-id-value is-solid">${escapeHtml(String(rows.length))} Soal · ${escapeHtml(String(duration))} Menit</span>
      </div>
    </div>

    ${syllabusListHtml}

    <div class="kisi-table-wrap">
      <table class="kisi-table">
        <thead>
          <tr>
            <th style="width:34px">No</th>
            <th style="width:145px">Cakupan Materi / Topik</th>
            <th>Indikator Soal</th>
            <th style="width:66px">Level</th>
            <th style="width:74px">Bentuk</th>
            <th style="width:52px">No. Soal</th>
            ${cfg.includeKeyCol ? '<th style="width:64px">Kunci</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>

    ${sigHtml}
  `;
}

function generateKisiKisiPdfBlob(rows, config, syllabusItems) {
  const pageCommandLists = [];
  let commands = [];
  let y = 795;
  const bottomLimit = 56;
  const duration = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;

  const logoBytes = config.logoDataUrl ? dataUrlToUint8Array(config.logoDataUrl) : null;
  const hasLogo = Boolean(logoBytes && config.logoWidth > 0 && config.logoHeight > 0);
  const imageSpecs = hasLogo
    ? [{ name: 'Im1', width: config.logoWidth, height: config.logoHeight, bytes: logoBytes }]
    : [];

  const pushTextCmd = (target, x, yPos, text, font = 'F1', size = 9, color = '0.06 0.09 0.16') => {
    target.push(`BT /${font} ${size} Tf ${color} rg ${x} ${yPos} Td (${sanitizePdfText(text)}) Tj ET`);
  };

  const drawText = (x, yPos, text, font = 'F1', size = 9, color = '0.06 0.09 0.16') => {
    pushTextCmd(commands, x, yPos, text, font, size, color);
  };

  const drawCenteredInBox = (yPos, text, font = 'F1', size = 10, color = '0.06 0.09 0.16', leftX = 40, rightX = 555) => {
    const clean = sanitizePdfText(text);
    const charFactor = font === 'F2' ? 0.54 : 0.50;
    const estWidth = clean.length * size * charFactor;
    const x = Math.max(leftX, Math.round(leftX + (rightX - leftX - estWidth) / 2));
    pushTextCmd(commands, x, yPos, text, font, size, color);
  };

  // Column definitions (total width = 515 pt, x from 40 to 555)
  const cols = config.includeKeyCol
    ? [
        { key: 'no', label: 'No', x: 40, w: 26, chars: 4, center: true },
        { key: 'materi', label: 'Cakupan Materi / Topik', x: 66, w: 108, chars: 22, center: false },
        { key: 'indikator', label: 'Indikator Soal', x: 174, w: 205, chars: 44, center: false },
        { key: 'level', label: 'Level', x: 379, w: 46, chars: 9, center: true },
        { key: 'bentuk', label: 'Bentuk', x: 425, w: 50, chars: 10, center: true },
        { key: 'noSoal', label: 'No.Soal', x: 475, w: 38, chars: 7, center: true },
        { key: 'kunci', label: 'Kunci', x: 513, w: 42, chars: 8, center: true },
      ]
    : [
        { key: 'no', label: 'No', x: 40, w: 28, chars: 4, center: true },
        { key: 'materi', label: 'Cakupan Materi / Topik', x: 68, w: 118, chars: 24, center: false },
        { key: 'indikator', label: 'Indikator Soal', x: 186, w: 230, chars: 50, center: false },
        { key: 'level', label: 'Level', x: 416, w: 48, chars: 9, center: true },
        { key: 'bentuk', label: 'Bentuk', x: 464, w: 51, chars: 11, center: true },
        { key: 'noSoal', label: 'No.Soal', x: 515, w: 40, chars: 7, center: true },
      ];

  const drawTableHeader = () => {
    const headerH = 22;
    const headerBottom = y - headerH;
    commands.push(`0.93 0.96 1.0 rg 40 ${headerBottom} 515 ${headerH} re f`);
    commands.push(`0.25 0.32 0.42 RG 0.8 w 40 ${headerBottom} 515 ${headerH} re S`);
    cols.forEach((c, cIdx) => {
      if (cIdx > 0) {
        commands.push(`0.25 0.32 0.42 RG 0.6 w ${c.x} ${headerBottom} m ${c.x} ${y} l S`);
      }
      drawCenteredInBox(y - 14, c.label, 'F2', 8.0, '0.06 0.09 0.16', c.x + 2, c.x + c.w - 2);
    });
    y = headerBottom;
  };

  const startNewPage = () => {
    if (commands.length > 0) pageCommandLists.push(commands);
    commands = [];
    commands.push('0.97 0.98 0.99 rg 40 792 515 24 re f');
    commands.push('0.80 0.85 0.92 RG 0.6 w 40 792 515 24 re S');
    drawText(48, 800, `${config.docTitle.slice(0, 56)}`, 'F2', 8.3, '0.11 0.25 0.65');
    drawText(420, 800, `Mapel: ${config.subject.slice(0, 20)}`, 'F1', 8.2, '0.28 0.34 0.43');
    y = 776;
    drawTableHeader();
  };

  // Page 1: KOP SEKOLAH (+ optional embedded JPEG Logo Sekolah)
  const kopLeftX = hasLogo ? 98 : 40;
  const kopTopY = y;
  if (hasLogo) {
    const boxSize = 48;
    const ratio = config.logoWidth / config.logoHeight;
    const drawW = ratio >= 1 ? boxSize : boxSize * ratio;
    const drawH = ratio >= 1 ? boxSize / ratio : boxSize;
    const imgX = Math.round(42 + (boxSize - drawW) / 2);
    const imgY = Math.round(kopTopY - boxSize + 6 + (boxSize - drawH) / 2);
    commands.push(`q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${imgX} ${imgY} cm /Im1 Do Q`);
  }

  if (config.institution) {
    drawCenteredInBox(y, config.institution.toUpperCase(), 'F2', 9.2, '0.18 0.23 0.32', kopLeftX, 555);
    y -= 14;
  }
  drawCenteredInBox(y, config.schoolName.toUpperCase(), 'F2', 12.5, '0.06 0.09 0.16', kopLeftX, 555);
  y -= 13;
  if (config.address) {
    drawCenteredInBox(y, config.address, 'F1', 8.3, '0.32 0.38 0.48', kopLeftX, 555);
    y -= 10;
  } else {
    y -= 4;
  }

  if (hasLogo) {
    y = Math.min(y, kopTopY - 48);
  }

  // Official Kop Sekolah double rule
  commands.push(`0.06 0.09 0.16 RG 2.0 w 40 ${y} m 555 ${y} l S`);
  commands.push(`0.06 0.09 0.16 RG 0.7 w 40 ${y - 3} m 555 ${y - 3} l S`);
  y -= 18;

  // Judul Kisi-Kisi Mapel
  const titleWrapped = wrapText(config.docTitle.toUpperCase(), 74);
  titleWrapped.slice(0, 2).forEach((line) => {
    drawCenteredInBox(y, line, 'F2', 10.8, '0.06 0.09 0.16', 40, 555);
    y -= 13;
  });
  y -= 4;

  // Identitas Kisi-Kisi Box
  const mainTopicWrapped = wrapText(config.mainTopic, 36);
  const idRow2Extra = Math.max(0, mainTopicWrapped.length - 1) * 10;
  const idBoxH = 62 + idRow2Extra;
  const idBottom = y - idBoxH;

  commands.push(`0.97 0.98 0.99 rg 40 ${idBottom} 515 ${idBoxH} re f`);
  commands.push(`0.35 0.42 0.52 RG 0.8 w 40 ${idBottom} 515 ${idBoxH} re S`);

  drawText(50, y - 15, `Mata Pelajaran : ${config.subject.slice(0, 32)}`, 'F2', 8.8);
  drawText(320, y - 15, `Tahun Pelajaran  : ${config.academicYear}`, 'F2', 8.8);

  drawText(50, y - 31, 'Materi Pokok   :', 'F2', 8.5);
  mainTopicWrapped.slice(0, 2).forEach((line, lIdx) => {
    drawText(124, y - 31 - lIdx * 10, line, 'F1', 8.5);
  });
  drawText(320, y - 31, `Kelas / Semester : ${config.classLevel || '-'}`, 'F1', 8.5);

  const teacherDisplay = config.teacherName || '........................................';
  drawText(50, idBottom + 10, `Guru Pengampu  : ${teacherDisplay.slice(0, 34)}`, config.teacherName ? 'F2' : 'F1', 8.6);
  drawText(320, idBottom + 10, `Jumlah / Waktu   : ${rows.length} Soal (${duration} Menit)`, 'F1', 8.6);

  y = idBottom - 12;

  // Ringkasan Cakupan Materi Acuan
  if (Array.isArray(syllabusItems) && syllabusItems.length > 0) {
    const joinedSyllabus = syllabusItems.map((s, i) => `${i + 1}) ${s}`).join('; ');
    const sylLines = wrapText(`Cakupan Materi: ${joinedSyllabus}`, 96).slice(0, 4);
    const sylBoxH = sylLines.length * 11 + 12;
    const sylBottom = y - sylBoxH;
    commands.push(`0.98 0.99 1 rg 40 ${sylBottom} 515 ${sylBoxH} re f`);
    commands.push(`0.82 0.86 0.92 RG 0.6 w 40 ${sylBottom} 515 ${sylBoxH} re S`);
    sylLines.forEach((line, idx) => {
      drawText(48, y - 13 - idx * 11, line, idx === 0 ? 'F2' : 'F1', 8.0, '0.20 0.26 0.35');
    });
    y = sylBottom - 14;
  }

  // Tabel Kisi-Kisi
  drawTableHeader();

  rows.forEach((row) => {
    const cellLinesMap = {};
    let maxLines = 1;
    cols.forEach((c) => {
      const val = String(row[c.key] ?? '');
      const wrapped = c.center ? [val.slice(0, c.chars)] : wrapText(val, c.chars);
      cellLinesMap[c.key] = wrapped;
      if (wrapped.length > maxLines) maxLines = wrapped.length;
    });

    const rowH = Math.max(20, maxLines * 10.5 + 8);
    if (y - rowH < bottomLimit) {
      startNewPage();
    }

    const rowBottom = y - rowH;
    commands.push(`0.40 0.47 0.56 RG 0.6 w 40 ${rowBottom} 515 ${rowH} re S`);

    cols.forEach((c, cIdx) => {
      if (cIdx > 0) {
        commands.push(`0.40 0.47 0.56 RG 0.5 w ${c.x} ${rowBottom} m ${c.x} ${y} l S`);
      }
      const lines = cellLinesMap[c.key] || [''];
      lines.forEach((line, lIdx) => {
        const textY = y - 12 - lIdx * 10.5;
        if (c.center) {
          drawCenteredInBox(textY, line, 'F1', 7.9, '0.08 0.12 0.20', c.x + 2, c.x + c.w - 2);
        } else {
          drawText(c.x + 5, textY, line, 'F1', 7.8, '0.08 0.12 0.20');
        }
      });
    });

    y = rowBottom;
  });

  // Signature block for Guru Pengampu
  if (config.includeSignature) {
    if (y - 95 < bottomLimit) {
      if (commands.length > 0) pageCommandLists.push(commands);
      commands = [];
      y = 770;
    }
    y -= 22;
    drawText(355, y, 'Mengetahui / Penyusun,', 'F1', 9.0, '0.15 0.20 0.28');
    y -= 13;
    drawText(355, y, `Guru Pengampu Mapel ${config.subject.slice(0, 24)}`, 'F1', 9.0, '0.15 0.20 0.28');
    y -= 42;
    drawText(355, y, config.teacherName || '........................................', 'F2', 9.2, '0.06 0.09 0.16');
  }

  if (commands.length > 0) pageCommandLists.push(commands);

  const totalPages = pageCommandLists.length;
  const pageStreams = pageCommandLists.map((cmds, pIdx) => {
    const pageCmds = [...cmds];
    pageCmds.push('0.88 0.91 0.94 RG 0.6 w 40 38 m 555 38 l S');
    pushTextCmd(
      pageCmds,
      40,
      24,
      `${config.schoolName.slice(0, 42)} - Kisi-Kisi Soal ${config.subject.slice(0, 22)}`,
      'F1',
      8,
      '0.45 0.51 0.60'
    );
    pushTextCmd(pageCmds, 488, 24, `Halaman ${pIdx + 1} dari ${totalPages}`, 'F1', 8, '0.45 0.51 0.60');
    return pageCmds.join('\n');
  });

  return buildPdfBlobFromPageStreams(pageStreams, imageSpecs);
}

function downloadKisiKisiPdf() {
  const cfg = saveKisiKisiFormToStorage();
  const syllabusItems = state.settings?.syllabusItems || DEFAULT_SETTINGS.syllabusItems;
  const questionsList = getKisiKisiQuestions(cfg.questionScope);
  if (questionsList.length === 0) {
    showToast('Tidak ada butir soal untuk disusun ke dalam PDF Kisi-Kisi.', 'error');
    return;
  }

  const rows = buildKisiKisiRows(questionsList, syllabusItems);
  const blob = generateKisiKisiPdfBlob(rows, cfg, syllabusItems);
  const dateTag = new Date().toISOString().slice(0, 10);
  const safeSubj = (cfg.subject || 'INFORMATIKA').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  triggerFileDownload(blob, `Kisi_Kisi_Soal_${safeSubj}_${dateTag}.pdf`);
  showToast(`PDF Kisi-Kisi Soal ${cfg.subject} (${rows.length} indikator) berhasil diunduh.`, 'success');
}

/* ==================== ADMIN PORTAL & CRUD ==================== */
async function openAdminPortal() {
  if (state.currentView === 'exam') {
    showToast('Selesaikan atau keluar dari sesi ujian aktif terlebih dahulu.', 'error');
    return;
  }

  if (state.adminUnlocked && state.adminToken) {
    switchView('admin');
    return;
  }

  state.adminUnlocked = false;
  state.adminToken = null;

  const titleEl = document.getElementById('modal-admin-title');
  const descEl = document.getElementById('admin-auth-desc');
  const labelEl = document.getElementById('admin-pin-label');
  const pinInput = document.getElementById('input-admin-pin');
  const confirmGroup = document.getElementById('admin-pin-confirm-group');
  const confirmInput = document.getElementById('input-admin-pin-confirm');
  const toggleBtn = document.getElementById('btn-toggle-admin-pin-visibility');
  const setupGenBtn = document.getElementById('btn-setup-generate-admin-pin');
  const setupCopyBtn = document.getElementById('btn-setup-copy-admin-pin');
  const hintEl = document.getElementById('admin-auth-hint');
  const submitBtn = document.getElementById('btn-admin-auth-submit');
  const errEl = document.getElementById('admin-auth-error');

  if (errEl) errEl.classList.add('hidden');
  if (pinInput) {
    pinInput.value = '';
    pinInput.type = 'password';
  }
  if (confirmInput) {
    confirmInput.value = '';
    confirmInput.type = 'password';
  }
  if (toggleBtn) toggleBtn.textContent = 'Lihat';
  if (setupCopyBtn) setupCopyBtn.classList.add('hidden');

  let usingDefaultPin = false;
  try {
    const res = await fetch('/api/cbt/admin/status', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      usingDefaultPin = Boolean(data?.usingDefaultPin);
    }
  } catch {
    usingDefaultPin = false;
  }
  state.adminPinConfigured = true;

  if (setupGenBtn) setupGenBtn.classList.add('hidden');
  if (confirmGroup) confirmGroup.classList.add('hidden');
  if (confirmInput) confirmInput.required = false;
  if (hintEl) hintEl.classList.remove('hidden');

  if (usingDefaultPin) {
    if (titleEl) titleEl.textContent = 'Masuk Portal Admin (Awal)';
    if (descEl) {
      descEl.textContent =
        'Masuk pertama kali menggunakan Default Password (admin123). Setelah masuk, Anda akan diminta membuat PIN Admin baru.';
    }
    if (labelEl) labelEl.textContent = 'Default Password / PIN Admin';
    if (pinInput) {
      pinInput.placeholder = 'Masukkan Default Password (admin123)';
      pinInput.setAttribute('autocomplete', 'current-password');
    }
    if (hintEl) {
      hintEl.innerHTML =
        'Masuk pertama kali dengan password default <strong>admin123</strong>, lalu buat PIN Admin pribadi minimal 6 karakter.';
    }
    if (submitBtn) submitBtn.textContent = 'Masuk & Buat PIN';
  } else {
    if (titleEl) titleEl.textContent = 'Akses Portal Admin';
    if (descEl) {
      descEl.textContent =
        'Masukkan kode PIN Admin untuk mengelola bank soal, kunci jawaban, monitoring siswa, dan rekap hasil penilaian.';
    }
    if (labelEl) labelEl.textContent = 'PIN Admin';
    if (pinInput) {
      pinInput.placeholder = 'Masukkan PIN Admin';
      pinInput.setAttribute('autocomplete', 'current-password');
    }
    if (hintEl) {
      hintEl.innerHTML =
        'PIN Admin dapat di-generate dan diubah kapan saja dari dalam Portal Admin melalui tombol <strong>Generate / Ubah PIN</strong>.';
    }
    if (submitBtn) submitBtn.textContent = 'Buka Admin';
  }

  openModal('modal-admin-auth');
  setTimeout(() => pinInput?.focus(), 80);
}

async function handleAdminLoginSubmit(e) {
  e.preventDefault();
  const pinInput = document.getElementById('input-admin-pin');
  const errEl = document.getElementById('admin-auth-error');
  const submitBtn = document.getElementById('btn-admin-auth-submit');

  const pin = (pinInput?.value || '').trim();
  if (!pin) {
    errEl.textContent = 'PIN Admin wajib diisi.';
    errEl.classList.remove('hidden');
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  errEl.classList.add('hidden');

  try {
    const response = await fetch('/api/cbt/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'CBT-Online-Admin',
      },
      body: JSON.stringify({ pin }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.token) {
      errEl.textContent = data?.error || 'PIN Admin salah. Silakan periksa kembali dan coba lagi.';
      errEl.classList.remove('hidden');
      return;
    }

    state.adminToken = data.token;
    state.adminUnlocked = true;
    state.adminPinConfigured = true;
    closeModal('modal-admin-auth');
    switchView('admin');

    if (data.mustCreatePin) {
      showToast('Berhasil masuk dengan password default. Silakan buat PIN Admin baru Anda.', 'success');
      openAdminPinManageModal(true);
    } else {
      showToast('Berhasil masuk ke Portal Admin.', 'success');
    }
  } catch {
    errEl.textContent = 'Tidak dapat terhubung ke server untuk memverifikasi PIN Admin.';
    errEl.classList.remove('hidden');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function exitAdmin() {
  state.adminUnlocked = false;
  state.adminToken = null;
  if (isAdminRouteUrl()) {
    switchView('admin-gate');
  } else if (state.student) {
    switchView('dashboard');
  } else {
    switchView('login');
  }
}

async function openAdminPinManageModal(isFirstSetup = false) {
  if (!state.adminUnlocked || !state.adminToken) {
    handleAdminUnauthorized();
    return;
  }

  const firstSetup = isFirstSetup === true;
  const titleEl = document.getElementById('modal-admin-pin-manage-title');
  const descEl = document.getElementById('admin-pin-manage-desc');
  const newPinInput = document.getElementById('input-new-admin-pin');
  const confirmPinInput = document.getElementById('input-new-admin-pin-confirm');
  const errEl = document.getElementById('admin-pin-manage-error');
  const savedBox = document.getElementById('admin-pin-saved-box');
  const savedCode = document.getElementById('admin-pin-saved-code');
  const savedExitBtn = document.getElementById('btn-pin-saved-exit-admin');
  const saveBtn = document.getElementById('btn-save-admin-pin');
  const instantBtn = document.getElementById('btn-instant-generate-admin-pin');
  const genBtn = document.getElementById('btn-generate-new-admin-pin');

  if (titleEl) {
    titleEl.textContent = firstSetup ? 'Buat PIN Admin Pertama Kali' : 'Generate & Ubah PIN Admin';
  }
  if (descEl) {
    descEl.innerHTML = firstSetup
      ? 'Anda masuk menggunakan Default Password awal. Silakan buat PIN Admin baru (minimal 6 karakter) atau klik <strong>Generate PIN</strong> untuk menggantikan password default.'
      : 'Generate kode PIN baru atau atur PIN manual (minimal 6 karakter). Setelah disimpan, gunakan PIN baru tersebut saat masuk kembali setelah <strong>Keluar Admin</strong>.';
  }

  if (newPinInput) newPinInput.value = '';
  if (confirmPinInput) confirmPinInput.value = '';
  if (errEl) errEl.classList.add('hidden');
  if (savedBox) savedBox.classList.add('hidden');
  if (savedCode) savedCode.textContent = '--------';
  if (savedExitBtn) savedExitBtn.classList.add('hidden');
  if (saveBtn) saveBtn.disabled = false;
  if (instantBtn) instantBtn.disabled = false;
  if (genBtn) genBtn.disabled = false;

  openModal('modal-admin-pin-manage');
}

async function submitAdminPinChange(payload) {
  if (!state.adminUnlocked || !state.adminToken) {
    handleAdminUnauthorized();
    return;
  }

  const errEl = document.getElementById('admin-pin-manage-error');
  const saveBtn = document.getElementById('btn-save-admin-pin');
  const instantBtn = document.getElementById('btn-instant-generate-admin-pin');
  const savedBox = document.getElementById('admin-pin-saved-box');
  const savedCode = document.getElementById('admin-pin-saved-code');
  const savedExitBtn = document.getElementById('btn-pin-saved-exit-admin');
  const newPinInput = document.getElementById('input-new-admin-pin');
  const confirmPinInput = document.getElementById('input-new-admin-pin-confirm');

  if (errEl) errEl.classList.add('hidden');
  if (saveBtn) saveBtn.disabled = true;
  if (instantBtn) instantBtn.disabled = true;

  try {
    const response = await fetch('/api/cbt/admin/change-pin', {
      method: 'POST',
      headers: {
        ...getAdminRequestHeaders(),
        'Content-Type': 'application/json',
        'X-Requested-With': 'CBT-Online-Admin',
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 401 || response.status === 403) {
      closeModal('modal-admin-pin-manage');
      handleAdminUnauthorized();
      return;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      if (errEl) {
        errEl.textContent = data?.error || 'Gagal memperbarui PIN Admin. Silakan coba lagi.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (data.token) {
      state.adminToken = data.token;
    }
    state.adminPinConfigured = true;

    const activePin = payload.mode === 'generate' ? data.generatedPin || '' : payload.pin || '';
    if (newPinInput && activePin) newPinInput.value = activePin;
    if (confirmPinInput && activePin) confirmPinInput.value = activePin;
    if (savedCode && activePin) savedCode.textContent = activePin;
    if (savedBox) savedBox.classList.remove('hidden');
    if (savedExitBtn) savedExitBtn.classList.remove('hidden');

    showToast('PIN Admin baru berhasil disimpan! Salin PIN untuk login kembali setelah keluar.', 'success');
  } catch {
    if (errEl) {
      errEl.textContent = 'Tidak dapat terhubung ke server untuk menyimpan PIN Admin baru.';
      errEl.classList.remove('hidden');
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    if (instantBtn) instantBtn.disabled = false;
  }
}

function renderAdminView() {
  const adminUrlEl = document.getElementById('admin-dedicated-url-text');
  if (adminUrlEl) {
    adminUrlEl.textContent = getDedicatedAdminUrl();
  }
  renderAdminResultsTable();
  renderAdminMonitoringTable();
  syncTopicSelectElements();
  renderAiGeneratorPanel();
  renderAdminQuestionList();
  renderAdminSyllabusPanel();
  renderAdminTokenPanel();
  syncAdminStateFromServer();
}

/* ==================== TOKEN UJIAN & MODE PER KELAS ==================== */
const DEFAULT_CLASS_LIST = [
  ...['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((l) => `X-${l}`),
  ...['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((l) => `XI-${l}`),
  ...['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((l) => `XII-${l}`),
];

const LEGACY_CLASS_LIST_AK = [
  ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((l) => `X-${l}`),
  ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((l) => `XI-${l}`),
  ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((l) => `XII-${l}`),
];

function normalizeClassKey(val) {
  return String(val || '')
    .trim()
    .toUpperCase()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');
}

function getClassGrade(classKey) {
  const norm = normalizeClassKey(classKey);
  if (norm === 'XII' || norm.startsWith('XII-') || norm.startsWith('XII ')) return 'XII';
  if (norm === 'XI' || norm.startsWith('XI-') || norm.startsWith('XI ')) return 'XI';
  if (norm === 'X' || norm.startsWith('X-') || norm.startsWith('X ')) return 'X';
  return 'OTHER';
}

function getActiveClassList() {
  const list = state.tokenConfig?.classList;
  return Array.isArray(list) && list.length > 0 ? list : [...DEFAULT_CLASS_LIST];
}

function buildGroupedClassOptionsHtml(classList, placeholderText = '-- Pilih Kelas (X / XI / XII) --') {
  const groups = { X: [], XI: [], XII: [], OTHER: [] };
  classList.forEach((cls) => {
    const key = normalizeClassKey(cls);
    if (!key) return;
    groups[getClassGrade(key)].push(key);
  });

  const renderGroup = (label, items) => {
    if (items.length === 0) return '';
    const opts = items
      .map((cls) => {
        const display = cls === 'X' || cls === 'XI' || cls === 'XII' ? `Kelas ${cls}` : cls;
        return `<option value="${escapeHtml(cls)}">${escapeHtml(display)}</option>`;
      })
      .join('');
    return `<optgroup label="${escapeHtml(label)}">${opts}</optgroup>`;
  };

  return (
    `<option value="">${escapeHtml(placeholderText)}</option>` +
    renderGroup('Kelas X', groups.X) +
    renderGroup('Kelas XI', groups.XI) +
    renderGroup('Kelas XII', groups.XII) +
    renderGroup('Kelas Lainnya', groups.OTHER)
  );
}

function renderClassDropdowns() {
  const classList = getActiveClassList();
  const loginSelect = document.getElementById('input-nisn');
  if (loginSelect && loginSelect.tagName === 'SELECT') {
    const prevVal = loginSelect.value;
    loginSelect.innerHTML = buildGroupedClassOptionsHtml(classList, '-- Pilih Kelas (X / XI / XII) --');
    if (prevVal && classList.includes(prevVal)) {
      loginSelect.value = prevVal;
    }
  }

  const adminSelect = document.getElementById('admin-class-token-class');
  if (adminSelect && adminSelect.tagName === 'SELECT') {
    const prevAdminVal = adminSelect.value;
    adminSelect.innerHTML = buildGroupedClassOptionsHtml(classList, '-- Pilih Kelas (X / XI / XII) --');
    if (prevAdminVal && classList.includes(prevAdminVal)) {
      adminSelect.value = prevAdminVal;
    }
  }

  renderAdminResultsClassFilterDropdown();
}

function renderAdminResultsClassFilterDropdown() {
  const select = document.getElementById('admin-result-filter-class');
  if (!select || select.tagName !== 'SELECT') return;

  const results = state.results || [];
  const countsByClass = new Map();
  const countsByGrade = { X: 0, XI: 0, XII: 0, OTHER: 0 };

  results.forEach((r) => {
    const cls = normalizeClassKey(r.nisn);
    if (!cls) return;
    countsByClass.set(cls, (countsByClass.get(cls) || 0) + 1);
    const grade = getClassGrade(cls);
    countsByGrade[grade] = (countsByGrade[grade] || 0) + 1;
  });

  const activeList = getActiveClassList().map((c) => normalizeClassKey(c)).filter(Boolean);
  const allClassSet = new Set(activeList);
  countsByClass.forEach((_, cls) => allClassSet.add(cls));

  const groups = { X: [], XI: [], XII: [], OTHER: [] };
  allClassSet.forEach((cls) => {
    groups[getClassGrade(cls)].push(cls);
  });

  const activeIndex = new Map(activeList.map((c, idx) => [c, idx]));
  const sortGroup = (items) =>
    items.sort((a, b) => {
      const ia = activeIndex.has(a) ? activeIndex.get(a) : Number.MAX_SAFE_INTEGER;
      const ib = activeIndex.has(b) ? activeIndex.get(b) : Number.MAX_SAFE_INTEGER;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b, 'id');
    });

  sortGroup(groups.X);
  sortGroup(groups.XI);
  sortGroup(groups.XII);
  sortGroup(groups.OTHER);

  const renderGroup = (label, items) => {
    if (items.length === 0) return '';
    const opts = items
      .map((cls) => {
        const count = countsByClass.get(cls) || 0;
        const baseDisplay = cls === 'X' || cls === 'XI' || cls === 'XII' ? `Kelas ${cls}` : cls;
        const labelWithCount = count > 0 ? `${baseDisplay} (${count} Siswa)` : baseDisplay;
        return `<option value="${escapeHtml(cls)}">${escapeHtml(labelWithCount)}</option>`;
      })
      .join('');
    return `<optgroup label="${escapeHtml(label)}">${opts}</optgroup>`;
  };

  const gradeOptions = [
    `<option value="GRADE:X">Semua Kelas X (${countsByGrade.X} Siswa)</option>`,
    `<option value="GRADE:XI">Semua Kelas XI (${countsByGrade.XI} Siswa)</option>`,
    `<option value="GRADE:XII">Semua Kelas XII (${countsByGrade.XII} Siswa)</option>`,
  ].join('');

  select.innerHTML =
    `<option value="ALL">Semua Kelas (${results.length} Siswa)</option>` +
    `<optgroup label="Filter Per Tingkat">${gradeOptions}</optgroup>` +
    renderGroup('Kelas X', groups.X) +
    renderGroup('Kelas XI', groups.XI) +
    renderGroup('Kelas XII', groups.XII) +
    renderGroup('Kelas Lainnya', groups.OTHER);

  const desired = state.adminResultClassFilter || 'ALL';
  const hasOption = Array.from(select.options).some((opt) => opt.value === desired);
  if (hasOption) {
    select.value = desired;
  } else {
    state.adminResultClassFilter = 'ALL';
    select.value = 'ALL';
  }
}

function generateRandomTokenCode(length = 6) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateUniqueRandomTokenCode(length = 6) {
  const used = new Set([
    state.tokenConfig?.code || '',
    ...Object.values(state.tokenConfig?.classTokens || {}).map((c) => c.code),
    ...(state.tokenConfig?.usedClassTokenHistory || []).map((h) => h.code),
  ]);
  for (let i = 0; i < 60; i++) {
    const candidate = generateRandomTokenCode(length);
    if (!used.has(candidate)) return candidate;
  }
  return generateRandomTokenCode(length);
}

function loadTokenConfig() {
  const saved = readStorage(STORAGE_KEYS.TOKEN, null);
  if (saved && typeof saved.code === 'string' && saved.code.trim().length >= 4) {
    let normalizedList =
      Array.isArray(saved.classList) && saved.classList.length > 0
        ? saved.classList.map((c) => normalizeClassKey(c)).filter(Boolean)
        : [...DEFAULT_CLASS_LIST];
    const nextClassTokens =
      saved.classTokens && typeof saved.classTokens === 'object' ? { ...saved.classTokens } : {};
    const nextClassTokensPublic =
      saved.classTokensPublic && typeof saved.classTokensPublic === 'object' ? { ...saved.classTokensPublic } : {};

    const isLegacyAK =
      normalizedList.length === LEGACY_CLASS_LIST_AK.length &&
      normalizedList.every((c, idx) => c === LEGACY_CLASS_LIST_AK[idx]);
    if (isLegacyAK) {
      normalizedList = [...DEFAULT_CLASS_LIST];
      delete nextClassTokens['X-A'];
      delete nextClassTokens['XI-A'];
      delete nextClassTokens['XII-A'];
      delete nextClassTokensPublic['X-A'];
      delete nextClassTokensPublic['XI-A'];
      delete nextClassTokensPublic['XII-A'];
    }

    state.tokenConfig = {
      tokenMode: saved.tokenMode === 'global' ? 'global' : 'per_class',
      classList: normalizedList,
      code: saved.code.trim().toUpperCase(),
      required: saved.required !== false,
      showOnLogin: saved.showOnLogin !== false,
      isActive: saved.isActive !== false,
      autoStopOnAllFinished: Boolean(saved.autoStopOnAllFinished),
      targetParticipants: Math.max(0, Number(saved.targetParticipants) || 0),
      requireNewTokenPerClass: saved.requireNewTokenPerClass !== false,
      boundClass: saved.boundClass ? normalizeClassKey(saved.boundClass) : null,
      classTokens: nextClassTokens,
      classTokensPublic: nextClassTokensPublic,
      usedClassTokenHistory: Array.isArray(saved.usedClassTokenHistory) ? saved.usedClassTokenHistory : [],
      stoppedAt: saved.stoppedAt || null,
      stoppedReason: saved.stoppedReason || '',
      updatedAt: saved.updatedAt || new Date().toISOString(),
    };
    if (isLegacyAK) {
      writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
    }
  } else {
    state.tokenConfig = {
      tokenMode: 'per_class',
      classList: [...DEFAULT_CLASS_LIST],
      code: generateRandomTokenCode(6),
      required: true,
      showOnLogin: true,
      isActive: true,
      autoStopOnAllFinished: false,
      targetParticipants: 0,
      requireNewTokenPerClass: true,
      boundClass: null,
      classTokens: {},
      classTokensPublic: {},
      usedClassTokenHistory: [],
      stoppedAt: null,
      stoppedReason: '',
      updatedAt: new Date().toISOString(),
    };
    writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
  }
}

function getTokenCompletionStats() {
  const allItems = getMergedMonitoringRecords();
  const totalRegistered = allItems.length;
  const activeCount = allItems.filter((i) => i.status === 'Sedang Mengerjakan').length;
  const pendingCount = allItems.filter((i) => i.status === 'Belum Mulai').length;
  const doneCount = allItems.filter((i) => i.status === 'Selesai').length;
  return { totalRegistered, activeCount, pendingCount, doneCount };
}

function evaluateTokenAutoStop() {
  loadTokenConfig();
  if (!state.tokenConfig.autoStopOnAllFinished || state.tokenConfig.isActive === false) {
    return false;
  }

  const { activeCount, doneCount } = getTokenCompletionStats();
  const target = Math.max(0, Number(state.tokenConfig.targetParticipants) || 0);

  const shouldStop = target > 0 && doneCount >= target && activeCount === 0;

  if (shouldStop) {
    state.tokenConfig = {
      ...state.tokenConfig,
      isActive: false,
      stoppedAt: new Date().toISOString(),
      stoppedReason: 'Target jumlah siswa selesai telah tercapai',
    };
    writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
    renderLoginTokenField();
    if (state.currentView === 'admin') {
      renderAdminTokenPanel();
    }
    return true;
  }

  return false;
}

function renderLoginTokenField() {
  if (!state.tokenConfig) loadTokenConfig();
  const groupEl = document.getElementById('login-token-group');
  const hintEl = document.getElementById('login-token-hint');
  const inputEl = document.getElementById('input-token');
  const stoppedNoteEl = document.getElementById('login-token-stopped-note');
  if (!groupEl || !hintEl || !inputEl) return;

  const { code, required, showOnLogin, isActive, requireNewTokenPerClass, boundClass, tokenMode } = state.tokenConfig;
  const isPerClassMode = tokenMode !== 'global';
  const shouldShowGroup = required || showOnLogin || isActive === false;
  groupEl.classList.toggle('hidden', !shouldShowGroup);
  inputEl.required = Boolean(required);

  const typedClassKey = normalizeClassKey(document.getElementById('input-nisn')?.value || '');
  if (inputEl.dataset.selectedClass !== typedClassKey) {
    if (inputEl.dataset.selectedClass !== undefined) {
      inputEl.value = '';
    }
    inputEl.dataset.selectedClass = typedClassKey;
  }

  const hasPublicMap =
    state.tokenConfig.classTokensPublic && Object.keys(state.tokenConfig.classTokensPublic).length > 0;
  const hasAdminMap = state.tokenConfig.classTokens && Object.keys(state.tokenConfig.classTokens).length > 0;
  const classMap =
    (state.adminUnlocked && hasAdminMap
      ? state.tokenConfig.classTokens
      : hasPublicMap
        ? state.tokenConfig.classTokensPublic
        : state.tokenConfig.classTokens) || {};
  const classEntry = typedClassKey ? classMap[typedClassKey] : null;

  if (!typedClassKey) {
    hintEl.classList.remove('is-stopped');
    hintEl.classList.add('hidden');
    inputEl.disabled = true;
    inputEl.value = '';
    inputEl.placeholder = 'Pilih kelas di atas terlebih dahulu';
    if (stoppedNoteEl) {
      stoppedNoteEl.textContent =
        'Pilih kelas Anda (X, XI, atau XII) pada menu dropdown di atas untuk memunculkan Token Kelas yang sudah diatur di Portal Admin.';
      stoppedNoteEl.classList.remove('hidden');
    }
    return;
  }

  if (isPerClassMode || classEntry) {
    if (!classEntry || classEntry.isActive === false) {
      hintEl.textContent = `Token Kelas ${typedClassKey} Nonaktif`;
      hintEl.classList.remove('hidden');
      hintEl.classList.add('is-stopped');
      inputEl.disabled = Boolean(required);
      inputEl.value = '';
      inputEl.placeholder = `Sesi kelas ${typedClassKey} belum aktif`;
      if (stoppedNoteEl) {
        stoppedNoteEl.textContent = `Token Ujian khusus kelas ${typedClassKey} belum diaktifkan atau sedang dinonaktifkan di Portal Admin.`;
        stoppedNoteEl.classList.remove('hidden');
      }
      return;
    }

    hintEl.classList.remove('is-stopped');
    inputEl.disabled = false;
    inputEl.placeholder = `Masukkan Token Kelas ${typedClassKey}`;
    if (stoppedNoteEl) stoppedNoteEl.classList.add('hidden');
    if (showOnLogin && classEntry.code) {
      hintEl.textContent = `Token Aktif (${typedClassKey}): ${classEntry.code}`;
      hintEl.classList.remove('hidden');
    } else if (required) {
      hintEl.textContent = `Minta token kelas ${typedClassKey} ke pengawas`;
      hintEl.classList.remove('hidden');
    } else {
      hintEl.classList.add('hidden');
    }
    return;
  }

  if (isActive === false && required) {
    hintEl.textContent = 'Token Dihentikan (Selesai)';
    hintEl.classList.remove('hidden');
    hintEl.classList.add('is-stopped');
    inputEl.disabled = true;
    inputEl.value = '';
    inputEl.placeholder = 'Token dihentikan otomatis';
    if (stoppedNoteEl) {
      stoppedNoteEl.textContent =
        'Token otomatis berhenti karena target jumlah siswa selesai tercapai.';
      stoppedNoteEl.classList.remove('hidden');
    }
    return;
  }

  inputEl.disabled = false;
  inputEl.placeholder = `Masukkan Token Kelas ${typedClassKey}`;

  if (requireNewTokenPerClass !== false && boundClass) {
    if (typedClassKey !== boundClass) {
      hintEl.textContent = showOnLogin
        ? `Token ${code} Terkunci untuk ${boundClass}`
        : `Kelas ${typedClassKey} Wajib Token Baru`;
      hintEl.classList.remove('hidden');
      hintEl.classList.add('is-stopped');
      if (stoppedNoteEl) {
        stoppedNoteEl.textContent = `Token ${code || 'saat ini'} sudah terpakai untuk kelas ${boundClass}. Untuk siswa kelas lainnya (${typedClassKey}), Token Ujian wajib diubah ke kode baru di Portal Admin.`;
        stoppedNoteEl.classList.remove('hidden');
      }
      return;
    }
    hintEl.classList.remove('is-stopped');
    if (stoppedNoteEl) stoppedNoteEl.classList.add('hidden');
    if (showOnLogin) {
      hintEl.textContent = `Token Aktif (${boundClass}): ${code}`;
      hintEl.classList.remove('hidden');
    } else if (required) {
      hintEl.textContent = 'Minta token ke pengawas';
      hintEl.classList.remove('hidden');
    } else {
      hintEl.classList.add('hidden');
    }
    return;
  }

  hintEl.classList.remove('is-stopped');
  if (stoppedNoteEl) stoppedNoteEl.classList.add('hidden');

  if (showOnLogin) {
    hintEl.textContent = `Token Aktif (${typedClassKey}): ${code}`;
    hintEl.classList.remove('hidden');
  } else if (required) {
    hintEl.textContent = 'Minta token ke pengawas';
    hintEl.classList.remove('hidden');
  } else {
    hintEl.classList.add('hidden');
  }
}

function renderAdminClassTokensTable() {
  const tbody = document.getElementById('admin-class-token-tbody');
  if (!tbody) return;
  const classMap = state.tokenConfig?.classTokens || {};
  const classList = getActiveClassList();
  const isPerClassMode = state.tokenConfig?.tokenMode === 'per_class';
  const gradeFilter = state.adminClassGradeFilter || 'ALL';

  const rowClassKeys = isPerClassMode
    ? Array.from(new Set([...classList, ...Object.keys(classMap)]))
    : Object.keys(classMap);

  const filteredKeys = rowClassKeys.filter((key) => {
    if (gradeFilter === 'ALL') return true;
    return getClassGrade(key) === gradeFilter;
  });

  if (filteredKeys.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          ${
            isPerClassMode
              ? 'Belum ada kelas pada filter tingkat ini.'
              : 'Belum ada Token Khusus Per Kelas. Aktifkan <strong>Mode Menu Per Kelas (X, XI &amp; XII)</strong> di atas atau pilih kelas di bawah untuk membuat token khusus per kelas.'
          }
        </td>
      </tr>
    `;
    return;
  }

  const monList = getMergedMonitoringRecords();
  tbody.innerHTML = filteredKeys
    .map((classKey) => {
      const entry = classMap[classKey] || null;
      const grade = getClassGrade(classKey);
      const gradeLabel = grade === 'OTHER' ? 'Lainnya' : `Kelas ${grade}`;
      const code = entry?.code || '';
      const isActive = entry ? entry.isActive !== false : false;
      const count = monList.filter((m) => normalizeClassKey(m.nisn) === classKey).length;
      const inDropdown = classList.includes(classKey);

      return `
        <tr>
          <td>
            <div class="class-cell-main">
              <strong>${escapeHtml(classKey)}</strong>
              <span class="class-grade-tag">${escapeHtml(gradeLabel)}</span>
            </div>
          </td>
          <td>
            <div class="class-token-inline-edit">
              <input
                type="text"
                class="form-input input-compact mono-input token-input class-token-row-input"
                data-class-token-input="${escapeHtml(classKey)}"
                value="${escapeHtml(code)}"
                placeholder="Belum ada"
                maxlength="12"
                aria-label="Kode token untuk kelas ${escapeHtml(classKey)}"
              />
              <button type="button" class="btn btn-outline btn-sm" data-class-token-save="${escapeHtml(classKey)}">
                Simpan
              </button>
            </div>
          </td>
          <td>
            <span class="${isActive ? 'status-text-pass' : 'status-text-fail'}">
              ${entry ? (isActive ? 'Aktif' : 'Nonaktif') : 'Belum Aktif'}
            </span>
          </td>
          <td class="mono-text">${count} Siswa</td>
          <td>
            <div class="class-token-actions">
              ${
                code
                  ? `<button type="button" class="btn btn-outline btn-sm" data-class-token-copy="${escapeHtml(code)}">Salin</button>`
                  : ''
              }
              <button type="button" class="btn btn-outline btn-sm" data-class-token-rotate="${escapeHtml(classKey)}">
                Acak
              </button>
              <button type="button" class="btn btn-outline btn-sm" data-class-token-toggle="${escapeHtml(classKey)}" data-next-active="${isActive ? '0' : '1'}">
                ${isActive ? 'Nonaktifkan' : 'Aktifkan'}
              </button>
              ${
                inDropdown && classList.length > 1
                  ? `<button type="button" class="btn btn-outline btn-sm btn-danger-outline" data-class-remove-list="${escapeHtml(classKey)}" title="Hapus kelas ini dari daftar dropdown">Hapus</button>`
                  : `<button type="button" class="btn btn-outline btn-sm btn-danger-outline" data-class-token-delete="${escapeHtml(classKey)}">Hapus</button>`
              }
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.class-token-row-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
  });

  tbody.querySelectorAll('[data-class-token-save]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const classKey = btn.dataset.classTokenSave;
      const inputEl = tbody.querySelector(`[data-class-token-input="${CSS.escape(classKey)}"]`);
      const customCode = (inputEl?.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (customCode && (customCode.length < 4 || customCode.length > 12)) {
        showToast('Kode token kelas harus 4 sampai 12 huruf/angka.', 'error');
        return;
      }
      sendClassTokenAction(
        { action: 'upsert', className: classKey, customCode },
        customCode ? `Token kelas ${classKey} disimpan: ${customCode}` : `Token baru dibuat untuk kelas ${classKey}.`
      );
    });
  });

  tbody.querySelectorAll('[data-class-token-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.dataset.classTokenCopy;
      try {
        await navigator.clipboard.writeText(code);
        showToast(`Token kelas ${code} berhasil disalin.`, 'success');
      } catch {
        showToast(`Token kelas: ${code}`, 'success');
      }
    });
  });

  tbody.querySelectorAll('[data-class-token-rotate]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const classKey = btn.dataset.classTokenRotate;
      sendClassTokenAction({ action: 'rotate', className: classKey }, `Token baru untuk kelas ${classKey} berhasil dibuat.`);
    });
  });

  tbody.querySelectorAll('[data-class-token-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const classKey = btn.dataset.classTokenToggle;
      const isActive = btn.dataset.nextActive === '1';
      sendClassTokenAction(
        { action: 'toggle', className: classKey, isActive },
        `Token kelas ${classKey} berhasil ${isActive ? 'diaktifkan' : 'dinonaktifkan'}.`
      );
    });
  });

  tbody.querySelectorAll('[data-class-token-delete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const classKey = btn.dataset.classTokenDelete;
      sendClassTokenAction({ action: 'delete', className: classKey }, `Token khusus kelas ${classKey} dihapus.`);
    });
  });

  tbody.querySelectorAll('[data-class-remove-list]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const classKey = btn.dataset.classRemoveList;
      sendClassTokenAction(
        { action: 'remove_class', className: classKey },
        `Kelas ${classKey} dihapus dari daftar dropdown.`
      );
    });
  });
}

function renderAdminTokenPanel() {
  if (!state.tokenConfig) loadTokenConfig();
  renderClassDropdowns();

  const isPerClassMode = state.tokenConfig.tokenMode === 'per_class';
  const btnGlobalMode = document.getElementById('btn-token-mode-global');
  const btnPerClassMode = document.getElementById('btn-token-mode-perclass');
  const badgeGlobal = document.getElementById('badge-mode-global');
  const badgePerClass = document.getElementById('badge-mode-perclass');
  const globalSection = document.getElementById('admin-token-global-section');
  const globalToolbarBtns = document.getElementById('admin-global-token-toolbar-btns');
  const perClassBanner = document.getElementById('admin-token-perclass-banner');
  const perClassSummaryEl = document.getElementById('admin-perclass-summary-text');
  const wrapPerClassCheck = document.getElementById('wrap-admin-token-per-class');
  const wrapAutoStopCheck = document.getElementById('wrap-admin-token-auto-stop');

  if (btnGlobalMode) btnGlobalMode.classList.toggle('active', !isPerClassMode);
  if (btnPerClassMode) btnPerClassMode.classList.toggle('active', isPerClassMode);
  if (badgeGlobal) badgeGlobal.classList.toggle('hidden', isPerClassMode);
  if (badgePerClass) badgePerClass.classList.toggle('hidden', !isPerClassMode);
  if (globalSection) globalSection.classList.toggle('hidden', isPerClassMode);
  if (globalToolbarBtns) globalToolbarBtns.classList.toggle('hidden', isPerClassMode);
  if (perClassBanner) perClassBanner.classList.toggle('hidden', !isPerClassMode);
  if (wrapPerClassCheck) wrapPerClassCheck.classList.toggle('hidden', isPerClassMode);
  if (wrapAutoStopCheck) wrapAutoStopCheck.classList.toggle('hidden', isPerClassMode);

  if (perClassSummaryEl && isPerClassMode) {
    const classList = getActiveClassList();
    const classMap = state.tokenConfig.classTokens || {};
    let activeCls = 0;
    let inactiveCls = 0;
    classList.forEach((cls) => {
      const entry = classMap[cls];
      if (entry && entry.isActive !== false) activeCls += 1;
      else inactiveCls += 1;
    });
    perClassSummaryEl.textContent = `${activeCls} Kelas Aktif · ${inactiveCls} Kelas Nonaktif (Total ${classList.length} Kelas)`;
    perClassSummaryEl.className = activeCls > 0 ? 'status-text-pass' : 'status-text-fail';
  }

  const showcaseEl = document.getElementById('admin-token-showcase');
  const displayEl = document.getElementById('admin-token-display');
  const updatedEl = document.getElementById('admin-token-updated-at');
  const statusEl = document.getElementById('admin-token-status-text');
  const bindingEl = document.getElementById('admin-token-class-binding-text');
  const progressEl = document.getElementById('admin-token-progress-text');
  const reactivateBtn = document.getElementById('btn-reactivate-token');
  const reqCheck = document.getElementById('admin-token-required');
  const showCheck = document.getElementById('admin-token-show-on-login');
  const perClassCheck = document.getElementById('admin-token-per-class');
  const autoStopCheck = document.getElementById('admin-token-auto-stop');
  const targetInput = document.getElementById('admin-token-target-count');
  const customInput = document.getElementById('admin-custom-token-input');

  if (!displayEl) return;

  const isStopped = state.tokenConfig.isActive === false;
  const { activeCount, doneCount } = getTokenCompletionStats();
  const target = Math.max(0, Number(state.tokenConfig.targetParticipants) || 0);
  const perClassEnabled = state.tokenConfig.requireNewTokenPerClass !== false;
  const boundClass = state.tokenConfig.boundClass || null;

  if (showcaseEl) showcaseEl.classList.toggle('is-stopped', isStopped);
  if (reactivateBtn) reactivateBtn.classList.toggle('hidden', !isStopped);

  displayEl.textContent = state.tokenConfig.code;
  updatedEl.textContent = isStopped && state.tokenConfig.stoppedAt
    ? `Dihentikan otomatis: ${formatDateTimeID(state.tokenConfig.stoppedAt)}`
    : `Diperbarui: ${formatDateTimeID(state.tokenConfig.updatedAt)}`;

  reqCheck.checked = Boolean(state.tokenConfig.required);
  showCheck.checked = Boolean(state.tokenConfig.showOnLogin);
  if (perClassCheck) perClassCheck.checked = perClassEnabled;
  if (autoStopCheck) autoStopCheck.checked = Boolean(state.tokenConfig.autoStopOnAllFinished);
  if (targetInput && document.activeElement !== targetInput) {
    targetInput.value = String(target);
  }
  customInput.value = '';

  const reqText = state.tokenConfig.required ? 'Wajib Diisi' : 'Opsional';
  const visText = state.tokenConfig.showOnLogin ? 'Muncul di Layar Login' : 'Disembunyikan di Layar Login';

  if (isStopped) {
    statusEl.className = 'status-text-fail';
    statusEl.textContent = 'Dihentikan Otomatis (Target Siswa Tercapai)';
  } else {
    statusEl.className = 'status-text-pass';
    statusEl.textContent = `Aktif · ${reqText} · ${visText}`;
  }

  if (bindingEl) {
    if (!perClassEnabled) {
      bindingEl.textContent = 'Mode Lintas Kelas: Bebas (Token utama berlaku untuk semua kelas)';
    } else if (boundClass) {
      bindingEl.textContent = `Kelas Pemilik Token Utama: ${boundClass} (Kelas lain wajib token baru)`;
    } else {
      bindingEl.textContent = 'Kelas Pemilik Token Utama: Belum Terikat (Otomatis mengunci ke kelas pertama yang masuk)';
    }
  }

  if (progressEl) {
    progressEl.textContent =
      target > 0
        ? `Progres Selesai: ${doneCount} / ${target} Target Siswa (${activeCount} sedang mengerjakan)`
        : `Progres Selesai: ${doneCount} Selesai · ${activeCount} Sedang Mengerjakan (Token Tetap Aktif)`;
  }

  renderAdminClassTokensTable();
}

async function handleSwitchTokenMode(nextMode) {
  if (!state.tokenConfig) loadTokenConfig();
  const mode = nextMode === 'per_class' ? 'per_class' : 'global';
  if (state.tokenConfig.tokenMode === mode) return;

  const nextConfig = {
    ...state.tokenConfig,
    tokenMode: mode,
    updatedAt: new Date().toISOString(),
  };
  state.tokenConfig = nextConfig;
  writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
  renderAdminTokenPanel();
  renderLoginTokenField();

  const ok = await pushAdminConfigToServer({ tokenConfig: nextConfig });
  if (ok) {
    showToast(
      mode === 'per_class'
        ? 'Mode Menu Per Kelas (X, XI & XII) diaktifkan. Token tiap kelas siap diatur.'
        : 'Mode Token Umum (1 Token Utama) diaktifkan.',
      'success'
    );
  }
}

async function handleApplyClassPreset() {
  const presetSelect = document.getElementById('admin-class-preset-select');
  const preset = presetSelect?.value || 'rombel_bl';
  await sendClassTokenAction(
    { action: 'apply_class_preset', preset },
    'Daftar kelas dropdown siswa berhasil diperbarui.'
  );
}

async function handleAddClassToList() {
  const input = document.getElementById('admin-add-class-input');
  const className = normalizeClassKey(input?.value || '');
  if (!className) {
    showToast('Masukkan nama kelas terlebih dahulu (contoh: X-M atau XI-IPA-1).', 'error');
    return;
  }
  const ok = await sendClassTokenAction(
    { action: 'add_class', className, createToken: state.tokenConfig?.tokenMode === 'per_class' },
    `Kelas ${className} ditambahkan ke daftar dropdown.`
  );
  if (ok && input) input.value = '';
}

async function handleBatchGenerateClassTokens() {
  const grade = state.adminClassGradeFilter || 'ALL';
  const label = grade === 'ALL' ? 'semua kelas' : `Kelas ${grade}`;
  await sendClassTokenAction(
    { action: 'generate_batch', grade },
    `Token baru berhasil di-generate untuk ${label}.`
  );
}

async function handleBatchToggleClassTokens(isActive) {
  const grade = state.adminClassGradeFilter || 'ALL';
  const label = grade === 'ALL' ? 'semua kelas' : `Kelas ${grade}`;
  await sendClassTokenAction(
    { action: 'toggle_batch', grade, isActive },
    `Token ${label} berhasil ${isActive ? 'diaktifkan' : 'dinonaktifkan'}.`
  );
}

async function sendClassTokenAction(payload, successMsg) {
  if (!state.adminUnlocked || !state.adminToken) return false;
  try {
    const response = await fetch('/api/cbt/admin/class-token', {
      method: 'POST',
      headers: getAdminRequestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (response.status === 401 || response.status === 403) {
      handleAdminUnauthorized();
      return false;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(data?.error || 'Gagal memperbarui token kelas.', 'error');
      return false;
    }
    if (data?.tokenConfig) {
      state.tokenConfig = {
        ...data.tokenConfig,
        classTokensPublic: data.tokenConfig.classTokens || {},
      };
      writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
      renderClassDropdowns();
      renderAdminTokenPanel();
      renderLoginTokenField();
    }
    showToast(successMsg, 'success');
    return true;
  } catch {
    showToast('Gagal terhubung ke server untuk memperbarui token kelas.', 'error');
    return false;
  }
}

function handleAddOrGenerateClassToken() {
  const classInput = document.getElementById('admin-class-token-class');
  const codeInput = document.getElementById('admin-class-token-code');
  const className = normalizeClassKey(classInput?.value || '');
  const customCode = (codeInput?.value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (!className) {
    showToast('Pilih kelas dari dropdown terlebih dahulu.', 'error');
    return;
  }
  if (customCode && (customCode.length < 4 || customCode.length > 12)) {
    showToast('Kode token kelas manual harus 4 sampai 12 huruf/angka.', 'error');
    return;
  }

  sendClassTokenAction(
    { action: 'upsert', className, customCode },
    `Token khusus untuk kelas ${className} berhasil disimpan.`
  ).then((ok) => {
    if (ok && codeInput) codeInput.value = '';
  });
}

function handleResetExamToken() {
  openConfirmModal(
    'Reset Token Ujian Baru?',
    'Kode Token Ujian saat ini akan diganti dengan token acak yang baru (berbeda dari kelas sebelumnya) dan langsung aktif untuk kelas berikutnya.',
    async () => {
      const nextCode = generateUniqueRandomTokenCode(6);
      const nextConfig = {
        ...(state.tokenConfig || {
          tokenMode: 'per_class',
          classList: [...DEFAULT_CLASS_LIST],
          required: true,
          showOnLogin: true,
          autoStopOnAllFinished: false,
          targetParticipants: 0,
          requireNewTokenPerClass: true,
        }),
        code: nextCode,
        boundClass: null,
        isActive: true,
        stoppedAt: null,
        stoppedReason: '',
        updatedAt: new Date().toISOString(),
      };
      state.tokenConfig = nextConfig;
      writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
      renderAdminTokenPanel();
      renderLoginTokenField();
      const ok = await pushAdminConfigToServer({ tokenConfig: nextConfig });
      if (ok) {
        showToast(`Token Ujian baru berhasil dibuat dan siap untuk kelas baru: ${state.tokenConfig.code}`, 'success');
      }
    }
  );
}

function handleReactivateExamToken() {
  if (!state.tokenConfig) loadTokenConfig();
  state.tokenConfig = {
    ...state.tokenConfig,
    isActive: true,
    stoppedAt: null,
    stoppedReason: '',
    updatedAt: new Date().toISOString(),
  };
  writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
  renderAdminTokenPanel();
  renderLoginTokenField();
  pushAdminConfigToServer({ tokenConfig: state.tokenConfig });
  showToast(`Token Ujian ${state.tokenConfig.code} diaktifkan kembali.`, 'success');
}

async function handleSaveCustomToken() {
  const raw = document.getElementById('admin-custom-token-input').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length < 4 || raw.length > 12) {
    showToast('Token manual harus terdiri dari 4 sampai 12 huruf/angka.', 'error');
    return;
  }

  const nextConfig = {
    ...(state.tokenConfig || {
      tokenMode: 'per_class',
      classList: [...DEFAULT_CLASS_LIST],
      required: true,
      showOnLogin: true,
      autoStopOnAllFinished: false,
      targetParticipants: 0,
      requireNewTokenPerClass: true,
    }),
    code: raw,
    boundClass: null,
    isActive: true,
    stoppedAt: null,
    stoppedReason: '',
    updatedAt: new Date().toISOString(),
  };
  const ok = await pushAdminConfigToServer({ tokenConfig: nextConfig });
  if (ok) {
    showToast(`Token Ujian manual berhasil disimpan & diaktifkan: ${raw}`, 'success');
  }
}

function handleSaveTokenTargetCount() {
  if (!state.tokenConfig) loadTokenConfig();
  const raw = Number(document.getElementById('admin-token-target-count').value);
  if (Number.isNaN(raw) || raw < 0 || raw > 2000 || !Number.isInteger(raw)) {
    showToast('Target jumlah siswa harus berupa bilangan bulat 0 sampai 2000.', 'error');
    return;
  }

  state.tokenConfig = {
    ...state.tokenConfig,
    targetParticipants: raw,
    autoStopOnAllFinished: raw > 0 ? true : Boolean(state.tokenConfig.autoStopOnAllFinished),
  };
  writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
  const stoppedNow = evaluateTokenAutoStop();
  renderAdminTokenPanel();
  renderLoginTokenField();
  pushAdminConfigToServer({ tokenConfig: state.tokenConfig });
  if (stoppedNow) {
    showToast('Target terpenuhi! Token otomatis dihentikan.', 'success');
  } else {
    showToast(
      raw > 0
        ? `Target otomatis berhenti diatur ke ${raw} siswa selesai.`
        : 'Target 0 disimpan: Token tetap aktif terus untuk seluruh siswa.',
      'success'
    );
  }
}

async function handleCopyExamToken() {
  if (!state.tokenConfig) loadTokenConfig();
  try {
    await navigator.clipboard.writeText(state.tokenConfig.code);
    showToast(`Token ${state.tokenConfig.code} berhasil disalin.`, 'success');
  } catch {
    showToast(`Token aktif: ${state.tokenConfig.code}`, 'success');
  }
}

function handleTokenVisibilityOrRequiredChange() {
  if (!state.tokenConfig) loadTokenConfig();
  const required = document.getElementById('admin-token-required').checked;
  const showOnLogin = document.getElementById('admin-token-show-on-login').checked;
  const perClassEl = document.getElementById('admin-token-per-class');
  const requireNewTokenPerClass = perClassEl ? perClassEl.checked : true;
  const autoStopOnAllFinished = document.getElementById('admin-token-auto-stop').checked;

  state.tokenConfig = {
    ...state.tokenConfig,
    required,
    showOnLogin,
    requireNewTokenPerClass,
    autoStopOnAllFinished,
    updatedAt: state.tokenConfig.updatedAt || new Date().toISOString(),
  };
  writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
  evaluateTokenAutoStop();
  renderAdminTokenPanel();
  renderLoginTokenField();
  pushAdminConfigToServer({ tokenConfig: state.tokenConfig });
  showToast('Pengaturan Token Ujian disimpan.', 'success');
}

/* ==================== MONITORING PROGRES PER SISWA ==================== */
function upsertMonitoringRecord(student, patch = {}) {
  if (!student) return;
  const latestList = readStorage(STORAGE_KEYS.MONITORING, []);
  const list = Array.isArray(latestList) ? [...latestList] : [];

  const idx = list.findIndex((entry) => identityMatchesEntry(entry, student));
  const existing = idx >= 0 ? list[idx] : {};

  const updated = {
    ...existing,
    nama: student.nama || existing.nama || '-',
    username: student.username || existing.username || '-',
    nisn: student.nisn || existing.nisn || '-',
    absen: String(student.absen || existing.absen || '-'),
    ...patch,
    lastActivityAt: patch.lastActivityAt || Date.now(),
  };

  if (idx >= 0) {
    list[idx] = updated;
  } else {
    list.push(updated);
  }

  state.monitoring = list;
  writeStorage(STORAGE_KEYS.MONITORING, list);
}

function syncSessionToMonitoring(statusLabel = 'Sedang Mengerjakan', immediate = false) {
  if (!state.student || !state.session) return;
  const total = state.session.questionOrder.length;
  const answered = countAnsweredQuestions(state.session);
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;

  upsertMonitoringRecord(state.student, {
    status: statusLabel,
    answeredCount: answered,
    totalQuestions: total,
    percentage: pct,
    currentNumber: (state.session.currentIndex || 0) + 1,
    flaggedCount: Object.keys(state.session.flagged || {}).length,
    warningCount: Number(state.session.warningCount || 0),
    startTime: state.session.startTime,
    endTime: state.session.endTime,
    lastActivityAt: Date.now(),
  });

  syncStudentProgressToServer(immediate, statusLabel);
}

function startMonitoringRefreshLoop() {
  if (state.monitoringIntervalId) {
    clearInterval(state.monitoringIntervalId);
  }
  state.monitoringIntervalId = setInterval(() => {
    if (state.currentView === 'admin' && state.adminUnlocked) {
      if (state.adminTab === 'monitoring') {
        renderAdminMonitoringTable();
      }
      if (state.adminTab === 'monitoring' || state.adminTab === 'results' || state.adminTab === 'token') {
        syncAdminStateFromServer();
      }
    }
  }, 2000);
}

function getMergedMonitoringRecords() {
  const storedMonitoring = readStorage(STORAGE_KEYS.MONITORING, []);
  const resultsList = readStorage(STORAGE_KEYS.RESULTS, []);
  const usedList = readStorage(STORAGE_KEYS.USED_IDENTITIES, []);
  const activeSession = readStorage(STORAGE_KEYS.SESSION, null);
  const activeStudent = readStorage(STORAGE_KEYS.STUDENT, null);

  state.monitoring = Array.isArray(storedMonitoring) ? storedMonitoring : [];
  state.results = Array.isArray(resultsList) ? resultsList : [];
  state.usedIdentities = Array.isArray(usedList) ? usedList : [];

  const merged = [...state.monitoring];

  // Ensure all registered identities appear even if created prior to monitoring feature
  state.usedIdentities.forEach((u) => {
    const exists = merged.some((m) => identityMatchesEntry(m, u));
    if (!exists) {
      merged.push({
        nama: u.nama,
        username: u.username,
        nisn: u.nisn,
        absen: u.absen || '-',
        status: 'Belum Mulai',
        answeredCount: 0,
        totalQuestions: getActiveStudentQuestions().length,
        percentage: 0,
        currentNumber: 0,
        flaggedCount: 0,
        lastActivityAt: u.registeredAt || Date.now(),
      });
    }
  });

  // Ensure active session in storage reflects latest answered count
  if (activeSession && activeStudent) {
    const total = Array.isArray(activeSession.questionOrder) ? activeSession.questionOrder.length : state.questions.length;
    const answered = countAnsweredQuestions(activeSession);
    const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
    const idx = merged.findIndex((m) => identityMatchesEntry(m, activeStudent));
    const sessionPatch = {
      nama: activeStudent.nama,
      username: activeStudent.username,
      nisn: activeStudent.nisn,
      absen: activeStudent.absen || '-',
      status: 'Sedang Mengerjakan',
      answeredCount: answered,
      totalQuestions: total,
      percentage: pct,
      currentNumber: (activeSession.currentIndex || 0) + 1,
      flaggedCount: Object.keys(activeSession.flagged || {}).length,
      warningCount: Number(activeSession.warningCount || 0),
      startTime: activeSession.startTime,
      endTime: activeSession.endTime,
    };
    if (idx >= 0 && merged[idx].status !== 'Selesai') {
      merged[idx] = { ...merged[idx], ...sessionPatch };
    } else if (idx < 0) {
      merged.push({ ...sessionPatch, lastActivityAt: activeSession.startTime || Date.now() });
    }
  }

  // Ensure completed results always override status to 'Selesai'
  state.results.forEach((r) => {
    const total = r.totalQuestions || state.questions.length;
    const answered =
      typeof r.answeredCount === 'number'
        ? r.answeredCount
        : Array.isArray(r.details)
          ? r.details.filter((d) => d.userAnswerText && d.userAnswerText !== '(Tidak dijawab)').length
          : total;
    const pct = total > 0 ? Math.round((answered / total) * 100) : 0;

    const idx = merged.findIndex((m) => identityMatchesEntry(m, r));
    const donePatch = {
      nama: r.nama,
      username: r.username,
      nisn: r.nisn,
      absen: r.absen || '-',
      status: 'Selesai',
      answeredCount: answered,
      totalQuestions: total,
      percentage: pct,
      currentNumber: total,
      completedAt: r.completedAt,
      lastActivityAt: r.completedAt ? new Date(r.completedAt).getTime() : Date.now(),
    };

    if (idx >= 0) {
      merged[idx] = { ...merged[idx], ...donePatch };
    } else {
      merged.push(donePatch);
    }
  });

  return merged;
}

function formatRemainingTimeLabel(item) {
  if (item.status === 'Selesai') {
    return item.completedAt ? `Selesai (${formatDateTimeID(item.completedAt)})` : 'Sudah dikumpulkan';
  }
  if (item.status === 'Sedang Mengerjakan') {
    const posText = item.currentNumber ? `Soal #${item.currentNumber}` : 'Aktif';
    if (item.endTime) {
      const remMs = item.endTime - Date.now();
      if (remMs <= 0) return `${posText} · Waktu Habis`;
      const totalSec = Math.ceil(remMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      return `${posText} · Sisa ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return posText;
  }
  return 'Di Dashboard (Belum Mulai)';
}

function renderAdminMonitoringTable() {
  const tbody = document.getElementById('admin-monitoring-tbody');
  if (!tbody) return;

  const allItems = getMergedMonitoringRecords();

  // KPIs
  const totalCount = allItems.length;
  const activeCount = allItems.filter((i) => i.status === 'Sedang Mengerjakan').length;
  const doneCount = allItems.filter((i) => i.status === 'Selesai').length;
  const avgPct =
    totalCount > 0
      ? Math.round(allItems.reduce((sum, i) => sum + Number(i.percentage || 0), 0) / totalCount)
      : 0;

  document.getElementById('mon-kpi-total').textContent = String(totalCount);
  document.getElementById('mon-kpi-active').textContent = String(activeCount);
  document.getElementById('mon-kpi-done').textContent = String(doneCount);
  document.getElementById('mon-kpi-avg-progress').textContent = `${avgPct}%`;

  const search = (document.getElementById('admin-monitoring-search')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('admin-monitoring-filter-status')?.value || 'all';

  const filtered = allItems.filter((item) => {
    const matchSearch =
      !search ||
      String(item.nama || '').toLowerCase().includes(search) ||
      String(item.nisn || '').toLowerCase().includes(search) ||
      String(item.absen || '').toLowerCase().includes(search) ||
      String(item.username || '').toLowerCase().includes(search);
    const isProtected6x = Boolean(
      item.terminatedByViolation || Number(item.warningCount || 0) >= MAX_EXAM_WARNINGS
    );
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'Terproteksi' ? isProtected6x : item.status === statusFilter);
    return matchSearch && matchStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="empty-state">
          Belum ada data monitoring siswa yang sesuai. Data muncul otomatis saat siswa masuk atau mengerjakan tes.
        </td>
      </tr>
    `;
    return;
  }

  // Sort: Terproteksi 6x & Sedang Mengerjakan prioritized cleanly, then Belum Mulai, then Selesai; newest activity first
  const statusRank = { 'Sedang Mengerjakan': 0, 'Belum Mulai': 1, Selesai: 2 };
  const sorted = [...filtered].sort((a, b) => {
    const aProt = a.terminatedByViolation || Number(a.warningCount || 0) >= MAX_EXAM_WARNINGS ? 1 : 0;
    const bProt = b.terminatedByViolation || Number(b.warningCount || 0) >= MAX_EXAM_WARNINGS ? 1 : 0;
    if (aProt !== bProt) return bProt - aProt;
    const rankDiff = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (rankDiff !== 0) return rankDiff;
    return Number(b.lastActivityAt || 0) - Number(a.lastActivityAt || 0);
  });

  tbody.innerHTML = sorted
    .map((item, idx) => {
      const answered = Number(item.answeredCount || 0);
      const total = Number(item.totalQuestions || state.questions.length || 0);
      const pct = Number(item.percentage || 0);
      const warnCount = Number(item.warningCount || 0);
      const isProtected6x = Boolean(item.terminatedByViolation || warnCount >= MAX_EXAM_WARNINGS);

      let statusLabel = item.status || 'Belum Mulai';
      let statusClass = 'status-text-pending';
      if (isProtected6x) {
        statusLabel = `Terproteksi (${Math.min(MAX_EXAM_WARNINGS, Math.max(warnCount, MAX_EXAM_WARNINGS))}/${MAX_EXAM_WARNINGS})`;
        statusClass = 'status-text-fail';
      } else if (item.status === 'Selesai') {
        statusClass = 'status-text-pass';
      } else if (item.status === 'Sedang Mengerjakan') {
        statusClass = 'status-text-active';
      }

      const lastTime = item.lastActivityAt
        ? new Date(item.lastActivityAt).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        : '-';

      let warnTag = '';
      if (isProtected6x) {
        warnTag = `<span class="mon-student-sub">Pelanggaran 6x · Auto-Selesai</span>`;
      } else if (warnCount > 0) {
        warnTag = `<span class="mon-student-sub">Peringatan: ${Math.min(MAX_EXAM_WARNINGS, warnCount)}/${MAX_EXAM_WARNINGS}</span>`;
      } else if (item.loginResetAt && item.status === 'Belum Mulai') {
        warnTag = `<span class="mon-student-sub">Login Direset · Siap Lanjutkan</span>`;
      }

      const resetBtnClass = isProtected6x ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm';
      const resetBtnLabel = isProtected6x ? 'Reset Login Siswa' : 'Reset Login';

      return `
        <tr>
          <td class="mono-text">${idx + 1}</td>
          <td>
            <strong>${escapeHtml(item.nama)}</strong>
            <span class="mon-student-sub">@${escapeHtml(item.username)}</span>
          </td>
          <td class="mono-text">${escapeHtml(item.nisn)}</td>
          <td class="mono-text">${escapeHtml(item.absen || '-')}</td>
          <td>
            <span class="${statusClass}">${escapeHtml(statusLabel)}</span>
            ${warnTag}
          </td>
          <td class="mono-text"><strong>${answered}</strong> / ${total} Soal</td>
          <td>
            <div class="mon-progress-cell">
              <div class="mon-progress-track" aria-label="Progres ${pct}%">
                <div class="mon-progress-fill${item.status === 'Selesai' ? ' is-done' : ''}" style="width: ${Math.min(100, Math.max(0, pct))}%"></div>
              </div>
              <span class="mono-text mon-progress-pct">${pct}%</span>
            </div>
          </td>
          <td class="mono-text">${escapeHtml(formatRemainingTimeLabel(item))}</td>
          <td class="mono-text">${escapeHtml(lastTime)}</td>
          <td>
            <button
              type="button"
              class="${resetBtnClass} mon-reset-login-btn"
              data-reset-student-login="1"
              data-nama="${escapeHtml(item.nama)}"
              data-username="${escapeHtml(item.username)}"
              data-nisn="${escapeHtml(item.nisn)}"
              data-absen="${escapeHtml(item.absen || '-')}"
              data-protected="${isProtected6x ? '1' : '0'}"
              data-answered="${answered}"
              data-total="${total}"
              title="Buka kembali akses login siswa dan lanjutkan soal sebelumnya"
            >
              ${resetBtnLabel}
            </button>
          </td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('[data-reset-student-login]').forEach((btn) => {
    btn.addEventListener('click', () => {
      promptResetStudentLogin({
        nama: btn.dataset.nama || '',
        username: btn.dataset.username || '',
        nisn: btn.dataset.nisn || '',
        absen: btn.dataset.absen || '-',
        isProtected6x: btn.dataset.protected === '1',
        answered: Number(btn.dataset.answered || 0),
        total: Number(btn.dataset.total || 0),
      });
    });
  });
}

function promptResetStudentLogin(studentInfo) {
  if (!state.adminUnlocked || !state.adminToken) return;
  const { nama, username, nisn, absen, isProtected6x, answered, total } = studentInfo;
  const title = isProtected6x
    ? 'Reset Login Siswa (Terproteksi 6x)?'
    : 'Reset Login Siswa Ini?';
  const desc = isProtected6x
    ? `Siswa ${nama} (${nisn} · Absen ${absen}) terkunci akibat pelanggaran 6/6. Reset Login akan membuka kembali akses masuk, mereset pelanggaran menjadi 0/6, dan siswa dapat melanjutkan pengerjaan (${answered}/${total} soal sebelumnya tetap tersimpan).`
    : `Akses login untuk ${nama} (${nisn} · Absen ${absen}) akan dibuka kembali agar siswa dapat login ulang dan melanjutkan pengerjaan soal yang tersimpan (${answered}/${total} soal).`;

  openConfirmModal(title, desc, async () => {
    try {
      const response = await fetch('/api/cbt/admin/reset-student-login', {
        method: 'POST',
        headers: getAdminRequestHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ nama, username, nisn, absen }),
      });

      if (response.status === 401 || response.status === 403) {
        handleAdminUnauthorized();
        return;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        showToast(data?.error || 'Gagal mereset login siswa.', 'error');
        return;
      }

      const candidate = { nama, username, nisn, absen };
      state.monitoring = Array.isArray(data.monitoring) ? data.monitoring : state.monitoring;
      state.results = Array.isArray(data.results)
        ? data.results
        : (state.results || []).filter((r) => !identityMatchesEntry(r, candidate));
      state.usedIdentities = Array.isArray(data.usedIdentities)
        ? data.usedIdentities
        : (state.usedIdentities || []).filter((u) => !identityMatchesEntry(u, candidate));

      writeStorage(STORAGE_KEYS.MONITORING, state.monitoring);
      writeStorage(STORAGE_KEYS.RESULTS, state.results);
      writeStorage(STORAGE_KEYS.USED_IDENTITIES, state.usedIdentities);

      renderAdminMonitoringTable();
      renderAdminResultsTable();

      const msg = data.hasResumableSession
        ? `Login ${nama} berhasil direset! Siswa dapat masuk kembali dan melanjutkan pengerjaan soal sebelumnya.`
        : `Akses login ${nama} berhasil direset dan siap digunakan kembali.`;
      showToast(msg, 'success');
    } catch {
      showToast('Tidak dapat terhubung ke server untuk mereset login siswa.', 'error');
    }
  });
}

function renderAdminSyllabusPanel() {
  if (!state.settings) loadExamSettings();
  document.getElementById('admin-set-subject').value = state.settings.subject;
  document.getElementById('admin-set-main-topic').value = state.settings.mainTopic;
  document.getElementById('admin-set-duration').value = state.settings.durationMinutes;
  const pedomanEl = document.getElementById('admin-set-pedoman');
  if (pedomanEl) pedomanEl.value = state.settings.pedomanPenulisan || '';

  const activeStrip = document.getElementById('admin-active-material-strip');
  const activeLinkEl = document.getElementById('admin-active-material-link');
  const safeActiveHref = sanitizeHttpHref(state.settings.activeMaterialUrl || '');
  if (activeStrip && activeLinkEl) {
    if (safeActiveHref) {
      activeLinkEl.href = safeActiveHref;
      activeLinkEl.textContent = state.settings.activeMaterialTitle
        ? `${state.settings.activeMaterialTitle} (${safeActiveHref})`
        : safeActiveHref;
      activeStrip.classList.remove('hidden');
    } else {
      activeStrip.classList.add('hidden');
    }
  }

  state.draftSyllabusItems = [...state.settings.syllabusItems];
  renderSyllabusSavedSummary();
  renderAdminSyllabusList();
  renderAdminMaterialResources();
  updateSyllabusDirtyState();
}

function renderSyllabusSavedSummary() {
  if (!state.settings) loadExamSettings();
  const savedSub = document.getElementById('syllabus-saved-subject');
  const savedDur = document.getElementById('syllabus-saved-duration');
  const savedTopic = document.getElementById('syllabus-saved-topic');
  if (savedSub) savedSub.textContent = state.settings.subject;
  if (savedDur) savedDur.textContent = `${state.settings.durationMinutes} Menit`;
  if (savedTopic) savedTopic.textContent = state.settings.mainTopic;
}

function isSyllabusDirty() {
  if (!state.settings) return false;
  const subjectVal = (document.getElementById('admin-set-subject')?.value || '').trim();
  const mainTopicVal = (document.getElementById('admin-set-main-topic')?.value || '').trim();
  const durationVal = Number(document.getElementById('admin-set-duration')?.value);
  const pedomanVal = (document.getElementById('admin-set-pedoman')?.value || '').trim();
  const draftItems = state.draftSyllabusItems.map((s) => s.trim());
  const savedItems = state.settings.syllabusItems.map((s) => s.trim());

  if (subjectVal !== state.settings.subject) return true;
  if (mainTopicVal !== state.settings.mainTopic) return true;
  if (durationVal !== state.settings.durationMinutes) return true;
  if (pedomanVal !== (state.settings.pedomanPenulisan || '').trim()) return true;
  if (draftItems.length !== savedItems.length) return true;
  return draftItems.some((item, idx) => item !== savedItems[idx]);
}

function updateSyllabusDirtyState() {
  const dirty = isSyllabusDirty();
  const badge = document.getElementById('syllabus-dirty-badge');
  const cancelBtn = document.getElementById('btn-cancel-syllabus-edit');
  if (badge) {
    badge.textContent = dirty ? 'Perubahan belum disimpan' : 'Tersimpan';
    badge.classList.toggle('is-dirty', dirty);
    badge.classList.toggle('is-saved', !dirty);
  }
  if (cancelBtn) {
    cancelBtn.classList.toggle('hidden', !dirty);
  }
}

function handleCancelSyllabusEdit() {
  renderAdminSyllabusPanel();
  showToast('Perubahan yang belum disimpan dibatalkan.', 'default');
}

function renderAdminSyllabusList() {
  const container = document.getElementById('admin-syllabus-list');
  if (!container) return;

  if (state.draftSyllabusItems.length === 0) {
    container.innerHTML = '<div class="empty-state">Belum ada butir cakupan materi. Tambahkan minimal satu poin di bawah ini.</div>';
    return;
  }

  container.innerHTML = state.draftSyllabusItems
    .map(
      (item, idx) => `
    <div class="syllabus-editor-row">
      <span class="syllabus-row-num">${idx + 1}.</span>
      <input
        type="text"
        class="form-input input-compact"
        data-syllabus-input="${idx}"
        value="${escapeHtml(item)}"
        aria-label="Poin cakupan materi ${idx + 1}"
      />
      <div class="syllabus-row-actions">
        <button type="button" class="btn btn-outline btn-sm" data-syllabus-up="${idx}" ${idx === 0 ? 'disabled' : ''} aria-label="Pindah ke atas">↑</button>
        <button type="button" class="btn btn-outline btn-sm" data-syllabus-down="${idx}" ${idx === state.draftSyllabusItems.length - 1 ? 'disabled' : ''} aria-label="Pindah ke bawah">↓</button>
        <button type="button" class="btn btn-outline btn-sm btn-danger-outline" data-syllabus-del="${idx}">Hapus</button>
      </div>
    </div>
  `
    )
    .join('');

  container.querySelectorAll('[data-syllabus-input]').forEach((input) => {
    input.addEventListener('input', (e) => {
      const idx = Number(e.target.dataset.syllabusInput);
      state.draftSyllabusItems[idx] = e.target.value;
      updateSyllabusDirtyState();
    });
  });

  container.querySelectorAll('[data-syllabus-up]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.syllabusUp);
      if (idx > 0) {
        [state.draftSyllabusItems[idx - 1], state.draftSyllabusItems[idx]] = [
          state.draftSyllabusItems[idx],
          state.draftSyllabusItems[idx - 1],
        ];
        renderAdminSyllabusList();
        updateSyllabusDirtyState();
      }
    });
  });

  container.querySelectorAll('[data-syllabus-down]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.syllabusDown);
      if (idx < state.draftSyllabusItems.length - 1) {
        [state.draftSyllabusItems[idx + 1], state.draftSyllabusItems[idx]] = [
          state.draftSyllabusItems[idx],
          state.draftSyllabusItems[idx + 1],
        ];
        renderAdminSyllabusList();
        updateSyllabusDirtyState();
      }
    });
  });

  container.querySelectorAll('[data-syllabus-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.syllabusDel);
      state.draftSyllabusItems.splice(idx, 1);
      renderAdminSyllabusList();
      updateSyllabusDirtyState();
    });
  });
}

function handleAddSyllabusItem() {
  const input = document.getElementById('admin-new-syllabus-item');
  const text = input.value.trim();
  if (!text) {
    showToast('Tuliskan poin cakupan materi terlebih dahulu.', 'error');
    return;
  }
  state.draftSyllabusItems.push(text);
  input.value = '';
  renderAdminSyllabusList();
  updateSyllabusDirtyState();
}

function handleSaveSyllabus(e) {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }

  const subject = document.getElementById('admin-set-subject').value.trim();
  const mainTopic = document.getElementById('admin-set-main-topic').value.trim();
  const durationMinutes = Number(document.getElementById('admin-set-duration').value);
  const pedomanPenulisan = (document.getElementById('admin-set-pedoman')?.value || '').trim();
  const cleanedItems = state.draftSyllabusItems.map((s) => s.trim()).filter(Boolean);

  if (!subject || !mainTopic) {
    showToast('Mata Pelajaran dan Materi Pokok tidak boleh kosong.', 'error');
    return;
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600) {
    showToast('Waktu Ujian harus berupa bilangan bulat antara 1 sampai 600 menit.', 'error');
    return;
  }
  if (cleanedItems.length === 0) {
    showToast('Minimal harus ada satu butir cakupan materi ujian.', 'error');
    return;
  }

  state.settings = {
    ...state.settings,
    subject,
    mainTopic,
    durationMinutes,
    syllabusItems: cleanedItems,
    pedomanPenulisan,
  };
  writeStorage(STORAGE_KEYS.SETTINGS, state.settings);
  state.draftSyllabusItems = [...cleanedItems];

  renderSyllabusSavedSummary();
  renderAdminSyllabusList();
  updateSyllabusDirtyState();
  syncTopicSelectElements();
  renderAiGeneratorPanel();
  applySettingsToUI();
  pushAdminConfigToServer({ settings: state.settings });
  showToast('Pengaturan Mata Pelajaran, Waktu Ujian, Materi Pokok, dan Pedoman berhasil disimpan.', 'success');
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca berkas PDF.'));
    reader.readAsDataURL(file);
  });
}

async function handleUploadPdfMaterial() {
  if (!state.adminUnlocked || !state.adminToken) {
    handleAdminUnauthorized();
    return;
  }

  const fileInput = document.getElementById('admin-material-pdf-file');
  const titleInput = document.getElementById('admin-material-pdf-title');
  const kindSelect = document.getElementById('admin-material-pdf-kind');
  const btn = document.getElementById('btn-upload-pdf-material');
  const file = fileInput?.files?.[0];

  if (!file) {
    showToast('Pilih file PDF terlebih dahulu.', 'error');
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    showToast('Ukuran PDF maksimal 15 MB.', 'error');
    return;
  }

  const prevText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Mengunggah & Memproses PDF...';
  }

  try {
    const base64Data = await readFileAsBase64(file);
    const response = await fetch('/api/cbt/admin/materials/upload', {
      method: 'POST',
      headers: getAdminRequestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        fileName: file.name,
        title: (titleInput?.value || '').trim(),
        contentKind: kindSelect?.value || 'campuran',
        base64Data,
        runAi: true,
      }),
    });

    if (response.status === 401 || response.status === 403) {
      handleAdminUnauthorized();
      return;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.resource) {
      showToast(data?.error || 'Gagal mengunggah dan memproses PDF.', 'error');
      return;
    }

    state.materialResources = [
      data.resource,
      ...(state.materialResources || []).filter((m) => m.id !== data.resource.id),
    ];
    state.previewMaterialId = data.resource.id;
    renderMaterialPreviewBox(data.resource);
    renderAdminMaterialResources();
    applyMaterialResourceToSyllabus(data.resource.id, false);

    if (fileInput) fileInput.value = '';
    if (titleInput) titleInput.value = '';

    if (data.aiNotice) {
      showToast(data.aiNotice, 'default');
    } else {
      showToast(
        'PDF berhasil diproses! Mata Pelajaran, Materi Pokok, Cakupan Materi, dan Link Akses siap.',
        'success'
      );
    }
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Gagal mengunggah PDF materi.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText || 'Upload PDF, Ekstrak Pedoman & Generate Link';
    }
  }
}

async function handleSubmitUrlMaterial(analyzeContent = true) {
  if (!state.adminUnlocked || !state.adminToken) {
    handleAdminUnauthorized();
    return;
  }

  const urlInput = document.getElementById('admin-material-url-input');
  const titleInput = document.getElementById('admin-material-url-title');
  const kindSelect = document.getElementById('admin-material-url-kind');
  const btnExtract = document.getElementById('btn-extract-url-material');
  const btnLinkOnly = document.getElementById('btn-generate-url-link-only');

  const rawUrl = (urlInput?.value || '').trim();
  if (!/^https?:\/\/.+/i.test(rawUrl)) {
    showToast('Masukkan alamat Link URL atau Website yang valid (diawali https:// atau http://).', 'error');
    return;
  }

  const prevExtractText = btnExtract ? btnExtract.textContent : '';
  const prevLinkText = btnLinkOnly ? btnLinkOnly.textContent : '';
  if (btnExtract) {
    btnExtract.disabled = true;
    if (analyzeContent) btnExtract.textContent = 'Mengambil Isi Link & Generate...';
  }
  if (btnLinkOnly) {
    btnLinkOnly.disabled = true;
    if (!analyzeContent) btnLinkOnly.textContent = 'Membuat Link Akses...';
  }

  try {
    const response = await fetch('/api/cbt/admin/materials/from-url', {
      method: 'POST',
      headers: getAdminRequestHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        url: rawUrl,
        title: (titleInput?.value || '').trim(),
        contentKind: kindSelect?.value || 'campuran',
        analyzeContent,
      }),
    });

    if (response.status === 401 || response.status === 403) {
      handleAdminUnauthorized();
      return;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.resource) {
      showToast(data?.error || 'Gagal memproses link website tujuan.', 'error');
      return;
    }

    state.materialResources = [
      data.resource,
      ...(state.materialResources || []).filter((m) => m.id !== data.resource.id),
    ];
    state.previewMaterialId = data.resource.id;
    renderMaterialPreviewBox(data.resource);
    renderAdminMaterialResources();

    if (analyzeContent && data.aiExtracted) {
      applyMaterialResourceToSyllabus(data.resource.id, false);
    }

    if (urlInput) urlInput.value = '';
    if (titleInput) titleInput.value = '';

    if (data.aiNotice) {
      showToast(data.aiNotice, 'default');
    } else {
      showToast('Link Akses berhasil di-generate dan materi siap digunakan sebagai pedoman.', 'success');
    }
  } catch (err) {
    showToast(err instanceof Error ? err.message : 'Gagal menghubungi server untuk memproses link.', 'error');
  } finally {
    if (btnExtract) {
      btnExtract.disabled = false;
      btnExtract.textContent = prevExtractText || 'Ambil Isi Link & Generate Akses';
    }
    if (btnLinkOnly) {
      btnLinkOnly.disabled = false;
      btnLinkOnly.textContent = prevLinkText || 'Generate Link Akses Saja';
    }
  }
}

function renderMaterialPreviewBox(resource) {
  const box = document.getElementById('admin-material-preview-box');
  if (!box) return;
  if (!resource) {
    box.classList.add('hidden');
    return;
  }

  const accessUrl = getMaterialAccessUrl(resource.id);
  const titleEl = document.getElementById('admin-material-preview-title');
  const metaEl = document.getElementById('admin-material-preview-meta');
  const linkEl = document.getElementById('admin-material-preview-link');
  const openEl = document.getElementById('btn-open-preview-access-link');
  const subEl = document.getElementById('admin-material-preview-subject');
  const topEl = document.getElementById('admin-material-preview-topic');
  const pedEl = document.getElementById('admin-material-preview-pedoman');
  const importQBtn = document.getElementById('btn-import-material-questions');

  if (titleEl) titleEl.textContent = resource.title || 'Materi Referensi';
  if (metaEl) {
    const typeLabel = resource.sourceType === 'pdf' ? 'PDF Upload' : 'Link Website';
    metaEl.textContent = ` · ${typeLabel} · ${(resource.extractedSyllabusItems || []).length} Butir Cakupan`;
  }
  if (linkEl) linkEl.textContent = accessUrl;
  if (openEl) openEl.href = sanitizeHttpHref(accessUrl) || '#';
  if (subEl) subEl.textContent = resource.extractedSubject || '-';
  if (topEl) topEl.textContent = resource.extractedMainTopic || '-';
  if (pedEl) pedEl.textContent = resource.pedomanPenulisan || '-';

  const detectedCount = Array.isArray(resource.detectedQuestions) ? resource.detectedQuestions.length : 0;
  if (importQBtn) {
    if (detectedCount > 0) {
      importQBtn.classList.remove('hidden');
      importQBtn.textContent = `Tambahkan Soal Terdeteksi ke Bank Soal (${detectedCount})`;
    } else {
      importQBtn.classList.add('hidden');
    }
  }

  box.classList.remove('hidden');
}

function applyMaterialResourceToSyllabus(materialId, saveImmediately = false) {
  const resource = (state.materialResources || []).find((m) => m.id === materialId);
  if (!resource) return;

  const accessUrl = getMaterialAccessUrl(resource.id);
  const subEl = document.getElementById('admin-set-subject');
  const topicEl = document.getElementById('admin-set-main-topic');
  const pedEl = document.getElementById('admin-set-pedoman');
  const activeStrip = document.getElementById('admin-active-material-strip');
  const activeLinkEl = document.getElementById('admin-active-material-link');

  if (subEl && resource.extractedSubject) subEl.value = resource.extractedSubject;
  if (topicEl && resource.extractedMainTopic) topicEl.value = resource.extractedMainTopic;
  if (pedEl && resource.pedomanPenulisan) pedEl.value = resource.pedomanPenulisan;
  if (Array.isArray(resource.extractedSyllabusItems) && resource.extractedSyllabusItems.length > 0) {
    state.draftSyllabusItems = [...resource.extractedSyllabusItems];
    renderAdminSyllabusList();
  }

  state.settings.activeMaterialId = resource.id;
  state.settings.activeMaterialTitle = resource.title || '';
  state.settings.activeMaterialUrl = accessUrl;

  if (activeStrip && activeLinkEl) {
    activeLinkEl.href = sanitizeHttpHref(accessUrl) || '#';
    activeLinkEl.textContent = `${resource.title || 'Materi Aktif'} (${accessUrl})`;
    activeStrip.classList.remove('hidden');
  }

  updateSyllabusDirtyState();

  if (saveImmediately) {
    handleSaveSyllabus();
  } else {
    showToast('Hasil materi diisikan ke form di bawah. Klik "Simpan Perubahan" untuk menerapkan ke ujian.', 'default');
  }
}

function importDetectedQuestionsFromMaterial(materialId) {
  const resource = (state.materialResources || []).find((m) => m.id === materialId);
  const detected = Array.isArray(resource?.detectedQuestions) ? resource.detectedQuestions : [];
  if (detected.length === 0) {
    showToast('Tidak ada soal terdeteksi pada sumber materi ini.', 'error');
    return;
  }

  openConfirmModal(
    `Tambahkan ${detected.length} Soal ke Bank Soal?`,
    `Sebanyak ${detected.length} butir soal dari "${resource.title}" akan ditambahkan ke daftar Bank Soal ujian (beserta materi & kunci jawabannya).`,
    () => {
      let maxNum = state.questions.reduce((m, q) => {
        const n = Number(String(q.id || '').replace(/\D+/g, ''));
        return Number.isFinite(n) && n > m ? n : m;
      }, state.questions.length);

      const newItems = detected.map((q) => {
        maxNum += 1;
        return {
          id: `Q${String(maxNum).padStart(3, '0')}`,
          type: q.type || 'pg',
          topic: q.topic || state.settings.syllabusItems[0] || TOPICS[0],
          question: q.question,
          ...(q.options ? { options: { ...q.options } } : {}),
          answer: q.answer,
          explanation: q.explanation || '',
        };
      });

      state.questions = [...state.questions, ...newItems];
      writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);
      syncTopicSelectElements();
      renderAdminQuestionList();
      updateGlobalMetaCounts();
      pushAdminConfigToServer({ questions: state.questions });
      showToast(`Berhasil menambahkan ${newItems.length} soal ke Bank Soal.`, 'success');
    }
  );
}

async function deleteMaterialResource(materialId) {
  if (!state.adminUnlocked || !state.adminToken) {
    handleAdminUnauthorized();
    return;
  }
  try {
    const response = await fetch(`/api/cbt/admin/materials/${encodeURIComponent(materialId)}`, {
      method: 'DELETE',
      headers: getAdminRequestHeaders(),
    });
    if (response.status === 401 || response.status === 403) {
      handleAdminUnauthorized();
      return;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(data?.error || 'Gagal menghapus materi.', 'error');
      return;
    }
    state.materialResources = Array.isArray(data.materialResources) ? data.materialResources : [];
    if (state.previewMaterialId === materialId) {
      state.previewMaterialId = null;
      renderMaterialPreviewBox(null);
    }
    if (data.settings) {
      state.settings = { ...state.settings, ...data.settings };
      writeStorage(STORAGE_KEYS.SETTINGS, state.settings);
    }
    renderAdminSyllabusPanel();
    showToast('Materi dan link akses berhasil dihapus.', 'success');
  } catch {
    showToast('Gagal menghubungi server untuk menghapus materi.', 'error');
  }
}

function renderAdminMaterialResources() {
  const container = document.getElementById('admin-material-saved-list');
  if (!container) return;

  const list = state.materialResources || [];
  if (list.length === 0) {
    container.innerHTML =
      '<div class="empty-state">Belum ada file PDF atau Link Website yang diunggah. Unggah PDF atau masukkan URL di atas untuk membuat pedoman soal dan link akses.</div>';
    return;
  }

  container.innerHTML = list
    .map((m) => {
      const accessUrl = getMaterialAccessUrl(m.id);
      const safeAccessHref = sanitizeHttpHref(accessUrl);
      const badgeLabel = m.sourceType === 'pdf' ? 'PDF Upload' : 'Link Website';
      const qCount = Array.isArray(m.detectedQuestions) ? m.detectedQuestions.length : 0;
      return `
      <div class="material-saved-item">
        <div class="material-saved-info">
          <div class="material-saved-title-row">
            <span class="material-type-tag">${escapeHtml(badgeLabel)}</span>
            <strong>${escapeHtml(m.title)}</strong>
            ${qCount > 0 ? `<span class="meta-text">(${qCount} soal terdeteksi)</span>` : ''}
          </div>
          <div class="meta-text">
            ${escapeHtml(m.extractedSubject || '-')} · ${escapeHtml(m.extractedMainTopic || '-')}
          </div>
          <div class="mono-text meta-text">${escapeHtml(accessUrl)}</div>
        </div>
        <div class="material-saved-actions">
          <button type="button" class="btn btn-outline btn-sm" data-mat-copy="${escapeHtml(m.id)}">Salin Link</button>
          <a href="${escapeHtml(safeAccessHref)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm">Buka Link</a>
          <button type="button" class="btn btn-outline btn-sm" data-mat-apply="${escapeHtml(m.id)}">Terapkan Pedoman</button>
          ${qCount > 0 ? `<button type="button" class="btn btn-outline btn-sm" data-mat-import="${escapeHtml(m.id)}">+${qCount} Soal</button>` : ''}
          <button type="button" class="btn btn-outline btn-sm btn-danger-outline" data-mat-del="${escapeHtml(m.id)}">Hapus</button>
        </div>
      </div>
    `;
    })
    .join('');

  container.querySelectorAll('[data-mat-copy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      copyTextToClipboard(getMaterialAccessUrl(btn.dataset.matCopy), 'Link akses materi berhasil disalin.');
    });
  });

  container.querySelectorAll('[data-mat-apply]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = (state.materialResources || []).find((m) => m.id === btn.dataset.matApply);
      if (target) {
        state.previewMaterialId = target.id;
        renderMaterialPreviewBox(target);
        applyMaterialResourceToSyllabus(target.id, true);
      }
    });
  });

  container.querySelectorAll('[data-mat-import]').forEach((btn) => {
    btn.addEventListener('click', () => {
      importDetectedQuestionsFromMaterial(btn.dataset.matImport);
    });
  });

  container.querySelectorAll('[data-mat-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.matDel;
      openConfirmModal(
        'Hapus Materi & Link Akses?',
        'Dokumen atau link website ini akan dihapus beserta link aksesnya.',
        () => deleteMaterialResource(id)
      );
    });
  });
}

async function openMaterialReaderView(materialId) {
  const titleEl = document.getElementById('material-reader-title');
  const subEl = document.getElementById('material-reader-subject');
  const topicEl = document.getElementById('material-reader-topic');
  const badgeEl = document.getElementById('material-reader-badge');
  const urlBox = document.getElementById('material-reader-url-box');
  const targetUrlEl = document.getElementById('material-reader-target-url');
  const openExtBtn = document.getElementById('btn-reader-open-external');
  const pdfBox = document.getElementById('material-reader-pdf-box');
  const openPdfBtn = document.getElementById('btn-reader-open-pdf');
  const pdfMetaEl = document.getElementById('material-reader-pdf-meta');
  const pdfFrame = document.getElementById('material-reader-pdf-frame');
  const listEl = document.getElementById('material-reader-syllabus-list');
  const pedEl = document.getElementById('material-reader-pedoman');

  if (titleEl) titleEl.textContent = 'Memuat Materi...';
  if (urlBox) urlBox.classList.add('hidden');
  if (pdfBox) pdfBox.classList.add('hidden');

  try {
    const res = await fetch(`/api/cbt/materials/${encodeURIComponent(materialId)}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.id) {
      if (titleEl) titleEl.textContent = 'Materi Tidak Ditemukan';
      if (badgeEl) badgeEl.textContent = 'Tidak Tersedia';
      if (pedEl) pedEl.textContent = data?.error || 'Link materi tidak ditemukan atau sudah dihapus oleh Admin.';
      if (listEl) listEl.innerHTML = '';
      return;
    }

    if (titleEl) titleEl.textContent = data.title || 'Materi & Pedoman Ujian';
    if (subEl) subEl.textContent = data.extractedSubject || '-';
    if (topicEl) topicEl.textContent = data.extractedMainTopic || '-';
    if (badgeEl) badgeEl.textContent = data.sourceType === 'pdf' ? 'Dokumen PDF' : 'Link Website';
    if (pedEl) pedEl.textContent = data.pedomanPenulisan || '-';
    if (listEl) {
      const items = Array.isArray(data.extractedSyllabusItems) ? data.extractedSyllabusItems : [];
      listEl.innerHTML = items.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
    }

    const safeTargetUrl = sanitizeHttpHref(data.targetUrl || '');
    if (safeTargetUrl && urlBox && targetUrlEl && openExtBtn) {
      targetUrlEl.textContent = safeTargetUrl;
      openExtBtn.href = safeTargetUrl;
      urlBox.classList.remove('hidden');
    }

    if (data.hasPdfFile && pdfBox && openPdfBtn && pdfFrame) {
      const fileHref = `/api/cbt/materials/${encodeURIComponent(data.id)}/file`;
      openPdfBtn.href = fileHref;
      pdfFrame.src = fileHref;
      if (pdfMetaEl) {
        const kb = data.fileSizeBytes ? `${Math.max(1, Math.round(data.fileSizeBytes / 1024))} KB` : '';
        pdfMetaEl.textContent = [data.fileName, kb].filter(Boolean).join(' · ');
      }
      pdfBox.classList.remove('hidden');
    }
  } catch {
    if (titleEl) titleEl.textContent = 'Gagal Memuat Materi';
    if (pedEl) pedEl.textContent = 'Tidak dapat terhubung ke server untuk memuat materi.';
  }
}

function getSelectedResultClassLabel(filterValue = state.adminResultClassFilter) {
  const val = String(filterValue || 'ALL').trim();
  if (!val || val === 'ALL') return 'Semua Kelas';
  if (val.startsWith('GRADE:')) {
    return `Semua Kelas ${val.slice('GRADE:'.length)}`;
  }
  return `Kelas ${val}`;
}

function getFilteredAdminResults() {
  const query = (document.getElementById('admin-result-search')?.value || '').trim().toLowerCase();
  const classFilter = state.adminResultClassFilter || 'ALL';
  const results = state.results || [];

  return results.filter((r) => {
    const rowClass = normalizeClassKey(r.nisn);
    if (classFilter && classFilter !== 'ALL') {
      if (classFilter.startsWith('GRADE:')) {
        const targetGrade = classFilter.slice('GRADE:'.length);
        if (getClassGrade(rowClass) !== targetGrade) return false;
      } else if (rowClass !== normalizeClassKey(classFilter)) {
        return false;
      }
    }

    if (!query) return true;
    return (
      String(r.nama || '').toLowerCase().includes(query) ||
      String(r.nisn || '').toLowerCase().includes(query) ||
      String(r.absen || '').toLowerCase().includes(query) ||
      String(r.nomorUrut || '').includes(query)
    );
  });
}

function exportResultsToCsv() {
  const rowsData = getFilteredAdminResults();
  if (rowsData.length === 0) {
    showToast('Belum ada data hasil penilaian sesuai filter untuk diekspor.', 'error');
    return;
  }

  const headers = [
    'No. Urut',
    'Nama Lengkap Siswa',
    'Kelas',
    'Nomor Absen',
    'Username',
    'Mata Pelajaran',
    'Skor',
    'Jumlah Benar',
    'Jumlah Salah',
    'Total Soal',
    'Persentase (%)',
    'Status',
    'Waktu Selesai',
  ];

  const subject = state.settings?.subject || DEFAULT_SETTINGS.subject;
  const csvEscape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

  const lines = [
    headers.map(csvEscape).join(','),
    ...rowsData.map((r) =>
      [
        r.nomorUrut,
        r.nama,
        r.nisn,
        r.absen || '-',
        r.username || '-',
        subject,
        r.score,
        r.correctCount,
        r.wrongCount,
        r.totalQuestions,
        `${r.percentage}%`,
        r.status,
        formatDateTimeID(r.completedAt),
      ]
        .map(csvEscape)
        .join(',')
    ),
  ];

  const bom = '\uFEFF';
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const dateTag = new Date().toISOString().slice(0, 10);
  const classTag =
    state.adminResultClassFilter && state.adminResultClassFilter !== 'ALL'
      ? `_${getSelectedResultClassLabel(state.adminResultClassFilter).replace(/[^a-zA-Z0-9-]+/g, '_')}`
      : '';
  triggerFileDownload(blob, `Hasil_Penilaian_CBT_ONLINE${classTag}_${dateTag}.csv`);
  showToast(
    `Berhasil mengekspor ${rowsData.length} data hasil (${getSelectedResultClassLabel()}) ke CSV.`,
    'success'
  );
}

function exportResultsToExcel() {
  const rowsData = getFilteredAdminResults();
  if (rowsData.length === 0) {
    showToast('Belum ada data hasil penilaian sesuai filter untuk diekspor.', 'error');
    return;
  }

  const subject = state.settings?.subject || DEFAULT_SETTINGS.subject;
  const mainTopic = state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;
  const classScopeLabel = getSelectedResultClassLabel();
  const avgScore = (rowsData.reduce((s, r) => s + Number(r.score), 0) / rowsData.length).toFixed(2);
  const passCount = rowsData.filter((r) => r.score >= PASSING_GRADE).length;

  const tableRowsHtml = rowsData
    .map(
      (r) => `
      <tr>
        <td style="text-align:center;">${r.nomorUrut}</td>
        <td>${escapeHtml(r.nama)}</td>
        <td style="text-align:center; mso-number-format:'\\@';">${escapeHtml(r.nisn)}</td>
        <td style="text-align:center;">${escapeHtml(r.absen || '-')}</td>
        <td>${escapeHtml(r.username || '-')}</td>
        <td style="text-align:center; font-weight:bold;">${r.score}</td>
        <td style="text-align:center;">${r.correctCount}</td>
        <td style="text-align:center;">${r.wrongCount}</td>
        <td style="text-align:center;">${r.totalQuestions}</td>
        <td style="text-align:center;">${r.percentage}%</td>
        <td style="text-align:center; font-weight:bold; color:${r.score >= PASSING_GRADE ? '#047857' : '#b91c1c'};">${escapeHtml(r.status)}</td>
        <td>${escapeHtml(formatDateTimeID(r.completedAt))}</td>
      </tr>
    `
    )
    .join('');

  const excelHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
          .title { font-size: 14pt; font-weight: bold; color: #1d4ed8; }
          .meta { font-size: 10pt; color: #334155; }
          table.report { border-collapse: collapse; width: 100%; margin-top: 10px; }
          table.report th {
            background-color: #1d4ed8;
            color: #ffffff;
            font-weight: bold;
            border: 1px solid #cbd5e1;
            padding: 8px 10px;
            text-align: center;
          }
          table.report td {
            border: 1px solid #cbd5e1;
            padding: 6px 10px;
          }
          .summary-row td {
            background-color: #eff6ff;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <table>
          <tr><td colspan="12" class="title">CBT ONLINE - LAPORAN HASIL PENILAIAN SISWA</td></tr>
          <tr><td colspan="12" class="meta">Mata Pelajaran: ${escapeHtml(subject)} | Materi: ${escapeHtml(mainTopic)} | Filter: ${escapeHtml(classScopeLabel)}</td></tr>
          <tr><td colspan="12" class="meta">Tanggal Ekspor: ${escapeHtml(formatDateTimeID(new Date().toISOString()))} | Total Peserta: ${rowsData.length} | Lulus (≥75): ${passCount} | Rata-rata Nilai: ${avgScore}</td></tr>
        </table>
        <table class="report">
          <thead>
            <tr>
              <th>No. Urut</th>
              <th>Nama Lengkap Siswa</th>
              <th>Kelas</th>
              <th>Nomor Absen</th>
              <th>Username</th>
              <th>Skor</th>
              <th>Benar</th>
              <th>Salah</th>
              <th>Total Soal</th>
              <th>Persentase</th>
              <th>Status</th>
              <th>Waktu Selesai</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
            <tr class="summary-row">
              <td colspan="5" style="text-align:right;">Rata-rata Nilai / Total Lulus:</td>
              <td style="text-align:center;">${avgScore}</td>
              <td colspan="4" style="text-align:center;">Lulus: ${passCount} dari ${rowsData.length} Peserta</td>
              <td colspan="2"></td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  `;

  const blob = new Blob(['\uFEFF' + excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const dateTag = new Date().toISOString().slice(0, 10);
  const classTag =
    state.adminResultClassFilter && state.adminResultClassFilter !== 'ALL'
      ? `_${getSelectedResultClassLabel(state.adminResultClassFilter).replace(/[^a-zA-Z0-9-]+/g, '_')}`
      : '';
  triggerFileDownload(blob, `Hasil_Penilaian_CBT_ONLINE${classTag}_${dateTag}.xls`);
  showToast(
    `Berhasil mengekspor ${rowsData.length} data hasil (${classScopeLabel}) ke Excel (.xls).`,
    'success'
  );
}

function renderAdminResultsTable() {
  if (!state.adminUnlocked || !state.adminToken) {
    const storedResults = readStorage(STORAGE_KEYS.RESULTS, null);
    if (Array.isArray(storedResults) && storedResults.length > (state.results || []).length) {
      state.results = storedResults;
    }
  }

  renderAdminResultsClassFilterDropdown();
  const filtered = getFilteredAdminResults();

  // KPIs scoped to active filter (per kelas / semua kelas)
  const total = filtered.length;
  const avg = total > 0 ? (filtered.reduce((sum, r) => sum + Number(r.score), 0) / total).toFixed(1) : '0';
  const passCount = filtered.filter((r) => r.score >= PASSING_GRADE).length;
  const passRate = total > 0 ? `${Math.round((passCount / total) * 100)}%` : '0%';

  document.getElementById('kpi-total-peserta').textContent = String(total);
  document.getElementById('kpi-avg-score').textContent = String(avg);
  document.getElementById('kpi-pass-count').textContent = String(passCount);
  document.getElementById('kpi-pass-rate').textContent = passRate;

  const tbody = document.getElementById('admin-results-tbody');
  if (filtered.length === 0) {
    const hasAnyResults = (state.results || []).length > 0;
    const isClassFiltered = state.adminResultClassFilter && state.adminResultClassFilter !== 'ALL';
    const emptyMessage = isClassFiltered
      ? `Belum ada siswa dari ${escapeHtml(getSelectedResultClassLabel())} yang menyelesaikan ujian.`
      : hasAnyResults
        ? 'Tidak ada hasil penilaian siswa yang cocok dengan pencarian Anda.'
        : 'Belum ada data hasil ujian siswa. Data otomatis muncul setelah siswa menyelesaikan tes.';
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="empty-state">
          ${emptyMessage}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = [...filtered]
    .reverse()
    .map(
      (r) => `
    <tr>
      <td class="mono-text">#${r.nomorUrut}</td>
      <td><strong>${escapeHtml(r.nama)}</strong></td>
      <td class="mono-text">${escapeHtml(r.nisn)}</td>
      <td class="mono-text">${escapeHtml(r.absen || '-')}</td>
      <td class="mono-text"><strong>${r.score}</strong></td>
      <td class="mono-text">${r.correctCount}</td>
      <td class="mono-text">${r.wrongCount}</td>
      <td class="mono-text">${r.percentage}%</td>
      <td>
        <span class="${r.score >= PASSING_GRADE ? 'status-text-pass' : 'status-text-fail'}">
          ${r.score >= PASSING_GRADE ? 'Lulus (≥75)' : 'Belum Lulus (<75)'}
        </span>
      </td>
      <td>
        <button type="button" class="btn btn-outline btn-sm" data-view-result="${r.id}">
          Lihat Halaman Hasil
        </button>
      </td>
    </tr>
  `
    )
    .join('');

  tbody.querySelectorAll('[data-view-result]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = state.results.find((r) => r.id === btn.dataset.viewResult);
      if (target) {
        state.activeResult = target;
        state.resultOpenedFromAdmin = true;
        state.resultFilter = 'all';
        switchView('result');
      }
    });
  });
}

function getDraftSelectedQuestionIdSet() {
  if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
  if (state.draftStudentQuestionConfig.mode === 'all') {
    return new Set(state.questions.map((q) => q.id));
  }
  if (state.draftStudentQuestionConfig.mode === 'preset50') {
    return new Set(getDefaultStudentQuestionIds());
  }
  return new Set(state.draftStudentQuestionConfig.selectedIds || []);
}

function isStudentQuestionConfigDirty() {
  if (!state.studentQuestionConfig || !state.draftStudentQuestionConfig) return false;
  if (state.studentQuestionConfig.mode !== state.draftStudentQuestionConfig.mode) return true;
  if (state.studentQuestionConfig.orderMode !== state.draftStudentQuestionConfig.orderMode) return true;
  if (state.draftStudentQuestionConfig.mode === 'custom') {
    const savedSet = new Set(state.studentQuestionConfig.selectedIds || []);
    const draftSet = new Set(state.draftStudentQuestionConfig.selectedIds || []);
    if (savedSet.size !== draftSet.size) return true;
    for (const id of savedSet) {
      if (!draftSet.has(id)) return true;
    }
  }
  return false;
}

function updateStudentQuestionDirtyState() {
  const dirty = isStudentQuestionConfigDirty();
  const badge = document.getElementById('student-q-dirty-badge');
  const cancelBtn = document.getElementById('btn-cancel-student-q');
  if (badge) {
    badge.textContent = dirty ? 'Perubahan belum disimpan' : 'Tersimpan';
    badge.classList.toggle('is-dirty', dirty);
    badge.classList.toggle('is-saved', !dirty);
  }
  if (cancelBtn) {
    cancelBtn.classList.toggle('hidden', !dirty);
  }
}

function renderStudentQuestionMenu() {
  if (!state.studentQuestionConfig) loadStudentQuestionConfig();
  const draft = state.draftStudentQuestionConfig;
  const activeSet = getDraftSelectedQuestionIdSet();

  const countEl = document.getElementById('admin-student-q-count');
  const totalEl = document.getElementById('admin-student-q-total');
  const allCountEl = document.getElementById('student-q-all-count');
  if (countEl) countEl.textContent = String(activeSet.size);
  if (totalEl) totalEl.textContent = String(state.questions.length);
  if (allCountEl) allCountEl.textContent = String(state.questions.length);

  document.querySelectorAll('input[name="student-q-mode"]').forEach((radio) => {
    radio.checked = radio.value === draft.mode;
  });

  const orderSel = document.getElementById('student-q-order-mode');
  if (orderSel) orderSel.value = draft.orderMode || 'shuffle';

  const randomInput = document.getElementById('student-q-random-count');
  if (randomInput) {
    randomInput.max = String(Math.max(1, state.questions.length));
    if (!randomInput.value) {
      randomInput.value = String(Math.min(DEFAULT_STUDENT_QUESTION_COUNT, state.questions.length));
    }
  }

  updateStudentQuestionDirtyState();
}

function handleRandomPickStudentQuestions() {
  const input = document.getElementById('student-q-random-count');
  const count = Number(input?.value);
  const maxTotal = state.questions.length;
  if (!Number.isInteger(count) || count < 1 || count > maxTotal) {
    showToast(`Masukkan jumlah soal acak antara 1 sampai ${maxTotal}.`, 'error');
    return;
  }
  const picked = shuffleArray(state.questions.map((q) => q.id)).slice(0, count);
  state.draftStudentQuestionConfig.mode = 'custom';
  state.draftStudentQuestionConfig.selectedIds = picked;
  renderStudentQuestionMenu();
  renderAdminQuestionList();
  showToast(`${count} soal dipilih acak dalam draf. Klik Simpan Perubahan untuk menerapkan.`, 'default');
}

function handleCancelStudentQuestionsConfig() {
  if (!state.studentQuestionConfig) loadStudentQuestionConfig();
  state.draftStudentQuestionConfig = {
    mode: state.studentQuestionConfig.mode,
    selectedIds: [...(state.studentQuestionConfig.selectedIds || [])],
    orderMode: state.studentQuestionConfig.orderMode || 'shuffle',
  };
  renderStudentQuestionMenu();
  renderAdminQuestionList();
  showToast('Perubahan soal siswa yang belum disimpan dibatalkan.', 'default');
}

function handleSaveStudentQuestionsConfig() {
  if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
  const validIds = new Set(state.questions.map((q) => q.id));
  const cleanedIds = (state.draftStudentQuestionConfig.selectedIds || []).filter((id) => validIds.has(id));
  const mode = state.draftStudentQuestionConfig.mode;

  if (mode === 'custom' && cleanedIds.length === 0) {
    showToast('Pilih minimal 1 soal yang akan dikerjakan oleh siswa sebelum menyimpan.', 'error');
    return;
  }

  let finalIds = cleanedIds;
  if (mode === 'all') {
    finalIds = state.questions.map((q) => q.id);
  } else if (mode === 'preset50') {
    finalIds = getDefaultStudentQuestionIds();
  }

  state.studentQuestionConfig = {
    mode,
    selectedIds: finalIds,
    orderMode: state.draftStudentQuestionConfig.orderMode === 'ordered' ? 'ordered' : 'shuffle',
    version: 2,
    userCustomized: true,
    updatedAt: new Date().toISOString(),
  };

  writeStorage(STORAGE_KEYS.STUDENT_QUESTIONS, state.studentQuestionConfig);
  state.draftStudentQuestionConfig = {
    mode: state.studentQuestionConfig.mode,
    selectedIds: [...state.studentQuestionConfig.selectedIds],
    orderMode: state.studentQuestionConfig.orderMode,
  };

  // Clear unfinished draft session so new question set takes effect cleanly
  if (state.session) {
    removeStorage(STORAGE_KEYS.SESSION);
    state.session = null;
  }

  renderStudentQuestionMenu();
  renderAdminQuestionList();
  updateGlobalMetaCounts();
  updateTopbar();
  pushAdminConfigToServer({ studentQuestionConfig: state.studentQuestionConfig });

  const activeCount = getActiveStudentQuestions().length;
  showToast(`Perubahan soal untuk siswa berhasil disimpan (${activeCount} soal aktif).`, 'success');
}

function resetStudentQuestionConfigToDefault() {
  const defaultIds = getDefaultStudentQuestionIds();
  state.studentQuestionConfig = {
    mode: 'preset50',
    selectedIds: defaultIds,
    orderMode: state.studentQuestionConfig?.orderMode || 'shuffle',
    version: 2,
    userCustomized: false,
    updatedAt: new Date().toISOString(),
  };
  state.draftStudentQuestionConfig = {
    mode: 'preset50',
    selectedIds: [...defaultIds],
    orderMode: state.studentQuestionConfig.orderMode,
  };
  writeStorage(STORAGE_KEYS.STUDENT_QUESTIONS, state.studentQuestionConfig);
}

function getFilteredAdminQuestions() {
  const search = (document.getElementById('admin-q-search').value || '').trim().toLowerCase();
  const typeFilter = document.getElementById('admin-q-filter-type').value;
  const topicFilter = document.getElementById('admin-q-filter-topic').value;
  const statusFilter = document.getElementById('admin-q-filter-student-status')?.value || 'all';
  const activeSet = getDraftSelectedQuestionIdSet();

  const list = state.questions.filter((q) => {
    const matchSearch = !search || q.question.toLowerCase().includes(search) || q.id.toLowerCase().includes(search);
    const matchType = typeFilter === 'all' || q.type === typeFilter;
    const matchTopic = topicFilter === 'all' || q.topic === topicFilter;
    const isSelected = activeSet.has(q.id);
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && isSelected) ||
      (statusFilter === 'excluded' && !isSelected);
    return matchSearch && matchType && matchTopic && matchStatus;
  });

  return {
    list,
    meta: {
      search,
      type: typeFilter,
      topic: topicFilter,
    },
  };
}

function getAvailableTopics(extraTopic = '') {
  const seen = new Set();
  const list = [];
  const addTopic = (t) => {
    const cleaned = String(t || '').trim();
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      list.push(cleaned);
    }
  };

  (state.settings?.syllabusItems || []).forEach(addTopic);
  (state.questions || []).forEach((q) => addTopic(q.topic));
  if (extraTopic) addTopic(extraTopic);
  if (list.length === 0) TOPICS.forEach(addTopic);
  return list;
}

function syncTopicSelectElements(extraTopic = '') {
  const available = getAvailableTopics(extraTopic);

  const filterSel = document.getElementById('admin-q-filter-topic');
  if (filterSel) {
    const prevVal = filterSel.value || 'all';
    filterSel.innerHTML = [
      '<option value="all">Semua Materi</option>',
      ...available.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`),
    ].join('');
    filterSel.value = prevVal === 'all' || available.includes(prevVal) ? prevVal : 'all';
  }

  const editSel = document.getElementById('edit-q-topic');
  if (editSel) {
    const prevEditVal = editSel.value;
    editSel.innerHTML = available
      .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
      .join('');
    if (prevEditVal && available.includes(prevEditVal)) {
      editSel.value = prevEditVal;
    }
  }
}

function renderAdminQuestionList() {
  document.getElementById('admin-q-count').textContent = String(state.questions.length);
  syncTopicSelectElements();
  renderStudentQuestionMenu();

  const { list: filtered } = getFilteredAdminQuestions();
  const activeSet = getDraftSelectedQuestionIdSet();

  const listEl = document.getElementById('admin-question-list');
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Tidak ada soal yang sesuai dengan filter pencarian.</div>';
    return;
  }

  listEl.innerHTML = filtered
    .map((q, index) => {
      const isSelected = activeSet.has(q.id);
      return `
    <div class="admin-q-item${isSelected ? '' : ' is-excluded'}">
      <div class="admin-q-content">
        <div class="admin-q-meta">
          <span class="mono-text"><strong>${escapeHtml(q.id)}</strong></span>
          <span>·</span>
          <span>No. ${index + 1}</span>
          <span>·</span>
          <span>${escapeHtml(TYPE_LABELS[q.type] || q.type)}</span>
          <span>·</span>
          <span>${escapeHtml(q.topic)}</span>
          ${isSelected ? '' : '<span class="q-excluded-tag">Tidak Diujikan</span>'}
        </div>
        <p class="admin-q-text">${escapeHtml(q.question)}</p>
        <div class="admin-q-answer">
          Kunci Jawaban: <span class="mono-text">${escapeHtml(formatCorrectAnswerWithDetail(q))}</span>
        </div>
      </div>
      <div class="admin-q-actions">
        <label class="q-student-toggle">
          <input type="checkbox" data-toggle-student-q="${escapeHtml(q.id)}" ${isSelected ? 'checked' : ''} />
          <span>Dikerjakan Siswa</span>
        </label>
        <button type="button" class="btn btn-outline btn-sm" data-edit-q="${escapeHtml(q.id)}">Edit Soal / Kunci</button>
        <button type="button" class="btn btn-outline btn-sm btn-danger-outline" data-delete-q="${escapeHtml(q.id)}">Hapus</button>
      </div>
    </div>
  `;
    })
    .join('');

  listEl.querySelectorAll('[data-toggle-student-q]').forEach((checkbox) => {
    checkbox.addEventListener('change', (e) => {
      const qId = e.target.dataset.toggleStudentQ;
      if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();

      if (state.draftStudentQuestionConfig.mode === 'all') {
        state.draftStudentQuestionConfig.mode = 'custom';
        state.draftStudentQuestionConfig.selectedIds = state.questions.map((q) => q.id);
      } else if (state.draftStudentQuestionConfig.mode === 'preset50') {
        state.draftStudentQuestionConfig.mode = 'custom';
        state.draftStudentQuestionConfig.selectedIds = getDefaultStudentQuestionIds();
      }

      const idSet = new Set(state.draftStudentQuestionConfig.selectedIds || []);
      if (e.target.checked) {
        idSet.add(qId);
      } else {
        idSet.delete(qId);
      }
      state.draftStudentQuestionConfig.selectedIds = Array.from(idSet);
      renderStudentQuestionMenu();
      renderAdminQuestionList();
    });
  });

  listEl.querySelectorAll('[data-edit-q]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = state.questions.find((item) => item.id === btn.dataset.editQ);
      if (q) openQuestionEditorModal(q);
    });
  });

  listEl.querySelectorAll('[data-delete-q]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const qId = btn.dataset.deleteQ;
      openConfirmModal(
        'Hapus Butir Soal?',
        `Soal dengan ID ${qId} akan dihapus permanen dari bank soal.`,
        () => {
          state.questions = state.questions.filter((item) => item.id !== qId);
          writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);
          if (state.studentQuestionConfig?.mode === 'custom') {
            state.studentQuestionConfig.selectedIds = state.studentQuestionConfig.selectedIds.filter((id) => id !== qId);
            writeStorage(STORAGE_KEYS.STUDENT_QUESTIONS, state.studentQuestionConfig);
          }
          if (state.draftStudentQuestionConfig?.mode === 'custom') {
            state.draftStudentQuestionConfig.selectedIds = state.draftStudentQuestionConfig.selectedIds.filter((id) => id !== qId);
          }
          updateGlobalMetaCounts();
          renderAdminQuestionList();
          pushAdminConfigToServer({
            questions: state.questions,
            studentQuestionConfig: state.studentQuestionConfig,
          });
          showToast(`Soal ${qId} berhasil dihapus.`, 'success');
        }
      );
    });
  });
}

function shuffleQuestionOptions(question) {
  if (!question || !question.options || (question.type !== 'pg' && question.type !== 'pg_kompleks')) {
    return { ...question };
  }

  const keys = Object.keys(question.options);
  if (keys.length <= 1) {
    return { ...question };
  }

  const correctKey = String(question.answer || '').trim();
  const correctKeys = Array.isArray(question.answer)
    ? question.answer.map((k) => String(k).trim())
    : [];

  const entries = keys.map((k) => ({
    text: question.options[k],
    isCorrect: question.type === 'pg' ? k === correctKey : correctKeys.includes(k),
  }));

  const shuffledEntries = shuffleArray(entries);
  const newOptions = {};
  const newCorrectKeys = [];

  keys.forEach((k, idx) => {
    newOptions[k] = shuffledEntries[idx].text;
    if (shuffledEntries[idx].isCorrect) {
      newCorrectKeys.push(k);
    }
  });

  return {
    ...question,
    options: newOptions,
    answer:
      question.type === 'pg'
        ? newCorrectKeys[0] || question.answer
        : newCorrectKeys,
  };
}

function promptShuffleQuestionBank() {
  if (!state.questions || state.questions.length === 0) {
    showToast('Bank soal masih kosong.', 'error');
    return;
  }

  openConfirmModal(
    'Acak Soal & Pilihan Jawaban?',
    `Urutan seluruh ${state.questions.length} butir soal serta posisi opsi jawaban (A–E) pada Pilihan Ganda dan PG Kompleks akan diacak. Kunci jawaban otomatis disesuaikan agar tetap akurat.`,
    () => {
      shuffleQuestionBankOrderAndOptions();
    }
  );
}

function shuffleQuestionBankOrderAndOptions() {
  const shuffledQuestions = shuffleArray(state.questions).map((q) => shuffleQuestionOptions(q));
  state.questions = shuffledQuestions;
  writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);

  // Clear any unfinished draft session so old option letters do not mismatch newly shuffled options
  if (state.session) {
    removeStorage(STORAGE_KEYS.SESSION);
    state.session = null;
  }

  updateGlobalMetaCounts();
  renderAdminQuestionList();
  updateTopbar();
  pushAdminConfigToServer({ questions: state.questions });
  showToast(
    `Berhasil mengacak ${state.questions.length} soal beserta pilihan jawabannya (kunci jawaban otomatis disesuaikan).`,
    'success'
  );
}

function openQuestionEditorModal(question) {
  const errEl = document.getElementById('question-editor-error');
  errEl.classList.add('hidden');
  const quickBar = document.getElementById('pg-quick-template-bar');
  const availableTopics = getAvailableTopics(question?.topic || '');
  syncTopicSelectElements(question?.topic || '');

  if (question) {
    document.getElementById('modal-q-title').textContent = `Edit Soal & Kunci (${question.id})`;
    document.getElementById('edit-q-id').value = question.id;
    document.getElementById('edit-q-type').value = question.type;
    document.getElementById('edit-q-topic').value = question.topic || availableTopics[0] || TOPICS[0];
    document.getElementById('edit-q-text').value = question.question;
    document.getElementById('edit-q-explanation').value = question.explanation || '';
    quickBar.classList.add('hidden');
    renderDynamicQuestionEditor(question.type, question);
  } else {
    document.getElementById('modal-q-title').textContent = 'Tambah Soal Baru';
    document.getElementById('edit-q-id').value = '';
    document.getElementById('edit-q-type').value = 'pg';
    document.getElementById('edit-q-topic').value = availableTopics[0] || TOPICS[0];
    document.getElementById('edit-q-text').value = '';
    document.getElementById('edit-q-explanation').value = '';
    quickBar.classList.remove('hidden');
    renderDynamicQuestionEditor('pg', null);
  }

  const pedBox = document.getElementById('q-modal-pedoman-box');
  const pedSub = document.getElementById('q-modal-pedoman-subject');
  const pedTxt = document.getElementById('q-modal-pedoman-text');
  const pedLnk = document.getElementById('q-modal-pedoman-link');
  if (pedBox && pedSub && pedTxt) {
    const hasPedoman = Boolean((state.settings?.pedomanPenulisan || '').trim());
    const safeUrl = sanitizeHttpHref(state.settings?.activeMaterialUrl || '');
    if (hasPedoman || safeUrl) {
      pedSub.textContent = `${state.settings?.subject || '-'} — ${state.settings?.mainTopic || '-'}`;
      pedTxt.textContent = state.settings?.pedomanPenulisan || 'Gunakan tautan sumber pedoman aktif sebagai rujukan penulisan soal.';
      if (pedLnk) {
        if (safeUrl) {
          pedLnk.href = safeUrl;
          pedLnk.classList.remove('hidden');
        } else {
          pedLnk.classList.add('hidden');
        }
      }
      pedBox.classList.remove('hidden');
    } else {
      pedBox.classList.add('hidden');
    }
  }

  openModal('modal-question-form');
}

function applyQuickPgTemplate() {
  const topic = document.getElementById('edit-q-topic').value || TOPICS[0];
  document.getElementById('edit-q-type').value = 'pg';
  document.getElementById('edit-q-text').value = `Berdasarkan konsep materi ${topic}, pernyataan berikut yang paling tepat adalah ...`;
  document.getElementById('edit-q-explanation').value = `Penjelasan singkat mengenai konsep ${topic}.`;

  renderDynamicQuestionEditor('pg', {
    type: 'pg',
    options: {
      A: 'Pilihan jawaban A (ubah sesuai materi)',
      B: 'Pilihan jawaban B (contoh kunci jawaban benar)',
      C: 'Pilihan jawaban C (pengecoh)',
      D: 'Pilihan jawaban D (pengecoh)',
      E: 'Pilihan jawaban E (pengecoh)',
    },
    answer: 'B',
  });
  showToast('Template Pilihan Ganda diisikan ke formulir.', 'success');
}

/* ==================== TEMPLATE SOAL PILIHAN GANDA (CSV & JSON) ==================== */
function openPgTemplateModal() {
  state.pendingImportedQuestions = [];
  document.getElementById('pg-template-file-input').value = '';
  document.getElementById('pg-import-preview').classList.add('hidden');
  document.getElementById('pg-import-preview').innerHTML = '';
  document.getElementById('pg-import-error').classList.add('hidden');
  document.getElementById('btn-import-pg-template').disabled = true;
  openModal('modal-pg-template');
}

function downloadPgCsvTemplate() {
  const headers = [
    'Materi',
    'Pertanyaan',
    'Opsi_A',
    'Opsi_B',
    'Opsi_C',
    'Opsi_D',
    'Opsi_E',
    'Kunci_Jawaban',
    'Pembahasan',
  ];
  const sampleRows = [
    [
      'Apa Itu Informatika?',
      'Ilmu yang mempelajari perancangan dan pembuatan sistem komputasi disebut ...',
      'Matematika Terapan',
      'Informatika',
      'Elektronika',
      'Statistika',
      'Teknik Sipil',
      'B',
      'Informatika mempelajari studi, perancangan, dan prinsip dasar sistem komputasi.',
    ],
    [
      'Pencarian (Searching)',
      'Algoritma pencarian yang mengharuskan data sudah terurut adalah ...',
      'Linear Search',
      'Sequential Search',
      'Binary Search',
      'Bubble Sort',
      'Stack Push',
      'C',
      'Binary Search bekerja dengan membagi dua rentang data yang sudah terurut.',
    ],
  ];

  const csvEscape = (cell) => `"${String(cell || '').replace(/"/g, '""')}"`;
  const lines = [headers.map(csvEscape).join(','), ...sampleRows.map((row) => row.map(csvEscape).join(','))];
  const bom = '\uFEFF';
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  triggerFileDownload(blob, 'Template_Soal_PG_CBT.csv');
  showToast('Template CSV Pilihan Ganda berhasil diunduh.', 'success');
}

function downloadPgJsonTemplate() {
  const templateData = [
    {
      id: 'PG_TEMPLATE_01',
      type: 'pg',
      topic: 'Apa Itu Informatika?',
      question: 'Tuliskan pertanyaan pilihan ganda di sini ...',
      options: {
        A: 'Pilihan jawaban A',
        B: 'Pilihan jawaban B',
        C: 'Pilihan jawaban C',
        D: 'Pilihan jawaban D',
        E: 'Pilihan jawaban E',
      },
      answer: 'B',
      explanation: 'Pembahasan singkat mengapa B benar.',
    },
    {
      id: 'PG_TEMPLATE_02',
      type: 'pg',
      topic: 'BERPIKIR KOMPUTASIONAL',
      question: 'Memecah masalah besar menjadi bagian kecil yang mudah dikelola disebut ...',
      options: {
        A: 'Abstraksi',
        B: 'Pengenalan Pola',
        C: 'Dekomposisi',
        D: 'Algoritma',
        E: 'Iterasi',
      },
      answer: 'C',
      explanation: 'Dekomposisi membagi masalah kompleks menjadi sub-masalah kecil.',
    },
  ];
  const blob = new Blob([JSON.stringify(templateData, null, 2)], {
    type: 'application/json;charset=utf-8;',
  });
  triggerFileDownload(blob, 'Template_Soal_PG_CBT.json');
  showToast('Template JSON Pilihan Ganda berhasil diunduh.', 'success');
}

function triggerFileDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseCsvLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parsePgCsvContent(text) {
  const cleanText = text.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    throw new Error('File CSV harus memiliki baris header dan minimal 1 baris soal.');
  }

  // Auto-detect delimiter (comma or semicolon from Indonesian Excel)
  const headerLine = lines[0];
  const delimiter = headerLine.split(';').length > headerLine.split(',').length ? ';' : ',';
  const parsedRows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], delimiter);
    if (cols.length < 8) continue;

    const [topicRaw, questionText, optA, optB, optC, optD, optE, keyRaw, explanation] = cols;
    const answer = String(keyRaw || '').trim().toUpperCase();
    if (!questionText || !optA || !optB || !optC || !optD || !optE) continue;
    if (!['A', 'B', 'C', 'D', 'E'].includes(answer)) continue;

    parsedRows.push({
      id: `QPG-${Date.now().toString().slice(-4)}-${i}`,
      type: 'pg',
      topic: TOPICS.includes(topicRaw) ? topicRaw : topicRaw || TOPICS[0],
      question: questionText,
      options: { A: optA, B: optB, C: optC, D: optD, E: optE },
      answer,
      explanation: explanation || '',
    });
  }

  return parsedRows;
}

function parsePgJsonContent(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new Error('Format JSON harus berupa array soal [ { ... } ].');
  }

  const validItems = [];
  data.forEach((item, idx) => {
    const type = item.type || 'pg';
    if (type !== 'pg') return;
    const opts = item.options || {};
    const ans = String(item.answer || '').trim().toUpperCase();
    if (!item.question || !opts.A || !opts.B || !opts.C || !opts.D || !opts.E) return;
    if (!['A', 'B', 'C', 'D', 'E'].includes(ans)) return;

    validItems.push({
      id: item.id || `QPG-${Date.now().toString().slice(-4)}-${idx + 1}`,
      type: 'pg',
      topic: item.topic || TOPICS[0],
      question: String(item.question).trim(),
      options: {
        A: String(opts.A).trim(),
        B: String(opts.B).trim(),
        C: String(opts.C).trim(),
        D: String(opts.D).trim(),
        E: String(opts.E).trim(),
      },
      answer: ans,
      explanation: String(item.explanation || '').trim(),
    });
  });

  return validItems;
}

async function handlePgTemplateFileSelect(e) {
  const file = e.target.files?.[0];
  const previewEl = document.getElementById('pg-import-preview');
  const errEl = document.getElementById('pg-import-error');
  const importBtn = document.getElementById('btn-import-pg-template');

  state.pendingImportedQuestions = [];
  importBtn.disabled = true;
  previewEl.classList.add('hidden');
  errEl.classList.add('hidden');

  if (!file) return;

  try {
    const content = await file.text();
    const isJson = file.name.toLowerCase().endsWith('.json');
    const parsed = isJson ? parsePgJsonContent(content) : parsePgCsvContent(content);

    if (parsed.length === 0) {
      throw new Error('Tidak ditemukan soal Pilihan Ganda yang valid (pastikan Opsi A–E terisi dan Kunci Jawaban A/B/C/D/E).');
    }

    state.pendingImportedQuestions = parsed;
    previewEl.innerHTML = `
      Terdeteksi <strong>${parsed.length} butir soal Pilihan Ganda</strong> valid dari file <strong>${escapeHtml(file.name)}</strong>. Klik "Impor ke Bank Soal" untuk menyimpan.
    `;
    previewEl.classList.remove('hidden');
    importBtn.disabled = false;
  } catch (err) {
    errEl.textContent = err.message || 'Gagal membaca file template.';
    errEl.classList.remove('hidden');
  }
}

function handleImportPgTemplate() {
  if (state.pendingImportedQuestions.length === 0) return;
  const mode = document.querySelector('input[name="pg-import-mode"]:checked')?.value || 'append';
  const imported = state.pendingImportedQuestions;

  if (mode === 'replace') {
    state.questions = imported;
  } else {
    // Ensure unique IDs when appending
    const existingIds = new Set(state.questions.map((q) => q.id));
    const uniqueImported = imported.map((q, idx) => {
      let id = q.id;
      if (existingIds.has(id)) {
        id = `Q${String(state.questions.length + idx + 1).padStart(3, '0')}-${Date.now().toString().slice(-3)}`;
      }
      existingIds.add(id);
      return { ...q, id };
    });
    state.questions = [...state.questions, ...uniqueImported];
  }

  writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);
  if (mode === 'replace') {
    resetStudentQuestionConfigToDefault();
  }
  updateGlobalMetaCounts();
  renderAdminQuestionList();
  closeModal('modal-pg-template');
  pushAdminConfigToServer({
    questions: state.questions,
    studentQuestionConfig: state.studentQuestionConfig,
  });
  showToast(`${imported.length} soal Pilihan Ganda berhasil diimpor.`, 'success');
}

/* ==================== EXPORT & IMPORT BANK SOAL UJIAN (ALL TYPES) ==================== */
function openBankExportImportModal() {
  state.pendingBankImport = { questions: [], settings: null };
  document.getElementById('bank-export-filtered-only').checked = false;
  document.getElementById('bank-import-file-input').value = '';
  document.getElementById('bank-import-preview').classList.add('hidden');
  document.getElementById('bank-import-preview').innerHTML = '';
  document.getElementById('bank-import-error').classList.add('hidden');
  document.getElementById('bank-import-settings-wrap').classList.add('hidden');
  document.getElementById('btn-confirm-bank-import').disabled = true;

  const counts = { pg: 0, pg_kompleks: 0, isian: 0, benar_salah: 0 };
  state.questions.forEach((q) => {
    if (counts[q.type] !== undefined) counts[q.type]++;
  });

  document.getElementById('bank-export-summary').textContent =
    `Total aktif saat ini: ${state.questions.length} soal (${counts.pg} PG, ${counts.pg_kompleks} PG Kompleks, ${counts.isian} Isian Singkat, ${counts.benar_salah} Benar/Salah).`;

  openModal('modal-bank-export-import');
}

function getQuestionsForBankExport() {
  const useFiltered = document.getElementById('bank-export-filtered-only')?.checked;
  if (useFiltered) {
    return getFilteredAdminQuestions().list;
  }
  return state.questions || [];
}

function exportQuestionBankJson() {
  const list = getQuestionsForBankExport();
  if (list.length === 0) {
    showToast('Tidak ada soal untuk diekspor.', 'error');
    return;
  }

  const payload = {
    app: 'CBT ONLINE',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings || DEFAULT_SETTINGS,
    questions: list,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8;',
  });
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerFileDownload(blob, `Bank_Soal_CBT_ONLINE_${dateTag}.json`);
  showToast(`Berhasil mengexport ${list.length} soal ke arsip JSON.`, 'success');
}

function exportQuestionBankCsv() {
  const list = getQuestionsForBankExport();
  if (list.length === 0) {
    showToast('Tidak ada soal untuk diekspor.', 'error');
    return;
  }

  const headers = [
    'ID',
    'Jenis_Soal',
    'Materi',
    'Pertanyaan',
    'Opsi_A',
    'Opsi_B',
    'Opsi_C',
    'Opsi_D',
    'Opsi_E',
    'Kunci_Jawaban',
    'Pembahasan',
  ];

  const csvEscape = (cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`;

  const rows = list.map((q) => {
    const opts = q.options || {};
    const ansStr = q.type === 'pg_kompleks' && Array.isArray(q.answer) ? q.answer.join(';') : String(q.answer ?? '');
    return [
      q.id || '',
      q.type || 'pg',
      q.topic || TOPICS[0],
      q.question || '',
      opts.A || '',
      opts.B || '',
      opts.C || '',
      opts.D || '',
      opts.E || '',
      ansStr,
      q.explanation || '',
    ]
      .map(csvEscape)
      .join(',');
  });

  const bom = '\uFEFF';
  const blob = new Blob([bom + [headers.map(csvEscape).join(','), ...rows].join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerFileDownload(blob, `Bank_Soal_CBT_ONLINE_${dateTag}.csv`);
  showToast(`Berhasil mengexport ${list.length} soal ke arsip CSV.`, 'success');
}

function normalizeImportedQuestion(item, idx) {
  if (!item || typeof item !== 'object') return null;
  const type = String(item.type || 'pg').trim().toLowerCase();
  const questionText = String(item.question || '').trim();
  const topic = String(item.topic || TOPICS[0]).trim() || TOPICS[0];
  const explanation = String(item.explanation || '').trim();
  const fallbackId = `QIMP-${Date.now().toString().slice(-4)}-${idx + 1}`;
  const id = String(item.id || fallbackId).trim() || fallbackId;

  if (!questionText) return null;

  if (type === 'pg') {
    const opts = item.options || {};
    const ans = String(item.answer || '').trim().toUpperCase();
    if (!opts.A || !opts.B || !opts.C || !opts.D || !opts.E) return null;
    if (!['A', 'B', 'C', 'D', 'E'].includes(ans)) return null;
    return {
      id,
      type: 'pg',
      topic,
      question: questionText,
      options: {
        A: String(opts.A).trim(),
        B: String(opts.B).trim(),
        C: String(opts.C).trim(),
        D: String(opts.D).trim(),
        E: String(opts.E).trim(),
      },
      answer: ans,
      explanation,
    };
  }

  if (type === 'pg_kompleks') {
    const opts = item.options || {};
    if (!opts.A || !opts.B || !opts.C || !opts.D || !opts.E) return null;
    const rawAns = Array.isArray(item.answer)
      ? item.answer
      : String(item.answer || '')
          .split(/[,;|\s]+/)
          .filter(Boolean);
    const validKeys = Array.from(
      new Set(
        rawAns
          .map((k) => String(k).trim().toUpperCase())
          .filter((k) => ['A', 'B', 'C', 'D', 'E'].includes(k))
      )
    ).sort();
    if (validKeys.length === 0) return null;

    return {
      id,
      type: 'pg_kompleks',
      topic,
      question: questionText,
      options: {
        A: String(opts.A).trim(),
        B: String(opts.B).trim(),
        C: String(opts.C).trim(),
        D: String(opts.D).trim(),
        E: String(opts.E).trim(),
      },
      answer: validKeys,
      explanation,
    };
  }

  if (type === 'isian') {
    const ans = String(item.answer ?? '').trim();
    if (ans === '' || Number.isNaN(Number(ans))) return null;
    return {
      id,
      type: 'isian',
      topic,
      question: questionText,
      answer: ans,
      explanation,
    };
  }

  if (type === 'benar_salah') {
    const lower = String(item.answer || '').trim().toLowerCase();
    if (lower !== 'benar' && lower !== 'salah') return null;
    return {
      id,
      type: 'benar_salah',
      topic,
      question: questionText,
      answer: lower === 'benar' ? 'Benar' : 'Salah',
      explanation,
    };
  }

  return null;
}

function parseFullQuestionBankJson(text) {
  const parsed = JSON.parse(text);
  let rawQuestions = null;
  let importedSettings = null;

  if (Array.isArray(parsed)) {
    rawQuestions = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.questions)) {
    rawQuestions = parsed.questions;
    if (parsed.settings && typeof parsed.settings === 'object') {
      importedSettings = parsed.settings;
    }
  } else {
    throw new Error('Format JSON tidak dikenali. Gunakan file hasil Export Bank Soal (.json) atau array soal [ { ... } ].');
  }

  const validQuestions = rawQuestions.map((item, idx) => normalizeImportedQuestion(item, idx)).filter(Boolean);
  return { questions: validQuestions, settings: importedSettings };
}

function parseFullQuestionBankCsv(text) {
  const cleanText = text.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    throw new Error('File CSV harus memiliki baris header dan minimal 1 baris soal.');
  }

  const headerLine = lines[0];
  const delimiter = headerLine.split(';').length > headerLine.split(',').length ? ';' : ',';
  const headers = parseCsvLine(headerLine, delimiter).map((h) => h.toLowerCase());

  // Check if full export CSV (contains Jenis_Soal) vs legacy PG template CSV
  const hasTypeCol = headers.includes('jenis_soal');
  const validQuestions = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], delimiter);
    if (hasTypeCol) {
      if (cols.length < 10) continue;
      const [id, type, topic, question, optA, optB, optC, optD, optE, answer, explanation] = cols;
      const normalized = normalizeImportedQuestion(
        {
          id,
          type,
          topic,
          question,
          options: { A: optA, B: optB, C: optC, D: optD, E: optE },
          answer,
          explanation,
        },
        i
      );
      if (normalized) validQuestions.push(normalized);
    } else {
      if (cols.length < 8) continue;
      const [topic, question, optA, optB, optC, optD, optE, answer, explanation] = cols;
      const normalized = normalizeImportedQuestion(
        {
          type: 'pg',
          topic,
          question,
          options: { A: optA, B: optB, C: optC, D: optD, E: optE },
          answer,
          explanation,
        },
        i
      );
      if (normalized) validQuestions.push(normalized);
    }
  }

  return { questions: validQuestions, settings: null };
}

async function handleBankImportFileSelect(e) {
  const file = e.target.files?.[0];
  const previewEl = document.getElementById('bank-import-preview');
  const errEl = document.getElementById('bank-import-error');
  const settingsWrap = document.getElementById('bank-import-settings-wrap');
  const importBtn = document.getElementById('btn-confirm-bank-import');

  state.pendingBankImport = { questions: [], settings: null };
  importBtn.disabled = true;
  previewEl.classList.add('hidden');
  errEl.classList.add('hidden');
  settingsWrap.classList.add('hidden');

  if (!file) return;

  try {
    const content = await file.text();
    const isJson = file.name.toLowerCase().endsWith('.json');
    const result = isJson ? parseFullQuestionBankJson(content) : parseFullQuestionBankCsv(content);

    if (result.questions.length === 0) {
      throw new Error('Tidak ditemukan butir soal yang valid pada file ini.');
    }

    state.pendingBankImport = result;

    const counts = { pg: 0, pg_kompleks: 0, isian: 0, benar_salah: 0 };
    result.questions.forEach((q) => {
      if (counts[q.type] !== undefined) counts[q.type]++;
    });

    const settingsNote = result.settings
      ? ` · Termasuk pengaturan ujian (${escapeHtml(result.settings.subject || DEFAULT_SETTINGS.subject)})`
      : '';

    previewEl.innerHTML = `
      Terdeteksi <strong>${result.questions.length} butir soal valid</strong> dari <strong>${escapeHtml(file.name)}</strong>
      (${counts.pg} PG, ${counts.pg_kompleks} PG Kompleks, ${counts.isian} Isian, ${counts.benar_salah} Benar/Salah)${settingsNote}.
    `;
    previewEl.classList.remove('hidden');

    if (result.settings) {
      settingsWrap.classList.remove('hidden');
      document.getElementById('bank-import-apply-settings').checked = true;
    }

    importBtn.disabled = false;
  } catch (err) {
    errEl.textContent = err.message || 'Gagal membaca file bank soal.';
    errEl.classList.remove('hidden');
  }
}

function handleConfirmBankImport() {
  const { questions: imported, settings: importedSettings } = state.pendingBankImport;
  if (!imported || imported.length === 0) return;

  const mode = document.querySelector('input[name="bank-import-mode"]:checked')?.value || 'replace';

  if (mode === 'replace') {
    state.questions = imported;
  } else {
    const existingIds = new Set(state.questions.map((q) => q.id));
    const uniqueImported = imported.map((q, idx) => {
      let id = q.id;
      if (existingIds.has(id)) {
        id = `Q${String(state.questions.length + idx + 1).padStart(3, '0')}-${Date.now().toString().slice(-3)}`;
      }
      existingIds.add(id);
      return { ...q, id };
    });
    state.questions = [...state.questions, ...uniqueImported];
  }

  writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);
  if (mode === 'replace') {
    resetStudentQuestionConfigToDefault();
  }

  // Clear unfinished active draft session to avoid stale question IDs
  if (state.session) {
    removeStorage(STORAGE_KEYS.SESSION);
    state.session = null;
  }

  const shouldApplySettings =
    importedSettings &&
    document.getElementById('bank-import-apply-settings')?.checked;

  if (shouldApplySettings) {
    state.settings = {
      subject: importedSettings.subject || state.settings?.subject || DEFAULT_SETTINGS.subject,
      mainTopic: importedSettings.mainTopic || state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic,
      heroSubtitle:
        typeof importedSettings.heroSubtitle === 'string'
          ? importedSettings.heroSubtitle
          : state.settings?.heroSubtitle || DEFAULT_SETTINGS.heroSubtitle,
      durationMinutes:
        Number(importedSettings.durationMinutes) > 0
          ? Number(importedSettings.durationMinutes)
          : state.settings?.durationMinutes || DEFAULT_SETTINGS.durationMinutes,
      syllabusItems:
        Array.isArray(importedSettings.syllabusItems) && importedSettings.syllabusItems.length > 0
          ? importedSettings.syllabusItems
          : state.settings?.syllabusItems || [...DEFAULT_SETTINGS.syllabusItems],
    };
    writeStorage(STORAGE_KEYS.SETTINGS, state.settings);
    renderAdminSyllabusPanel();
    applySettingsToUI();
  }

  updateGlobalMetaCounts();
  renderAdminQuestionList();
  updateTopbar();
  closeModal('modal-bank-export-import');
  pushAdminConfigToServer({
    questions: state.questions,
    studentQuestionConfig: state.studentQuestionConfig,
    ...(shouldApplySettings ? { settings: state.settings } : {}),
  });
  showToast(
    `${imported.length} soal ujian berhasil diimpor (${mode === 'replace' ? 'menggantikan bank soal lama' : 'ditambahkan ke bank soal'}).`,
    'success'
  );
}

function renderDynamicQuestionEditor(type, existingQuestion) {
  const container = document.getElementById('edit-q-dynamic-area');
  const opts = existingQuestion?.options || { A: '', B: '', C: '', D: '', E: '' };
  const ans = existingQuestion?.answer;

  if (type === 'pg' || type === 'pg_kompleks') {
    const isMulti = type === 'pg_kompleks';
    const selectedKeys = isMulti ? (Array.isArray(ans) ? ans : []) : [ans || 'A'];

    container.innerHTML = `
      <span class="form-label">${
        isMulti
          ? 'Pilihan Jawaban (A–E) & Centang Kunci Jawaban Benar (>1)'
          : 'Pilihan Jawaban (A–E) & Pilih Satu Kunci Jawaban'
      }</span>
      ${['A', 'B', 'C', 'D', 'E']
        .map(
          (key) => `
        <div class="editor-option-row">
          <span class="editor-key-badge">${key}</span>
          <input
            type="text"
            class="form-input input-compact"
            id="editor-opt-${key}"
            placeholder="Isi pilihan ${key}..."
            value="${escapeHtml(opts[key] || '')}"
            required
          />
          <label class="editor-key-pick">
            <input
              type="${isMulti ? 'checkbox' : 'radio'}"
              name="editor-key-choice"
              value="${key}"
              ${selectedKeys.includes(key) ? 'checked' : ''}
            />
            <span>Kunci</span>
          </label>
        </div>
      `
        )
        .join('')}
    `;
  } else if (type === 'isian') {
    container.innerHTML = `
      <div class="form-group">
        <label for="editor-isian-key" class="form-label">Kunci Jawaban (Berupa Angka)</label>
        <input
          type="number"
          step="any"
          id="editor-isian-key"
          class="form-input mono-input"
          placeholder="Contoh: 25"
          value="${existingQuestion && existingQuestion.type === 'isian' ? escapeHtml(String(ans || '')) : ''}"
          required
        />
      </div>
    `;
  } else if (type === 'benar_salah') {
    const currentKey = existingQuestion && existingQuestion.type === 'benar_salah' ? ans : 'Benar';
    container.innerHTML = `
      <div class="form-group">
        <span class="form-label">Kunci Jawaban Benar / Salah</span>
        <div class="tf-grid">
          <label class="editor-key-pick">
            <input type="radio" name="editor-tf-key" value="Benar" ${currentKey === 'Benar' ? 'checked' : ''} />
            <span>Benar</span>
          </label>
          <label class="editor-key-pick">
            <input type="radio" name="editor-tf-key" value="Salah" ${currentKey === 'Salah' ? 'checked' : ''} />
            <span>Salah</span>
          </label>
        </div>
      </div>
    `;
  }
}

function handleSaveQuestion(e) {
  e.preventDefault();
  const id = document.getElementById('edit-q-id').value.trim();
  const type = document.getElementById('edit-q-type').value;
  const topic = document.getElementById('edit-q-topic').value;
  const questionText = document.getElementById('edit-q-text').value.trim();
  const explanation = document.getElementById('edit-q-explanation').value.trim();
  const errEl = document.getElementById('question-editor-error');

  if (!questionText) {
    errEl.textContent = 'Teks pertanyaan tidak boleh kosong.';
    errEl.classList.remove('hidden');
    return;
  }

  let options = undefined;
  let answer = null;

  if (type === 'pg' || type === 'pg_kompleks') {
    options = {};
    for (const key of ['A', 'B', 'C', 'D', 'E']) {
      const val = document.getElementById(`editor-opt-${key}`).value.trim();
      if (!val) {
        errEl.textContent = `Opsi pilihan ${key} wajib diisi.`;
        errEl.classList.remove('hidden');
        return;
      }
      options[key] = val;
    }

    const checkedInputs = Array.from(document.querySelectorAll('input[name="editor-key-choice"]:checked'));
    if (checkedInputs.length === 0) {
      errEl.textContent = 'Pilih minimal satu kunci jawaban yang benar.';
      errEl.classList.remove('hidden');
      return;
    }

    answer = type === 'pg' ? checkedInputs[0].value : checkedInputs.map((el) => el.value).sort();
  } else if (type === 'isian') {
    const numVal = document.getElementById('editor-isian-key').value.trim();
    if (numVal === '' || Number.isNaN(Number(numVal))) {
      errEl.textContent = 'Kunci jawaban isian singkat wajib berupa angka.';
      errEl.classList.remove('hidden');
      return;
    }
    answer = numVal;
  } else if (type === 'benar_salah') {
    const tfChecked = document.querySelector('input[name="editor-tf-key"]:checked');
    answer = tfChecked ? tfChecked.value : 'Benar';
  }

  errEl.classList.add('hidden');

  if (id) {
    const idx = state.questions.findIndex((q) => q.id === id);
    if (idx !== -1) {
      state.questions[idx] = {
        id,
        type,
        topic,
        question: questionText,
        ...(options ? { options } : {}),
        answer,
        explanation,
      };
    }
    showToast(`Soal ${id} berhasil diperbarui.`, 'success');
  } else {
    const nextNum = state.questions.length + 1;
    const newId = `Q${String(nextNum).padStart(3, '0')}-${Date.now().toString().slice(-3)}`;
    state.questions.push({
      id: newId,
      type,
      topic,
      question: questionText,
      ...(options ? { options } : {}),
      answer,
      explanation,
    });
    if (state.studentQuestionConfig?.mode === 'custom') {
      state.studentQuestionConfig.selectedIds.push(newId);
      writeStorage(STORAGE_KEYS.STUDENT_QUESTIONS, state.studentQuestionConfig);
    }
    if (state.draftStudentQuestionConfig?.mode === 'custom') {
      state.draftStudentQuestionConfig.selectedIds.push(newId);
    }
    showToast(`Soal baru ${newId} berhasil ditambahkan.`, 'success');
  }

  writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);
  updateGlobalMetaCounts();
  closeModal('modal-question-form');
  renderAdminQuestionList();
  pushAdminConfigToServer({
    questions: state.questions,
    studentQuestionConfig: state.studentQuestionConfig,
  });
}

/* ==================== MENU GENERATE AI SESUAI CAKUPAN MATERI ==================== */
function renderAiGeneratorPanel() {
  if (!state.settings) loadExamSettings();
  const panel = document.getElementById('ai-generate-menu-panel');
  if (panel) panel.classList.toggle('hidden', !state.aiGenMenuOpen);

  const subjectEl = document.getElementById('ai-ctx-subject');
  const topicEl = document.getElementById('ai-ctx-topic');
  const countEl = document.getElementById('ai-ctx-syllabus-count');
  const listEl = document.getElementById('ai-ctx-syllabus-list');

  if (subjectEl) subjectEl.textContent = state.settings.subject;
  if (topicEl) topicEl.textContent = state.settings.mainTopic;
  if (countEl) countEl.textContent = String(state.settings.syllabusItems.length);
  if (listEl) {
    listEl.innerHTML = state.settings.syllabusItems
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');
  }

  const targetMode = document.getElementById('ai-gen-target-mode')?.value || 'bank100';
  const customBox = document.getElementById('ai-gen-custom-counts');
  if (customBox) customBox.classList.toggle('hidden', targetMode !== 'custom');

  const undoBtn = document.getElementById('btn-undo-ai-gen');
  if (undoBtn) {
    undoBtn.classList.toggle('hidden', !Array.isArray(state.previousQuestionsBeforeAi) || state.aiGenerating);
  }

  const statusNote = document.getElementById('ai-gen-status-note');
  if (statusNote) {
    statusNote.textContent = isSyllabusDirty()
      ? 'Catatan: Ada perubahan di Tab Cakupan Materi yang belum disimpan. Simpan terlebih dahulu agar digunakan AI.'
      : 'Menggunakan pengaturan Cakupan Materi terbaru yang tersimpan di Portal Admin.';
  }
}

function getAiGenerationTargetCounts() {
  const mode = document.getElementById('ai-gen-target-mode')?.value || 'bank100';
  if (mode === 'bank100') {
    return { pg: 70, pg_kompleks: 10, isian: 10, benar_salah: 10 };
  }
  if (mode === 'bank65') {
    return { pg: 50, pg_kompleks: 5, isian: 5, benar_salah: 5 };
  }
  if (mode === 'student50') {
    return { pg: 40, pg_kompleks: 4, isian: 3, benar_salah: 3 };
  }
  if (mode === 'pg50') {
    return { pg: 50, pg_kompleks: 0, isian: 0, benar_salah: 0 };
  }

  const pg = Math.max(0, Math.min(100, Number(document.getElementById('ai-count-pg')?.value || 0)));
  const pg_kompleks = Math.max(0, Math.min(25, Number(document.getElementById('ai-count-pgk')?.value || 0)));
  const isian = Math.max(0, Math.min(25, Number(document.getElementById('ai-count-isian')?.value || 0)));
  const benar_salah = Math.max(0, Math.min(25, Number(document.getElementById('ai-count-bs')?.value || 0)));
  return { pg, pg_kompleks, isian, benar_salah };
}

function buildAiGenerationBatches(counts) {
  const MAX_PER_BATCH = 17;
  const queue = [];
  (['pg', 'pg_kompleks', 'isian', 'benar_salah']).forEach((type) => {
    const count = Math.floor(Number(counts[type] || 0));
    if (count > 0) queue.push({ type, remaining: count });
  });

  const batches = [];
  let currentSpecs = [];
  let currentTotal = 0;

  for (const item of queue) {
    let rem = item.remaining;
    while (rem > 0) {
      const space = MAX_PER_BATCH - currentTotal;
      if (space <= 0) {
        batches.push(currentSpecs);
        currentSpecs = [];
        currentTotal = 0;
        continue;
      }
      const take = Math.min(rem, space);
      currentSpecs.push({ type: item.type, count: take });
      currentTotal += take;
      rem -= take;

      if (currentTotal >= MAX_PER_BATCH) {
        batches.push(currentSpecs);
        currentSpecs = [];
        currentTotal = 0;
      }
    }
  }

  if (currentSpecs.length > 0) {
    batches.push(currentSpecs);
  }
  return batches;
}

function promptGenerateAiQuestions() {
  if (state.aiGenerating) return;
  if (!state.settings) loadExamSettings();

  const errEl = document.getElementById('ai-gen-error');
  if (errEl) errEl.classList.add('hidden');

  const counts = getAiGenerationTargetCounts();
  const totalCount = counts.pg + counts.pg_kompleks + counts.isian + counts.benar_salah;

  if (!Number.isInteger(totalCount) || totalCount < 1 || totalCount > 100) {
    if (errEl) {
      errEl.textContent = 'Total jumlah soal yang digenerate harus antara 1 sampai 100 butir.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  if (!state.settings.subject || !state.settings.mainTopic || state.settings.syllabusItems.length === 0) {
    if (errEl) {
      errEl.textContent = 'Mata Pelajaran, Materi Pokok, dan Cakupan Materi wajib terisi di Tab Cakupan Materi.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  openConfirmModal(
    'Generate & Ubah Bank Soal dengan AI?',
    `AI akan menyusun ${totalCount} butir soal baru (${counts.pg} PG, ${counts.pg_kompleks} PG Kompleks, ${counts.isian} Isian, ${counts.benar_salah} Benar/Salah) sesuai Mata Pelajaran "${state.settings.subject}" dan Cakupan Materi aktif, lalu menggantikan isi Bank Soal saat ini.`,
    () => {
      executeAiQuestionGeneration(counts, totalCount);
    }
  );
}

function setAiGeneratingUiState(isRunning, progressPct = 0, progressLabel = '') {
  state.aiGenerating = isRunning;
  const runBtn = document.getElementById('btn-run-ai-generate');
  const cancelBtn = document.getElementById('btn-cancel-ai-gen');
  const undoBtn = document.getElementById('btn-undo-ai-gen');
  const progressBox = document.getElementById('ai-gen-progress-box');
  const progressFill = document.getElementById('ai-gen-progress-fill');
  const progressText = document.getElementById('ai-gen-progress-text');
  const progressPctEl = document.getElementById('ai-gen-progress-pct');

  if (runBtn) {
    runBtn.disabled = isRunning;
    runBtn.textContent = isRunning ? 'Sedang Menggenerate Soal...' : 'Generate & Ubah Soal AI';
  }
  if (cancelBtn) cancelBtn.classList.toggle('hidden', !isRunning);
  if (undoBtn) {
    undoBtn.classList.toggle('hidden', isRunning || !Array.isArray(state.previousQuestionsBeforeAi));
  }
  if (progressBox) progressBox.classList.toggle('hidden', !isRunning);
  if (progressFill) progressFill.style.width = `${Math.min(100, Math.max(0, progressPct))}%`;
  if (progressText && progressLabel) progressText.textContent = progressLabel;
  if (progressPctEl) progressPctEl.textContent = `${Math.round(progressPct)}%`;
}

function cancelAiQuestionGeneration() {
  if (state.aiAbortController) {
    state.aiAbortController.abort();
    state.aiAbortController = null;
  }
}

async function executeAiQuestionGeneration(counts, totalCount) {
  const errEl = document.getElementById('ai-gen-error');
  if (errEl) errEl.classList.add('hidden');

  const difficulty = document.getElementById('ai-gen-difficulty')?.value || 'standar';
  const customInstruction = (document.getElementById('ai-gen-custom-instruction')?.value || '').trim();
  const batches = buildAiGenerationBatches(counts);
  const abortController = new AbortController();
  state.aiAbortController = abortController;

  const collected = [];
  setAiGeneratingUiState(true, 4, `Menyiapkan ${batches.length} tahap generate AI (${totalCount} soal)...`);

  try {
    for (let i = 0; i < batches.length; i++) {
      const batchSpecs = batches[i];
      const batchSize = batchSpecs.reduce((sum, s) => sum + s.count, 0);
      const startPct = Math.round((i / batches.length) * 90) + 5;
      setAiGeneratingUiState(
        true,
        startPct,
        `Menghasilkan tahap ${i + 1} dari ${batches.length} (${collected.length + 1}–${Math.min(totalCount, collected.length + batchSize)} dari ${totalCount} soal)...`
      );

      const response = await fetch('/api/ai/generate-questions', {
        method: 'POST',
        headers: getAdminRequestHeaders({ 'Content-Type': 'application/json' }),
        signal: abortController.signal,
        body: JSON.stringify({
          subject: state.settings.subject,
          mainTopic: state.settings.mainTopic,
          syllabusItems: state.settings.syllabusItems,
          pedomanPenulisan: state.settings.pedomanPenulisan || '',
          batchSpecs,
          difficulty,
          customInstruction,
          batchIndex: i + 1,
          totalBatches: batches.length,
          avoidSummaries: collected.map((q) => q.question.slice(0, 100)).slice(-45),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        state.aiAbortController = null;
        setAiGeneratingUiState(false, 0, '');
        handleAdminUnauthorized(data.error);
        return;
      }
      if (!response.ok) {
        throw new Error(data.error || `Gagal memproses tahap ${i + 1} (HTTP ${response.status}).`);
      }
      if (!Array.isArray(data.questions) || data.questions.length === 0) {
        throw new Error(`AI tidak mengembalikan soal valid pada tahap ${i + 1}.`);
      }

      data.questions.forEach((q) => collected.push(q));
    }

    const finalQuestions = collected.map((q, idx) => ({
      id: `Q${String(idx + 1).padStart(3, '0')}`,
      type: q.type,
      topic: q.topic,
      question: q.question,
      ...(q.options ? { options: q.options } : {}),
      answer: q.answer,
      explanation: q.explanation || '',
    }));

    state.previousQuestionsBeforeAi = [...state.questions];
    state.questions = finalQuestions;
    writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);

    resetStudentQuestionConfigToDefault();
    if (state.session) {
      removeStorage(STORAGE_KEYS.SESSION);
      state.session = null;
    }

    setAiGeneratingUiState(false, 100, 'Selesai!');
    state.aiAbortController = null;

    syncTopicSelectElements();
    updateGlobalMetaCounts();
    renderStudentQuestionMenu();
    renderAdminQuestionList();
    renderAiGeneratorPanel();
    updateTopbar();
    pushAdminConfigToServer({
      questions: state.questions,
      studentQuestionConfig: state.studentQuestionConfig,
    });

    const activeCount = getActiveStudentQuestions().length;
    showToast(
      `Berhasil menggenerate ${finalQuestions.length} soal AI sesuai Cakupan Materi "${state.settings.subject}" (${activeCount} soal aktif untuk siswa).`,
      'success'
    );
  } catch (err) {
    state.aiAbortController = null;
    setAiGeneratingUiState(false, 0, '');
    if (err && err.name === 'AbortError') {
      showToast('Proses generate soal AI dihentikan. Bank soal sebelumnya tetap aman.', 'default');
      return;
    }
    const msg = err instanceof Error ? err.message : 'Terjadi kesalahan saat menggenerate soal AI.';
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
    showToast(msg, 'error');
  }
}

function undoAiQuestionGeneration() {
  if (!Array.isArray(state.previousQuestionsBeforeAi) || state.previousQuestionsBeforeAi.length === 0) {
    return;
  }
  openConfirmModal(
    'Kembalikan Soal Sebelum Generate AI?',
    `Bank soal akan dikembalikan ke ${state.previousQuestionsBeforeAi.length} soal sebelumnya.`,
    () => {
      state.questions = [...state.previousQuestionsBeforeAi];
      state.previousQuestionsBeforeAi = null;
      writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);
      resetStudentQuestionConfigToDefault();
      if (state.session) {
        removeStorage(STORAGE_KEYS.SESSION);
        state.session = null;
      }
      syncTopicSelectElements();
      updateGlobalMetaCounts();
      renderStudentQuestionMenu();
      renderAdminQuestionList();
      renderAiGeneratorPanel();
      updateTopbar();
      pushAdminConfigToServer({
        questions: state.questions,
        studentQuestionConfig: state.studentQuestionConfig,
      });
      showToast('Bank soal berhasil dikembalikan ke kondisi sebelum generate AI.', 'success');
    }
  );
}

function generateCryptoRandomAdminPin(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const values = new Uint32Array(length);
  if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
    window.crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < length; i++) {
      values[i] = Math.floor(Math.random() * 0xffffffff);
    }
  }
  let code = '';
  for (let i = 0; i < length; i++) {
    code += alphabet[values[i] % alphabet.length];
  }
  return code;
}

async function copyTextToClipboard(text, successMessage = 'Teks berhasil disalin.') {
  const value = String(text || '');
  if (!value) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(value);
      showToast(successMessage, 'success');
      return true;
    }
  } catch {
    // Fallback ke textarea copy
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) {
      showToast(successMessage, 'success');
      return true;
    }
  } catch {
    // Ignore
  }
  showToast('Gagal menyalin otomatis. Silakan salin secara manual.', 'error');
  return false;
}

/* ==================== UI HELPERS (MODALS, TOAST, FORMAT) ==================== */
function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('hidden');
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add('hidden');
  if (modalId === 'modal-admin-auth') {
    const pinInput = document.getElementById('input-admin-pin');
    const confirmInput = document.getElementById('input-admin-pin-confirm');
    const toggleBtn = document.getElementById('btn-toggle-admin-pin-visibility');
    if (pinInput) {
      pinInput.value = '';
      pinInput.type = 'password';
    }
    if (confirmInput) {
      confirmInput.value = '';
      confirmInput.type = 'password';
    }
    if (toggleBtn) toggleBtn.textContent = 'Lihat';
  }
  if (modalId === 'modal-admin-pin-manage') {
    const newPin = document.getElementById('input-new-admin-pin');
    const confirmPin = document.getElementById('input-new-admin-pin-confirm');
    const savedBox = document.getElementById('admin-pin-saved-box');
    const savedCode = document.getElementById('admin-pin-saved-code');
    const savedExitBtn = document.getElementById('btn-pin-saved-exit-admin');
    if (newPin) newPin.value = '';
    if (confirmPin) confirmPin.value = '';
    if (savedCode) savedCode.textContent = '--------';
    if (savedBox) savedBox.classList.add('hidden');
    if (savedExitBtn) savedExitBtn.classList.add('hidden');
  }
}

function openConfirmModal(title, message, onConfirm) {
  document.getElementById('modal-confirm-title').textContent = title;
  document.getElementById('modal-confirm-message').textContent = message;
  state.confirmCallback = onConfirm;
  openModal('modal-confirm');
}

function showToast(message, variant = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast${variant === 'success' ? ' is-success' : variant === 'error' ? ' is-error' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3200);
}

function formatDateTimeID(isoStr) {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(isoStr));
  } catch {
    return isoStr;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ==================== BOOTSTRAP ==================== */
document.addEventListener('DOMContentLoaded', initApp);
