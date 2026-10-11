import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { productAccess, useAuth } from '@/context/AuthContext'
import Logo from '@/components/brand/Logo'
import { supabase } from '@/lib/supabase'
import { fetchAuthorities, ROLE_LABELS, BAGRUT_ROLE_LABELS, type Authority } from '@/lib/admin'
import { loadAdminOverview, loadBagrutOverviews, loadManagerOverview, type AdminOverview, type BagrutOverview, type ManagerOverview, type Todo } from '@/lib/home'
import { AuthoritiesSection, BagrutSection, ManagerSection, TodoSection } from '@/components/home/RoleBlocks'

/**
 * האזור האישי — הדף שכל משתמש פוגש אחרי הכניסה (אייל, 11.10).
 *
 * "שלום, <שם>", מספרים מרכזיים, ומתחת כרטיס לכל מוצר שיש לו גישה אליו, עם
 * קצת מידע חי מהמוצר ומתי הנתונים עודכנו — וממנו נכנסים. מוצר שאין גישה
 * אליו מוצג מעומעם עם הסבר איך מבקשים. אין כאן שום הרשאה: כל הנתונים
 * נקראים ב-RLS של המשתמש, כך שהספירות הן בדיוק מה שהוא רשאי לראות.
 *
 * מנהל־על רואה את כל הרשויות שיש בהן נתונים — אחרת סבב בגרות ברשות שהוא
 * לא משויך אליה לא מופיע כאן, ואין לו דרך להגיע אליו מהדף.
 */

interface MatzevetStat { code: string; students: number; updated: string | null }
interface BagrutStat {
  code: string
  rounds: { school: string; label: string; created: string }[]
  followups: number
}

function greeting(now = new Date()) {
  const h = now.getHours()
  return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב'
}

/** "היום" / "אתמול" / "לפני 5 ימים" / תאריך — כמה טריים הנתונים */
function ago(iso: string | null): string {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'עודכן היום'
  if (days === 1) return 'עודכן אתמול'
  if (days < 30) return `עודכן לפני ${days} ימים`
  return `עודכן ב-${new Date(iso).toLocaleDateString('he-IL')}`
}

