/**
 * מודול זכאות לבגרות — שכבת הנתונים.
 *
 * הכול נטען לסבב אחד ונשמר בזיכרון, בדיוק כמו המצבת ("הכל ואז מצמצמים"):
 * סבב של בית ספר הוא כמה מאות תלמידים וכמה אלפי ציונים, והסינון, המיון
 * והמעבר בין המסכים קורים בדפדפן. ההיקף (מי רואה מה) נאכף ב-RLS
 * (מיגרציה 026) — מה שמגיע לכאן הוא כבר רק מה שמותר.
 */
import { supabase } from '@/lib/supabase'

// ─────────────────────────────── טיפוסים ───────────────────────────────

export interface BagrutRound {
  id: string
  authority_code: string
  school_code: string
  school_name: string | null
  season: 'קיץ' | 'חורף'
  school_year: string
  graduating_grade: string | null
  stats: Record<string, number>
  created_at: string
}

export type SubjectGroup = 'חובה' | 'אנגלית ומתמטיקה' | 'מורחב' | 'פנימי'
export const SUBJECT_GROUPS: SubjectGroup[] = ['חובה', 'אנגלית ומתמטיקה', 'מורחב', 'פנימי']

export interface RoundSubject {
  subject_key: string
  subject_name: string
  subject_group: SubjectGroup
  units: number | null
  sort: number
}

export interface ProgramRow {
  subject_key: string
  questionnaire_code: number
  weight: number | null
  sort: number
  notes: string | null
  /** שאלונים שקולים ("או/או") באותו מקצוע חולקים מספר — נספר אחד מהם. מיגרציה 028 */
  alt_group: number | null
}

/**
 * סכום המשקלים של מקצוע במצפן, כשכל קבוצת שאלונים שקולים נספרת פעם אחת.
 * 150% של זוג שקול הוא 100% — לא אזהרה.
 */
export function programWeightSum(rows: ProgramRow[]): number {
  const seen = new Set<number>()
  let sum = 0
  for (const r of rows) {
    if (r.alt_group != null) {
      if (seen.has(r.alt_group)) continue
      seen.add(r.alt_group)
    }
    sum += r.weight ?? 0
  }
  return sum
}

export interface Questionnaire {
  code: number
  subject_name: string | null
  exam_form: string | null
  exam_kind: string | null
  units: number | null
  relation: string | null
}

export interface BagrutStudent {
  student_id: string
  school_code: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  grade: string | null
  class_name: string | null
  track: string | null
  missing_status: string | null
  in_t2: boolean
  status: string | null
  done_summary: string | null
  grades_summary: string | null
  blockers: string | null
  intervention: string | null
  one_negative_option: string | null
  compensation_pair: string | null
  compensation_eligible: string | null
  negatives_count: number | null
  mother_tongue_status: string | null
  core_units: number | null
  reinforced_subject: string | null
  total_units: string | null
  reason: string | null
}

export interface GradeRow {
  student_id: string
  subject_key: string
  questionnaire_code: number
  grade: number | null
  weight: number | null
  weighted: number | null
}

export interface SubjectRow {
  student_id: string
  subject_key: string
  final_grade: number | null
  cumulative_grade: number | null
  units: number | null
  questionnaires: string | null
  cumulative_weight: number | null
  completion_status: string | null
}

export interface Tracking {
  student_id: string
  suspected: boolean
  has_blocker: boolean
  fighting: boolean
  zero_chance: boolean
  note_short: string | null
  note_long: string | null
  /** מועד המעקב הבא (YYYY-MM-DD). מיגרציה 029 */
  next_followup: string | null
  /** גורמים שאינם בציונים — מתוך CYCLE_FACTORS */
  factors: string[]
  factors_note: string | null
  updated_at: string | null
}

const TRACKING_COLS = 'student_id, suspected, has_blocker, fighting, zero_chance, note_short, note_long, next_followup, factors, factors_note, updated_at'

export const TRACKING_FLAGS = [
  { key: 'fighting', label: 'נלחמים על הזכאות', short: 'נלחמים', icon: '🚩' },
  { key: 'has_blocker', label: 'יש חסם', short: 'חסם', icon: '⛔' },
  { key: 'suspected', label: 'קיבל חשד (טוהר בחינות)', short: 'חשד', icon: '⚠' },
  { key: 'zero_chance', label: 'סיכוי אפסי לזכאות', short: 'אפסי', icon: '○' },
] as const
export type TrackingFlag = (typeof TRACKING_FLAGS)[number]['key']

