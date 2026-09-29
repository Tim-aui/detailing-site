import {useMemo, useRef, useState} from 'react';
import {VStack, HStack} from '@astryxdesign/core/Layout';
import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {StatusDot} from '@astryxdesign/core/StatusDot';
import {List, ListItem} from '@astryxdesign/core/List';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Banner} from '@astryxdesign/core/Banner';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {NumberInput} from '@astryxdesign/core/NumberInput';
import {Selector} from '@astryxdesign/core/Selector';
import {DateInput} from '@astryxdesign/core/DateInput';
import {useToast} from '@astryxdesign/core/Toast';
import {fromZonedTime} from 'date-fns-tz';
import {useTenant} from '../../tenants/TenantContext.tsx';
import type {StudioSettings} from '../../tenants/schema.ts';
import {dayWindow, timeFromMinutes} from '../../lib/schedule.ts';
import {money, studioDate, studioTime, duration} from '../../lib/format.ts';
import {LoadingIndicator} from '../../components/LoadingIndicator.tsx';
import {
  periodFor,
  shiftDate,
  todayIn,
  useAddPayment,
  useOwnerBookings,
  useOwnerCreateBooking,
  useOwnerStats,
  useReschedule,
  useSetStatus,
  type OwnerBooking,
} from '../../lib/owner.ts';

export const STATUS: Record<OwnerBooking['status'], {label: string; dot: 'warning' | 'accent' | 'success' | 'neutral' | 'error'; badge: 'warning' | 'info' | 'success' | 'neutral' | 'blue'}> = {
  pending: {label: 'Ждёт подтверждения', dot: 'warning', badge: 'warning'},
  confirmed: {label: 'Подтверждена', dot: 'accent', badge: 'blue'},
  in_progress: {label: 'Принята в работу', dot: 'accent', badge: 'info'},
  done: {label: 'Готово', dot: 'success', badge: 'success'},
  cancelled: {label: 'Отменена', dot: 'neutral', badge: 'neutral'},
};

