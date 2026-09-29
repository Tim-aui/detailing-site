import {formatInTimeZone} from 'date-fns-tz';

/**
 * Генерация .ics для добавления записи в календарь телефона.
 *
 * Нужна там, где веб-уведомления недоступны: человек подтвердил запись,
 * но не получает пуш. Файл открывается в Google Calendar / Apple
 * Calendar и остаётся на телефоне даже без интернета.
 */
export type IcsInput = {
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  startUtc: string;
  endUtc: string;
};

export function buildIcs({uid, title, description, location, url, startUtc, endUtc}: IcsInput): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//studio-booking//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@studio-booking`,
    // Метка времени в UTC + суффикс Z — иначе часть календарей сдвинет запись.
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(new Date(startUtc))}`,
    `DTEND:${stamp(new Date(endUtc))}`,
    `SUMMARY:${esc(title)}`,
    description ? `DESCRIPTION:${esc(description)}` : null,
    location ? `LOCATION:${esc(location)}` : null,
    url ? `URL:${esc(url)}` : null,
    'STATUS:CONFIRMED',
    // Напоминание за день (как обещает экран записи) и ещё одно за 2 часа.
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(`Завтра: ${title}`)}`,
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter((l): l is string => l !== null)
    .join('\r\n');
}

function stamp(d: Date): string {
  return formatInTimeZone(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
}

/** Экранирование по RFC 5545: запятая, точка с запятой, обратный слэш, переносы. */
function esc(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Скачивание файла календаря. */
export function downloadIcs(ics: string, filename: string) {
  const blob = new Blob([ics], {type: 'text/calendar;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Отпускаем объект, иначе Safari держит файл в памяти до перезагрузки.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ссылка на Google Calendar — открывается без установки приложения. */
export function googleCalendarUrl(i: IcsInput): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: i.title,
    dates: `${strip(i.startUtc)}/${strip(i.endUtc)}`,
    details: i.description ?? '',
    location: i.location ?? '',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

function strip(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