export interface RoundData {
  round: BagrutRound
  subjects: RoundSubject[]
  program: ProgramRow[]
  questionnaires: Map<number, Questionnaire>
  students: BagrutStudent[]
  grades: GradeRow[]
  subjectRows: SubjectRow[]
  tracking: Map<string, Tracking>
  /** תוכנית ההתערבות לכל תלמיד — ספירות בלבד, לרשימה ולפס המצב */
  actionCounts: Map<string, ActionCounts>
}

export interface ActionCounts {
  active: number
  done: number
}

// ─────────────────────────────── סיווג ───────────────────────────────

/**
 * סטטוס הזכאות מגיע מניתוח הזכאות (T2) כטקסט חופשי ("זכאי לפי T1 — בכפוף
 * לדרישות פנימיות"). כאן הוא הופך לאחד משלושה סטטוסים — ושם, ולא ברכיבים,
 * יושבת ההחלטה איך לקרוא כל נוסח.
 *
 * שלושה בלבד (פגישת 5.10): אין זכאות · זכאי · זכאי במסלול שלילי אחד.
 * "בכפוף לדרישות פנימיות" נכלל ב"זכאי" — דרישות פנימיות אינן נמדדות כאן,
 * הן עניין של בית הספר.
 */
export type EligibilityKind =
  | 'eligible'
  | 'one_negative'
  | 'not_eligible'
  | 'not_graduating'

export const ELIGIBILITY_META: Record<
  EligibilityKind,
  { label: string; short: string; tone: 'green' | 'teal' | 'amber' | 'red' | 'slate' }
> = {
  eligible: { label: 'זכאי', short: 'זכאי', tone: 'green' },
  one_negative: { label: 'זכאי במסלול שלילי אחד', short: 'שלילי אחד', tone: 'amber' },
  not_eligible: { label: 'אין זכאות', short: 'אין זכאות', tone: 'red' },
  not_graduating: { label: 'לא בשכבה המסיימת', short: '—', tone: 'slate' },
}

export function eligibilityKind(s: BagrutStudent): EligibilityKind {
  if (!s.in_t2 || !s.status) return 'not_graduating'
  const t = s.status
  if (t.includes('אין זכאות')) return 'not_eligible'
  if (t.includes('שלילי אחד')) return 'one_negative'
  if (t.includes('זכאי')) return 'eligible'
  return 'not_eligible'
}

export function isEligible(kind: EligibilityKind): boolean {
  return kind === 'eligible' || kind === 'one_negative'
}

/**
 * החסמים ב-T2 בנויים מתבנית קבועה, מופרדים ב-";". פירוק לקטגוריות מאפשר
 * לספור ("37 תלמידים בלי מקצוע מוגבר") ולסנן לפיהן, במקום להציג טקסט.
 */
export type BlockerKind = 'units' | 'core_units' | 'no_reinforced' | 'missing_required' | 'negatives' | 'other'

export interface Blocker {
  kind: BlockerKind
  text: string
  /** למקצועות חובה חסרים — שמות המקצועות */
  subjects?: string[]
}

export const BLOCKER_LABELS: Record<BlockerKind, string> = {
  units: 'חסרות יח"ל להשלמת 21',
  core_units: 'חסרות יח"ל במקצועות המלל',
  no_reinforced: 'אין מקצוע מוגבר שעבר',
  missing_required: 'חסרים מקצועות חובה',
  negatives: 'ציונים שליליים',
  other: 'אחר',
}