/** Записи за день или неделю + сводка: заезды, выполнено, получено денег. */
export function AdminBookings() {
  const {slug, settings} = useTenant();
  const tz = settings?.timezone ?? 'Europe/Moscow';
  const [kind, setKind] = useState<'day' | 'week'>('day');
  const [anchor, setAnchor] = useState(() => todayIn(tz));
  const period = useMemo(() => periodFor(kind, anchor, tz), [kind, anchor, tz]);
  const bookings = useOwnerBookings(slug, period);
  const stats = useOwnerStats(slug, period);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, OwnerBooking[]>();
    for (const b of bookings.data ?? []) {
      const key = studioDate(b.starts_at, tz, 'yyyy-MM-dd');
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [bookings.data, tz]);

  const open = bookings.data?.find((b) => b.id === openId) ?? null;
  const title =
    kind === 'day'
      ? studioDate(period.from.toISOString(), tz, 'EEEE, d MMMM')
      : `${studioDate(period.from.toISOString(), tz, 'd MMM')} — ${studioDate(new Date(period.to.getTime() - 1).toISOString(), tz, 'd MMM')}`;

  if (!settings) return null;

  return (
    <VStack gap={4}>
      <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
        <SegmentedControl label="Период" value={kind} onChange={(v) => setKind(v as 'day' | 'week')}>
          <SegmentedControlItem value="day" label="День" />
          <SegmentedControlItem value="week" label="Неделя" />
        </SegmentedControl>
        <HStack gap={2} vAlign="center">
          <Button label="‹" variant="ghost" size="sm" clickAction={() => setAnchor(shiftDate(anchor, kind === 'day' ? -1 : -7))} />
          <Button label="Сегодня" variant="secondary" size="sm" clickAction={() => setAnchor(todayIn(tz))} />
          <Button label="›" variant="ghost" size="sm" clickAction={() => setAnchor(shiftDate(anchor, kind === 'day' ? 1 : 7))} />
        </HStack>
        <Button label="Новая запись" variant="primary" size="md" clickAction={() => setCreating(true)} />
      </HStack>

      <Heading level={2}>{capitalize(title)}</Heading>

      <Grid columns={{minWidth: 170}} gap={3}>
        <Stat label="Заезды" value={stats.data ? String(stats.data.visits) : '—'} hint={stats.data?.pending ? `ждут подтверждения: ${stats.data.pending}` : 'без отменённых'} />
        <Stat label="Выполнено" value={stats.data ? String(stats.data.done) : '—'} hint={stats.data?.cancelled ? `отменено: ${stats.data.cancelled}` : 'статус «Готово»'} />
        <Stat label="Получено" value={stats.data ? money(stats.data.received) : '—'} hint={stats.data?.refunds ? `возвраты: ${money(stats.data.refunds)}` : 'оплаты минус возвраты'} />
        <Stat label="По прайсу" value={stats.data ? money(stats.data.expected) : '—'} hint="сумма записей периода" />
      </Grid>

      {bookings.isError ? <Banner status="error" title="Не удалось загрузить записи" description={bookings.error.message} /> : null}

      {bookings.isPending ? (
        <LoadingIndicator label="Загружаем записи" />
      ) : grouped.length === 0 ? (
        <Card padding={5}>
          <EmptyState
            title={kind === 'day' ? 'На этот день записей нет' : 'На этой неделе записей нет'}
            description="Клиенты записываются по ссылке на сайт. Звонок — добавьте запись вручную."
            actions={<Button label="Новая запись" variant="secondary" clickAction={() => setCreating(true)} />}
          />
        </Card>
      ) : (
        <VStack gap={4}>
          {grouped.map(([date, list]) => (
            <Card key={date} padding={2}>
              <List
                hasDividers
                header={
                  kind === 'week' ? (
                    <Text type="label" weight="semibold">
                      {capitalize(studioDate(`${date}T12:00:00Z`, 'UTC', 'EEEE, d MMMM'))} · {list.length}
                    </Text>
                  ) : undefined
                }
              >
                {list.map((b) => (
                  <ListItem
                    key={b.id}
                    label={`${studioTime(b.starts_at, tz)} · ${b.service_name}`}
                    description={`${b.contact_name}${b.car ? ` · ${b.car}` : ''} · ${b.contact_phone}${multiDay(b, tz) ? ` · до ${studioDate(b.ends_at, tz, 'd MMM HH:mm')}` : ''}`}
                    startContent={<StatusDot variant={STATUS[b.status].dot} label={STATUS[b.status].label} />}
                    endContent={
                      <VStack gap={1} hAlign="end">
                        <Badge variant={STATUS[b.status].badge} label={STATUS[b.status].label} />
                        <Text type="supporting" color="secondary">
                          {b.paid > 0 ? `оплачено ${money(b.paid)} из ${money(b.price)}` : money(b.price)}
                        </Text>
                      </VStack>
                    }
                    onClick={() => setOpenId(b.id)}
                  />
                ))}
              </List>
            </Card>
          ))}
        </VStack>
      )}

      {open ? <BookingDialog booking={open} settings={settings} onClose={() => setOpenId(null)} /> : null}
      {creating ? <NewBookingDialog settings={settings} defaultDate={anchor} onClose={() => setCreating(false)} /> : null}
    </VStack>
  );
}

