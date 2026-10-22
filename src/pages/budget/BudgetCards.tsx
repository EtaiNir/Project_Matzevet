import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'
import { AmountCell, TextCell } from '@/components/budget/InlineCells'
import PlanStatusCell from '@/components/budget/PlanStatusCell'
import { PLAN_STATUS_META, type PlanStatus } from '@/lib/budgetTracking'
import { saveMeta, savePlan } from '@/lib/budget'
import { HEB_MONTH_NAMES, hebrewSchoolYear, money, monthsLabel, pct, totals, usageTone, type CardRow } from '@/lib/budgetCalc'
import { downloadWorkbook } from '@/lib/xlsx'
import { useBudget, type CardNavState } from './context'

const CAT_LIST = 'budget-category1'

/** סימון ✓ לדגלים — במיתר / הכנסה / הוצאה */
const Flag = ({ on, tone }: { on: boolean; tone: string }) => (
  <span className={on ? `font-bold ${tone}` : 'text-slate-200'}>{on ? '✓' : '·'}</span>
)

/**
 * "מעקב ותכנון תקציב" — הטבלה הראשית, כמו הטופס באקסס של סבא (נבנית מקובץ
 * התוספתיים): שורה לכל כרטיס, הכנסות והוצאות **זו לצד זו**, כל צד מול התקציב
 * שלו; הצפי והתכנית לשנה הבאה נערכים בשורה. שורת הסה"כ מתחת לטבלה נספרת
 * מהשורות שאחרי הסינון — כמו באקסס.
 *
 * התקופה (ינואר–דצמבר / ספטמבר–אוגוסט) נבחרת בכותרת — אלה שני הטפסים של האקסס.
 */
