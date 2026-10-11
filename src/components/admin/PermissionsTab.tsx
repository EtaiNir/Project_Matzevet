import { useEffect, useMemo, useState } from 'react'
import {
  BAGRUT_ROLE_LABELS,
  ROLE_LABELS,
  authorityHasMatzevet,
  bagrutPatch,
  deleteUser,
  fetchBagrutScopeOptions,
  fetchUsers,
  setUserPassword,
  setUserSuspended,
  updateUserPermissions,
  userProducts,
  type BagrutScopeOptions,
  type ManagedUser,
} from '@/lib/admin'
import NewUserForm, { ProductBox, suggestPassword } from './NewUserForm'
import { BagrutFields, MatzevetFields } from './ProductFields'

interface Props {
  code: string
}

type Product = 'matzevet' | 'bagrut'
const PRODUCT_LABELS: Record<Product, string> = { matzevet: 'מצבת תלמידים', bagrut: 'זכאות לבגרות' }

/**
 * מסך 2 — ניהול הרשאות, מפוצל לשני המוצרים (אייל, 11.10).
 *
 * רשימת משתמשים אחת; בכל תת-לשונית רואים את ההרשאה של המשתמש **במוצר הזה**,
 * ומי שאין לו גישה אליו מופיע מעומעם עם "מתן גישה". כל מוצר מוענק בנפרד:
 * מצבת — scope_level ≠ 'none' (מיגרציה 032); בגרות — bagrut_role ≠ null.
 * שמירה בלשונית אחת אינה נוגעת בהרשאה של המוצר האחר. האכיפה ב-RLS.
 */
