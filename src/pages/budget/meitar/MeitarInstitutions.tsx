import { useEffect, useMemo, useState } from 'react'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'
import { Empty, ErrorBox, Loading } from '@/components/bagrut/ui'
import { money } from '@/lib/budgetCalc'
import { fetchMeitarRows, monthLong, type MeitarRow } from '@/lib/meitar'
import { useMeitar } from './context'

interface InstRow {
  key: string
  code: string | null
  name: string
  settlement: string | null
  /** מצטבר בשנה"ל (סכום מחושב, תחולה בשנה"ל) */
  cum: number
  diff: number
  prior: number
  rows: number
  topics: number
  /** מקור רשום — בית ספר שאפשר לעבור לתצוגה שלו */
  entity: string | null
  /** RICUZMOSDOT מה-ZIP של בית הספר */
  official: number | null
}

const NO_MONEY = new Set(['MISROT', 'MISROTGY', 'ICHLUSKITOT', 'HASNET', 'HASMASLULIM'])

/**
 * מוסדות — "ריכוז מוסדות חודשי" באקסס. בתצוגת המועצה: כל מוסד ויישוב בקובץ
 * בחודש שנבחר; לבית ספר רשום — מול הסיכום הרשמי שלו. בתצוגת בית ספר: ההתאמה
 * לסיכום הרשמי חודש-חודש.
 */
export default function MeitarInstitutions() {
  const m = useMeitar()
  const run = m.runs.find((r) => r.calc_month.slice(0, 10) === m.month) ?? null
  const [rows, setRows] = useState<MeitarRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!run || m.institution) return
    let alive = true
    setRows(null)
    fetchMeitarRows(run.id)
      .then((r) => alive && setRows(r))
      .catch((e: Error) => alive && setError(e.message))
    return () => { alive = false }
  }, [run, m.institution])

  const schools = useMemo(() => new Map(m.entities.filter((e) => e.kind === 'mosad').map((e) => [e.entity_code, e])), [m.entities])
  const insts: InstRow[] = useMemo(() => {
    if (!rows || !m.month) return []
    const by = new Map<string, InstRow & { topicSet: Set<string> }>()
    for (const r of rows) {
      if (NO_MONEY.has(r.source_file)) continue
      const key = r.institution_code ? `i:${r.institution_code}` : r.settlement_code ? `s:${r.settlement_code}` : 'x'
      const x = by.get(key) ?? {
        key, code: r.institution_code, name: r.institution_name ?? (r.settlement_name ? `יישוב ${r.settlement_name}` : 'ברמת הרשות'),
        settlement: r.settlement_name, cum: 0, diff: 0, prior: 0, rows: 0, topics: 0, topicSet: new Set<string>(),
        entity: r.institution_code && schools.has(r.institution_code) ? r.institution_code : null, official: null,
      }
      if (r.prior_year) x.prior += r.diff ?? 0
      else {
        x.cum += r.computed ?? 0
        x.diff += r.diff ?? 0
      }
      x.rows += 1
      if (r.topic_code) x.topicSet.add(r.topic_code)
      by.set(key, x)
    }
    for (const t of m.instTotals) {
      if (t.calc_month.slice(0, 10) !== m.month) continue
      const x = by.get(`i:${t.institution_code}`)
      if (x) x.official = t.computed
    }
    return [...by.values()].map(({ topicSet, ...x }) => ({ ...x, topics: topicSet.size }))
  }, [rows, m.month, m.instTotals, schools])

  if (!m.month) return <Empty title="אין עדיין קובצי מיתר בשנה״ל הזו">אפשר לבקש הורדה במסך ההורדות.</Empty>
  if (m.institution) return <SchoolMonths />

  const columns: Column<InstRow>[] = [
    {
      key: 'name', header: 'מוסד / יישוב', width: 220, sticky: true, sortValue: (r) => r.name,
      render: (r) => (r.entity
        ? <button onClick={(e) => { e.stopPropagation(); m.setParam('entity', r.entity) }} className="truncate font-semibold text-emerald-700 hover:underline" title="מעבר לתצוגת בית הספר">{r.name}</button>
        : <span className="truncate text-slate-800">{r.name}</span>),
    },
    { key: 'code', header: 'סמל מוסד', width: 84, render: (r) => <span className="font-mono text-xs text-slate-500">{r.code ?? ''}</span>, sortValue: (r) => r.code },
    { key: 'cum', header: 'מצטבר בשנה"ל', width: 120, filter: false, render: (r) => <span className="font-bold tabular-nums text-emerald-800">{money(r.cum)}</span>, sortValue: (r) => r.cum, exportValue: (r) => Math.round(r.cum) },
    { key: 'diff', header: 'החודש', width: 104, filter: false, render: (r) => <span className="tabular-nums">{money(r.diff || null)}</span>, sortValue: (r) => r.diff, exportValue: (r) => Math.round(r.diff) },
    { key: 'prior', header: 'רטרו לשנה קודמת', width: 116, filter: false, render: (r) => <span className="tabular-nums text-amber-700">{money(r.prior || null)}</span>, sortValue: (r) => r.prior, exportValue: (r) => Math.round(r.prior) },
    {
      key: 'official', header: 'סיכום רשמי', width: 130, filter: false, sortValue: (r) => r.official, exportValue: (r) => r.official,
      render: (r) => (r.official == null ? (r.entity ? <span className="text-xs text-slate-400">לא הורד</span> : '')
        : Math.abs(r.official - r.cum) < 1 ? <span className="tabular-nums text-emerald-700">✓ {money(r.official)}</span>
          : <span className="tabular-nums font-semibold text-amber-700" title={`פער ${money(r.official - r.cum)}`}>{money(r.official)}</span>),
    },
    { key: 'topics', header: 'נושאים', width: 70, filter: false, render: (r) => <span className="tabular-nums text-slate-500">{r.topics}</span>, sortValue: (r) => r.topics },
    { key: 'rows', header: 'שורות', width: 70, filter: false, render: (r) => <span className="tabular-nums text-slate-400">{r.rows}</span>, sortValue: (r) => r.rows },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      {error ? <ErrorBox message={error} /> : rows == null ? <Loading label="טוען את קובץ החודש…" /> : (
        <BagrutTable rows={insts} columns={columns} rowKey={(r) => r.key}
          exportName={`מיתר_מוסדות_${m.month.slice(0, 7)}`} sheetName={`מוסדות ${m.month.slice(0, 7)}`}
          countLabel="מוסדות ויישובים" initialSort={{ key: 'cum', dir: 'desc' }} storageKey="meitar-institutions"
          empty="אין מוסדות בקובץ החודש" />
      )}
      <p className="text-xs text-slate-500">
        {monthLong(m.month)}. בתי ספר שבמקורות המיתר מודגשים — לחיצה עוברת לתצוגה שלהם; "סיכום רשמי" הוא RICUZMOSDOT
        מה-ZIP של בית הספר, ו-✓ אומר שהוא שווה למצטבר שחושב כאן משורות המוסד בקובץ המועצה.
      </p>
    </div>
  )
}

