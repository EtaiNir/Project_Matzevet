// שכבת הנתונים של המיתר — ההכנסות ממשרד החינוך (החלטה 024, מיגרציה 047).
//
// מקור (entity) = של מי הקובץ: המועצה (מוטב) או בית ספר (מוסד). הסוכן מוריד כל
// חודש מאתר המשרד; ה-ZIP של בית ספר הוא תת-קבוצה של ה-ZIP של המועצה, ולכן
// **תצוגת בית ספר = שורות המוסד מה-run של המועצה** (p_institution), ומה-ZIP שלו
// נשמר רק הסיכום הרשמי (meitar_institution_totals) — להתאמה.
//
// ההיסטוריה נגזרת מה-runs (meitar_months), לא ממונה — כמו אצל איתי, בלי
// התקלות שלו (ריצה חוזרת / חודש שדולג).
import { supabase } from './supabase'
import { fetchAll } from './bagrut'
import { explain, pick } from './budget'

export type EntityKind = 'moteb' | 'mosad'

export interface MeitarEntity {
  authority_code: string
  entity_code: string
  kind: EntityKind
  name: string
  auto_download: boolean
  sort_order: number
  active: boolean
}

export interface MeitarRun {
  id: string
  authority_code: string
  entity_code: string
  calc_month: string
  beneficiary: string | null
  file_count: number | null
  upload_id: string | null
  loaded_at: string
}

export interface MeitarInvoiceRow {
  id: number
  topic_code: string
  topic_name: string | null
  chashavut: string | null
  effect_month: string | null
  effect_date: string | null
  prior_year: boolean
  due: number | null
  paid: number | null
  to_pay: number | null
  debt: number | null
  month_balance: number | null
  notes: string | null
}

export interface MeitarRow {
  id: number
  run_id: string
  source_file: string
  topic_code: string | null
  topic_name: string | null
  institution_code: string | null
  institution_name: string | null
  settlement_code: string | null
  settlement_name: string | null
  effect_month: string | null
  effect_date: string | null
  prior_year: boolean
  units: number | null
  cost: number | null
  pct: number | null
  computed: number | null
  computed_prev: number | null
  diff: number | null
  extra: Record<string, string> | null
}

/** אינדקס הנושאים של המשרד */
export interface MeitarTopic {
  topic_code: string
  name: string | null
  report_group: string | null
  category: string | null
  is_new: boolean
}

export interface TopicPlan {
  authority_code: string
  entity_code: string
  topic_code: string
  school_year: number
  budget: number | null
  forecast: number | null
  next_year: number | null
  category: string | null
  notes: string | null
  updated_at: string
}

/** שורה של meitar_months: חודש חישוב × נושא */
export interface MonthTopic {
  calc_month: string
  topic_code: string
  /** Σ סכום מחושב של חודשי התחולה בשנה"ל — המצטבר עד החודש */
  computed: number
  computed_prev: number
  /** Σ הפרש בשנה"ל — מה שנוסף החודש */
  diff: number
  /** Σ הפרש של חודשי תחולה מהשנה הקודמת — רטרואקטיבי לשנה שנסגרה */
  prior_diff: number
  row_count: number
}

export interface InvoiceMonth {
  calc_month: string
  topic_code: string
  to_pay: number
  /** מתוכו — חודש תחולה שאינו חודש החישוב */
  retro: number
  /** מתוכו — לשנה"ל קודמת */
  prior: number
}

export interface InstitutionTotal {
  institution_code: string
  calc_month: string
  institution_name: string | null
  computed: number | null
  computed_prev: number | null
  diff: number | null
}

export type DownloadStatus = 'requested' | 'waiting' | 'downloading' | 'done' | 'failed' | 'gave_up'
export interface MeitarDownload {
  entity_code: string
  calc_month: string
  status: DownloadStatus
  attempts: number
  first_attempt_at: string | null
  last_attempt_at: string | null
  last_error: string | null
  upload_id: string | null
  requested_at: string | null
}

// ─────────────────────────── שנה"ל ───────────────────────────

/** "2026-09-01" → שנה"ל לפי שנת הסיום (ספטמבר פותח שנה חדשה). בלי Date — בלי הזזת אזור זמן */
export function schoolYearOf(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return m >= 9 ? y + 1 : y
}

/** החודש בשנה"ל: ספטמבר = 1 … אוגוסט = 12 (כמו "חודש בשנהל" באקסס) */
export function monthInYear(month: string): number {
  const m = Number(month.split('-')[1])
  return m >= 9 ? m - 8 : m + 4
}

/** 12 חודשי שנה"ל, כמחרוזות "YYYY-MM-01" */
export function schoolYearMonths(schoolYear: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((8 + i) % 12) + 1
    const y = m >= 9 ? schoolYear - 1 : schoolYear
    return `${y}-${String(m).padStart(2, '0')}-01`
  })
}

