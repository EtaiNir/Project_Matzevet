"""
מיגרציה 049 (תקציב: תמונות מצב, היסטוריית צפי, חריגות, אישור תכנית, פרטיות שכר)
— בדיקה, ואם הכול עבר ו---apply — החלה.
  python scripts/apply_049.py           — בדיקה בלבד, מגולגל לאחור
  python scripts/apply_049.py --apply   — בדיקה, ואם עברה — commit
מדפיס סיכומים בלבד.
"""
import os, sys, json, psycopg2
sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
apply = '--apply' in sys.argv
env = dict(l.strip().split('=', 1) for l in open(os.path.join(ROOT, '.env.db'), encoding='utf-8')
           if '=' in l and not l.strip().startswith('#'))
conn = psycopg2.connect(host=env['PGHOST'], port=env['PGPORT'], user=env['PGUSER'], password=env['PGPASSWORD'],
                        dbname=env['PGDATABASE'], sslmode='require', connect_timeout=15)
conn.autocommit = False
cur = conn.cursor()
sql = open(os.path.join(ROOT, 'supabase', 'migrations', '049_budget_tracking.sql'), encoding='utf-8').read()

cur.execute("select to_regclass('public.budget_snapshots') is not null")
if cur.fetchone()[0]:
    print('budget_snapshots כבר קיימת — 049 הוחלה כבר')
    sys.exit(0)

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))

def as_user(uid):
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': str(uid), 'role': 'authenticated'}),))

def back():
    cur.execute("reset role")

def expect_error(name, uid, q, args, needle):
    cur.execute("savepoint e")
    try:
        as_user(uid)
        cur.execute(q, args)
        check(name, False, 'עבר בלי שגיאה')
    except psycopg2.Error as e:
        msg = e.diag.message_primary or str(e)
        check(name, needle in msg, msg[:70])
    cur.execute("rollback to savepoint e")

