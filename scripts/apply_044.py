"""
מיגרציה 044 (שינוי סטטוס ע"י מנהל־על — בלי מייל) — בדיקה, ואם הכול עבר ו---apply — החלה.
  python scripts/apply_044.py           — בדיקה בלבד, מגולגל לאחור
  python scripts/apply_044.py --apply   — בדיקה, ואם עברה — commit
מדפיס סיכומים בלבד: בלי שמות ובלי ת"ז.
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
sql = open(os.path.join(ROOT, 'supabase', 'migrations', '044_status_override_role.sql'), encoding='utf-8').read()

cur.execute("""select count(*) from information_schema.columns where table_schema = 'public'
                and table_name = 'bagrut_status_overrides' and column_name = 'set_by_role'""")
if cur.fetchone()[0]:
    print('set_by_role כבר קיימת — 044 הוחלה כבר')
    sys.exit(0)

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))

def call(uid, rid, sid, kind, reason):
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': str(uid), 'role': 'authenticated'}),))
    cur.execute("select public.bagrut_set_status(%s, %s, %s, %s)", (rid, sid, kind, reason))
    r = cur.fetchone()[0]
    cur.execute("reset role")
    return r

try:
    cur.execute("select count(*) from bagrut_status_overrides"); before = cur.fetchone()[0]
    cur.execute(sql)
    cur.execute("select count(*) from bagrut_status_overrides where set_by_role is null and set_by is not null")
    check(f'שורות קיימות קיבלו תפקיד ({before})', cur.fetchone()[0] == 0)

    cur.execute("select id from users where role = 'super_admin' and not is_suspended and not coalesce(is_service_account, false) limit 1")
    admin = cur.fetchone()[0]
    cur.execute("select id, email from users where bagrut_role = 'coordinator' and role <> 'super_admin' and not is_suspended limit 1")
    coord, coord_email = cur.fetchone()
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': str(coord), 'role': 'authenticated'}),))
    cur.execute("select round_id, student_id from bagrut_students where in_t2 and public.may_override_bagrut_status(round_id, student_id) limit 1")
    rid, sid = cur.fetchone()
    cur.execute("reset role")

    cur.execute("savepoint t")
    r = call(admin, rid, sid, 'eligible', 'בדיקה')
    check('מנהל־על: set_by_role = super_admin', r.get('set_by_role') == 'super_admin', r.get('set_by_role'))
    check('מנהל־על: אין מייל', r.get('set_by_email') is None, r.get('set_by_email'))
    cur.execute("select set_by is not null from bagrut_status_overrides where round_id = %s and student_id = %s order by set_at desc limit 1", (rid, sid))
    check('מנהל־על: המזהה נשמר (למנהלי העל)', cur.fetchone()[0])
    r = call(coord, rid, sid, 'not_eligible', 'בדיקה')
    check('רכז/ת: set_by_role = coordinator', r.get('set_by_role') == 'coordinator', r.get('set_by_role'))
    check('רכז/ת: המייל נשמר', r.get('set_by_email') == coord_email)
    cur.execute("rollback to savepoint t")
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
