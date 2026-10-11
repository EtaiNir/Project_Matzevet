import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { productAccess, useAuth } from '@/context/AuthContext'
import Logo from '@/components/brand/Logo'
import { supabase } from '@/lib/supabase'
import { fetchAuthorities, ROLE_LABELS, BAGRUT_ROLE_LABELS, type Authority } from '@/lib/admin'

/**
 * האזור האישי — הדף שכל משתמש פוגש אחרי הכניסה (אייל, 11.10).
 *
 * "שלום, <שם>", ומתחת כרטיס לכל מוצר שיש לו גישה אליו, עם קצת מידע חי
 * מהמוצר — וממנו נכנסים. מוצר שאין גישה אליו מוצג מעומעם עם הסבר איך
 * מבקשים. אין כאן שום הרשאה: כל הנתונים נקראים ב-RLS של המשתמש, כך שהספירות
 * הן בדיוק מה שהוא רשאי לראות.
 */

interface MatzevetStat { code: string; name: string; students: number | null }
interface BagrutStat { code: string; name: string; rounds: { school: string; label: string }[]; followups: number | null }

function greeting(now = new Date()) {
  const h = now.getHours()
  return h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב'
}

export default function Home() {
  const { profile, signOut } = useAuth()
  const access = productAccess(profile)
  const [authorities, setAuthorities] = useState<Authority[]>([])
  const [matzevet, setMatzevet] = useState<MatzevetStat[] | null>(null)
  const [bagrut, setBagrut] = useState<BagrutStat[] | null>(null)

  // הרשויות של המשתמש (מנהל־על — כולן; כאן רק אלה שמשויכות אליו, כדי שהדף יישאר אישי)
  const codes = useMemo(() => profile?.authority_codes ?? [], [profile])

  useEffect(() => {
    fetchAuthorities().then(setAuthorities).catch(() => setAuthorities([]))
  }, [])
  const nameOf = (code: string) => authorities.find((a) => a.code === code)?.name ?? `רשות ${code}`

  useEffect(() => {
    if (!access.matzevet || !codes.length) return setMatzevet([])
    Promise.all(codes.map(async (code) => {
      const { count, error } = await supabase.from(`students_${code}`).select('*', { count: 'exact', head: true })
      return { code, name: code, students: error ? null : count ?? 0 }
    })).then((rows) => setMatzevet(rows.filter((r) => r.students != null)))
  }, [access.matzevet, codes])

  useEffect(() => {
    if (!access.bagrut || !codes.length) return setBagrut([])
    const inWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    Promise.all(codes.map(async (code) => {
      const [{ data: rounds }, { count }] = await Promise.all([
        supabase.from('bagrut_rounds').select('school_code, school_name, season, school_year, created_at')
          .eq('authority_code', code).order('created_at', { ascending: false }),
        supabase.from('bagrut_tracking').select('*', { count: 'exact', head: true })
          .eq('authority_code', code).lte('next_followup', inWeek),
      ])
      const latest = new Map<string, { school: string; label: string }>()
      for (const r of rounds ?? []) {
        if (!latest.has(r.school_code)) latest.set(r.school_code, { school: r.school_name ?? r.school_code, label: `${r.season} ${r.school_year}` })
      }
      return { code, name: code, rounds: [...latest.values()], followups: count ?? null }
    })).then((rows) => setBagrut(rows.filter((r) => r.rounds.length)))
  }, [access.bagrut, codes])

  const name = profile?.display_name || profile?.email?.split('@')[0] || ''
  const today = new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const roles = [
    access.superAdmin ? 'מנהל־על' : access.matzevet && profile ? `מצבת: ${ROLE_LABELS[profile.role]}` : null,
    !access.superAdmin && profile?.bagrut_role ? `זכאות לבגרות: ${BAGRUT_ROLE_LABELS[profile.bagrut_role]}` : null,
  ].filter(Boolean)
  const none = !access.matzevet && !access.bagrut

  return (
    <div className="min-h-full bg-gradient-to-b from-sky-50 via-white to-white">
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
        <section className="mt-6 overflow-hidden rounded-3xl bg-gradient-to-l from-sky-600 to-indigo-600 p-8 text-white shadow-lg shadow-sky-200">
          <p className="text-sm text-sky-100">{today}</p>
          <h1 className="mt-1 text-3xl font-extrabold">{greeting()}, {name}</h1>
          {(profile?.job_title || profile?.institution_name) && (
            <p className="mt-1 text-sky-100">{[profile.job_title, profile.institution_name].filter(Boolean).join(' · ')}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {codes.map((c) => <span key={c} className="rounded-full bg-white/15 px-3 py-1 text-sm">{nameOf(c)}</span>)}
            {roles.map((r) => <span key={r} className="rounded-full bg-white/25 px-3 py-1 text-sm font-semibold">{r}</span>)}
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
            <h2 className="mb-3 mt-10 text-sm font-bold text-slate-500">המוצרים שלך</h2>
            <div className="grid gap-5 md:grid-cols-2">
              {access.matzevet ? (
                <ProductCard icon="📋" title="מצבת תלמידים" tone="sky"
                  description="נתוני התלמידים מהמצבת החודשית של משרד החינוך — סינון, כרטיס תלמיד וייצוא לאקסל."
                  loading={matzevet == null}
                  rows={(matzevet ?? []).map((m) => ({
                    key: m.code, to: `/students/${m.code}`, title: nameOf(m.code),
                    detail: m.students != null ? `${m.students.toLocaleString('he-IL')} תלמידים` : '',
                  }))}
                  empty="אין עדיין נתוני מצבת ברשויות שלך." />
              ) : (
                <LockedCard icon="📋" title="מצבת תלמידים" />
              )}

              {access.bagrut ? (
                <ProductCard icon="🎓" title="זכאות לבגרות" tone="violet"
                  description="תמונת הזכאות של השכבה המסיימת, כרטיס תלמיד, מעקב ותוכנית התערבות."
                  loading={bagrut == null}
                  rows={(bagrut ?? []).map((b) => ({
                    key: b.code, to: `/bagrut/${b.code}`, title: nameOf(b.code),
                    detail: b.rounds.map((r) => `${r.school} · ${r.label}`).join(' | '),
                    badge: b.followups ? `📅 ${b.followups} למעקב השבוע` : undefined,
                  }))}
                  empty="אין עדיין סבב בגרות ברשויות שלך." />
              ) : (
                <LockedCard icon="🎓" title="זכאות לבגרות" />
              )}

              {access.superAdmin && (
                <ProductCard icon="⚙️" title="ניהול לקוחות" tone="slate"
                  description="רשויות, משתמשים והרשאות, העלאת נתונים והיסטוריית עדכונים."
                  rows={[{ key: 'admin', to: '/admin', title: 'לכל הלקוחות', detail: '' }]} />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

const TONES = {
  sky: { ring: 'hover:border-sky-300', icon: 'bg-sky-100', link: 'text-sky-700' },
  violet: { ring: 'hover:border-violet-300', icon: 'bg-violet-100', link: 'text-violet-700' },
  slate: { ring: 'hover:border-slate-300', icon: 'bg-slate-100', link: 'text-slate-700' },
}

function ProductCard({ icon, title, description, tone, rows, loading = false, empty }: {
  icon: string
  title: string
  description: string
  tone: keyof typeof TONES
  rows: { key: string; to: string; title: string; detail: string; badge?: string }[]
  loading?: boolean
  empty?: string
}) {
  const t = TONES[tone]
  return (
    <section className={`flex flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition ${t.ring}`}>
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
    </section>
  )
}

/** מוצר שאין גישה אליו — כדי שידעו שהוא קיים ואיך מבקשים */
function LockedCard({ icon, title }: { icon: string; title: string }): ReactNode {
  return (
    <section className="flex flex-col rounded-3xl border border-dashed border-slate-200 bg-slate-50/60 p-6">
      <div className="flex items-center gap-3 opacity-50">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-200 text-2xl grayscale">{icon}</span>
        <h3 className="text-lg font-extrabold text-slate-700">{title}</h3>
      </div>
      <p className="mt-2 text-sm text-slate-500">🔒 אין לך גישה למוצר הזה. לבקשת גישה — מנהל המערכת ברשות שלך.</p>
    </section>
  )
}