export default function PermissionsTab({ code }: Props) {
  const [product, setProduct] = useState<Product>('matzevet')
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [hasProfileFields, setHasProfileFields] = useState(false)
  const [hasMatzevet, setHasMatzevet] = useState(true)
  const [bagrutOptions, setBagrutOptions] = useState<BagrutScopeOptions | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<ManagedUser | null>(null)
  // בעריכה: האם יש גישה למוצר שבלשונית
  const [access, setAccess] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function reload() {
    const r = await fetchUsers()
    setUsers(r.users)
    setHasProfileFields(r.hasProfileFields)
  }

  useEffect(() => {
    reload().catch((e) => setError(e.message))
    authorityHasMatzevet(code).then(setHasMatzevet)
    fetchBagrutScopeOptions(code).then(setBagrutOptions).catch(() => setBagrutOptions({ schools: [], grades: [], classes: [], subjects: [] }))
  }, [code])

  // מעבר בין מוצרים סוגר עריכה פתוחה — היא שייכת למוצר הקודם
  useEffect(() => {
    setEditing(null)
    setDraft(null)
  }, [product])

  const inRashut = users.filter((u) => u.authority_codes.includes(code))
  const others = users.filter((u) => !u.authority_codes.includes(code))
  // מי שיש לו גישה למוצר — קודם; מי שאין — אחריו, מעומעם
  const rows = useMemo(
    () => [...inRashut].sort((a, b) => Number(userProducts(b)[product]) - Number(userProducts(a)[product])),
    [inRashut, product],
  )
  const withAccess = inRashut.filter((u) => userProducts(u)[product]).length

  function startEdit(user: ManagedUser, grant = false) {
    const has = userProducts(user)[product]
    const d = { ...user }
    if (grant && product === 'matzevet') {
      d.role = 'viewer'
      d.scope_level = 'council'
      d.scope_values = []
    }
    if (grant && product === 'bagrut') d.bagrut_role = 'coordinator'
    setDraft(d)
    setAccess(has || grant)
    setEditing(user.id)
    setNewPassword('')
    setError(null)
    setNotice(null)
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const shared = hasProfileFields
        ? {
            job_title: draft.job_title?.trim() || null,
            institution_name: draft.institution_name?.trim() || null,
            institution_code: draft.institution_code?.trim() || null,
          }
        : {}
      if (product === 'matzevet') {
        const superAdmin = draft.role === 'super_admin'
        const on = superAdmin || access
        await updateUserPermissions(draft.id, {
          ...shared,
          // בלי מצבת — צפייה בלבד: "מנהל רשות" נותן גם פעולות מצבת (העלאת קבצים)
          role: on ? draft.role : 'viewer',
          scope_level: superAdmin ? 'council' : on ? draft.scope_level : 'none',
          scope_values: on && !superAdmin && draft.scope_level !== 'council' ? draft.scope_values : [],
          ...(hasProfileFields ? { can_edit_extra: on && draft.role === 'viewer' ? Boolean(draft.can_edit_extra) : false } : {}),
        })
      } else {
        await updateUserPermissions(draft.id, { ...shared, ...bagrutPatch(access ? draft.bagrut_role ?? 'coordinator' : null, draft) })
      }
      if (newPassword) await setUserPassword(draft.id, newPassword)
      await reload()
      setEditing(null)
      setDraft(null)
      setNotice(newPassword ? 'ההרשאות והסיסמה עודכנו' : 'ההרשאות עודכנו')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleSuspended(user: ManagedUser) {
    const next = !user.is_suspended
    if (next && !confirm(`להשהות את ${user.email}? הוא לא יוכל להתחבר עד לביטול.`)) return
    try {
      await setUserSuspended(user.id, next)
      await reload()
      setNotice(next ? `${user.email} הושהה` : `${user.email} הוחזר לפעילות`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function removeUser(user: ManagedUser) {
    if (!confirm(`למחוק לצמיתות את ${user.email}?`)) return
    try {
      await deleteUser(user.id)
      await reload()
      setNotice(`${user.email} נמחק`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const productBlocked = product === 'matzevet' && !hasMatzevet
    ? 'לרשות הזו אין מצבת — אין מה להעניק.'
    : product === 'bagrut' && bagrutOptions && !bagrutOptions.schools.length
      ? 'לרשות הזו אין עדיין סבב בגרות — אפשר להעניק גישה אחרי הקליטה הראשונה.'
      : null

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">שגיאה: {error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{notice}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-0.5 rounded-xl bg-slate-100 p-1">
            {(Object.keys(PRODUCT_LABELS) as Product[]).map((p) => (
              <button key={p} onClick={() => setProduct(p)}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${product === p ? 'bg-white text-sky-800 shadow-sm' : 'text-slate-500 hover:text-sky-700'}`}>
                {PRODUCT_LABELS[p]}
              </button>
            ))}
          </div>
          {!adding && (
            <button onClick={() => { setAdding(true); setEditing(null); setDraft(null); setNotice(null) }}
              className="rounded-lg border border-dashed border-sky-400 px-3 py-1.5 text-sm font-medium text-sky-700 transition hover:bg-sky-50">
              + משתמש חדש
            </button>
          )}
        </div>
        <p className="mb-4 text-sm text-slate-500">
          {product === 'matzevet'
            ? <>התפקיד קובע מה מותר לעשות; ההיקף קובע <strong>אילו תלמידים</strong> נראים.</>
            : <>התפקיד קובע <strong>אילו תלמידים</strong> נראים ומי עורך מעקב.</>}
          {' '}{withAccess} מתוך {inRashut.length} משתמשים עם גישה. כל מוצר מוענק בנפרד, והאכיפה במסד הנתונים (RLS) — לא רק בתצוגה.
        </p>
        {productBlocked && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{productBlocked}</p>}

        {adding && (
          <div className="mb-4">
            <NewUserForm authorityCode={code} hasMatzevet={hasMatzevet} bagrutOptions={bagrutOptions}
              onCreated={async () => { setAdding(false); await reload(); setNotice('המשתמש נוצר. מסור לו את הסיסמה שרשמת.') }}
              onCancel={() => setAdding(false)} />
          </div>
        )}

        {inRashut.length === 0 && !adding && (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">אין משתמשים משויכים לרשות זו.</p>
        )}

        <div className="space-y-3">
          {rows.map((user) => {
            const has = userProducts(user)[product]
            const isEditing = editing === user.id && draft
            return (
              <div key={user.id} className={`rounded-xl border p-4 transition ${has ? 'border-slate-200 hover:border-sky-200' : 'border-dashed border-slate-200 bg-slate-50/60'}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className={has ? '' : 'opacity-60'}>
                    <div className="flex items-center gap-2 font-medium text-slate-800">
                      {user.display_name || user.email}
                      {user.is_suspended && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-normal text-amber-800">מושהה — אינו יכול להתחבר</span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-slate-400" dir="ltr">{user.email}</div>
                    {(user.job_title || user.institution_name) && (
                      <div className="text-xs text-slate-500">{[user.job_title, user.institution_name, user.institution_code].filter(Boolean).join(' · ')}</div>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <AccessChips user={user} product={product} bagrutOptions={bagrutOptions} />
                      {!has && user.role !== 'super_admin' && !productBlocked && (
                        <button onClick={() => startEdit(user, true)}
                          className="rounded-lg bg-sky-600 px-3 py-1 text-white transition hover:bg-sky-700">מתן גישה</button>
                      )}
                      {(has || productBlocked) && (
                        <button onClick={() => startEdit(user)}
                          className="rounded-lg border border-slate-300 px-3 py-1 transition hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700">עריכה</button>
                      )}
                      <button onClick={() => toggleSuspended(user)} title={user.is_suspended ? 'החזרה לפעילות' : 'חסימת כניסה למערכת'}
                        className={'rounded-lg border px-3 py-1 transition ' + (user.is_suspended
                          ? 'border-amber-400 bg-amber-100 font-medium text-amber-800 hover:bg-amber-200'
                          : 'border-slate-300 hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700')}>
                        {user.is_suspended ? 'מושהה' : 'השהייה'}
                      </button>
                      <button onClick={() => removeUser(user)} title="מחיקת משתמש"
                        className="rounded-lg px-2 py-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600">✕</button>
                    </div>
                  )}
                </div>

                {isEditing && draft && (
                  <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                    <ProductBox title={`גישה ל${PRODUCT_LABELS[product]}`}
                      checked={product === 'matzevet' && draft.role === 'super_admin' ? true : access}
                      onToggle={setAccess}
                      disabledReason={product === 'bagrut' && draft.role === 'super_admin' ? 'מנהל־על רואה ממילא את שני המוצרים' : productBlocked}>
                      {product === 'matzevet' ? (
                        <MatzevetFields code={code} showEditExtra={hasProfileFields}
                          value={{ role: draft.role, scope_level: draft.scope_level === 'none' ? 'council' : draft.scope_level, scope_values: draft.scope_values, can_edit_extra: draft.can_edit_extra }}
                          onChange={(v) => setDraft({ ...draft, ...v })} />
                      ) : (
                        <BagrutFields options={bagrutOptions}
                          value={{ bagrut_role: draft.bagrut_role ?? 'coordinator', bagrut_schools: draft.bagrut_schools, bagrut_grades: draft.bagrut_grades, bagrut_classes: draft.bagrut_classes, bagrut_subject_keys: draft.bagrut_subject_keys }}
                          onChange={(v) => setDraft({ ...draft, ...v })} />
                      )}
                    </ProductBox>

                    {/* פרטים משותפים לשני המוצרים — תיאוריים בלבד, וסיסמה */}
                    <details className="rounded-xl border border-slate-200 p-3">
                      <summary className="cursor-pointer text-sm font-medium text-slate-600">פרטים וסיסמה (משותפים לשני המוצרים)</summary>
                      <div className="mt-3 space-y-4">
                        {hasProfileFields && (
                          <div className="grid gap-3 sm:grid-cols-3">
                            {([['job_title', 'תפקיד (לתצוגה)', 'מזכירת בית ספר'], ['institution_name', 'שם מוסד', 'מקיף גוונים'], ['institution_code', 'סמל מוסד', '440386']] as const).map(([k, label, ph]) => (
                              <label key={k} className="block">
                                <span className="mb-1 block text-sm text-slate-600">{label}</span>
                                <input value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} placeholder={ph}
                                  dir={k === 'institution_code' ? 'ltr' : undefined}
                                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none" />
                              </label>
                            ))}
                          </div>
                        )}
                        <div>
                          <label htmlFor={`pw-${draft.id}`} className="mb-1 block text-sm text-slate-600">
                            סיסמה חדשה <span className="text-xs text-slate-400">(השאר ריק כדי לא לשנות · 8 תווים לפחות)</span>
                          </label>
                          <div className="flex max-w-sm gap-2">
                            <input id={`pw-${draft.id}`} dir="ltr" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                              placeholder="ללא שינוי" className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-sky-400 focus:outline-none" />
                            <button type="button" onClick={() => setNewPassword(suggestPassword())} title="הצע סיסמה"
                              className="shrink-0 rounded-lg border border-slate-300 px-3 text-sm transition hover:bg-slate-50">🎲</button>
                          </div>
                          {newPassword.length > 0 && newPassword.length < 8 && <p className="mt-1 text-xs text-amber-700">עוד {8 - newPassword.length} תווים לפחות</p>}
                        </div>
                      </div>
                    </details>

                    <div className="flex items-center gap-2">
                      <button onClick={save} disabled={busy || (newPassword.length > 0 && newPassword.length < 8)}
                        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-50">
                        {busy ? 'שומר…' : 'שמירה'}
                      </button>
                      <button onClick={() => { setEditing(null); setDraft(null) }}
                        className="rounded-lg px-3 py-2 text-sm text-slate-500 transition hover:bg-slate-100">ביטול</button>
                      {!access && userProducts(user)[product] && draft.role !== 'super_admin' && (
                        <span className="mr-auto text-xs text-amber-700">בשמירה תוסר הגישה ל{PRODUCT_LABELS[product]}</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {others.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-bold text-slate-600">משתמשים אחרים במערכת</h3>
          <ul className="space-y-1 text-sm text-slate-500">
            {others.map((u) => (
              <li key={u.id} className="flex justify-between gap-2">
                <span dir="ltr" className="font-mono text-xs">{u.email}</span>
                <span>{ROLE_LABELS[u.role]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/** ההרשאה של המשתמש במוצר שבלשונית — או "אין גישה" */
function AccessChips({ user, product, bagrutOptions }: { user: ManagedUser; product: Product; bagrutOptions: BagrutScopeOptions | null }) {
  const chip = 'rounded-full px-3 py-1'
  if (user.role === 'super_admin') return <span className={`${chip} bg-slate-100 text-slate-600`}>מנהל־על — גישה מלאה</span>
  if (!userProducts(user)[product]) return <span className={`${chip} text-slate-400`}>— אין גישה ל{PRODUCT_LABELS[product]} —</span>

  if (product === 'matzevet') {
    return (
      <>
        <span className={`${chip} bg-slate-100 text-slate-600`}>{ROLE_LABELS[user.role]}</span>
        {user.role === 'viewer' && user.can_edit_extra && <span className={`${chip} bg-emerald-50 text-emerald-700`} title="רשאי למלא ערכים בעמודות שהמשתמש הוסיף">עריכת עמודות</span>}
        <span className={`${chip} bg-sky-50 text-sky-700`}>
          {user.scope_level === 'council' ? 'מועצתי' : `${user.scope_level === 'locality' ? 'יישובי' : 'בית-ספרי'} · ${user.scope_values.length}`}
        </span>
      </>
    )
  }

  const name = (list: { value: string; label: string }[] | undefined, v: string) => list?.find((o) => o.value === v)?.label ?? v
  const role = user.bagrut_role!
  const scope =
    role === 'council' ? 'כל בתי הספר'
      : [
          user.bagrut_schools.map((s) => name(bagrutOptions?.schools, s)).join(', ') || 'לא נבחר בית ספר',
          role === 'grade_coordinator' && (user.bagrut_grades.join(', ') || 'בלי שכבות'),
          role === 'homeroom' && (user.bagrut_classes.join(', ') || 'בלי כיתות'),
          role === 'subject_coordinator' && user.bagrut_subject_keys.length > 0 && user.bagrut_subject_keys.map((k) => name(bagrutOptions?.subjects, k)).join(', '),
        ].filter(Boolean).join(' · ')
  return (
    <>
      <span className={`${chip} bg-violet-50 text-violet-800`}>{BAGRUT_ROLE_LABELS[role]}</span>
      <span className={`${chip} max-w-xs truncate bg-sky-50 text-sky-700`} title={scope}>{scope}</span>
    </>
  )
}
