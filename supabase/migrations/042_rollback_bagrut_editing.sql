-- ═══════════════════════════════════════════════════════════════
-- 042 — ביטול עריכת הציונים: מנוע הזכאות (041) והעריכה הידנית (038)
-- ═══════════════════════════════════════════════════════════════
-- אייל, 20.10: "אני רוצה לגלגל אחורה את כל העניין של עריכת הציונים" — כולל
-- העריכה הידנית מ-18.10. אחרי המיגרציה הזו אין עריכה של נתוני הבגרות באתר בכלל:
-- המסכים מציגים את עיבוד הציונים ואת ניתוח הזכאות כפי שהגיעו בקבצים (014 §8).
-- ההחלטות 018 ו-021 — בוטלו; הקוד שלהן נשאר בהיסטוריה של git.
--
-- הסדר חשוב:
--   1. הנתונים חוזרים למקור — לפני שהעמודות שמחזיקות אותו נמחקות:
--      ניתוח הזכאות מ-t2_original, מדדי המקצוע מ-t1_original, וכל ציון / משקל /
--      שדה שנערך ידנית — לערך שהיה לפני העריכה הראשונה (old_value הראשון ביומן).
--   2. הפונקציות, הטבלאות והעמודות של 038 ו-041 נמחקות.
-- נבדק לפני החלה: scripts/apply_042.py, בטרנזקציה שמגולגלת לאחור.

-- ── 1א. ניתוח הזכאות — כפי שהגיע (041 דרס את העמודות)
update public.bagrut_students set
  status               = t2_original->>'status',
  total_units          = t2_original->>'total_units',
  core_units           = (t2_original->>'core_units')::numeric,
  negatives_count      = (t2_original->>'negatives_count')::integer,
  blockers             = t2_original->>'blockers',
  intervention         = t2_original->>'intervention',
  one_negative_option  = t2_original->>'one_negative_option',
  compensation_pair    = t2_original->>'compensation_pair',
  mother_tongue_status = t2_original->>'mother_tongue_status',
  reinforced_subject   = t2_original->>'reinforced_subject',
  done_summary         = t2_original->>'done_summary',
  grades_summary       = t2_original->>'grades_summary'
where t2_original is not null;

-- ── 1ב. מדדי המקצוע — כפי שהגיעו בעיבוד הציונים
update public.bagrut_subjects set
  final_grade       = (t1_original->>'final_grade')::numeric,
  cumulative_grade  = (t1_original->>'cumulative_grade')::numeric,
  cumulative_weight = (t1_original->>'cumulative_weight')::numeric,
  completion_status = t1_original->>'completion_status'
where t1_original is not null;

-- ── 1ג. כל עריכה ידנית — חזרה לערך שלפני העריכה הראשונה של אותו שדה. ציון שאלון
-- שנערך: גם המשוקלל חוזר (041 חישב אותו מחדש).
do $$
declare
  e record;
begin
  for e in
    select distinct on (round_id, student_id, target, coalesce(subject_key, ''), coalesce(questionnaire_code, -1), field)
           round_id, student_id, target, subject_key, questionnaire_code, field, old_value
      from public.bagrut_manual_edits
     order by round_id, student_id, target, coalesce(subject_key, ''), coalesce(questionnaire_code, -1), field, edited_at
  loop
    if e.target = 'grade' then
      execute format('update public.bagrut_grades set %I = $1::numeric
                       where round_id = $2 and student_id = $3 and subject_key = $4 and questionnaire_code = $5', e.field)
        using e.old_value, e.round_id, e.student_id, e.subject_key, e.questionnaire_code;
      update public.bagrut_grades
         set weighted = case when grade is not null and weight is not null then round(grade * weight, 2) end
       where round_id = e.round_id and student_id = e.student_id
         and subject_key = e.subject_key and questionnaire_code = e.questionnaire_code
         and e.field in ('grade', 'weight');
    elsif e.target = 'subject' then
      execute format('update public.bagrut_subjects set %I = $1::%s
                       where round_id = $2 and student_id = $3 and subject_key = $4',
                     e.field, case when e.field = 'completion_status' then 'text' else 'numeric' end)
        using e.old_value, e.round_id, e.student_id, e.subject_key;
    else
      execute format('update public.bagrut_students set %I = $1::%s where round_id = $2 and student_id = $3',
                     e.field, case e.field when 'negatives_count' then 'integer' when 'core_units' then 'numeric' else 'text' end)
        using e.old_value, e.round_id, e.student_id;
    end if;
  end loop;
end $$;

-- ── 2. הפונקציות
drop function if exists public.bagrut_edit_field(uuid, text, text, text, integer, text, text);
drop function if exists public.bagrut_review_flag(uuid, boolean, text);
drop function if exists public.bagrut_recompute_round(uuid);
drop function if exists public.bagrut_calc_student(uuid, text);
drop function if exists public.bagrut_calc_flags(uuid, text);
drop function if exists public.bagrut_flag_candidates(uuid, text);
drop function if exists public.bagrut_calc_honors(uuid, text);
drop function if exists public.bagrut_calc_eligibility(uuid, text);
drop function if exists public.bagrut_calc_subject(uuid, text, text);
drop function if exists public.may_edit_bagrut_grades(uuid, text);
drop function if exists public.may_edit_bagrut_data(uuid, text, text);
drop function if exists public.bagrut_comp_threshold(numeric, numeric);
drop function if exists public.bagrut_blocker_kinds(text);
drop function if exists public.bagrut_kind_of(text);
drop function if exists public.bagrut_try_num(text);
drop function if exists public.bagrut_num(numeric);
drop function if exists public.bagrut_base_of_extended(text);
drop function if exists public.bagrut_family(text);
drop function if exists public.bagrut_norm(text);

-- ── 3. הטבלאות
drop table if exists public.bagrut_flags;
drop table if exists public.bagrut_manual_edits;

-- ── 4. העמודות של 041
alter table public.bagrut_students
  drop column if exists t2_original,
  drop column if exists calc_at,
  drop column if exists calc_kind,
  drop column if exists core_required,
  drop column if exists honors_english,
  drop column if exists honors_math,
  drop column if exists honors_sci_tech,
  drop column if exists honors_average,
  drop column if exists honors_average_units,
  drop column if exists honors_excellence,
  drop column if exists honors_tech,
  drop column if exists honors_tech_no_english;

alter table public.bagrut_subjects
  drop column if exists t1_original,
  drop column if exists calc_completion;
