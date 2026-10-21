import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ErrorBox, Loading } from '@/components/bagrut/ui'
import { fetchMonthly, type MonthlyRow } from '@/lib/budget'
import { money } from '@/lib/budgetCalc'
import { cardChanges } from '@/lib/budgetInsights'
import { changedByText, fetchLatestSnapshot, fetchPlanHistory, PLAN_FIELD_LABELS, type PlanChange, type Snapshot, type SnapshotMonth } from '@/lib/budgetTracking'
import { useBudget, type CardNavState } from './context'

const dateLabel = (d: string | null) => (d ? new Date(d).toLocaleDateString('he-IL') : '—')

/**
 * מה השתנה מאז העדכון הקודם (024, רעיון 2). בכל קליטה המסד שומר תמונת מצב של
 * מה שנדרס (047) — סיכום חודשי לכל כרטיס. כאן: ההפרש בין התמונה האחרונה להיום,
 * רק בטווח התנועות שנדרסו, ושינויי הצפי והתכנית מאז אותה קליטה.
 */
export default function BudgetChanges() {
  const b = useBudget()
  const navigate = useNavigate()
  const { search } = useLocation()
  const [state, setState] = useState<{ snapshot: Snapshot; months: SnapshotMonth[]; current: MonthlyRow[] } | null | undefined>(undefined)
  const [history, setHistory] = useState<PlanChange[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setState(undefined)
    setHistory(null)
    fetchLatestSnapshot(b.code)
      .then(async (s) => {
        if (!s) {
          if (alive) setState(null)
          const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
          const h = await fetchPlanHistory(b.code, b.year, since)
          if (alive) setHistory(h)
          return
        }
        // הטווח שנדרס — עד היום שאחרי התנועה האחרונה שבו
        const to = new Date(new Date(s.snapshot.to_date!).getTime() + 86_400_000).toISOString().slice(0, 10)
        const [current, h] = await Promise.all([fetchMonthly(b.code, s.snapshot.from_date!, to), fetchPlanHistory(b.code, b.year, s.snapshot.taken_at)])
        if (!alive) return
        setState({ ...s, current })
        setHistory(h)
      })
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [b.code, b.year])

  const names = useMemo(() => new Map(b.rows.map((r) => [r.code, r.name])), [b.rows])
  const changes = useMemo(() => (state ? cardChanges(state.current, state.months, { from: state.snapshot.from_date!, to: state.snapshot.to_date! }, names) : []), [state, names])
  const totals = changes.reduce((t, c) => ({ inc: t.inc + c.dIncome, exp: t.exp + c.dExpense }), { inc: 0, exp: 0 })

  if (error) return <ErrorBox message={error} />
  if (state === undefined) return <Loading label="משווה לעדכון הקודם…" />

  const openCard = (code: string) => {
    const nav: CardNavState = { codes: changes.map((c) => c.code), fromLabel: 'מה השתנה', backTo: `${b.base}/changes${search}` }
    navigate(`${b.base}/card/${code}${search}`, { state: nav })
  }
  const delta = (n: number, tone: string) => (Math.abs(n) < 1 ? <span className="text-slate-300">—</span>
    : <span className={`tabular-nums font-semibold ${tone}`} dir="ltr">{n > 0 ? '+' : '−'}{money(Math.abs(n))}</span>)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold text-slate-800">🔄 מה השתנה מאז העדכון הקודם</h1>
        {state && (
          <span className="text-sm text-slate-500">
            נתונים ל-{dateLabel(state.snapshot.as_of)} ← נתונים ל-{dateLabel(b.asOf)} · נקלט {new Date(state.snapshot.taken_at).toLocaleDateString('he-IL')}
          </span>
        )}
      </div>

      {!state ? (
        <p className="rounded-xl bg-white p-5 text-sm text-slate-600 shadow-sm">
          עוד אין עדכון קודם להשוות אליו. מעכשיו, בכל קליטה של קובצי הנהלת החשבונות נשמרת תמונת מצב של מה שהיה לפניה —
          ואחרי הקליטה הבאה יופיע כאן מה השתנה בכל כרטיס.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <Stat label="כרטיסים שהשתנו" value={changes.length.toLocaleString('he-IL')} />
            <Stat label="הכנסות שנוספו" value={delta(totals.inc, 'text-teal-700')} />
            <Stat label="הוצאות שנוספו" value={delta(totals.exp, 'text-rose-700')} />
          </div>
          {!changes.length ? (
            <p className="rounded-xl bg-white p-5 text-center text-sm text-slate-500 shadow-sm">לא השתנה דבר בתנועות מאז העדכון הקודם.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-right font-semibold">כרטיס</th>
                    <th className="px-3 py-2 text-left font-semibold">הכנסות (שינוי)</th>
                    <th className="px-3 py-2 text-left font-semibold">הוצאות (שינוי)</th>
                    <th className="px-3 py-2 text-left font-semibold">ביצוע הוצאות היום</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.slice(0, 200).map((c) => {
                    const row = b.rows.find((r) => r.code === c.code)
                    return (
                      <tr key={c.code} onClick={() => openCard(c.code)} className="cursor-pointer border-t border-slate-100 hover:bg-emerald-50/40">
                        <td className="px-3 py-1.5"><span className="font-mono text-xs text-slate-500" dir="ltr">{c.code}</span> <span className="text-slate-800">{c.name}</span></td>
                        <td className="px-3 py-1.5 text-left">{delta(c.dIncome, 'text-teal-700')}</td>
                        <td className="px-3 py-1.5 text-left">{delta(c.dExpense, 'text-rose-700')}</td>
                        <td className="px-3 py-1.5 text-left tabular-nums text-slate-600">
                          {row?.pctExpense != null ? `${Math.round(row.pctExpense * 100)}%` : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {changes.length > 200 && <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">מוצגים 200 השינויים הגדולים מתוך {changes.length}.</p>}
            </div>
          )}
        </>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-bold text-slate-800">שינויים בצפי ובתכנית {state ? 'מאז הקליטה הקודמת' : 'ב-30 הימים האחרונים'}</h2>
        {!history ? (
          <p className="text-sm text-slate-400">טוען…</p>
        ) : !history.length ? (
          <p className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow-sm">לא שונו צפי או תכנית.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm shadow-sm">
            {history.slice(0, 200).map((h, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5">
                <button onClick={() => openCard(h.card_code)} className="font-mono text-xs text-slate-500 hover:text-emerald-700" dir="ltr">{h.card_code}</button>
                <span className="text-slate-700">{names.get(h.card_code) ?? ''}</span>
                <span className="font-semibold text-slate-600">{PLAN_FIELD_LABELS[h.field]}</span>
                <span className="tabular-nums text-slate-500">{h.old_value == null ? 'ריק' : money(h.old_value)} ← {h.new_value == null ? 'ריק' : money(h.new_value)}</span>
                <span className="mr-auto text-xs text-slate-400">{changedByText(h)} · {new Date(h.changed_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-[9rem] rounded-xl bg-white px-4 py-2 shadow-sm ring-1 ring-slate-200">
      <div className="text-base font-bold">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  )
}