/** בתצוגת בית ספר: המצטבר שחושב משורות המוסד מול הסיכום הרשמי, חודש-חודש */
function SchoolMonths() {
  const m = useMeitar()
  const derived = new Map<string, number>()
  for (const r of m.monthTopics) derived.set(r.calc_month, (derived.get(r.calc_month) ?? 0) + r.computed)
  const official = new Map(m.instTotals.filter((t) => t.institution_code === m.institution).map((t) => [t.calc_month.slice(0, 10), t.computed]))
  return (
    <div className="mx-auto w-full max-w-3xl p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-right text-slate-500">
            <th className="py-1.5 font-semibold">חודש חישוב</th>
            <th className="py-1.5 font-semibold">מצטבר — משורות המוסד בקובץ המועצה</th>
            <th className="py-1.5 font-semibold">סיכום רשמי (RICUZMOSDOT)</th>
            <th className="py-1.5 font-semibold">התאמה</th>
          </tr>
        </thead>
        <tbody>
          {m.months.map((mo) => {
            const d = derived.get(mo) ?? 0
            const o = official.get(mo)
            return (
              <tr key={mo} className="border-b border-slate-100">
                <td className="py-1.5">{monthLong(mo)}</td>
                <td className="py-1.5 tabular-nums">{money(d)}</td>
                <td className="py-1.5 tabular-nums">{o == null ? <span className="text-xs text-slate-400">לא הורד</span> : money(o)}</td>
                <td className="py-1.5">{o == null ? '' : Math.abs((o ?? 0) - d) < 1 ? <span className="text-emerald-700">✓</span> : <span className="font-semibold text-amber-700">פער {money((o ?? 0) - d)}</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
