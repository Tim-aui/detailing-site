import {describe, expect, it} from 'vitest';
import {fromZonedTime, toZonedTime} from 'date-fns-tz';
import {studioSettingsSchema, type StudioSettings} from '../src/tenants/schema.ts';
import {
  bookingEnd,
  busyAt,
  dayWindow,
  expandBusy,
  freeSlots,
  groupSlotsByDate,
  timeFromMinutes,
  windowUtc,
  type BusyBlock,
} from '../src/lib/schedule.ts';

const TZ = 'Europe/Moscow';

/** Студия: 3 бокса, пн–сб 09:00–21:00, буфер 15 мин. */
function makeConfig(overrides: Partial<StudioSettings> = {}): StudioSettings {
  return studioSettingsSchema.parse({
    name: 'Test',
    slug: 'test',
    phone: '+7 900 000-00-00',
    timezone: TZ,
    hours: [
      {day: 0, open: null, close: null},
      {day: 1, open: '09:00', close: '21:00'},
      {day: 2, open: '09:00', close: '21:00'},
      {day: 3, open: '09:00', close: '21:00'},
      {day: 4, open: '09:00', close: '21:00'},
      {day: 5, open: '09:00', close: '21:00'},
      {day: 6, open: '10:00', close: '20:00'},
    ],
    bufferMin: 15,
    minNoticeHours: 0,
    bookingHorizonDays: 7,
    heroPhoto: 'hero.jpg',
    services: [
      {
        id: 'wash',
        name: 'Мойка',
        description: '',
        price: 1000,
        durationMin: 60,
        days: 1,
      },
    ],
    boxes: [
      {id: 'b1', name: '1'},
      {id: 'b2', name: '2'},
      {id: 'b3', name: '3'},
    ],
    infoCards: [
      {id: 'a', title: 'a', text: ''},
      {id: 'b', title: 'b', text: ''},
      {id: 'c', title: 'c', text: ''},
    ],
    assistantSuggestions: ['Когда окно?'],
    ...overrides,
  });
}

const service1d = {durationMin: 60, days: 1};
const service2d = {durationMin: 120, days: 2};

/** Понедельник 2026-03-02, 08:00 по Москве. */
const MON_MORNING = fromZonedTime('2026-03-02 08:00', TZ);
const MON_NOON = fromZonedTime('2026-03-02 12:00', TZ);

describe('окно работы студии', () => {
  it('воскресенье закрыто', () => {
    const cfg = makeConfig();
    const sunday = fromZonedTime('2026-03-08 12:00', TZ);
    expect(dayWindow(cfg, sunday).isOpen).toBe(false);
    expect(windowUtc(cfg, sunday)).toBeNull();
  });

  it('границы дня в UTC корректны для Москвы', () => {
    const cfg = makeConfig();
    const monday = fromZonedTime('2026-03-02 12:00', TZ);
    const w = windowUtc(cfg, monday)!;
    // 09:00 MSK = 06:00 UTC
    expect(w.start.toISOString()).toBe('2026-03-02T06:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-03-02T18:00:00.000Z');
  });

  it('считает часы в поясе студии, а не машины', () => {
    // Одна и та же мировая дата — разные локальные дни при разном TZ.
    const cfgMoscow = makeConfig();
    const cfgTokyo = makeConfig({timezone: 'Asia/Tokyo'});
    const at = new Date('2026-03-02T20:00:00.000Z'); // 23:00 МСК, 05:00 Токио
    expect(dayWindow(cfgMoscow, toLocal(at, TZ)).date).toBe('2026-03-02');
    expect(dayWindow(cfgTokyo, toLocal(at, 'Asia/Tokyo')).date).toBe('2026-03-03');
  });
});

function toLocal(d: Date, tz: string) {
  return toZonedTime(d, tz);
}

describe('буфер между машинами', () => {
  it('раздвигает занятость в обе стороны', () => {
    const busy: BusyBlock[] = [
      {
        id: '1',
        startsAt: '2026-03-02T06:00:00.000Z',
        endsAt: '2026-03-02T07:00:00.000Z',
        status: 'confirmed',
      },
    ];
    const [iv] = expandBusy(busy, 15);
    // 09:00–10:00 МСК ±15 мин → 08:45–10:15 МСК
    expect(new Date(iv.start).toISOString()).toBe('2026-03-02T05:45:00.000Z');
    expect(new Date(iv.end).toISOString()).toBe('2026-03-02T07:15:00.000Z');
  });

  it('отменённые записи не занимают бокс', () => {
    const busy: BusyBlock[] = [
      {
        id: '1',
        startsAt: '2026-03-02T06:00:00.000Z',
        endsAt: '2026-03-02T07:00:00.000Z',
        status: 'cancelled',
      },
    ];
    expect(expandBusy(busy, 15)).toHaveLength(0);
  });
});

