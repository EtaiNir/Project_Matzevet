-- ═══════════════════════════════════════════════════════════════
-- 038 — עריכה ידנית של נתוני הבגרות (משימה 7, פגישת 14.10)
-- ═══════════════════════════════════════════════════════════════
-- צוות בית הספר מתקן ידנית שדה בנתוני הסבב: ציון שאלון, מדדי מקצוע, או
-- שדה בניתוח הזכאות. סבא: "זה אחריות של בית הספר לעשות את השינויים בצורה
-- אחראית". אחרי תיקון, ניתוח ה-AI של התלמיד קורא את הנתונים החדשים.
--
-- ההחלטות (18.10):
--   · עורכים: רכז בגרויות, רכז שכבה, רכז מקצוע — **רק במקצועות שלו**, ומנהל־על.
--     לא מחנך, ולא צפייה מועצתית (נשארת צפייה בלבד).
--   · נכתבה כ-037 בענף bagrut-t2-fields; שונתה ל-038 במיזוג, כי 037 (היקף מאוחד —
--     אדם אחד בכמה תפקידים) כבר הוחלה. may_edit_bagrut_data הותאמה לה: ההרשאה
--     נגזרת ממה שסומן (שכבות / מקצועות), לא מתפקיד אחד.
--   · גם שדות ניתוח הזכאות (סטטוס, חסמים, התערבות…) — לא רק ציונים. ⚠️ זה מרכך
--     את "זכאות נקבעת רק לפי T2" (014 §8): הקוד וה-AI עדיין אינם מחשבים זכאות,
--     אבל **אדם מבית הספר** רשאי לתקן את מה ש-T2 אמר. כל תיקון מסומן במסך.
--
-- ═══════════════════════════════════════════════════════════════
-- איך
-- ═══════════════════════════════════════════════════════════════
--   · אין מדיניות UPDATE חדשה על טבלאות הסבב. העריכה עוברת **רק** בפונקציה
--     bagrut_edit_field (security definer), עם רשימה סגורה של שדות — כך אי
--     אפשר לשנות ת"ז, כיתה או שכבה (ההיקף נבנה מהן) ולא עמודה שלא תוכננה.
--   · כל עריכה נרשמת ב-bagrut_manual_edits: מי, מתי, מה היה ומה נהיה. המסך
--     מסמן לפיה שדה שנערך.
--   · **העריכה נמחקת בקליטת הסבב הבא** — הקליטה מוחקת את שורת הסבב (cascade)
--     וטוענת מחדש. bagrut_manual_edits יורשת את אותו cascade, כך שגם הסימון
--     נעלם. זה מכוון: הקבצים של סבא הם המקור.
--   · עריכה של ערך זהה לקיים אינה נרשמת.
--
-- נבדק? ⚠️ טרם הוחל ולא נבדק במסד — נכתב בלי גישה למסד. לפני החלה: בטרנזקציה
-- שמגולגלת לאחור, כמשתמש מאומת (מלכודת 26), לבדוק את התרחישים בסוף הקובץ.

-- ── 1. יומן העריכות
create table if not exists public.bagrut_manual_edits (
  id                 uuid primary key default gen_random_uuid(),
  round_id           uuid not null references public.bagrut_rounds(id) on delete cascade,
  student_id         text not null,
  -- איזו טבלה: student = bagrut_students · subject = bagrut_subjects · grade = bagrut_grades
  target             text not null check (target in ('student', 'subject', 'grade')),
  subject_key        text,
  questionnaire_code integer,
  field              text not null,
  old_value          text,
  new_value          text,
  -- מלכודת 24: on delete set null, לא cascade ולא ברירת המחדל שחוסמת מחיקת משתמש
  edited_by          uuid references public.users(id) on delete set null,
  -- משוכפל בכוונה — שורד את מחיקת העורך (כמו admin_audit)
  edited_by_email    text,
  edited_at          timestamptz not null default now(),
  check ((target = 'student' and subject_key is null and questionnaire_code is null)
      or (target = 'subject' and subject_key is not null and questionnaire_code is null)
      or (target = 'grade'   and subject_key is not null and questionnaire_code is not null))
);

