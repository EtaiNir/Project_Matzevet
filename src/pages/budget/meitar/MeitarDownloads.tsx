import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, ErrorBox, Loading } from '@/components/bagrut/ui'
import { hebrewSchoolYear } from '@/lib/budgetCalc'
import {
  fetchInstitutionTotals,
  fetchMeitarDownloads,
  fetchMeitarRuns,
  monthLong,
  monthShort,
  requestMeitarDownload,
  schoolYearMonths,
  schoolYearOf,
  type MeitarDownload,
  type MeitarEntity,
  type MeitarRun,
} from '@/lib/meitar'
import { useMeitar } from './context'

type Cell = { kind: 'loaded'; at: string } | { kind: 'download'; d: MeitarDownload } | { kind: 'none' } | { kind: 'future' }

const STATUS: Record<MeitarDownload['status'], { icon: string; text: string; tone: string }> = {
  requested: { icon: '⏳', text: 'ממתין לסוכן', tone: 'bg-sky-50 text-sky-800' },
  waiting: { icon: '…', text: 'עוד לא פורסם', tone: 'bg-slate-100 text-slate-600' },
  downloading: { icon: '⬇', text: 'מוריד', tone: 'bg-sky-50 text-sky-800' },
  done: { icon: '⬇', text: 'הורד — נקלט עכשיו', tone: 'bg-emerald-50 text-emerald-800' },
  failed: { icon: '✗', text: 'נכשל — ינסה שוב', tone: 'bg-red-50 text-red-700' },
  gave_up: { icon: '⛔', text: 'הופסק אחרי 5 ימים', tone: 'bg-red-50 text-red-800' },
}

/**
 * הורדות — "ריכוז הורדות מיתר" באקסס, אבל חי: לכל מקור ולכל חודש בשנה"ל —
 * נקלט, ממתין לפרסום, נכשל. הסוכן מוריד לבד; "הורד" מבקש ממנו עכשיו (עד 20
 * דקות), גם לחודשים קודמים — כך ממלאים היסטוריה.
 */
