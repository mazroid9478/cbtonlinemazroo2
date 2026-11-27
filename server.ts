import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type QuestionType = 'pg' | 'pg_kompleks' | 'isian' | 'benar_salah';
type DifficultyLevel = 'standar' | 'hots' | 'dasar';

interface BatchSpec {
  type: QuestionType;
  count: number;
}

interface RawAiQuestion {
  type?: string;
  topic?: string;
  question?: string;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
  optionE?: string;
  correctKey?: string;
  correctKeys?: string[];
  explanation?: string;
}

export interface NormalizedQuestion {
  type: QuestionType;
  topic: string;
  question: string;
  options?: {
    A: string;
    B: string;
    C: string;
    D: string;
    E: string;
  };
  answer: string | string[];
  explanation: string;
}

const ALLOWED_TYPES: ReadonlySet<string> = new Set(['pg', 'pg_kompleks', 'isian', 'benar_salah']);
const ALLOWED_DIFFICULTIES: ReadonlySet<string> = new Set(['standar', 'hots', 'dasar']);
const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E'] as const;

let cachedAiClient: GoogleGenAI | null = null;
let cachedApiKey: string | undefined;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  if (!cachedAiClient || cachedApiKey !== apiKey) {
    cachedAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedApiKey = apiKey;
  }
  return cachedAiClient;
}

function cleanText(val: unknown, maxLen: number): string {
  return String(val ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function pickTopicFromSyllabus(rawTopic: string, syllabusItems: string[], fallbackIdx: number): string {
  const cleaned = cleanText(rawTopic, 250);
  if (cleaned) {
    const exact = syllabusItems.find((s) => s.toLowerCase() === cleaned.toLowerCase());
    if (exact) return exact;
    const partial = syllabusItems.find(
      (s) => s.toLowerCase().includes(cleaned.toLowerCase()) || cleaned.toLowerCase().includes(s.toLowerCase())
    );
    if (partial) return partial;
  }
  return syllabusItems[fallbackIdx % syllabusItems.length];
}

function normalizeAiQuestion(
  raw: RawAiQuestion,
  expectedType: QuestionType | undefined,
  syllabusItems: string[],
  idx: number
): NormalizedQuestion | null {
  const rawType = cleanText(raw?.type, 30).toLowerCase();
  const type: QuestionType = ALLOWED_TYPES.has(rawType)
    ? (rawType as QuestionType)
    : expectedType || 'pg';

  const question = cleanText(raw?.question, 900);
  if (!question || question.length < 10) return null;

  const topic = pickTopicFromSyllabus(raw?.topic || '', syllabusItems, idx);
  const explanation = cleanText(raw?.explanation, 500) || `Pembahasan terkait materi ${topic}.`;

  if (type === 'pg') {
    const options = {
      A: cleanText(raw?.optionA, 350),
      B: cleanText(raw?.optionB, 350),
      C: cleanText(raw?.optionC, 350),
      D: cleanText(raw?.optionD, 350),
      E: cleanText(raw?.optionE, 350),
    };
    if (!options.A || !options.B || !options.C || !options.D || !options.E) return null;

    let answer = cleanText(raw?.correctKey, 10).toUpperCase();
    if (!['A', 'B', 'C', 'D', 'E'].includes(answer)) {
      const fromArr = Array.isArray(raw?.correctKeys) ? cleanText(raw.correctKeys[0], 10).toUpperCase() : '';
      answer = ['A', 'B', 'C', 'D', 'E'].includes(fromArr) ? fromArr : 'A';
    }

    return { type: 'pg', topic, question, options, answer, explanation };
  }

  if (type === 'pg_kompleks') {
    const options = {
      A: cleanText(raw?.optionA, 350),
      B: cleanText(raw?.optionB, 350),
      C: cleanText(raw?.optionC, 350),
      D: cleanText(raw?.optionD, 350),
      E: cleanText(raw?.optionE, 350),
    };
    if (!options.A || !options.B || !options.C || !options.D || !options.E) return null;

    const rawKeys = Array.isArray(raw?.correctKeys)
      ? raw.correctKeys
      : cleanText(raw?.correctKey, 30)
          .split(/[,;|\s]+/)
          .filter(Boolean);

    let keys = Array.from(
      new Set(
        rawKeys
          .map((k) => cleanText(k, 5).toUpperCase())
          .filter((k) => OPTION_KEYS.includes(k as (typeof OPTION_KEYS)[number]))
      )
    ).sort();

    if (keys.length < 2) {
      keys = keys.length === 1 && keys[0] !== 'A' ? ['A', keys[0]].sort() : ['A', 'B'];
    }

    const formattedQuestion = question.toLowerCase().includes('lebih dari satu')
      ? question
      : `${question} (Jawaban lebih dari satu)`;

    return { type: 'pg_kompleks', topic, question: formattedQuestion, options, answer: keys, explanation };
  }

  if (type === 'isian') {
    const keyStr = cleanText(raw?.correctKey, 40).replace(',', '.');
    const numericMatch = keyStr.match(/-?\d+(\.\d+)?/);
    if (!numericMatch) return null;
    const answer = numericMatch[0];
    const formattedQuestion = question.toLowerCase().includes('angka saja')
      ? question
      : `${question} (Tuliskan angka saja)`;

    return { type: 'isian', topic, question: formattedQuestion, answer, explanation };
  }

  if (type === 'benar_salah') {
    const lower = cleanText(raw?.correctKey, 20).toLowerCase();
    let answer: 'Benar' | 'Salah' = 'Benar';
    if (lower.includes('salah') || lower === 'false' || lower === 's') {
      answer = 'Salah';
    } else if (lower.includes('benar') || lower === 'true' || lower === 'b') {
      answer = 'Benar';
    } else {
      return null;
    }

    return { type: 'benar_salah', topic, question, answer, explanation };
  }

  return null;
}

function buildGenerationPrompt(params: {
  subject: string;
  mainTopic: string;
  syllabusItems: string[];
  batchSpecs: BatchSpec[];
  difficulty: DifficultyLevel;
  customInstruction: string;
  batchIndex: number;
  totalBatches: number;
  avoidSummaries: string[];
  pedomanPenulisan?: string;
}): string {
  const totalCount = params.batchSpecs.reduce((sum, s) => sum + s.count, 0);
  const specLines = params.batchSpecs
    .map((s) => {
      if (s.type === 'pg') {
        return `- ${s.count} soal bertipe "pg" (Pilihan Ganda 5 opsi A, B, C, D, E; 1 kunci jawaban paling tepat di correctKey; distribusikan kunci jawaban secara seimbang antara A, B, C, D, dan E).`;
      }
      if (s.type === 'pg_kompleks') {
        return `- ${s.count} soal bertipe "pg_kompleks" (Pilihan Ganda Kompleks 5 opsi A, B, C, D, E; 2 sampai 4 jawaban benar pada array correctKeys; akhiri pertanyaan dengan "(Jawaban lebih dari satu)").`;
      }
      if (s.type === 'isian') {
        return `- ${s.count} soal bertipe "isian" (Isian Singkat dengan jawaban PASTI BERUPA ANGKA TUNGGAL pada correctKey, misal "25" atau "120"; akhiri pertanyaan dengan "(Tuliskan angka saja)").`;
      }
      return `- ${s.count} soal bertipe "benar_salah" (Pernyataan deklaratif yang jelas benar atau salahnya; correctKey tepat "Benar" atau "Salah").`;
    })
    .join('\n');

  const difficultyGuide =
    params.difficulty === 'hots'
      ? 'Tingkat Kesulitan: HOTS (C4-C5) — utamakan studi kasus, analisis, penerapan konsep, dan penalaran logis.'
      : params.difficulty === 'dasar'
        ? 'Tingkat Kesulitan: Dasar (C1-C2) — fokus pada pemahaman definisi, konsep inti, dan identifikasi langsung.'
        : 'Tingkat Kesulitan: Standar Kurikulum Merdeka (Seimbang antara pemahaman konsep C1-C2 dan penerapan/analisis C3-C4).';

  const syllabusLines = params.syllabusItems.map((item, i) => `${i + 1}. ${item}`).join('\n');
  const pedomanBlock = params.pedomanPenulisan
    ? `\nPedoman Materi & Penulisan Soal (dari PDF/Sumber Referensi):\n${params.pedomanPenulisan}`
    : '';
  const avoidBlock =
    params.avoidSummaries.length > 0
      ? `\nHindari mengulang topik/kalimat pertanyaan yang mirip dengan daftar soal berikut:\n- ${params.avoidSummaries.join('\n- ')}`
      : '';

  const customBlock = params.customInstruction
    ? `\nInstruksi Tambahan Admin: ${params.customInstruction}`
    : '';

  return [
    `Anda adalah penyusun soal ujian resmi CBT dalam Bahasa Indonesia yang sangat teliti dan akurat.`,
    `Buat TEPAT ${totalCount} butir soal ujian baru (Batch ${params.batchIndex} dari ${params.totalBatches}) yang 100% sesuai dengan Cakupan Materi berikut:`,
    ``,
    `Mata Pelajaran: ${params.subject}`,
    `Materi Pokok: ${params.mainTopic}`,
    `Cakupan Materi (field "topic" WAJIB menggunakan salah satu teks persis dari daftar ini dan tersebar merata):`,
    syllabusLines,
    pedomanBlock,
    ``,
    difficultyGuide,
    customBlock,
    ``,
    `Komposisi soal yang WAJIB dihasilkan pada batch ini (total ${totalCount} soal, sesuai urutan):`,
    specLines,
    ``,
    `Aturan Ketat Format JSON:`,
    `1. Semua pertanyaan, pilihan jawaban, dan pembahasan ditulis dalam Bahasa Indonesia yang baku, jelas, dan tidak ambigu.`,
    `2. Setiap soal WAJIB memiliki pembahasan singkat (field "explanation") yang menjelaskan mengapa kunci jawabannya benar.`,
    `3. Untuk tipe "pg" dan "pg_kompleks", kelima opsi (optionA s.d. optionE) wajib diisi lengkap dan tidak boleh kosong atau sama persis.`,
    `4. Untuk tipe "isian", jawaban (correctKey) HARUS hanya angka (tanpa satuan atau kata tambahan).`,
    `5. Untuk tipe "benar_salah", jawaban (correctKey) HARUS tepat "Benar" atau "Salah".`,
    avoidBlock,
  ]
    .filter(Boolean)
    .join('\n');
}

async function generateBatchWithRetry(
  ai: GoogleGenAI,
  prompt: string,
  expectedCount: number,
  expectedTypes: QuestionType[],
  syllabusItems: string[],
  maxAttempts = 3
): Promise<NormalizedQuestion[]> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'Anda adalah generator soal ujian CBT profesional. Kembalikan hanya array JSON valid sesuai skema tanpa teks di luar JSON.',
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: {
                  type: Type.STRING,
                  description: 'Salah satu dari: pg, pg_kompleks, isian, benar_salah',
                },
                topic: {
                  type: Type.STRING,
                  description: 'Butir materi dari daftar Cakupan Materi',
                },
                question: {
                  type: Type.STRING,
                  description: 'Teks pertanyaan lengkap',
                },
                optionA: { type: Type.STRING },
                optionB: { type: Type.STRING },
                optionC: { type: Type.STRING },
                optionD: { type: Type.STRING },
                optionE: { type: Type.STRING },
                correctKey: {
                  type: Type.STRING,
                  description: 'Untuk pg: A/B/C/D/E; isian: angka saja; benar_salah: Benar atau Salah',
                },
                correctKeys: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Untuk pg_kompleks: array huruf kunci benar (A-E)',
                },
                explanation: {
                  type: Type.STRING,
                  description: 'Pembahasan singkat kunci jawaban',
                },
              },
              required: ['type', 'topic', 'question', 'explanation'],
            },
          },
        },
      });

      const rawText = (response.text ?? '[]').trim();
      const parsed = JSON.parse(rawText);
      if (!Array.isArray(parsed)) {
        throw new Error('Respons AI bukan array JSON.');
      }

      const normalized: NormalizedQuestion[] = [];
      for (let i = 0; i < parsed.length; i++) {
        const expectedType = expectedTypes[i] || expectedTypes[expectedTypes.length - 1] || 'pg';
        const item = normalizeAiQuestion(parsed[i], expectedType, syllabusItems, i);
        if (item) normalized.push(item);
      }

      if (normalized.length === 0) {
        throw new Error('AI tidak menghasilkan butir soal yang memenuhi format.');
      }

      return normalized.slice(0, expectedCount);
    } catch (err) {
      lastError = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      const isNonRetryable =
        errMsg.includes('API_KEY_INVALID') ||
        errMsg.includes('PERMISSION_DENIED') ||
        errMsg.includes('NOT_FOUND') ||
        errMsg.includes('403') ||
        errMsg.includes('404');

      if (isNonRetryable || attempt >= maxAttempts) {
        throw err;
      }

      await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Gagal menghasilkan soal AI.');
}

interface StoredQuestion {
  id: string;
  type: QuestionType;
  topic: string;
  question: string;
  options?: Record<string, string>;
  answer: string | string[];
  explanation: string;
}

interface ExamSettings {
  subject: string;
  mainTopic: string;
  heroSubtitle: string;
  durationMinutes: number;
  syllabusItems: string[];
  pedomanPenulisan?: string;
  activeMaterialId?: string | null;
  activeMaterialTitle?: string;
  activeMaterialUrl?: string;
}

type MaterialContentKind = 'materi' | 'soal' | 'campuran';

interface MaterialResource {
  id: string;
  title: string;
  sourceType: 'pdf' | 'url';
  contentKind: MaterialContentKind;
  fileName?: string;
  storedFileName?: string;
  fileSizeBytes?: number;
  targetUrl?: string;
  extractedSubject: string;
  extractedMainTopic: string;
  extractedSyllabusItems: string[];
  pedomanPenulisan: string;
  detectedQuestions: NormalizedQuestion[];
  aiExtracted: boolean;
  createdAt: string;
}

interface StudentQuestionConfig {
  mode: 'preset50' | 'all' | 'custom';
  selectedIds: string[];
  orderMode: 'shuffle' | 'ordered';
  version: number;
  userCustomized: boolean;
  updatedAt: string | null;
}

