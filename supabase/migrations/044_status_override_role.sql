-- ═══════════════════════════════════════════════════════════════
-- 044 — שינוי סטטוס ע"י מנהל־על: "שונה ע"י מנהל על", בלי כתובת מייל
-- ═══════════════════════════════════════════════════════════════
-- אייל, 21.10: כשמנהל־על משנה סטטוס זכאות — המסך כותב "שונה ע"י מנהל על" ולא
-- את המייל שלו. ההסתרה במסד, לא רק במסך: היומן נקרא ע"י כל מי שרואה את
-- התלמיד (043), ומייל שנשמר — נחשף לו דרך ה-API.
--
--   · set_by_role — 'super_admin' / 'coordinator', נקבע בפונקציה מהמשתמש עצמו.
--   · מנהל־על: set_by_email נשאר ריק. set_by (המזהה) נשמר — מי שינה ידוע למנהלי
--     העל, ולא למי שקורא את היומן.
--   · רכז/ת בגרויות: כמו עד היום — המייל נשמר ומוצג.
--   · שורות קיימות: set_by_role מתמלא לפי המשתמש. המייל שבהן אינו נמחק כאן
--     (שינוי ביומן קיים — החלטה נפרדת); המסך אינו מציג מייל של מנהל־על.
-- נבדק לפני החלה: scripts/apply_044.py.

alter table public.bagrut_status_overrides
  add column if not exists set_by_role text check (set_by_role in ('super_admin', 'coordinator'));

update public.bagrut_status_overrides o
   set set_by_role = case when u.role = 'super_admin' then 'super_admin' else 'coordinator' end
  from public.users u
 where u.id = o.set_by and o.set_by_role is null;

create or replace function public.bagrut_set_status(p_round uuid, p_student text, p_kind text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_kind   text := nullif(btrim(coalesce(p_kind, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_in_t2  boolean;
  v_cur    text;
  v_cur_reason text;
  v_email  text;
  v_role   text;
  v_row    bagrut_status_overrides;
begin
  if v_kind is not null and v_kind not in ('eligible', 'not_eligible') then
    raise exception 'סטטוס לא מוכר: %', v_kind;
  end if;
  if not may_override_bagrut_status(p_round, p_student) then
    raise exception 'רק מנהל־על ורכז/ת הבגרויות רשאים לשנות סטטוס זכאות';
  end if;
  select in_t2 into v_in_t2 from bagrut_students where round_id = p_round and student_id = p_student;
  if not coalesce(v_in_t2, false) then
    raise exception 'לתלמיד אין ניתוח זכאות — הסטטוס נקבע רק לשכבה המסיימת';
  end if;
  if v_kind is not null and v_reason is null then
    raise exception 'יש לכתוב סיבה לשינוי הסטטוס';
  end if;

  -- השינוי שבתוקף (אין שורה = ניתוח הזכאות, כמו kind ריק)
  select kind, reason into v_cur, v_cur_reason from bagrut_status_overrides
   where round_id = p_round and student_id = p_student order by set_at desc, id desc limit 1;
  -- אותו מצב ואותה סיבה — אין מה לרשום
  if v_cur is not distinct from v_kind and (v_kind is null or v_cur_reason is not distinct from v_reason) then
    return jsonb_build_object('changed', false);
  end if;

  -- מנהל־על — בלי מייל (044); רכז/ת — עם מייל, כמו ב-043
  select case when role = 'super_admin' then 'super_admin' else 'coordinator' end,
         case when role = 'super_admin' then null else email end
    into v_role, v_email
    from users where id = auth.uid();
  insert into bagrut_status_overrides (round_id, student_id, kind, reason, set_by, set_by_email, set_by_role)
  values (p_round, p_student, v_kind, v_reason, auth.uid(), v_email, v_role)
  returning * into v_row;
  return jsonb_build_object('changed', true) || (to_jsonb(v_row) - 'set_by');
end $$;

revoke all on function public.bagrut_set_status(uuid, text, text, text) from public, anon;
grant execute on function public.bagrut_set_status(uuid, text, text, text) to authenticated;