export function parseBlockers(text: string | null): Blocker[] {
  if (!text) return []
  return text
    .split(';')
    .map((p) => p.trim().replace(/\.$/, ''))
    .filter((p) => p && !p.startsWith('לא אותרו חסמים'))
    .map((p): Blocker => {
      if (p.startsWith('חסרים מקצועות חובה')) {
        const list = p.split(':')[1] ?? ''
        return {
          kind: 'missing_required',
          text: p,
          // "מתמטיקה - יש לה חסם ציון 3 במתמטיקה" (רמות זבולון): ההסבר שאחרי
          // המקף אינו חלק משם המקצוע — אחרת הוא הופך ל"מקצוע" נפרד בספירה.
          subjects: list.split(',').map((x) => x.split(' - ')[0].trim()).filter(Boolean),
        }
      }
      if (/יח"ל מלל/.test(p)) return { kind: 'core_units', text: p }
      if (/^חסרות \d+ יח"ל/.test(p)) return { kind: 'units', text: p }
      if (p.includes('מוגבר')) return { kind: 'no_reinforced', text: p }
      if (p.startsWith('ציונים שליליים')) return { kind: 'negatives', text: p }
      return { kind: 'other', text: p }
    })
}

/** "על הסף" — אין זכאות, וחסם אחד בלבד. הגדרה שקופה, בלי ניחוש. */
export function isOnTheEdge(s: BagrutStudent): boolean {
  return eligibilityKind(s) === 'not_eligible' && parseBlockers(s.blockers).length === 1
}

/** ציון → גוון. חסם 1–4 אינו נספר (חוקת הזכאות Z-8) — ומסומן בנפרד. */
export type GradeTone = 'fail' | 'pass' | 'blocked' | 'none'
export function gradeTone(g: number | null | undefined): GradeTone {
  if (g == null) return 'none'
  if (g >= 1 && g <= 4) return 'blocked'
  // מתחת ל-55 אדום — כך הצוותים רגילים לקרוא (פגישת 5.10). "נכשל מותר"
  // 45–54 (Z-7) הוא עניין של ניתוח הזכאות, לא של צבע הציון.
  if (g < 55) return 'fail'
  return 'pass'
}

export type Completion = 'done' | 'progress' | 'not_started' | 'unknown'
export function completion(status: string | null | undefined): Completion {
  if (!status) return 'unknown'
  if (status.includes('הושלם')) return 'done'
  if (status.includes('בתהליך')) return 'progress'
  if (status.includes('טרם')) return 'not_started'
  return 'unknown'
}

/** "יג-5" → 5 למיון טבעי של כיתות */
export function classSortKey(c: string | null): string {
  if (!c) return '￿'
  const m = c.match(/^(.*?)-?(\d+)$/)
  return m ? `${m[1]}-${m[2].padStart(3, '0')}` : c
}

export function displayName(s: BagrutStudent): string {
  return s.full_name ?? [s.first_name, s.last_name].filter(Boolean).join(' ') ?? s.student_id
}

// ─────────────────────────────── טעינה ───────────────────────────────

/** שליפה בדפים של 1000 — הגבול של PostgREST לבקשה אחת. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

export async function fetchRounds(authorityCode: string): Promise<BagrutRound[]> {
  const { data, error } = await supabase
    .from('bagrut_rounds')
    .select('id, authority_code, school_code, school_name, season, school_year, graduating_grade, stats, created_at')
    .eq('authority_code', authorityCode)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`טעינת הסבבים נכשלה: ${error.message}`)
  return (data ?? []) as BagrutRound[]
}

const cache = new Map<string, Promise<RoundData>>()

export function clearRoundCache(roundId?: string) {
  if (roundId) cache.delete(roundId)
  else cache.clear()
}

export function loadRound(round: BagrutRound): Promise<RoundData> {
  const hit = cache.get(round.id)
  if (hit) return hit
  const p = doLoadRound(round).catch((e) => {
    cache.delete(round.id)
    throw e
  })
  cache.set(round.id, p)
  return p
}

async function doLoadRound(round: BagrutRound): Promise<RoundData> {
  const rid = round.id
  // שלב לכל בקשה בהודעת השגיאה (מלכודת 15): "הטעינה נכשלה" לבדו לא אומר איפה.
  const step = async <T,>(label: string, p: Promise<T>): Promise<T> => {
    try {
      return await p
    } catch (e) {
      throw new Error(`${label}: ${(e as Error).message}`)
    }
  }

  const [subjects, program, students, grades, subjectRows, tracking, actions] = await Promise.all([
    step('מקצועות הסבב', fetchAll<RoundSubject>((f, t) =>
      supabase.from('bagrut_round_subjects').select('*').eq('round_id', rid).order('sort').range(f, t))),
    step('המצפן', fetchAll<ProgramRow>((f, t) =>
      supabase.from('bagrut_program').select('*').eq('round_id', rid).order('sort').range(f, t))),
    step('תלמידים', fetchAll<BagrutStudent>((f, t) =>
      supabase.from('bagrut_students').select('*').eq('round_id', rid).order('student_id').range(f, t))),
    step('ציונים', fetchAll<GradeRow>((f, t) =>
      supabase.from('bagrut_grades').select('student_id, subject_key, questionnaire_code, grade, weight, weighted')
        .eq('round_id', rid).order('student_id').order('subject_key').order('questionnaire_code').range(f, t))),
    step('מדדי מקצוע', fetchAll<SubjectRow>((f, t) =>
      supabase.from('bagrut_subjects').select('student_id, subject_key, final_grade, cumulative_grade, units, questionnaires, cumulative_weight, completion_status')
        .eq('round_id', rid).order('student_id').order('subject_key').range(f, t))),
    step('מעקב', fetchAll<Tracking>((f, t) =>
      supabase.from('bagrut_tracking').select(TRACKING_COLS)
        .eq('authority_code', round.authority_code).eq('school_code', round.school_code)
        .order('student_id').range(f, t))),
    step('תוכניות התערבות', fetchAll<{ student_id: string; status: BagrutAction['status'] }>((f, t) =>
      supabase.from('bagrut_actions').select('student_id, status')
        .eq('authority_code', round.authority_code).eq('school_code', round.school_code)
        .neq('status', 'dismissed').order('student_id').range(f, t))),
  ])

  const actionCounts = new Map<string, ActionCounts>()
  for (const a of actions) {
    const c = actionCounts.get(a.student_id) ?? { active: 0, done: 0 }
    if (a.status === 'active') c.active++
    else if (a.status === 'done') c.done++
    actionCounts.set(a.student_id, c)
  }

  const codes = [...new Set([...program.map((p) => p.questionnaire_code), ...grades.map((g) => g.questionnaire_code)])]
  const qs = await step('אינדקס השאלונים', fetchAll<Questionnaire>((f, t) =>
    supabase.from('bagrut_questionnaires').select('code, subject_name, exam_form, exam_kind, units, relation')
      .in('code', codes).order('code').range(f, t)))

  return {
    round,
    subjects,
    program,
    questionnaires: new Map(qs.map((q) => [q.code, q])),
    students,
    grades,
    subjectRows,
    tracking: new Map(tracking.map((t) => [t.student_id, t])),
    actionCounts,
  }
}

// ─────────────────────────────── מעקב — כתיבה ───────────────────────────────

/**
 * שמירת שדה מעקב. upsert — השורה נוצרת בפעם הראשונה שמסמנים משהו.
 * מחזיר את השורה **כפי שהשרת שמר אותה** (מלכודת 26): המסך מחיל את
 * התשובה, ולא מסתמך על טעינה מחדש כדי לראות את השינוי.
 */
export async function saveTracking(
  round: BagrutRound,
  studentId: string,
  patch: Partial<Omit<Tracking, 'student_id' | 'updated_at'>>,
  current: Tracking | undefined,
): Promise<Tracking> {
  const row = {
    authority_code: round.authority_code,
    school_code: round.school_code,
    student_id: studentId,
    suspected: current?.suspected ?? false,
    has_blocker: current?.has_blocker ?? false,
    fighting: current?.fighting ?? false,
    zero_chance: current?.zero_chance ?? false,
    note_short: current?.note_short ?? null,
    note_long: current?.note_long ?? null,
    next_followup: current?.next_followup ?? null,
    factors: current?.factors ?? [],
    factors_note: current?.factors_note ?? null,
    ...patch,
  }
  const { data, error } = await supabase
    .from('bagrut_tracking')
    .upsert(row, { onConflict: 'authority_code,school_code,student_id' })
    .select(TRACKING_COLS)
    .single()
  if (error) throw new Error(`שמירת המעקב נכשלה: ${error.message}`)
  // RLS שחוסם כתיבה לא תמיד זורק (מלכודת 21) — שורה שלא חזרה = לא נשמר.
  if (!data) throw new Error('שמירת המעקב נחסמה — אין לך הרשאה לעדכן את התלמיד הזה')
  return data as Tracking
}

// ─────────────────────────────── מחזור ההתערבות ───────────────────────────────
//
// תוכנית פעולה ויומן מעקב לתלמיד (מיגרציה 029, docs/bagrut-intervention-design.md).
// לפי בית ספר + ת"ז, בלי סבב — כמו המעקב. ⚠️ זכאות נקבעת רק לפי T2
// (decisions/014 §8): פעולה מטפלת בפריט מההתערבות של T2, ואינה מבטיחה זכאות.

export interface BagrutAction {
  id: string
  student_id: string
  /** הפריט של T2 שממנו נולדה ההצעה. null = ידנית */
  suggest_key: string | null
  title: string
  detail: string | null
  action_type: string | null
  subject_key: string | null
  questionnaire_code: number | null
  required_grade: number | null
  owner: string | null
  due_label: string | null
  status: 'active' | 'done' | 'dismissed'
  outcome: string | null
  created_at: string
  updated_at: string
}

export type LogKind = 'student' | 'parents' | 'staff' | 'update'
export const LOG_KIND_LABELS: Record<LogKind, string> = {
  student: 'שיחה עם התלמיד',
  parents: 'שיחה עם ההורים',
  staff: 'ישיבת צוות',
  update: 'עדכון',
}

export interface BagrutLogEntry {
  id: string
  student_id: string
  kind: LogKind
  happened_on: string
  participants: string | null
  summary: string | null
  agreements: string | null
  next_step: string | null
  next_followup: string | null
  created_at: string
}

/** סוגי פעולה — ברירת מחדל. בעתיד לכל רשות (bagrut_cycle_config, שלב מאוחר) */
export const ACTION_TYPES = [
  'תגבור', 'שיפור ציון במועד הבא', 'בחינה חוזרת', 'השלמת שאלון', 'עבודה חלופית',
  'התאמות בבחינה', 'מעבר רמה', 'שיחה עם הורים', 'הפניה ליועצת', 'בדיקה מול בית הספר', 'אחר',
]
export const ACTION_OWNERS = ['מורה המקצוע', 'מחנך', 'רכז הבגרויות', 'יועצת', 'התלמיד']
/** גורמים שאינם בציונים — מה שמסביר את הציון ומשנה את סוג ההתערבות */
export const CYCLE_FACTORS = ['נוכחות', 'מוטיבציה', 'קשיי למידה / התאמות בבחינה', 'מצב אישי או משפחתי', 'עבודה אחרי הלימודים']

const ACTION_COLS = 'id, student_id, suggest_key, title, detail, action_type, subject_key, questionnaire_code, required_grade, owner, due_label, status, outcome, created_at, updated_at'
const LOG_COLS = 'id, student_id, kind, happened_on, participants, summary, agreements, next_step, next_followup, created_at'

const studentKey = (round: BagrutRound, studentId: string) => ({
  authority_code: round.authority_code,
  school_code: round.school_code,
  student_id: studentId,
})

export async function fetchStudentCycle(round: BagrutRound, studentId: string): Promise<{ actions: BagrutAction[]; log: BagrutLogEntry[] }> {
  const k = studentKey(round, studentId)
  const [a, l] = await Promise.all([
    supabase.from('bagrut_actions').select(ACTION_COLS).match(k).order('created_at'),
    supabase.from('bagrut_log').select(LOG_COLS).match(k).order('happened_on', { ascending: false }).order('created_at', { ascending: false }),
  ])
  if (a.error) throw new Error(`טעינת התוכנית נכשלה: ${a.error.message}`)
  if (l.error) throw new Error(`טעינת היומן נכשלה: ${l.error.message}`)
  return { actions: (a.data ?? []) as BagrutAction[], log: (l.data ?? []) as BagrutLogEntry[] }
}

type ActionInput = Partial<Omit<BagrutAction, 'id' | 'student_id' | 'created_at' | 'updated_at'>> & { title: string }

/** מחזיר את השורה כפי שהשרת שמר (מלכודת 26); שורה שלא חזרה = RLS חסם (מלכודת 21) */
export async function createAction(round: BagrutRound, studentId: string, input: ActionInput): Promise<BagrutAction> {
  const { data, error } = await supabase.from('bagrut_actions')
    .insert({ ...studentKey(round, studentId), ...input }).select(ACTION_COLS).single()
  if (error) throw new Error(`הוספת הפעולה נכשלה: ${error.message}`)
  if (!data) throw new Error('הוספת הפעולה נחסמה — אין לך הרשאה לעדכן את התלמיד הזה')
  return data as BagrutAction
}

export async function updateAction(id: string, patch: Partial<ActionInput>): Promise<BagrutAction> {
  const { data, error } = await supabase.from('bagrut_actions').update(patch).eq('id', id).select(ACTION_COLS).maybeSingle()
  if (error) throw new Error(`עדכון הפעולה נכשל: ${error.message}`)
  if (!data) throw new Error('עדכון הפעולה נחסם — אין לך הרשאה לעדכן את התלמיד הזה')
  return data as BagrutAction
}

export async function deleteAction(id: string): Promise<void> {
  const { data, error } = await supabase.from('bagrut_actions').delete().eq('id', id).select('id')
  if (error) throw new Error(`מחיקת הפעולה נכשלה: ${error.message}`)
  if (!data?.length) throw new Error('מחיקת הפעולה נחסמה — אין לך הרשאה')
}

type LogInput = Omit<BagrutLogEntry, 'id' | 'student_id' | 'created_at'>

export async function createLogEntry(round: BagrutRound, studentId: string, input: LogInput): Promise<BagrutLogEntry> {
  const { data, error } = await supabase.from('bagrut_log')
    .insert({ ...studentKey(round, studentId), ...input }).select(LOG_COLS).single()
  if (error) throw new Error(`שמירת הרשומה נכשלה: ${error.message}`)
  if (!data) throw new Error('שמירת הרשומה נחסמה — אין לך הרשאה לעדכן את התלמיד הזה')
  return data as BagrutLogEntry
}

export async function deleteLogEntry(id: string): Promise<void> {
  const { data, error } = await supabase.from('bagrut_log').delete().eq('id', id).select('id')
  if (error) throw new Error(`מחיקת הרשומה נכשלה: ${error.message}`)
  if (!data?.length) throw new Error('מחיקת הרשומה נחסמה — אין לך הרשאה')
}

// ─────────────────────────────── קליטת סבב ───────────────────────────────
//
// בדפוס של העלאת המצב"ת (lib/admin.ts → uploadMoeFiles): קבצים לבאקט,
// רשומה ב-bagrut_uploads בסטטוס pending, והסוכן לוקח משם. המבנה קבוע —
// אין מיפוי ואין אישור. ראה מיגרציה 027.

export type BagrutRole = 'details' | 't1_11' | 't1_12' | 't1_13' | 't1' | 't2' | 'compass' | 'accdb'

export const BAGRUT_ROLE_LABELS: Record<BagrutRole, string> = {
  details: 'פרטי תלמידים (זכאות 1)',
  t1_11: 'T1 — מקצועות המלל (זכאות 11)',
  t1_12: 'T1 — אנגלית ומתמטיקה (זכאות 12)',
  t1_13: 'T1 — מקצועות הרחבה (זכאות 13)',
  t1: 'T1 — קובץ מאוחד, כל המקצועות',
  t2: 'T2 — ניתוח זכאות',
  compass: 'המצפן — מפת השאלונים',
  accdb: 'קובץ אקסס (במקום ייצוא האקסל)',
}

/** תפקיד הקובץ לפי שמו — אותם כללים שהסוכן ו-load_bagrut משתמשים בהם. */
export function detectBagrutRole(name: string): BagrutRole | null {
  const n = name.trim()
  if (/\.accdb$/i.test(n)) return 'accdb'
  if (!/\.xlsx$/i.test(n)) return null
  // "זכאות 1 " עם רווח — אחרת היא תופסת גם את 11–14
  if (/^זכאות 1\s/.test(n)) return 'details'
  if (/^זכאות 11/.test(n)) return 't1_11'
  if (/^זכאות 12/.test(n)) return 't1_12'
  if (/^זכאות 13/.test(n)) return 't1_13'
  if (/^זכאות 14/.test(n)) return 't2'
  // המבנה המאוחד: "אגיאל_T1_נתוני_זכאות….xlsx", "אגיאל_T2_ניתוח_זכאות….xlsx"
  if (/(^|[^A-Za-z0-9])T1([^0-9]|$)/.test(n)) return 't1'
  if (/(^|[^A-Za-z0-9])T2([^0-9]|$)/.test(n)) return 't2'
  if (/שאלונים|מצפן/.test(n)) return 'compass'
  return null
}

/** מה חסר כדי שהסבב יהיה שלם. ריק = אפשר להעלות. */
export function missingBagrutRoles(roles: BagrutRole[]): BagrutRole[] {
  const has = (r: BagrutRole) => roles.includes(r)
  const need: BagrutRole[] = has('accdb')
    ? ['compass']
    : has('t1')
      ? ['t1', 't2', 'compass']
      : ['details', 't1_11', 't1_12', 't1_13', 't2', 'compass']
  return need.filter((r) => !has(r))
}

export interface BagrutUploadReport {
  school_name?: string
  counts?: { students?: number; t2?: number; grades?: number; subjects?: number; program?: number; tracking?: number; by_grade?: Record<string, number> }
  warnings?: { kind: string; text: string }[]
  errors?: string[]
  round_id?: string
  program_source?: string
}

export interface BagrutUpload {
  id: string
  school_code: string
  season: string
  school_year: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  file_count: number | null
  files: Record<string, string>
  uploaded_at: string
  processed_at: string | null
  round_id: string | null
  rows_loaded: number | null
  report: BagrutUploadReport | null
  error_message: string | null
}

export async function fetchBagrutUploads(authorityCode: string): Promise<BagrutUpload[]> {
  const { data, error } = await supabase
    .from('bagrut_uploads')
    .select('id, school_code, season, school_year, status, file_count, files, uploaded_at, processed_at, round_id, rows_loaded, report, error_message')
    .eq('authority_code', authorityCode)
    .order('uploaded_at', { ascending: false })
    .limit(30)
  if (error) throw new Error(`טעינת היסטוריית הקליטות נכשלה: ${error.message}`)
  return (data ?? []) as BagrutUpload[]
}

/**
 * מעלה את קובצי הסבב ורושם אותו בתור. בבאקט כל קובץ נקרא לפי התפקיד שלו
 * (details.xlsx, t1_13_2.xlsx…) — Storage פוסל עברית (מלכודת 31). השם
 * המקורי נשמר ב-files, והסוכן מחזיר את השם העברי לפני הטעינה.
 */
export async function uploadBagrutRound(
  authorityCode: string,
  meta: { school: string; season: 'קיץ' | 'חורף'; year: string },
  files: { file: File; role: BagrutRole }[],
): Promise<void> {
  const prefix = `${authorityCode}/bagrut/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`
  const names: Record<string, string> = {}
  let part = 0
  let i = 0
  for (const { file, role } of files) {
    i += 1
    const key = role === 't1_13' ? `t1_13_${++part}` : role
    const ext = role === 'accdb' ? 'accdb' : 'xlsx'
    const where = `העלאת קובץ ${i}/${files.length} (${file.name}, ${(file.size / 1e6).toFixed(1)}MB)`
    const { error } = await supabase.storage.from('moe-uploads').upload(`${prefix}/${key}.${ext}`, file)
    if (error) throw new Error(`${where} — ${error.message}`)
    names[key] = file.name
  }
  const { error } = await supabase.from('bagrut_uploads').insert({
    authority_code: authorityCode,
    school_code: meta.school,
    season: meta.season,
    school_year: meta.year,
    storage_prefix: prefix,
    file_count: files.length,
    files: names,
    status: 'pending',
  })
  if (error) throw new Error(`רישום הקליטה — ${error.message}`)
}

// ─────────────────────────────── עזרי תצוגה ───────────────────────────────

/** אינדקסים שכל המסכים צריכים — נבנים פעם אחת לסבב. */
export interface RoundIndex {
  studentById: Map<string, BagrutStudent>
  subjectByKey: Map<string, RoundSubject>
  /** ת"ז → מקצוע → שורת מדדים */
  metrics: Map<string, Map<string, SubjectRow>>
  /** ת"ז → מקצוע → ציוני שאלונים */
  gradesByStudent: Map<string, Map<string, GradeRow[]>>
  /** מקצוע → שאלונים במצפן, לפי הסדר */
  programBySubject: Map<string, ProgramRow[]>
  /** מקצוע → כל סמלי השאלון שהופיעו (מצפן ∪ ציונים), לפי הסדר */
  questionnairesBySubject: Map<string, number[]>
}

export function buildIndex(d: RoundData): RoundIndex {
  const metrics = new Map<string, Map<string, SubjectRow>>()
  for (const r of d.subjectRows) {
    if (!metrics.has(r.student_id)) metrics.set(r.student_id, new Map())
    metrics.get(r.student_id)!.set(r.subject_key, r)
  }
  const gradesByStudent = new Map<string, Map<string, GradeRow[]>>()
  const seen = new Map<string, Set<number>>()
  for (const g of d.grades) {
    if (!gradesByStudent.has(g.student_id)) gradesByStudent.set(g.student_id, new Map())
    const bySub = gradesByStudent.get(g.student_id)!
    if (!bySub.has(g.subject_key)) bySub.set(g.subject_key, [])
    bySub.get(g.subject_key)!.push(g)
    if (!seen.has(g.subject_key)) seen.set(g.subject_key, new Set())
    seen.get(g.subject_key)!.add(g.questionnaire_code)
  }
  const programBySubject = new Map<string, ProgramRow[]>()
  for (const p of d.program) {
    if (!programBySubject.has(p.subject_key)) programBySubject.set(p.subject_key, [])
    programBySubject.get(p.subject_key)!.push(p)
  }
  const questionnairesBySubject = new Map<string, number[]>()
  for (const s of d.subjects) {
    const fromProgram = (programBySubject.get(s.subject_key) ?? []).map((p) => p.questionnaire_code)
    const extra = [...(seen.get(s.subject_key) ?? [])].filter((c) => !fromProgram.includes(c)).sort()
    questionnairesBySubject.set(s.subject_key, [...fromProgram, ...extra])
  }
  return {
    studentById: new Map(d.students.map((s) => [s.student_id, s])),
    subjectByKey: new Map(d.subjects.map((s) => [s.subject_key, s])),
    metrics,
    gradesByStudent,
    programBySubject,
    questionnairesBySubject,
  }
}

/**
 * התקדמות לפי T1 — לכל תלמיד, בכל שכבה. T2 (ניתוח זכאות) קיים רק לשכבה
 * המסיימת; זה מה שיש לנו על תלמידי י"ב/י"א: כמה מקצועות הושלמו, כמה
 * בתהליך, וכמה ציוני שאלון מתחת ל-55 (בלי ציון חסם 1–4, שאינו נספר).
 */
export interface T1Summary {
  subjects: number
  done: number
  progress: number
  notStarted: number
  weakGrades: number
  /** מקצועות שיש בהם לפחות ציון שאלון אחד מתחת ל-55 */
  weakSubjects: string[]
}

export function t1Summary(index: RoundIndex, studentId: string): T1Summary {
  const bySub = index.gradesByStudent.get(studentId)
  const metrics = index.metrics.get(studentId)
  const out: T1Summary = { subjects: 0, done: 0, progress: 0, notStarted: 0, weakGrades: 0, weakSubjects: [] }
  if (!bySub) return out
  for (const [key, gs] of bySub) {
    out.subjects++
    const c = completion(metrics?.get(key)?.completion_status)
    if (c === 'done') out.done++
    else if (c === 'progress') out.progress++
    else if (c === 'not_started') out.notStarted++
    const weak = gs.filter((g) => {
      const t = gradeTone(g.grade)
      return t === 'fail'
    }).length
    if (weak) {
      out.weakGrades += weak
      out.weakSubjects.push(key)
    }
  }
  return out
}

/** "בחינה חיצונית · 40%" — תיאור שאלון לכותרות */
export function questionnaireLabel(q: Questionnaire | undefined, weight: number | null | undefined): string {
  const parts: string[] = []
  if (q?.exam_form) parts.push(q.exam_form)
  if (weight != null) parts.push(`${Math.round(weight * 100)}%`)
  return parts.join(' · ')
}

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return ''
  return digits ? n.toFixed(digits) : String(Math.round(n))
}