interface ClassTokenEntry {
  classKey: string;
  className: string;
  code: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UsedClassTokenRecord {
  classKey: string;
  code: string;
  usedAt: string;
}

type TokenMode = 'global' | 'per_class';

interface TokenConfig {
  tokenMode: TokenMode;
  classList: string[];
  code: string;
  required: boolean;
  showOnLogin: boolean;
  isActive: boolean;
  autoStopOnAllFinished: boolean;
  targetParticipants: number;
  requireNewTokenPerClass: boolean;
  boundClass: string | null;
  classTokens: Record<string, ClassTokenEntry>;
  usedClassTokenHistory: UsedClassTokenRecord[];
  stoppedAt: string | null;
  stoppedReason: string;
  updatedAt: string;
}

interface UsedIdentityRecord {
  nama: string;
  username: string;
  nisn: string;
  absen: string;
  registeredAt: number;
}

interface MonitoringRecord {
  nama: string;
  username: string;
  nisn: string;
  absen: string;
  status: 'Belum Mulai' | 'Sedang Mengerjakan' | 'Selesai';
  answeredCount: number;
  totalQuestions: number;
  percentage: number;
  currentNumber: number;
  flaggedCount: number;
  warningCount: number;
  terminatedByViolation?: boolean;
  loginResetAt?: number;
  startTime?: number;
  endTime?: number;
  completedAt?: string;
  lastActivityAt: number;
}

interface StudentSessionSnapshot {
  studentNama: string;
  studentUsername: string;
  studentNisn: string;
  studentAbsen: string;
  questionOrder: string[];
  answers: Record<string, unknown>;
  flagged: Record<string, boolean>;
  currentIndex: number;
  warningCount: number;
  violations: Array<Record<string, unknown>>;
  startTime: number;
  endTime: number;
  remainingMs: number;
  unlockedByAdmin?: boolean;
  unlockedAt?: number;
  savedAt: number;
}

interface ResultRecord {
  id: string;
  nomorUrut: number;
  nama: string;
  username: string;
  nisn: string;
  absen: string;
  subject: string;
  mainTopic: string;
  score: number;
  correctCount: number;
  wrongCount: number;
  totalQuestions: number;
  answeredCount: number;
  percentage: number;
  status: string;
  warningCount: number;
  autoSubmittedByViolation: boolean;
  completedAt: string;
  topicStats: Array<{ topic: string; correct: number; total: number }>;
  details: Array<Record<string, unknown>>;
}

interface CbtStore {
  adminPinHash: string | null;
  adminPinEpoch: number;
  resetEpoch: number;
  settings: ExamSettings;
  questions: StoredQuestion[];
  studentQuestionConfig: StudentQuestionConfig;
  tokenConfig: TokenConfig;
  usedIdentities: UsedIdentityRecord[];
  monitoring: MonitoringRecord[];
  results: ResultRecord[];
  savedSessions: StudentSessionSnapshot[];
  materialResources: MaterialResource[];
}

const DEFAULT_SETTINGS_DATA: ExamSettings = {
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

const STORE_FILE = path.join(__dirname, '.cbt-store.json');
const STORE_TMP_FILE = path.join(__dirname, '.cbt-store.json.tmp');
const QUESTIONS_JSON_FILE = path.join(__dirname, 'questions.json');
const SESSION_SIGNING_SECRET =
  (process.env.SESSION_SECRET || '').trim() || crypto.randomBytes(32).toString('hex');
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function generateTokenCode(length = 6): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function loadDefaultQuestionsFromDisk(): StoredQuestion[] {
  try {
    const raw = fs.readFileSync(QUESTIONS_JSON_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (err) {
    console.error('Gagal membaca questions.json default:', err);
  }
  return [];
}

const CLASS_PRESETS: Record<string, string[]> = {
  rombel_bl: [
    ...['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((l) => `X-${l}`),
    ...['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((l) => `XI-${l}`),
    ...['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((l) => `XII-${l}`),
  ],
  tingkat_only: ['X', 'XI', 'XII'],
  rombel_num: [
    ...Array.from({ length: 10 }, (_, i) => `X-${i + 1}`),
    ...Array.from({ length: 10 }, (_, i) => `XI-${i + 1}`),
    ...Array.from({ length: 10 }, (_, i) => `XII-${i + 1}`),
  ],
};

const DEFAULT_CLASS_LIST: string[] = [...CLASS_PRESETS.rombel_bl];

function populateMissingClassTokens(tc: TokenConfig, defaultActive = true): boolean {
  if (!tc.classTokens) {
    tc.classTokens = {};
  }
  if (!Array.isArray(tc.usedClassTokenHistory)) {
    tc.usedClassTokenHistory = [];
  }
  const usedCodes = new Set<string>([
    tc.code,
    ...Object.values(tc.classTokens).map((c) => c.code),
    ...tc.usedClassTokenHistory.map((h) => h.code),
  ]);
  const nowIso = new Date().toISOString();
  let changed = false;

  for (const rawCls of tc.classList || DEFAULT_CLASS_LIST) {
    const classKey = normalizeClassKeyVal(rawCls);
    if (!classKey || tc.classTokens[classKey]) continue;

    let nextCode = generateTokenCode(6);
    for (let i = 0; i < 60; i++) {
      const candidate = generateTokenCode(6);
      if (!usedCodes.has(candidate)) {
        nextCode = candidate;
        break;
      }
    }
    usedCodes.add(nextCode);

    tc.classTokens[classKey] = {
      classKey,
      className: classKey,
      code: nextCode,
      isActive: defaultActive,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const existsHistory = tc.usedClassTokenHistory.some(
      (h) => h.classKey === classKey && h.code === nextCode
    );
    if (!existsHistory) {
      tc.usedClassTokenHistory.push({
        classKey,
        code: nextCode,
        usedAt: nowIso,
      });
      if (tc.usedClassTokenHistory.length > 100) {
        tc.usedClassTokenHistory = tc.usedClassTokenHistory.slice(-100);
      }
    }
    changed = true;
  }

  return changed;
}

function createInitialStore(): CbtStore {
  const defaultQuestions = loadDefaultQuestionsFromDisk();
  const defaultSelected = defaultQuestions.slice(0, Math.min(50, defaultQuestions.length)).map((q) => q.id);
  const initialTokenConfig: TokenConfig = {
    tokenMode: 'per_class',
    classList: [...DEFAULT_CLASS_LIST],
    code: generateTokenCode(6),
    required: true,
    showOnLogin: true,
    isActive: true,
    autoStopOnAllFinished: false,
    targetParticipants: 0,
    requireNewTokenPerClass: true,
    boundClass: null,
    classTokens: {},
    usedClassTokenHistory: [],
    stoppedAt: null,
    stoppedReason: '',
    updatedAt: new Date().toISOString(),
  };
  populateMissingClassTokens(initialTokenConfig, true);

  return {
    adminPinHash: null,
    adminPinEpoch: 1,
    resetEpoch: 1,
    settings: {
      ...DEFAULT_SETTINGS_DATA,
      syllabusItems: [...DEFAULT_SETTINGS_DATA.syllabusItems],
    },
    questions: defaultQuestions,
    studentQuestionConfig: {
      mode: 'preset50',
      selectedIds: defaultSelected,
      orderMode: 'shuffle',
      version: 2,
      userCustomized: false,
      updatedAt: null,
    },
    tokenConfig: initialTokenConfig,
    usedIdentities: [],
    monitoring: [],
    results: [],
    savedSessions: [],
    materialResources: [],
  };
}

function normalizeClassKeyVal(val: unknown): string {
  return cleanText(val, 40)
    .toUpperCase()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function getClassGradeFromKey(classKey: string): 'X' | 'XI' | 'XII' | 'OTHER' {
  const norm = normalizeClassKeyVal(classKey);
  if (norm === 'XII' || norm.startsWith('XII-') || norm.startsWith('XII ')) return 'XII';
  if (norm === 'XI' || norm.startsWith('XI-') || norm.startsWith('XI ')) return 'XI';
  if (norm === 'X' || norm.startsWith('X-') || norm.startsWith('X ')) return 'X';
  return 'OTHER';
}

function sanitizeClassList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_CLASS_LIST];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const norm = normalizeClassKeyVal(item);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= 120) break;
  }
  return out.length > 0 ? out : [...DEFAULT_CLASS_LIST];
}

function sanitizeClassTokensRecord(raw: unknown): Record<string, ClassTokenEntry> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, ClassTokenEntry> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const item = v as Record<string, unknown>;
    const classKey = normalizeClassKeyVal(item.classKey || item.className || k);
    const code = cleanText(item.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!classKey || code.length < 4) continue;
    result[classKey] = {
      classKey,
      className: normalizeClassKeyVal(item.className || classKey) || classKey,
      code,
      isActive: item.isActive !== false,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    };
  }
  return result;
}

function sanitizeUsedClassTokenHistory(raw: unknown): UsedClassTokenRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: UsedClassTokenRecord[] = [];
  for (const item of raw.slice(-100)) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const classKey = normalizeClassKeyVal(obj.classKey);
    const code = cleanText(obj.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!classKey || code.length < 4) continue;
    out.push({
      classKey,
      code,
      usedAt: typeof obj.usedAt === 'string' ? obj.usedAt : new Date().toISOString(),
    });
  }
  return out;
}

function loadStoreFromDisk(): CbtStore {
  const fallback = createInitialStore();
  try {
    if (!fs.existsSync(STORE_FILE)) {
      fs.writeFileSync(STORE_FILE, JSON.stringify(fallback, null, 2), 'utf8');
      return fallback;
    }
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CbtStore>;
    const questions =
      Array.isArray(parsed.questions) && parsed.questions.length > 0 ? parsed.questions : fallback.questions;
    const parsedMonitoring = Array.isArray(parsed.monitoring) ? parsed.monitoring : [];
    const rawTc = parsed.tokenConfig && typeof parsed.tokenConfig === 'object'
      ? (parsed.tokenConfig as unknown as Record<string, unknown>)
      : null;

    const mainCode = rawTc
      ? cleanText(rawTc.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, '') || fallback.tokenConfig.code
      : fallback.tokenConfig.code;

    const parsedClassTokens = rawTc ? sanitizeClassTokensRecord(rawTc.classTokens) : {};
    const parsedHistory = rawTc ? sanitizeUsedClassTokenHistory(rawTc.usedClassTokenHistory) : [];

    let boundClass: string | null = null;
    let migratedFromMonitoring = false;
    if (rawTc && 'boundClass' in rawTc) {
      boundClass = rawTc.boundClass ? normalizeClassKeyVal(rawTc.boundClass) || null : null;
    } else if (parsedMonitoring.length > 0) {
      const latestClass = normalizeClassKeyVal(parsedMonitoring[parsedMonitoring.length - 1]?.nisn);
      if (latestClass) {
        boundClass = latestClass;
        migratedFromMonitoring = true;
        if (!parsedHistory.some((h) => h.classKey === latestClass && h.code === mainCode)) {
          parsedHistory.push({
            classKey: latestClass,
            code: mainCode,
            usedAt: new Date().toISOString(),
          });
        }
      }
    }

    const loaded: CbtStore = {
      adminPinHash: typeof parsed.adminPinHash === 'string' ? parsed.adminPinHash : null,
      adminPinEpoch:
        typeof (parsed as { adminPinEpoch?: unknown }).adminPinEpoch === 'number' &&
        Number((parsed as { adminPinEpoch?: unknown }).adminPinEpoch) >= 1
          ? Math.floor(Number((parsed as { adminPinEpoch?: unknown }).adminPinEpoch))
          : 1,
      resetEpoch: typeof parsed.resetEpoch === 'number' && parsed.resetEpoch >= 1 ? parsed.resetEpoch : 1,
      settings: parsed.settings && typeof parsed.settings === 'object' ? {
        subject: cleanText(parsed.settings.subject, 160) || fallback.settings.subject,
        mainTopic: cleanText(parsed.settings.mainTopic, 300) || fallback.settings.mainTopic,
        heroSubtitle: cleanText(parsed.settings.heroSubtitle, 300),
        durationMinutes:
          Number.isInteger(Number(parsed.settings.durationMinutes)) && Number(parsed.settings.durationMinutes) >= 1
            ? Math.min(600, Number(parsed.settings.durationMinutes))
            : fallback.settings.durationMinutes,
        syllabusItems:
          Array.isArray(parsed.settings.syllabusItems) && parsed.settings.syllabusItems.length > 0
            ? parsed.settings.syllabusItems.map((s) => cleanText(s, 250)).filter(Boolean)
            : [...fallback.settings.syllabusItems],
        pedomanPenulisan: cleanText(parsed.settings.pedomanPenulisan, 2500),
        activeMaterialId: cleanText(parsed.settings.activeMaterialId, 80) || null,
        activeMaterialTitle: cleanText(parsed.settings.activeMaterialTitle, 200),
        activeMaterialUrl: cleanText(parsed.settings.activeMaterialUrl, 600),
      } : fallback.settings,
      questions,
      studentQuestionConfig:
        parsed.studentQuestionConfig && typeof parsed.studentQuestionConfig === 'object'
          ? {
              mode:
                parsed.studentQuestionConfig.mode === 'all' || parsed.studentQuestionConfig.mode === 'custom'
                  ? parsed.studentQuestionConfig.mode
                  : 'preset50',
              selectedIds: Array.isArray(parsed.studentQuestionConfig.selectedIds)
                ? parsed.studentQuestionConfig.selectedIds.map((id) => cleanText(id, 60)).filter(Boolean)
                : fallback.studentQuestionConfig.selectedIds,
              orderMode: parsed.studentQuestionConfig.orderMode === 'ordered' ? 'ordered' : 'shuffle',
              version: 2,
              userCustomized: Boolean(parsed.studentQuestionConfig.userCustomized),
              updatedAt: parsed.studentQuestionConfig.updatedAt || null,
            }
          : fallback.studentQuestionConfig,
      tokenConfig: rawTc
        ? {
            tokenMode: rawTc.tokenMode === 'global' ? 'global' : 'per_class',
            classList: Array.isArray(rawTc.classList) ? sanitizeClassList(rawTc.classList) : [...DEFAULT_CLASS_LIST],
            code: mainCode,
            required: rawTc.required !== false,
            showOnLogin: rawTc.showOnLogin !== false,
            isActive: rawTc.isActive !== false,
            autoStopOnAllFinished: Boolean(rawTc.autoStopOnAllFinished),
            targetParticipants: Math.max(0, Math.min(2000, Number(rawTc.targetParticipants) || 0)),
            requireNewTokenPerClass: rawTc.requireNewTokenPerClass !== false,
            boundClass,
            classTokens: parsedClassTokens,
            usedClassTokenHistory: parsedHistory,
            stoppedAt: typeof rawTc.stoppedAt === 'string' ? rawTc.stoppedAt : null,
            stoppedReason: cleanText(rawTc.stoppedReason, 240),
            updatedAt: typeof rawTc.updatedAt === 'string' ? rawTc.updatedAt : new Date().toISOString(),
          }
        : fallback.tokenConfig,
      usedIdentities: Array.isArray(parsed.usedIdentities) ? parsed.usedIdentities : [],
      monitoring: parsedMonitoring,
      results: Array.isArray(parsed.results) ? parsed.results : [],
      savedSessions: Array.isArray(parsed.savedSessions) ? parsed.savedSessions : [],
      materialResources: Array.isArray((parsed as { materialResources?: unknown }).materialResources)
        ? ((parsed as { materialResources: MaterialResource[] }).materialResources || []).slice(0, 60)
        : [],
    };

    const legacyAkList = [
      ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((l) => `X-${l}`),
      ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((l) => `XI-${l}`),
      ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((l) => `XII-${l}`),
    ];
    let migratedFromLegacyAk = false;
    if (
      loaded.tokenConfig.classList.length === legacyAkList.length &&
      loaded.tokenConfig.classList.every((c, idx) => c === legacyAkList[idx])
    ) {
      loaded.tokenConfig.classList = [...DEFAULT_CLASS_LIST];
      delete loaded.tokenConfig.classTokens['X-A'];
      delete loaded.tokenConfig.classTokens['XI-A'];
      delete loaded.tokenConfig.classTokens['XII-A'];
      migratedFromLegacyAk = true;
    }

    const populatedPerClassTokens =
      loaded.tokenConfig.tokenMode === 'per_class'
        ? populateMissingClassTokens(loaded.tokenConfig, true)
        : false;

    let needsSave =
      migratedFromMonitoring ||
      migratedFromLegacyAk ||
      populatedPerClassTokens ||
      Boolean(rawTc && (!('requireNewTokenPerClass' in rawTc) || !('tokenMode' in rawTc)));
    if (
      loaded.tokenConfig.isActive === false &&
      loaded.tokenConfig.targetParticipants === 0 &&
      loaded.tokenConfig.stoppedReason === 'Seluruh siswa telah selesai mengerjakan soal'
    ) {
      loaded.tokenConfig = {
        ...loaded.tokenConfig,
        isActive: true,
        autoStopOnAllFinished: false,
        stoppedAt: null,
        stoppedReason: '',
        updatedAt: new Date().toISOString(),
      };
      needsSave = true;
    }

    if (needsSave) {
      fs.writeFileSync(STORE_TMP_FILE, JSON.stringify(loaded, null, 2), 'utf8');
      fs.renameSync(STORE_TMP_FILE, STORE_FILE);
    }

    return loaded;
  } catch (err) {
    console.error('Gagal memuat .cbt-store.json, menggunakan default:', err);
    return fallback;
  }
}

const store: CbtStore = loadStoreFromDisk();

function saveStoreToDisk(): void {
  try {
    fs.writeFileSync(STORE_TMP_FILE, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(STORE_TMP_FILE, STORE_FILE);
  } catch (err) {
    console.error('Gagal menyimpan .cbt-store.json:', err);
  }
}

// SHA-256 digest of initial default password for first-run admin login before a custom PIN is created
const DEFAULT_FIRST_RUN_PIN_DIGEST = Buffer.from(
  '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9',
  'hex'
);

function getEnvAdminPin(): string {
  return (process.env.ADMIN_PIN || '').trim();
}

function isCustomAdminPinConfigured(): boolean {
  return Boolean(store.adminPinHash);
}

function isAdminConfigured(): boolean {
  return true;
}

function verifyFirstRunDefaultPin(pin: string): boolean {
  const candidate = crypto.createHash('sha256').update(pin).digest();
  if (candidate.length !== DEFAULT_FIRST_RUN_PIN_DIGEST.length) return false;
  return crypto.timingSafeEqual(candidate, DEFAULT_FIRST_RUN_PIN_DIGEST);
}

function hashAdminPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pin, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyAdminPinHash(pin: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  try {
    const derived = crypto.scryptSync(pin, salt, 64);
    const expected = Buffer.from(hashHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function verifyAdminPin(pin: string): boolean {
  if (store.adminPinHash) {
    return verifyAdminPinHash(pin, store.adminPinHash);
  }
  if (verifyFirstRunDefaultPin(pin)) {
    return true;
  }
  const envPin = getEnvAdminPin();
  if (envPin) {
    const a = crypto.createHash('sha256').update(pin).digest();
    const b = crypto.createHash('sha256').update(envPin).digest();
    return crypto.timingSafeEqual(a, b);
  }
  return false;
}

function generateRandomAdminPin(length = 8): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return result;
}

function issueAdminToken(): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + ADMIN_TOKEN_TTL_MS;
  const payload = {
    role: 'admin',
    exp: expiresAt,
    pinEpoch: store.adminPinEpoch || 1,
    jti: crypto.randomBytes(8).toString('hex'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(payloadB64).digest('base64url');
  return { token: `${payloadB64}.${sig}`, expiresAt };
}

function verifyAdminToken(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return false;
  const payloadB64 = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!payloadB64 || !sig) return false;

  const expectedSig = crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      role?: string;
      exp?: number;
      pinEpoch?: number;
    };
    const currentEpoch = store.adminPinEpoch || 1;
    return (
      parsed.role === 'admin' &&
      typeof parsed.exp === 'number' &&
      Date.now() < parsed.exp &&
      parsed.pinEpoch === currentEpoch
    );
  } catch {
    return false;
  }
}

const adminAuthAttempts = new Map<string, { count: number; resetAt: number }>();

function checkAdminRateLimit(req: Request): boolean {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = adminAuthAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    adminAuthAttempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 20;
}

function clearAdminRateLimit(req: Request): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  adminAuthAttempts.delete(ip);
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.get('X-Requested-With') !== 'CBT-Online-Admin') {
    res.status(403).json({ error: 'Permintaan hanya diizinkan dari Portal Admin CBT ONLINE.' });
    return;
  }
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!verifyAdminToken(token)) {
    res.status(401).json({ error: 'Sesi Admin tidak valid atau sudah berakhir. Silakan login ulang.' });
    return;
  }
  next();
}

