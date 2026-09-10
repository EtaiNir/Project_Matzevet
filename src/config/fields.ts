import { useSyncExternalStore } from 'react'

// הגדרת כל השדות במערכת — מקור אמת אחד לתוויות בעברית, סוגים וקבוצות.
// המפתח (key) הוא שם העמודה במסד הנתונים (Supabase), התווית (label) היא הטקסט המוצג.
// נגזר מ-columns_name_dictionary.xlsx של ה-pipeline (python_name ↔ access_name).

export type FieldType = 'text' | 'number' | 'date' | 'boolean'

export type FieldGroup =
  | 'פרטים אישיים'
  | 'מוסד'
  | 'כיתה ומגמה'
  | 'כתובת'
  | 'שיבוץ וסטטוס'
  | 'הורים'
  | 'נתונים תוספתיים'

export interface FieldDef {
  /** שם העמודה במסד הנתונים */
  key: string
  /** תווית בעברית להצגה */
  label: string
  /** סוג השדה — קובע אילו אופרטורי סינון זמינים */
  type: FieldType
  /** קבוצה לוגית — לארגון כרטיס התלמיד */
  group: FieldGroup
  /** שדה מחושב שנוצר בעיבוד (pipeline), לא מגיע ישירות ממשרד החינוך */
  computed?: boolean
  /** עמודה שהמשתמש הוסיף (extra_columns). ניתנת לעריכה, ואינה מגיעה ממצב"ת */
  extra?: boolean
}

// שדות מחושבים (אפיון §4) — מגיעים מפלט ה-pipeline; הלוגיקה המלאה מטופלת בשלב ג'.
const COMPUTED_FIELDS: FieldDef[] = [
  { key: 'KITA_MESHULEVET', label: 'כיתה (משולב)', type: 'text', group: 'כיתה ומגמה', computed: true },
  { key: 'STATUS_CHINUCH_MEYUCHAD', label: 'סטטוס חינוך מיוחד', type: 'text', group: 'שיבוץ וסטטוס', computed: true },
  { key: 'STATUS_TALMID_BARASHUT', label: 'סטטוס תלמיד ברשות', type: 'text', group: 'שיבוץ וסטטוס', computed: true },
  // הקוד המספרי של המסלול. מודול 7 מחליף אותו בתיאור, והוא משוחזר
  // בתצוגה מהמיפוי ההפוך — ראה lib/computed.ts.
  { key: 'SEMEL_MASLUL', label: 'סמל מסלול', type: 'text', group: 'כיתה ומגמה', computed: true },
]

