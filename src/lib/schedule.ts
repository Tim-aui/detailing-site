/**
 * Расписание: как из занятости боксов получаются свободные окна.
 *
 * Правила, зашитые здесь:
 *  • Всё считается в часовом поясе СТУДИИ, а не телефона клиента.
 *  • Между машинами нужен буфер (уборка бокса) — он тоже занимает время.
 *  • Услуга на N дней занимает бокс все N дней подряд.
 *  • Выходные и нерабочие часы не предлагаются.
 *  • Начало не может быть ближе, чем minNoticeHours.
 *
 * Модуль чистый: не ходит в сеть и не читает окружение, поэтому
 * расписание целиком проверяется тестами.
 */
import {addDays, addMinutes, startOfDay} from 'date-fns';
import {fromZonedTime, toZonedTime} from 'date-fns-tz';
import type {StudioSettings} from '../tenants/schema.ts';

export type BookingStatus = 'pending' | 'confirmed' | 'in_progress' | 'done' | 'cancelled';

/** Занятость бокса в базе. Времена — UTC ISO. */
export type BusyBlock = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  /**
   * Бокс записи. С ним окна считаются по каждому боксу отдельно — так же,
   * как сервер. Без него (локальный режим) — по числу занятых боксов.
   */
  boxId?: string;
};

export type Interval = {start: number; end: number};

export type DayWindow = {
  /** Дата студии, YYYY-MM-DD. */
  date: string;
  isOpen: boolean;
  openMin: number | null;
  closeMin: number | null;
};

export type FreeSlot = {
  startUtc: string;
  endUtc: string;
  /** Подпись локального времени студии, HH:mm. */
  label: string;
  /** Дата студии, YYYY-MM-DD. */
  date: string;
  /** Сколько боксов свободно на это время. */
  boxesFree: number;
  /** false — время занято (показываем зачёркнутым, выбрать нельзя). */
  available: boolean;
};

