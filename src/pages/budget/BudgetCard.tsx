import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'
import { Card, Empty, ErrorBox, Loading } from '@/components/bagrut/ui'
import { ChartCard, Columns } from '@/components/charts/Charts'
import {
  cardFileUrl,
  deleteCardFile,
  fetchCardFiles,
  fetchTransactions,
  parseAmount,
  saveMeta,
  savePlan,
  uploadCardFile,
  type BudgetTransaction,
  type CardFile,
  type CardMeta,
  type CardPlan,
} from '@/lib/budget'
import { isSalaryCard } from '@/lib/budgetTracking'
import { HEB_MONTH_NAMES, money, monthlySeries, pct, usageTone, type CardRow } from '@/lib/budgetCalc'
import { useBudget, type CardNavState } from './context'

/**
 * כרטיס בודד — "טופס כרטסת – מעקב ותכנית תקציב מפורט" באקסס: לכל צד
 * (הכנסות / הוצאות) התכנית, המצטבר, אחוז הביצוע, הצפי לסוף השנה והתכנית
 * לשנה הבאה; הדגלים והקטגוריות; התנועות עד האסמכתא, והקבצים המסייעים.
 */
export default function BudgetCard() {
  const b = useBudget()
  const { card: cardCode = '' } = useParams()
  const { state, search } = useLocation()
  const navigate = useNavigate()
  const nav = state as CardNavState | null
  const row = b.rows.find((r) => r.code === cardCode)

  const [tx, setTx] = useState<BudgetTransaction[] | null>(null)
  const [txError, setTxError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setTx(null)
    setTxError(null)
    fetchTransactions(b.code, cardCode)
      .then((t) => alive && setTx(t))
      .catch((e: Error) => alive && setTxError(e.message))
    return () => { alive = false }
  }, [b.code, cardCode])

  const months = useMemo(() => ({
    inc: monthlySeries(b.monthly, 'credit', b.periodFrom, (c) => c === cardCode),
    exp: monthlySeries(b.monthly, 'debit', b.periodFrom, (c) => c === cardCode),
  }), [b.monthly, b.periodFrom, cardCode])

  if (!row) {
    return <Empty title={`כרטיס ${cardCode} אינו בתקציב ${b.year}`}>ייתכן שהוא לא קיים בשנה הזו, או שאינו באחריותך.</Empty>
  }

  const idx = nav?.codes.indexOf(cardCode) ?? -1
  const go = (i: number) => nav && navigate(`${b.base}/card/${nav.codes[i]}${search}`, { state: nav, replace: true })
  const [p1, p2, p3] = row.parts
  const pace = b.elapsed / 12
  const asOf = b.asOf ? new Date(b.asOf) : null
  const actions = new URLSearchParams(search)
  actions.set('card', row.code)

  const badge = (on: boolean, label: string, tone: string) =>
    on && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      {/* כותרת דביקה — שם הכרטיס נשאר גלוי בגלילה */}
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur">
        <Link to={nav?.backTo ?? `${b.base}/cards${search}`} className="text-sm text-slate-500 hover:text-emerald-700">
          → {nav?.fromLabel ?? 'מעקב ותכנון'}
        </Link>
        <h1 className="text-lg font-bold text-slate-800">{row.name || '(ללא שם)'}</h1>
        <span className="font-mono text-sm text-slate-400" dir="ltr" title="3 + 4 + 3 ספרות, כמו באקסס">{p1} · {p2} · {p3}</span>
        {badge(row.isIncome, 'הכנסה', 'bg-teal-50 text-teal-700')}
        {badge(row.isExpense, 'הוצאה', 'bg-rose-50 text-rose-700')}
        {badge(Boolean(row.meta?.in_meitar), 'במיתר', 'bg-violet-50 text-violet-700')}
        {badge(Boolean(row.meta?.gefen), 'קשור לגפ"ן', 'bg-amber-50 text-amber-700')}
        {!row.card && <span className="text-xs text-slate-400" title="הכרטיס מופיע בקובץ התוספתיים בלבד">אין בדוח הכרטיסים של EPR</span>}
        <span className="mr-auto flex items-center gap-1 text-sm">
          <Link to={`${b.base}/actions?${actions}`} className="rounded-lg border border-emerald-300 px-3 py-0.5 font-semibold text-emerald-700 hover:bg-emerald-50">
            לפירוט הפעולות ←
          </Link>
          {nav && idx >= 0 && (
            <>
              <button disabled={idx <= 0} onClick={() => go(idx - 1)} className="rounded px-2 py-0.5 hover:bg-slate-200 disabled:opacity-30">→ הקודם</button>
              <span className="tabular-nums text-slate-400">{idx + 1}/{nav.codes.length}</span>
              <button disabled={idx >= nav.codes.length - 1} onClick={() => go(idx + 1)} className="rounded px-2 py-0.5 hover:bg-slate-200 disabled:opacity-30">הבא ←</button>
            </>
          )}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
        <span>קטגוריה 1: <b className="text-slate-800">{row.meta?.category1 || '—'}</b></span>
        <span>קטגוריה 2: <b className="text-slate-800">{row.meta?.category2 || '—'}</b></span>
        <span>קטגוריה 3: <b className="text-slate-800">{row.meta?.category3 || '—'}</b></span>
        <span className="mr-auto" title="עד מתי הנתונים — מהשם של דוח ה-EPR">
          חודש ביצוע העדכון: <b className="text-slate-800">{asOf ? `${asOf.getMonth() + 1} · ${HEB_MONTH_NAMES[asOf.getMonth()]}` : '—'}</b>
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Side title="הכנסות" tone="text-teal-800" plan={row.budgetIncome} cum={row.cumIncome} usage={row.pctIncome} pace={0}
          forecast={row.forecastIncome} suggested={row.suggestedIncome} next={row.nextIncome} year={b.year} />
        <Side title="הוצאות" tone="text-rose-800" plan={row.budgetExpense} cum={row.cumExpense} usage={row.pctExpense} pace={pace}
          forecast={row.forecastExpense} suggested={row.suggestedExpense} next={row.nextExpense} year={b.year} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PlanEditor row={row} />
        <div className="flex flex-col gap-4">
          {row.cumIncome !== 0 && (
            <ChartCard title="הכנסות לפי חודש" sub="Σ זכות (₪)">
              <Columns items={months.inc} height={110} />
            </ChartCard>
          )}
          <ChartCard title="הוצאות לפי חודש" sub={`Σ חובה (₪) · ${b.period === 'calendar' ? `ינואר–דצמבר ${b.year}` : 'ספטמבר–אוגוסט'}`}>
            <Columns items={months.exp} height={110} />
          </ChartCard>
        </div>
      </div>

      <Card title="תנועות בכרטיס" action={tx && <span className="text-xs text-slate-400">{tx.length.toLocaleString('he-IL')} תנועות · כל השנים</span>}>
        {/* 024 — פרטיות: אחראי תקציב אינו רואה תנועות בכרטיסי שכר (ה-RLS, מיגרציה 047), רק את הסיכומים */}
        {b.isOwner && isSalaryCard(row.code) ? (
          <p className="text-sm text-slate-500">
            כרטיס שכר — התנועות עצמן (שמות עובדים ותשלומי שכר) מוצגות רק למנהל התקציב. הסיכומים החודשיים והביצוע — למעלה.
          </p>
        ) : txError ? <ErrorBox message={txError} /> : tx == null ? <Loading label="טוען תנועות…" /> : <Transactions rows={tx} name={`${row.code}_${row.name}`} />}
      </Card>

      <Files code={b.code} card={row.code} canEdit={b.canPlan} />
    </div>
  )
}

