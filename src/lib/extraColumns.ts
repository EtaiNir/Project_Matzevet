// שכבת הנתונים של העמודות שהמשתמש מוסיף (מיגרציה 016).
//
// שתי בקשות נפרדות: הקטלוג (אילו עמודות קיימות) והערכים (מה מולא לכל
// תלמיד). החיבור ביניהם נעשה כאן בזיכרון לפי תעודת זהות — בדיוק כמו
// שהשדות המחושבים מחוברים ב-lib/computed.ts.
//
// אפיון: docs/extra-fields-design.md

import { supabase } from './supabase'
import type { FieldDef, FieldType } from '@/config/fields'
import { EXTRA_GROUP } from '@/config/fields'
import type { StudentRow } from './students'

const PAGE_SIZE = 1000

export type ExtraColumnType = 'text' | 'checkbox'

export interface ExtraColumn {
  id: string
  authority_code: string
  view_id: string | null
  label: string
  type: ExtraColumnType
  sort_order: number
  created_by: string | null
  created_at: string
}

export interface TrashedColumn {
  id: string
  label: string
  type: ExtraColumnType
  values: number
  deleted_at: string
  restore_until: string
}

export interface CleanupPreview {
  grace_days: number
  trash: TrashedColumn[]
  trash_due: number
  orphan_rows: number
  orphan_rows_due: number
}

/**
 * מפתח השדה בשורת התלמיד.
 *
 * הקידומת `x_` מבטיחה שלא תהיה התנגשות עם שום עמודה של משרד החינוך —
 * כולן באותיות גדולות ובלי הקידומת הזו.
 */
export function extraFieldKey(id: string): string {
  return `x_${id}`
}

export function extraIdFromKey(key: string): string | null {
  return key.startsWith('x_') ? key.slice(2) : null
}

/** ממיר עמודות מהקטלוג להגדרות שדה, כדי לרשום אותן ב-config/fields. */
export function toFieldDefs(columns: ExtraColumn[]): FieldDef[] {
  return columns.map((c) => ({
    key: extraFieldKey(c.id),
    label: c.label,
    type: (c.type === 'checkbox' ? 'boolean' : 'text') as FieldType,
    group: EXTRA_GROUP,
    extra: true,
  }))
}

// ─────────────────────────── קריאה ───────────────────────────

/**
 * העמודות הפעילות שיש להציג.
 *
 * `view_id` הוא מה שקובע היכן עמודה מופיעה:
 *   null            — עמודה של כל הרשות, מופיעה בכל מקום
 *   מזהה של טבלה     — שייכת רק לה, ואינה קיימת בטבלה הראשית
 *
 * לכן הסינון כאן אינו קוסמטי: בלעדיו עמודה שנוצרה בתוך "הסעות — מצר"
 * הייתה מופיעה גם אצל 7,900 התלמידים שאין להם קשר להסעות.
 *
 * נכשל בשקט ומחזיר רשימה ריקה — כדי שאתר שרץ מול מסד בלי מיגרציה 016
 * ימשיך לעבוד כרגיל. אותו דפוס של שדות הפרופיל במיגרציה 010.
 */
export async function fetchExtraColumns(
  authorityCode: string,
  viewId?: string | null,
): Promise<ExtraColumn[]> {
  let q = supabase
    .from('extra_columns')
    .select('id, authority_code, view_id, label, type, sort_order, created_by, created_at')
    .eq('authority_code', authorityCode)

  q = viewId ? q.or(`view_id.is.null,view_id.eq.${viewId}`) : q.is('view_id', null)

  const { data, error } = await q.order('sort_order').order('created_at')
  if (error) return []
  return (data ?? []) as ExtraColumn[]
}

export type ExtraValues = Map<string, Record<string, unknown>>

/** הערכים של כל התלמידים ברשות, לפי תעודת זהות. */
export async function fetchExtraValues(authorityCode: string): Promise<ExtraValues> {
  const table = `students_${authorityCode}_extra`
  const out: ExtraValues = new Map()

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select('MISPAR_ZEHUT, data')
      .order('MISPAR_ZEHUT')
      .range(from, from + PAGE_SIZE - 1)
    if (error) return out
    const rows = (data ?? []) as { MISPAR_ZEHUT: string; data: Record<string, unknown> }[]
    for (const r of rows) out.set(r.MISPAR_ZEHUT, r.data ?? {})
    if (rows.length < PAGE_SIZE) break
  }
  return out
}

/**
 * משטח את הערכים לתוך שורות התלמידים, תחת המפתח `x_<id>`.
 *
 * מרגע זה עמודה תוספתית היא שדה רגיל לכל דבר — הסינון, המיון, הייצוא
 * והפיבוטים רואים אותה בלי לדעת שהיא שונה.
 */
