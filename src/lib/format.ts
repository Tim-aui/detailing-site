import {formatInTimeZone as fz} from 'date-fns-tz';
import {ru} from 'date-fns/locale';
import type {StudioSettings, WorkingHours} from '../tenants/schema.ts';

const RU = 'ru-RU';

/** Деньги: цены храним в копейках, показываем рубли. */
export function money(kopecks: number): string {
  return new Intl.NumberFormat(RU, {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: kopecks % 100 === 0 ? 0 : 2,
  }).format(kopecks / 100);
}

export function moneyShort(kopecks: number): string {
  return new Intl.NumberFormat(RU, {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(kopecks / 100);
}

/**
 * «8 ч 30 мин» — длительность словами.
 *
 * `days` передаём для многодневных работ: у керамики 24 часа, но бокс
 * занят двое суток, и «1 д» в карточке сбивало бы с толку.
 */
export function duration(min: number, days = 1): string {
  const total = days > 1 ? days * 1440 : min;
  const daysOut = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  const parts: string[] = [];
  if (daysOut) parts.push(`${daysOut} дн`);
  if (h) parts.push(`${h} ч`);
  if (m && !daysOut) parts.push(`${m} мин`);
  return parts.length ? parts.join(' ') : 'меньше часа';
}

/** Дата в часовом поясе студии: «пн, 2 марта». */
export function studioDate(iso: string, tz: string, pattern = 'EEE, d MMM'): string {
  return fz(new Date(iso), tz, pattern, {locale: ru});
}

export function studioTime(iso: string, tz: string): string {
  return fz(new Date(iso), tz, 'HH:mm', {locale: ru});
}

export function studioDateTime(iso: string, tz: string): string {
  return fz(new Date(iso), tz, 'd MMM, HH:mm', {locale: ru});
}

/** Часовой пояс студии для подписи. */
export function tzLabel(tz: string, at: Date = new Date()): string {
  const offsetMin = -at.getTimezoneOffset();
  return `${tz} (UTC${offsetMin >= 0 ? '+' : ''}${offsetMin / 60})`;
}

/** «09:00–21:00» или «выходной». */
export function hoursLabel(h: WorkingHours): string {
  if (h.open === null || h.close === null) return 'выходной';
  return `${h.open}–${h.close}`;
}

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const dayName = (day: number) => DAY_NAMES[day] ?? '';

/** Текущий день недели студии (0–6). */
export function todayOfStudio(tz: string, at: Date = new Date()): number {
  return Number(fz(at, tz, 'i', {locale: ru})) % 7;
}

/** Открыта ли студия прямо сейчас. */
export function isOpenNow(config: StudioSettings, at: Date = new Date()): boolean {
  const day = todayOfStudio(config.timezone, at);
  const h = config.hours.find((x) => x.day === day);
  if (!h || h.open === null || h.close === null) return false;
  const minutes = Number(fz(at, config.timezone, 'H', {locale: ru})) * 60 +
    Number(fz(at, config.timezone, 'm', {locale: ru}));
  return minutes >= toMin(h.open) && minutes < toMin(h.close);
}

function toMin(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Ссылка на карту по адресу студии. */
export function mapLink(config: StudioSettings): string | null {
  if (config.address.latitude !== null && config.address.longitude !== null) {
    return `https://yandex.ru/maps/?pt=${config.address.longitude},${config.address.latitude}&z=17&l=map`;
  }
  if (config.address.full) {
    return `https://yandex.ru/maps/?text=${encodeURIComponent(config.address.full)}`;
  }
  return null;
}

/** Ссылка на переписку с мессенджером. */
export function messengerLink(config: StudioSettings, kind: 'whatsapp' | 'telegram' | 'viber'): string | null {
  const digits = config.phone.replace(/\D/g, '');
  if (!digits) return null;
  if (kind === 'whatsapp') return `https://wa.me/${digits}`;
  if (kind === 'telegram') return `https://t.me/+${digits}`;
  return `viber://chat?number=${digits}`;
}