function normalizeIdentityVal(val: unknown): string {
  return String(val ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function identityMatchesEntry(
  entry: { nama?: unknown; username?: unknown; nisn?: unknown; absen?: unknown } | null | undefined,
  candidate: { nama?: unknown; username?: unknown; nisn?: unknown; absen?: unknown } | null | undefined
): boolean {
  if (!entry || !candidate) return false;
  const eUser = normalizeIdentityVal(entry.username);
  const cUser = normalizeIdentityVal(candidate.username);
  const eNama = normalizeIdentityVal(entry.nama);
  const cNama = normalizeIdentityVal(candidate.nama);
  const eKelas = normalizeIdentityVal(entry.nisn);
  const cKelas = normalizeIdentityVal(candidate.nisn);
  const eAbsen = String(entry.absen ?? '').trim();
  const cAbsen = String(candidate.absen ?? '').trim();

  if (eUser && cUser && eUser === cUser) return true;
  if (eKelas && cKelas && eAbsen && cAbsen && eKelas === cKelas && eAbsen === cAbsen) return true;
  if (eNama && cNama && eKelas && cKelas && eNama === cNama && eKelas === cKelas) return true;
  return false;
}

function sessionSnapshotMatchesStudent(
  snap: StudentSessionSnapshot | null | undefined,
  candidate: { nama?: unknown; username?: unknown; nisn?: unknown; absen?: unknown } | null | undefined
): boolean {
  if (!snap || !candidate) return false;
  return identityMatchesEntry(
    {
      nama: snap.studentNama,
      username: snap.studentUsername,
      nisn: snap.studentNisn,
      absen: snap.studentAbsen,
    },
    candidate
  );
}

function sanitizeSessionSnapshot(
  raw: unknown,
  student: { nama: string; username: string; nisn: string; absen: string },
  preserveUnlockFlags = false
): StudentSessionSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const rawOrder = Array.isArray(obj.questionOrder) ? obj.questionOrder : [];
  const questionOrder = rawOrder.map((id) => cleanText(id, 60)).filter(Boolean).slice(0, 500);
  if (questionOrder.length === 0) return null;

  const rawAnswers = obj.answers && typeof obj.answers === 'object' && !Array.isArray(obj.answers)
    ? (obj.answers as Record<string, unknown>)
    : {};
  const answers: Record<string, unknown> = {};
  for (const qId of questionOrder) {
    if (Object.prototype.hasOwnProperty.call(rawAnswers, qId)) {
      const val = rawAnswers[qId];
      if (Array.isArray(val)) {
        answers[qId] = val.slice(0, 20).map((item) => cleanText(item, 40)).filter(Boolean);
      } else if (val !== undefined && val !== null) {
        answers[qId] = cleanText(val, 120);
      }
    }
  }

  const rawFlagged = obj.flagged && typeof obj.flagged === 'object' && !Array.isArray(obj.flagged)
    ? (obj.flagged as Record<string, unknown>)
    : {};
  const flagged: Record<string, boolean> = {};
  for (const qId of questionOrder) {
    if (rawFlagged[qId]) flagged[qId] = true;
  }

  const now = Date.now();
  const startTime = Number(obj.startTime) > 0 ? Number(obj.startTime) : now;
  const endTime = Number(obj.endTime) > 0 ? Number(obj.endTime) : now + store.settings.durationMinutes * 60_000;
  const rawRem = Number(obj.remainingMs);
  const computedRem = Number.isFinite(rawRem) && rawRem > 0
    ? rawRem
    : endTime > now
      ? endTime - now
      : 60_000;

  return {
    studentNama: student.nama,
    studentUsername: student.username,
    studentNisn: student.nisn,
    studentAbsen: student.absen,
    questionOrder,
    answers,
    flagged,
    currentIndex: Math.min(
      Math.max(0, Math.floor(Number(obj.currentIndex) || 0)),
      Math.max(0, questionOrder.length - 1)
    ),
    warningCount: Math.max(0, Math.min(6, Math.floor(Number(obj.warningCount) || 0))),
    violations: Array.isArray(obj.violations) ? obj.violations.slice(-20) : [],
    startTime,
    endTime,
    remainingMs: Math.max(15_000, Math.floor(computedRem)),
    unlockedByAdmin: preserveUnlockFlags ? Boolean(obj.unlockedByAdmin) : false,
    unlockedAt: preserveUnlockFlags && Number(obj.unlockedAt) > 0 ? Number(obj.unlockedAt) : undefined,
    savedAt: now,
  };
}

function upsertSavedSession(snapshot: StudentSessionSnapshot): void {
  if (!Array.isArray(store.savedSessions)) {
    store.savedSessions = [];
  }
  const idx = store.savedSessions.findIndex((s) =>
    sessionSnapshotMatchesStudent(s, {
      nama: snapshot.studentNama,
      username: snapshot.studentUsername,
      nisn: snapshot.studentNisn,
      absen: snapshot.studentAbsen,
    })
  );
  if (idx >= 0) {
    store.savedSessions[idx] = snapshot;
  } else {
    store.savedSessions.push(snapshot);
  }
}

function countAnsweredFromSnapshot(snapshot: StudentSessionSnapshot): number {
  let count = 0;
  for (const qId of snapshot.questionOrder) {
    const val = snapshot.answers[qId];
    if (Array.isArray(val)) {
      if (val.length > 0) count += 1;
    } else if (val !== undefined && val !== null && String(val).trim() !== '') {
      count += 1;
    }
  }
  return count;
}

function buildResumedClientSession(snapshot: StudentSessionSnapshot) {
  const now = Date.now();
  const remainingMs = Math.max(
    15_000,
    Number(snapshot.remainingMs) || store.settings.durationMinutes * 60_000
  );
  return {
    studentNama: snapshot.studentNama,
    studentUsername: snapshot.studentUsername,
    studentNisn: snapshot.studentNisn,
    studentAbsen: snapshot.studentAbsen,
    questionOrder: [...snapshot.questionOrder],
    answers: { ...snapshot.answers },
    flagged: { ...snapshot.flagged },
    currentIndex: Math.min(
      Math.max(0, Number(snapshot.currentIndex) || 0),
      Math.max(0, snapshot.questionOrder.length - 1)
    ),
    warningCount: 0,
    violations: [],
    startTime: now,
    endTime: now + remainingMs,
    resumedFromReset: true,
  };
}

function findTokenConflictWithOtherClass(code: string, targetClassKey: string | null): string | null {
  if (!code) return null;
  if (
    store.tokenConfig.code === code &&
    store.tokenConfig.boundClass &&
    (!targetClassKey || store.tokenConfig.boundClass !== targetClassKey)
  ) {
    return store.tokenConfig.boundClass;
  }
  for (const [k, entry] of Object.entries(store.tokenConfig.classTokens || {})) {
    if (entry.code === code && (!targetClassKey || k !== targetClassKey)) {
      return entry.className || k;
    }
  }
  for (const h of store.tokenConfig.usedClassTokenHistory || []) {
    if (h.code === code && (!targetClassKey || h.classKey !== targetClassKey)) {
      return h.classKey;
    }
  }
  return null;
}

function generateUniqueClassTokenCode(length = 6): string {
  const usedCodes = new Set<string>([
    store.tokenConfig.code,
    ...Object.values(store.tokenConfig.classTokens || {}).map((c) => c.code),
    ...(store.tokenConfig.usedClassTokenHistory || []).map((h) => h.code),
  ]);
  for (let i = 0; i < 60; i++) {
    const candidate = generateTokenCode(length);
    if (!usedCodes.has(candidate)) return candidate;
  }
  return generateTokenCode(length);
}

function recordClassTokenUsage(classKey: string, code: string): void {
  if (!classKey || !code) return;
  if (!Array.isArray(store.tokenConfig.usedClassTokenHistory)) {
    store.tokenConfig.usedClassTokenHistory = [];
  }
  const exists = store.tokenConfig.usedClassTokenHistory.some(
    (h) => h.classKey === classKey && h.code === code
  );
  if (!exists) {
    store.tokenConfig.usedClassTokenHistory.push({
      classKey,
      code,
      usedAt: new Date().toISOString(),
    });
    if (store.tokenConfig.usedClassTokenHistory.length > 100) {
      store.tokenConfig.usedClassTokenHistory = store.tokenConfig.usedClassTokenHistory.slice(-100);
    }
  }
}

function ensureClassTokensForList(classes: string[], forceRotate = false, defaultActive = true): void {
  if (!store.tokenConfig.classTokens) {
    store.tokenConfig.classTokens = {};
  }
  const nowIso = new Date().toISOString();
  for (const rawCls of classes) {
    const classKey = normalizeClassKeyVal(rawCls);
    if (!classKey) continue;
    const existing = store.tokenConfig.classTokens[classKey];
    if (!existing || forceRotate) {
      const nextCode = generateUniqueClassTokenCode(6);
      store.tokenConfig.classTokens[classKey] = {
        classKey,
        className: classKey,
        code: nextCode,
        isActive: existing ? existing.isActive : defaultActive,
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso,
      };
      recordClassTokenUsage(classKey, nextCode);
    }
  }
}

function getPublicTokenConfig() {
  const classTokensPublic: Record<string, { className: string; code: string; isActive: boolean }> = {};
  for (const [k, v] of Object.entries(store.tokenConfig.classTokens || {})) {
    classTokensPublic[k] = {
      className: v.className,
      code: store.tokenConfig.showOnLogin ? v.code : '',
      isActive: v.isActive,
    };
  }
  return {
    tokenMode: store.tokenConfig.tokenMode || 'global',
    classList: Array.isArray(store.tokenConfig.classList) ? store.tokenConfig.classList : [...DEFAULT_CLASS_LIST],
    required: store.tokenConfig.required,
    showOnLogin: store.tokenConfig.showOnLogin,
    isActive: store.tokenConfig.isActive,
    autoStopOnAllFinished: store.tokenConfig.autoStopOnAllFinished,
    targetParticipants: store.tokenConfig.targetParticipants,
    requireNewTokenPerClass: store.tokenConfig.requireNewTokenPerClass,
    boundClass: store.tokenConfig.boundClass,
    classTokensPublic,
    stoppedAt: store.tokenConfig.stoppedAt,
    stoppedReason: store.tokenConfig.stoppedReason,
    updatedAt: store.tokenConfig.updatedAt,
    code: store.tokenConfig.showOnLogin ? store.tokenConfig.code : '',
  };
}

function evaluateServerTokenAutoStop(): boolean {
  if (!store.tokenConfig.autoStopOnAllFinished || store.tokenConfig.isActive === false) {
    return false;
  }
  const activeCount = store.monitoring.filter((m) => m.status === 'Sedang Mengerjakan').length;
  const doneCount = store.monitoring.filter((m) => m.status === 'Selesai').length;
  const target = Math.max(0, Number(store.tokenConfig.targetParticipants) || 0);

  const shouldStop = target > 0 && doneCount >= target && activeCount === 0;

  if (shouldStop) {
    store.tokenConfig = {
      ...store.tokenConfig,
      isActive: false,
      stoppedAt: new Date().toISOString(),
      stoppedReason: 'Target jumlah siswa selesai telah tercapai',
    };
    return true;
  }
  return false;
}

function sanitizeQuestionInput(raw: unknown, idx: number): StoredQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const typeRaw = cleanText(obj.type, 30).toLowerCase();
  if (!ALLOWED_TYPES.has(typeRaw)) return null;
  const type = typeRaw as QuestionType;

  const id = cleanText(obj.id, 60) || `Q${String(idx + 1).padStart(3, '0')}`;
  const topic = cleanText(obj.topic, 250) || store.settings.syllabusItems[0] || 'Informatika';
  const question = cleanText(obj.question, 1500);
  const explanation = cleanText(obj.explanation, 800);
  if (!question) return null;

  if (type === 'pg' || type === 'pg_kompleks') {
    const rawOpts = obj.options && typeof obj.options === 'object' ? (obj.options as Record<string, unknown>) : {};
    const options: Record<string, string> = {
      A: cleanText(rawOpts.A, 500),
      B: cleanText(rawOpts.B, 500),
      C: cleanText(rawOpts.C, 500),
      D: cleanText(rawOpts.D, 500),
      E: cleanText(rawOpts.E, 500),
    };
    if (!options.A || !options.B || !options.C || !options.D || !options.E) return null;

    if (type === 'pg') {
      const ans = cleanText(obj.answer, 10).toUpperCase();
      const validAns = ['A', 'B', 'C', 'D', 'E'].includes(ans) ? ans : 'A';
      return { id, type, topic, question, options, answer: validAns, explanation };
    }

    const ansArr = Array.isArray(obj.answer)
      ? obj.answer.map((k) => cleanText(k, 10).toUpperCase()).filter((k) => ['A', 'B', 'C', 'D', 'E'].includes(k))
      : [];
    return {
      id,
      type,
      topic,
      question,
      options,
      answer: ansArr.length > 0 ? Array.from(new Set(ansArr)).sort() : ['A', 'B'],
      explanation,
    };
  }

  if (type === 'isian') {
    const ans = cleanText(obj.answer, 60);
    if (!ans || Number.isNaN(Number(ans))) return null;
    return { id, type, topic, question, answer: ans, explanation };
  }

  const tf = cleanText(obj.answer, 20) === 'Salah' ? 'Salah' : 'Benar';
  return { id, type, topic, question, answer: tf, explanation };
}

