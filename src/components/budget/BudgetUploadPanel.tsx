import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  acceptsBudgetFile,
  approveBudgetMapping,
  BUDGET_FIELDS,
  BUDGET_KIND_LABELS,
  fetchBudgetUploads,
  uploadBudgetFiles,
  type BudgetKind,
  type BudgetUpload,
  type ProposedFile,
} from '@/lib/budget'

const STATUS: Record<BudgetUpload['status'], { text: string; tone: string }> = {
  pending: { text: 'ממתין לעיבוד', tone: 'bg-amber-100 text-amber-800' },
  awaiting_approval: { text: 'ממתין לאישור', tone: 'bg-violet-100 text-violet-800' },
  processing: { text: 'בעיבוד', tone: 'bg-sky-100 text-sky-800' },
  done: { text: 'הושלם', tone: 'bg-emerald-100 text-emerald-800' },
  failed: { text: 'נכשל', tone: 'bg-red-100 text-red-800' },
}

const KIND_OPTIONS: BudgetKind[] = ['cards', 'actions', 'orders', 'unknown']

/**
 * קליטת קובצי התקציב — דוחות EPR ו-ZIP מיתר (החלטה 020 §5).
 *
 * בדפוס קליטת הגנים: העלאה → הסוכן מזהה כל דוח ומציע התאמת כותרות → אישור
 * כאן → טעינה. התבנית שאושרה נשמרת, וקובץ באותן כותרות נקלט בפעם הבאה
 * בלי לעצור. משמש גם בלשונית "נתונים" של כרטיס הלקוח וגם במסך הקליטה של המודול.
 */