function hebrewDate(d = new Date()): string {
  try {
    return d.toLocaleDateString('he-IL-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return ''
  }
}

const fmt = (n: number) => n.toLocaleString('he-IL')

export default function Home() {
  const { profile, signOut } = useAuth()
  const access = productAccess(profile)
  const [authorities, setAuthorities] = useState<Authority[] | null>(null)
  const [matzevet, setMatzevet] = useState<MatzevetStat[] | null>(null)
  const [bagrut, setBagrut] = useState<BagrutStat[] | null>(null)

  useEffect(() => {
    fetchAuthorities().then(setAuthorities).catch(() => setAuthorities([]))
  }, [])
  const nameOf = (code: string) => authorities?.find((a) => a.code === code)?.name ?? `רשות ${code}`

  // הרשויות שהדף מציג: מנהל־על — כל הפעילות; כל השאר — אלה שמשויכות אליו
  const codes = useMemo(() => {
    if (!access.superAdmin) return profile?.authority_codes ?? []
    return authorities ? authorities.filter((a) => a.is_active).map((a) => a.code) : null
  }, [access.superAdmin, authorities, profile])

  useEffect(() => {
    if (codes == null) return
    if (!access.matzevet || !codes.length) return setMatzevet([])
    Promise.all([
      Promise.all(codes.map(async (code) => {
        const { count, error } = await supabase.from(`students_${code}`).select('*', { count: 'exact', head: true })
        return { code, students: error ? null : count ?? 0 }
      })),
      supabase.from('moe_uploads').select('authority_code, processed_at')
        .eq('status', 'done').in('authority_code', codes).order('processed_at', { ascending: false }),
    ]).then(([counts, { data: uploads }]) => {
      const updated = new Map<string, string>()
      for (const u of uploads ?? []) if (!updated.has(u.authority_code)) updated.set(u.authority_code, u.processed_at)
      setMatzevet(counts
        // למנהל־על רשות בלי תלמידים היא רעש; משתמש רגיל רואה את שלו גם כשהיא ריקה
        .filter((r): r is { code: string; students: number } => r.students != null && (r.students > 0 || !access.superAdmin))
        .map((r) => ({ ...r, updated: updated.get(r.code) ?? null })))
    })
  }, [access.matzevet, access.superAdmin, codes])

  useEffect(() => {
    if (codes == null) return
    if (!access.bagrut || !codes.length) return setBagrut([])
    const inWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    Promise.all([
      supabase.from('bagrut_rounds').select('authority_code, school_code, school_name, season, school_year, created_at')
        .in('authority_code', codes).order('created_at', { ascending: false }),
      supabase.from('bagrut_tracking').select('authority_code')
        .in('authority_code', codes).lte('next_followup', inWeek),
    ]).then(([{ data: rounds }, { data: due }]) => {
      const by = new Map<string, BagrutStat>()
      const seen = new Set<string>()
      for (const r of rounds ?? []) {
        // הסבב האחרון של כל בית ספר
        if (seen.has(r.school_code)) continue
        seen.add(r.school_code)
        const stat: BagrutStat = by.get(r.authority_code) ?? { code: r.authority_code, rounds: [], followups: 0 }
        stat.rounds.push({ school: r.school_name ?? r.school_code, label: `${r.season} ${r.school_year}`, created: r.created_at })
        by.set(r.authority_code, stat)
      }
      for (const d of due ?? []) {
        const stat = by.get(d.authority_code)
        if (stat) stat.followups++
      }
      setBagrut([...by.values()])
    })
  }, [access.bagrut, codes])

  // ── תוכן לפי תפקיד: מנהל־על · מנהל רשות · רכז בגרויות / רכז שכבה / מחנך
  const isManager = !access.superAdmin && profile?.role === 'admin' && access.matzevet
  const bagrutWorker = !access.superAdmin && ['coordinator', 'grade_coordinator', 'homeroom'].includes(profile?.bagrut_role ?? '')
  const [admin, setAdmin] = useState<AdminOverview | null>(null)
  const [managers, setManagers] = useState<ManagerOverview[] | null>(null)
  const [bagrutOv, setBagrutOv] = useState<BagrutOverview[] | null>(null)

  useEffect(() => {
    if (!access.superAdmin || !authorities || !matzevet) return
    loadAdminOverview(authorities, new Map(matzevet.map((m) => [m.code, m.students])))
      .then(setAdmin)
      .catch(() => setAdmin({ todos: [], users: 0 }))
  }, [access.superAdmin, authorities, matzevet])

  useEffect(() => {
    if (!isManager || codes == null) return
    Promise.all(codes.map((c) => loadManagerOverview(c, nameOf(c)))).then(setManagers).catch(() => setManagers([]))
    // nameOf תלוי ב-authorities; השם מתעדכן ברינדור, לא צריך לטעון מחדש
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManager, codes])

  useEffect(() => {
    if (!bagrutWorker || codes == null) return
    loadBagrutOverviews(codes, profile?.bagrut_role ?? '').then(setBagrutOv).catch(() => setBagrutOv([]))
  }, [bagrutWorker, codes, profile?.bagrut_role])

  const roleBased = access.superAdmin || isManager || bagrutWorker
  const todos: Todo[] = [
    ...(admin?.todos ?? []),
    ...(managers ?? []).flatMap((m) => m.todos),
    ...(bagrutOv ?? []).flatMap((o) => o.todos),
  ]
  const todosLoading = (access.superAdmin && !admin) || (isManager && !managers) || (bagrutWorker && !bagrutOv)

  const name = profile?.display_name || profile?.email?.split('@')[0] || ''
  const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const hebrew = hebrewDate()
  const roles = [
    access.superAdmin ? 'מנהל־על' : access.matzevet && profile ? `מצבת: ${ROLE_LABELS[profile.role]}` : null,
    !access.superAdmin && profile?.bagrut_role ? `זכאות לבגרות: ${BAGRUT_ROLE_LABELS[profile.bagrut_role]}` : null,
  ].filter(Boolean)
  const none = !access.matzevet && !access.bagrut

  // מספרים מרכזיים לפס העליון — בגודל העולם של המשתמש, לפי התפקיד
  let stats: { label: string; value: number | string | null; sub?: string }[] = []
  const totalStudents = matzevet ? matzevet.reduce((s, m) => s + m.students, 0) : null
  const schools = bagrut ? bagrut.reduce((s, b) => s + b.rounds.length, 0) : null
  if (access.superAdmin) {
    stats = [
      { label: 'רשויות פעילות', value: codes ? codes.length : null },
      { label: 'משתמשים', value: admin ? admin.users : null, sub: 'בלי מנהלי־על' },
      { label: 'תלמידים במצבת', value: totalStudents },
      { label: 'בתי ספר בבגרות', value: schools },
    ]
  } else if (bagrutWorker && bagrutOv?.length) {
    stats = bagrutOv[0].stats
  } else if (isManager && managers?.length) {
    const m = managers[0]
    stats = [
      { label: 'תלמידים משובצים', value: m.placed },
      ...(m.ganim ? [{ label: 'ילדי גן', value: m.ganim }] : []),
      { label: 'עדכון אחרון', value: m.lastUpdate ? new Date(m.lastUpdate).toLocaleDateString('he-IL') : '—' },
    ]
  } else {
    if (access.matzevet) stats.push({ label: 'תלמידים במצבת', value: totalStudents })
    if (access.bagrut) {
      stats.push({ label: 'בתי ספר בבגרות', value: schools })
      stats.push({ label: 'למעקב השבוע', value: bagrut ? bagrut.reduce((s, b) => s + b.followups, 0) : null })
    }
  }

  return (
    <div className="relative min-h-full overflow-hidden bg-slate-50">
      <Backdrop />

      <div className="relative">
        <header className="flex items-center gap-3 px-6 py-4">
          <Logo className="h-8 w-8" />
          <span className="font-bold text-slate-700">פורטל נתוני חינוך</span>
          <span className="mr-auto" />
          {access.superAdmin && (
            <Link to="/admin" className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-white hover:text-sky-700">ניהול</Link>
          )}
          <button onClick={signOut} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-red-50 hover:text-red-600">יציאה</button>
        </header>

        <main className="mx-auto max-w-5xl px-6 pb-16">
          {/* ── ברכה ── */}
          <section className="relative mt-6 overflow-hidden rounded-3xl bg-gradient-to-l from-sky-600 via-blue-600 to-indigo-700 p-8 text-white shadow-xl shadow-sky-200/70 motion-safe:animate-fade-up">
            <BannerArt />

            <div className="relative">
              <p className="text-sm text-sky-100">
                {today}
                {hebrew && <span className="text-sky-200/80"> · {hebrew}</span>}
              </p>
              <h1 className="mt-1 text-3xl font-extrabold">{greeting()}, {name}</h1>
              {(profile?.job_title || profile?.institution_name) && (
                <p className="mt-1 text-sky-100">{[profile.job_title, profile.institution_name].filter(Boolean).join(' · ')}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {access.superAdmin ? (
                  <span className="rounded-full bg-white/15 px-3 py-1 text-sm">כל הרשויות</span>
                ) : (
                  (codes ?? []).map((c) => <span key={c} className="rounded-full bg-white/15 px-3 py-1 text-sm">{nameOf(c)}</span>)
                )}
                {roles.map((r) => <span key={r} className="rounded-full bg-white/25 px-3 py-1 text-sm font-semibold">{r}</span>)}
              </div>

              {stats.length > 0 && (
                <dl className="mt-6 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
                  {stats.map((s) => (
                    <div key={s.label} className="rounded-2xl bg-white/10 px-4 py-2.5 ring-1 ring-white/15 backdrop-blur-sm sm:min-w-[8.5rem]">
                      <dd className="text-2xl font-extrabold tabular-nums">{s.value == null ? '…' : typeof s.value === 'number' ? fmt(s.value) : s.value}</dd>
                      <dt className="text-xs text-sky-100">{s.label}</dt>
                      {s.sub && <dt className="text-[11px] text-sky-200/80">{s.sub}</dt>}
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </section>

          {none ? (
            <section className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <div className="text-4xl">🔒</div>
              <h2 className="mt-3 text-xl font-bold text-slate-800">עדיין לא הוגדרה לך גישה</h2>
              <p className="mx-auto mt-2 max-w-md text-slate-600">
                החשבון שלך פעיל, אבל עוד לא ניתנה לך גישה לאף מוצר. מנהל המערכת ברשות שלך יכול להעניק אותה.
              </p>
              <Link to="/contact" className="mt-5 inline-block rounded-xl bg-sky-600 px-5 py-2.5 font-bold text-white hover:bg-sky-700">לפרטי קשר</Link>
            </section>
          ) : (
            <>
              {roleBased && <TodoSection todos={todos} loading={todosLoading} />}
              {(managers ?? []).map((m) => (
                <ManagerSection key={m.code} m={m} name={nameOf(m.code)} ago={ago(m.lastUpdate)} />
              ))}
              {(bagrutOv ?? []).map((o) => <BagrutSection key={o.round.id} o={o} />)}
              {access.superAdmin && matzevet && bagrut && (
                <AuthoritiesSection
                  // גם רשות שיש בה רק בגרות (בית ספר בלי מצבת, כמו אבו רביע)
                  rows={[...new Set([...matzevet.map((m) => m.code), ...bagrut.map((b) => b.code)])].map((code) => {
                    const m = matzevet.find((x) => x.code === code)
                    return {
                      code, name: nameOf(code), students: m?.students ?? null, updated: m ? ago(m.updated) : '',
                      schools: bagrut.find((b) => b.code === code)?.rounds.length ?? 0,
                    }
                  })}
                />
              )}

              <h2 className="mb-3 mt-10 text-sm font-bold text-slate-500">המוצרים שלך</h2>
              <div className="grid gap-5 md:grid-cols-2">
                {access.matzevet ? (
                  <ProductCard icon="📋" title="מצבת תלמידים" tone="sky" delay={1}
                    description="נתוני התלמידים מהמצבת החודשית של משרד החינוך — סינון, כרטיס תלמיד וייצוא לאקסל."
                    loading={matzevet == null}
                    rows={(matzevet ?? []).map((m) => ({
                      key: m.code, to: `/students/${m.code}`, title: nameOf(m.code),
                      detail: [`${fmt(m.students)} תלמידים`, ago(m.updated)].filter(Boolean).join(' · '),
                    }))}
                    empty="אין עדיין נתוני מצבת ברשויות שלך." />
                ) : (
                  <LockedCard icon="📋" title="מצבת תלמידים" />
                )}

                {access.bagrut ? (
                  <ProductCard icon="🎓" title="זכאות לבגרות" tone="violet" delay={2}
                    description="תמונת הזכאות של השכבה המסיימת, כרטיס תלמיד, מעקב ותוכנית התערבות."
                    loading={bagrut == null}
                    rows={(bagrut ?? []).map((b) => ({
                      key: b.code, to: `/bagrut/${b.code}`, title: nameOf(b.code),
                      detail: b.rounds.map((r) => [b.rounds.length > 1 ? r.school : null, r.label, ago(r.created)].filter(Boolean).join(' · ')).join(' | '),
                      badge: b.followups ? `📅 ${b.followups} למעקב השבוע` : undefined,
                    }))}
                    empty="אין עדיין סבב בגרות ברשויות שלך." />
                ) : (
                  <LockedCard icon="🎓" title="זכאות לבגרות" />
                )}

                {access.superAdmin && (
                  <ProductCard icon="⚙️" title="ניהול לקוחות" tone="slate" delay={3}
                    description="רשויות, משתמשים והרשאות, העלאת נתונים והיסטוריית עדכונים."
                    rows={[{
                      key: 'admin', to: '/admin', title: 'לכל הלקוחות',
                      detail: codes ? `${codes.length} רשויות פעילות` : '',
                    }]} />
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

/**
 * רקע הדף — כתמי צבע מטושטשים בצבעי המוצרים והלוגו, ומעליהם רשת נקודות
 * שנמוגה כלפי מטה. דקורטיבי בלבד.
 */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute -right-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-sky-300/40 blur-3xl" />
      <div className="absolute -left-40 top-40 h-[30rem] w-[30rem] rounded-full bg-violet-300/30 blur-3xl" />
      <div className="absolute -bottom-40 right-1/3 h-96 w-96 rounded-full bg-emerald-200/30 blur-3xl" />
      <div
        className="absolute inset-0 opacity-60"
        style={{
          backgroundImage: 'radial-gradient(rgb(148 163 184 / 0.35) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'linear-gradient(to bottom, black, transparent 70%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black, transparent 70%)',
        }}
      />
    </div>
  )
}

/** הצד השמאלי של פס הברכה — עיגולים שקופים והלוגו בלבן, בסימן מים */
function BannerArt() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/2">
      <div className="absolute -left-16 -top-24 h-80 w-80 rounded-full border border-white/15" />
      <div className="absolute -left-4 -top-10 h-56 w-56 rounded-full border border-white/10" />
      <div className="absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-white/5" />
      <div className="absolute left-10 top-1/2 hidden -translate-y-1/2 sm:block">
        <Logo className="h-36 w-36 opacity-15 brightness-0 invert" />
      </div>
    </div>
  )
}

const TONES = {
  sky: { ring: 'hover:border-sky-300 hover:shadow-sky-100', stripe: 'from-sky-400 to-sky-600', icon: 'bg-sky-100', link: 'text-sky-700' },
  violet: { ring: 'hover:border-violet-300 hover:shadow-violet-100', stripe: 'from-violet-400 to-indigo-600', icon: 'bg-violet-100', link: 'text-violet-700' },
  slate: { ring: 'hover:border-slate-300 hover:shadow-slate-200', stripe: 'from-slate-300 to-slate-500', icon: 'bg-slate-100', link: 'text-slate-700' },
}

function ProductCard({ icon, title, description, tone, rows, loading = false, empty, delay = 0 }: {
  icon: string
  title: string
  description: string
  tone: keyof typeof TONES
  rows: { key: string; to: string; title: string; detail: string; badge?: string }[]
  loading?: boolean
  empty?: string
  /** סדר ההופעה — כל כרטיס נכנס מעט אחרי הקודם */
  delay?: number
}) {
  const t = TONES[tone]
  return (
    <section
      style={{ animationDelay: `${delay * 90}ms` }}
      className={`flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white/90 shadow-sm backdrop-blur transition duration-200 hover:-translate-y-0.5 hover:shadow-lg motion-safe:animate-fade-up ${t.ring}`}
    >
      <div className={`h-1.5 bg-gradient-to-l ${t.stripe}`} />
      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-center gap-3">
          <span className={`flex h-11 w-11 items-center justify-center rounded-2xl text-2xl ${t.icon}`}>{icon}</span>
          <h3 className="text-lg font-extrabold text-slate-800">{title}</h3>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{description}</p>
        <div className="mt-4 flex flex-col gap-2">
          {loading ? (
            <p className="text-sm text-slate-400">טוען…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400">{empty}</p>
          ) : (
            rows.map((r) => (
              <Link key={r.key} to={r.to} className="group flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3 transition hover:bg-slate-100">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-800">{r.title}</div>
                  {r.detail && <div className="truncate text-xs text-slate-500">{r.detail}</div>}
                </div>
                {r.badge && <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">{r.badge}</span>}
                <span className={`shrink-0 text-sm font-bold ${t.link} transition group-hover:-translate-x-1`}>כניסה ←</span>
              </Link>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

/** מוצר שאין גישה אליו — כדי שידעו שהוא קיים ואיך מבקשים */
function LockedCard({ icon, title }: { icon: string; title: string }): ReactNode {
  return (
    <section className="flex flex-col rounded-3xl border border-dashed border-slate-300 bg-white/50 p-6 backdrop-blur motion-safe:animate-fade-up">
      <div className="flex items-center gap-3 opacity-50">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-200 text-2xl grayscale">{icon}</span>
        <h3 className="text-lg font-extrabold text-slate-700">{title}</h3>
      </div>
      <p className="mt-2 text-sm text-slate-500">🔒 אין לך גישה למוצר הזה. לבקשת גישה — מנהל המערכת ברשות שלך.</p>
    </section>
  )
}
