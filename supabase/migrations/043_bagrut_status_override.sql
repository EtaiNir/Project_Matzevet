-- ═══════════════════════════════════════════════════════════════
-- 043 — שינוי ידני של סטטוס הזכאות של תלמיד
-- ═══════════════════════════════════════════════════════════════
-- אייל, 21.10: מנהל־על ורכז/ת בגרויות (כולל מנהל/ת בית ספר) רשאים לשנות סטטוס
-- של תלמיד מזכאי ללא זכאי ולהפך, וכל מה שנגזר ממנו מחושב מחדש — אחוזי הזכאות
-- של השכבה ובית הספר, בגרות טק ומצטיינת. ההחלטה: decisions/022.
--
-- איך:
--   · ניתוח הזכאות (bagrut_students) **אינו משתנה**. השינוי נשמר בטבלה נפרדת,
--     והמסך מחיל אותו מעל — כך המקור נשאר, ואפשר לחזור אליו בכל רגע.
--   · הטבלה היא יומן: כל שינוי שורה חדשה, והתקף — האחרונה לכל תלמיד. kind ריק =
--     "חזרה לניתוח הזכאות". אין עדכון ואין מחיקה — מי, מתי, ולמה נשמרים לתמיד.
--   · כל מה שנגזר מהסטטוס נספר בדפדפן מהתלמידים (תמונת המצב, הסרגל, המצטיינת/טק,
--     הרשימות, הייצוא, האזור האישי) — ולכן מתעדכן מעצמו, בלי עותק שמתיישן.
--   · **השינוי נמחק בקליטת הסבב הבא** (cascade עם הסבב) — הקבצים החדשים הם ניתוח
--     חדש. כך גם עם העריכות של 038.
--   · כתיבה רק דרך bagrut_set_status (security definer) — אין מדיניות כתיבה.
-- נבדק לפני החלה: scripts/apply_043.py, בטרנזקציה שמגולגלת לאחור.

create table if not exists public.bagrut_status_overrides (
  id          uuid primary key default gen_random_uuid(),
  round_id    uuid not null references public.bagrut_rounds(id) on delete cascade,
  student_id  text not null,
  -- null = ביטול השינוי, חזרה למה שקבע ניתוח הזכאות
  kind        text check (kind in ('eligible', 'not_eligible')),
  reason      text,
  -- מלכודת 24: on delete set null; האימייל משוכפל כדי לשרוד מחיקת משתמש
  set_by       uuid references public.users(id) on delete set null,
  set_by_email text,
  -- clock_timestamp ולא now(): שני שינויים באותה טרנזקציה — עדיין בסדר הנכון
  set_at       timestamptz not null default clock_timestamp(),
  check (kind is null or nullif(btrim(reason), '') is not null)
);

create index if not exists bagrut_status_overrides_student_idx
  on public.bagrut_status_overrides (round_id, student_id, set_at);

alter table public.bagrut_status_overrides enable row level security;

-- קריאה: מי שרואה את התלמיד. ה-RLS של bagrut_students חל בתוך תת-השאילתה.
drop policy if exists bagrut_status_overrides_read on public.bagrut_status_overrides;
create policy bagrut_status_overrides_read on public.bagrut_status_overrides for select to authenticated
  using (exists (select 1 from public.bagrut_students s
                 where s.round_id = bagrut_status_overrides.round_id
                   and s.student_id = bagrut_status_overrides.student_id));

-- ── מי רשאי: מנהל־על, ורכז/ת בגרויות בתלמידים שהוא רואה. לא רכז שכבה, לא רכז
-- מקצוע, לא מחנך, לא צפייה מועצתית.
create or replace function public.may_override_bagrut_status(p_round uuid, p_student text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select not u.is_suspended
       and (u.role = 'super_admin'
            or (u.bagrut_role = 'coordinator'
                and exists (select 1 from bagrut_students s
                             where s.round_id = p_round and s.student_id = p_student
                               and has_authority(s.authority_code)
                               and bagrut_student_visible(p_round, p_student, s.school_code, s.grade, s.class_name, s.track))))
    from users u where u.id = auth.uid()), false);
$$;

-- ── השינוי עצמו. p_kind ריק = חזרה לניתוח הזכאות.
create or replace function public.bagrut_set_status(p_round uuid, p_student text, p_kind text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_kind   text := nullif(btrim(coalesce(p_kind, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_in_t2  boolean;
  v_cur    text;
  v_cur_reason text;
  v_email  text;
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
  -- אותו מצב ואותה סיבה — אין מה לרשום ("חזרה" כשאין שינוי בתוקף, או אותו שינוי שוב)
  if v_cur is not distinct from v_kind and (v_kind is null or v_cur_reason is not distinct from v_reason) then
    return jsonb_build_object('changed', false);
  end if;

  select email into v_email from users where id = auth.uid();
  insert into bagrut_status_overrides (round_id, student_id, kind, reason, set_by, set_by_email)
  values (p_round, p_student, v_kind, v_reason, auth.uid(), v_email)
  returning * into v_row;
  return jsonb_build_object('changed', true) || (to_jsonb(v_row) - 'set_by');
end $$;

revoke all on function public.may_override_bagrut_status(uuid, text) from public, anon;
grant execute on function public.may_override_bagrut_status(uuid, text) to authenticated;
revoke all on function public.bagrut_set_status(uuid, text, text, text) from public, anon;
grant execute on function public.bagrut_set_status(uuid, text, text, text) to authenticated;