create index if not exists bagrut_manual_edits_student_idx
  on public.bagrut_manual_edits (round_id, student_id);

alter table public.bagrut_manual_edits enable row level security;

-- קריאה: מי שרואה את התלמיד. ה-RLS של bagrut_students חל בתוך תת-השאילתה —
-- אותו דפוס כמו bagrut_grades (026). אין מדיניות כתיבה בכלל: רק דרך הפונקציה.
drop policy if exists bagrut_manual_edits_read on public.bagrut_manual_edits;
create policy bagrut_manual_edits_read on public.bagrut_manual_edits for select to authenticated
  using (exists (select 1 from public.bagrut_students s
                 where s.round_id = bagrut_manual_edits.round_id
                   and s.student_id = bagrut_manual_edits.student_id));

-- ── 2. מי רשאי לערוך — p_subject ריק = שדה של התלמיד (ניתוח הזכאות)
create or replace function public.may_edit_bagrut_data(p_round uuid, p_student text, p_subject text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- מותאם להיקף המאוחד של 037 (אדם אחד בכמה תפקידים): לא לפי תפקיד אחד, אלא
  -- לפי מה שסומן. רכז בגרויות — כל תלמיד שהוא רואה. שכבות שסומנו — כל שדה של
  -- תלמיד בשכבה. מקצועות שסומנו — רק שדה של מקצוע שלו (לא ניתוח הזכאות).
  -- כיתות (מחנך) — לא מוסיפות עריכה. מועצתי — לא עורך.
  select coalesce((
    select not u.is_suspended
       and (u.role = 'super_admin'
            or exists (
                 select 1 from public.bagrut_students s
                  where s.round_id = p_round
                    and s.student_id = p_student
                    and public.has_authority(s.authority_code)
                    and public.bagrut_student_visible(p_round, p_student, s.school_code,
                                                      s.grade, s.class_name, s.track)
                    and (u.bagrut_role = 'coordinator'
                         or (u.bagrut_role in ('grade_coordinator', 'subject_coordinator', 'homeroom')
                             and (coalesce(s.grade = any(u.bagrut_grades), false)
                                  or (p_subject is not null
                                      and p_subject = any(coalesce(u.bagrut_subject_keys, '{}'))))))))
    from public.users u
    where u.id = auth.uid()), false);
$$;

revoke all on function public.may_edit_bagrut_data(uuid, text, text) from public, anon;
grant execute on function public.may_edit_bagrut_data(uuid, text, text) to authenticated;

-- ── 3. העריכה עצמה
create or replace function public.bagrut_edit_field(
  p_round uuid, p_student text, p_target text, p_subject text, p_questionnaire integer,
  p_field text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_type  text;   -- text / numeric / integer
  v_where text;
  v_old   text;
  v_new   text := nullif(btrim(coalesce(p_value, '')), '');  -- תא ריק נשאר ריק
  v_rows  integer;
  v_email text;
begin
  -- רשימה סגורה: איזה שדה, באיזו טבלה, מאיזה סוג
  if p_target = 'student' then
    v_table := 'bagrut_students';
    v_type := case p_field
      when 'status' then 'text' when 'done_summary' then 'text' when 'grades_summary' then 'text'
      when 'blockers' then 'text' when 'intervention' then 'text' when 'one_negative_option' then 'text'
      when 'compensation_pair' then 'text' when 'compensation_eligible' then 'text'
      when 'mother_tongue_status' then 'text' when 'reinforced_subject' then 'text'
      when 'total_units' then 'text' when 'reason' then 'text'
      when 'negatives_count' then 'integer' when 'core_units' then 'numeric'
    end;
    if p_subject is not null or p_questionnaire is not null then v_type := null; end if;
    v_where := 'round_id = $2 and student_id = $3';
  elsif p_target = 'subject' then
    v_table := 'bagrut_subjects';
    v_type := case p_field
      when 'final_grade' then 'numeric' when 'cumulative_grade' then 'numeric' when 'units' then 'numeric'
      when 'cumulative_weight' then 'numeric' when 'completion_status' then 'text'
    end;
    if p_subject is null or p_questionnaire is not null then v_type := null; end if;
    v_where := 'round_id = $2 and student_id = $3 and subject_key = $4';
  elsif p_target = 'grade' then
    v_table := 'bagrut_grades';
    v_type := case p_field when 'grade' then 'numeric' when 'weight' then 'numeric' when 'weighted' then 'numeric' end;
    if p_subject is null or p_questionnaire is null then v_type := null; end if;
    v_where := 'round_id = $2 and student_id = $3 and subject_key = $4 and questionnaire_code = $5';
  end if;
  if v_type is null then
    raise exception 'השדה אינו ניתן לעריכה: % / %', p_target, p_field;
  end if;

  if not public.may_edit_bagrut_data(p_round, p_student, case when p_target = 'student' then null else p_subject end) then
    raise exception 'אין לך הרשאה לערוך את הנתון הזה';
  end if;

  -- ערך מספרי — לבדוק לפני העדכון, בהודעה קריאה ולא שגיאת המרה של המסד
  if v_new is not null and v_type <> 'text' then
    begin
      if v_type = 'integer' then perform v_new::integer; else perform v_new::numeric; end if;
    exception when others then
      raise exception 'הערך "%" אינו מספר', v_new;
    end;
  end if;

  execute format('select %I::text from public.%I where ' || v_where, p_field, v_table)
    into v_old using null, p_round, p_student, p_subject, p_questionnaire;
  -- ⚠️ EXECUTE אינו מעדכן את FOUND — ושדה ריק נראה בדיוק כמו שורה חסרה. ROW_COUNT כן.
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'הנתון לא נמצא בסבב הזה';
  end if;
  -- אותו ערך — אין מה לרשום (השוואה כמספר בשדה מספרי: "70" = "70.0")
  if (v_type = 'text' and v_old is not distinct from v_new)
     or (v_type <> 'text' and v_old::numeric is not distinct from v_new::numeric) then
    return jsonb_build_object('changed', false, 'value', v_old);
  end if;

  execute format('update public.%I set %I = $1::%s where ' || v_where, v_table, p_field, v_type)
    using v_new, p_round, p_student, p_subject, p_questionnaire;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'העדכון נכשל (% שורות)', v_rows;
  end if;

  select email into v_email from public.users where id = auth.uid();
  insert into public.bagrut_manual_edits
    (round_id, student_id, target, subject_key, questionnaire_code, field, old_value, new_value, edited_by, edited_by_email)
  values
    (p_round, p_student, p_target,
     case when p_target = 'student' then null else p_subject end,
     case when p_target = 'grade' then p_questionnaire end,
     p_field, v_old, v_new, auth.uid(), v_email);

  return jsonb_build_object('changed', true, 'value', v_new, 'old', v_old,
                            'edited_by_email', v_email, 'edited_at', now());
end;
$$;

revoke all on function public.bagrut_edit_field(uuid, text, text, text, integer, text, text) from public, anon;
grant execute on function public.bagrut_edit_field(uuid, text, text, text, integer, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- בדיקה לפני החלה (בטרנזקציה שמגולגלת לאחור, כמשתמש מאומת — מלכודת 26):
--   1. רכז בגרויות: עורך ציון שאלון ו"חסמים לזכאות" → changed=true, שורה ביומן
--   2. רכז מקצוע: עורך ציון במקצוע שלו → מותר; במקצוע אחר → "אין לך הרשאה";
--      "חסמים" → "אין לך הרשאה"
--   3. מחנך / צפייה מועצתית → "אין לך הרשאה"
--   4. שדה שאינו ברשימה (class_name, student_id) → "השדה אינו ניתן לעריכה"
--   5. "abc" בשדה מספרי → "הערך אינו מספר"; ערך ריק → null
--   6. delete from bagrut_rounds where id = … → גם השורות ב-bagrut_manual_edits נמחקות
--   7. ניסיון insert/update ישיר ל-bagrut_manual_edits דרך ה-API → נחסם
--      (insert זורק; update/delete — 0 שורות, מלכודת 21)
-- ═══════════════════════════════════════════════════════════════
