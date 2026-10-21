"""
מיגרציה 041 (מנוע הזכאות) — בדיקה, ואם הכול עבר ו---apply — החלה.
מריץ את המיגרציה בטרנזקציה, משווה לניתוח הזכאות ולעיבוד הציונים, ובודק את
ההרשאות כמשתמשים אמיתיים (מלכודת 26). שום דבר לא נשמר בלי --apply.
  python apply_041.py           — בדיקה בלבד, מגולגל לאחור
  python apply_041.py --apply   — בדיקה, ואם עברה — commit
מדפיס סיכומים בלבד: בלי שמות ובלי ת"ז.
"""
import os, sys, json, time, psycopg2
sys.stdout.reconfigure(encoding='utf-8')

# פרטי החיבור מ-.env.db בשורש הפרויקט (ב-.gitignore). הסיסמה לא מודפסת.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def connect(readonly=True):
    env = dict(l.strip().split('=', 1) for l in open(os.path.join(ROOT, '.env.db'), encoding='utf-8')
               if '=' in l and not l.strip().startswith('#'))
    c = psycopg2.connect(host=env['PGHOST'], port=env['PGPORT'], user=env['PGUSER'], password=env['PGPASSWORD'],
                         dbname=env['PGDATABASE'], sslmode='require', connect_timeout=15)
    if readonly:
        c.set_session(readonly=True)
    return c


apply = '--apply' in sys.argv
sql = open(os.path.join(ROOT, 'supabase', 'migrations', '041_bagrut_engine.sql'), encoding='utf-8').read()
conn = connect(readonly=False)
conn.autocommit = False
cur = conn.cursor()

cur.execute("select to_regclass('public.bagrut_flags') is not null")
if cur.fetchone()[0]:
    print('bagrut_flags כבר קיימת — 041 הוחלה כבר')
    sys.exit(0)

results = []
def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))

def as_user(uid):
    cur.execute("set local role authenticated")
    cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({'sub': str(uid), 'role': 'authenticated'}),))

def back():
    cur.execute("reset role")
    cur.execute("select set_config('request.jwt.claims', '', true)")

def expect_error(name, q, args, needle):
    cur.execute("savepoint e")
    try:
        cur.execute(q, args)
        check(name, False, 'עבר בלי שגיאה')
    except psycopg2.Error as e:
        msg = (e.diag.message_primary or str(e))
        check(name, needle in msg, msg[:80])
    cur.execute("rollback to savepoint e")

