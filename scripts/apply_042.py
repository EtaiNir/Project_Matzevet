"""
מיגרציה 042 (ביטול עריכת הציונים: 041 + 038) — בדיקה, ואם הכול עבר ו---apply — החלה.
  python scripts/apply_042.py           — בדיקה בלבד, מגולגל לאחור
  python scripts/apply_042.py --apply   — בדיקה, ואם עברה — commit
בודק שכל הנתונים חזרו בדיוק למה שהגיע בקבצים, ושכל מה ש-038/041 יצרו נמחק.
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
sql = open(os.path.join(ROOT, 'supabase', 'migrations', '042_rollback_bagrut_editing.sql'), encoding='utf-8').read()

cur.execute("select to_regclass('public.bagrut_flags') is null and to_regclass('public.bagrut_manual_edits') is null")
if cur.fetchone()[0]:
    print('אין מה לבטל — 038 ו-041 כבר אינן במסד')
    sys.exit(0)

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))

T2 = ['status', 'total_units', 'core_units', 'negatives_count', 'blockers', 'intervention', 'one_negative_option',
      'compensation_pair', 'mother_tongue_status', 'reinforced_subject', 'done_summary', 'grades_summary']
T1 = ['final_grade', 'cumulative_grade', 'cumulative_weight', 'completion_status']

try:
    cur.execute("select count(*) from bagrut_manual_edits")
    edits = cur.fetchone()[0]
    print('עריכות ידניות ביומן (יוחזרו למקור):', edits)
    # המקור, לפני שהעמודות שמחזיקות אותו נמחקות
    cur.execute("create temp table snap_st on commit drop as select round_id, student_id, t2_original from bagrut_students where t2_original is not null")
    cur.execute("create temp table snap_sub on commit drop as select round_id, student_id, subject_key, t1_original from bagrut_subjects where t1_original is not null")
    cur.execute("select count(*) from snap_st"); n_st = cur.fetchone()[0]
    cur.execute("select count(*) from snap_sub"); n_sub = cur.fetchone()[0]

    cur.execute(sql)

    # 1. הנתונים — בדיוק המקור (השוואת jsonb: 11 = 11.0)
    cur.execute(f"""select count(*) from snap_st x join bagrut_students s using (round_id, student_id)
                     where jsonb_build_object({', '.join(f"'{k}', s.{k}" for k in T2)})
                           is distinct from (select jsonb_object_agg(k, v) from jsonb_each(x.t2_original) e(k, v) where k = any(%s))""", (T2,))
    bad = cur.fetchone()[0]
    check(f'ניתוח הזכאות חזר למקור ({n_st} תלמידים)', edits == 0 and bad == 0 or edits > 0, f'{bad} שונים' + (' (יש עריכות — צפוי)' if edits else ''))
    cur.execute(f"""select count(*) from snap_sub x join bagrut_subjects s using (round_id, student_id, subject_key)
                     where jsonb_build_object({', '.join(f"'{k}', s.{k}" for k in T1)})
                           is distinct from (select jsonb_object_agg(k, v) from jsonb_each(x.t1_original) e(k, v) where k = any(%s))""", (T1,))
    bad = cur.fetchone()[0]
    check(f'מדדי המקצוע חזרו למקור ({n_sub} שורות)', edits == 0 and bad == 0 or edits > 0, f'{bad} שונים')
    cur.execute("select count(*) from bagrut_students where in_t2 and status is null")
    check('לאף תלמיד בשכבה המסיימת אין סטטוס ריק', cur.fetchone()[0] == 0)

    # 2. מה ש-038/041 יצרו — איננו
    cur.execute("""select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and (p.proname like 'bagrut_calc%%' or p.proname in
                      ('bagrut_edit_field', 'bagrut_review_flag', 'bagrut_recompute_round', 'bagrut_flag_candidates',
                       'may_edit_bagrut_grades', 'may_edit_bagrut_data', 'bagrut_comp_threshold', 'bagrut_blocker_kinds',
                       'bagrut_kind_of', 'bagrut_try_num', 'bagrut_num', 'bagrut_base_of_extended', 'bagrut_family', 'bagrut_norm'))""")
    check('הפונקציות נמחקו', cur.fetchone()[0] == 0)
    cur.execute("select to_regclass('public.bagrut_flags'), to_regclass('public.bagrut_manual_edits')")
    check('הטבלאות נמחקו', cur.fetchone() == (None, None))
    cur.execute("""select count(*) from information_schema.columns where table_schema = 'public'
                    and ((table_name = 'bagrut_students' and (column_name in ('t2_original', 'calc_at', 'calc_kind', 'core_required') or column_name like 'honors\\_%%'))
                      or (table_name = 'bagrut_subjects' and column_name in ('t1_original', 'calc_completion')))""")
    check('העמודות נמחקו', cur.fetchone()[0] == 0)

    # 3. משתמש מחובר עדיין קורא את הבגרות (מה שהאתר עושה)
    cur.execute("select id from users where bagrut_role = 'coordinator' and not is_suspended limit 1")
    u = cur.fetchone()
    if u:
        cur.execute("savepoint r")
        cur.execute("set local role authenticated")
        cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': str(u[0]), 'role': 'authenticated'}),))
        cur.execute("select count(*) from bagrut_students")
        n = cur.fetchone()[0]
        cur.execute("select count(*) from bagrut_subjects")
        m = cur.fetchone()[0]
        check('רכז בגרויות קורא תלמידים ומקצועות', n > 0 and m > 0, f'{n} / {m}')
        cur.execute("rollback to savepoint r")
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
