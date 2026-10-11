import { useEffect, useMemo, useState } from 'react'
import {
  BAGRUT_ROLE_HINTS,
  BAGRUT_ROLE_LABELS,
  ROLE_LABELS,
  SCOPE_LABELS,
  fetchScopeOptions,
  type BagrutRole,
  type BagrutScopeOptions,
  type ScopeLevel,
  type ScopeOption,
  type UserRole,
} from '@/lib/admin'

/**
 * שדות ההרשאה לכל מוצר — משותפים לטופס המשתמש החדש ולעריכת משתמש קיים.
 * כל מוצר מוענק בנפרד (מיגרציה 032): מצבת — scope_level ≠ 'none';
 * בגרות — bagrut_role ≠ null. האכיפה ב-RLS; כאן רק מה שמוצג ונשלח.
 */

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-sky-400 focus:outline-none'

/** רשימת בחירה מרובה עם חיפוש וספירה */
export function MultiPick({ label, options, selected, onChange, loading = false, emptyWarning }: {
  label: string
  options: ScopeOption[]
  selected: string[]
  onChange: (v: string[]) => void
  loading?: boolean
  /** אזהרה כשלא נבחר כלום — מערך ריק אינו "הכול" (014 §4) */
  emptyWarning?: string
}) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? options.filter((o) => o.label.toLowerCase().includes(s) || o.value.includes(s)) : options
  }, [options, q])
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-sm text-slate-600">
          {label}
          {selected.length > 0 && <strong className="mr-1 text-sky-700">({selected.length} נבחרו)</strong>}
        </span>
        {options.length > 8 && (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש…"
            className="w-36 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-sky-400 focus:outline-none" />
        )}
      </div>
      {loading ? (
        <p className="text-sm text-slate-400">טוען רשימה…</p>
      ) : options.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-400">אין עדיין נתונים לבחירה.</p>
      ) : (
        <div className="thin-scrollbar max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white">
          {shown.map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 border-b border-slate-50 px-3 py-1.5 text-sm last:border-0 hover:bg-sky-50">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} className="accent-sky-600" />
              <span className="flex-1 truncate">{o.label}</span>
              {o.label !== o.value && <span className="font-mono text-xs text-slate-400" dir="ltr">{o.value}</span>}
              <span className="w-10 text-left text-xs text-slate-400">{o.count}</span>
            </label>
          ))}
          {shown.length === 0 && <p className="p-3 text-center text-sm text-slate-400">לא נמצאו תוצאות</p>}
        </div>
      )}
      {!loading && options.length > 0 && selected.length === 0 && emptyWarning && (
        <p className="mt-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">{emptyWarning}</p>
      )}
    </div>
  )
}

// ─────────────────────────────── מצבת ───────────────────────────────

export interface MatzevetValue {
  role: UserRole
  scope_level: ScopeLevel
  scope_values: string[]
  can_edit_extra?: boolean
}