export default function MeitarDownloads() {
  const m = useMeitar()
  const nowSy = schoolYearOf(new Date().toISOString().slice(0, 10))
  const years = [...new Set([nowSy, m.year, nowSy - 1, nowSy - 2])].sort((a, b) => b - a)
  const [sy, setSy] = useState(m.period === 'school' ? m.year : nowSy)
  const [runs, setRuns] = useState<MeitarRun[] | null>(null)
  const [downloads, setDownloads] = useState<MeitarDownload[]>([])
  const [totals, setTotals] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    Promise.all([fetchMeitarRuns(m.code), fetchMeitarDownloads(m.code), fetchInstitutionTotals(m.code, sy)])
      .then(([r, d, t]) => {
        setRuns(r)
        setDownloads(d)
        setTotals(new Set(t.map((x) => `${x.institution_code}|${x.calc_month.slice(0, 10)}`)))
      })
      .catch((e: Error) => setError(e.message))
  }, [m.code, sy])
  useEffect(() => { load() }, [load])
  // כל עוד יש בקשה פתוחה — מרעננים, כדי לראות את הסוכן עובד
  useEffect(() => {
    if (!downloads.some((d) => d.status === 'requested' || d.status === 'downloading')) return
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [downloads, load])

  const months = schoolYearMonths(sy)
  const thisMonth = new Date().toISOString().slice(0, 7) + '-01'
  const cell = (e: MeitarEntity, month: string): Cell => {
    if (month >= thisMonth) return { kind: 'future' }
    const run = runs?.find((r) => r.entity_code === e.entity_code && r.calc_month.slice(0, 10) === month)
    if (run) return { kind: 'loaded', at: run.loaded_at }
    if (totals.has(`${e.entity_code}|${month}`)) return { kind: 'loaded', at: '' }
    const d = downloads.find((x) => x.entity_code === e.entity_code && x.calc_month.slice(0, 10) === month)
    return d ? { kind: 'download', d } : { kind: 'none' }
  }

  const request = async (e: MeitarEntity, list: string[]) => {
    setError(null)
    setBusy(`${e.entity_code}|${list.join(',')}`)
    try {
      for (const month of list) {
        const saved = await requestMeitarDownload(m.code, e.entity_code, month)
        setDownloads((ds) => [saved, ...ds.filter((x) => !(x.entity_code === saved.entity_code && x.calc_month === saved.calc_month))])
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <Card title="איך זה עובד">
        <p className="text-sm text-slate-600">
          הסוכן במחשב של סבא בודק כל 20 דקות. מה-3 בחודש הוא מוריד מאתר המיתר של המשרד את החודש הקודם לכל מקור עם
          הורדה אוטומטית — ואם החודש עוד לא פורסם, מנסה שוב עד 5 ימים. כל קובץ שירד נקלט מיד ומופיע ב
          <Link to={`/budget/${m.code}/upload`} className="font-semibold text-emerald-700 hover:underline">היסטוריית הקליטות</Link>.
          {m.canManage && ' "הורד" מבקש מהסוכן עכשיו — גם חודש קודם או שנה שלמה.'}
        </p>
      </Card>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-600">שנה"ל:</span>
        <select value={sy} onChange={(e) => setSy(Number(e.target.value))} className="rounded-lg border border-slate-300 px-2 py-1">
          {years.map((y) => <option key={y} value={y}>{hebrewSchoolYear(y)}</option>)}
        </select>
      </div>

      {error && <ErrorBox message={error} />}
      {runs == null ? <Loading label="טוען…" /> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="sticky right-0 bg-white px-3 py-2 text-right font-semibold">מקור</th>
                {months.map((mo) => <th key={mo} className="px-1 py-2 font-semibold">{monthShort(mo)}</th>)}
                {m.canManage && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody>
              {m.entities.map((e) => {
                const missing = months.filter((mo) => cell(e, mo).kind === 'none' || (cell(e, mo).kind === 'download'
                  && ['failed', 'gave_up'].includes((cell(e, mo) as { d: MeitarDownload }).d.status)))
                return (
                  <tr key={e.entity_code} className="border-b border-slate-100">
                    <td className="sticky right-0 bg-white px-3 py-1.5">
                      <div className="font-semibold text-slate-800">{e.name}</div>
                      <div className="text-[10px] text-slate-400">{e.kind === 'moteb' ? 'מוטב' : 'מוסד'} {e.entity_code}{e.auto_download ? '' : ' · בלי הורדה אוטומטית'}</div>
                    </td>
                    {months.map((mo) => {
                      const c = cell(e, mo)
                      const key = `${e.entity_code}|${mo}`
                      return (
                        <td key={mo} className="px-0.5 py-1 text-center">
                          {c.kind === 'future' ? <span className="text-slate-200">·</span>
                            : c.kind === 'loaded' ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-800" title={`נקלט${c.at ? ' ' + new Date(c.at).toLocaleString('he-IL') : ''}`}>✓</span>
                              : c.kind === 'download' ? (
                                <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 ${STATUS[c.d.status].tone}`}
                                  title={`${monthLong(mo)}: ${STATUS[c.d.status].text}${c.d.attempts ? ` · ${c.d.attempts} ניסיונות` : ''}${c.d.last_error ? `\n${c.d.last_error}` : ''}`}>
                                  {STATUS[c.d.status].icon}
                                  {m.canManage && ['failed', 'gave_up', 'waiting', 'done'].includes(c.d.status) && (
                                    <button disabled={busy != null} onClick={() => request(e, [mo])} className="mr-0.5 underline">שוב</button>
                                  )}
                                </span>
                              ) : m.canManage ? (
                                <button disabled={busy != null} onClick={() => request(e, [mo])}
                                  className="rounded border border-dashed border-slate-300 px-1.5 py-0.5 text-slate-500 hover:border-emerald-400 hover:text-emerald-700"
                                  title={`להוריד את ${monthLong(mo)}`}>{busy === key ? '…' : 'הורד'}</button>
                              ) : <span className="text-slate-300">—</span>}
                        </td>
                      )
                    })}
                    {m.canManage && (
                      <td className="px-2 py-1">
                        {missing.length > 0 && (
                          <button disabled={busy != null} onClick={() => request(e, missing)}
                            className="whitespace-nowrap rounded-lg border border-emerald-300 px-2 py-0.5 font-semibold text-emerald-700 hover:bg-emerald-50">
                            הורד {missing.length} חסרים
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        ✓ נקלט · ⏳ ממתין לסוכן · … עוד לא פורסם (הסוכן ינסה שוב) · ✗ נכשל באתר המשרד (ינסה שוב) · ⛔ הופסק אחרי 5 ימים.
        לבית ספר נשמר רק הסיכום הרשמי — השורות שלו כבר בקובץ של המועצה.
      </p>
    </div>
  )
}
