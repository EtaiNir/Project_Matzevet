-- מיגרציה 023: קליטת דרג ב' — גנים, לידה עד 3, קידום נוער, חינוך ביתי
--
-- ═══════════════════════════════════════════════════════════════
-- למה טבלה נפרדת, ולא שורות בטבלה הראשית
-- ═══════════════════════════════════════════════════════════════
--
-- `load_main.py` מריץ `truncate table public.students_{code}` בכל עדכון
-- חודשי. ילד גן שהיה יושב שם היה נמחק בעדכון המצב"ת הבא — בשקט, בלי
-- שגיאה, ובלי שאיש ישים לב עד שמישהו יחפש אותו. לכן דרג ב' יושב בטבלה
-- משלו, שאף תהליך אוטומטי אינו נוגע בה.
--
-- ⚠️ **אין מפתח זר** בין הטבלאות, מאותה סיבה בדיוק שתועדה במיגרציה 016:
-- `references students_{code}` היה מפיל את ה-TRUNCATE ומשבית את העדכון
-- החודשי, ו-`TRUNCATE ... CASCADE` היה מרוקן את דרג ב' בשקט — בדיוק
-- הנתונים שהטבלה הזו נועדה להגן עליהם.
--
-- הטבלה נוצרת `like students_{code} including all`, כלומר **אותן עמודות
-- בדיוק**. כך המיזוג בדפדפן הוא שרשור פשוט, וכל שדה שהמשתמש בוחר בבורר
-- השדות עובד על שתי הקבוצות בלי קוד מיוחד.
--
-- ═══════════════════════════════════════════════════════════════
-- סמל יישוב: מקוצר מול ארוך — הסיבה שהמיגרציה הזו נוגעת ב-RLS
-- ═══════════════════════════════════════════════════════════════
--
-- קובץ הגנים של מנשה מגיע עם סמל יישוב **מקוצר** (משמרות = 213), בעוד
-- שהטבלה הראשית מחזיקה את הקוד ה**ארוך** (2139). החפיפה בין שתי
-- הרשימות היא אפס.
--
-- `in_user_scope("SEMEL_YISHUV1", ...)` משווה מול `scope_values` של
-- המשתמש, שנבנו מהקודים הארוכים. טעינה בלי המרה הייתה גורמת לכך שמנהל
-- בהיקף יישובי יראה **אפס ילדי גן** — בלי שגיאה ובלי רמז. ההמרה (ספרת
-- ביקורת Luhn) נעשית ב-`load_tier_b.py` לפני הטעינה, ולא כאן; המיגרציה
-- רק מניחה שהעמודה כבר בקוד הארוך.
--
-- ═══════════════════════════════════════════════════════════════
-- מה עוד משתנה כאן, ולמה
-- ═══════════════════════════════════════════════════════════════
--
-- העמודות שהמשתמש מוסיף והטבלאות הייעודיות שואלות היום
-- `exists (select 1 from students_{code} ...)` — כלומר ילד גן לא היה
-- מקבל עמודות משלו ולא היה יכול להיכנס לרשימת הסעות. גרוע מזה:
-- `mark_extra_orphans` היה מסמן את שורותיו כיתומות, ואחרי 90 יום
-- `extra_cleanup_purge` היה מוחק אותן.
--
-- ארבעת המקומות עוברים לאיחוד של שתי הטבלאות:
--   1. מדיניות students_{code}_extra
--   2. מדיניות students_{code}_view_members
--   3. add_students_to_view
--   4. mark_extra_orphans

-- ═══════════════════════════════════════════════════════════════
-- א. הקבוצות המוכרות של דרג ב'
-- ═══════════════════════════════════════════════════════════════
-- רשימה סגורה. "שלב חינוך" הוא המבחין בין הקבוצות, וכל דרג נדרס
-- בנפרד — קליטת גנים אינה נוגעת בקידום נוער.

create or replace function public.tier_b_groups()
returns text[]
language sql
immutable
as $$
  select array['גנים', 'לידה עד 3', 'קידום נוער', 'חינוך ביתי']::text[];
$$;

comment on function public.tier_b_groups() is
  'הקבוצות המוכרות של דרג ב''. כל קבוצה נדרסת בנפרד בקליטה.';