/** צד אחד של הכרטיס — הכנסות או הוצאות, כמו שתי העמודות בטופס באקסס */
function Side({ title, tone, plan, cum, usage, pace, forecast, suggested, next, year }: {
  title: string; tone: string; plan: number | null; cum: number; usage: number | null; pace: number
  forecast: number | null; suggested: number | null; next: number | null; year: number
}) {
  const cell = (label: string, value: ReactNode, sub?: string) => (
    <div className="min-w-0">
      <div className="text-lg font-extrabold tabular-nums text-slate-800">{value || '—'}</div>
      <div className="text-xs font-semibold text-slate-600">{label}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  )
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm">
      <div className={`mb-2 text-sm font-bold ${tone}`}>{title}</div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {cell(`תכנית ${year}`, money(plan), 'התקציב המאושר')}
        {cell('מצטבר', money(cum || null), 'בתקופה שנבחרה')}
        {cell('ביצוע', <span className={usageTone(usage, pace)}>{pct(usage)}</span>, 'מצטבר ביחס לתקציב')}
        {cell('צפי לסוף השנה', money(forecast ?? suggested), forecast == null ? (suggested == null ? undefined : 'לפי הקצב — לא הוקלד') : 'הוקלד')}
        {cell(`תכנית ${year + 1}`, money(next))}
      </div>
    </div>
  )
}

