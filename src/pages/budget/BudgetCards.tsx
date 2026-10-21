import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'
import { AmountCell, TextCell } from '@/components/budget/InlineCells'
import { saveMeta, savePlan } from '@/lib/budget'
import { money, monthsLabel, pct, usageTone, type CardRow } from '@/lib/budgetCalc'
import { useBudget, type CardNavState } from './context'

const CAT_LIST = 'budget-category1'

/**
 * הכרטסת — שורה לכל כרטיס, כמו "טופס כרטסת – מעקב ותכנית תקציב" באקסס.
 *
 * התקציב, הביצוע והשריון באים מהקבצים. הצפי, התכנית לשנה הבאה וקטגוריה 1
 * נערכים כאן ישירות בשורה (שכבת המשתמש — לא נדרסת בקליטה). צפי ריק מציג
 * באפור את ההצעה לפי הקצב; היא לא נשמרת עד שמקלידים.
 */
export default function BudgetCards() {
  const b = useBudget()
  const navigate = useNavigate()
  const { search } = useLocation()
  const [params, setParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const pace = b.elapsed / 12

  const cat = params.get('cat')
  const dir = params.get('dir') as 'income' | 'expense' | null
  const rows = useMemo(
    () => b.rows.filter((r) => (!dir || r.dir === dir) && (!cat || (r.meta?.category1?.trim() || '(לא סווג)') === cat)),
    [b.rows, cat, dir],
  )
  const categories = useMemo(
    () => [...new Set(b.rows.map((r) => r.meta?.category1?.trim()).filter(Boolean) as string[])].sort((a, c) => a.localeCompare(c, 'he')),
    [b.rows],
  )

  const setParam = (k: string, v: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (v) next.set(k, v)
      else next.delete(k)
      return next
    }, { replace: true })

  // שמירה — השורה שחזרה מהשרת היא מה שמוצג (מלכודת 26); שגיאה נאמרת בשם השדה
  const plan = (r: CardRow, field: 'forecast' | 'next', label: string) => async (v: number | null) => {
    setError(null)
    const key = field === 'forecast'
      ? (r.dir === 'income' ? 'forecast_income' : 'forecast_expense')
      : (r.dir === 'income' ? 'next_income' : 'next_expense')
    // הצפי והתכנית נשמרים בסימן "טבעי" (חיובי) — בשכבת המשתמש אין סימני EPR
    try {
      b.applyPlan(await savePlan(b.code, r.code, b.year, { [key]: v }, r.plan))
    } catch (e) {
      setError(`${label} בכרטיס ${r.code}: ${(e as Error).message}`)
      throw e
    }
  }
  const category = (r: CardRow) => async (v: string | null) => {
    setError(null)
    try {
      b.applyMeta(await saveMeta(b.code, r.code, { category1: v }, r.meta))
    } catch (e) {
      setError(`קטגוריה בכרטיס ${r.code}: ${(e as Error).message}`)
      throw e
    }
  }

  const columns: Column<CardRow>[] = [
    { key: 'code', header: 'כרטיס', width: 112, sticky: true, render: (r) => <span className="font-mono text-xs text-slate-500" dir="ltr">{r.code}</span>, sortValue: (r) => r.code, exportValue: (r) => r.code },
    { key: 'name', header: 'שם הכרטיס', width: 230, render: (r) => <span className="truncate text-slate-800">{r.name}</span>, sortValue: (r) => r.name },
    { key: 'dir', header: 'סוג', width: 70, render: (r) => <span className={r.dir === 'income' ? 'text-teal-700' : 'text-slate-600'}>{r.dir === 'income' ? 'הכנסה' : 'הוצאה'}</span>, sortValue: (r) => (r.dir === 'income' ? 'הכנסה' : 'הוצאה') },
    {
      key: 'cat1', header: 'קטגוריה 1', width: 140,
      render: (r) => <TextCell value={r.meta?.category1 ?? null} listId={CAT_LIST} disabled={!b.canManage} onSave={category(r)} />,
      sortValue: (r) => r.meta?.category1 ?? null,
    },
    { key: 'cat2', header: 'קטגוריה 2', width: 110, render: (r) => <span className="truncate text-slate-600">{r.meta?.category2 ?? ''}</span>, sortValue: (r) => r.meta?.category2 ?? null },
    { key: 'budget', header: 'תקציב', width: 108, render: (r) => <span className="tabular-nums">{money(r.budget)}</span>, sortValue: (r) => r.budget, exportValue: (r) => r.budget },
    { key: 'executed', header: 'ביצוע', width: 108, render: (r) => <span className="tabular-nums">{money(r.executed)}</span>, sortValue: (r) => r.executed, exportValue: (r) => r.executed },
    { key: 'usage', header: 'ניצול', width: 66, render: (r) => <span className={`tabular-nums ${usageTone(r.usage, pace)}`}>{pct(r.usage)}</span>, sortValue: (r) => r.usage, exportValue: (r) => (r.usage == null ? null : Math.round(r.usage * 100)), filter: false },
    { key: 'reserved', header: 'שריון', width: 92, render: (r) => <span className="tabular-nums text-slate-600">{money(r.reserved)}</span>, sortValue: (r) => r.reserved, exportValue: (r) => r.reserved, filter: false },
    { key: 'remaining', header: 'יתרה', width: 100, render: (r) => <span className={`tabular-nums ${(r.remaining ?? 0) < 0 ? 'text-red-700' : 'text-slate-600'}`}>{money(r.remaining)}</span>, sortValue: (r) => r.remaining, exportValue: (r) => r.remaining, filter: false },
    {
      key: 'forecast', header: 'צפי לסוף השנה', width: 120,
      render: (r) => <AmountCell value={r.forecast} placeholder={r.suggested} disabled={!b.canPlan} onSave={plan(r, 'forecast', 'צפי')} />,
      sortValue: (r) => r.forecast ?? r.suggested, exportValue: (r) => r.forecast, filter: false,
    },
    {
      key: 'next', header: `תכנית ${b.year + 1}`, width: 116,
      render: (r) => <AmountCell value={r.nextYear} disabled={!b.canPlan} onSave={plan(r, 'next', 'תכנית לשנה הבאה')} />,
      sortValue: (r) => r.nextYear, exportValue: (r) => r.nextYear, filter: false,
    },
    { key: 'notes', header: 'הערות', width: 160, render: (r) => <span className="truncate text-xs text-slate-500" title={r.plan?.notes ?? ''}>{r.plan?.notes ?? ''}</span>, sortValue: (r) => r.plan?.notes ?? null, filter: false },
    { key: 'owner', header: 'באחריות', width: 110, render: (r) => <span className="truncate text-slate-600">{r.meta?.owner_name ?? ''}</span>, sortValue: (r) => r.meta?.owner_name ?? null },
  ]

  const openCard = (r: CardRow, _i: number, sorted: CardRow[]) => {
    const nav: CardNavState = { codes: sorted.map((x) => x.code), fromLabel: cat ? `קטגוריה «${cat}»` : 'הכרטסת', backTo: `${b.base}/cards${search}` }
    navigate(`${b.base}/card/${r.code}${search}`, { state: nav })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <h1 className="text-lg font-bold text-slate-800">כרטסת {b.year}</h1>
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {([[null, 'הכול'], ['expense', 'הוצאות'], ['income', 'הכנסות']] as [string | null, string][]).map(([k, label]) => (
            <button key={label} onClick={() => setParam('dir', k)}
              className={`rounded-md px-2.5 py-0.5 font-semibold ${dir === k ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500'}`}>{label}</button>
          ))}
        </div>
        {cat && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-600 py-0.5 pl-1 pr-2.5 text-xs font-semibold text-white">
            קטגוריה: {cat}
            <button onClick={() => setParam('cat', null)} className="rounded-full px-1 hover:bg-emerald-700" title="הסרת הסינון">✕</button>
          </span>
        )}
        <span className="mr-auto text-xs text-slate-500">
          {b.canPlan ? 'צפי ותכנית — לחיצה על התא ועריכה; נשמר ביציאה מהתא.' : 'צפייה בלבד.'}
          {' '}צפי ריק מוצג באפור לפי הקצב ({monthsLabel(b.elapsed)} מתוך 12 חודשים) ואינו נשמר.
        </span>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      <datalist id={CAT_LIST}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <BagrutTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.code}
        onRowClick={openCard}
        exportName={`כרטסת_${b.authorityName || b.code}_${b.year}`}
        sheetName={`כרטסת ${b.year}`}
        empty="אין כרטיסים שעונים על הסינון"
        countLabel="כרטיסים"
        rowTitle={(r) => `${r.code} · ${r.name}`}
        initialSort={{ key: 'code', dir: 'asc' }}
        storageKey="budget-cards"
      />
    </div>
  )
}