// שדות מקור ממשרד החינוך (מיוצר מהמילון).
const SOURCE_FIELDS: FieldDef[] = [
  { key: 'MISPAR_ZEHUT', label: 'מספר זהות', type: 'text', group: 'פרטים אישיים' },
  { key: 'SHEM_MISHPACHA', label: 'שם משפחה', type: 'text', group: 'פרטים אישיים' },
  { key: 'SHEM_PRATI', label: 'שם פרטי', type: 'text', group: 'פרטים אישיים' },
  { key: 'CODE_MIN', label: 'מין', type: 'text', group: 'פרטים אישיים' },
  { key: 'TAARICH_LEDA', label: 'תאריך לידה', type: 'date', group: 'פרטים אישיים' },
  { key: 'SUG_ZEHUT', label: 'סוג זהות', type: 'text', group: 'פרטים אישיים' },
  { key: 'MISPAR_DARKON', label: 'מספר דרכון', type: 'text', group: 'פרטים אישיים' },
  { key: 'KVUTSAT_DARKON', label: 'קבוצת דרכון', type: 'text', group: 'פרטים אישיים' },
  { key: 'SHEM_MISHPACHA_KINUI', label: 'שם משפחה כינוי', type: 'text', group: 'פרטים אישיים' },
  { key: 'SHEM_PRATI_KINUI', label: 'שם פרטי כינוי', type: 'text', group: 'פרטים אישיים' },
  { key: 'CODE_LEOM_PNIM', label: 'לאום משרד הפנים', type: 'text', group: 'פרטים אישיים' },
  { key: 'CODE_ERETS_LEDA', label: 'שם ארץ לידה', type: 'text', group: 'פרטים אישיים' },
  { key: 'CODE_ERETS_ALIYA', label: 'שם ארץ עליה', type: 'text', group: 'פרטים אישיים' },
  { key: 'TAARICH_ALIYA', label: 'תאריך עליה', type: 'date', group: 'פרטים אישיים' },
  { key: 'MISPAR_ACHIM_AD_18', label: 'מספר אחים עד 18', type: 'number', group: 'פרטים אישיים' },
  { key: 'TAARICH_CHAZARA_MCHUL', label: 'תאריך חזרה מחול', type: 'date', group: 'פרטים אישיים' },
  { key: 'SHNOT_LIMUD_BCHUL', label: 'שנות לימוד בחול', type: 'number', group: 'פרטים אישיים' },
  { key: 'MISPAR_ZEHUT_KODEMET', label: 'מספר זהות קודם', type: 'text', group: 'פרטים אישיים' },
  { key: 'SUG_ZEHUT_KODEMET', label: 'סוג זהות קודמת', type: 'text', group: 'פרטים אישיים' },
  { key: 'TAARICH_IDKUN_RESHUMA', label: 'תאריך עדכון מקסימלי', type: 'date', group: 'פרטים אישיים' },
  { key: 'HAIM_PIRTEY_KESHER_TALMID', label: 'האם פרטי קשר תלמיד', type: 'text', group: 'פרטים אישיים' },

  { key: 'SEMEL_MOSAD', label: 'סמל מוסד', type: 'text', group: 'מוסד' },
  { key: 'SHEM_MOSAD', label: 'שם מוסד', type: 'text', group: 'מוסד' },
  { key: 'MUTAV', label: 'סמל מוטב', type: 'text', group: 'מוסד' },
  { key: 'RASHUT_CHINUCH_MOSAD', label: 'סמל רשות חינוך', type: 'text', group: 'מוסד' },
  { key: 'RASHUT_CHINUCH_TEUR', label: 'שם רשות חינוך', type: 'text', group: 'מוסד' },
  { key: 'SUG_MOSAD_TEUR', label: 'סוג מסגרת', type: 'text', group: 'מוסד' },
  { key: 'SHEM_YISHUV', label: 'ישוב מוסד', type: 'text', group: 'מוסד' },
  { key: 'KTOVET_MOSAD', label: 'כתובת מוסד', type: 'text', group: 'מוסד' },
  { key: 'TELEFON_MOSAD', label: 'טלפון מוסד', type: 'text', group: 'מוסד' },
  { key: 'GOREM_MEDAVEACH_TEUR', label: 'גורם מדווח תאור', type: 'text', group: 'מוסד' },
  { key: 'MIGZAR_TEUR', label: 'מגזר', type: 'text', group: 'מוסד' },
  { key: 'MAAMAD_MISHPATI_TEUR', label: 'מעמד משפטי תאור', type: 'text', group: 'מוסד' },
  { key: 'SUG_PIKUACH_TEUR', label: 'סוג פיקוח תאור', type: 'text', group: 'מוסד' },
  { key: 'SUG_CHINUCH_TEUR', label: 'סוג חינוך תאור', type: 'text', group: 'מוסד' },
  { key: 'SHLAV_HINUCH_TEUR', label: 'שלבי חינוך מוסד', type: 'text', group: 'מוסד' },
  { key: 'SHNAT_LIMUDIM', label: 'שנת לימודים', type: 'text', group: 'מוסד' },

  { key: 'SHICHVA', label: 'שכבה', type: 'text', group: 'כיתה ומגמה' },
  { key: 'MAKBILA', label: 'מקבילה', type: 'text', group: 'כיתה ומגמה' },
  { key: 'CODE_SUG_KITA', label: 'קוד סוג כיתה', type: 'text', group: 'כיתה ומגמה' },
  { key: 'TEUR_SUG_KITA', label: 'סוג כיתה', type: 'text', group: 'כיתה ומגמה' },
  { key: 'TEUR_STATUS_ISHUR', label: 'סטטוס אישור כיתה', type: 'text', group: 'כיתה ומגמה' },
  { key: 'TAARICH_STATUS_ISHUR_KITA', label: 'תאריך סטטוס אישור כיתה', type: 'date', group: 'כיתה ומגמה' },
  { key: 'MIN_TALMIDIM', label: 'מינימום תלמידים בכיתה', type: 'number', group: 'כיתה ומגמה' },
  { key: 'MAX_TALMIDIM', label: 'מקסימום תלמידים בכיתה', type: 'number', group: 'כיתה ומגמה' },
  { key: 'CODE_MASLUL', label: 'מסלול', type: 'text', group: 'כיתה ומגמה' },
  { key: 'CODE_NATIV', label: 'נתיב', type: 'text', group: 'כיתה ומגמה' },
  { key: 'CODE_HASMACHA', label: 'הסמכה', type: 'text', group: 'כיתה ומגמה' },
  { key: 'SEMEL_MEGAMA_MISRAD_x', label: 'סמל מגמה משרד', type: 'text', group: 'כיתה ומגמה' },
  { key: 'TEUR_MEGAMA_MISRAD', label: 'תאור מגמה משרד', type: 'text', group: 'כיתה ומגמה' },
  { key: 'SEMEL_MEGAMA_MOSAD', label: 'סמל מגמה מוסד', type: 'text', group: 'כיתה ומגמה' },
  { key: 'SHEM_MEGAMA_MOSAD', label: 'תאור מגמה מוסד', type: 'text', group: 'כיתה ומגמה' },
  { key: 'MICHSAT_TALMIDIM_MEVUKESHET', label: 'מכסת תלמידים מבוקשת', type: 'number', group: 'כיתה ומגמה' },
  { key: 'TEUR_STATUS_ISHUR_MEGAMA', label: 'סטטוס אישור מגמה', type: 'text', group: 'כיתה ומגמה' },

  { key: 'RASHUT_TALMID', label: 'סמל רשות מגורים תלמיד', type: 'text', group: 'שיבוץ וסטטוס' },
  { key: 'CODE_STATUS_RISHUM_TA', label: 'תקינות שיבוץ', type: 'text', group: 'שיבוץ וסטטוס' },
  { key: 'TKINUT_SHIBUTZ', label: 'תקינות שיבוץ (תאור)', type: 'text', group: 'שיבוץ וסטטוס' },
  { key: 'LO_LE_DIVUACH_MATZEVET', label: 'לא לדווח מצבת', type: 'text', group: 'שיבוץ וסטטוס' },
  { key: 'CODE_ZAKAUT_LSCHAR_LIMUD', label: 'קוד זכאות לשכר לימוד', type: 'text', group: 'שיבוץ וסטטוס' },
  { key: 'HAIM_RASHUT_ACHERET', label: 'האם רשות אחרת תאור', type: 'text', group: 'שיבוץ וסטטוס' },
  { key: 'TEUR_SIBAT_AZIVA', label: 'סיבת עזיבה', type: 'text', group: 'שיבוץ וסטטוס' },
  { key: 'PIRUT_AZIVA', label: 'פירוט עזיבה', type: 'text', group: 'שיבוץ וסטטוס' },
  { key: 'TAARICH_HATCHALA', label: 'תאריך תחילת שיבוץ', type: 'date', group: 'שיבוץ וסטטוס' },
  { key: 'TAARICH_SIYUM', label: 'תאריך סיום שיבוץ', type: 'date', group: 'שיבוץ וסטטוס' },

  { key: 'SEMEL_YISHUV1', label: 'סמל ישוב 1ת', type: 'text', group: 'כתובת' },
  { key: 'TEUR_YISHUV1', label: 'תאור ישוב 1ת', type: 'text', group: 'כתובת' },
  { key: 'SHEM_RECHOV1', label: 'שם רחוב 1ת', type: 'text', group: 'כתובת' },
  { key: 'MISPAR_BAYIT1', label: 'מספר בית 1ת', type: 'text', group: 'כתובת' },
  { key: 'MISPAR_DIRA1', label: 'מספר דירה 1ת', type: 'text', group: 'כתובת' },
  { key: 'SEMEL_YESHUV2', label: 'סמל ישוב 2ת', type: 'text', group: 'כתובת' },
  { key: 'TEUR_YESHUV2', label: 'תאור ישוב 2ת', type: 'text', group: 'כתובת' },
  { key: 'SHEM_RECHOV2', label: 'שם רחוב 2ת', type: 'text', group: 'כתובת' },
  { key: 'MISPAR_BAIT2', label: 'מספר בית 2ת', type: 'text', group: 'כתובת' },
  { key: 'KNISA2', label: 'כניסה 2ת', type: 'text', group: 'כתובת' },
  { key: 'MISPAR_DIRA2', label: 'מספר דירה 2ת', type: 'text', group: 'כתובת' },
  { key: 'TA_DOAR2', label: 'תא דואר 2ת', type: 'text', group: 'כתובת' },
  { key: 'MIKUD2', label: 'מיקוד 2ת', type: 'text', group: 'כתובת' },
  { key: 'SHCHUNA2', label: 'שכונה 2ת', type: 'text', group: 'כתובת' },
  { key: 'HEARA2', label: 'הערה 2ת', type: 'text', group: 'כתובת' },
  { key: 'DOAR_NA2', label: 'דואר נע 2ת', type: 'text', group: 'כתובת' },

  { key: 'GOREM_KESHER_1_ID', label: 'ת.ז. הורה 1', type: 'text', group: 'הורים' },
  { key: 'GOREM_KESHER_1_FULL_NAME', label: 'שם הורה 1', type: 'text', group: 'הורים' },
  { key: 'GOREM_KESHER_1_CODE_MAAMAD_HORE', label: 'מעמד הורה 1', type: 'text', group: 'הורים' },
  { key: 'GOREM_KESHER_1_CODE_SUG_KIRVA', label: 'קרבה הורה 1', type: 'text', group: 'הורים' },
  { key: 'GOREM_KESHER_1_SUG_ZEHUT', label: 'סוג זהות הורה 1', type: 'text', group: 'הורים' },
  { key: 'GOREM_KESHER_1_LEKABEL_MEIDA', label: 'האם לקבל מידע 1', type: 'text', group: 'הורים' },
  { key: 'GOREM_KESHER_1_HAIM_MESHALEM', label: 'האם משלם 1', type: 'text', group: 'הורים' },
  { key: 'EMAIL_parent1', label: 'מייל הורה 1', type: 'text', group: 'הורים' },
  { key: 'TEUR_YISHUV1_parent1', label: 'ישוב הורה 1', type: 'text', group: 'הורים' },
  { key: 'SHEM_RECHOV1_parent1', label: 'רחוב הורה 1', type: 'text', group: 'הורים' },
  { key: 'MISPAR_BAYIT1_parent1', label: 'מספר בית הורה 1', type: 'text', group: 'הורים' },
  { key: 'MISPAR_DIRA1_parent1', label: 'מספר דירה הורה 1', type: 'text', group: 'הורים' },
  { key: 'MIKUD7_parent1', label: 'מיקוד הורה 1', type: 'text', group: 'הורים' },
  { key: 'HAIM_PIRTEY_KESHER_TALMID_parent1', label: 'האם פרטי קשר תלמיד (הורה 1)', type: 'text', group: 'הורים' },

  { key: 'GOREM_KESHER_2_ID', label: 'ת.ז. הורה 2', type: 'text', group: 'הורים' },
  { key: 'GOREM_KESHER_2_FULL_NAME', label: 'שם הורה 2', type: 'text', group: 'הורים' },
  { key: 'GOREM_KESHER_2_CODE_MAAMAD_HORE', label: 'מעמד הורה 2', type: 'text', group: 'הורים' },
  { key: 'GOREM_KESHER_2_CODE_SUG_KIRVA', label: 'קרבה הורה 2', type: 'text', group: 'הורים' },
  { key: 'GOREM_KESHER_2_SUG_ZEHUT', label: 'סוג זהות הורה 2', type: 'text', group: 'הורים' },
  { key: 'GOREM_KESHER_2_LEKABEL_MEIDA', label: 'האם לקבל מידע 2', type: 'text', group: 'הורים' },
  { key: 'GOREM_KESHER_2_HAIM_MESHALEM', label: 'האם משלם 2', type: 'text', group: 'הורים' },
  { key: 'TEUR_YESHUV2_parent2', label: 'ישוב הורה 2', type: 'text', group: 'הורים' },
  { key: 'SHEM_RECHOV2_parent2', label: 'רחוב הורה 2', type: 'text', group: 'הורים' },
  { key: 'MISPAR_BAIT2_parent2', label: 'מספר בית הורה 2', type: 'text', group: 'הורים' },
  { key: 'MISPAR_DIRA2_parent2', label: 'מספר דירה הורה 2', type: 'text', group: 'הורים' },
  { key: 'MIKUD7_parent2', label: 'מיקוד מרשם הורה 2', type: 'text', group: 'הורים' },
  { key: 'MIKUD2_parent2', label: 'מיקוד הורה 2', type: 'text', group: 'הורים' },
  { key: 'SHCHUNA2_parent2', label: 'שכונה הורה 2', type: 'text', group: 'הורים' },
  { key: 'KNISA2_parent2', label: 'כניסה הורה 2', type: 'text', group: 'הורים' },
  { key: 'TA_DOAR2_parent2', label: 'תא דואר הורה 2', type: 'text', group: 'הורים' },
  { key: 'HEARA2_parent2', label: 'הערה הורה 2', type: 'text', group: 'הורים' },
  { key: 'DOAR_NA2_parent2', label: 'דואר נע הורה 2', type: 'text', group: 'הורים' },

  // --- מצב רישום התלמיד (מיגרציה 003) ---
  // מקור: CODE_STATUS_RISHUM_TA של משרד החינוך. הטבלה מכילה גם תלמידים שאינם
  // "משובץ" (עזב / מועמד / נרשם), ואפשר לצמצם אליהם או להוציאם דרך סינון.
  { key: 'MATZAV_RISHUM_TEUR', label: 'מצב רישום', type: 'text', group: 'שיבוץ וסטטוס' },
  { key: 'MATZAV_RISHUM_CODE', label: 'קוד מצב רישום', type: 'text', group: 'שיבוץ וסטטוס' },

  // --- טלפונים ומייל של התלמיד (מיגרציה 003) ---
  { key: 'NAYAD_1_talmid', label: 'נייד 1 תלמיד', type: 'text', group: 'פרטים אישיים' },
  { key: 'NAYAD_2_talmid', label: 'נייד 2 תלמיד', type: 'text', group: 'פרטים אישיים' },
  { key: 'NAYACH_1_talmid', label: 'נייח 1 תלמיד', type: 'text', group: 'פרטים אישיים' },
  { key: 'NAYACH_2_talmid', label: 'נייח 2 תלמיד', type: 'text', group: 'פרטים אישיים' },
  { key: 'EMAIL_talmid', label: 'מייל תלמיד', type: 'text', group: 'פרטים אישיים' },

  // --- טלפונים של ההורים (מיגרציה 003) ---
  { key: 'NAYAD_1_parent1', label: 'נייד 1 הורה 1', type: 'text', group: 'הורים' },
  { key: 'NAYAD_2_parent1', label: 'נייד 2 הורה 1', type: 'text', group: 'הורים' },
  { key: 'NAYACH_1_parent1', label: 'נייח 1 הורה 1', type: 'text', group: 'הורים' },
  { key: 'NAYACH_2_parent1', label: 'נייח 2 הורה 1', type: 'text', group: 'הורים' },
  { key: 'NAYAD_1_parent2', label: 'נייד 1 הורה 2', type: 'text', group: 'הורים' },
  { key: 'NAYAD_2_parent2', label: 'נייד 2 הורה 2', type: 'text', group: 'הורים' },
  { key: 'NAYACH_1_parent2', label: 'נייח 1 הורה 2', type: 'text', group: 'הורים' },
  { key: 'NAYACH_2_parent2', label: 'נייח 2 הורה 2', type: 'text', group: 'הורים' },
  { key: 'EMAIL_parent2', label: 'מייל הורה 2', type: 'text', group: 'הורים' },

  // --- כתובת מרשם של ההורים (מיגרציה 003) ---
  { key: 'YISHUV_MIRSHAM_parent1', label: 'ישוב מרשם הורה 1', type: 'text', group: 'הורים' },
  { key: 'RECHOV_MIRSHAM_parent1', label: 'רחוב מרשם הורה 1', type: 'text', group: 'הורים' },
  { key: 'MISPAR_BAYIT_MIRSHAM_parent1', label: 'מספר בית מרשם הורה 1', type: 'text', group: 'הורים' },
  { key: 'YISHUV_MIRSHAM_parent2', label: 'ישוב מרשם הורה 2', type: 'text', group: 'הורים' },
  { key: 'RECHOV_MIRSHAM_parent2', label: 'רחוב מרשם הורה 2', type: 'text', group: 'הורים' },
  { key: 'MISPAR_BAYIT_MIRSHAM_parent2', label: 'מספר בית מרשם הורה 2', type: 'text', group: 'הורים' },

  // --- שדות כלליים שנוספו למילון (מיגרציה 003) ---
  { key: 'SHEM_RASHUT_MEGURIM_TALMID', label: 'שם רשות מגורים תלמיד', type: 'text', group: 'כתובת' },
  { key: 'SHEM_MUTAV', label: 'שם מוטב', type: 'text', group: 'מוסד' },
  { key: 'TEUR_ZAKAUT_LSCHAR_LIMUD', label: 'זכאות לשכר לימוד', type: 'text', group: 'שיבוץ וסטטוס' },
  { key: 'HAIM_LESHIBUTZ_TEUR', label: 'האם לשיבוץ', type: 'text', group: 'שיבוץ וסטטוס' },
]