/**
 * שכבת המשתמש של הכרטיס: סיווג ודגלים (מנהל), צפי ותכנית לשני הצדדים והערות
 * (מנהל או אחראי). קובץ התוספתיים הבא דורס את מה שנערך כאן לכרטיסים שבו.
 */
function PlanEditor({ row }: { row: CardRow }) {
  const b = useBudget()
  const metaInit = (m: CardMeta | null) => ({
    category1: m?.category1 ?? '', category2: m?.category2 ?? '', category3: m?.category3 ?? '',
    owner_name: m?.owner_name ?? '', money_source: m?.money_source ?? '', meitar_topic: m?.meitar_topic ?? '',
    gefen: m?.gefen ?? false, in_meitar: m?.in_meitar ?? false, active_prev_year: m?.active_prev_year ?? false,
    is_income: m?.is_income ?? row.isIncome, is_expense: m?.is_expense ?? row.isExpense,
  })
  const num = (v: number | null | undefined) => (v == null ? '' : String(v))
  const planInit = (p: CardPlan | null) => ({
    forecast_income: num(p?.forecast_income), forecast_expense: num(p?.forecast_expense),
    next_income: num(p?.next_income), next_expense: num(p?.next_expense),
    notes: p?.notes ?? '',
  })
  const [meta, setMeta] = useState(() => metaInit(row.meta))
  const [plan, setPlan] = useState(() => planInit(row.plan))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // מעבר לכרטיס אחר (הקודם/הבא) — הטופס מתאפס לנתוני הכרטיס החדש
  useEffect(() => {
    setMeta(metaInit(row.meta))
    setPlan(planInit(row.plan))
    setMsg(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.code])

  const metaDirty = JSON.stringify(meta) !== JSON.stringify(metaInit(row.meta))
  const planDirty = JSON.stringify(plan) !== JSON.stringify(planInit(row.plan))

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      if (metaDirty) {
        const t = (v: string) => v.trim() || null
        b.applyMeta(await saveMeta(b.code, row.code, {
          category1: t(meta.category1), category2: t(meta.category2), category3: t(meta.category3),
          owner_name: t(meta.owner_name), money_source: t(meta.money_source), meitar_topic: t(meta.meitar_topic),
          gefen: meta.gefen, in_meitar: meta.in_meitar, active_prev_year: meta.active_prev_year,
          is_income: meta.is_income, is_expense: meta.is_expense,
        }, row.meta))
      }
      if (planDirty) {
        b.applyPlan(await savePlan(b.code, row.code, b.year, {
          forecast_income: parseAmount(plan.forecast_income), forecast_expense: parseAmount(plan.forecast_expense),
          next_income: parseAmount(plan.next_income), next_expense: parseAmount(plan.next_expense),
          notes: plan.notes.trim() || null,
        }, row.plan))
      }
      setMsg({ ok: true, text: 'נשמר' })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-emerald-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500'
  const field = (label: string, el: ReactNode) => (
    <label className="block text-xs font-semibold text-slate-500">{label}<div className="mt-0.5 font-normal">{el}</div></label>
  )
  type TextKey = 'category1' | 'category2' | 'category3' | 'owner_name' | 'money_source' | 'meitar_topic'
  const m = (k: TextKey) => (
    <input className={input} disabled={!b.canManage} value={meta[k]} onChange={(e) => setMeta({ ...meta, [k]: e.target.value })} />
  )
  type FlagKey = 'is_income' | 'is_expense' | 'in_meitar' | 'gefen' | 'active_prev_year'
  const flag = (k: FlagKey, label: string) => (
    <label className="flex items-center gap-1.5 text-sm text-slate-600">
      <input type="checkbox" disabled={!b.canManage} checked={meta[k]} onChange={(e) => setMeta({ ...meta, [k]: e.target.checked })} className="accent-emerald-600" />
      {label}
    </label>
  )
  type PlanKey = 'forecast_income' | 'forecast_expense' | 'next_income' | 'next_expense'
  const p = (k: PlanKey, placeholder?: number | null) => (
    <input className={input} dir="ltr" inputMode="decimal" disabled={!b.canPlan} value={plan[k]}
      placeholder={placeholder != null ? `${money(placeholder)} (לפי הקצב)` : ''}
      onChange={(e) => setPlan({ ...plan, [k]: e.target.value })} />
  )

  return (
    <Card title="סיווג ותכנון">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {field('קטגוריה 1', m('category1'))}
        {field('קטגוריה 2', m('category2'))}
        {field('קטגוריה 3', m('category3'))}
        {field('באחריות', m('owner_name'))}
        {field('מקור כספי', m('money_source'))}
        {field('נושא במיתר (קוד)', m('meitar_topic'))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {flag('is_income', 'הכנסה')}
        {flag('is_expense', 'הוצאה')}
        {flag('in_meitar', 'במיתר')}
        {flag('gefen', 'קשור לגפ"ן')}
        {flag('active_prev_year', 'פעיל בשנה הקודמת')}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
        {field(`צפי הכנסות לסוף ${b.year}`, p('forecast_income', row.suggestedIncome))}
        {field(`צפי הוצאות לסוף ${b.year}`, p('forecast_expense', row.suggestedExpense))}
        {field(`תכנית הכנסות ${b.year + 1}`, p('next_income'))}
        {field(`תכנית הוצאות ${b.year + 1}`, p('next_expense'))}
      </div>
      <div className="mt-3">
        {field('הערות לתכנון', (
          <textarea rows={3} className={input} disabled={!b.canPlan} value={plan.notes} onChange={(e) => setPlan({ ...plan, notes: e.target.value })} />
        ))}
      </div>
      {(b.canPlan || b.canManage) && (
        <div className="mt-3 flex items-center gap-3">
          <button onClick={save} disabled={busy || (!metaDirty && !planDirty)}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
            {busy ? 'שומר…' : 'שמירה'}
          </button>
          {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</span>}
          {!b.canManage && <span className="text-xs text-slate-400">סיווג ודגלים — רק מנהל התקציב</span>}
        </div>
      )}
    </Card>
  )
}

function Transactions({ rows, name }: { rows: BudgetTransaction[]; name: string }) {
  const date = (d: string | null) => (d ? new Date(d).toLocaleDateString('he-IL') : '')
  const columns: Column<BudgetTransaction>[] = [
    { key: 'date', header: 'תאריך', width: 92, render: (t) => (t.is_opening ? <span className="text-xs font-semibold text-slate-500">יתרת פתיחה</span> : date(t.event_date)), sortValue: (t) => t.event_date ?? '', exportValue: (t) => (t.is_opening ? 'יתרת פתיחה' : date(t.event_date)) },
    { key: 'details', header: 'פרטים', width: 260, render: (t) => <span className="truncate">{t.details}</span>, sortValue: (t) => t.details },
    { key: 'counter', header: 'חשבון נגדי', width: 170, render: (t) => <span className="truncate text-slate-600">{t.counter_name ?? t.counter_account ?? ''}</span>, sortValue: (t) => t.counter_name ?? t.counter_account },
    { key: 'voucher', header: 'פקודה', width: 110, render: (t) => <span className="font-mono text-xs text-slate-500" dir="ltr">{t.voucher}</span>, sortValue: (t) => t.voucher },
    { key: 'ref1', header: 'אסמכתא', width: 110, render: (t) => <span className="font-mono text-xs text-slate-500" dir="ltr">{t.ref1 === '0' ? '' : t.ref1}</span>, sortValue: (t) => t.ref1 },
    { key: 'debit', header: 'חובה', width: 96, render: (t) => <span className="tabular-nums">{t.debit ? money(t.debit) : ''}</span>, sortValue: (t) => t.debit, exportValue: (t) => t.debit, filter: false },
    { key: 'credit', header: 'זכות', width: 96, render: (t) => <span className="tabular-nums">{t.credit ? money(t.credit) : ''}</span>, sortValue: (t) => t.credit, exportValue: (t) => t.credit, filter: false },
    { key: 'balance', header: 'יתרה', width: 104, render: (t) => <span className="tabular-nums text-slate-500">{money(t.balance)}</span>, sortValue: (t) => t.balance, exportValue: (t) => t.balance, filter: false },
    { key: 'topic', header: 'נושא מיתר', width: 76, render: (t) => <span className="font-mono text-xs text-teal-700">{t.meitar_topic ?? ''}</span>, sortValue: (t) => t.meitar_topic },
    { key: 'cost', header: 'תמחיר', width: 70, render: (t) => <span className="text-xs text-slate-500">{t.cost_center === '0' ? '' : t.cost_center}</span>, sortValue: (t) => t.cost_center },
  ]
  return (
    <div className="flex h-[28rem] flex-col">
      <BagrutTable rows={rows} columns={columns} rowKey={(t) => String(t.id)} exportName={`תנועות_${name}`}
        sheetName="תנועות" countLabel="תנועות" empty="אין תנועות בכרטיס" storageKey="budget-transactions" />
    </div>
  )
}

function Files({ code, card, canEdit }: { code: string; card: string; canEdit: boolean }) {
  const [files, setFiles] = useState<CardFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setFiles(null)
    fetchCardFiles(code, card).then(setFiles).catch((e: Error) => setError(e.message))
  }, [code, card])

  async function add(list: FileList | null) {
    if (!list?.length) return
    setBusy(true)
    setError(null)
    try {
      for (const f of Array.from(list)) {
        const created = await uploadCardFile(code, card, f)
        setFiles((cur) => [created, ...(cur ?? [])])
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove(f: CardFile) {
    if (!confirm(`למחוק את «${f.file_name}»?`)) return
    setError(null)
    try {
      await deleteCardFile(f)
      setFiles((cur) => (cur ?? []).filter((x) => x.id !== f.id))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function open(f: CardFile) {
    const url = await cardFileUrl(f)
    if (url) window.open(url, '_blank', 'noopener')
  }

  return (
    <Card title="קבצים מצורפים" action={canEdit && (
      <label className="cursor-pointer rounded-lg border border-dashed border-emerald-400 px-3 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
        {busy ? 'מעלה…' : '+ קובץ'}
        <input type="file" multiple hidden disabled={busy} onChange={(e) => add(e.target.files)} />
      </label>
    )}>
      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {files == null ? <p className="text-sm text-slate-400">טוען…</p> : files.length === 0 ? (
        <p className="text-sm text-slate-400">אין קבצים. חשבוניות, הצעות מחיר ואישורים — אפשר לצרף כאן.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-1.5 text-sm">
              <button onClick={() => open(f)} className="min-w-0 flex-1 truncate text-right text-emerald-700 hover:underline">{f.file_name}</button>
              <span className="text-xs text-slate-400">{new Date(f.uploaded_at).toLocaleDateString('he-IL')}</span>
              {canEdit && <button onClick={() => remove(f)} className="rounded px-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" title="מחיקה">✕</button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