describe('занятость боксов', () => {
  const busy: BusyBlock[] = [
    {
      id: '1',
      startsAt: '2026-03-02T06:00:00.000Z',
      endsAt: '2026-03-02T08:00:00.000Z',
      status: 'confirmed',
    },
  ];

  it('при одной записи из трёх боксов остаются два окна', () => {
    const cfg = makeConfig();
    const slots = freeSlots(cfg, service1d, {
      busy,
      horizonDays: 1,
      stepMin: 60,
      now: MON_MORNING,
    });
    const at10 = slots.find((s) => s.label === '10:00');
    expect(at10).toBeDefined();
    expect(at10!.boxesFree).toBe(2);
  });

  it('когда заняты все три бокса — окна нет', () => {
    const cfg = makeConfig();
    const full: BusyBlock[] = [0, 1, 2].map((i) => ({
      id: String(i),
      startsAt: '2026-03-02T06:00:00.000Z',
      endsAt: '2026-03-02T07:00:00.000Z',
      status: 'confirmed' as const,
    }));
    const slots = freeSlots(cfg, service1d, {
      busy: full,
      horizonDays: 1,
      stepMin: 60,
      now: MON_MORNING,
    });
    expect(slots.find((s) => s.label === '09:00')).toBeUndefined();
  });

  it('буфер отодвигает начало', () => {
    // Один бокс: 09:00–10:00 занято, буфер 15 мин → свободно с 10:15.
    const cfg = makeConfig({boxes: [{id: 'only', name: 'Единственный бокс'}]});
    const busy2: BusyBlock[] = [
      {
        id: '1',
        startsAt: '2026-03-02T06:00:00.000Z',
        endsAt: '2026-03-02T07:00:00.000Z',
        status: 'confirmed',
      },
    ];
    const slots = freeSlots(cfg, service1d, {
      busy: busy2,
      horizonDays: 1,
      stepMin: 15,
      now: MON_MORNING,
    });
    expect(slots.find((s) => s.label === '10:00')).toBeUndefined();
    expect(slots.find((s) => s.label === '10:15')).toBeDefined();
  });

  it('буфер не мешает, когда есть свободный бокс', () => {
    // Три бокса, одна занята — 10:00 всё равно свободен за счёт второго бокса.
    const cfg = makeConfig();
    const slots = freeSlots(cfg, service1d, {
      busy: [
        {
          id: '1',
          startsAt: '2026-03-02T06:00:00.000Z',
          endsAt: '2026-03-02T07:00:00.000Z',
          status: 'confirmed',
        },
      ],
      horizonDays: 1,
      stepMin: 15,
      now: MON_MORNING,
    });
    expect(slots.find((s) => s.label === '10:00')?.boxesFree).toBe(2);
  });
});

describe('многодневные услуги', () => {
  it('двухдневная работа держит бокс оба дня', () => {
    const cfg = makeConfig();
    // Понедельник 10:00 МСК, работа до закрытия второго дня.
    const end = bookingEnd(cfg, fromZonedTime('2026-03-02 10:00', TZ), service2d);
    expect(end.toISOString()).toBe('2026-03-03T18:00:00.000Z'); // вт 21:00 МСК
  });

  it('не предлагает начало, если следующий день выходной', () => {
    // Суббота 10:00 — следующий день воскресенье, студия закрыта.
    const cfg = makeConfig();
    const sat = fromZonedTime('2026-03-07 07:00', TZ);
    const slots = freeSlots(cfg, service2d, {busy: [], horizonDays: 1, stepMin: 60, now: sat});
    expect(slots).toHaveLength(0);
  });

  it('понедельник и вторник — двухдневная доступна', () => {
    const cfg = makeConfig();
    const slots = freeSlots(cfg, service2d, {busy: [], horizonDays: 2, stepMin: 60, now: MON_MORNING});
    const monday = slots.filter((s) => s.date === '2026-03-02');
    expect(monday.length).toBeGreaterThan(0);
    // Старт в первый день, финиш — в последний, не в тот же вечер.
    expect(monday.every((s) => s.startUtc.startsWith('2026-03-02'))).toBe(true);
    expect(monday.every((s) => s.endUtc.startsWith('2026-03-03'))).toBe(true);
  });

  it('без бокса для длительной работы многодневка недоступна', () => {
    const cfg = makeConfig({
      boxes: [{id: 'b1', name: '1', acceptsLongStay: false}],
    });
    expect(freeSlots(cfg, service2d, {busy: [], horizonDays: 3, now: MON_MORNING})).toHaveLength(0);
    // Однодневная по-прежнему работает
    expect(freeSlots(cfg, service1d, {busy: [], horizonDays: 1, now: MON_MORNING}).length).toBeGreaterThan(0);
  });
});