/** תפקיד והיקף במצבת. בלי גישה — scope_level 'none' (ואז התפקיד הוא צפייה) */
export function MatzevetFields({ code, value, onChange, showEditExtra = false }: {
  code: string
  value: MatzevetValue
  onChange: (v: MatzevetValue) => void
  /** תיבת "עריכת עמודות" — רק כשהעמודה קיימת במסד (מיגרציה 016) */
  showEditExtra?: boolean
}) {
  const [options, setOptions] = useState<ScopeOption[]>([])
  const [loading, setLoading] = useState(false)
  const level = value.scope_level

  useEffect(() => {
    if (level !== 'locality' && level !== 'school') {
      setOptions([])
      return
    }
    setLoading(true)
    fetchScopeOptions(code, level).then(setOptions).catch(() => setOptions([])).finally(() => setLoading(false))
  }, [code, level])

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-slate-600">תפקיד במצבת</span>
          <select value={value.role} onChange={(e) => onChange({ ...value, role: e.target.value as UserRole })} className={field}>
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        {value.role === 'super_admin' ? (
          <p className="self-end rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800">מנהל־על רואה את כל הרשויות ואת שני המוצרים — אין מה להגביל.</p>
        ) : (
          <label className="block">
            <span className="mb-1 block text-sm text-slate-600">היקף הצפייה</span>
            <select value={level === 'none' ? 'council' : level}
              onChange={(e) => onChange({ ...value, scope_level: e.target.value as ScopeLevel, scope_values: [] })} className={field}>
              {(Object.keys(SCOPE_LABELS) as (keyof typeof SCOPE_LABELS)[]).map((l) => <option key={l} value={l}>{SCOPE_LABELS[l]}</option>)}
            </select>
          </label>
        )}
      </div>

      {value.role !== 'super_admin' && (level === 'locality' || level === 'school') && (
        <MultiPick label={level === 'locality' ? 'יישובים מותרים' : 'מוסדות מותרים'} options={options} loading={loading}
          selected={value.scope_values} onChange={(v) => onChange({ ...value, scope_values: v })}
          emptyWarning="לא נבחר אף ערך — המשתמש לא יראה אף תלמיד במצבת." />
      )}

      {showEditExtra && value.role === 'viewer' && (
        <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <input type="checkbox" checked={Boolean(value.can_edit_extra)} onChange={(e) => onChange({ ...value, can_edit_extra: e.target.checked })} className="mt-0.5 accent-sky-600" />
          <span className="text-sm">
            <span className="font-medium text-slate-700">עריכת עמודות שהמשתמש הוסיף</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
              מאפשר למלא ערכים בעמודות התוספתיות. <strong>אינו</strong> מאפשר ליצור או למחוק עמודות, ואינו משנה אילו תלמידים נראים.
            </span>
          </span>
        </label>
      )}
    </div>
  )
}

// ─────────────────────────────── זכאות לבגרות ───────────────────────────────

export interface BagrutValue {
  bagrut_role: BagrutRole | null
  bagrut_schools: string[]
  bagrut_grades: string[]
  bagrut_classes: string[]
  bagrut_subject_keys: string[]
}

/** תפקיד והיקף בבגרות — מוצגים רק שדות ההיקף שהתפקיד משתמש בהם */
export function BagrutFields({ options, value, onChange }: {
  options: BagrutScopeOptions | null
  value: BagrutValue
  onChange: (v: BagrutValue) => void
}) {
  const role = value.bagrut_role ?? 'coordinator'
  const loading = options == null
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm text-slate-600">תפקיד בזכאות לבגרות</span>
        <select value={role} onChange={(e) => onChange({ ...value, bagrut_role: e.target.value as BagrutRole })} className={field}>
          {(Object.keys(BAGRUT_ROLE_LABELS) as BagrutRole[]).map((r) => <option key={r} value={r}>{BAGRUT_ROLE_LABELS[r]}</option>)}
        </select>
        <span className="mt-1 block text-xs text-slate-500">{BAGRUT_ROLE_HINTS[role]}</span>
      </label>

      {role !== 'council' && (
        <MultiPick label="בתי ספר" options={options?.schools ?? []} loading={loading}
          selected={value.bagrut_schools} onChange={(v) => onChange({ ...value, bagrut_schools: v })}
          emptyWarning="לא נבחר בית ספר — המשתמש לא יראה אף תלמיד בבגרות." />
      )}
      {role === 'grade_coordinator' && (
        <MultiPick label="שכבות" options={options?.grades ?? []} loading={loading}
          selected={value.bagrut_grades} onChange={(v) => onChange({ ...value, bagrut_grades: v })}
          emptyWarning="לא נבחרה שכבה — רכז השכבה לא יראה אף תלמיד." />
      )}
      {role === 'homeroom' && (
        <MultiPick label="כיתות" options={options?.classes ?? []} loading={loading}
          selected={value.bagrut_classes} onChange={(v) => onChange({ ...value, bagrut_classes: v })}
          emptyWarning="לא נבחרה כיתה — המחנך לא יראה אף תלמיד." />
      )}
      {role === 'subject_coordinator' && (
        <MultiPick label="המקצועות שלו (מיקוד — לא הגבלה)" options={options?.subjects ?? []} loading={loading}
          selected={value.bagrut_subject_keys} onChange={(v) => onChange({ ...value, bagrut_subject_keys: v })} />
      )}
    </div>
  )
}
