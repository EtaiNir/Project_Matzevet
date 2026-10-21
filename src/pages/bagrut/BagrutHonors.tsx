import { useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useBagrut, type CardNavState } from './context'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'
import { Empty, Kpi, StatusBadge } from '@/components/bagrut/ui'
import { classSortKey, displayName, eligibilityKind, ELIGIBILITY_META, fmt, type BagrutStudent, studentPath } from '@/lib/bagrut'
import {
  EXCELLENCE_AVERAGE,
  HONOR_KEYS,
  HONOR_META,
  honorsMap,
  missingText,
  type HonorKey,
  type Honors,
} from '@/lib/bagrutHonors'
import { useCanSeeIds } from '@/lib/idVisibility'

type Show = 'yes' | 'near' | 'all'
const SHOW_LABELS: Record<Show, string> = { yes: 'עומדים בתנאים', near: 'חסר תנאי אחד', all: 'כל השכבה המסיימת' }

/**
 * בגרות מצטיינת ובגרות טק — מסך סינון (אייל, 19.10). שלושה מדדים, ולכל אחד
 * מי שעומד בתנאים, מי שחסר לו תנאי אחד (שם אפשר לעבוד), וכל השכבה המסיימת.
 * החישוב ב-lib/bagrutHonors — מעל ניתוח הזכאות, לא במקומו (decisions/019).
 * הסינון ב-URL, כמו ברשימת התלמידים: "חזרה" מהכרטיס מחזיר לאותה רשימה.
 */
