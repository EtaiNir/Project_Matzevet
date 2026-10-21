"""
מיגרציה 043 (שינוי ידני של סטטוס הזכאות) — בדיקה, ואם הכול עבר ו---apply — החלה.
  python scripts/apply_043.py           — בדיקה בלבד, מגולגל לאחור
  python scripts/apply_043.py --apply   — בדיקה, ואם עברה — commit
בודק כמשתמשים אמיתיים (מלכודת 26). מדפיס סיכומים בלבד: בלי שמות ובלי ת"ז.
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
sql = open(os.path.join(ROOT, 'supabase', 'migrations', '043_bagrut_status_override.sql'), encoding='utf-8').read()

cur.execute("select to_regclass('public.bagrut_status_overrides') is not null")
if cur.fetchone()[0]:
    print('bagrut_status_overrides כבר קיימת — 043 הוחלה כבר')
    sys.exit(0)

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))

def as_user(uid):
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': str(uid), 'role': 'authenticated'}),))

def back():
    cur.execute("reset role")

def call(uid, rid, sid, kind, reason):
    as_user(uid)
    cur.execute("select public.bagrut_set_status(%s, %s, %s, %s)", (rid, sid, kind, reason))
    r = cur.fetchone()[0]
    back()
    return r

def expect_error(name, uid, args, needle):
    cur.execute("savepoint e")
    try:
        call(uid, *args)
        check(name, False, 'עבר בלי שגיאה')
    except psycopg2.Error as e:
        msg = e.diag.message_primary or str(e)
        check(name, needle in msg, msg[:70])
    cur.execute("rollback to savepoint e")

try:
    cur.execute(sql)
    cur.execute("select id from users where role = 'super_admin' and not is_suspended and not coalesce(is_service_account, false) limit 1")
    admin = cur.fetchone()[0]
    cur.execute("select id from users where bagrut_role = 'coordinator' and not is_suspended limit 1")
    coord = cur.fetchone()[0]
    cur.execute("select id from users where bagrut_role = 'homeroom' and not is_suspended limit 1")
    homeroom = cur.fetchone()

    as_user(coord)
    cur.execute("""select round_id, student_id, status from bagrut_students
                    where in_t2 and status like '%%אין זכאות%%' and public.may_override_bagrut_status(round_id, student_id) limit 1""")
    rid, sid, status_before = cur.fetchone()
    cur.execute("""select round_id, student_id from bagrut_students
                    where not in_t2 and public.may_override_bagrut_status(round_id, student_id) limit 1""")
    other = cur.fetchone()
    back()

    # 1. רכז בגרויות: אין זכאות → זכאי, עם סיבה
    r = call(coord, rid, sid, 'eligible', 'פטור שאושר במשרד')
    check('רכז משנה לזכאי', r.get('changed') and r.get('kind') == 'eligible', r.get('kind'))
    check('נרשם מי שינה', bool(r.get('set_by_email')))
    as_user(coord)
    cur.execute("select count(*) from bagrut_status_overrides where round_id = %s and student_id = %s", (rid, sid))
    check('הרכז קורא את השינוי (RLS)', cur.fetchone()[0] == 1)
    back()
    cur.execute("select status from bagrut_students where round_id = %s and student_id = %s", (rid, sid))
    check('ניתוח הזכאות עצמו לא השתנה', cur.fetchone()[0] == status_before)
    r = call(coord, rid, sid, 'eligible', 'פטור שאושר במשרד')
    check('אותו שינוי שוב — לא נרשם', r.get('changed') is False)
    r = call(coord, rid, sid, 'not_eligible', 'הפטור בוטל')
    check('זכאי → אין זכאות', r.get('changed') and r.get('kind') == 'not_eligible')
    r = call(coord, rid, sid, None, None)
    check('חזרה לניתוח הזכאות', r.get('changed') and r.get('kind') is None)
    r = call(coord, rid, sid, None, None)
    check('חזרה כשאין שינוי — לא נרשם', r.get('changed') is False)
    cur.execute("select count(*) from bagrut_status_overrides where round_id = %s and student_id = %s", (rid, sid))
    check('היומן שומר את כל השלבים', cur.fetchone()[0] == 3)

    # 2. מנהל־על
    r = call(admin, rid, sid, 'eligible', 'בדיקה')
    check('מנהל־על משנה', r.get('changed'))

    # 3. חסימות
    expect_error('בלי סיבה — נחסם', coord, (rid, sid, 'not_eligible', '  '), 'סיבה')
    expect_error('סטטוס לא מוכר — נחסם', coord, (rid, sid, 'one_negative', 'x'), 'לא מוכר')
    if other:
        expect_error('תלמיד שאינו בשכבה המסיימת — נחסם', coord, (other[0], other[1], 'eligible', 'x'), 'אין ניתוח זכאות')
    if homeroom:
        expect_error('מחנך — נחסם', homeroom[0], (rid, sid, 'eligible', 'x'), 'רק מנהל־על ורכז')

    # 4. כתיבה ישירה דרך ה-API
    cur.execute("savepoint d")
    as_user(coord)
    try:
        cur.execute("insert into bagrut_status_overrides (round_id, student_id, kind, reason) values (%s, %s, 'eligible', 'x')", (rid, sid))
        check('insert ישיר — נחסם', False, 'עבר')
    except psycopg2.Error as e:
        check('insert ישיר — נחסם', True, type(e).__name__)
    cur.execute("rollback to savepoint d")
    as_user(coord)
    cur.execute("update bagrut_status_overrides set kind = 'not_eligible' where round_id = %s", (rid,))
    u = cur.rowcount
    cur.execute("delete from bagrut_status_overrides where round_id = %s", (rid,))
    d = cur.rowcount
    check('update / delete ישירים — 0 שורות (מלכודת 21)', u == 0 and d == 0, f'{u} / {d}')
    back()
    cur.execute("rollback to savepoint d")

    # 5. קליטת סבב חדש (מחיקת הסבב) — השינויים נמחקים איתו
    cur.execute("savepoint c")
    cur.execute("delete from bagrut_rounds where id = %s", (rid,))
    cur.execute("select count(*) from bagrut_status_overrides where round_id = %s", (rid,))
    check('מחיקת הסבב מוחקת את השינויים (cascade)', cur.fetchone()[0] == 0)
    cur.execute("rollback to savepoint c")

    # הבדיקות כתבו שורות — מוחקים לפני commit (המיגרציה עצמה נשארת)
    cur.execute("delete from bagrut_status_overrides")
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