const HEB = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳']
const HEB_FULL = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
export function monthShort(month: string): string {
  return HEB[Number(month.split('-')[1]) - 1] ?? month
}
export function monthLong(month: string): string {
  const [y, m] = month.split('-')
  return `${HEB_FULL[Number(m) - 1] ?? m} ${y}`
}

// ─────────────────────────── שליפה ───────────────────────────

export async function fetchMeitarEntities(code: string): Promise<MeitarEntity[]> {
  const { data, error } = await supabase.from('meitar_entities').select('*').eq('authority_code', code)
    .order('sort_order').order('name')
  if (error) throw explain(error, 'טעינת מקורות המיתר')
  return (data ?? []) as MeitarEntity[]
}

// ⚠️ כל רשימה שעלולה לעבור 1000 שורות — בדפים (fetchAll). PostgREST חותך כל תשובה
// ב-1000, גם של RPC, בלי שגיאה: meitar_months החזיר ~1100 שורות לשנה, והחודשים
// האחרונים נחתכו — המצטבר "ירד" מיוני לאוגוסט (22.10, מלכודת 46).

export async function fetchMeitarRuns(code: string): Promise<MeitarRun[]> {
  return fetchAll<MeitarRun>((from, to) => supabase.from('meitar_runs').select('*').eq('authority_code', code)
    .order('calc_month', { ascending: false }).order('entity_code').range(from, to))
    .catch((e) => { throw explain(e, 'טעינת חודשי המיתר') })
}

/** האינדקס משותף לכל הרשויות ומשתנה רק כשנושא חדש מגיע — נשמר בזיכרון */
let topicsCache: Promise<Map<string, MeitarTopic>> | null = null
export function fetchMeitarTopics(): Promise<Map<string, MeitarTopic>> {
  topicsCache ??= (async () => {
    const { data, error } = await supabase.from('meitar_topics').select('topic_code, name, report_group, category, is_new')
      .order('topic_code').limit(5000)
    if (error) throw explain(error, 'טעינת אינדקס הנושאים')
    return new Map(((data ?? []) as MeitarTopic[]).map((t) => [t.topic_code, t]))
  })().catch((e) => {
    topicsCache = null
    throw e
  })
  return topicsCache
}

export async function fetchMonthTopics(code: string, entity: string, schoolYear: number, institution: string | null): Promise<MonthTopic[]> {
  const rows = await fetchAll<MonthTopic>((from, to) => supabase.rpc('meitar_months', {
    p_code: code, p_entity: entity, p_school_year: schoolYear, p_institution: institution,
  }).order('calc_month').order('topic_code').range(from, to))
    .catch((e) => { throw explain(e, 'טעינת המיתר לפי חודש') })
  return rows.map((r) => ({
    ...r, computed: Number(r.computed), computed_prev: Number(r.computed_prev), diff: Number(r.diff),
    prior_diff: Number(r.prior_diff), row_count: Number(r.row_count),
  }))
}

export async function fetchInvoiceMonths(code: string, entity: string, schoolYear: number): Promise<InvoiceMonth[]> {
  const rows = await fetchAll<InvoiceMonth>((from, to) => supabase.rpc('meitar_invoice_months', {
    p_code: code, p_entity: entity, p_school_year: schoolYear,
  }).order('calc_month').order('topic_code').range(from, to))
    .catch((e) => { throw explain(e, 'טעינת חשבוניות המיתר') })
  return rows.map((r) => ({ ...r, to_pay: Number(r.to_pay), retro: Number(r.retro), prior: Number(r.prior) }))
}

/**
 * שנות הלימודים שתקופה נוגעת בהן: שנה"ל — אחת; ינואר–דצמבר — שתיים (ינו׳–אוג׳ של
 * שנה"ל שמסתיימת השנה, ספט׳–דצמ׳ של הבאה).
 */
export function periodSchoolYears(year: number, period: 'calendar' | 'school'): number[] {
  return period === 'school' ? [year] : [year, year + 1]
}

