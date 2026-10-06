import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useBagrut, type CardNavState } from './context'
import BagrutTable, { type Column } from '@/components/bagrut/BagrutTable'
import { StatusBadge } from '@/components/bagrut/ui'
import { fmtDate, isFollowupDue, relDays } from '@/lib/bagrutCycle'
import {
  BLOCKER_LABELS,
  classSortKey,
  displayName,
  eligibilityKind,
  ELIGIBILITY_META,
  isEligible,
  isOnTheEdge,
  parseBlockers,
  saveTracking,
  t1Summary,
  TRACKING_FLAGS,
  type BagrutStudent,
  type BlockerKind,
  type EligibilityKind,
  type TrackingFlag,
} from '@/lib/bagrut'

/**
 * רשימת התלמידים — זכאות ומעקב. **טבלה**, כמו במצבת: כאן עובדים —
 * מסננים, ממיינים, מסמנים ומייצאים. מחליף באקסס את טופס 6 ("מסך כללי
 * פותח", דגלי המעקב) ואת טופס 12 (T2 בטבלה).
 *
 * הסינון יושב ב-URL: כל מספר בלוח הבקרה הוא קישור לכאן, וכפתור "חזרה"
 * מהכרטיס מחזיר בדיוק לאותה רשימה.
 */
export default function BagrutStudents() {
  const { data, index, round, base, canEditTracking, applyTracking } = useBagrut()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [saving, setSaving] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const f = {
    q: params.get('q') ?? '',
    view: params.get('view') ?? '',
    kind: params.get('kind') ?? '',
    grade: params.get('grade') ?? '',
    cls: params.get('class') ?? '',
    flag: params.get('flag') ?? '',
    blocker: params.get('blocker') ?? '',
    missing: params.get('missing') ?? '',
    weak: params.get('weak') ?? '',
    nogrades: params.get('nogrades') ?? '',
  }
  // שכבה שאינה מסיימת — אין לה T2, ועמודות הזכאות היו ריקות לגמרי
  const hideT2 = Boolean(f.grade && round.graduating_grade && f.grade !== round.graduating_grade)
  const summaries = useMemo(
    () => new Map(data.students.map((s) => [s.student_id, t1Summary(index, s.student_id)])),
    [data.students, index],
  )
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const grades = useMemo(() => [...new Set(data.students.map((s) => s.grade).filter(Boolean))].sort() as string[], [data])
  const classes = useMemo(
    () =>
      ([...new Set(data.students.filter((s) => !f.grade || s.grade === f.grade).map((s) => s.class_name).filter(Boolean))] as string[]).sort(
        (a, b) => classSortKey(a).localeCompare(classSortKey(b)),
      ),
    [data, f.grade],
  )

  const rows = useMemo(() => {
    const q = f.q.trim()
    return data.students.filter((s) => {
      const kind = eligibilityKind(s)
      if (f.view === 'graduating' && !s.in_t2) return false
      if (f.view === 'edge' && !isOnTheEdge(s)) return false
      if (f.view === 'followup' && !isFollowupDue(data.tracking.get(s.student_id)?.next_followup)) return false
      if (f.kind === 'eligible_any' && !isEligible(kind)) return false
      if (f.kind && f.kind !== 'eligible_any' && kind !== f.kind) return false
      if (f.grade && s.grade !== f.grade) return false
      if (f.cls && s.class_name !== f.cls) return false
      if (f.flag && !data.tracking.get(s.student_id)?.[f.flag as TrackingFlag]) return false
      if (f.blocker || f.missing) {
        const bs = parseBlockers(s.blockers)
        if (f.blocker && !bs.some((b) => b.kind === f.blocker)) return false
        if (f.missing && !bs.some((b) => b.subjects?.includes(f.missing))) return false
      }
      if (f.weak && !summaries.get(s.student_id)?.weakGrades) return false
      if (f.nogrades && summaries.get(s.student_id)?.subjects) return false
      if (q && !(displayName(s).includes(q) || s.student_id.includes(q))) return false
      return true
    })
  }, [data, summaries, f.q, f.view, f.kind, f.grade, f.cls, f.flag, f.blocker, f.missing, f.weak, f.nogrades])

  const toggle = async (s: BagrutStudent, flag: TrackingFlag) => {
    const cur = data.tracking.get(s.student_id)
    setSaving(s.student_id)
    setSaveError(null)
    try {
      applyTracking(await saveTracking(round, s.student_id, { [flag]: !cur?.[flag] }, cur))
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const t1 = (s: BagrutStudent) => summaries.get(s.student_id)!
  const t1Columns: Column<BagrutStudent>[] = [
    {
      key: 't1done', group: 't1', groupTitle: 'התקדמות במקצועות', header: '✔ הושלמו', exportHeader: 'מקצועות שהושלמו', width: 70, align: 'center',
      render: (s) => <span className="font-semibold tabular-nums text-emerald-700">{t1(s).done || ''}</span>,
      sortValue: (s) => t1(s).done,
    },
    {
      key: 't1prog', group: 't1', header: '◐ בתהליך', exportHeader: 'מקצועות בתהליך', width: 70, align: 'center',
      render: (s) => <span className="tabular-nums text-amber-700">{t1(s).progress || ''}</span>,
      sortValue: (s) => t1(s).progress,
    },
    {
      key: 't1ns', group: 't1', header: '○ טרם', exportHeader: 'מקצועות שטרם החלו', width: 60, align: 'center',
      render: (s) => <span className="tabular-nums text-slate-400">{t1(s).notStarted || ''}</span>,
      sortValue: (s) => t1(s).notStarted,
    },
    {
      key: 't1weak', group: 't1', header: 'מתחת ל-55', exportHeader: 'ציוני שאלון מתחת ל-55', width: 80, align: 'center',
      render: (s) => {
        const x = t1(s)
        return x.weakGrades ? (
          <span
            className="rounded-md bg-rose-100 px-1.5 font-bold tabular-nums text-rose-800"
            title={x.weakSubjects.map((k) => index.subjectByKey.get(k)?.subject_name).join(', ')}
          >
            {x.weakGrades}
          </span>
        ) : null
      },
      sortValue: (s) => t1(s).weakGrades,
    },
  ]

  const columns: Column<BagrutStudent>[] = [
    {
      key: 'name', header: 'שם', width: 170, sticky: true,
      render: (s) => <span className="truncate font-semibold text-slate-800">{displayName(s)}</span>,
      sortValue: displayName,
    },
    { key: 'class', header: 'כיתה', width: 70, align: 'center', render: (s) => s.class_name, sortValue: (s) => classSortKey(s.class_name), exportValue: (s) => s.class_name },
    { key: 'id', header: 'ת"ז', width: 100, render: (s) => <span className="tabular-nums text-slate-500">{s.student_id}</span>, sortValue: (s) => s.student_id },
    ...t1Columns,
    {
      key: 'status', group: 't2', groupTitle: 'ניתוח זכאות', header: 'סטטוס זכאות', width: 118,
      render: (s) => (s.in_t2 ? <StatusBadge kind={eligibilityKind(s)} /> : <span className="text-xs text-slate-300">—</span>),
      sortValue: (s) => ['not_eligible', 'one_negative', 'eligible', 'not_graduating'].indexOf(eligibilityKind(s)),
      exportValue: (s) => (s.in_t2 ? ELIGIBILITY_META[eligibilityKind(s)].label : ''),
    },
    {
      key: 'neg', group: 't2', header: 'שליליים', width: 64, align: 'center',
      render: (s) => (s.negatives_count ? <span className="font-bold text-rose-700">{s.negatives_count}</span> : s.in_t2 ? <span className="text-slate-300">0</span> : null),
      sortValue: (s) => s.negatives_count,
    },
    {
      key: 'units', group: 't2', header: 'יח"ל', width: 70, align: 'center',
      render: (s) => <span className="tabular-nums">{s.total_units ?? ''}</span>,
      sortValue: (s) => (s.total_units ? Number.parseFloat(s.total_units) : null),
    },
    {
      key: 'blockers', group: 't2', header: 'חסמים', width: 260,
      render: (s) => (
        <div className="flex gap-1 overflow-hidden" title={s.blockers ?? ''}>
          {parseBlockers(s.blockers).map((b, i) => (
            <span key={i} className="whitespace-nowrap rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-800 ring-1 ring-inset ring-rose-200">
              {b.kind === 'missing_required' ? `חובה: ${b.subjects?.join(', ')}` : b.kind === 'other' ? b.text : BLOCKER_LABELS[b.kind]}
            </span>
          ))}
        </div>
      ),
      sortValue: (s) => parseBlockers(s.blockers).length || null,
      exportValue: (s) => s.blockers,
      // סינון לפי סוג החסם, לא לפי הטקסט המלא — "כל מי שאין לו מוגבר"
      filterValues: (s) => [...new Set(parseBlockers(s.blockers).map((b) => BLOCKER_LABELS[b.kind]))],
    },
    {
      key: 'intervention', group: 't2', header: 'התערבות מומלצת', width: 280,
      render: (s) => <span className="line-clamp-2 text-xs leading-snug text-slate-600" title={s.intervention ?? ''}>{s.intervention}</span>,
      sortValue: (s) => s.intervention,
    },
    {
      key: 'reinforced', group: 't2', header: 'מקצוע מוגבר', width: 180,
      render: (s) => <span className="truncate text-xs text-slate-600" title={s.reinforced_subject ?? ''}>{s.reinforced_subject}</span>,
      sortValue: (s) => s.reinforced_subject,
    },
    ...TRACKING_FLAGS.map(
      (fl): Column<BagrutStudent> => ({
        key: fl.key, group: 'track', groupTitle: 'מעקב הצוות', header: fl.short, exportHeader: fl.label, width: 62, align: 'center',
        render: (s) => {
          const on = Boolean(data.tracking.get(s.student_id)?.[fl.key])
          return (
            <button
              disabled={!canEditTracking || saving === s.student_id}
              onClick={(e) => {
                e.stopPropagation()
                toggle(s, fl.key)
              }}
              title={fl.label}
              className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm transition ${
                on ? 'bg-amber-100 ring-1 ring-amber-300' : 'opacity-25 grayscale hover:opacity-70'
              } ${canEditTracking ? '' : 'cursor-default'}`}
            >
              {fl.icon}
            </button>
          )
        },
        sortValue: (s) => (data.tracking.get(s.student_id)?.[fl.key] ? 1 : 0),
        exportValue: (s) => (data.tracking.get(s.student_id)?.[fl.key] ? 'כן' : ''),
      }),
    ),
    {
      key: 'note', group: 'track', header: 'הערה', width: 200,
      render: (s) => <span className="truncate text-xs text-slate-600">{data.tracking.get(s.student_id)?.note_short}</span>,
      sortValue: (s) => data.tracking.get(s.student_id)?.note_short,
    },
    {
      key: 'plan', group: 'track', header: 'תוכנית', exportHeader: 'תוכנית התערבות', width: 80, align: 'center',
      render: (s) => {
        const c = data.actionCounts.get(s.student_id)
        if (!c || !(c.active + c.done)) return null
        return <span className="text-xs tabular-nums text-slate-600" title={`${c.active} בביצוע · ${c.done} הושלמו`}>{c.done}/{c.active + c.done}</span>
      },
      sortValue: (s) => data.actionCounts.get(s.student_id)?.active ?? null,
      exportValue: (s) => {
        const c = data.actionCounts.get(s.student_id)
        return c && c.active + c.done ? `${c.done}/${c.active + c.done} הושלמו` : ''
      },
      filterValues: (s) => {
        const c = data.actionCounts.get(s.student_id)
        return !c || !(c.active + c.done) ? 'אין תוכנית' : c.active ? 'בביצוע' : 'הושלמה'
      },
    },
    {
      key: 'followup', group: 'track', header: 'מעקב הבא', width: 96, align: 'center',
      render: (s) => {
        const d = data.tracking.get(s.student_id)?.next_followup
        if (!d) return null
        const r = relDays(d)
        return <span className={`text-xs tabular-nums ${r.tone === 'red' ? 'font-bold text-rose-700' : r.tone === 'amber' ? 'font-semibold text-amber-700' : 'text-slate-600'}`} title={r.text}>{fmtDate(d)}</span>
      },
      sortValue: (s) => data.tracking.get(s.student_id)?.next_followup ?? null,
      exportValue: (s) => fmtDate(data.tracking.get(s.student_id)?.next_followup),
    },
  ]

  const label = [
    f.view === 'edge' ? 'על הסף' : f.view === 'graduating' ? 'השכבה המסיימת' : f.view === 'followup' ? 'מעקב השבוע' : '',
    f.grade ? `שכבה ${f.grade}` : '',
    f.weak ? 'ציון מתחת ל-55' : '',
    f.nogrades ? 'בלי ציונים' : '',
    f.kind ? (f.kind === 'eligible_any' ? 'זכאים' : ELIGIBILITY_META[f.kind as EligibilityKind]?.short) : '',
    f.cls,
    f.blocker ? BLOCKER_LABELS[f.blocker as BlockerKind] : '',
    f.missing,
    f.flag ? TRACKING_FLAGS.find((x) => x.key === f.flag)?.label : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const select = 'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm'
  const active = Object.values(f).some(Boolean)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="ml-2 text-xl font-extrabold text-slate-800">{label || 'כל התלמידים'}</h1>
        <input
          value={f.q}
          onChange={(e) => set('q', e.target.value)}
          placeholder="חיפוש שם או ת״ז"
          className="w-44 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select value={f.grade} onChange={(e) => set('grade', e.target.value)} className={select}>
          <option value="">כל השכבות</option>
          {grades.map((g) => <option key={g} value={g}>שכבה {g}</option>)}
        </select>
        <select value={f.cls} onChange={(e) => set('class', e.target.value)} className={select}>
          <option value="">כל הכיתות</option>
          {classes.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={f.kind} onChange={(e) => set('kind', e.target.value)} className={select}>
          <option value="">כל הסטטוסים</option>
          <option value="eligible_any">זכאים (כולם)</option>
          {(['eligible', 'one_negative', 'not_eligible'] as EligibilityKind[]).map((k) => (
            <option key={k} value={k}>{ELIGIBILITY_META[k].label}</option>
          ))}
        </select>
        <select value={f.blocker} onChange={(e) => set('blocker', e.target.value)} className={select}>
          <option value="">כל החסמים</option>
          {(Object.keys(BLOCKER_LABELS) as BlockerKind[]).filter((k) => k !== 'other').map((k) => (
            <option key={k} value={k}>{BLOCKER_LABELS[k]}</option>
          ))}
        </select>
        <select value={f.flag} onChange={(e) => set('flag', e.target.value)} className={select}>
          <option value="">כל סימוני המעקב</option>
          {TRACKING_FLAGS.map((fl) => <option key={fl.key} value={fl.key}>{fl.icon} {fl.label}</option>)}
        </select>
        {active && (
          <button onClick={() => setParams({}, { replace: true })} className="rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
            ↺ ניקוי
          </button>
        )}
      </div>

      {saveError && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{saveError}</div>}

      <BagrutTable
        rows={rows}
        columns={hideT2 ? columns.filter((c) => c.group !== 't2') : columns}
        rowKey={(s) => s.student_id}
        exportName={`בגרות_${round.school_name ?? round.school_code}_${label || 'תלמידים'}`}
        initialSort={{ key: 'class', dir: 'asc' }}
        countLabel="תלמידים"
        rowTitle={displayName}
        onRowClick={(s, _i, sorted) => {
          const state: CardNavState = {
            ids: sorted.map((x) => x.student_id),
            fromLabel: label || 'כל התלמידים',
            backTo: location.pathname + location.search,
          }
          navigate(`${base}/student/${s.student_id}`, { state })
        }}
      />
    </div>
  )
}
