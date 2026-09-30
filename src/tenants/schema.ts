/**
 * Единственный источник правды по данным студии.
 *
 * Файл `tenants/<slug>/studio.json` валидируется этой схемой. Из неё же
 * выводится всё остальное: манифест PWA, роут `/s/<slug>`, настройки
 * установки, стартовый посев базы.
 *
 * Владелец может менять эти поля из кабинета — тогда они перезаписывают
 * значения из файла (см. `mergeTenantConfig`).
 */
import {z} from 'zod';

const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время должно быть в формате ЧЧ:ММ');

/** 0 = воскресенье … 6 = суббота (как `Date.prototype.getDay`). */
export const dayOfWeekSchema = z.number().int().min(0).max(6);

/** Режим работы студии в конкретный день недели. */
export const workingHoursSchema = z
  .object({
    day: dayOfWeekSchema,
    /** null = выходной. */
    open: timeString.nullable(),
    close: timeString.nullable(),
  })
  .refine(
    (v) => (v.open === null) === (v.close === null),
    'open и close должны быть оба заданы или оба null',
  )
  .refine(
    // close здесь ещё nullable — сравнивать можно только когда оба заданы.
    (v) => v.open === null || (v.close !== null && v.open < v.close),
    'open должен быть раньше close',
  );

export const serviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Короткое описание для карточки услуги. */
  description: z.string().default(''),
  /** Цена в копейках. Целые числа — без ошибок float. */
  price: z.number().int().nonnegative(),
  /** Длительность работы в минутах. */
  durationMin: z.number().int().min(15).max(60 * 24 * 7),
  /**
   * Сколько дней занимает бокс. 1 = один день, 2 = два дня подряд.
   * Значение > 1 резервирует бокс на все дни подряд.
   */
  days: z.number().int().min(1).max(14).default(1),
  /** Иконка Phosphor для карточки услуги. */
  icon: z.string().default('sparkle'),
  /** Популярная услуга — поднимается наверх. */
  isPopular: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

/** Рабочий бокс (пост) в студии. */
export const boxSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Боксы только для длинных работ (например, полировка). */
  acceptsLongStay: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export const galleryItemSchema = z.object({
  id: z.string().min(1),
  /** Путь относительно `tenants/<slug>/photos/`. */
  photo: z.string().min(1),
  caption: z.string().default(''),
  order: z.number().int().default(0),
});

/** Три информационные карточки на главной. */
export const infoCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  text: z.string().default(''),
  icon: z.string().default('info'),
});

