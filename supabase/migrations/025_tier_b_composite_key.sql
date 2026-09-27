-- מיגרציה 025: ילד יכול להיות ביותר מקבוצה אחת של דרג ב'
--
-- ═══════════════════════════════════════════════════════════════
-- הבעיה
-- ═══════════════════════════════════════════════════════════════
-- `students_{code}_tier_b` נוצרה כ-`like students_{code} including all`,
-- ולכן ירשה מפתח ראשי על `MISPAR_ZEHUT` בלבד.
--
-- כל עוד נקלטה קבוצה אחת (גנים) זה לא הורגש. אבל הקליטה עושה
-- `delete where source_group = X` ואז `insert` — כלומר קליטת «לידה עד 3»
-- אינה מוחקת את שורות הגנים, ואם אותו ילד מופיע בשתיהן (בן 3 בגבול
-- המעבר, או ילד בחינוך ביתי שרשום גם לגן) ההכנסה נופלת על הפרת מפתח
-- ו**כל הקובץ השני נדחה**, כי הטעינה היא טרנזקציה אחת.
--
-- ═══════════════════════════════════════════════════════════════
-- ההכרעה
-- ═══════════════════════════════════════════════════════════════
-- מפתח מורכב `(MISPAR_ZEHUT, source_group)`: ילד **יכול** להימצא בשתי
-- קבוצות במקביל, וכל קבוצה נדרסת בנפרד. זה תואם לעיקרון "עדיף להשאיר
-- תלמיד במערכת מאשר למחוק אותו" — שתי הרשומות מתארות שני דברים שונים,
-- בדיוק כמו ילד שמופיע גם בקובץ הגנים וגם במצב"ת אחרי ששובץ לכיתה א'.
--
-- ⚠️ מה שזה **לא** פותר: `students_{code}_extra` ממופתחת בת"ז בלבד,
-- ולכן ילד בשתי קבוצות מחזיק **ערכים תוספתיים משותפים** לשתיהן. זה
-- כנראה הרצוי (זה אותו ילד), אבל זו החלטה ולא מקריות.
--
-- הכפילויות עצמן אינן מוסתרות: `lib/computed.ts` מסמן כל ילד שמופיע
-- ביותר ממקור אחד, ומסך «כפילויות» מציג אותם.

create or replace function public._ensure_tier_b_table(target_code text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  tbl  text;
  main text;
  op   text;
  pk   text;
begin
  if target_code !~ '^[0-9]+$' then
    raise exception 'קוד רשות חייב להכיל ספרות בלבד';
  end if;

  tbl  := 'students_' || target_code || '_tier_b';
  main := 'students_' || target_code;

  if to_regclass('public.' || quote_ident(main)) is null then
    raise exception 'הטבלה הראשית % אינה קיימת', main;
  end if;

  if to_regclass('public.' || quote_ident(tbl)) is null then
    -- אותן עמודות בדיוק כמו הטבלה הראשית — כך המיזוג בדפדפן הוא שרשור,
    -- וכל שדה בבורר השדות עובד על שתי הקבוצות בלי קוד מיוחד.
    execute format('create table public.%I (like public.%I including all)', tbl, main);

    execute format($f$
      alter table public.%I
        add column source_group text not null default 'גנים'
            check (source_group = any (public.tier_b_groups())),
        add column tier_b_uploaded_at timestamptz not null default now(),
        add column tier_b_upload_id   uuid
    $f$, tbl);

    execute format('create index %I on public.%I (source_group)',
                   tbl || '_group_idx', tbl);

    execute format('alter table public.%I enable row level security', tbl);
  end if;

  -- ── המפתח הראשי: ת"ז + קבוצה ──
  -- אידמפוטנטי: רץ גם על טבלה קיימת שנוצרה עם מפתח על ת"ז בלבד.
  select con.conname into pk
    from pg_constraint con
   where con.conrelid = ('public.' || quote_ident(tbl))::regclass
     and con.contype = 'p';

  if pk is not null and (
       select count(*) <> 2
         from unnest((select conkey from pg_constraint where conname = pk
                        and conrelid = ('public.' || quote_ident(tbl))::regclass)))
  then
    execute format('alter table public.%I drop constraint %I', tbl, pk);
    pk := null;
  end if;

  if pk is null then
    execute format('alter table public.%I add primary key ("MISPAR_ZEHUT", source_group)', tbl);
  end if;

  -- המדיניות נבנית מחדש בכל קריאה, ולא רק ביצירה — כך שינוי בכללים
  -- מגיע גם לרשויות שהטבלה שלהן כבר קיימת (אותו שיקול כמו במיגרציה 022).
  execute format('drop policy if exists %I on public.%I', tbl || '_read', tbl);
  execute format(
    'create policy %I on public.%I for select to authenticated
       using (public.has_authority(%L)
              and public.in_user_scope("SEMEL_YISHUV1", "SEMEL_MOSAD"))',
    tbl || '_read', tbl, target_code);

  foreach op in array array['insert', 'update', 'delete'] loop
    execute format('drop policy if exists %I on public.%I',
                   tbl || '_' || op, tbl);
  end loop;

  execute format(
    'create policy %I on public.%I for insert to authenticated
       with check (public.may_update_moe(%L))',
    tbl || '_insert', tbl, target_code);

  execute format(
    'create policy %I on public.%I for update to authenticated
       using (public.may_update_moe(%L)) with check (public.may_update_moe(%L))',
    tbl || '_update', tbl, target_code, target_code);

  execute format(
    'create policy %I on public.%I for delete to authenticated
       using (public.may_update_moe(%L))',
    tbl || '_delete', tbl, target_code);

  return tbl;
end;
$$;

comment on function public._ensure_tier_b_table(text) is
  'יוצרת (בעצלתיים) את טבלת דרג ב'' של הרשות, מוודאת מפתח (ת"ז, קבוצה),
   ובונה מחדש את המדיניות שלה.';

-- החלה על הרשויות הקיימות
do $$
declare
  a record;
begin
  for a in select code from public.authorities loop
    if to_regclass('public.' || quote_ident('students_' || a.code)) is not null then
      perform public._ensure_tier_b_table(a.code);
    end if;
  end loop;
end $$;