try:
    cur.execute(sql)
    cur.execute("select authority_code, fiscal_year, max(as_of) from budget_cards group by 1, 2 order by 3 desc limit 1")
    code, year, as_of = cur.fetchone()
    cur.execute("select id from users where role = 'super_admin' and not is_suspended and not coalesce(is_service_account, false) limit 1")
    admin = cur.fetchone()[0]

    # ── 1. תמונת מצב: כמו הקליטה — מוחקים כרטיסים ואז תנועות, באותה טרנזקציה
    cur.execute("savepoint snap")
    cur.execute("select count(*), coalesce(sum(debit),0), coalesce(sum(credit),0) from budget_transactions where authority_code=%s and not is_opening and event_date is not null", (code,))
    n0, d0, c0 = cur.fetchone()
    cur.execute("delete from budget_cards where authority_code=%s and fiscal_year=%s", (code, year))
    cur.execute("delete from budget_transactions where authority_code=%s", (code,))
    cur.execute("select count(*), max(as_of), max(from_date) is not null from budget_snapshots where authority_code=%s", (code,))
    cnt, snap_asof, has_range = cur.fetchone()
    check('קליטה = תמונה אחת (כרטיסים + תנועות)', cnt == 1, cnt)
    check('התמונה שומרת את תאריך הנתונים הקודם', snap_asof == as_of, f'{snap_asof} / {as_of}')
    cur.execute("""select coalesce(sum(n),0), coalesce(sum(debit),0), coalesce(sum(credit),0) from budget_snapshot_monthly m
                    join budget_snapshots s on s.id = m.snapshot_id where s.authority_code=%s""", (code,))
    n1, d1, c1 = cur.fetchone()
    check('הסיכום החודשי = מה שנמחק', (n1, round(d1, 2), round(c1, 2)) == (n0, round(d0, 2), round(c0, 2)), f'{n1} תנועות')
    cur.execute("rollback to savepoint snap")

    # ── 2. היסטוריית צפי + 4. אישור תכנית
    cur.execute("select card_code from budget_card_plans where authority_code=%s and fiscal_year=%s limit 1", (code, year))
    card = cur.fetchone()[0]
    cur.execute("savepoint plan")
    as_user(admin)
    cur.execute("update budget_card_plans set forecast_expense = coalesce(forecast_expense, 0) + 1000 where authority_code=%s and card_code=%s and fiscal_year=%s", (code, card, year))
    back()
    cur.execute("select field, changed_email is null, changed_by is not null from budget_plan_history where authority_code=%s and card_code=%s", (code, card))
    h = cur.fetchall()
    check('שינוי צפי נרשם בהיסטוריה', h == [('forecast_expense', True, True)], h)
    as_user(admin)
    cur.execute("select public.budget_plan_submit(%s, %s, %s, 'מוכן')", (code, card, year))
    r = cur.fetchone()[0]
    check('הגשת תכנית', r['status'] == 'submitted', r['status'])
    cur.execute("select public.budget_plan_decide(%s, %s, %s, true, null)", (code, card, year))
    r = cur.fetchone()[0]
    check('אישור תכנית', r['status'] == 'approved', r['status'])
    cur.execute("update budget_card_plans set next_expense = coalesce(next_expense, 0) + 1 where authority_code=%s and card_code=%s and fiscal_year=%s", (code, card, year))
    back()
    cur.execute("select count(*) from budget_plan_reviews where authority_code=%s and card_code=%s and fiscal_year=%s", (code, card, year))
    check('עריכה אחרי אישור — חוזרת לעבודה', cur.fetchone()[0] == 0)
    back()
    expect_error('החזרה בלי סיבה — נחסמת', admin, "select public.budget_plan_decide(%s, %s, %s, false, '')", (code, card, year), 'למה')
    cur.execute("rollback to savepoint plan")

    # ── 3. חריגות: "בדקתי" — מי ומתי נקבעים במסד
    cur.execute("savepoint ex")
    as_user(admin)
    cur.execute("""insert into budget_exception_reviews (authority_code, fiscal_year, period, card_code, kind, value_at_review, note, reviewed_by)
                   values (%s, %s, 'calendar', %s, 'over_budget', 1000, 'נבדק', null) returning reviewed_by""", (code, year, card))
    check('"בדקתי" — המזהה נקבע במסד, לא מהדפדפן', str(cur.fetchone()[0]) == str(admin))
    back()
    cur.execute("rollback to savepoint ex")

    # ── 5. פרטיות: אחראי תקציב — לא תנועות שכר, כן סיכומים
    cur.execute("""select m.category1, m.card_code from budget_card_meta m
                    where m.authority_code=%s and public.budget_is_salary(m.card_code) and m.category1 is not null
                      and exists (select 1 from budget_transactions t where t.authority_code=m.authority_code and t.card_code=m.card_code and not t.is_opening)
                    limit 1""", (code,))
    cat, salary_card = cur.fetchone()
    cur.execute("""select m.card_code from budget_card_meta m where m.authority_code=%s and m.category1=%s and not public.budget_is_salary(m.card_code)
                      and exists (select 1 from budget_transactions t where t.authority_code=m.authority_code and t.card_code=m.card_code) limit 1""", (code, cat))
    other = cur.fetchone()
    cur.execute("select id from users where role <> 'super_admin' and not is_suspended limit 1")
    tester = cur.fetchone()[0]
    cur.execute("savepoint own")
    cur.execute("update users set budget_role='owner', budget_categories=array[%s], authority_codes=array[%s] where id=%s", (cat, code, tester))
    as_user(tester)
    cur.execute("select count(*) from budget_transactions where authority_code=%s and card_code=%s", (code, salary_card))
    check('אחראי: תנועות שכר — חסומות', cur.fetchone()[0] == 0)
    if other:
        cur.execute("select count(*) from budget_transactions where authority_code=%s and card_code=%s", (code, other[0]))
        check('אחראי: תנועות שאינן שכר — גלויות', cur.fetchone()[0] > 0)
    cur.execute("select count(*) from public.budget_monthly(%s, '2000-01-01', '2100-01-01') where card_code=%s", (code, salary_card))
    check('אחראי: סיכום חודשי בכרטיס שכר — נשאר', cur.fetchone()[0] > 0)
    cur.execute("select count(distinct card_code) from public.budget_monthly(%s, '2000-01-01', '2100-01-01')", (code,))
    own_cards = cur.fetchone()[0]
    cur.execute("select count(*) from budget_cards where authority_code=%s", (code,))
    check('אחראי: הסיכומים רק בכרטיסים שלו', 0 < own_cards <= cur.fetchone()[0], own_cards)
    back()
    cur.execute("rollback to savepoint own")
    as_user(admin)
    cur.execute("select count(*) from budget_transactions where authority_code=%s and card_code=%s", (code, salary_card))
    check('מנהל־על: תנועות שכר — גלויות', cur.fetchone()[0] > 0)
    back()
    cur.execute("select count(*) from budget_cards where public.budget_is_salary(card_code)")
    print('  כרטיסי שכר ברשויות:', cur.fetchone()[0])
finally:
    for name, ok, detail in results:
        print(('✓' if ok else '✗'), name, f'({detail})' if detail != '' else '')

passed = results and all(ok for _, ok, _ in results)
if passed and apply:
    conn.commit()
    print('הוחלה.')
else:
    conn.rollback()
    print('גולגל לאחור — שום דבר לא השתנה במסד' + ('' if passed else ' (בדיקה נכשלה)'))
conn.close()
