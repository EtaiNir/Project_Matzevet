import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { rememberRound, type BagrutOverview, type ManagerOverview, type Todo } from '@/lib/home'

/**
 * הבלוקים של האזור האישי לפי תפקיד. כל בלוק מציג רק את מה שהתפקיד צריך;
 * המשתמש מקבל את הבלוקים של כל התפקידים שלו (lib/home.ts).
 */

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mt-8 motion-safe:animate-fade-up">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-sm font-bold text-slate-600">{title}</h2>
        {sub && <span className="text-xs text-slate-400">{sub}</span>}
      </div>
      {children}
    </section>
  )
}

const card = 'rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur'

// ─────────────────────────────── לטיפול ───────────────────────────────

/** משימות פתוחות — האדומות קודם. ריק = "אין משימות פתוחות", לא שורת אפסים. */
export function TodoSection({ todos, loading }: { todos: Todo[]; loading: boolean }) {
  const sorted = [...todos].sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'red' ? -1 : 1))
  return (
    <Section title="לטיפול" sub={todos.length ? `${todos.length} פריטים פתוחים` : undefined}>
      <div className={card}>
        {loading && !todos.length ? (
          <p className="text-sm text-slate-400">בודק…</p>
        ) : !todos.length ? (
          <p className="text-sm text-emerald-700">אין משימות פתוחות.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((t) => (
              <li key={t.key}>
                <Link
                  to={t.to}
                  onClick={() => rememberRound(t.roundId)}
                  className="flex items-start gap-3 rounded-2xl bg-slate-50 px-4 py-3 transition hover:bg-slate-100"
                >
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${t.tone === 'red' ? 'bg-rose-500' : 'bg-amber-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-800">
                      {t.source && <span className="text-slate-500">{t.source} · </span>}
                      {t.text}
                    </div>
                    {t.detail && <div className="truncate text-xs text-slate-500" title={t.detail}>{t.detail}</div>}
                  </div>
                  <span className="shrink-0 self-center text-sm font-bold text-sky-700">לטיפול</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-400">
          <span className="ml-1 inline-block h-2 w-2 rounded-full bg-rose-500" /> נכשל או באיחור
          <span className="mr-3 ml-1 inline-block h-2 w-2 rounded-full bg-amber-400" /> ממתין להחלטה או מתקרב
        </p>
      </div>
    </Section>
  )
}

// ─────────────────────────────── מנהל־על: כל הרשויות ───────────────────────────────

export interface AuthorityRow {
  code: string
  name: string
  students: number | null
  updated: string
  schools: number
}

export function AuthoritiesSection({ rows }: { rows: AuthorityRow[] }) {
  if (!rows.length) return null
  return (
    <Section title="הרשויות" sub="לחיצה על שם רשות פותחת את כרטיס הלקוח">
      <div className={`${card} overflow-x-auto p-0`}>
        <table className="w-full text-right text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-semibold">רשות</th>
              <th className="px-4 py-2 font-semibold">תלמידים במצבת</th>
              <th className="px-4 py-2 font-semibold">עדכון אחרון</th>
              <th className="px-4 py-2 font-semibold">בתי ספר בבגרות</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-t border-slate-100">
                <td className="px-4 py-2">
                  <Link to={`/admin/client/${r.code}`} className="font-semibold text-slate-800 hover:text-sky-700 hover:underline">{r.name}</Link>
                </td>
                <td className="px-4 py-2 tabular-nums text-slate-600">{r.students == null ? '—' : r.students.toLocaleString('he-IL')}</td>
                <td className="px-4 py-2 text-slate-600">{r.updated || '—'}</td>
                <td className="px-4 py-2 tabular-nums text-slate-600">{r.schools || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

// ─────────────────────────────── מנהל רשות ───────────────────────────────

export function ManagerSection({ m, name, ago }: { m: ManagerOverview; name: string; ago: string }) {
  const facts = [
    m.placed != null && `${m.placed.toLocaleString('he-IL')} תלמידים משובצים`,
    m.ganim ? `${m.ganim.toLocaleString('he-IL')} ילדי גן` : null,
    ago || 'לא עודכן',
  ].filter(Boolean)
  return (
    <Section title={`הרשות שלי — ${name}`} sub={facts.join(' · ')}>
      <div className={`${card} flex flex-col gap-4`}>
        <div className="flex flex-wrap gap-2">
          <Link to={`/students/${m.code}`} className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700">לטבלת התלמידים</Link>
          <Link to={`/upload/${m.code}`} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">העלאת מצב"ת</Link>
          <Link to={`/pivot/${m.code}`} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">פיבוטים</Link>
          <Link to={`/charts/${m.code}`} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">גרפים</Link>
        </div>
        <div>
          <div className="mb-2 text-xs font-bold text-slate-400">הטבלאות הייעודיות שלי</div>
          {m.views.length === 0 ? (
            <p className="text-sm text-slate-400">עוד אין טבלאות ייעודיות. יוצרים אותן ממסך התלמידים.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {m.views.map((v) => (
                <Link key={v.id} to={`/views/${m.code}/${v.id}`} className="rounded-full bg-slate-50 px-3 py-1.5 text-sm text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-sky-50 hover:text-sky-800">
                  {v.name}
                  <span className="mr-1.5 text-xs tabular-nums text-slate-400">{v.members}</span>
                  {v.shared && <span className="mr-1.5 text-xs text-violet-600">שותפה איתי</span>}
                </Link>
              ))}
              <Link to={`/views/${m.code}`} className="rounded-full px-3 py-1.5 text-sm text-sky-700 hover:underline">כל הטבלאות</Link>
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}

// ─────────────────────────────── בגרות: רכזים ומחנכים ───────────────────────────────

export function BagrutSection({ o }: { o: BagrutOverview }) {
  const school = o.round.school_name ?? o.round.school_code
  const base = `/bagrut/${o.round.authority_code}/${o.round.school_code}`
  const go = () => rememberRound(o.round.id)
  const many = o.classes.length > 1
  return (
    <Section title={`${school} · ${o.scopeLabel}`} sub={`זכאות לבגרות · ${o.round.season} ${o.round.school_year}`}>
      <div className={`${card} flex flex-col gap-4`}>
        <dl className="flex flex-wrap gap-3">
          {o.stats.map((s) => (
            <div key={s.label} className="min-w-[8rem] rounded-2xl bg-slate-50 px-4 py-2.5">
              <dd className="text-2xl font-extrabold tabular-nums text-slate-800">{s.value}</dd>
              <dt className="text-xs font-semibold text-slate-600">{s.label}</dt>
              <dt className="text-[11px] text-slate-400">{s.sub}</dt>
            </div>
          ))}
        </dl>

        {many && (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1.5 font-semibold">כיתה</th>
                  <th className="py-1.5 font-semibold">תלמידים</th>
                  <th className="py-1.5 font-semibold">{o.mode === 'graduating' ? 'אחוז זכאות' : 'עם ציון חלש'}</th>
                  {o.mode === 'graduating' && <th className="py-1.5 font-semibold">על הסף</th>}
                  <th className="py-1.5 font-semibold">למעקב השבוע</th>
                </tr>
              </thead>
              <tbody>
                {o.classes.map((c) => {
                  const q = new URLSearchParams(o.mode === 'graduating' ? { view: 'graduating', class: c.cls } : { class: c.cls })
                  return (
                    <tr key={c.cls} className="border-t border-slate-100">
                      <td className="py-1.5">
                        <Link to={`${base}/students?${q}`} onClick={go} className="font-semibold text-slate-800 hover:text-sky-700 hover:underline">{c.cls}</Link>
                      </td>
                      <td className="py-1.5 tabular-nums text-slate-600">{c.n}</td>
                      <td className="py-1.5 tabular-nums text-slate-600">{c.pct}%</td>
                      {o.mode === 'graduating' && <td className="py-1.5 tabular-nums text-slate-600">{c.edge || '—'}</td>}
                      <td className={`py-1.5 tabular-nums ${c.followups ? 'font-bold text-amber-700' : 'text-slate-400'}`}>{c.followups || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-slate-400">
              {o.mode === 'graduating'
                ? 'אחוז זכאות ועל הסף — מחושבים מהציונים ומחוקת הזכאות. לחיצה על כיתה פותחת את רשימת התלמידים שלה.'
                : 'ציון חלש = מתחת ל-55 בשאלון אחד לפחות. לחיצה על כיתה פותחת את רשימת התלמידים שלה.'}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Link to={o.listTo} onClick={go} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700">
            {o.classes.length === 1 ? 'לרשימת הכיתה' : 'לרשימת התלמידים'}
          </Link>
          <Link to={base} onClick={go} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">לתמונת המצב</Link>
        </div>
      </div>
    </Section>
  )
}