-- ═══════════════════════════════════════════════════════════════
-- ב. יצירת טבלת דרג ב' לרשות — עצלה ואידמפוטנטית
-- ═══════════════════════════════════════════════════════════════
-- אותו דפוס כמו _ensure_extra_table: הטבלה נוצרת בפעם הראשונה שנדרשת,
-- ולא ב-create_authority ולא ב-ensure_table של הסוכן. שני מסלולי יצירת
-- מועצה מתכנסים לכאן, כך שאי אפשר לקבל מועצה שבה הטבלה חסרה.

create or replace function public._ensure_tier_b_table(target_code text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  tbl  text;
  main text;
  op   text;
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

  -- המדיניות נבנית מחדש בכל קריאה, ולא רק ביצירה — כך שינוי בכללים
  -- מגיע גם לרשויות שהטבלה שלהן כבר קיימת (אותו שיקול כמו במיגרציה 022).
  --
  -- קריאה: בדיוק כמו הטבלה הראשית — שיוך לרשות *וגם* היקף בתוכה.
  execute format('drop policy if exists %I on public.%I', tbl || '_read', tbl);
  execute format(
    'create policy %I on public.%I for select to authenticated
       using (public.has_authority(%L)
              and public.in_user_scope("SEMEL_YISHUV1", "SEMEL_MOSAD"))',
    tbl || '_read', tbl, target_code);

  -- כתיבה: מנהל רשות או מנהל-על בלבד. אותה פונקציה שמגנה על העלאת
  -- מצב"ת (מיגרציה 012) — אותה הרשאה, ולכן אין טעם בכלל שני שיתפצל ממנה.
  -- סבא: "זה צריך להיות רק ברמה של מנהל רשות."
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
  'יוצרת (בעצלתיים) את טבלת דרג ב'' של הרשות ובונה מחדש את המדיניות שלה.';

create or replace function public.ensure_tier_b_table(target_code text)
returns text
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.has_authority(target_code) then
    raise exception 'אין לך גישה לרשות הזו';
  end if;
  return public._ensure_tier_b_table(target_code);
end;
$$;

grant execute on function public.ensure_tier_b_table(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ג. "כל תלמידי הרשות" — הראשית ודרג ב' יחד
-- ═══════════════════════════════════════════════════════════════
-- מחזירה קטע SQL שמשמש בתוך מדיניות ובפונקציות. שלוש עמודות בלבד —
-- המפתח ומה שנדרש לבדיקת ההיקף.
--
-- למה קטע טקסט ולא VIEW: ה-RLS של כל טבלה חלה גם על תת-שאילתה, וזו
-- "ההגנה הכפולה" שתועדה במיגרציה 016. VIEW בבעלות postgres היה עוקף
-- אותה אלא אם כן security_invoker, וזו תלות בגרסה שאין סיבה לקחת.

create or replace function public._all_students_sql(target_code text)
returns text
language sql
immutable
as $$
  select format(
    '(select "MISPAR_ZEHUT", "SEMEL_YISHUV1", "SEMEL_MOSAD" from public.%I
      union all
      select "MISPAR_ZEHUT", "SEMEL_YISHUV1", "SEMEL_MOSAD" from public.%I)',
    'students_' || target_code,
    'students_' || target_code || '_tier_b');
$$;

comment on function public._all_students_sql(text) is
  'קטע SQL: הטבלה הראשית ודרג ב'' יחד. משמש במדיניות ובפונקציות כדי
   שילד גן יקבל עמודות משלי ויוכל להיכנס לטבלה ייעודית.';

-- ═══════════════════════════════════════════════════════════════
-- ד. _ensure_extra_table — עובר לאיחוד
-- ═══════════════════════════════════════════════════════════════
-- מחליפה את הגרסה ממיגרציה 022. ההבדל היחיד: `main` הוחלף באיחוד,
-- ובראש הפונקציה נוצרת טבלת דרג ב' — אחרת האיחוד היה מפנה לטבלה שאינה
-- קיימת, והמדיניות כולה הייתה נשברת.

create or replace function public._ensure_extra_table(target_code text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  tbl     text;
  main    text;
  members text;
  allsrc  text;
  scope   text;
begin
  if target_code !~ '^[0-9]+$' then
    raise exception 'קוד רשות חייב להכיל ספרות בלבד';
  end if;

  tbl     := 'students_' || target_code || '_extra';
  main    := 'students_' || target_code;
  members := 'students_' || target_code || '_view_members';

  if to_regclass('public.' || quote_ident(main)) is null then
    raise exception 'הטבלה הראשית % אינה קיימת', main;
  end if;

  -- חייב לקרות לפני בניית המדיניות: האיחוד מפנה לטבלה הזו.
  perform public._ensure_tier_b_table(target_code);
  allsrc := public._all_students_sql(target_code);

  if to_regclass('public.' || quote_ident(tbl)) is null then
    execute format($f$
      create table public.%I (
        "MISPAR_ZEHUT" text primary key,
        data           jsonb       not null default '{}'::jsonb,
        orphaned_at    timestamptz,
        updated_at     timestamptz not null default now(),
        updated_by     uuid references public.users(id)
      )$f$, tbl);
    execute format('alter table public.%I enable row level security', tbl);
  end if;

  -- ההיקף אינו יכול להיבדק על הטבלה התוספתית עצמה — אין בה סמל יישוב
  -- וסמל מוסד. שכפול שלהם לכאן היה מתיישן ברגע שתלמיד עובר מוסד.
  scope := format(
    'public.has_authority(%L) and exists (
       select 1 from %s s
        where s."MISPAR_ZEHUT" = public.%I."MISPAR_ZEHUT"
          and public.in_user_scope(s."SEMEL_YISHUV1", s."SEMEL_MOSAD"))',
    target_code, allsrc, tbl);

  execute format('drop policy if exists %I on public.%I', tbl || '_read', tbl);
  execute format(
    'create policy %I on public.%I for select to authenticated using (%s)',
    tbl || '_read', tbl, scope);

  execute format('drop policy if exists %I on public.%I', tbl || '_insert', tbl);
  execute format(
    'create policy %I on public.%I for insert to authenticated
       with check (%s and public.may_edit_extra(%L))',
    tbl || '_insert', tbl, scope, target_code);

  execute format('drop policy if exists %I on public.%I', tbl || '_update', tbl);
  execute format(
    'create policy %I on public.%I for update to authenticated
       using (%s and public.may_edit_extra(%L))
       with check (%s and public.may_edit_extra(%L))',
    tbl || '_update', tbl, scope, target_code, scope, target_code);

  -- ⚠️ גם המחיקה. היא נשכחה בגרסה הראשונה של המיגרציה הזו, והתוצאה
  -- הייתה שקטה ומוזרה: אפשר היה ליצור ולערוך ערך תוספתי לילד גן, אבל
  -- לא למחוק אותו — כי מדיניות המחיקה נשארה עם ההיקף הישן, שמכיר רק
  -- את הטבלה הראשית. ארבע המדיניות חייבות לדבר על אותו היקף בדיוק.
  execute format('drop policy if exists %I on public.%I', tbl || '_delete', tbl);
  execute format(
    'create policy %I on public.%I for delete to authenticated
       using (%s and public.may_edit_extra(%L))',
    tbl || '_delete', tbl, scope, target_code);

  -- ── טבלת החברוּת בטבלאות הייעודיות ──
  if to_regclass('public.' || quote_ident(members)) is null then
    execute format($f$
      create table public.%I (
        view_id        uuid not null references public.saved_views(id) on delete cascade,
        "MISPAR_ZEHUT" text not null,
        added_by       uuid references public.users(id) on delete set null,
        added_at       timestamptz not null default now(),
        primary key (view_id, "MISPAR_ZEHUT")
      )$f$, members);

    execute format('create index %I on public.%I (view_id)',
                   members || '_view_idx', members);
    execute format('alter table public.%I enable row level security', members);
  end if;

  scope := format(
    'public.has_authority(%L) and exists (
       select 1 from %s s
        where s."MISPAR_ZEHUT" = public.%I."MISPAR_ZEHUT"
          and public.in_user_scope(s."SEMEL_YISHUV1", s."SEMEL_MOSAD"))',
    target_code, allsrc, members);

  execute format('drop policy if exists %I on public.%I', members || '_read', members);
  execute format(
    'create policy %I on public.%I for select to authenticated using (%s)',
    members || '_read', members, scope);

  execute format('drop policy if exists %I on public.%I', members || '_insert', members);
  execute format(
    'create policy %I on public.%I for insert to authenticated
       with check (%s and public.may_edit_view(view_id))',
    members || '_insert', members, scope);

  execute format('drop policy if exists %I on public.%I', members || '_delete', members);
  execute format(
    'create policy %I on public.%I for delete to authenticated
       using (%s and public.may_edit_view(view_id))',
    members || '_delete', members, scope);

  return tbl;