/** מזהה ראשי — תעודת זהות התלמיד (אפיון §3). */
export const PRIMARY_KEY = 'MISPAR_ZEHUT'

/** ת.ז. של גורמי קשר (הורים) — משמש לפונקציית זיהוי אחים (אפיון §5, תצורה 2). */
export const PARENT_ID_FIELDS = ['GOREM_KESHER_1_ID', 'GOREM_KESHER_2_ID'] as const

/** הקבוצה שאליה משויכות כל העמודות שהמשתמש הוסיף. */
export const EXTRA_GROUP: FieldGroup = 'נתונים תוספתיים'

/** שדות המקור והמחושבים — קבועים, ידועים בזמן בנייה. */
const BASE_FIELDS: FieldDef[] = [...COMPUTED_FIELDS, ...SOURCE_FIELDS]

function buildMap(fields: FieldDef[]): Record<string, FieldDef> {
  return Object.fromEntries(fields.map((f) => [f.key, f]))
}

// ─────────────────── רישום העמודות שהמשתמש הוסיף ───────────────────
//
// העמודות התוספתיות אינן ידועות בזמן בנייה — הן נטענות מהמסד לפי רשות.
// אחת-עשרה נקודות בקוד קוראות ל-getField / fieldLabel / ALL_FIELDS,
// והעברת רשימה דינמית דרך context הייתה נוגעת בכולן. במקום זה — רישום
// ברמת המודול, באותו דפוס של המטמון ב-lib/students.ts.
//
// ALL_FIELDS הוא `export let` ולא `const`: ב-ES modules הייבוא הוא
// binding חי, ולכן כל מי שמייבא אותו רואה את הערך המעודכן בלי לשנות
// שורה. מי שצריך גם *להתרנדר מחדש* כשהרשימה משתנה — משתמש
// ב-useFieldsVersion() ומכניס אותו ל-deps.

