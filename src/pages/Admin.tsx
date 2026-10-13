import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import AuditLog from '@/components/admin/AuditLog'
import HomeLink from '@/components/HomeLink'
import {
  fetchAuthorities,
  fetchClients,
  fetchStudentCounts,
  createAuthority,
  type Authority,
  type Client,
  type DeletedAuthoritySummary,
} from '@/lib/admin'

interface CardData {
  authority: Authority
  client: Client | null
  students: number
}

/** מתי מועד קרוב מספיק כדי להדליק נורה — 30 יום. */
const SOON_DAYS = 30

function daysUntil(date: string | null): number | null {
  if (!date) return null
  const diff = new Date(date).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

/** סטטוס מועד: פג / קרוב / תקין — לצביעת התגית בכרטיס. */
function dateStatus(date: string | null) {
  const days = daysUntil(date)
  if (date === null || days === null) return { tone: 'text-slate-400', text: '—' }
  if (days < 0) return { tone: 'text-red-600 font-semibold', text: `באיחור ${-days} ימים` }
  if (days <= SOON_DAYS) return { tone: 'text-amber-600 font-semibold', text: `בעוד ${days} ימים` }
  return { tone: 'text-slate-600', text: new Date(date).toLocaleDateString('he-IL') }
}

/** מסך המנהל — כרטיס לקוח לכל מועצה אזורית. */
export default function Admin() {
  const { profile, signOut } = useAuth()
  // הודעת המחיקה מגיעה מ-ClientDetail דרך state של הניווט
  const deleted = useLocation().state?.deleted as DeletedAuthoritySummary | undefined
  const [cards, setCards] = useState<CardData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // הוספת מועצה חדשה
  const [adding, setAdding] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  async function load() {
    const [authorities, clients] = await Promise.all([fetchAuthorities(), fetchClients()])
    // כל הספירות בבקשה אחת (034) — לא ספירה לכל רשות במקביל, שנכשלה בעומס
    const counts = await fetchStudentCounts(authorities.map((a) => a.code))
    setCards(
      authorities.map((a) => ({
        authority: a,
        client: clients.find((c) => c.authority_code === a.code) ?? null,
        students: counts.get(a.code) ?? 0,
      })),
    )
  }

  useEffect(() => {
    let active = true
    load()
      .catch((e) => active && setError((e as Error).message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      await createAuthority(newCode, newName)
      await load()
      setAdding(false)
      setNewCode('')
      setNewName('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="min-h-full bg-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-6 py-3 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-sky-800">ניהול לקוחות</h1>
          <p className="text-sm text-slate-500">מועצות אזוריות ובתי ספר במערכת</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded-lg bg-sky-600 px-4 py-1.5 font-medium text-white shadow-sm transition hover:bg-sky-700"
          >
            + הוספת מועצה
          </button>
          <HomeLink />
          <span className="text-slate-500">{profile?.display_name ?? profile?.email}</span>
          <button
            onClick={signOut}
            className="rounded-lg px-2 py-1 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
          >
            יציאה
          </button>
        </div>
      </header>

      <main className="p-6">
        {loading && <p className="text-slate-400">טוען לקוחות…</p>}
        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">שגיאה: {error}</p>
        )}

        {deleted && (
          <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <strong>{deleted.name}</strong> נמחקה — {deleted.students.toLocaleString('he-IL')}{' '}
            תלמידים, {deleted.uploads} רשומות עדכון ו-{deleted.documents} מסמכים.
            {deleted.users > 0 && ` ${deleted.users} משתמשים איבדו את השיוך אליה.`}
          </p>
        )}

        {adding && (
          <div className="mb-6 rounded-2xl border-2 border-sky-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 font-bold text-sky-800">מועצה חדשה</h2>
            <p className="mb-4 text-sm text-slate-500">
              תיווצר גם טבלת תלמידים ייעודית לרשות, עם ההרשאות והאינדקסים שלה.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1 block text-sm text-slate-600">קוד רשות</span>
                <input
                  dir="ltr"
                  inputMode="numeric"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="1400000"
                  className="w-40 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-slate-600">שם המועצה</span>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="מטה מנשה"
                  className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-300"
                />
              </label>
              <button
                onClick={handleCreate}
                disabled={creating || !newCode || !newName.trim()}
                className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50"
              >
                {creating ? 'יוצר…' : 'יצירה'}
              </button>
              <button
                onClick={() => setAdding(false)}
                className="rounded-lg px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-100"
              >
                ביטול
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ authority, client, students }) => {
            const payment = dateStatus(client?.next_payment_date ?? null)
            const renewal = dateStatus(client?.contract_renewal ?? null)
            return (
              <Link
                key={authority.code}
                to={`/admin/client/${authority.code}`}
                className="group block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-lg"
              >
                {/* פס עליון צבעוני */}
                <div className="h-1.5 bg-gradient-to-l from-sky-400 to-sky-600" />

                <div className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-bold text-slate-800 group-hover:text-sky-700">
                        {authority.name}
                      </h2>
                      <p className="font-mono text-xs text-slate-400" dir="ltr">
                        {authority.code}
                      </p>
                    </div>
                    {!authority.is_active && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        לא פעיל
                      </span>
                    )}
                  </div>

                  <div className="mt-4 rounded-xl bg-sky-50 px-4 py-3 text-center">
                    <div className="text-2xl font-bold text-sky-700">
                      {students.toLocaleString('he-IL')}
                    </div>
                    <div className="text-xs text-sky-600">תלמידים במערכת</div>
                  </div>

                  <dl className="mt-4 space-y-1.5 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">תשלום הבא</dt>
                      <dd className={payment.tone}>{payment.text}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">חידוש הסכם</dt>
                      <dd className={renewal.tone}>{renewal.text}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">איש קשר</dt>
                      <dd className="truncate text-slate-700">{client?.contact_name || '—'}</dd>
                    </div>
                  </dl>
                </div>
              </Link>
            )
          })}
        </div>

        {!loading && cards.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-slate-400">
            <div className="text-3xl">🏛</div>
            <p className="mt-2">אין עדיין מועצות במערכת</p>
          </div>
        )}

        <AuditLog />
      </main>
    </div>
  )
}