try:
    t0 = time.time()
    cur.execute(sql)
    print(f'המיגרציה רצה ב-{time.time() - t0:.1f} שניות')

    # ── 1. השוואה לניתוח הזכאות
    cur.execute("""
      select r.school_name, count(*) filter (where s.in_t2),
             count(*) filter (where s.in_t2 and public.bagrut_kind_of(s.t2_original->>'status') = s.calc_kind),
             count(*) filter (where s.in_t2 and s.calc_at is null),
             count(*) filter (where s.calc_kind = 'eligible'), count(*) filter (where s.calc_kind = 'one_negative'),
             count(*) filter (where s.honors_excellence), count(*) filter (where s.honors_tech), count(*) filter (where s.honors_tech_no_english)
        from bagrut_students s join bagrut_rounds r on r.id = s.round_id group by 1 order by 1""")
    for school, n, same, nocalc, el, one, exc, tech, tne in cur.fetchall():
        print(f'  {school}: סטטוס זהה {same}/{n} · זכאי {el} · שלילי אחד {one} · מצטיינת {exc} · טק {tech} · טק בלי אנגלית {tne}')
        check(f'{school}: סטטוס זהה לניתוח הזכאות', same == n, f'{same}/{n}')
        check(f'{school}: כולם חושבו', nocalc == 0, nocalc)
    cur.execute("""select r.school_name, f.source, f.field, count(*) from bagrut_flags f join bagrut_rounds r on r.id = f.round_id
                    group by 1, 2, 3 order by 1, 4 desc""")
    print('  דגלים:')
    for row in cur.fetchall():
        print('   ', row)
    cur.execute("""select t1_original->>'completion_status' a, completion_status b, count(*) from bagrut_subjects
                    where t1_original->>'completion_status' is distinct from completion_status group by 1, 2 order by 3 desc limit 8""")
    print('  מצב השלמה שהשתנה (מקור → מחושב):', cur.fetchall())
    cur.execute("""select count(*) from bagrut_students where in_t2 and t2_original->>'intervention' = intervention""")
    print('  התערבות זהה מילה במילה:', cur.fetchone()[0])

    # ── 2. משתמשים לבדיקה
    cur.execute("select id from users where role = 'super_admin' and not is_suspended and not coalesce(is_service_account, false) limit 1")
    admin = cur.fetchone()[0]
    cur.execute("select id from users where bagrut_role = 'coordinator' and not is_suspended limit 1")
    coord = cur.fetchone()
    cur.execute("select id from users where bagrut_role = 'homeroom' and not is_suspended limit 1")
    homeroom = cur.fetchone()
    coord = coord[0] if coord else None

    # תלמיד בשכבה המסיימת, לא זכאי, עם ציון שאלון — שרכז הבגרויות רואה
    pick_user = coord or admin
    as_user(pick_user)
    cur.execute("""select s.round_id, s.student_id from bagrut_students s
                    where s.in_t2 and s.calc_kind = 'not_eligible' and public.may_edit_bagrut_grades(s.round_id, s.student_id)
                      and exists (select 1 from bagrut_grades g where g.round_id = s.round_id and g.student_id = s.student_id and g.grade < 55 and g.weight > 0)
                    limit 1""")
    pick = cur.fetchone()
    back()
    check('נמצא תלמיד לבדיקה שהרכז רשאי לעדכן', pick is not None)
    rid, sid = pick
    cur.execute("""select subject_key, questionnaire_code, grade from bagrut_grades
                    where round_id = %s and student_id = %s and grade < 55 and weight > 0 order by grade limit 1""", (rid, sid))
    subj, qcode, oldg = cur.fetchone()
    cur.execute("select final_grade from bagrut_subjects where round_id=%s and student_id=%s and subject_key=%s", (rid, sid, subj))
    old_final = cur.fetchone()[0]
    cur.execute("select negatives_count, status, calc_at from bagrut_students where round_id=%s and student_id=%s", (rid, sid))
    old_neg, old_status, old_at = cur.fetchone()

    # ── 3. רכז בגרויות מעדכן ציון → הכול מתעדכן
    cur.execute("savepoint edit")
    as_user(pick_user)
    cur.execute("select public.bagrut_edit_field(%s, %s, 'grade', %s, %s, 'grade', '100')", (rid, sid, subj, qcode))
    res = cur.fetchone()[0]
    back()
    check('עדכון ציון: changed=true', res.get('changed'), res)
    cur.execute("select grade, weight, weighted from bagrut_grades where round_id=%s and student_id=%s and subject_key=%s and questionnaire_code=%s", (rid, sid, subj, qcode))
    g, w, wd = cur.fetchone()
    check('הציון נשמר והמשוקלל חושב', g == 100 and wd == round(100 * w, 2), (g, w, wd))
    cur.execute("select final_grade, cumulative_grade, completion_status from bagrut_subjects where round_id=%s and student_id=%s and subject_key=%s", (rid, sid, subj))
    nf = cur.fetchone()
    check('ציון המקצוע חושב מחדש', nf[1] is not None, f'סופי {old_final} → {nf[0]}, מצטבר {nf[1]}, {nf[2]}')
    cur.execute("select negatives_count, status, calc_at from bagrut_students where round_id=%s and student_id=%s", (rid, sid))
    nn, ns, nat = cur.fetchone()
    cur.execute("select grades_summary from bagrut_students where round_id=%s and student_id=%s", (rid, sid))
    gsum = cur.fetchone()[0] or ''
    check('הזכאות חושבה מחדש (הציון החדש בריכוז הציונים)', nf[0] is None or f'({int(nf[0])})' in gsum, f'שליליים {old_neg} → {nn} · {old_status} → {ns}')
    cur.execute("select count(*) from bagrut_manual_edits where round_id=%s and student_id=%s", (rid, sid))
    check('נרשם ביומן העריכות', cur.fetchone()[0] == 1)
    cur.execute("select count(*) from bagrut_flags where round_id=%s and student_id=%s", (rid, sid))
    check('אין דגלים לתלמיד שנערך', cur.fetchone()[0] == 0)
    # חזרה לציון המקורי → חוזרים לאותו מצב
    as_user(pick_user)
    cur.execute("select public.bagrut_edit_field(%s, %s, 'grade', %s, %s, 'grade', %s)", (rid, sid, subj, qcode, str(oldg)))
    back()
    cur.execute("select negatives_count, status from bagrut_students where round_id=%s and student_id=%s", (rid, sid))
    check('החזרת הציון המקורי מחזירה את הזכאות', cur.fetchone() == (old_neg, old_status))
    cur.execute("rollback to savepoint edit")

    # ── 4. חסימות
    if homeroom:
        as_user(homeroom[0])
        expect_error('מחנך אינו מעדכן ציון', "select public.bagrut_edit_field(%s, %s, 'grade', %s, %s, 'grade', '90')",
                     (rid, sid, subj, qcode), 'רק מנהל־על ורכז')
        back()
    as_user(pick_user)
    expect_error('סטטוס — מחושב, לא נערך', "select public.bagrut_edit_field(%s, %s, 'student', null, null, 'status', 'זכאי')",
                 (rid, sid), 'מחושבים')
    expect_error('ציון סופי של מקצוע עם שאלונים — מחושב', "select public.bagrut_edit_field(%s, %s, 'subject', %s, null, 'final_grade', '90')",
                 (rid, sid, subj), 'מחושב')
    expect_error('משוקלל — מחושב', "select public.bagrut_edit_field(%s, %s, 'grade', %s, %s, 'weighted', '30')",
                 (rid, sid, subj, qcode), 'מחושב')
    expect_error('ציון 120 נחסם', "select public.bagrut_edit_field(%s, %s, 'grade', %s, %s, 'grade', '120')",
                 (rid, sid, subj, qcode), 'בין 0 ל-100')
    expect_error('"abc" נחסם', "select public.bagrut_edit_field(%s, %s, 'grade', %s, %s, 'grade', 'abc')",
                 (rid, sid, subj, qcode), 'אינו מספר')
    if coord:
        expect_error('רכז אינו מריץ חישוב סבב', "select public.bagrut_recompute_round(%s)", (rid,), 'רק מנהל־על')
        expect_error('רכז אינו קורא לפונקציה פנימית', "select public.bagrut_calc_student(%s, %s)", (rid, sid), 'permission')
    back()

    # ── 5. דגלים: קריאה, סימון, ועדכון ישיר
    cur.execute("select f.id, f.round_id, f.student_id from bagrut_flags f limit 1")
    fl = cur.fetchone()
    if fl:
        cur.execute("savepoint fl")
        as_user(admin)
        cur.execute("select public.bagrut_review_flag(%s, true, 'נבדק מול הקובץ')", (fl[0],))
        r = cur.fetchone()[0]
        check('מנהל־על מסמן דגל כנבדק', r['status'] == 'reviewed' and r['note'] == 'נבדק מול הקובץ')
        cur.execute("update bagrut_flags set status = 'open' where id = %s", (fl[0],))
        check('עדכון ישיר של דגל דרך ה-API — 0 שורות', cur.rowcount == 0, cur.rowcount)
        back()
        # חישוב חוזר שומר את "נבדק" כשהערכים לא השתנו
        cur.execute("select public.bagrut_calc_student(%s, %s)", (fl[1], fl[2]))
        cur.execute("select status from bagrut_flags where id = %s", (fl[0],))
        check('חישוב חוזר שומר "נבדק"', cur.fetchone()[0] == 'reviewed')
        cur.execute("rollback to savepoint fl")
    as_user(admin)
    t0 = time.time()
    cur.execute("select public.bagrut_recompute_round(%s)", (rid,))
    out = cur.fetchone()[0]
    check('מנהל־על מריץ חישוב סבב', out['students'] > 0, f"{out} ב-{time.time() - t0:.1f} שניות")
    back()
    # חישוב שני זהה לראשון (אידמפוטנטי): הסטטוסים לא זזו
    cur.execute("select count(*) from bagrut_students where in_t2 and round_id = %s and public.bagrut_kind_of(t2_original->>'status') <> calc_kind", (rid,))
    check('חישוב חוזר — אותה תוצאה', cur.fetchone()[0] == 0)
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