let extraFields: FieldDef[] = []
let version = 0
const listeners = new Set<() => void>()

export let ALL_FIELDS: FieldDef[] = BASE_FIELDS
let FIELD_MAP: Record<string, FieldDef> = buildMap(BASE_FIELDS)

function rebuild(): void {
  ALL_FIELDS = extraFields.length ? [...BASE_FIELDS, ...extraFields] : BASE_FIELDS
  FIELD_MAP = buildMap(ALL_FIELDS)
  version += 1
  listeners.forEach((notify) => notify())
}

/** מחליף את העמודות התוספתיות הרשומות. נקרא בכל החלפת רשות. */
export function registerExtraFields(defs: FieldDef[]): void {
  extraFields = defs.map((d) => ({ ...d, extra: true, group: EXTRA_GROUP }))
  rebuild()
}

export function clearExtraFields(): void {
  if (extraFields.length === 0) return
  extraFields = []
  rebuild()
}

export function useFieldsVersion(): number {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify)
      return () => {
        listeners.delete(notify)
      }
    },
    () => version,
    () => version,
  )
}

/**
 * הגדרת שדה לפי מפתח.
 *
 * מחזיר undefined לשדה שאינו רשום — למשל עמודה תוספתית שנמחקה ומופיעה
 * עדיין ב-fields של מסך שמור. כל המנועים נופלים במקרה כזה ל-'text',
 * כלומר מסך ישן אינו קורס אלא רק מתעלם מהעמודה. אם העמודה תשוחזר
 * מסל הגריעה — היא תחזור לשם מעצמה.
 */
export function getField(key: string): FieldDef | undefined {
  return FIELD_MAP[key]
}

export function fieldLabel(key: string): string {
  return FIELD_MAP[key]?.label ?? key
}

/** קבוצת שדות מקובצת לפי FieldGroup — לשימוש בכרטיס התלמיד. */
export const FIELD_ORDER: readonly FieldGroup[] = [
  'פרטים אישיים',
  'מוסד',
  'כיתה ומגמה',
  'כתובת',
  'הורים',
  'שיבוץ וסטטוס',
  EXTRA_GROUP,
]