export default function BudgetUploadPanel({ code }: { code: string }) {
  const [uploads, setUploads] = useState<BudgetUpload[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [year, setYear] = useState(new Date().getFullYear())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const reload = useCallback(
    () => fetchBudgetUploads(code).then(setUploads).catch((e: Error) => setError(e.message)),
    [code],
  )

  // הסוכן מעביר את הקליטה בין מצבים — רענון עדין כל עוד משהו בתנועה
  const moving = uploads.some((u) => u.status === 'pending' || u.status === 'processing')
  useEffect(() => {
    reload()
  }, [reload])
  useEffect(() => {
    if (!moving) return
    const t = setInterval(reload, 5000)
    return () => clearInterval(t)
  }, [moving, reload])

  async function upload() {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const created = await uploadBudgetFiles(code, year, files)
      setUploads((u) => [created, ...u])   // מלכודת 26 — מציגים את מה שהשרת החזיר
      setFiles([])
      setNote('הקבצים הועלו. הסוכן מזהה את הדוחות — אם צריך, ההתאמה תוצג כאן לאישור.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const awaiting = uploads.filter((u) => u.status === 'awaiting_approval')
  const bad = files.filter((f) => !acceptsBudgetFile(f.name))

  return (
    <div className="space-y-6">
      {error && <p className="whitespace-pre-wrap rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">שגיאה: {error}</p>}
      {note && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{note}</p>}

      {awaiting.map((u) => (
        <ApproveMapping key={u.id} upload={u} onApproved={(row) => setUploads((list) => list.map((x) => (x.id === row.id ? row : x)))} />
      ))}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-1 font-bold text-emerald-800">קליטת קובצי תקציב</h3>
        <p className="mb-4 text-sm text-slate-500">
          שני דוחות EPR — <strong>ברמת הכרטיס</strong> ו<strong>ברמת הפעולה</strong> — ואם יש, דוח הזמנות הרכש
          ו-ZIP של המיתר. אפשר להעלות כל צירוף; מה שלא הועלה נשאר כמו שהוא.
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <label className="text-slate-600">שנת התקציב של דוח הכרטיסים:</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg border border-slate-300 px-2 py-1">
            {[0, 1, 2].map((d) => new Date().getFullYear() - d).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="text-xs text-slate-400">תקציב המועצה קלנדרי — ינואר עד דצמבר</span>
        </div>

        <label className="block cursor-pointer rounded-xl border-2 border-dashed border-emerald-300 p-8 text-center transition hover:border-emerald-500 hover:bg-emerald-50">
          <div className="text-3xl">📊</div>
          <p className="mt-2 font-medium text-emerald-700">{files.length ? `${files.length} קבצים נבחרו` : 'בחירת קבצים'}</p>
          <p className="text-xs text-slate-500">‎.xls, ‎.xlsx או ‎.zip — אפשר כמה יחד</p>
          <input type="file" multiple accept=".xls,.xlsx,.zip" hidden
            onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setNote(null) }} />
        </label>

        {files.length > 0 && (
          <div className="mt-4 space-y-2">
            <ul className="space-y-1 text-sm">
              {files.map((f) => (
                <li key={f.name} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${acceptsBudgetFile(f.name) ? 'bg-slate-50' : 'bg-red-50 text-red-700'}`}>
                  <span>{f.name.toLowerCase().endsWith('.zip') ? '🗜' : '📗'}</span>
                  <span className="flex-1 truncate">{f.name}</span>
                  <span className="text-xs text-slate-400">{(f.size / 1e6).toFixed(1)}MB</span>
                </li>
              ))}
            </ul>
            <button onClick={upload} disabled={busy || bad.length > 0}
              className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50">
              {busy ? 'מעלה…' : bad.length ? 'יש קבצים מסוג שאינו נתמך' : `העלאת ${files.length} קבצים`}
            </button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-bold text-emerald-800">היסטוריית קליטות</h3>
        {uploads.length === 0 ? (
          <p className="text-sm text-slate-400">עדיין לא נקלטו קבצים.</p>
        ) : (
          <ul className="space-y-3">
            {uploads.map((u) => <HistoryRow key={u.id} u={u} />)}
          </ul>
        )}
      </section>
    </div>
  )
}

function HistoryRow({ u }: { u: BudgetUpload }) {
  const s = STATUS[u.status]
  const r = u.report
  const meitar = r?.meitar ?? []
  return (
    <li className="rounded-xl border border-slate-100 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-slate-500">{new Date(u.uploaded_at).toLocaleString('he-IL')}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs ${s.tone}`}>{s.text}</span>
        <span className="text-xs text-slate-400">שנת תקציב {u.fiscal_year}</span>
        {u.mapping_source === 'saved' && <span className="text-xs text-slate-400">· התאמה מתבנית שמורה</span>}
      </div>
      <div className="mt-1 truncate text-xs text-slate-500">{u.files.map((f) => f.name).join(' · ')}</div>
      {u.error_message && <p className="mt-1 whitespace-pre-wrap text-xs text-red-700">{u.error_message}</p>}
      {r?.counts && u.status === 'done' && (
        <p className="mt-1 text-xs text-slate-600">
          {[
            r.counts.cards ? `${r.counts.cards.toLocaleString('he-IL')} כרטיסים` : null,
            r.counts.transactions ? `${r.counts.transactions.toLocaleString('he-IL')} תנועות` : null,
            r.counts.orders ? `${r.counts.orders.toLocaleString('he-IL')} הזמנות` : null,
            r.counts.meitar_rows ? `${r.counts.meitar_rows.toLocaleString('he-IL')} שורות מיתר` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      )}
      {r?.crosscheck && (
        <p className={`mt-1 text-xs ${r.crosscheck.matched === r.crosscheck.checked ? 'text-emerald-700' : 'text-amber-700'}`}>
          הצלבה בין שני הדוחות: {r.crosscheck.matched} מתוך {r.crosscheck.checked} כרטיסים מתיישבים
        </p>
      )}
      {meitar.map((m) => (
        <p key={m.file} className={`mt-1 text-xs ${m.reconcile.matched === m.reconcile.total ? 'text-emerald-700' : 'text-amber-700'}`}>
          מיתר {m.calc_month?.slice(0, 7)}: {m.reconcile.matched} מתוך {m.reconcile.total} נושאים מתיישבים בין החשבונית לפירוט
          {m.reconcile.mismatches.length > 0 && ` (פער ב: ${m.reconcile.mismatches.map((x) => x.topic).join(', ')})`}
        </p>
      ))}
      {(r?.warnings ?? []).filter((w) => w.kind !== 'crosscheck' && w.kind !== 'meitar_reconcile').map((w, i) => (
        <p key={i} className="mt-1 text-xs text-amber-700">⚠ {w.text}</p>
      ))}
    </li>
  )
}

/**
 * אישור ההתאמה — לכל קובץ: סוג הדוח, ולכל כותרת השדה שהיא תיכנס אליו.
 * נשלח המיפוי **המלא** כפי שמוצג, לא רק מה ששונה (ראה approveBudgetMapping).
 */
function ApproveMapping({ upload, onApproved }: { upload: BudgetUpload; onApproved: (u: BudgetUpload) => void }) {
  const proposed = upload.proposed_mapping ?? {}
  const initial = useMemo(() => {
    const out: Record<string, { kind: BudgetKind; mapping: Record<string, string | null> | null }> = {}
    for (const [name, p] of Object.entries(proposed)) out[name] = { kind: p.kind, mapping: p.mapping ? { ...p.mapping } : null }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.id])
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const problems: string[] = []
  for (const [name, d] of Object.entries(draft)) {
    if (d.kind === 'unknown') problems.push(`«${name}»: לא נבחר סוג הדוח`)
    if (d.kind === 'cards' || d.kind === 'actions' || d.kind === 'orders') {
      const used = Object.values(d.mapping ?? {}).filter(Boolean) as string[]
      const dup = used.filter((f, i) => used.indexOf(f) !== i)
      if (dup.length) problems.push(`«${name}»: אותו שדה נבחר לשתי עמודות`)
      const missing = BUDGET_FIELDS[d.kind].filter((f) => f.required && !used.includes(f.key)).map((f) => f.label)
      if (missing.length) problems.push(`«${name}»: חסרים שדות חובה — ${missing.join(', ')}`)
    }
  }

  async function approve() {
    setBusy(true)
    setError(null)
    try {
      onApproved(await approveBudgetMapping(upload.id, draft))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border-2 border-violet-300 bg-white p-5 shadow-sm">
      <h3 className="mb-1 font-bold text-violet-800">אישור התאמת הדוחות</h3>
      <p className="mb-4 text-sm text-slate-600">
        בפעם הראשונה שמגיע דוח במבנה הזה צריך לאשר איזו עמודה היא מה. מה שיאושר יישמר, ודוח באותן
        כותרות ייקלט בפעם הבאה בלי לעצור כאן. עמודה שמסומנת «לא לייבא» לא נטענת.
      </p>
      {Object.entries(draft).map(([name, d]) => (
        <FileMapping key={name} name={name} p={proposed[name]} value={d}
          onChange={(v) => setDraft({ ...draft, [name]: v })} />
      ))}
      {problems.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button onClick={approve} disabled={busy || problems.length > 0}
        className="mt-4 rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50">
        {busy ? 'מאשר…' : 'אישור וטעינה'}
      </button>
    </section>
  )
}

function FileMapping({ name, p, value, onChange }: {
  name: string
  p: ProposedFile | undefined
  value: { kind: BudgetKind; mapping: Record<string, string | null> | null }
  onChange: (v: { kind: BudgetKind; mapping: Record<string, string | null> | null }) => void
}) {
  if (value.kind === 'meitar') {
    return <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">🗜 {name} — קובצי מיתר, מבנה קבוע (אין מה להתאים)</p>
  }
  const headers = p?.headers ?? Object.keys(value.mapping ?? {})
  const fields = value.kind === 'unknown' ? [] : BUDGET_FIELDS[value.kind]
  return (
    <div className="mb-4 rounded-xl border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-slate-800">📗 {name}</span>
        {p?.rows != null && <span className="text-xs text-slate-400">{p.rows.toLocaleString('he-IL')} שורות</span>}
        <span className="mr-auto" />
        <label className="text-slate-500">סוג הדוח:</label>
        <select value={value.kind} className="rounded-lg border border-slate-300 px-2 py-1"
          onChange={(e) => onChange({ kind: e.target.value as BudgetKind, mapping: Object.fromEntries(headers.map((h) => [h, null])) })}>
          {KIND_OPTIONS.map((k) => <option key={k} value={k}>{BUDGET_KIND_LABELS[k]}</option>)}
        </select>
      </div>
      {fields.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-right text-violet-700">
              <th className="pb-1 font-semibold">העמודה בקובץ</th>
              <th className="pb-1 font-semibold">תיכנס לשדה</th>
            </tr>
          </thead>
          <tbody>
            {headers.filter(Boolean).map((h) => {
              const cur = value.mapping?.[h] ?? ''
              const sure = p?.meta?.[h]?.confidence === 'high' && p.mapping?.[h] === cur && cur
              return (
                <tr key={h} className="border-b border-slate-50 last:border-0">
                  <td className="py-1 text-slate-700">{h}</td>
                  <td className="py-1">
                    <select value={cur} className={`w-56 rounded-lg border px-2 py-1 ${sure ? 'border-emerald-300 bg-emerald-50/50' : 'border-slate-300'}`}
                      onChange={(e) => onChange({ ...value, mapping: { ...(value.mapping ?? {}), [h]: e.target.value || null } })}>
                      <option value="">— לא לייבא —</option>
                      {fields.map((f) => <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>)}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