export function minutesFromTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function timeFromMinutes(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Окно работы студии для локальной даты (поля берутся в TZ студии). */
export function dayWindow(config: StudioSettings, studioLocalDate: Date): DayWindow {
  const hours = config.hours.find((h) => h.day === studioLocalDate.getDay());
  const date = formatDate(studioLocalDate);
  const closed = (config.closedDates ?? []).includes(date);
  if (closed || !hours || hours.open === null || hours.close === null) {
    return {date, isOpen: false, openMin: null, closeMin: null};
  }
  return {
    date,
    isOpen: true,
    openMin: minutesFromTime(hours.open),
    closeMin: minutesFromTime(hours.close),
  };
}

/** Границы рабочего дня студии в UTC, либо null если день закрыт. */
export function windowUtc(
  config: StudioSettings,
  studioLocalDate: Date,
): {start: Date; end: Date} | null {
  const w = dayWindow(config, studioLocalDate);
  if (!w.isOpen || w.openMin === null || w.closeMin === null) return null;
  return {
    start: fromZonedTime(`${w.date} ${timeFromMinutes(w.openMin)}`, config.timezone),
    end: fromZonedTime(`${w.date} ${timeFromMinutes(w.closeMin)}`, config.timezone),
  };
}

/**
 * Когда запись в��свобождает бокс.
 *
 * Однодневная услуга идёт ровно durationMin. Многодневная занимает бокс
 * до закрытия последнего дня: так «керамика на два дня» действительно
 * держит бокс оба дня, а не высвобождает его на ночь.
 */
export function bookingEnd(
  config: StudioSettings,
  startUtc: Date,
  service: {durationMin: number; days: number},
): Date {
  if (service.days <= 1) return addMinutes(startUtc, service.durationMin);
  const lastDay = addDays(toZonedTime(startUtc, config.timezone), service.days - 1);
  const w = dayWindow(config, lastDay);
  if (!w.isOpen || w.closeMin === null) return addMinutes(startUtc, service.durationMin * service.days);
  return fromZonedTime(`${w.date} ${timeFromMinutes(w.closeMin)}`, config.timezone);
}

/**
 * Раскрывает занятость в интервалы с буфером: уборка нужна и до
 * начала, и после конца предыдущей работы. Отменённые не мешают.
 */
export function expandBusy(busy: BusyBlock[], bufferMin: number): Interval[] {
  const pad = bufferMin * 60_000;
  return busy
    .filter((b) => b.status !== 'cancelled')
    .map((b) => ({
      start: new Date(b.startsAt).getTime() - pad,
      end: new Date(b.endsAt).getTime() + pad,
    }))
    .sort((a, b) => a.start - b.start);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Сколько записей занимают бокс ровно в момент `at`. */
export function busyAt(intervals: Interval[], at: number): number {
  let n = 0;
  for (const iv of intervals) {
    if (at >= iv.start && at < iv.end) n++;
  }
  return n;
}

/** Пиковая занятость интервала: максимум по всем его границам. */
export function peakBusy(intervals: Interval[], span: Interval): number {
  const points = new Set<number>([span.start, span.end]);
  for (const iv of intervals) {
    if (iv.start > span.start && iv.start < span.end) points.add(iv.start);
    if (iv.end > span.start && iv.end < span.end) points.add(iv.end);
  }
  let peak = 0;
  for (const p of points) peak = Math.max(peak, busyAt(intervals, p));
  return peak;
}

export type SlotQuery = {
  from?: Date;
  horizonDays?: number;
  busy: BusyBlock[];
  stepMin?: number;
  now?: Date;
};

/**
 * Свободен ли интервал: есть бокс, в котором он ни с чем не пересекается.
 * Правило то же, что у сервера (pick_free_box): многодневной работе
 * нужен бокс с acceptsLongStay, занятость бокса = [начало, конец + буфер].
 */
function freeBoxes(
  config: StudioSettings,
  service: {days: number},
  busy: BusyBlock[],
  intervals: Interval[],
  span: Interval,
): number {
  const boxes = config.boxes.filter((b) => b.isActive && (service.days <= 1 || b.acceptsLongStay));
  const perBox = busy.length > 0 && busy.every((b) => b.boxId);
  if (!perBox) {
    // Локальный режим без боксов у записей: считаем по пиковой занятости.
    const total = config.boxes.filter((b) => b.isActive).length;
    return Math.max(0, Math.min(boxes.length, total - peakBusy(intervals, span)));
  }
  const pad = config.bufferMin * 60_000;
  let free = 0;
  for (const box of boxes) {
    const clash = busy.some(
      (b) =>
        b.boxId === box.id &&
        b.status !== 'cancelled' &&
        b.status !== 'done' &&
        overlaps(span, {start: new Date(b.startsAt).getTime() - pad, end: new Date(b.endsAt).getTime() + pad}),
    );
    if (!clash) free++;
  }
  return free;
}

/**
 * Сетка окон для услуги — и свободные, и занятые (available=false).
 * Начало каждого окна кратно stepMin относительно открытия.
 */
export function slotGrid(
  config: StudioSettings,
  service: {durationMin: number; days: number},
  query: SlotQuery,
): FreeSlot[] {
  const now = query.now ?? new Date();
  const stepMin = query.stepMin ?? 30;
  const horizon = query.horizonDays ?? config.bookingHorizonDays;
  const boxes = config.boxes.filter((b) => b.isActive);
  if (boxes.length === 0) return [];
  // Бокс, готовый к длительной работе, нужен для многодневных услуг.
  if (service.days > 1 && !boxes.some((b) => b.acceptsLongStay)) return [];

  const intervals = expandBusy(query.busy, config.bufferMin);
  const earliest = now.getTime() + config.minNoticeHours * 3_600_000;
  const todayStart = startOfDay(toZonedTime(now, config.timezone));
  const slots: FreeSlot[] = [];
  const seen = new Set<number>();

  for (let d = 0; d < horizon; d++) {
    const localDate = addDays(todayStart, d);
    const win = windowUtc(config, localDate);
    if (!win) continue;

    const chain = Array.from({length: service.days}, (_, k) =>
      windowUtc(config, addDays(localDate, k)),
    );
    // Все дни длительности должны быть рабочими.
    if (chain.some((w) => w === null)) continue;
    const firstDay = chain[0]!;
    const lastDay = chain[chain.length - 1]!;

    // Однодневная работа должна закончиться до закрытия; многодневная
    // начинается в любое рабочее время первого дня (как на сервере).
    const lastStart =
      service.days > 1 ? firstDay.end.getTime() - stepMin * 60_000 : win.end.getTime() - service.durationMin * 60_000;

    for (let t = win.start.getTime(); t <= lastStart; t += stepMin * 60_000) {
      if (t < earliest) continue;
      if (seen.has(t)) continue;

      const end = bookingEnd(config, new Date(t), service);
      const span: Interval = {start: t, end: end.getTime()};
      if (span.start < firstDay.start.getTime() || span.start >= firstDay.end.getTime()) continue;
      if (span.end > lastDay.end.getTime()) continue;

      seen.add(t);
      const free = freeBoxes(config, service, query.busy, intervals, span);
      const w = dayWindow(config, localDate);
      // Подпись — время настенных часов студии: открытие + смещение.
      const label = timeFromMinutes((w.openMin ?? 0) + (t - win.start.getTime()) / 60_000);
      slots.push({
        startUtc: new Date(t).toISOString(),
        endUtc: end.toISOString(),
        label,
        date: w.date,
        boxesFree: free,
        available: free > 0,
      });
    }
  }
  return slots;
}

/** Только свободные окна для услуги. */
export function freeSlots(
  config: StudioSettings,
  service: {durationMin: number; days: number},
  query: SlotQuery,
): FreeSlot[] {
  return slotGrid(config, service, query).filter((s) => s.available);
}

/** Слоты, сгруппированные по дате студии — для ленты выбора даты. */
export function groupSlotsByDate(slots: FreeSlot[]): Array<{date: string; slots: FreeSlot[]}> {
  const map = new Map<string, FreeSlot[]>();
  for (const s of slots) {
    const arr = map.get(s.date) ?? [];
    arr.push(s);
    map.set(s.date, arr);
  }
  return [...map.entries()]
    .map(([date, list]) => ({date, slots: list.sort((a, b) => a.startUtc.localeCompare(b.startUtc))}))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Слоты конкретной даты. */
export function slotsForDate(slots: FreeSlot[], date: string): FreeSlot[] {
  return slots.filter((s) => s.date === date);
}