/** 12 החודשים של התקופה: שנה"ל — ספט׳…אוג׳; קלנדרית — ינו׳…דצמ׳ */
export function periodMonths(year: number, period: 'calendar' | 'school'): string[] {
  return period === 'school'
    ? schoolYearMonths(year)
    : Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`)
}

export async function fetchMeitarInvoice(runId: string): Promise<MeitarInvoiceRow[]> {
  const { data, error } = await supabase.from('meitar_invoice').select('*').eq('run_id', runId).order('topic_code').limit(5000)
  if (error) throw explain(error, 'טעינת חשבונית המיתר')
  return (data ?? []) as MeitarInvoiceRow[]
}

/** שורות הפירוט של run — לנושא אחד, ולמוסד אחד (תצוגת בית ספר) */
export async function fetchMeitarRows(runId: string, opts: { topic?: string; institution?: string | null } = {}): Promise<MeitarRow[]> {
  return fetchAll<MeitarRow>((from, to) => {
    let q = supabase.from('meitar_rows').select('*').eq('run_id', runId)
    if (opts.topic) q = q.eq('topic_code', opts.topic)
    if (opts.institution) q = q.eq('institution_code', opts.institution)
    return q.order('id').range(from, to)
  }).catch((e) => { throw explain(e, 'טעינת פירוט המיתר') })
}

export async function fetchInstitutionTotals(code: string, schoolYear: number): Promise<InstitutionTotal[]> {
  const { data, error } = await supabase.from('meitar_institution_totals').select('*').eq('authority_code', code)
    .gte('calc_month', `${schoolYear - 1}-09-01`).lt('calc_month', `${schoolYear}-09-01`).limit(5000)
  if (error) throw explain(error, 'טעינת סיכומי המוסדות')
  return (data ?? []) as InstitutionTotal[]
}

export async function fetchTopicPlans(code: string, entity: string, schoolYear: number): Promise<TopicPlan[]> {
  const { data, error } = await supabase.from('meitar_topic_plans').select('*').eq('authority_code', code)
    .eq('entity_code', entity).eq('school_year', schoolYear).limit(5000)
  if (error) throw explain(error, 'טעינת תכנון המיתר')
  return (data ?? []) as TopicPlan[]
}

/** כמה נרשם בכרטסת לכל נושא מיתר בתקופה (תקבולים שהנושא שלהם נגזר מ"פרטים") */
export async function fetchTopicTotals(code: string, from: string, to: string): Promise<Map<string, { booked: number; count: number }>> {
  const { data, error } = await supabase.rpc('budget_topic_totals', { p_code: code, p_from: from, p_to: to })
  if (error) throw explain(error, 'טעינת התקבולים לפי נושא')
  return new Map(((data ?? []) as { meitar_topic: string; booked: number; tx_count: number }[])
    .map((r) => [r.meitar_topic, { booked: Number(r.booked), count: Number(r.tx_count) }]))
}

export async function fetchMeitarDownloads(code: string): Promise<MeitarDownload[]> {
  const { data, error } = await supabase.from('meitar_downloads').select('*').eq('authority_code', code)
    .order('calc_month', { ascending: false }).limit(2000)
  if (error) throw explain(error, 'טעינת מצב ההורדות')
  return (data ?? []) as MeitarDownload[]
}

// ─────────────────────────── שמירה ───────────────────────────

type TopicFields = Omit<TopicPlan, 'authority_code' | 'entity_code' | 'topic_code' | 'school_year' | 'updated_at'>
const EMPTY_TOPIC: TopicFields = { budget: null, forecast: null, next_year: null, category: null, notes: null }

export async function saveTopicPlan(code: string, entity: string, topic: string, schoolYear: number,
  patch: Partial<TopicFields>, current: TopicPlan | null): Promise<TopicPlan> {
  const row = { authority_code: code, entity_code: entity, topic_code: topic, school_year: schoolYear, ...pick(EMPTY_TOPIC, current), ...patch }
  const { data, error } = await supabase.from('meitar_topic_plans')
    .upsert(row, { onConflict: 'authority_code,entity_code,topic_code,school_year' }).select('*').maybeSingle()
  if (error) throw explain(error, 'שמירת תכנון הנושא')
  if (!data) throw new Error('השמירה נחסמה — רק מנהל התקציב עורך את תכנון המיתר')
  return data as TopicPlan
}

/** "הורד עכשיו" — הסוכן מוריד בסבב הבא (עד 20 דקות). מותר רק status='requested' (RLS) */
export async function requestMeitarDownload(code: string, entity: string, calcMonth: string): Promise<MeitarDownload> {
  const { data, error } = await supabase.from('meitar_downloads')
    .upsert({ authority_code: code, entity_code: entity, calc_month: calcMonth, status: 'requested',
      requested_at: new Date().toISOString(), last_error: null }, { onConflict: 'authority_code,entity_code,calc_month' })
    .select('*').maybeSingle()
  if (error) throw explain(error, 'בקשת ההורדה')
  if (!data) throw new Error('הבקשה נחסמה — רק מנהל התקציב מבקש הורדה')
  return data as MeitarDownload
}

type EntityFields = Pick<MeitarEntity, 'kind' | 'name' | 'auto_download' | 'sort_order' | 'active'>
export async function saveMeitarEntity(code: string, entity: string, fields: EntityFields): Promise<MeitarEntity> {
  const { data, error } = await supabase.from('meitar_entities')
    .upsert({ authority_code: code, entity_code: entity, ...fields }, { onConflict: 'authority_code,entity_code' })
    .select('*').maybeSingle()
  if (error) throw explain(error, 'שמירת מקור המיתר')
  if (!data) throw new Error('השמירה נחסמה — רק מנהל־על מוסיף ועורך מקורות')
  return data as MeitarEntity
}

export async function deleteMeitarEntity(code: string, entity: string): Promise<void> {
  const { data, error } = await supabase.from('meitar_entities').delete()
    .eq('authority_code', code).eq('entity_code', entity).select('entity_code')
  if (error) throw explain(error, 'מחיקת מקור המיתר')
  if (!data?.length) throw new Error('המחיקה נחסמה — רק מנהל־על')
}