export const studioSettingsSchema = z.object({
  /** Имя студии для показа. */
  name: z.string().min(1, 'Укажите название студии'),
  /** Короткий слог — используется в адресе /s/<slug>/ */
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug: только латиница в нижнем регистре, цифры и дефисы'),
  tagline: z.string().default(''),
  description: z.string().default(''),

  phone: z.string().min(5),
  /** Что показывать рядом с телефоном: WhatsApp, Telegram… */
  messengers: z
    .array(z.enum(['whatsapp', 'telegram', 'viber', 'sms']))
    .default([]),

  address: z
    .object({
      city: z.string().default(''),
      street: z.string().default(''),
      /** Полный адрес одной строкой — используется в картах. */
      full: z.string().default(''),
      latitude: z.number().min(-90).max(90).nullable().default(null),
      longitude: z.number().min(-180).max(180).nullable().default(null),
      /** Подсказка «как добраться». */
      directionsNote: z.string().default(''),
    })
    .prefault({}),

  /** Часовой пояс студии, IANA. Определяет график и напоминания. */
  timezone: z.string().default('Europe/Moscow'),

  hours: z.array(workingHoursSchema).length(7, 'Нужны все 7 дней недели'),
  /** Отдельные нерабочие даты студии (праздники, отпуск), YYYY-MM-DD. */
  closedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД')).default([]),

  /** Отступ между машинами (подготовка бокса), минуты. */
  bufferMin: z.number().int().min(0).max(240).default(15),
  /** Минимум времени до записи, за который ещё можно забронировать. */
  minNoticeHours: z.number().int().min(0).max(720).default(2),
  /** Насколько вперёд открыта запись. */
  bookingHorizonDays: z.number().int().min(1).max(120).default(30),

  services: z.array(serviceSchema).min(1, 'Нужна хотя бы одна услуга'),
  boxes: z.array(boxSchema).min(1, 'Нужен хотя бы один бокс'),

  /** Главное фото — большое фото машины на первом экране. */
  heroPhoto: z.string().min(1),
  /** Логотип: путь в photos/ либо null. */
  logo: z.string().nullable().default(null),
  gallery: z.array(galleryItemSchema).default([]),
  infoCards: z.array(infoCardSchema).length(3, 'Нужно ровно 3 карточки'),

  /** Правила отмены и текст подтверждения. */
  cancellation: z
    .object({
      /** За сколько часов до записи можно отменить без штрафа. */
      freeCancelHours: z.number().int().min(0).max(720).default(12),
      note: z.string().default(''),
    })
    .prefault({}),

  /**
   * ИИ-помощник для клиентов на главной и /assistant. По умолчанию выключен:
   * на главной его просто нет, сервер модель не тратит. Включается только
   * в файле студии; помощник в кабинете владельца работает всегда.
   */
  assistantEnabled: z.boolean().default(false),

  /** Подсказки-промпты для помощника на главной. */
  assistantSuggestions: z.array(z.string().min(1)).min(1).max(4),

  /**
   * Кто отвечает за персональные данные клиентов (оператор по 152-ФЗ).
   * Показывается в политике /s/<slug>/privacy. Пустые поля не выводятся,
   * вместо пустого operator берётся название студии.
   */
  legal: z
    .object({
      /** «ИП Иванов Иван Иванович» или «ООО „Ромашка“». */
      operator: z.string().default(''),
      inn: z.string().default(''),
      ogrn: z.string().default(''),
      /** Почта для запросов об удалении данных. */
      email: z.string().default(''),
    })
    .prefault({}),

  pwa: z
    .object({
      shortName: z.string().default(''),
      themeColor: z.string().default('#4690FF'),
      backgroundColor: z.string().default('#000000'),
      icon: z.string().default('icon-192.png'),
    })
    .prefault({}),
});

export type StudioSettings = z.infer<typeof studioSettingsSchema>;
export type Service = z.infer<typeof serviceSchema>;
export type Box = z.infer<typeof boxSchema>;
export type GalleryItem = z.infer<typeof galleryItemSchema>;
export type InfoCard = z.infer<typeof infoCardSchema>;
export type WorkingHours = z.infer<typeof workingHoursSchema>;

/**
 * Настройки, которые владелец может менять из кабинета.
 * Всё, что здесь не перечислено (slug, pwa, timezone) — служебное.
 * Тот же список проверяет сервер: owner_save_settings в миграции
 * 20260102000000_owner_cabinet.sql. Меняете здесь — поменяйте и там.
 */
export const OWNER_EDITABLE_KEYS = [
  'name',
  'tagline',
  'description',
  'phone',
  'messengers',
  'address',
  'hours',
  'closedDates',
  'bufferMin',
  'minNoticeHours',
  'bookingHorizonDays',
  'services',
  'boxes',
  'heroPhoto',
  'logo',
  'gallery',
  'infoCards',
  'cancellation',
  'assistantSuggestions',
] as const;

export type OwnerEditableKey = (typeof OWNER_EDITABLE_KEYS)[number];

/**
 * Накладывает правки владельца поверх настроек из файла.
 * Владелец не может сменить slug — адрес /s/<slug>/ должен быть стабилен.
 */
export function mergeTenantConfig(
  base: StudioSettings,
  patch: Partial<Record<OwnerEditableKey, unknown>> | null | undefined,
): StudioSettings {
  if (!patch) return base;
  const safe: Record<string, unknown> = {};
  for (const key of OWNER_EDITABLE_KEYS) {
    if (key in patch) safe[key] = (patch as Record<string, unknown>)[key];
  }
  const merged = studioSettingsSchema.safeParse({...base, ...safe});
  // Битая правка в базе не должна ронять сайт: показываем файл студии.
  return merged.success ? merged.data : base;
}

/**
 * Адрес фото студии. В studio.json лежат имена файлов из
 * tenants/<slug>/photos/, а фото, загруженные владельцем из кабинета, —
 * полные ссылки на хранилище Supabase.
 */
export function photoUrl(slug: string, photo: string | null | undefined): string {
  if (!photo) return '';
  if (/^(https?:)?\/\//.test(photo) || photo.startsWith('/') || photo.startsWith('data:')) return photo;
  return `/tenants/${slug}/photos/${photo}`;
}
