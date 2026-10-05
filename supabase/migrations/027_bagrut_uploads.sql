-- מיגרציה 027: תור קליטת סבבי בגרות — כמו moe_uploads, לא כמו דרג ב'
--
-- ═══════════════════════════════════════════════════════════════
-- למה בדפוס של המצב"ת ולא של הגנים
-- ═══════════════════════════════════════════════════════════════
--
-- בגנים כל רשות שולחת קובץ אחר, ולכן יש שם מיפוי שדות (AI) ואישור אדם
-- באמצע (awaiting_approval). סבב בגרות מגיע **במבנה קבוע וידוע מראש** —
-- T1, T2 והמצפן — בדיוק כמו ששת קובצי המצב"ת. לכן: העלאה → pending →
-- הסוכן מעבד (בדיקה ואז טעינה) → done / failed. בלי שלב ביניים.
--
-- מה שהבדיקה מוצאת (משקלים שאינם 100%, שאלונים יתומים) **אינו עוצר**
-- את הטעינה: הוא נשמר ב-report ומוצג בהיסטוריה. מה שעוצר הוא רק מה
-- שהיה טוען נתונים שגויים — סמל מוסד שאינו תואם, קובץ חסר, קלט ריק.
-- ראה docs/decisions/014.
--
-- הקבצים עצמם בבאקט moe-uploads, בנתיב {code}/bagrut/{stamp}/. שמות
-- הקבצים בבאקט הם לפי תפקיד (details.xlsx, t1_11.xlsx…) — Storage פוסל
-- עברית (מלכודת 31), והשם המקורי נשמר ב-files.

create table if not exists public.bagrut_uploads (
  id              uuid primary key default gen_random_uuid(),
  authority_code  text not null references public.authorities(code) on delete cascade,
  school_code     text not null,
  season          text not null check (season in ('קיץ', 'חורף')),
  school_year     text not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'processing', 'done', 'failed')),
  storage_prefix  text not null,
  file_count      int,
  -- תפקיד → שם הקובץ המקורי, למשל {"t1_11": "זכאות 11 - ….xlsx"}
  files           jsonb not null default '{}',
  uploaded_by     uuid references public.users(id) on delete set null,   -- מלכודת 24
  uploaded_at     timestamptz not null default now(),
  processed_at    timestamptz,
  round_id        uuid references public.bagrut_rounds(id) on delete set null,
  rows_loaded     int,             -- תלמידים שנטענו
  report          jsonb,           -- ספירות + אזהרות מהבדיקה
  error_message   text
);

create index if not exists bagrut_uploads_queue_idx
  on public.bagrut_uploads (status, uploaded_at);
create index if not exists bagrut_uploads_authority_idx
  on public.bagrut_uploads (authority_code, uploaded_at desc);

comment on table public.bagrut_uploads is
  'תור קליטת סבבי בגרות (T1 + T2 + מצפן). הסוכן מעבד pending → done/failed,
   בלי שלב אישור — המבנה קבוע. אזהרות נשמרות ב-report ואינן עוצרות.';

alter table public.bagrut_uploads enable row level security;

-- קריאה: מי שרואה את בית הספר במודול. העלאה: מנהל-על (בהמשך — רכז בגרויות).
-- עדכון ומחיקה: אין מהדפדפן — הסוכן עובד בחיבור ישיר ועוקף RLS. ארבע
-- המדיניות מוגדרות במפורש (מלכודת 28), גם אלה שסוגרות.
drop policy if exists bagrut_uploads_read   on public.bagrut_uploads;
drop policy if exists bagrut_uploads_insert on public.bagrut_uploads;
drop policy if exists bagrut_uploads_update on public.bagrut_uploads;
drop policy if exists bagrut_uploads_delete on public.bagrut_uploads;

create policy bagrut_uploads_read on public.bagrut_uploads for select to authenticated
  using (public.is_super_admin()
         or (public.has_authority(authority_code) and public.bagrut_school_visible(school_code)));
create policy bagrut_uploads_insert on public.bagrut_uploads for insert to authenticated
  with check (public.is_super_admin());
create policy bagrut_uploads_update on public.bagrut_uploads for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy bagrut_uploads_delete on public.bagrut_uploads for delete to authenticated
  using (public.is_super_admin());