export default function BagrutHonors() {
  const { data, index, round, base } = useBagrut()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const showIds = useCanSeeIds('bagrut')

  const type = (HONOR_KEYS as string[]).includes(params.get('type') ?? '') ? (params.get('type') as HonorKey) : 'excellence'
  const show = (['yes', 'near', 'all'] as string[]).includes(params.get('show') ?? '') ? (params.get('show') as Show) : 'yes'
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    next.set(key, value)
    setParams(next, { replace: true })
  }

  const graduating = useMemo(() => data.students.filter((s) => s.in_t2), [data.students])
  const honors = useMemo(() => honorsMap(index, graduating), [index, graduating])
  const h = (s: BagrutStudent) => honors.get(s.student_id) as Honors

  const counts = useMemo(() => {
    const out = {} as Record<HonorKey, { yes: number; near: number }>
    for (const k of HONOR_KEYS) {
      const rs = graduating.map((s) => h(s).results[k])
      out[k] = { yes: rs.filter((r) => r.ok).length, near: rs.filter((r) => r.missing === 1).length }
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graduating, honors])

  const rows = useMemo(
    () => graduating.filter((s) => {
      const r = h(s).results[type]
      return show === 'all' || (show === 'yes' ? r.ok : r.missing === 1)
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graduating, honors, type, show],
  )

  if (!graduating.length) {
    return <Empty title="אין תלמידים בשכבה המסיימת">בגרות מצטיינת וטק נבדקות רק לשכבה המסיימת, שיש לה ניתוח זכאות.</Empty>
  }

  const units = (n: number | null) => (n != null ? `${n} יח״ל` : '')
  const columns: Column<BagrutStudent>[] = [
    {
      key: 'name', header: 'שם', width: 170, sticky: true,
      render: (s) => <span className="truncate font-semibold text-slate-800">{displayName(s)}</span>,
      sortValue: displayName,
    },
    { key: 'class', header: 'כיתה', width: 70, align: 'center', render: (s) => s.class_name, sortValue: (s) => classSortKey(s.class_name), exportValue: (s) => s.class_name },
    { key: 'id', header: 'ת"ז', width: 100, render: (s) => <span className="tabular-nums text-slate-500">{s.student_id}</span>, sortValue: (s) => s.student_id },
    {
      key: 'status', header: 'סטטוס זכאות', width: 118,
      render: (s) => <StatusBadge kind={eligibilityKind(s)} manual={Boolean(s.override)} />,
      sortValue: (s) => ['not_eligible', 'one_negative', 'eligible'].indexOf(eligibilityKind(s)),
      exportValue: (s) => `${ELIGIBILITY_META[eligibilityKind(s)].label}${s.override ? ' (שונה ידנית)' : ''}`,
    },
    {
      key: 'english', header: 'אנגלית', width: 80, align: 'center',
      render: (s) => <Level have={h(s).english} need={type === 'tech_no_english' ? null : 5} />,
      sortValue: (s) => h(s).english, exportValue: (s) => units(h(s).english),
    },
    {
      key: 'math', header: 'מתמטיקה', width: 80, align: 'center',
      render: (s) => <Level have={h(s).math} need={type === 'excellence' ? 4 : 5} />,
      sortValue: (s) => h(s).math, exportValue: (s) => units(h(s).math),
    },
    ...(type === 'excellence'
      ? [{
          key: 'avg', header: 'ממוצע משוקלל', width: 100, align: 'center',
          render: (s) => {
            const a = h(s).average
            return a == null ? null : (
              <span className={`font-bold tabular-nums ${a >= EXCELLENCE_AVERAGE ? 'text-emerald-700' : 'text-slate-600'}`} title={`${h(s).averageUnits} יח״ל בממוצע`}>{fmt(a, 1)}</span>
            )
          },
          sortValue: (s) => h(s).average, exportValue: (s) => (h(s).average != null ? Math.round(h(s).average! * 10) / 10 : null),
        } satisfies Column<BagrutStudent>]
      : [{
          key: 'sci', header: 'פיזיקה / מדמ״ח 5', width: 140,
          render: (s) => (h(s).sciTech ? <span className="text-xs font-semibold text-emerald-700">✓ {h(s).sciTech}</span> : <span className="text-xs text-slate-300">—</span>),
          sortValue: (s) => h(s).sciTech, exportValue: (s) => h(s).sciTech,
        } satisfies Column<BagrutStudent>]),
    {
      key: 'honor', header: HONOR_META[type].short, width: 110, align: 'center',
      render: (s) => {
        const r = h(s).results[type]
        return r.ok ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900 ring-1 ring-inset ring-amber-300">★ עומד</span>
        ) : (
          <span className={`text-xs ${r.missing === 1 ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>{r.missing === 1 ? 'חסר תנאי אחד' : `חסרים ${r.missing}`}</span>
        )
      },
      sortValue: (s) => -h(s).results[type].missing,
      exportValue: (s) => (h(s).results[type].ok ? 'כן' : 'לא'),
      filterValues: (s) => (h(s).results[type].ok ? 'עומד' : h(s).results[type].missing === 1 ? 'חסר תנאי אחד' : 'חסרים יותר'),
    },
    {
      key: 'missing', header: 'מה חסר', width: 300,
      render: (s) => <span className="truncate text-xs text-slate-600" title={missingText(h(s).results[type])}>{missingText(h(s).results[type])}</span>,
      sortValue: (s) => missingText(h(s).results[type]) || null,
    },
  ]

  const label = `${HONOR_META[type].label} — ${SHOW_LABELS[show]}`
  const pct = (n: number) => `${Math.round((n / graduating.length) * 100)}%`

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
      <div>
        <h1 className="text-xl font-extrabold text-slate-800">בגרות מצטיינת ובגרות טק</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          שכבה {round.graduating_grade} · {graduating.length} תלמידים · מחושב במערכת מעל ניתוח הזכאות
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {HONOR_KEYS.map((k) => (
          <div key={k} className={`flex min-w-[14rem] flex-1 rounded-2xl ${type === k ? 'ring-2 ring-amber-400' : ''}`}>
            <Kpi
              value={counts[k].yes}
              label={`★ ${HONOR_META[k].label}`}
              sub={`${pct(counts[k].yes)} מהשכבה · ${counts[k].near} חסר להם תנאי אחד`}
              tone="amber"
              onClick={() => set('type', k)}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
          {(Object.keys(SHOW_LABELS) as Show[]).map((k) => (
            <button
              key={k}
              onClick={() => set('show', k)}
              className={`rounded-md px-3 py-1 ${show === k ? 'bg-amber-100 font-bold text-amber-900' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              {SHOW_LABELS[k]}
              {k !== 'all' && <span className="mr-1 tabular-nums text-xs opacity-70">{k === 'yes' ? counts[type].yes : counts[type].near}</span>}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">{CRITERIA[type]}</span>
      </div>

      <BagrutTable
        key={type}
        rows={rows}
        columns={columns.filter((c) => showIds || c.key !== 'id')}
        rowKey={(s) => s.student_id}
        exportName={`בגרות_${round.school_name ?? round.school_code}_${label}`}
        initialSort={{ key: 'class', dir: 'asc' }}
        countLabel="תלמידים"
        rowTitle={displayName}
        storageKey={`honors-${type}`}
        onRowClick={(s, _i, sorted) => {
          const state: CardNavState = {
            ids: sorted.map((x) => x.student_id),
            fromLabel: label,
            backTo: location.pathname + location.search,
          }
          navigate(studentPath(base, round, s.student_id), { state })
        }}
      />

      <p className="text-[11px] leading-relaxed text-slate-400">
        המדדים אינם מגיעים בקבצים — המערכת מחשבת אותם: זכאות לפי ניתוח הזכאות, ומעליה המקצועות שהושלמו בציון 55 ומעלה.
        הממוצע משוקלל לפי יח״ל, בלי בונוס. במצטיינת נדרשת גם הצלחה במעורבות החברתית — היא אינה בנתונים ואינה נבדקת כאן.
      </p>
    </div>
  )
}

const CRITERIA: Record<HonorKey, string> = {
  excellence: `זכאי · אנגלית 5 · מתמטיקה 4 לפחות · ממוצע ${EXCELLENCE_AVERAGE} לפחות`,
  tech: 'זכאי · מתמטיקה 5 · פיזיקה או מדעי המחשב 5 · אנגלית 5',
  tech_no_english: 'זכאי · מתמטיקה 5 · פיזיקה או מדעי המחשב 5',
}

/** רמה שעבר מול הרמה הנדרשת — ירוק כשעומד בה */
function Level({ have, need }: { have: number | null; need: number | null }) {
  if (have == null) return <span className="text-xs text-slate-300">—</span>
  const ok = need == null || have >= need
  return <span className={`tabular-nums ${ok ? 'font-bold text-emerald-700' : 'text-slate-500'}`}>{have}</span>
}