export default function BudgetCards() {
  const b = useBudget()
  const navigate = useNavigate()
  const { search } = useLocation()
  const [params, setParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const pace = b.elapsed / 12

  const cat = params.get('cat')
  const side = params.get('side') as 'income' | 'expense' | null
  // 025 — סינון לפי מצב התכנית לשנה הבאה
  const planOf = (code: string): PlanStatus => b.planReviews.get(code)?.status ?? 'draft'
  const planFilter = params.get('plan') as PlanStatus | null
  const rows = useMemo(
    () => b.rows.filter((r) =>
      (!side || (side === 'income' ? r.isIncome : r.isExpense))
      && (!cat || (r.meta?.category1?.trim() || '(לא סווג)') === cat)
      && (!planFilter || (b.planReviews.get(r.code)?.status ?? 'draft') === planFilter)),
    [b.rows, cat, side, planFilter, b.planReviews],
  )
  const planCounts = useMemo(() => {
    const c: Record<PlanStatus, number> = { draft: 0, submitted: 0, approved: 0, returned: 0 }
    for (const r of b.rows) c[b.planReviews.get(r.code)?.status ?? 'draft']++
    return c
  }, [b.rows, b.planReviews])
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

  // שמירה — השורה שחזרה מהשרת היא מה שמוצג (מלכודת 26); שגיאה נאמרת בשם השדה.
  // הצפי והתכנית נשמרים חיוביים — כמו שסבא מקליד אותם בתוספתיים.
  type PlanKey = 'forecast_income' | 'forecast_expense' | 'next_income' | 'next_expense'
  const plan = (r: CardRow, key: PlanKey, label: string) => async (v: number | null) => {
    setError(null)
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

  const amount = (v: number | null) => <span className="tabular-nums">{money(v)}</span>
  // 025 — מאיפה ההצעה לצפי, והאם יש בכלל הזמנות פתוחות (אם לא — העמודות לא מוצגות)
  const suggestTitle = (r: CardRow) => r.suggestedBy === 'season'
    ? 'ריק — מוצג צפי לפי השנה שעברה: מה שנרשם עד היום + אותם חודשים בשנה שעברה (לא נשמר)'
    : 'ריק — מוצג הצפי לפי הקצב (לא נשמר)'
  const hasOrders = b.rows.some((r) => r.openOrders > 0)
  const columns: Column<CardRow>[] = [
    { key: 'code', header: 'מספר הסעיף', width: 108, sticky: true, render: (r) => <span className="font-mono text-xs text-slate-500" dir="ltr">{r.code}</span>, sortValue: (r) => r.code, exportValue: (r) => r.code },
    { key: 'name', header: 'תאור סעיף', width: 210, render: (r) => <span className="truncate text-slate-800">{r.name}</span>, sortValue: (r) => r.name },
    {
      key: 'cat1', header: 'קטגוריה 1', width: 130,
      render: (r) => <TextCell value={r.meta?.category1 ?? null} listId={CAT_LIST} disabled={!b.canManage} onSave={category(r)} />,
      sortValue: (r) => r.meta?.category1 ?? null,
    },
    { key: 'cat2', header: 'קטגוריה 2', width: 120, render: (r) => <span className="truncate text-slate-600">{r.meta?.category2 ?? ''}</span>, sortValue: (r) => r.meta?.category2 ?? null },
    { key: 'cat3', header: 'קטגוריה 3', width: 120, render: (r) => <span className="truncate text-slate-600">{r.meta?.category3 ?? ''}</span>, sortValue: (r) => r.meta?.category3 ?? null },
    { key: 'meitar', header: 'במיתר', width: 50, align: 'center', render: (r) => <Flag on={Boolean(r.meta?.in_meitar)} tone="text-violet-700" />, sortValue: (r) => (r.meta?.in_meitar ? 1 : 0), exportValue: (r) => (r.meta?.in_meitar ? 'כן' : '') },
    { key: 'isInc', header: 'הכנסה', width: 50, align: 'center', render: (r) => <Flag on={r.isIncome} tone="text-teal-700" />, sortValue: (r) => (r.isIncome ? 1 : 0), exportValue: (r) => (r.isIncome ? 'כן' : '') },
    { key: 'isExp', header: 'הוצאה', width: 50, align: 'center', render: (r) => <Flag on={r.isExpense} tone="text-rose-700" />, sortValue: (r) => (r.isExpense ? 1 : 0), exportValue: (r) => (r.isExpense ? 'כן' : '') },
    { key: 'bInc', group: 'tk', groupTitle: 'תקציב', header: 'הכנסות', exportHeader: 'תקציב הכנסות', width: 104, render: (r) => amount(r.budgetIncome), sortValue: (r) => r.budgetIncome, exportValue: (r) => r.budgetIncome, filter: false },
    { key: 'bExp', group: 'tk', header: 'הוצאות', exportHeader: 'תקציב הוצאות', width: 104, render: (r) => amount(r.budgetExpense), sortValue: (r) => r.budgetExpense, exportValue: (r) => r.budgetExpense, filter: false },
    { key: 'cInc', group: 'cum', groupTitle: 'מצטבר בתקופה', header: 'הכנסות', exportHeader: 'הכנסות מצטבר', width: 104, render: (r) => <span className="tabular-nums text-teal-800">{money(r.cumIncome || null)}</span>, sortValue: (r) => r.cumIncome, exportValue: (r) => r.cumIncome, filter: false },
    { key: 'cExp', group: 'cum', header: 'הוצאות', exportHeader: 'הוצאות מצטבר', width: 104, render: (r) => <span className="tabular-nums text-rose-800">{money(r.cumExpense || null)}</span>, sortValue: (r) => r.cumExpense, exportValue: (r) => r.cumExpense, filter: false },
    { key: 'pInc', group: 'pct', groupTitle: 'אחוז ביצוע', header: 'הכנסה', exportHeader: 'אחוז ביצוע הכנסה', width: 62, render: (r) => <span className={`tabular-nums ${usageTone(r.pctIncome, 0)}`}>{pct(r.pctIncome)}</span>, sortValue: (r) => r.pctIncome, exportValue: (r) => (r.pctIncome == null ? null : Math.round(r.pctIncome * 100)), filter: false },
    { key: 'pExp', group: 'pct', header: 'הוצאה', exportHeader: 'אחוז ביצוע הוצאה', width: 62, render: (r) => <span className={`tabular-nums ${usageTone(r.pctExpense, pace)}`}>{pct(r.pctExpense)}</span>, sortValue: (r) => r.pctExpense, exportValue: (r) => (r.pctExpense == null ? null : Math.round(r.pctExpense * 100)), filter: false },
    {
      key: 'fInc', group: 'fc', groupTitle: 'צפי לסוף השנה', header: 'הכנסות', exportHeader: 'צפי הכנסות לסוף שנה', width: 112, filter: false,
      render: (r) => <AmountCell value={r.forecastIncome} placeholder={r.suggestedIncome} placeholderTitle={suggestTitle(r)} disabled={!b.canPlan} onSave={plan(r, 'forecast_income', 'צפי הכנסות')} />,
      sortValue: (r) => r.forecastIncome ?? r.suggestedIncome, exportValue: (r) => r.forecastIncome,
    },
    {
      key: 'fExp', group: 'fc', header: 'הוצאות', exportHeader: 'צפי הוצאות לסוף שנה', width: 112, filter: false,
      render: (r) => <AmountCell value={r.forecastExpense} placeholder={r.suggestedExpense} placeholderTitle={suggestTitle(r)} disabled={!b.canPlan} onSave={plan(r, 'forecast_expense', 'צפי הוצאות')} />,
      sortValue: (r) => r.forecastExpense ?? r.suggestedExpense, exportValue: (r) => r.forecastExpense,
    },
    // 025 — הזמנות פתוחות: כסף שמחויב ועוד לא נרשם. רק כשיש בכלל הזמנות
    ...(hasOrders ? [
      {
        key: 'open', group: 'ord', groupTitle: 'הזמנות', header: 'פתוחות', exportHeader: 'הזמנות פתוחות', width: 100, filter: false,
        render: (r: CardRow) => <span className="tabular-nums text-violet-800">{money(r.openOrders || null)}</span>,
        sortValue: (r: CardRow) => r.openOrders, exportValue: (r: CardRow) => r.openOrders || null,
      },
      {
        key: 'committed', group: 'ord', header: 'מחויב', exportHeader: 'מחויב (מצטבר + הזמנות)', width: 104, filter: false,
        render: (r: CardRow) => {
          const c = r.cumExpense + r.openOrders
          const over = r.budgetExpense ? c > r.budgetExpense : false
          return <span className={`tabular-nums ${over ? 'font-bold text-red-700' : 'text-slate-700'}`} title="הוצאות מצטבר + הזמנות פתוחות">{money(r.openOrders ? c : null)}</span>
        },
        sortValue: (r: CardRow) => r.cumExpense + r.openOrders, exportValue: (r: CardRow) => (r.openOrders ? r.cumExpense + r.openOrders : null),
      },
    ] as Column<CardRow>[] : []),
    {
      key: 'nInc', group: 'next', groupTitle: `תכנית ${b.year + 1}`, header: 'הכנסות', exportHeader: 'תכנית הכנסות לשנה הבאה', width: 112, filter: false,
      render: (r) => <AmountCell value={r.nextIncome} disabled={!b.canPlan} onSave={plan(r, 'next_income', 'תכנית הכנסות')} />,
      sortValue: (r) => r.nextIncome, exportValue: (r) => r.nextIncome,
    },
    {
      key: 'nExp', group: 'next', header: 'הוצאות', exportHeader: 'תכנית הוצאות לשנה הבאה', width: 112, filter: false,
      render: (r) => <AmountCell value={r.nextExpense} disabled={!b.canPlan} onSave={plan(r, 'next_expense', 'תכנית הוצאות')} />,
      sortValue: (r) => r.nextExpense, exportValue: (r) => r.nextExpense,
    },
    // 025 — אישור התכנית לשנה הבאה: אחראי מגיש, מנהל מאשר / מחזיר
    {
      key: 'planStatus', group: 'next', header: 'מצב התכנית', exportHeader: 'מצב התכנית', width: 100, align: 'center',
      render: (r) => (
        <PlanStatusCell code={b.code} card={r.code} year={b.year} review={b.planReviews.get(r.code)}
          canSubmit={b.canPlan} canDecide={b.canManage} onSaved={b.applyPlanReview} />
      ),
      sortValue: (r) => ['returned', 'submitted', 'draft', 'approved'].indexOf(planOf(r.code)),
      exportValue: (r) => PLAN_STATUS_META[planOf(r.code)].label,
    },
    { key: 'notes', header: 'הערות לתכנון', width: 170, render: (r) => <span className="truncate text-xs text-slate-500" title={r.plan?.notes ?? ''}>{r.plan?.notes ?? ''}</span>, sortValue: (r) => r.plan?.notes ?? null, filter: false },
    { key: 'owner', header: 'באחריות', width: 100, render: (r) => <span className="truncate text-slate-600">{r.meta?.owner_name ?? ''}</span>, sortValue: (r) => r.meta?.owner_name ?? null },
    { key: 'source', header: 'מקור כספי', width: 96, render: (r) => <span className="truncate text-slate-600">{r.meta?.money_source ?? ''}</span>, sortValue: (r) => r.meta?.money_source ?? null },
  ]

  const openCard = (r: CardRow, _i: number, sorted: CardRow[]) => {
    const nav: CardNavState = { codes: sorted.map((x) => x.code), fromLabel: cat ? `קטגוריה «${cat}»` : 'מעקב ותכנון', backTo: `${b.base}/cards${search}` }
    navigate(`${b.base}/card/${r.code}${search}`, { state: nav })
  }

  // "ריכוז הערות לתכנון — יצוא לאקסל": הכרטיסים שיש להם הערה, עם התכנון (שאילתה באקסס)
  const exportNotes = () => {
    const withNotes = rows.filter((r) => r.plan?.notes?.trim())
    const headers = ['מספר הסעיף', 'תאור סעיף', 'קטגוריה 3', 'תקציב הכנסות', 'תקציב הוצאות', 'הכנסות מצטבר', 'הוצאות מצטבר',
      'תכנית הכנסות לשנה הבאה', 'תכנית הוצאות לשנה הבאה', 'פעיל בשנה הקודמת', 'הערות לתכנון תקציב']
    const data = withNotes.map((r) => [r.code, r.name, r.meta?.category3 ?? '', r.budgetIncome, r.budgetExpense, r.cumIncome, r.cumExpense,
      r.nextIncome, r.nextExpense, r.meta?.active_prev_year ? 'כן' : '', r.plan?.notes ?? ''])
    downloadWorkbook({ sheetName: 'הערות לתכנון', headers, rows: data, numericColumns: new Set([3, 4, 5, 6, 7, 8]) },
      `ריכוז_הערות_לתכנון_${b.authorityName || b.code}_${b.year}.xlsx`)
  }

  const periodLabel = b.period === 'calendar' ? `ינואר–דצמבר ${b.year}` : `שנה"ל ${hebrewSchoolYear(b.year)} · ספט׳ ${b.year - 1}–אוג׳ ${b.year}`
  const asOfLabel = b.asOf ? `${new Date(b.asOf).toLocaleDateString('he-IL')} (${HEB_MONTH_NAMES[new Date(b.asOf).getMonth()]})` : '—'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <h1 className="text-lg font-bold text-slate-800">מעקב ותכנון תקציב</h1>
        <span className="rounded-lg bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">{periodLabel}</span>
        <span className="text-slate-500" title="עד מתי הנתונים — מהשם של דוח ה-EPR">נתונים נכונים ל-{asOfLabel} · {monthsLabel(b.elapsed)} חודשים</span>
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {([[null, 'הכול'], ['income', 'הכנסה'], ['expense', 'הוצאה']] as [string | null, string][]).map(([k, label]) => (
            <button key={label} onClick={() => setParam('side', k)}
              className={`rounded-md px-2.5 py-0.5 font-semibold ${side === k ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-500'}`}>{label}</button>
          ))}
        </div>
        {cat && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-600 py-0.5 pl-1 pr-2.5 text-xs font-semibold text-white">
            קטגוריה: {cat}
            <button onClick={() => setParam('cat', null)} className="rounded-full px-1 hover:bg-emerald-700" title="הסרת הסינון">✕</button>
          </span>
        )}
        <span className="mr-auto" />
        <button onClick={exportNotes} className="rounded-lg border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50">ריכוז הערות לתכנון — לאקסל</button>
      </div>
      {/* 025 — מצב התכנית לשנה הבאה: ספירה וסינון; ההגשה והאישור — בעמודה "מצב התכנית" */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-600">תכנית {b.year + 1}:</span>
        {(['draft', 'submitted', 'returned', 'approved'] as PlanStatus[]).map((k) => (
          <button key={k} onClick={() => setParam('plan', planFilter === k ? null : k)}
            className={`rounded-full px-2.5 py-0.5 font-semibold ring-1 transition ${PLAN_STATUS_META[k].tone} ${planFilter === k ? 'ring-2 ring-slate-500' : 'ring-transparent hover:ring-slate-300'}`}>
            {PLAN_STATUS_META[k].label} · {planCounts[k].toLocaleString('he-IL')}
          </button>
        ))}
        <span className="text-slate-400">
          {b.canManage ? 'הגשה, אישור והחזרה' : b.canPlan ? 'הגשה לאישור' : 'המצב'} — בעמודה "מצב התכנית", בקבוצת "תכנית {b.year + 1}"
        </span>
        {!hasOrders && (
          <span className="mr-auto text-slate-400" title="מצטבר + הזמנות פתוחות (לא סופק בדוח ההזמנות)">
            העמודות "הזמנות פתוחות" ו"מחויב" יופיעו כשייקלט דוח ההזמנות — עוד לא נקלט
          </span>
        )}
      </div>
      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      <datalist id={CAT_LIST}>{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <BagrutTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.code}
        onRowClick={openCard}
        openLabel="כרטיס הסעיף"
        exportName={`מעקב_ותכנון_${b.authorityName || b.code}_${b.year}`}
        sheetName={`מעקב ותכנון ${b.year}`}
        empty="אין כרטיסים שעונים על הסינון"
        countLabel="כרטיסים"
        rowTitle={(r) => `${r.code} · ${r.name}`}
        initialSort={{ key: 'code', dir: 'asc' }}
        storageKey="budget-cards-v2"
        summary={(shown) => <Summary rows={shown} />}
      />
      <p className="text-xs text-slate-500">
        {b.canPlan ? 'צפי ותכנית — לחיצה על התא ועריכה; נשמר ביציאה מהתא. ' : ''}
        צפי ריק מוצג באפור ואינו נשמר — {b.seasonal
          ? 'לפי השנה שעברה: מה שנרשם עד היום, ועוד מה שנרשם באותם חודשים בשנה שעברה (כרטיס בלי נתונים בשנה שעברה — לפי הקצב).'
          : `לפי הקצב (${monthsLabel(b.elapsed)} מתוך 12 חודשים).`}
        {' '}מצב התכנית: אחראי מגיש, מנהל התקציב מאשר או מחזיר; עריכה אחרי אישור מחזירה לעבודה.
        הכנסות מצטבר = Σ זכות, הוצאות מצטבר = Σ חובה, בתקופה שנבחרה.
      </p>
    </div>
  )
}

/** שורת הסה"כ — כמו בתחתית הטופס באקסס */
function Summary({ rows }: { rows: CardRow[] }) {
  const t = totals(rows)
  const cell = (label: string, value: string, tone = 'text-slate-800') => (
    <div className="min-w-[7.5rem] rounded-lg bg-white px-3 py-1.5 ring-1 ring-slate-200">
      <div className={`text-sm font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
  const gapBudget = t.budgetIncome - t.budgetExpense
  const gapExec = t.cumIncome - t.cumExpense
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-bold text-slate-600">סה"כ · {t.count.toLocaleString('he-IL')} כרטיסים</span>
      {cell('תקציב הכנסות', money(t.budgetIncome), 'text-teal-800')}
      {cell('תקציב הוצאות', money(t.budgetExpense), 'text-rose-800')}
      {cell('הכנסות מצטבר', money(t.cumIncome), 'text-teal-800')}
      {cell('הוצאות מצטבר', money(t.cumExpense), 'text-rose-800')}
      {cell('ביצוע הכנסות', pct(t.budgetIncome ? t.cumIncome / t.budgetIncome : null))}
      {cell('ביצוע הוצאות', pct(t.budgetExpense ? t.cumExpense / t.budgetExpense : null))}
      {cell(gapBudget < 0 ? 'גרעון בתקציב' : 'עודף בתקציב', money(Math.abs(gapBudget)), gapBudget < 0 ? 'text-red-700' : 'text-emerald-700')}
      {cell(gapExec < 0 ? 'גרעון בביצוע' : 'עודף בביצוע', money(Math.abs(gapExec)), gapExec < 0 ? 'text-red-700' : 'text-emerald-700')}
    </div>
  )
}