describe('окно записи', () => {
  it('не предлагает начало раньше minNoticeHours', () => {
    const cfg = makeConfig({minNoticeHours: 4});
    const slots = freeSlots(cfg, service1d, {busy: [], horizonDays: 1, stepMin: 30, now: MON_MORNING});
    // Сейчас 08:00, студия открыта в 09:00 → раньше 12:00 нельзя
    expect(slots.every((s) => s.label >= '12:00')).toBe(true);
  });

  it('не выходит за пределы горизонта', () => {
    const cfg = makeConfig({bookingHorizonDays: 2});
    const slots = freeSlots(cfg, service1d, {busy: [], horizonDays: 2, stepMin: 120, now: MON_MORNING});
    expect(new Set(slots.map((s) => s.date)).size).toBeLessThanOrEqual(2);
  });

  it('слоты не выходят за закрытие', () => {
    const cfg = makeConfig();
    const slots = freeSlots(cfg, {durationMin: 60, days: 1}, {
      busy: [],
      horizonDays: 1,
      stepMin: 30,
      now: MON_MORNING,
    });
    expect(slots.every((s) => s.label <= '20:00')).toBe(true);
  });
});

describe('вспомогательное', () => {
  it('timeFromMinutes переживает переход через полночь', () => {
    expect(timeFromMinutes(0)).toBe('00:00');
    expect(timeFromMinutes(600)).toBe('10:00');
    expect(timeFromMinutes(1440)).toBe('00:00');
  });

  it('группирует слоты по дате по порядку', () => {
    const groups = groupSlotsByDate([
      {startUtc: '2', endUtc: '3', label: '10:00', date: '2026-03-03', boxesFree: 1},
      {startUtc: '1', endUtc: '2', label: '09:00', date: '2026-03-02', boxesFree: 1},
      {startUtc: '4', endUtc: '5', label: '11:00', date: '2026-03-02', boxesFree: 1},
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-03-02', '2026-03-03']);
    expect(groups[0].slots.map((s) => s.label)).toEqual(['09:00', '11:00']);
  });

  it('busyAt считает пересечения', () => {
    const ivs = [
      {start: 0, end: 100},
      {start: 50, end: 150},
    ];
    expect(busyAt(ivs, 25)).toBe(1);
    expect(busyAt(ivs, 75)).toBe(2);
  });
});

describe('защита от двойной брони', () => {
  it('два клиента на один бокс — второй получает другое время', () => {
    const cfg = makeConfig({boxes: [{id: 'only', name: 'Единственный бокс'}]});
    const now = MON_MORNING;
    const first = freeSlots(cfg, service1d, {busy: [], horizonDays: 1, stepMin: 60, now});
    const target = first[0];

    // Клиент A занял первый слот.
    const busyAfterA: BusyBlock[] = [
      {
        id: 'A',
        startsAt: target.startUtc,
        endsAt: target.endUtc,
        status: 'confirmed',
      },
    ];
    const second = freeSlots(cfg, service1d, {
      busy: busyAfterA,
      horizonDays: 1,
      stepMin: 60,
      now,
    });
    expect(second[0].startUtc).not.toBe(target.startUtc);
    expect(second.some((s) => s.startUtc === target.startUtc)).toBe(false);
  });

  it('при единственном боксе и полной занятости слотов нет', () => {
    const cfg = makeConfig({boxes: [{id: 'only', name: 'Единственный бокс'}]});
    // Забиваем весь рабочий день подряд: 09:00–21:00 без разрывов.
    const busy: BusyBlock[] = Array.from({length: 24}, (_, i) => ({
      id: String(i),
      startsAt: fromZonedTime(`2026-03-02 ${String(9 + Math.floor(i / 2)).padStart(2, '0')}:00`, TZ).toISOString(),
      endsAt: fromZonedTime(`2026-03-02 ${String(9 + Math.floor(i / 2)).padStart(2, '0')}:30`, TZ).toISOString(),
      status: 'confirmed' as const,
    }));
    const slots = freeSlots(cfg, service1d, {busy, horizonDays: 1, stepMin: 30, now: MON_MORNING});
    expect(slots).toHaveLength(0);
  });
});

describe('смена часового пояса', () => {
  it('расписание считается по часам студии, не телефона', () => {
    // 12:00 МСК = 04:00 Токио. Одна и та же студия в разных поясах
    // предлагает разное время, потому что «09:00» — это 09:00 у студии.
    const now = MON_NOON;
    const msk = makeConfig();
    const tyo = makeConfig({timezone: 'Asia/Tokyo'});
    const a = freeSlots(msk, service1d, {busy: [], horizonDays: 1, stepMin: 60, now});
    const b = freeSlots(tyo, service1d, {busy: [], horizonDays: 1, stepMin: 60, now});
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    // Один и тот же мировой момент (12:00 МСК) — но в разных студиях
    // это разное время на их настенных часах.
    expect(a[0].startUtc).toBe(b[0].startUtc);
    expect(a[0].label).toBe('12:00');
    expect(b[0].label).toBe('18:00');
  });

  it('ночью в Токио студия уже закрыта', () => {
    // 23:00 МСК = 07:00 Токио, до открытия в 09:00.
    const lateNight = fromZonedTime('2026-03-02 20:00', TZ); // 23:00 МСК
    const tyo = makeConfig({timezone: 'Asia/Tokyo'});
    const slots = freeSlots(tyo, service1d, {busy: [], horizonDays: 1, stepMin: 60, now: lateNight});
    expect(slots[0].label).toBe('09:00');
  });
});
