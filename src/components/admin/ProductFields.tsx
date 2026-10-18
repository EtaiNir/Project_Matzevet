import { useEffect, useMemo, useState } from 'react'
import {
  bagrutTitle,
  primaryBagrutRole,
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
        <p className="mt-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">⚠ {emptyWarning}</p>
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

type ScopeKind = 'bagrut_grades' | 'bagrut_classes' | 'bagrut_subject_keys'

const SCOPE_KINDS: { key: ScopeKind; label: string; role: string; hint: string; options: keyof BagrutScopeOptions }[] = [
  { key: 'bagrut_classes', label: 'כיתות', role: 'מחנך/ת', hint: 'כל תלמידי הכיתות שנבחרו', options: 'classes' },
  { key: 'bagrut_grades', label: 'שכבות', role: 'רכז/ת שכבה', hint: 'כל תלמידי השכבות שנבחרו', options: 'grades' },
  { key: 'bagrut_subject_keys', label: 'מקצועות', role: 'רכז/ת מקצוע', hint: 'תלמידים שיש להם ציון באחד המקצועות — כמו בדפי המקצועות', options: 'subjects' },
]

/**
 * מה המשתמש רואה בבגרות (מיגרציה 037). התפקיד הוא כותרת; מסמנים מה הוא רואה:
 * צפייה מועצתית, כל בית הספר, או **איחוד** של כיתות, שכבות ומקצועות. כך
 * מחנך יכול להיות גם רכז מקצוע (סבא, 14.10). התפקיד הראשי נגזר ממה שסומן.
 */
export function BagrutFields({ options, value, onChange }: {
  options: BagrutScopeOptions | null
  value: BagrutValue
  onChange: (v: BagrutValue) => void
}) {
  const role = value.bagrut_role ?? 'coordinator'
  const council = role === 'council'
  const whole = role === 'coordinator'
  const loading = options == null
  // סוג היקף שסומן ועוד לא נבחר בו כלום — נשאר פתוח לבחירה
  const [open, setOpen] = useState<Record<ScopeKind, boolean>>({ bagrut_grades: false, bagrut_classes: false, bagrut_subject_keys: false })
  const ticked = (k: ScopeKind) => open[k] || value[k].length > 0

  // כל שינוי עובר כאן: מעדכנים את השדה, וגוזרים מחדש את התפקיד הראשי
  const emit = (next: BagrutValue, wholeSchool = next.bagrut_role === 'coordinator') =>
    onChange(next.bagrut_role === 'council' ? next : { ...next, bagrut_role: primaryBagrutRole(wholeSchool, next) })

  const toggleKind = (k: ScopeKind) => {
    if (ticked(k)) {
      setOpen((o) => ({ ...o, [k]: false }))
      emit({ ...value, [k]: [] })
    } else {
      setOpen((o) => ({ ...o, [k]: true }))
    }
  }

  const nothing = !council && !whole && SCOPE_KINDS.every((s) => value[s.key].length === 0)
  const title = bagrutTitle(value)

  return (
    <div className="space-y-3">
      <div className="flex gap-0.5 rounded-xl bg-slate-100 p-1">
        {([['school', 'בית ספר'], ['council', 'צפייה מועצתית']] as const).map(([k, label]) => {
          const active = (k === 'council') === council
          return (
            <button key={k} type="button"
              onClick={() => emit(k === 'council' ? { ...value, bagrut_role: 'council' } : { ...value, bagrut_role: 'coordinator' }, k === 'school')}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition ${active ? 'bg-white text-violet-800 shadow-sm' : 'text-slate-500 hover:text-violet-700'}`}>
              {label}
            </button>
          )
        })}
      </div>

      {council ? (
        <p className="text-xs text-slate-500">רואה את כל בתי הספר ברשות. צפייה בלבד — אינו עורך מעקב.</p>
      ) : (
        <>
          <MultiPick label="בתי ספר" options={options?.schools ?? []} loading={loading}
            selected={value.bagrut_schools} onChange={(v) => emit({ ...value, bagrut_schools: v })}
            emptyWarning="לא נבחר בית ספר — המשתמש לא יראה אף תלמיד בבגרות." />

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 text-sm font-semibold text-slate-700">מה הוא רואה</div>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={whole} className="mt-0.5 accent-violet-600"
                onChange={() => emit({ ...value, bagrut_role: whole ? null : 'coordinator' }, !whole)} />
              <span>
                <strong>כל בית הספר</strong> <span className="text-slate-500">— רכז/ת בגרויות: כל התלמידים, ועריכת תוכנית בית הספר</span>
              </span>
            </label>

            {!whole && (
              <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-500">אפשר לסמן כמה — המשתמש רואה את כולם יחד (למשל כיתה ומקצוע).</p>
                {SCOPE_KINDS.map((s) => (
                  <div key={s.key}>
                    <label className="flex cursor-pointer items-start gap-2 text-sm">
                      <input type="checkbox" checked={ticked(s.key)} onChange={() => toggleKind(s.key)} className="mt-0.5 accent-violet-600" />
                      <span><strong>{s.label}</strong> <span className="text-slate-500">— {s.role}: {s.hint}</span></span>
                    </label>
                    {ticked(s.key) && (
                      <div className="mr-6 mt-2">
                        <MultiPick label={s.label} options={options?.[s.options] ?? []} loading={loading}
                          selected={value[s.key]} onChange={(v) => emit({ ...value, [s.key]: v })} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {nothing ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">לא סומן מה המשתמש רואה — הוא לא יראה אף תלמיד.</p>
          ) : (
            <p className="text-xs text-slate-500">כותרת: <strong className="text-violet-800">{title}</strong></p>
          )}
        </>
      )}
    </div>
  )
}