export function withExtraValues(rows: StudentRow[], values: ExtraValues): StudentRow[] {
  if (values.size === 0) return rows
  return rows.map((row) => {
    const v = values.get(String(row['MISPAR_ZEHUT'] ?? ''))
    if (!v) return row
    const merged: StudentRow = { ...row }
    for (const [id, value] of Object.entries(v)) merged[extraFieldKey(id)] = value
    return merged
  })
}

// ─────────────────────────── ניהול עמודות ───────────────────────────

export async function createExtraColumn(
  authorityCode: string,
  label: string,
  type: ExtraColumnType,
  viewId: string | null = null,
): Promise<ExtraColumn> {
  const { data: session } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('extra_columns')
    .insert({
      authority_code: authorityCode,
      label: label.trim(),
      type,
      view_id: viewId,
      created_by: session.user?.id ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as ExtraColumn
}

export async function renameExtraColumn(id: string, label: string): Promise<void> {
  const { error } = await supabase
    .from('extra_columns')
    .update({ label: label.trim() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** כמה תלמידים מחזיקים ערך בעמודה — נקרא לפני אישור המחיקה. */
export async function columnUsage(id: string): Promise<number> {
  const { data, error } = await supabase.rpc('extra_column_usage', { column_id: id })
  if (error) return 0
  return (data as number) ?? 0
}

/** מעבירה לסל הגריעה. הערכים נשארים במקומם ל-90 יום. */
export async function deleteExtraColumn(id: string): Promise<{ label: string; values: number }> {
  const { data, error } = await supabase.rpc('delete_extra_column', { column_id: id })
  if (error) throw new Error(error.message)
  return data as { label: string; values: number }
}

export async function restoreExtraColumn(id: string): Promise<{ label: string; values: number }> {
  const { data, error } = await supabase.rpc('restore_extra_column', { column_id: id })
  if (error) throw new Error(error.message)
  return data as { label: string; values: number }
}

export async function fetchTrashedColumns(authorityCode: string): Promise<TrashedColumn[]> {
  const { data, error } = await supabase
    .from('extra_columns_trash')
    .select('id, label, type, value_count, deleted_at')
    .eq('authority_code', authorityCode)
    .order('deleted_at', { ascending: false })
  if (error) return []
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    label: String(r.label),
    type: r.type as ExtraColumnType,
    values: Number(r.value_count ?? 0),
    deleted_at: String(r.deleted_at),
    // 90 יום מרגע המחיקה. אותו קבוע נאכף במסד ב-extra_grace_days().
    restore_until: new Date(
      new Date(String(r.deleted_at)).getTime() + 90 * 24 * 3600 * 1000,
    ).toISOString(),
  }))
}

// ─────────────────────────── עריכת ערכים ───────────────────────────

/**
 * קובע ערך לתלמיד אחד בעמודה אחת.
 *
 * `null` מוחק את המפתח במקום לכתוב `false`/מחרוזת ריקה — כך ה-jsonb
 * אינו מתמלא בערכי ברירת מחדל, ו"אינו מסומן" הוא היעדר מפתח בלבד.
 */
export async function setExtraValue(
  authorityCode: string,
  misparZehut: string,
  columnId: string,
  value: string | boolean | null,
): Promise<void> {
  const table = `students_${authorityCode}_extra`
  const { data: session } = await supabase.auth.getUser()

  const { data: existing } = await supabase
    .from(table)
    .select('data')
    .eq('MISPAR_ZEHUT', misparZehut)
    .maybeSingle()

  const next: Record<string, unknown> = {
    ...(((existing as { data?: Record<string, unknown> } | null)?.data) ?? {}),
  }
  if (value === null || value === false || value === '') delete next[columnId]
  else next[columnId] = value

  const { error } = await supabase.from(table).upsert(
    {
      MISPAR_ZEHUT: misparZehut,
      data: next,
      updated_at: new Date().toISOString(),
      updated_by: session.user?.id ?? null,
    },
    { onConflict: 'MISPAR_ZEHUT' },
  )
  if (error) throw new Error(error.message)
}

// ─────────────────────────── ניקוי ───────────────────────────

export async function cleanupPreview(authorityCode: string): Promise<CleanupPreview | null> {
  const { data, error } = await supabase.rpc('extra_cleanup_preview', {
    target_code: authorityCode,
  })
  if (error) return null
  return data as CleanupPreview
}

export async function cleanupPurge(
  authorityCode: string,
): Promise<{ columns: { label: string }[]; rows: number }> {
  const { data, error } = await supabase.rpc('extra_cleanup_purge', {
    target_code: authorityCode,
  })
  if (error) throw new Error(error.message)
  return data as { columns: { label: string }[]; rows: number }
}