end;
$$;

comment on function public._ensure_extra_table(text) is
  'יוצרת את הטבלאות הנלוות של הרשות ובונה מחדש את המדיניות שלהן.
   מאז 023 ההיקף נבדק מול הטבלה הראשית *ודרג ב'' יחד.';

-- ═══════════════════════════════════════════════════════════════
-- ה. add_students_to_view — מוסיפה גם ילדי דרג ב'
-- ═══════════════════════════════════════════════════════════════

create or replace function public.add_students_to_view(
  view_uuid uuid,
  ids       text[]
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v       public.saved_views%rowtype;
  members text;
  allsrc  text;
  added   int := 0;
  total   int := 0;
begin
  select * into v from public.saved_views where id = view_uuid;
  if not found then
    raise exception 'הטבלה הייעודית אינה קיימת';
  end if;
  if not public.has_authority(v.authority_code) then
    raise exception 'אין לך גישה לרשות הזו';
  end if;
  if not public.may_edit_view(view_uuid) then
    raise exception 'רק יוצר הרשימה או מי שקיבל הרשאת עריכה יכול להוסיף אליה';
  end if;

  members := 'students_' || v.authority_code || '_view_members';
  if to_regclass('public.' || quote_ident(members)) is null then
    perform public._ensure_extra_table(v.authority_code);
  end if;
  allsrc := public._all_students_sql(v.authority_code);

  -- ההוספה מסוננת דרך הטבלאות עצמן: אי אפשר לתחוב לרשימה ת"ז שאינה
  -- ברשות, גם לא דרך קריאה ישירה ל-API. מאז 023 גם ילד גן עובר.
  execute format(
    'insert into public.%I (view_id, "MISPAR_ZEHUT", added_by)
     select $1, s."MISPAR_ZEHUT", $2
       from %s s
      where s."MISPAR_ZEHUT" = any($3)
     on conflict do nothing',
    members, allsrc)
  using view_uuid, auth.uid(), ids;
  get diagnostics added = row_count;

  execute format('select count(*) from public.%I where view_id = $1', members)
    into total using view_uuid;

  return jsonb_build_object('added', added, 'total', total);
end;
$$;

grant execute on function public.add_students_to_view(uuid, text[]) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ו. mark_extra_orphans — ילד גן אינו יתום
-- ═══════════════════════════════════════════════════════════════
-- זה התיקון הקריטי מבין הארבעה. בלעדיו כל ילד גן שמישהו סימן עליו
-- משהו היה מסומן כיתום בסבב הבא, ואחרי 90 יום extra_cleanup_purge
-- היה מוחק את הסימון — בלי שאיש ביקש ובלי שאיש ידע.

create or replace function public.mark_extra_orphans(target_code text)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  tbl    text;
  allsrc text;
  marked int := 0;
begin
  if target_code !~ '^[0-9]+$' then
    raise exception 'קוד רשות חייב להכיל ספרות בלבד';
  end if;
  if not public.may_manage_extra_columns(target_code) then
    raise exception 'רק מנהל רשות ומעלה רשאי להריץ ניקוי';
  end if;

  tbl := 'students_' || target_code || '_extra';
  if to_regclass('public.' || quote_ident(tbl)) is null
     or to_regclass('public.' || quote_ident('students_' || target_code)) is null then
    return 0;
  end if;

  perform public._ensure_tier_b_table(target_code);
  allsrc := public._all_students_sql(target_code);

  execute format(
    'update public.%I e set orphaned_at = now()
      where e.orphaned_at is null
        and not exists (select 1 from %s s
                         where s."MISPAR_ZEHUT" = e."MISPAR_ZEHUT")', tbl, allsrc);
  get diagnostics marked = row_count;

  -- ומי שחזר — הסימון מתבטל. זה מה שמנטרל טעינה שגויה: בסבב הבא,
  -- כשהנתונים הנכונים חוזרים, השעון מתאפס מעצמו ואיש לא צריך לתקן.
  execute format(
    'update public.%I e set orphaned_at = null
      where e.orphaned_at is not null
        and exists (select 1 from %s s
                     where s."MISPAR_ZEHUT" = e."MISPAR_ZEHUT")', tbl, allsrc);

  return marked;
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- ז. תור ההעלאות של דרג ב'
-- ═══════════════════════════════════════════════════════════════
-- מקביל ל-moe_uploads, ובכוונה **טבלה נפרדת**: הסוכן מריץ עליהן מסלולים
-- שונים לגמרי (pipeline מול pandas+מיפוי), והמצבים אינם זהים — לדרג ב'
-- יש שלב ביניים של אישור המיפוי, שאין לו מקבילה במצב"ת.

create table if not exists public.tier_b_uploads (
  id              uuid primary key default gen_random_uuid(),
  authority_code  text not null references public.authorities(code) on delete cascade,
  source_group    text not null default 'גנים'
                  check (source_group = any (public.tier_b_groups())),
  status          text not null default 'pending'
                  check (status in ('pending', 'mapping', 'awaiting_approval',
                                    'processing', 'done', 'failed')),
  storage_path    text not null,
  file_name       text,
  -- המיפוי שהוצע (ע"י AI או מהזיכרון), והמיפוי שאושר בפועל
  proposed_mapping jsonb,
  approved_mapping jsonb,
  mapping_source  text check (mapping_source in ('ai', 'saved', 'manual')),
  uploaded_by     uuid references public.users(id) on delete set null,
  uploaded_at     timestamptz not null default now(),
  processed_at    timestamptz,
  rows_loaded     int,
  rows_rejected   int,
  report          jsonb,
  error_message   text
);

create index if not exists tier_b_uploads_pending_idx
  on public.tier_b_uploads (authority_code, status, uploaded_at desc);

comment on table public.tier_b_uploads is
  'תור קליטת קבצי דרג ב''. נפרד מ-moe_uploads: מסלול עיבוד שונה,
   ושלב ביניים של אישור מיפוי שאין לו מקבילה במצב"ת.';

alter table public.tier_b_uploads enable row level security;

drop policy if exists tier_b_uploads_read on public.tier_b_uploads;
create policy tier_b_uploads_read on public.tier_b_uploads
  for select to authenticated
  using (public.is_super_admin() or public.has_authority(authority_code));

drop policy if exists tier_b_uploads_insert on public.tier_b_uploads;
create policy tier_b_uploads_insert on public.tier_b_uploads
  for insert to authenticated
  with check (public.may_update_moe(authority_code));

-- העדכון נדרש כדי לאשר מיפוי מהממשק. הסוכן עובד בחיבור ישיר ועוקף RLS.
drop policy if exists tier_b_uploads_update on public.tier_b_uploads;
create policy tier_b_uploads_update on public.tier_b_uploads
  for update to authenticated
  using (public.may_update_moe(authority_code))
  with check (public.may_update_moe(authority_code));

-- ═══════════════════════════════════════════════════════════════
-- ח. מיפוי שנשמר לכל רשות — כדי שה-AI ייקרא פעם אחת ולא כל חודש
-- ═══════════════════════════════════════════════════════════════
-- המפתח הוא טביעת אצבע של שורת הכותרת. אותן כותרות בחודש הבא = אותו
-- מיפוי, בלי קריאת API, ובלי סיכוי שהמודול יחליט משהו אחר בפעם השנייה.

create table if not exists public.tier_b_mappings (
  id              uuid primary key default gen_random_uuid(),
  authority_code  text not null references public.authorities(code) on delete cascade,
  source_group    text not null,
  headers_hash    text not null,
  headers         text[] not null,
  mapping         jsonb not null,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  used_at         timestamptz,
  use_count       int not null default 0
);

create unique index if not exists tier_b_mappings_uniq
  on public.tier_b_mappings (authority_code, source_group, headers_hash);

comment on table public.tier_b_mappings is
  'מיפוי כותרות→שדות שאושר, לפי טביעת אצבע של שורת הכותרת.
   קובץ באותן כותרות נקלט בחודש הבא בלי קריאת AI.';

alter table public.tier_b_mappings enable row level security;

drop policy if exists tier_b_mappings_read on public.tier_b_mappings;
create policy tier_b_mappings_read on public.tier_b_mappings
  for select to authenticated
  using (public.is_super_admin() or public.has_authority(authority_code));

drop policy if exists tier_b_mappings_write on public.tier_b_mappings;
create policy tier_b_mappings_write on public.tier_b_mappings
  for all to authenticated
  using (public.may_update_moe(authority_code))
  with check (public.may_update_moe(authority_code));

-- ═══════════════════════════════════════════════════════════════
-- ט. מחיקת מועצה גוררת גם את דרג ב'
-- ═══════════════════════════════════════════════════════════════
-- בלי זה נשארת טבלה יתומה עם תעודות זהות של קטינים — בדיוק התרחיש
-- שמיגרציה 013 באה למנוע.

create or replace function public.drop_tier_b_table(target_code text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if target_code !~ '^[0-9]+$' then
    raise exception 'קוד רשות חייב להכיל ספרות בלבד';
  end if;
  execute format('drop table if exists public.%I',
                 'students_' || target_code || '_tier_b');
end;
$$;

comment on function public.drop_tier_b_table(text) is
  'נקראת מ-delete_authority. טבלה יתומה עם ת"ז של קטינים לא נשארת מאחור.';

-- delete_authority — מוחקת גם את טבלת דרג ב'.
-- מחליפה את הגרסה ממיגרציה 017. שני שינויים בלבד: בדיקת "עסוק" מכירה
-- גם בקליטת דרג ב' שבאמצע, והמחיקה גוררת את הטבלה הרביעית.
-- `tier_b_uploads` ו-`tier_b_mappings` נגררות מעצמן — `on delete cascade`
-- על authority_code.

create or replace function public.delete_authority(
  target_code  text,
  confirm_name text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  auth_row      public.authorities%rowtype;
  tbl           text;
  student_rows  bigint := 0;
  tier_b_rows   bigint := 0;
  users_touched int    := 0;
  uploads_count int    := 0;
  docs_count    int    := 0;
  busy          int    := 0;
begin
  if not public.is_super_admin() then
    raise exception 'נדרשת הרשאת מנהל־על';
  end if;

  if target_code !~ '^[0-9]+$' then
    raise exception 'קוד רשות חייב להכיל ספרות בלבד';
  end if;

  select * into auth_row from public.authorities where code = target_code;
  if not found then
    raise exception 'רשות בקוד % אינה קיימת', target_code;
  end if;

  if target_code = public.template_authority_code() then
    raise exception
      'אי אפשר למחוק את % — טבלת התלמידים שלה היא התבנית שממנה נבנית כל מועצה חדשה',
      auth_row.name;
  end if;

  select count(*) into busy
    from public.moe_uploads
   where authority_code = target_code
     and status in ('pending', 'processing');
  if busy > 0 then
    raise exception 'יש עדכון מצב"ת בעיבוד עבור %. יש להמתין לסיומו לפני המחיקה', auth_row.name;
  end if;

  select count(*) into busy
    from public.tier_b_uploads
   where authority_code = target_code
     and status in ('pending', 'mapping', 'awaiting_approval', 'processing');
  if busy > 0 then
    raise exception 'יש קליטת דרג ב'' בעיבוד עבור %. יש להמתין לסיומה לפני המחיקה', auth_row.name;
  end if;

  if confirm_name is distinct from auth_row.name then
    raise exception 'שם האישור אינו תואם. יש להקליד בדיוק: %', auth_row.name;
  end if;

  tbl := 'students_' || target_code;

  if to_regclass('public.' || quote_ident(tbl)) is not null then
    execute format('select count(*) from public.%I', tbl) into student_rows;
  end if;
  if to_regclass('public.' || quote_ident(tbl || '_tier_b')) is not null then
    execute format('select count(*) from public.%I', tbl || '_tier_b') into tier_b_rows;
  end if;

  select count(*) into uploads_count
    from public.moe_uploads where authority_code = target_code;
  select count(*) into docs_count
    from public.client_documents where authority_code = target_code;

  update public.users
     set authority_codes = array_remove(authority_codes, target_code)
   where target_code = any(authority_codes);
  get diagnostics users_touched = row_count;

  execute format('drop table if exists public.%I', tbl);
  execute format('drop table if exists public.%I', tbl || '_extra');
  execute format('drop table if exists public.%I', tbl || '_view_members');
  perform public.drop_tier_b_table(target_code);

  delete from public.authorities where code = target_code;

  return jsonb_build_object(
    'code',     target_code,
    'name',     auth_row.name,
    'students', student_rows,
    'tier_b',   tier_b_rows,
    'users',    users_touched,
    'uploads',  uploads_count,
    'documents', docs_count
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- י. החלה על הרשויות הקיימות
-- ═══════════════════════════════════════════════════════════════
-- הטבלאות הנלוות של רשויות קיימות נבנו עם המדיניות הישנה, שמכירה רק
-- את הטבלה הראשית. הרצה אחת מיישרת את כולן.

do $$
declare
  a record;
begin
  for a in select code from public.authorities loop
    if to_regclass('public.' || quote_ident('students_' || a.code)) is not null then
      perform public._ensure_tier_b_table(a.code);
      -- רק לרשויות שכבר יש להן טבלאות נלוות — אין סיבה ליצור אותן כאן
      if to_regclass('public.' || quote_ident('students_' || a.code || '_extra')) is not null then
        perform public._ensure_extra_table(a.code);
      end if;
    end if;
  end loop;
end $$;