const UPLOADS_DIR = path.resolve(__dirname, '.cbt-uploads');
const MAX_PDF_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_WEB_FETCH_BYTES = 2 * 1024 * 1024;

function ensureUploadsDir(): void {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function resolveSafeUploadPdfPath(storedFileName: string): string | null {
  const safeName = path.basename(String(storedFileName || '').trim());
  if (!/^[a-zA-Z0-9_-]{6,64}\.pdf$/.test(safeName)) return null;
  const resolved = path.resolve(UPLOADS_DIR, safeName);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep)) return null;
  return resolved;
}

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateOrReservedIp(ipRaw: string): boolean {
  const ip = ipRaw.trim().toLowerCase();
  const ipVer = net.isIP(ip);
  if (ipVer === 4) return isPrivateOrReservedIpv4(ip);
  if (ipVer === 6) {
    if (ip === '::' || ip === '::1') return true;
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
    if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) return true;
    if (ip.startsWith('ff')) return true;
    if (ip.startsWith('::ffff:')) {
      const mapped = ip.slice('::ffff:'.length);
      if (net.isIP(mapped) === 4) return isPrivateOrReservedIpv4(mapped);
    }
    return false;
  }
  return true;
}

async function validateExternalHttpUrl(rawUrl: string): Promise<URL> {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed || trimmed.length > 1000) {
    throw new Error('Link URL tidak valid atau terlalu panjang.');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Format Link URL tidak valid. Pastikan diawali http:// atau https://.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Hanya URL dengan protokol http:// atau https:// yang diizinkan.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Link URL tidak boleh mengandung kredensial username/password.');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Alamat host internal/lokal tidak diizinkan.');
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('Alamat IP privat atau lokal tidak diizinkan.');
    }
    return parsed;
  }

  let resolvedAddresses: Array<{ address: string; family: number }> = [];
  try {
    resolvedAddresses = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Domain "${host}" tidak dapat ditemukan atau tidak dapat dihubungi.`);
  }
  if (!resolvedAddresses || resolvedAddresses.length === 0) {
    throw new Error(`Domain "${host}" tidak memiliki alamat IP publik yang valid.`);
  }
  for (const addr of resolvedAddresses) {
    if (isPrivateOrReservedIp(addr.address)) {
      throw new Error('Akses ke alamat jaringan internal tidak diizinkan.');
    }
  }
  return parsed;
}

async function readResponseWithByteLimit(res: globalThis.Response, maxBytes: number): Promise<Buffer> {
  const lenHeader = Number(res.headers.get('content-length') || 0);
  if (lenHeader > maxBytes) {
    throw new Error(`Ukuran konten melebihi batas maksimal ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }
  if (!res.body) {
    const arr = await res.arrayBuffer();
    if (arr.byteLength > maxBytes) {
      throw new Error(`Ukuran konten melebihi batas maksimal ${Math.round(maxBytes / (1024 * 1024))} MB.`);
    }
    return Buffer.from(arr);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Ukuran konten melebihi batas maksimal ${Math.round(maxBytes / (1024 * 1024))} MB.`);
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

async function fetchSafeExternalUrl(rawUrl: string): Promise<{
  finalUrl: string;
  contentType: string;
  buffer: Buffer;
}> {
  let currentUrl = (await validateExternalHttpUrl(rawUrl)).toString();
  for (let hop = 0; hop <= 3; hop++) {
    const response = await fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
      headers: {
        'User-Agent': 'CBT-Online-MaterialFetcher/1.0',
        Accept: 'application/pdf, text/html, text/plain;q=0.9, */*;q=0.5',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Redirect URL tidak memiliki tujuan yang valid.');
      }
      const nextUrl = new URL(location, currentUrl).toString();
      currentUrl = (await validateExternalHttpUrl(nextUrl)).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(`Gagal mengambil URL tujuan (HTTP ${response.status}).`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const isPdf = contentType.includes('application/pdf') || currentUrl.toLowerCase().includes('.pdf');
    const limit = isPdf ? MAX_PDF_UPLOAD_BYTES : MAX_WEB_FETCH_BYTES;
    const buffer = await readResponseWithByteLimit(response, limit);
    return { finalUrl: currentUrl, contentType, buffer };
  }
  throw new Error('Terlalu banyak pengalihan (redirect) pada URL tujuan.');
}

function extractCleanTextFromHtml(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = cleanText(
    (titleMatch?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' '),
    200
  );
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 26000);
  return { title, text: stripped };
}

async function analyzeMaterialWithGemini(params: {
  ai: GoogleGenAI;
  sourceKind: 'pdf' | 'text';
  pdfBuffer?: Buffer;
  textContent?: string;
  sourceLabel: string;
  contentKind: MaterialContentKind;
}): Promise<{
  subject: string;
  mainTopic: string;
  syllabusItems: string[];
  pedomanPenulisan: string;
  detectedQuestions: NormalizedQuestion[];
}> {
  const modeNote =
    params.contentKind === 'soal'
      ? 'Dokumen ini berisi ISIAN SOAL / BANK SOAL. Ekstrak sebanyak mungkin butir soal (maksimal 25 butir terbaik) ke "detectedQuestions", sekaligus simpulkan Mata Pelajaran, Materi Pokok, Daftar Butir Cakupan Materi, dan Pedoman Penulisan Soal dari soal-soal tersebut.'
      : params.contentKind === 'materi'
        ? 'Dokumen ini berisi PEDOMAN MATERI / MODUL AJAR. Fokus menyusun Mata Pelajaran, Materi Pokok, 4-10 butir Daftar Cakupan Materi Ujian yang spesifik, serta ringkasan Pedoman Materi & Penulisan Soal di "pedomanPenulisan". Kosongkan "detectedQuestions" jika tidak ada soal latihan eksplisit.'
        : 'Dokumen ini dapat berisi MATERI sekaligus ISIAN SOAL (Campuran). Ekstrak Mata Pelajaran, Materi Pokok, 4-10 butir Daftar Cakupan Materi Ujian, ringkasan Pedoman Materi & Penulisan Soal, serta ekstrak butir soal (maksimal 25 soal) jika terdapat soal latihan/ujian di dalam dokumen.';

  const instructionPrompt = [
    `Anda adalah asisten ahli kurikulum dan penyusun naskah soal CBT dalam Bahasa Indonesia.`,
    `Analisis sumber pembelajaran berikut ("${params.sourceLabel}") untuk dijadikan Pedoman Cakupan Materi dan Penulisan Soal ujian CBT.`,
    modeNote,
    ``,
    `Ketentuan Output JSON:`,
    `1. "subject": Nama Mata Pelajaran singkat dan jelas (contoh: "INFORMATIKA", "MATEMATIKA", "BAHASA INDONESIA").`,
    `2. "mainTopic": Judul Materi Pokok utama yang merangkum keseluruhan isi dokumen.`,
    `3. "syllabusItems": Array 4 sampai 10 butir Cakupan Materi Ujian yang konkret dan terukur (akan tampil di halaman Login siswa & dipakai sebagai topik soal).`,
    `4. "pedomanPenulisan": Ringkasan padat pedoman materi, konsep kunci, dan arahan penulisan soal agar guru & generator soal AI konsisten dengan dokumen ini (maksimal 1200 karakter).`,
    `5. "detectedQuestions": Array butir soal jika dokumen berisi soal (gunakan type "pg", "pg_kompleks", "isian" angka saja, atau "benar_salah"; topik setiap soal cocokkan dengan salah satu item di "syllabusItems"; selalu sertakan kunci jawaban & pembahasan singkat). Jika tidak ada soal, kembalikan array kosong [].`,
  ].join('\n');

  const contents =
    params.sourceKind === 'pdf' && params.pdfBuffer
      ? {
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: params.pdfBuffer.toString('base64'),
              },
            },
            { text: instructionPrompt },
          ],
        }
      : `${instructionPrompt}\n\n=== ISI SUMBER (${params.sourceLabel}) ===\n${(params.textContent || '').slice(0, 26000)}`;

  const response = await params.ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents,
    config: {
      systemInstruction:
        'Anda adalah analis materi ajar & soal CBT. Kembalikan HANYA objek JSON valid sesuai responseSchema.',
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          subject: { type: Type.STRING },
          mainTopic: { type: Type.STRING },
          syllabusItems: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          pedomanPenulisan: { type: Type.STRING },
          detectedQuestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING },
                topic: { type: Type.STRING },
                question: { type: Type.STRING },
                optionA: { type: Type.STRING },
                optionB: { type: Type.STRING },
                optionC: { type: Type.STRING },
                optionD: { type: Type.STRING },
                optionE: { type: Type.STRING },
                correctKey: { type: Type.STRING },
                correctKeys: { type: Type.ARRAY, items: { type: Type.STRING } },
                explanation: { type: Type.STRING },
              },
              required: ['type', 'topic', 'question', 'explanation'],
            },
          },
        },
        required: ['subject', 'mainTopic', 'syllabusItems', 'pedomanPenulisan', 'detectedQuestions'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    subject?: unknown;
    mainTopic?: unknown;
    syllabusItems?: unknown;
    pedomanPenulisan?: unknown;
    detectedQuestions?: unknown;
  };

  const subject = cleanText(parsed.subject, 160) || store.settings.subject || DEFAULT_SETTINGS_DATA.subject;
  const mainTopic = cleanText(parsed.mainTopic, 300) || params.sourceLabel || store.settings.mainTopic;
  const rawItems = Array.isArray(parsed.syllabusItems)
    ? parsed.syllabusItems.map((s) => cleanText(s, 250)).filter(Boolean).slice(0, 15)
    : [];
  const syllabusItems = rawItems.length > 0 ? rawItems : [mainTopic];
  const pedomanPenulisan = cleanText(parsed.pedomanPenulisan, 2000) || `Pedoman materi diambil dari ${params.sourceLabel}.`;

  const rawQuestions = Array.isArray(parsed.detectedQuestions) ? parsed.detectedQuestions.slice(0, 30) : [];
  const detectedQuestions: NormalizedQuestion[] = [];
  for (let i = 0; i < rawQuestions.length; i++) {
    const q = normalizeAiQuestion(rawQuestions[i] as RawAiQuestion, undefined, syllabusItems, i);
    if (q) detectedQuestions.push(q);
  }

  return { subject, mainTopic, syllabusItems, pedomanPenulisan, detectedQuestions };
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  const defaultJsonParser = express.json({ limit: '2mb' });
  const pdfUploadJsonParser = express.json({ limit: '22mb' });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/cbt/admin/materials/upload') {
      return pdfUploadJsonParser(req, res, next);
    }
    return defaultJsonParser(req, res, next);
  });

  app.get('/api/cbt/bootstrap', (_req: Request, res: Response) => {
    res.json({
      resetEpoch: store.resetEpoch,
      settings: store.settings,
      questions: store.questions,
      studentQuestionConfig: store.studentQuestionConfig,
      tokenPublic: getPublicTokenConfig(),
    });
  });

  app.post('/api/cbt/student/login', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const nama = cleanText(body.nama, 120);
    const username = cleanText(body.username, 60);
    const nisn = cleanText(body.nisn, 40);
    const absenNum = Number(body.absen);
    const tokenInput = cleanText(body.tokenCode, 24).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const totalQuestionsRaw = Number(body.totalQuestions);

    if (!nama || !username || !nisn || !Number.isInteger(absenNum) || absenNum < 1 || absenNum > 999) {
      res.status(400).json({
        error: 'Nama Lengkap Siswa, Username, Kelas, dan Nomor Absen (1-999) wajib diisi lengkap.',
      });
      return;
    }

    if (username.length < 2 || !nisn) {
      res.status(400).json({ error: 'Username minimal 2 karakter dan Kelas wajib dipilih.' });
      return;
    }

    const classKey = normalizeClassKeyVal(nisn);
    const dedicatedClassToken = store.tokenConfig.classTokens?.[classKey] || null;
    const isPerClassMode = store.tokenConfig.tokenMode === 'per_class';
    let shouldBindMainClassToken = false;

    if (store.tokenConfig.required) {
      if (isPerClassMode) {
        if (!dedicatedClassToken || !dedicatedClassToken.isActive) {
          res.status(403).json({
            error: `Token Ujian untuk kelas ${classKey} belum diaktifkan atau sedang dinonaktifkan oleh Admin.`,
          });
          return;
        }
        if (!tokenInput || tokenInput !== dedicatedClassToken.code) {
          res.status(403).json({
            error: `Token Ujian untuk kelas ${classKey} tidak sesuai. Masukkan token khusus kelas ${classKey}.`,
          });
          return;
        }
      } else if (dedicatedClassToken) {
        if (!dedicatedClassToken.isActive) {
          res.status(403).json({
            error: `Token Ujian untuk kelas ${dedicatedClassToken.className} sedang dinonaktifkan oleh Admin.`,
          });
          return;
        }
        if (!tokenInput || tokenInput !== dedicatedClassToken.code) {
          res.status(403).json({
            error: `Token Ujian untuk kelas ${dedicatedClassToken.className} tidak sesuai. Setiap kelas wajib menggunakan token kelasnya masing-masing.`,
          });
          return;
        }
      } else {
        if (store.tokenConfig.isActive === false) {
          res.status(403).json({
            error:
              'Token Ujian telah dihentikan otomatis karena target jumlah siswa selesai tercapai. Hubungi Admin untuk membuka sesi baru.',
          });
          return;
        }
        if (!tokenInput || tokenInput !== store.tokenConfig.code) {
          res.status(403).json({
            error: 'Token Ujian tidak sesuai atau sudah direset. Periksa kembali kode Token Ujian aktif.',
          });
          return;
        }
        if (store.tokenConfig.requireNewTokenPerClass) {
          if (store.tokenConfig.boundClass && store.tokenConfig.boundClass !== classKey) {
            res.status(403).json({
              error: `Token ${store.tokenConfig.code} sudah digunakan untuk kelas ${store.tokenConfig.boundClass}. Setiap siswa dari kelas lainnya (${classKey}) wajib memasukkan Token Ujian yang baru/berbeda dari Portal Admin.`,
            });
            return;
          }
          const historyConflict = (store.tokenConfig.usedClassTokenHistory || []).find(
            (h) => h.code === tokenInput && h.classKey !== classKey
          );
          if (historyConflict) {
            res.status(403).json({
              error: `Token ${tokenInput} pernah digunakan oleh kelas ${historyConflict.classKey}. Untuk kelas ${classKey}, Token Ujian wajib diubah ke kode baru di Portal Admin.`,
            });
            return;
          }
          shouldBindMainClassToken = true;
        }
      }
    }

    const candidate = {
      nama,
      username,
      nisn,
      absen: String(absenNum),
    };

    const alreadyUsed =
      store.usedIdentities.some((entry) => identityMatchesEntry(entry, candidate)) ||
      store.results.some((entry) => identityMatchesEntry(entry, candidate));

    if (alreadyUsed) {
      res.status(409).json({
        error:
          'Identitas peserta ini sudah melengkapi data sebelumnya dan telah tercatat masuk, sehingga tidak dapat login kembali.',
      });
      return;
    }

    const now = Date.now();
    const student: UsedIdentityRecord & { loggedInAt: number } = {
      nama,
      username,
      nisn,
      absen: String(absenNum),
      registeredAt: now,
      loggedInAt: now,
    };

    store.usedIdentities.push({
      nama: student.nama,
      username: student.username,
      nisn: student.nisn,
      absen: student.absen,
      registeredAt: now,
    });

    const activeTotal =
      Number.isInteger(totalQuestionsRaw) && totalQuestionsRaw > 0
        ? Math.min(500, totalQuestionsRaw)
        : store.studentQuestionConfig.mode === 'all'
          ? store.questions.length
          : store.studentQuestionConfig.mode === 'custom' && store.studentQuestionConfig.selectedIds.length > 0
            ? store.studentQuestionConfig.selectedIds.length
            : Math.min(50, store.questions.length);

    const existingMonIdx = store.monitoring.findIndex((m) => identityMatchesEntry(m, student));
    const savedSnap = (store.savedSessions || []).find((s) => sessionSnapshotMatchesStudent(s, student));
    let resumedSession: ReturnType<typeof buildResumedClientSession> | null = null;
    let monEntry: MonitoringRecord;

    if (savedSnap && savedSnap.questionOrder.length > 0) {
      resumedSession = buildResumedClientSession(savedSnap);
      savedSnap.unlockedByAdmin = false;
      savedSnap.warningCount = 0;
      savedSnap.violations = [];
      savedSnap.startTime = resumedSession.startTime;
      savedSnap.endTime = resumedSession.endTime;
      savedSnap.savedAt = now;

      const resumedTotal = savedSnap.questionOrder.length;
      const resumedAnswered = countAnsweredFromSnapshot(savedSnap);
      const resumedPct = resumedTotal > 0 ? Math.min(100, Math.round((resumedAnswered / resumedTotal) * 100)) : 0;

      monEntry = {
        ...(existingMonIdx >= 0 ? store.monitoring[existingMonIdx] : {}),
        nama: student.nama,
        username: student.username,
        nisn: student.nisn,
        absen: student.absen,
        status: 'Belum Mulai',
        answeredCount: resumedAnswered,
        totalQuestions: resumedTotal,
        percentage: resumedPct,
        currentNumber: (resumedSession.currentIndex || 0) + 1,
        flaggedCount: Object.keys(resumedSession.flagged || {}).length,
        warningCount: 0,
        terminatedByViolation: false,
        startTime: resumedSession.startTime,
        endTime: resumedSession.endTime,
        lastActivityAt: now,
      };
      delete monEntry.completedAt;
    } else {
      monEntry = {
        ...(existingMonIdx >= 0 ? store.monitoring[existingMonIdx] : {}),
        nama: student.nama,
        username: student.username,
        nisn: student.nisn,
        absen: student.absen,
        status: 'Belum Mulai',
        answeredCount: 0,
        totalQuestions: activeTotal,
        percentage: 0,
        currentNumber: 0,
        flaggedCount: 0,
        warningCount: 0,
        terminatedByViolation: false,
        lastActivityAt: now,
      };
      delete monEntry.completedAt;
    }

    if (existingMonIdx >= 0) {
      store.monitoring[existingMonIdx] = monEntry;
    } else {
      store.monitoring.push(monEntry);
    }

    if (dedicatedClassToken) {
      recordClassTokenUsage(classKey, dedicatedClassToken.code);
    } else if (shouldBindMainClassToken) {
      store.tokenConfig.boundClass = classKey;
      recordClassTokenUsage(classKey, store.tokenConfig.code);
    }

    saveStoreToDisk();

    res.json({
      ok: true,
      resetEpoch: store.resetEpoch,
      tokenPublic: getPublicTokenConfig(),
      student: {
        nama: student.nama,
        username: student.username,
        nisn: student.nisn,
        absen: student.absen,
        loggedInAt: now,
      },
      monitoringRecord: monEntry,
      resumedSession,
    });
  });

  app.post('/api/cbt/student/check-resume', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const nama = cleanText(body.nama, 120);
    const username = cleanText(body.username, 60);
    const nisn = cleanText(body.nisn, 40);
    const absen = cleanText(body.absen, 16) || '-';

    if (!nama || !username || !nisn) {
      res.json({ ok: true, unlocked: false });
      return;
    }

    const candidate = { nama, username, nisn, absen };
    const alreadyDone = store.results.some((r) => identityMatchesEntry(r, candidate));
    const alreadyLogged = store.usedIdentities.some((u) => identityMatchesEntry(u, candidate));
    const savedSnap = (store.savedSessions || []).find((s) => sessionSnapshotMatchesStudent(s, candidate));

    if (alreadyDone || alreadyLogged || !savedSnap || !savedSnap.unlockedByAdmin) {
      res.json({ ok: true, unlocked: false });
      return;
    }

    const now = Date.now();
    const resumedSession = buildResumedClientSession(savedSnap);
    savedSnap.unlockedByAdmin = false;
    savedSnap.warningCount = 0;
    savedSnap.violations = [];
    savedSnap.startTime = resumedSession.startTime;
    savedSnap.endTime = resumedSession.endTime;
    savedSnap.savedAt = now;

    store.usedIdentities.push({
      nama,
      username,
      nisn,
      absen,
      registeredAt: now,
    });

    const monIdx = store.monitoring.findIndex((m) => identityMatchesEntry(m, candidate));
    const totalQ = savedSnap.questionOrder.length;
    const answeredQ = countAnsweredFromSnapshot(savedSnap);
    const pct = totalQ > 0 ? Math.min(100, Math.round((answeredQ / totalQ) * 100)) : 0;

    if (monIdx >= 0) {
      store.monitoring[monIdx] = {
        ...store.monitoring[monIdx],
        status: 'Belum Mulai',
        answeredCount: answeredQ,
        totalQuestions: totalQ,
        percentage: pct,
        currentNumber: (resumedSession.currentIndex || 0) + 1,
        flaggedCount: Object.keys(resumedSession.flagged || {}).length,
        warningCount: 0,
        terminatedByViolation: false,
        startTime: resumedSession.startTime,
        endTime: resumedSession.endTime,
        lastActivityAt: now,
      };
      delete store.monitoring[monIdx].completedAt;
    }

    saveStoreToDisk();
    res.json({
      ok: true,
      unlocked: true,
      resetEpoch: store.resetEpoch,
      tokenPublic: getPublicTokenConfig(),
      student: { nama, username, nisn, absen, loggedInAt: now },
      resumedSession,
    });
  });

  app.post('/api/cbt/student/progress', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const rawStudent = body.student && typeof body.student === 'object' ? (body.student as Record<string, unknown>) : null;
    const rawProgress = body.progress && typeof body.progress === 'object' ? (body.progress as Record<string, unknown>) : {};

    if (!rawStudent) {
      res.status(400).json({ error: 'Identitas siswa wajib disertakan.' });
      return;
    }

    const nama = cleanText(rawStudent.nama, 120);
    const username = cleanText(rawStudent.username, 60);
    const nisn = cleanText(rawStudent.nisn, 40);
    const absen = cleanText(rawStudent.absen, 16) || '-';

    if (!nama || !username || !nisn) {
      res.status(400).json({ error: 'Identitas siswa tidak lengkap.' });
      return;
    }

    const candidate = { nama, username, nisn, absen };
    const alreadyDoneResult = store.results.some((r) => identityMatchesEntry(r, candidate));
    const existingMonIdx = store.monitoring.findIndex((m) => identityMatchesEntry(m, candidate));
    if (alreadyDoneResult || (existingMonIdx >= 0 && store.monitoring[existingMonIdx].status === 'Selesai')) {
      res.json({ ok: true, alreadyFinished: true, resetEpoch: store.resetEpoch });
      return;
    }

    if (!store.usedIdentities.some((u) => identityMatchesEntry(u, candidate))) {
      store.usedIdentities.push({
        nama,
        username,
        nisn,
        absen,
        registeredAt: Date.now(),
      });
    }

    const statusRaw = cleanText(rawProgress.status, 40);
    const status: MonitoringRecord['status'] =
      statusRaw === 'Sedang Mengerjakan' ? 'Sedang Mengerjakan' : 'Belum Mulai';
    const totalQuestions = Math.max(0, Math.min(500, Math.floor(Number(rawProgress.totalQuestions) || 0)));
    const answeredCount = Math.max(0, Math.min(totalQuestions || 500, Math.floor(Number(rawProgress.answeredCount) || 0)));
    const percentage =
      totalQuestions > 0
        ? Math.min(100, Math.max(0, Math.round((answeredCount / totalQuestions) * 100)))
        : Math.min(100, Math.max(0, Math.round(Number(rawProgress.percentage) || 0)));
    const currentNumber = Math.max(0, Math.min(totalQuestions || 500, Math.floor(Number(rawProgress.currentNumber) || 0)));
    const flaggedCount = Math.max(0, Math.min(500, Math.floor(Number(rawProgress.flaggedCount) || 0)));
    const warningCount = Math.max(0, Math.min(6, Math.floor(Number(rawProgress.warningCount) || 0)));
    const startTime = Number(rawProgress.startTime) > 0 ? Number(rawProgress.startTime) : undefined;
    const endTime = Number(rawProgress.endTime) > 0 ? Number(rawProgress.endTime) : undefined;
    const now = Date.now();

    const existing = existingMonIdx >= 0 ? store.monitoring[existingMonIdx] : undefined;
    const updated: MonitoringRecord = {
      ...existing,
      nama,
      username,
      nisn,
      absen,
      status,
      answeredCount,
      totalQuestions,
      percentage,
      currentNumber,
      flaggedCount,
      warningCount,
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
      lastActivityAt: now,
    };

    if (existingMonIdx >= 0) {
      store.monitoring[existingMonIdx] = updated;
    } else {
      store.monitoring.push(updated);
    }

    const snap = sanitizeSessionSnapshot(body.sessionSnapshot, candidate);
    if (snap) {
      upsertSavedSession(snap);
    }

    saveStoreToDisk();
    res.json({ ok: true, resetEpoch: store.resetEpoch });
  });

  app.post('/api/cbt/student/finish', (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const rawStudent = body.student && typeof body.student === 'object' ? (body.student as Record<string, unknown>) : null;
    const rawResult = body.resultRecord && typeof body.resultRecord === 'object' ? (body.resultRecord as Record<string, unknown>) : null;

    if (!rawStudent || !rawResult) {
      res.status(400).json({ error: 'Data siswa dan hasil ujian wajib disertakan.' });
      return;
    }

    const nama = cleanText(rawStudent.nama || rawResult.nama, 120);
    const username = cleanText(rawStudent.username || rawResult.username, 60);
    const nisn = cleanText(rawStudent.nisn || rawResult.nisn, 40);
    const absen = cleanText(rawStudent.absen || rawResult.absen, 16) || '-';

    if (!nama || !username || !nisn) {
      res.status(400).json({ error: 'Identitas siswa pada pengiriman hasil tidak valid.' });
      return;
    }

    const candidate = { nama, username, nisn, absen };
    if (!store.usedIdentities.some((u) => identityMatchesEntry(u, candidate))) {
      store.usedIdentities.push({ nama, username, nisn, absen, registeredAt: Date.now() });
    }

    const existingResIdx = store.results.findIndex((r) => identityMatchesEntry(r, candidate));
    const totalQuestions = Math.max(1, Math.min(500, Math.floor(Number(rawResult.totalQuestions) || 1)));
    const correctCount = Math.max(0, Math.min(totalQuestions, Math.floor(Number(rawResult.correctCount) || 0)));
    const wrongCount = Math.max(0, Math.min(totalQuestions, Math.floor(Number(rawResult.wrongCount) || (totalQuestions - correctCount))));
    const rawScore = Number(rawResult.score);
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0;
    const rawPct = Number(rawResult.percentage);
    const percentage = Number.isFinite(rawPct) ? Math.max(0, Math.min(100, rawPct)) : 0;
    const answeredCount = Math.max(0, Math.min(totalQuestions, Math.floor(Number(body.answeredCount ?? rawResult.answeredCount) || 0)));
    const warningCount = Math.max(0, Math.min(6, Math.floor(Number(rawResult.warningCount) || 0)));
    const autoSubmittedByViolation = Boolean(body.terminatedByViolation ?? rawResult.autoSubmittedByViolation);
    const completedAt = cleanText(rawResult.completedAt, 60) || new Date().toISOString();

    const sanitizedResult: ResultRecord = {
      id: existingResIdx >= 0 ? store.results[existingResIdx].id : cleanText(rawResult.id, 60) || `RES-${Date.now()}`,
      nomorUrut: existingResIdx >= 0 ? store.results[existingResIdx].nomorUrut : store.results.length + 1,
      nama,
      username,
      nisn,
      absen,
      subject: cleanText(rawResult.subject, 160) || store.settings.subject,
      mainTopic: cleanText(rawResult.mainTopic, 300) || store.settings.mainTopic,
      score,
      correctCount,
      wrongCount,
      totalQuestions,
      answeredCount,
      percentage,
      status: score >= 75 ? 'Lulus' : 'Belum Lulus',
      warningCount,
      autoSubmittedByViolation,
      completedAt,
      topicStats: Array.isArray(rawResult.topicStats)
        ? rawResult.topicStats.slice(0, 40).map((ts: unknown) => {
            const item = ts && typeof ts === 'object' ? (ts as Record<string, unknown>) : {};
            return {
              topic: cleanText(item.topic, 250),
              correct: Math.max(0, Math.floor(Number(item.correct) || 0)),
              total: Math.max(0, Math.floor(Number(item.total) || 0)),
            };
          })
        : [],
      details: Array.isArray(rawResult.details) ? rawResult.details.slice(0, 500) : [],
    };

    if (existingResIdx >= 0) {
      store.results[existingResIdx] = sanitizedResult;
    } else {
      store.results.push(sanitizedResult);
    }

    const completedPct = totalQuestions > 0 ? Math.min(100, Math.round((answeredCount / totalQuestions) * 100)) : 0;
    const monIdx = store.monitoring.findIndex((m) => identityMatchesEntry(m, candidate));
    const doneMon: MonitoringRecord = {
      ...(monIdx >= 0 ? store.monitoring[monIdx] : {}),
      nama,
      username,
      nisn,
      absen,
      status: 'Selesai',
      answeredCount,
      totalQuestions,
      percentage: completedPct,
      currentNumber: totalQuestions,
      flaggedCount: 0,
      warningCount,
      terminatedByViolation: autoSubmittedByViolation,
      completedAt,
      lastActivityAt: Date.now(),
    };

    if (monIdx >= 0) {
      store.monitoring[monIdx] = doneMon;
    } else {
      store.monitoring.push(doneMon);
    }

    const finishSnap = sanitizeSessionSnapshot(body.sessionSnapshot, candidate);
    if (finishSnap) {
      upsertSavedSession(finishSnap);
    }

    evaluateServerTokenAutoStop();
    saveStoreToDisk();

    res.json({
      ok: true,
      nomorUrut: sanitizedResult.nomorUrut,
      resultRecord: sanitizedResult,
      tokenPublic: getPublicTokenConfig(),
      resetEpoch: store.resetEpoch,
    });
  });

  app.get('/api/cbt/admin/status', (_req: Request, res: Response) => {
    res.json({
      configured: isAdminConfigured(),
      usingDefaultPin: !isCustomAdminPinConfigured(),
      envControlled: false,
    });
  });

  app.post('/api/cbt/admin/setup', (req: Request, res: Response) => {
    if (req.get('X-Requested-With') !== 'CBT-Online-Admin') {
      res.status(403).json({ error: 'Permintaan hanya diizinkan dari Portal Admin CBT ONLINE.' });
      return;
    }
    if (!checkAdminRateLimit(req)) {
      res.status(429).json({ error: 'Terlalu banyak percobaan. Silakan tunggu beberapa menit.' });
      return;
    }
    if (isCustomAdminPinConfigured()) {
      res.status(409).json({ error: 'PIN Admin sudah dikonfigurasi. Silakan masukkan PIN Admin yang berlaku.' });
      return;
    }

    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const defaultPin = typeof body.defaultPin === 'string' ? body.defaultPin.trim() : '';
    const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
    if (!defaultPin || !verifyAdminPin(defaultPin)) {
      res.status(401).json({ error: 'Password default awal salah.' });
      return;
    }
    if (pin.length < 6 || pin.length > 100) {
      res.status(400).json({ error: 'PIN Admin baru harus terdiri dari minimal 6 karakter.' });
      return;
    }

    store.adminPinHash = hashAdminPin(pin);
    store.adminPinEpoch = (store.adminPinEpoch || 1) + 1;
    saveStoreToDisk();
    clearAdminRateLimit(req);

    const session = issueAdminToken();
    res.json(session);
  });

  app.post('/api/cbt/admin/login', (req: Request, res: Response) => {
    if (req.get('X-Requested-With') !== 'CBT-Online-Admin') {
      res.status(403).json({ error: 'Permintaan hanya diizinkan dari Portal Admin CBT ONLINE.' });
      return;
    }
    if (!checkAdminRateLimit(req)) {
      res.status(429).json({ error: 'Terlalu banyak percobaan login gagal. Silakan tunggu beberapa menit.' });
      return;
    }

    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
    if (!pin || !verifyAdminPin(pin)) {
      res.status(401).json({ error: 'PIN Admin salah. Silakan periksa kembali dan coba lagi.' });
      return;
    }

    clearAdminRateLimit(req);
    const session = issueAdminToken();
    res.json({
      ...session,
      mustCreatePin: !isCustomAdminPinConfigured(),
    });
  });

  app.post('/api/cbt/admin/change-pin', requireAdminAuth, (req: Request, res: Response) => {
    if (req.get('X-Requested-With') !== 'CBT-Online-Admin') {
      res.status(403).json({ error: 'Permintaan hanya diizinkan dari Portal Admin CBT ONLINE.' });
      return;
    }
    if (!checkAdminRateLimit(req)) {
      res.status(429).json({ error: 'Terlalu banyak percobaan. Silakan tunggu beberapa menit.' });
      return;
    }

    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const mode = body.mode === 'generate' ? 'generate' : 'custom';
    let newPin = '';

    if (mode === 'generate') {
      newPin = generateRandomAdminPin(8);
    } else {
      newPin = typeof body.pin === 'string' ? body.pin.trim() : '';
      if (newPin.length < 6 || newPin.length > 100) {
        res.status(400).json({ error: 'PIN Admin baru harus terdiri dari minimal 6 karakter.' });
        return;
      }
    }

    store.adminPinHash = hashAdminPin(newPin);
    store.adminPinEpoch = (store.adminPinEpoch || 1) + 1;
    saveStoreToDisk();
    clearAdminRateLimit(req);

    const session = issueAdminToken();
    res.json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      ...(mode === 'generate' ? { generatedPin: newPin } : {}),
    });
  });

  app.get('/api/cbt/materials/:id', (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(id)) {
      res.status(400).json({ error: 'ID materi tidak valid.' });
      return;
    }
    const resource = store.materialResources.find((m) => m.id === id);
    if (!resource) {
      res.status(404).json({ error: 'Materi atau link akses tidak ditemukan.' });
      return;
    }
    res.json({
      id: resource.id,
      title: resource.title,
      sourceType: resource.sourceType,
      contentKind: resource.contentKind,
      fileName: resource.fileName || '',
      fileSizeBytes: resource.fileSizeBytes || 0,
      hasPdfFile: Boolean(resource.storedFileName),
      targetUrl: resource.targetUrl || '',
      extractedSubject: resource.extractedSubject,
      extractedMainTopic: resource.extractedMainTopic,
      extractedSyllabusItems: resource.extractedSyllabusItems,
      pedomanPenulisan: resource.pedomanPenulisan,
      createdAt: resource.createdAt,
    });
  });

  app.get('/api/cbt/materials/:id/file', (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(id)) {
      res.status(400).json({ error: 'ID file materi tidak valid.' });
      return;
    }
    const resource = store.materialResources.find((m) => m.id === id);
    if (!resource || !resource.storedFileName) {
      res.status(404).json({ error: 'File PDF materi tidak ditemukan.' });
      return;
    }
    const safePath = resolveSafeUploadPdfPath(resource.storedFileName);
    if (!safePath || !fs.existsSync(safePath)) {
      res.status(404).json({ error: 'Berkas PDF tidak tersedia di server.' });
      return;
    }
    const downloadName = (resource.fileName || `${resource.id}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`);
    res.sendFile(safePath);
  });

  app.post('/api/cbt/admin/materials/upload', requireAdminAuth, async (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const rawFileName = cleanText(body.fileName, 180) || 'materi-pedoman.pdf';
    const base64Input = typeof body.base64Data === 'string' ? body.base64Data.trim() : '';
    const customTitle = cleanText(body.title, 200);
    const contentKindRaw = cleanText(body.contentKind, 20).toLowerCase();
    const contentKind: MaterialContentKind =
      contentKindRaw === 'materi' || contentKindRaw === 'soal' ? contentKindRaw : 'campuran';
    const runAi = body.runAi !== false;

    if (!base64Input) {
      res.status(400).json({ error: 'Berkas PDF wajib dipilih sebelum diunggah.' });
      return;
    }

    const strippedB64 = base64Input.replace(/^data:application\/pdf(?:;[^,]*)?;base64,/i, '');
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = Buffer.from(strippedB64, 'base64');
    } catch {
      res.status(400).json({ error: 'Format data PDF tidak valid.' });
      return;
    }

    if (pdfBuffer.length < 32 || pdfBuffer.length > MAX_PDF_UPLOAD_BYTES) {
      res.status(400).json({ error: 'Ukuran PDF harus antara 32 byte hingga maksimal 15 MB.' });
      return;
    }
    if (pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      res.status(400).json({ error: 'File yang diunggah bukan dokumen PDF yang valid (%PDF-).' });
      return;
    }

    const id = crypto.randomBytes(9).toString('base64url');
    const storedFileName = `${id}.pdf`;
    const safePath = resolveSafeUploadPdfPath(storedFileName);
    if (!safePath) {
      res.status(500).json({ error: 'Gagal menyiapkan lokasi penyimpanan PDF.' });
      return;
    }

    ensureUploadsDir();
    fs.writeFileSync(safePath, pdfBuffer);

    const displayTitle = customTitle || rawFileName.replace(/\.pdf$/i, '') || 'Materi PDF Ujian';
    const resource: MaterialResource = {
      id,
      title: displayTitle,
      sourceType: 'pdf',
      contentKind,
      fileName: rawFileName,
      storedFileName,
      fileSizeBytes: pdfBuffer.length,
      extractedSubject: store.settings.subject || DEFAULT_SETTINGS_DATA.subject,
      extractedMainTopic: displayTitle,
      extractedSyllabusItems: [...store.settings.syllabusItems],
      pedomanPenulisan: `Pedoman materi PDF: ${displayTitle}.`,
      detectedQuestions: [],
      aiExtracted: false,
      createdAt: new Date().toISOString(),
    };

    let aiError = '';
    if (runAi) {
      const ai = getGeminiClient();
      if (!ai) {
        aiError = 'PDF tersimpan & Link Akses siap, namun GEMINI_API_KEY belum aktif untuk ekstraksi otomatis.';
      } else {
        try {
          const extracted = await analyzeMaterialWithGemini({
            ai,
            sourceKind: 'pdf',
            pdfBuffer,
            sourceLabel: displayTitle,
            contentKind,
          });
          resource.extractedSubject = extracted.subject;
          resource.extractedMainTopic = extracted.mainTopic;
          resource.extractedSyllabusItems = extracted.syllabusItems;
          resource.pedomanPenulisan = extracted.pedomanPenulisan;
          resource.detectedQuestions = extracted.detectedQuestions;
          resource.aiExtracted = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Gagal mengekstrak PDF dengan AI.';
          aiError = `PDF tersimpan & Link Akses siap, tetapi ekstraksi AI gagal: ${msg.slice(0, 180)}`;
        }
      }
    }

    store.materialResources.unshift(resource);
    store.materialResources = store.materialResources.slice(0, 60);
    saveStoreToDisk();

    res.json({
      ok: true,
      resource,
      aiExtracted: resource.aiExtracted,
      ...(aiError ? { aiNotice: aiError } : {}),
    });
  });

  app.post('/api/cbt/admin/materials/from-url', requireAdminAuth, async (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
    const customTitle = cleanText(body.title, 200);
    const contentKindRaw = cleanText(body.contentKind, 20).toLowerCase();
    const contentKind: MaterialContentKind =
      contentKindRaw === 'materi' || contentKindRaw === 'soal' ? contentKindRaw : 'campuran';
    const analyzeContent = body.analyzeContent !== false;

    let validatedUrl: URL;
    try {
      validatedUrl = await validateExternalHttpUrl(rawUrl);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Link URL tidak valid.' });
      return;
    }

    const id = crypto.randomBytes(9).toString('base64url');
    const fallbackTitle = customTitle || `${validatedUrl.hostname}${validatedUrl.pathname !== '/' ? validatedUrl.pathname : ''}`.slice(0, 180);
    const resource: MaterialResource = {
      id,
      title: fallbackTitle,
      sourceType: 'url',
      contentKind,
      targetUrl: validatedUrl.toString(),
      extractedSubject: store.settings.subject || DEFAULT_SETTINGS_DATA.subject,
      extractedMainTopic: fallbackTitle,
      extractedSyllabusItems: [...store.settings.syllabusItems],
      pedomanPenulisan: `Sumber referensi website: ${validatedUrl.toString()}`,
      detectedQuestions: [],
      aiExtracted: false,
      createdAt: new Date().toISOString(),
    };

    let aiNotice = '';
    if (analyzeContent) {
      try {
        const fetched = await fetchSafeExternalUrl(validatedUrl.toString());
        resource.targetUrl = fetched.finalUrl;
        const isPdf = fetched.contentType.includes('pdf') || fetched.buffer.subarray(0, 5).toString('ascii') === '%PDF-';
        const ai = getGeminiClient();

        if (isPdf) {
          const storedFileName = `${id}.pdf`;
          const safePath = resolveSafeUploadPdfPath(storedFileName);
          if (safePath) {
            ensureUploadsDir();
            fs.writeFileSync(safePath, fetched.buffer);
            resource.storedFileName = storedFileName;
            resource.fileName = path.basename(new URL(fetched.finalUrl).pathname || 'materi.pdf') || 'materi.pdf';
            resource.fileSizeBytes = fetched.buffer.length;
          }
          if (!ai) {
            aiNotice = 'Link URL PDF berhasil diambil & Link Akses dibuat, namun GEMINI_API_KEY belum aktif untuk ekstraksi otomatis.';
          } else {
            const extracted = await analyzeMaterialWithGemini({
              ai,
              sourceKind: 'pdf',
              pdfBuffer: fetched.buffer,
              sourceLabel: customTitle || fetched.finalUrl,
              contentKind,
            });
            resource.extractedSubject = extracted.subject;
            resource.extractedMainTopic = extracted.mainTopic;
            resource.extractedSyllabusItems = extracted.syllabusItems;
            resource.pedomanPenulisan = extracted.pedomanPenulisan;
            resource.detectedQuestions = extracted.detectedQuestions;
            resource.aiExtracted = true;
          }
        } else {
          const { title, text } = extractCleanTextFromHtml(fetched.buffer.toString('utf8'));
          if (!customTitle && title) {
            resource.title = title;
          }
          if (!text || text.length < 30) {
            aiNotice = 'Halaman website berhasil ditautkan, namun teks artikel tidak terbaca (kemungkinan halaman dinamis). Link Akses tetap dibuat.';
          } else if (!ai) {
            resource.pedomanPenulisan = text.slice(0, 1200);
            aiNotice = 'Teks halaman berhasil diambil & Link Akses dibuat. Aktifkan GEMINI_API_KEY untuk ringkasan materi & soal otomatis.';
          } else {
            const extracted = await analyzeMaterialWithGemini({
              ai,
              sourceKind: 'text',
              textContent: text,
              sourceLabel: resource.title || fetched.finalUrl,
              contentKind,
            });
            resource.extractedSubject = extracted.subject;
            resource.extractedMainTopic = extracted.mainTopic;
            resource.extractedSyllabusItems = extracted.syllabusItems;
            resource.pedomanPenulisan = extracted.pedomanPenulisan;
            resource.detectedQuestions = extracted.detectedQuestions;
            resource.aiExtracted = true;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal mengambil konten dari link website.';
        res.status(502).json({ error: msg });
        return;
      }
    }

    store.materialResources.unshift(resource);
    store.materialResources = store.materialResources.slice(0, 60);
    saveStoreToDisk();

    res.json({
      ok: true,
      resource,
      aiExtracted: resource.aiExtracted,
      ...(aiNotice ? { aiNotice } : {}),
    });
  });

  app.delete('/api/cbt/admin/materials/:id', requireAdminAuth, (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!/^[a-zA-Z0-9_-]{6,64}$/.test(id)) {
      res.status(400).json({ error: 'ID materi tidak valid.' });
      return;
    }
    const idx = store.materialResources.findIndex((m) => m.id === id);
    if (idx < 0) {
      res.status(404).json({ error: 'Materi tidak ditemukan.' });
      return;
    }
    const [removed] = store.materialResources.splice(idx, 1);
    if (removed?.storedFileName) {
      const safePath = resolveSafeUploadPdfPath(removed.storedFileName);
      if (safePath && fs.existsSync(safePath)) {
        try {
          fs.unlinkSync(safePath);
        } catch {
          // Ignore file cleanup failure
        }
      }
    }
    if (store.settings.activeMaterialId === id) {
      store.settings.activeMaterialId = null;
      store.settings.activeMaterialTitle = '';
      store.settings.activeMaterialUrl = '';
    }
    saveStoreToDisk();
    res.json({ ok: true, materialResources: store.materialResources, settings: store.settings });
  });

  app.get('/api/cbt/admin/state', requireAdminAuth, (_req: Request, res: Response) => {
    res.json({
      resetEpoch: store.resetEpoch,
      settings: store.settings,
      questions: store.questions,
      studentQuestionConfig: store.studentQuestionConfig,
      tokenConfig: store.tokenConfig,
      usedIdentities: store.usedIdentities,
      monitoring: store.monitoring,
      results: store.results,
      materialResources: store.materialResources,
    });
  });

  app.post('/api/cbt/admin/config', requireAdminAuth, (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

    if (body.settings && typeof body.settings === 'object') {
      const s = body.settings as Record<string, unknown>;
      const subject = cleanText(s.subject, 160);
      const mainTopic = cleanText(s.mainTopic, 300);
      const heroSubtitle = cleanText(s.heroSubtitle, 300);
      const durationMinutes = Number(s.durationMinutes);
      const syllabusItems = Array.isArray(s.syllabusItems)
        ? s.syllabusItems.map((item) => cleanText(item, 250)).filter(Boolean).slice(0, 40)
        : [];
      const pedomanPenulisan = cleanText(s.pedomanPenulisan, 2500);
      const activeMaterialId = cleanText(s.activeMaterialId, 80) || null;
      const activeMaterialTitle = cleanText(s.activeMaterialTitle, 200);
      const activeMaterialUrl = cleanText(s.activeMaterialUrl, 600);
      if (subject && mainTopic && Number.isInteger(durationMinutes) && durationMinutes >= 1 && durationMinutes <= 600 && syllabusItems.length > 0) {
        store.settings = {
          subject,
          mainTopic,
          heroSubtitle,
          durationMinutes,
          syllabusItems,
          pedomanPenulisan,
          activeMaterialId,
          activeMaterialTitle,
          activeMaterialUrl,
        };
      }
    }

    if (Array.isArray(body.questions)) {
      const sanitized = body.questions
        .slice(0, 300)
        .map((q, idx) => sanitizeQuestionInput(q, idx))
        .filter((q): q is StoredQuestion => q !== null);
      if (sanitized.length > 0) {
        store.questions = sanitized;
      }
    }

    if (body.studentQuestionConfig && typeof body.studentQuestionConfig === 'object') {
      const sq = body.studentQuestionConfig as Record<string, unknown>;
      const mode = sq.mode === 'all' || sq.mode === 'custom' ? sq.mode : 'preset50';
      const validIds = new Set(store.questions.map((q) => q.id));
      let selectedIds = Array.isArray(sq.selectedIds)
        ? sq.selectedIds.map((id) => cleanText(id, 60)).filter((id) => validIds.has(id))
        : [];
      if (mode === 'all') {
        selectedIds = store.questions.map((q) => q.id);
      } else if (mode === 'preset50') {
        selectedIds = store.questions.slice(0, Math.min(50, store.questions.length)).map((q) => q.id);
      }
      store.studentQuestionConfig = {
        mode,
        selectedIds,
        orderMode: sq.orderMode === 'ordered' ? 'ordered' : 'shuffle',
        version: 2,
        userCustomized: Boolean(sq.userCustomized),
        updatedAt: typeof sq.updatedAt === 'string' ? sq.updatedAt : new Date().toISOString(),
      };
    }

    if (body.tokenConfig && typeof body.tokenConfig === 'object') {
      const tc = body.tokenConfig as Record<string, unknown>;
      const cleanedCode = cleanText(tc.code, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const target = Math.max(0, Math.min(2000, Math.floor(Number(tc.targetParticipants) || 0)));
      const nextTokenMode: TokenMode =
        tc.tokenMode === 'per_class' || (tc.tokenMode !== 'global' && store.tokenConfig.tokenMode === 'per_class')
          ? 'per_class'
          : 'global';
      const nextClassList = Array.isArray(tc.classList)
        ? sanitizeClassList(tc.classList)
        : Array.isArray(store.tokenConfig.classList)
          ? store.tokenConfig.classList
          : [...DEFAULT_CLASS_LIST];
      const nextRequirePerClass =
        'requireNewTokenPerClass' in tc
          ? tc.requireNewTokenPerClass !== false
          : store.tokenConfig.requireNewTokenPerClass;

      const codeChanged = cleanedCode.length >= 4 && cleanedCode !== store.tokenConfig.code;
      const nextCode = cleanedCode.length >= 4 ? cleanedCode : store.tokenConfig.code;
      let nextBoundClass: string | null = store.tokenConfig.boundClass;

      if (codeChanged) {
        nextBoundClass = 'boundClass' in tc && tc.boundClass ? normalizeClassKeyVal(tc.boundClass) || null : null;
        if (nextRequirePerClass) {
          const conflictClass = findTokenConflictWithOtherClass(nextCode, nextBoundClass);
          if (conflictClass) {
            res.status(400).json({
              error: `Token ${nextCode} sudah digunakan oleh kelas ${conflictClass}. Token untuk kelas lainnya wajib berbeda.`,
            });
            return;
          }
        }
      } else if ('boundClass' in tc) {
        nextBoundClass = tc.boundClass ? normalizeClassKeyVal(tc.boundClass) || null : null;
      }

      store.tokenConfig = {
        ...store.tokenConfig,
        tokenMode: nextTokenMode,
        classList: nextClassList,
        code: nextCode,
        required: tc.required !== false,
        showOnLogin: tc.showOnLogin !== false,
        isActive: tc.isActive !== false,
        autoStopOnAllFinished: Boolean(tc.autoStopOnAllFinished),
        targetParticipants: target,
        requireNewTokenPerClass: nextRequirePerClass,
        boundClass: nextBoundClass,
        stoppedAt: typeof tc.stoppedAt === 'string' ? tc.stoppedAt : null,
        stoppedReason: cleanText(tc.stoppedReason, 240),
        updatedAt: typeof tc.updatedAt === 'string' ? tc.updatedAt : new Date().toISOString(),
      };
      if (nextTokenMode === 'per_class') {
        ensureClassTokensForList(store.tokenConfig.classList, false, true);
      }
      evaluateServerTokenAutoStop();
    }

    saveStoreToDisk();
    res.json({
      ok: true,
      resetEpoch: store.resetEpoch,
      settings: store.settings,
      questions: store.questions,
      studentQuestionConfig: store.studentQuestionConfig,
      tokenConfig: store.tokenConfig,
    });
  });

  app.post('/api/cbt/admin/class-token', requireAdminAuth, (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const action = cleanText(body.action, 32).toLowerCase() || 'upsert';

    if (!store.tokenConfig.classTokens) {
      store.tokenConfig.classTokens = {};
    }
    if (!Array.isArray(store.tokenConfig.classList)) {
      store.tokenConfig.classList = [...DEFAULT_CLASS_LIST];
    }

    if (action === 'apply_class_preset') {
      const presetKey = cleanText(body.preset, 40);
      const presetList = CLASS_PRESETS[presetKey];
      if (!presetList) {
        res.status(400).json({ error: 'Preset daftar kelas tidak dikenali.' });
        return;
      }
      store.tokenConfig.classList = [...presetList];
      if (store.tokenConfig.tokenMode === 'per_class') {
        ensureClassTokensForList(store.tokenConfig.classList, false, true);
      }
      store.tokenConfig.updatedAt = new Date().toISOString();
      saveStoreToDisk();
      res.json({ ok: true, tokenConfig: store.tokenConfig });
      return;
    }

    if (action === 'add_class') {
      const classKey = normalizeClassKeyVal(body.className || body.classKey);
      if (!classKey) {
        res.status(400).json({ error: 'Nama kelas wajib diisi (contoh: X-B, XI-L, XII).' });
        return;
      }
      if (!store.tokenConfig.classList.includes(classKey)) {
        store.tokenConfig.classList = [...store.tokenConfig.classList, classKey];
      }
      if (store.tokenConfig.tokenMode === 'per_class' || body.createToken) {
        ensureClassTokensForList([classKey], false, true);
      }
      store.tokenConfig.updatedAt = new Date().toISOString();
      saveStoreToDisk();
      res.json({ ok: true, tokenConfig: store.tokenConfig });
      return;
    }

    if (action === 'remove_class') {
      const classKey = normalizeClassKeyVal(body.className || body.classKey);
      if (!classKey) {
        res.status(400).json({ error: 'Nama kelas wajib disertakan.' });
        return;
      }
      const nextList = store.tokenConfig.classList.filter((c) => c !== classKey);
      if (nextList.length === 0) {
        res.status(400).json({ error: 'Minimal harus ada satu kelas dalam daftar dropdown.' });
        return;
      }
      store.tokenConfig.classList = nextList;
      delete store.tokenConfig.classTokens[classKey];
      store.tokenConfig.updatedAt = new Date().toISOString();
      saveStoreToDisk();
      res.json({ ok: true, tokenConfig: store.tokenConfig });
      return;
    }

    if (action === 'generate_batch') {
      const gradeFilter = cleanText(body.grade, 16).toUpperCase() || 'ALL';
      const targetClasses = store.tokenConfig.classList.filter(
        (c) => gradeFilter === 'ALL' || getClassGradeFromKey(c) === gradeFilter
      );
      ensureClassTokensForList(targetClasses, true, true);
      store.tokenConfig.updatedAt = new Date().toISOString();
      saveStoreToDisk();
      res.json({ ok: true, tokenConfig: store.tokenConfig });
      return;
    }

    if (action === 'toggle_batch') {
      const gradeFilter = cleanText(body.grade, 16).toUpperCase() || 'ALL';
      const nextActive = Boolean(body.isActive);
      const targetClasses = store.tokenConfig.classList.filter(
        (c) => gradeFilter === 'ALL' || getClassGradeFromKey(c) === gradeFilter
      );
      ensureClassTokensForList(targetClasses, false, nextActive);
      const nowIso = new Date().toISOString();
      for (const cls of targetClasses) {
        const key = normalizeClassKeyVal(cls);
        if (store.tokenConfig.classTokens[key]) {
          store.tokenConfig.classTokens[key].isActive = nextActive;
          store.tokenConfig.classTokens[key].updatedAt = nowIso;
        }
      }
      store.tokenConfig.updatedAt = nowIso;
      saveStoreToDisk();
      res.json({ ok: true, tokenConfig: store.tokenConfig });
      return;
    }

    const classNameRaw = cleanText(body.className || body.classKey, 40);
    const classKey = normalizeClassKeyVal(classNameRaw);

    if (!classKey) {
      res.status(400).json({ error: 'Nama Kelas wajib dipilih atau diisi.' });
      return;
    }

    if (action === 'delete') {
      delete store.tokenConfig.classTokens[classKey];
      saveStoreToDisk();
      res.json({ ok: true, tokenConfig: store.tokenConfig });
      return;
    }

    if (action === 'toggle') {
      let existing = store.tokenConfig.classTokens[classKey];
      if (!existing) {
        ensureClassTokensForList([classKey], false, Boolean(body.isActive));
        existing = store.tokenConfig.classTokens[classKey];
      } else {
        existing.isActive = Boolean(body.isActive);
        existing.updatedAt = new Date().toISOString();
      }
      saveStoreToDisk();
      res.json({ ok: true, tokenConfig: store.tokenConfig });
      return;
    }

    const customCode = cleanText(body.customCode, 20).toUpperCase().replace(/[^A-Z0-9]/g, '');
    let nextCode = '';
    if (action === 'rotate' || !customCode) {
      nextCode = generateUniqueClassTokenCode(6);
    } else {
      if (customCode.length < 4 || customCode.length > 12) {
        res.status(400).json({ error: 'Kode token kelas harus terdiri dari 4 sampai 12 huruf/angka.' });
        return;
      }
      const conflictClass = findTokenConflictWithOtherClass(customCode, classKey);
      if (conflictClass) {
        res.status(400).json({
          error: `Token ${customCode} sudah dipakai oleh kelas ${conflictClass}. Token antar kelas wajib berbeda.`,
        });
        return;
      }
      nextCode = customCode;
    }

    const nowIso = new Date().toISOString();
    const existing = store.tokenConfig.classTokens[classKey];
    if (!store.tokenConfig.classList.includes(classKey)) {
      store.tokenConfig.classList.push(classKey);
    }
    store.tokenConfig.classTokens[classKey] = {
      classKey,
      className: classKey,
      code: nextCode,
      isActive: existing ? existing.isActive : true,
      createdAt: existing?.createdAt || nowIso,
      updatedAt: nowIso,
    };
    recordClassTokenUsage(classKey, nextCode);

    saveStoreToDisk();
    res.json({ ok: true, entry: store.tokenConfig.classTokens[classKey], tokenConfig: store.tokenConfig });
  });

  app.post('/api/cbt/admin/reset-student-login', requireAdminAuth, (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const nama = cleanText(body.nama, 120);
    const username = cleanText(body.username, 60);
    const nisn = cleanText(body.nisn, 40);
    const absen = cleanText(body.absen, 16) || '-';

    if (!nama && !username && !nisn) {
      res.status(400).json({ error: 'Identitas siswa wajib disertakan untuk reset login.' });
      return;
    }

    const candidate = { nama, username, nisn, absen };
    const now = Date.now();

    const prevResult = store.results.find((r) => identityMatchesEntry(r, candidate)) || null;
    store.usedIdentities = store.usedIdentities.filter((u) => !identityMatchesEntry(u, candidate));
    store.results = store.results.filter((r) => !identityMatchesEntry(r, candidate));

    const snap = (store.savedSessions || []).find((s) => sessionSnapshotMatchesStudent(s, candidate)) || null;
    if (snap) {
      snap.warningCount = 0;
      snap.violations = [];
      snap.unlockedByAdmin = true;
      snap.unlockedAt = now;
      snap.savedAt = now;
    }

    const monIdx = store.monitoring.findIndex((m) => identityMatchesEntry(m, candidate));
    if (monIdx >= 0) {
      const existingMon = store.monitoring[monIdx];
      const totalQ = snap ? snap.questionOrder.length : existingMon.totalQuestions;
      const answeredQ = snap ? countAnsweredFromSnapshot(snap) : existingMon.answeredCount;
      const pct = totalQ > 0 ? Math.min(100, Math.round((answeredQ / totalQ) * 100)) : existingMon.percentage;
      const updatedMon: MonitoringRecord = {
        ...existingMon,
        status: 'Belum Mulai',
        answeredCount: answeredQ,
        totalQuestions: totalQ,
        percentage: pct,
        currentNumber: snap ? (snap.currentIndex || 0) + 1 : existingMon.currentNumber,
        flaggedCount: snap ? Object.keys(snap.flagged || {}).length : existingMon.flaggedCount,
        warningCount: 0,
        terminatedByViolation: false,
        loginResetAt: now,
        lastActivityAt: now,
      };
      delete updatedMon.completedAt;
      store.monitoring[monIdx] = updatedMon;
    } else if (prevResult || snap) {
      const totalQ = snap ? snap.questionOrder.length : prevResult?.totalQuestions || 0;
      const answeredQ = snap ? countAnsweredFromSnapshot(snap) : prevResult?.answeredCount || 0;
      const pct = totalQ > 0 ? Math.min(100, Math.round((answeredQ / totalQ) * 100)) : 0;
      store.monitoring.push({
        nama: nama || prevResult?.nama || snap?.studentNama || '',
        username: username || prevResult?.username || snap?.studentUsername || '',
        nisn: nisn || prevResult?.nisn || snap?.studentNisn || '',
        absen: absen || prevResult?.absen || snap?.studentAbsen || '-',
        status: 'Belum Mulai',
        answeredCount: answeredQ,
        totalQuestions: totalQ,
        percentage: pct,
        currentNumber: snap ? (snap.currentIndex || 0) + 1 : 0,
        flaggedCount: snap ? Object.keys(snap.flagged || {}).length : 0,
        warningCount: 0,
        terminatedByViolation: false,
        loginResetAt: now,
        lastActivityAt: now,
      });
    }

    saveStoreToDisk();
    res.json({
      ok: true,
      loginResetAt: now,
      hasResumableSession: Boolean(snap && snap.questionOrder.length > 0),
      monitoring: store.monitoring,
      results: store.results,
      usedIdentities: store.usedIdentities,
      resetEpoch: store.resetEpoch,
    });
  });

  app.post('/api/cbt/admin/reset-locks', requireAdminAuth, (_req: Request, res: Response) => {
    store.usedIdentities = [];
    store.resetEpoch += 1;
    saveStoreToDisk();
    res.json({ ok: true, resetEpoch: store.resetEpoch });
  });

  app.post('/api/cbt/admin/clear-results', requireAdminAuth, (_req: Request, res: Response) => {
    store.results = [];
    store.usedIdentities = [];
    store.monitoring = [];
    store.savedSessions = [];
    store.tokenConfig.boundClass = null;
    store.resetEpoch += 1;
    saveStoreToDisk();
    res.json({ ok: true, resetEpoch: store.resetEpoch, tokenConfig: store.tokenConfig });
  });

  app.post('/api/ai/generate-questions', requireAdminAuth, async (req: Request, res: Response) => {
    try {
      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error: 'GEMINI_API_KEY belum tersedia. Pastikan API key sudah dikonfigurasi di panel Settings > Secrets.',
        });
        return;
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const subject = cleanText(body.subject, 160);
      const mainTopic = cleanText(body.mainTopic, 300);

      if (!subject || !mainTopic) {
        res.status(400).json({ error: 'Mata Pelajaran dan Materi Pokok wajib tersedia di Cakupan Materi.' });
        return;
      }

      const rawSyllabus = Array.isArray(body.syllabusItems) ? body.syllabusItems : [];
      const syllabusItems: string[] = rawSyllabus
        .map((s: unknown) => cleanText(s, 250))
        .filter((s: string) => s.length > 0)
        .slice(0, 30);

      if (syllabusItems.length === 0) {
        res.status(400).json({ error: 'Minimal harus ada satu poin pada Cakupan Materi Ujian.' });
        return;
      }

      const rawSpecs = Array.isArray(body.batchSpecs) ? body.batchSpecs : [];
      const batchSpecs: BatchSpec[] = [];
      let totalRequested = 0;

      for (const spec of rawSpecs) {
        if (!spec || typeof spec !== 'object') continue;
        const typeStr = cleanText((spec as Record<string, unknown>).type, 30).toLowerCase();
        const countNum = Number((spec as Record<string, unknown>).count);
        if (!ALLOWED_TYPES.has(typeStr)) continue;
        if (!Number.isInteger(countNum) || countNum < 1 || countNum > 25) continue;
        batchSpecs.push({ type: typeStr as QuestionType, count: countNum });
        totalRequested += countNum;
      }

      if (batchSpecs.length === 0 || totalRequested < 1 || totalRequested > 25) {
        res.status(400).json({ error: 'Jumlah soal per batch harus antara 1 sampai 25 butir.' });
        return;
      }

      const difficultyRaw = cleanText(body.difficulty, 20).toLowerCase();
      const difficulty: DifficultyLevel = ALLOWED_DIFFICULTIES.has(difficultyRaw)
        ? (difficultyRaw as DifficultyLevel)
        : 'standar';

      const customInstruction = cleanText(body.customInstruction, 500);
      const pedomanPenulisan = cleanText(body.pedomanPenulisan, 2500) || cleanText(store.settings.pedomanPenulisan, 2500);
      const batchIndex = Math.max(1, Number.isInteger(Number(body.batchIndex)) ? Number(body.batchIndex) : 1);
      const totalBatches = Math.max(batchIndex, Number.isInteger(Number(body.totalBatches)) ? Number(body.totalBatches) : 1);
      const avoidSummaries = Array.isArray(body.avoidSummaries)
        ? body.avoidSummaries.map((s: unknown) => cleanText(s, 120)).filter(Boolean).slice(-60)
        : [];

      const expectedTypes: QuestionType[] = [];
      batchSpecs.forEach((spec) => {
        for (let i = 0; i < spec.count; i++) {
          expectedTypes.push(spec.type);
        }
      });

      const prompt = buildGenerationPrompt({
        subject,
        mainTopic,
        syllabusItems,
        batchSpecs,
        difficulty,
        customInstruction,
        batchIndex,
        totalBatches,
        avoidSummaries,
        pedomanPenulisan,
      });

      const questions = await generateBatchWithRetry(
        ai,
        prompt,
        totalRequested,
        expectedTypes,
        syllabusItems
      );

      res.json({ questions });
    } catch (err) {
      console.error('Error generating AI questions:', err);
      const rawMsg = err instanceof Error ? err.message : 'Terjadi kesalahan saat menghubungi layanan AI.';

      if (rawMsg.includes('API_KEY_INVALID') || rawMsg.includes('PERMISSION_DENIED') || rawMsg.includes('403')) {
        res.status(403).json({
          error: 'Akses Gemini API ditolak atau API key tidak valid. Periksa GEMINI_API_KEY di panel Settings > Secrets.',
        });
        return;
      }
      if (rawMsg.includes('RESOURCE_EXHAUSTED') || rawMsg.includes('429')) {
        res.status(429).json({
          error: 'Kuota permintaan AI sedang penuh (429). Silakan tunggu beberapa saat dan coba lagi.',
        });
        return;
      }

      res.status(502).json({
        error: `Gagal menghasilkan soal dari AI: ${rawMsg.slice(0, 220)}`,
      });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`CBT ONLINE server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