function Stat({label, value, hint}: {label: string; value: string; hint: string}) {
  return (
    <Card padding={4}>
      <VStack gap={1}>
        <Text type="supporting" color="secondary">
          {label}
        </Text>
        <Text type="large" weight="bold" hasTabularNumbers style={{fontSize: 'clamp(20px, 5.4vw, 26px)', lineHeight: 1.15, whiteSpace: 'nowrap'}}>
          {value}
        </Text>
        <Text type="supporting" color="secondary">
          {hint}
        </Text>
      </VStack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Карточка записи
// ---------------------------------------------------------------------------

function BookingDialog({booking: b, settings, onClose}: {booking: OwnerBooking; settings: StudioSettings; onClose: () => void}) {
  const {slug} = useTenant();
  const toast = useToast();
  const tz = settings.timezone;
  const setStatus = useSetStatus(slug);
  const [mode, setMode] = useState<'view' | 'move' | 'payment' | 'refund' | 'cancel'>('view');

  const act = async (status: OwnerBooking['status'], text: string) => {
    try {
      await setStatus.mutateAsync({id: b.id, status});
      toast({type: 'info', body: text});
      if (status === 'cancelled') onClose();
      else setMode('view');
    } catch (e) {
      toast({type: 'error', body: (e as Error).message});
    }
  };

  const minutes = (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60_000;

  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={520} purpose="form">
      <DialogHeader title={`${b.service_name} · ${b.code}`} subtitle={STATUS[b.status].label} onOpenChange={(o) => !o && onClose()} />
      <VStack gap={4} padding={4}>
        <MetadataList>
          <MetadataListItem label="Когда">
            {capitalize(studioDate(b.starts_at, tz, 'EEEE, d MMMM, HH:mm'))} — {multiDay(b, tz) ? studioDate(b.ends_at, tz, 'd MMM HH:mm') : studioTime(b.ends_at, tz)}
            {multiDay(b, tz) ? '' : ` (${duration(minutes)})`}
          </MetadataListItem>
          <MetadataListItem label="Клиент">{b.contact_name}</MetadataListItem>
          <MetadataListItem label="Телефон">
            <a href={`tel:${b.contact_phone.replace(/[^\d+]/g, '')}`}>{b.contact_phone}</a>
          </MetadataListItem>
          {b.car ? <MetadataListItem label="Машина">{b.car}</MetadataListItem> : null}
          {b.comment ? <MetadataListItem label="Пожелания">{b.comment}</MetadataListItem> : null}
          <MetadataListItem label="Бокс">{settings.boxes.find((x) => x.id === b.box_id)?.name ?? b.box_id}</MetadataListItem>
          <MetadataListItem label="Цена">{money(b.price)}</MetadataListItem>
          <MetadataListItem label="Оплачено">{money(b.paid)}</MetadataListItem>
          <MetadataListItem label="Источник">{b.source === 'owner' ? 'добавлена в кабинете' : 'запись с сайта'}</MetadataListItem>
        </MetadataList>

        {mode === 'view' ? (
          <VStack gap={2}>
            <HStack gap={2} wrap="wrap">
              {b.status === 'pending' ? (
                <Button label="Подтвердить" variant="primary" isLoading={setStatus.isPending} clickAction={() => act('confirmed', 'Запись подтверждена')} />
              ) : null}
              {b.status === 'pending' || b.status === 'confirmed' ? (
                <Button label="Принять в работу" variant={b.status === 'confirmed' ? 'primary' : 'secondary'} clickAction={() => act('in_progress', 'Машина принята в работу')} />
              ) : null}
              {b.status === 'in_progress' ? (
                <Button label="Готово" variant="primary" clickAction={() => act('done', 'Работа готова')} />
              ) : null}
              {b.status === 'cancelled' ? (
                <Button label="Восстановить" variant="secondary" clickAction={() => act('confirmed', 'Запись восстановлена')} />
              ) : null}
            </HStack>
            <HStack gap={2} wrap="wrap">
              {b.status !== 'cancelled' ? <Button label="Оплата" variant="secondary" clickAction={() => setMode('payment')} /> : null}
              {b.paid > 0 ? <Button label="Возврат" variant="secondary" clickAction={() => setMode('refund')} /> : null}
              {b.status === 'pending' || b.status === 'confirmed' || b.status === 'in_progress' ? (
                <Button label="Перенести" variant="secondary" clickAction={() => setMode('move')} />
              ) : null}
              {b.status === 'pending' || b.status === 'confirmed' ? (
                <Button label="Отменить запись" variant="ghost" clickAction={() => setMode('cancel')} />
              ) : null}
            </HStack>
          </VStack>
        ) : null}

        {mode === 'cancel' ? (
          <Card padding={4} variant="muted">
            <VStack gap={3}>
              <Text type="body">Отменить запись {b.contact_name}? Время освободится для других клиентов.</Text>
              <HStack gap={2}>
                <Button label="Да, отменить" variant="primary" clickAction={() => act('cancelled', 'Запись отменена')} />
                <Button label="Назад" variant="ghost" clickAction={() => setMode('view')} />
              </HStack>
            </VStack>
          </Card>
        ) : null}

        {mode === 'move' ? <RescheduleForm booking={b} settings={settings} onDone={() => setMode('view')} /> : null}
        {mode === 'payment' || mode === 'refund' ? (
          <PaymentForm booking={b} kind={mode} onDone={() => setMode('view')} />
        ) : null}
      </VStack>
    </Dialog>
  );
}

function RescheduleForm({booking, settings, onDone}: {booking: OwnerBooking; settings: StudioSettings; onDone: () => void}) {
  const {slug} = useTenant();
  const toast = useToast();
  const move = useReschedule(slug);
  const [date, setDate] = useState(studioDate(booking.starts_at, settings.timezone, 'yyyy-MM-dd'));
  const [time, setTime] = useState(studioTime(booking.starts_at, settings.timezone));
  const options = timeOptions(settings, date);

  const submit = async () => {
    try {
      await move.mutateAsync({id: booking.id, startUtc: fromZonedTime(`${date} ${time}`, settings.timezone).toISOString()});
      toast({type: 'info', body: `Перенесено на ${date.split('-').reverse().join('.')} ${time}`});
      onDone();
    } catch (e) {
      toast({type: 'error', body: (e as Error).message});
    }
  };

  return (
    <Card padding={4} variant="muted">
      <VStack gap={3}>
        <Text type="label" weight="semibold">
          Перенос записи
        </Text>
        <DateField label="Дата" value={date} onChange={setDate} />
        {options.length ? (
          <Selector label="Время" value={time} onChange={(v) => setTime(v)} options={options} />
        ) : (
          <Text type="supporting" color="secondary">
            В этот день студия закрыта.
          </Text>
        )}
        <HStack gap={2}>
          <Button label="Перенести" variant="primary" isDisabled={!options.includes(time)} isLoading={move.isPending} clickAction={submit} />
          <Button label="Назад" variant="ghost" clickAction={onDone} />
        </HStack>
      </VStack>
    </Card>
  );
}

function PaymentForm({booking, kind, onDone}: {booking: OwnerBooking; kind: 'payment' | 'refund'; onDone: () => void}) {
  const {slug} = useTenant();
  const toast = useToast();
  const pay = useAddPayment(slug);
  const rest = Math.max(booking.price - booking.paid, 0);
  const [rub, setRub] = useState<number>(Math.round((kind === 'payment' ? rest || booking.price : booking.paid) / 100));
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer' | 'other'>('card');
  const [note, setNote] = useState('');

  const submit = async () => {
    try {
      await pay.mutateAsync({id: booking.id, kind, amount: Math.round(rub * 100), method, note});
      toast({type: 'info', body: kind === 'payment' ? `Оплата ${money(rub * 100)} записана` : `Возврат ${money(rub * 100)} записан`});
      onDone();
    } catch (e) {
      toast({type: 'error', body: (e as Error).message});
    }
  };

  return (
    <Card padding={4} variant="muted">
      <VStack gap={3}>
        <Text type="label" weight="semibold">
          {kind === 'payment' ? 'Получена оплата' : 'Возврат клиенту'}
        </Text>
        <NumberInput label="Сумма" value={rub} onChange={setRub} min={1} units="₽" isIntegerOnly />
        <SegmentedControl label="Способ" value={method} onChange={(v) => setMethod(v as typeof method)} layout="fill" size="sm">
          <SegmentedControlItem value="card" label="Карта" />
          <SegmentedControlItem value="cash" label="Наличные" />
          <SegmentedControlItem value="transfer" label="Перевод" />
        </SegmentedControl>
        <TextInput label="Комментарий" value={note} onChange={setNote} placeholder={kind === 'refund' ? 'Причина возврата' : 'Например: предоплата'} />
        <HStack gap={2}>
          <Button label={kind === 'payment' ? 'Записать оплату' : 'Записать возврат'} variant="primary" isDisabled={!rub || rub <= 0} isLoading={pay.isPending} clickAction={submit} />
          <Button label="Назад" variant="ghost" clickAction={onDone} />
        </HStack>
      </VStack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Новая запись вручную
// ---------------------------------------------------------------------------

function NewBookingDialog({settings, defaultDate, onClose}: {settings: StudioSettings; defaultDate: string; onClose: () => void}) {
  const {slug} = useTenant();
  const toast = useToast();
  const create = useOwnerCreateBooking(slug);
  const services = settings.services.filter((s) => s.isActive);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [date, setDate] = useState(defaultDate);
  const options = timeOptions(settings, date);
  const [time, setTime] = useState(options[0] ?? '10:00');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [car, setCar] = useState('');
  const [comment, setComment] = useState('');
  const requestId = useRef(crypto.randomUUID());

  const valid = serviceId && options.includes(time) && name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 10;

  const submit = async () => {
    try {
      const r = await create.mutateAsync({
        serviceId,
        startUtc: fromZonedTime(`${date} ${time}`, settings.timezone).toISOString(),
        name,
        phone,
        car,
        comment,
        requestId: requestId.current,
      });
      toast({type: 'info', body: `Запись ${r.code} добавлена`});
      onClose();
    } catch (e) {
      toast({type: 'error', body: (e as Error).message});
    }
  };

  return (
    <Dialog isOpen onOpenChange={(o) => !o && onClose()} width={520} purpose="form">
      <DialogHeader title="Новая запись" subtitle="Например, клиент позвонил по телефону" onOpenChange={(o) => !o && onClose()} />
      <VStack gap={3} padding={4}>
        <Selector
          label="Услуга"
          value={serviceId}
          onChange={(v) => setServiceId(v)}
          options={services.map((s) => ({value: s.id, label: `${s.name} — ${money(s.price)}`}))}
        />
        <DateField label="Дата" value={date} onChange={(d) => {
          setDate(d);
          const next = timeOptions(settings, d);
          if (!next.includes(time)) setTime(next[0] ?? time);
        }} />
        {options.length ? (
          <Selector label="Время" value={time} onChange={(v) => setTime(v)} options={options} />
        ) : (
          <Banner status="warning" title="В этот день студия закрыта" />
        )}
        <TextInput label="Имя клиента" value={name} onChange={setName} />
        <TextInput label="Телефон" value={phone} onChange={setPhone} placeholder="+7 900 000-00-00" />
        <TextInput label="Машина" value={car} onChange={setCar} />
        <TextArea label="Комментарий" value={comment} onChange={setComment} size="sm" />
        <Text type="supporting" color="secondary">
          Сервер проверит, свободен ли бокс, и подтвердит запись сразу.
        </Text>
        <Button label="Добавить запись" variant="primary" size="lg" isDisabled={!valid} isLoading={create.isPending} clickAction={submit} />
      </VStack>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

/** Поле даты: нативный выбор на телефоне, строка YYYY-MM-DD внутри. */
export function DateField({label, value, onChange}: {label: string; value: string; onChange: (v: string) => void}) {
  return (
    <DateInput
      label={label}
      value={value as never}
      onChange={(v) => v && onChange(String(v))}
      weekStartsOn="mon"
      format="date_weekday"
      width="100%"
    />
  );
}

/** Время начала с шагом 30 минут в рабочие часы выбранной даты. */
export function timeOptions(settings: StudioSettings, date: string): string[] {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return [];
  const w = dayWindow(settings, new Date(y, m - 1, d));
  if (!w.isOpen || w.openMin === null || w.closeMin === null) return [];
  const out: string[] = [];
  for (let t = w.openMin; t < w.closeMin; t += 30) out.push(timeFromMinutes(t));
  return out;
}

function multiDay(b: OwnerBooking, tz: string): boolean {
  return studioDate(b.starts_at, tz, 'yyyy-MM-dd') !== studioDate(b.ends_at, tz, 'yyyy-MM-dd');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
