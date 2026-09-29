import {useEffect, useMemo, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {VStack, HStack, StackItem, Card, Section} from '@astryxdesign/core/Layout';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {TextArea} from '@astryxdesign/core/TextArea';
import {Selector} from '@astryxdesign/core/Selector';
import {useToast} from '@astryxdesign/core/Toast';
import {useTenant} from '../tenants/TenantContext.tsx';
import {useBusy} from '../lib/studio.ts';
import {useCreateBooking} from '../lib/bookings.ts';
import {freeSlots, groupSlotsByDate, type FreeSlot} from '../lib/schedule.ts';
import {duration, money, studioDate, studioTime} from '../lib/format.ts';
import {IconByName} from '../components/icons.tsx';
import {AddToCalendarButton} from '../components/AddToCalendarButton.tsx';
import {LoadingIndicator} from '../components/LoadingIndicator.tsx';

/**
 * Запись: услуга → дата → время → контакты.
 *
 * Слоты считаются на клиенте для отображения, но окончательную проверку
 * занятости делает сервер при создании записи. Поэтому «свободно» на
 * экране — это предложение, а не гарантия: если слот только что заняли,
 * сервер вернёт ошибку и мы предложим выбрать другой.
 */
export function BookingPage() {
  const {slug, settings} = useTenant();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const services = useMemo(
    () =>
      (settings?.services ?? [])
        .filter((s) => s.isActive)
        // Популярные выше: по умолчанию открывается самая частая услуга.
        .sort((a, b) => Number(b.isPopular) - Number(a.isPopular) || a.name.localeCompare(b.name, 'ru')),
    [settings],
  );
  const [serviceId, setServiceId] = useState(params.get('service') ?? services[0]?.id ?? '');
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<FreeSlot | null>(null);

  const [name, setName] = useState(() => localStorage.getItem('studio:name') ?? '');
  const [phone, setPhone] = useState(() => localStorage.getItem(`studio:phone:${slug}`) ?? '');
  const [car, setCar] = useState(() => localStorage.getItem('studio:car') ?? '');
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);

  const service = services.find((s) => s.id === serviceId) ?? services[0];
  const {data: busy = [], isPending} = useBusy(slug, settings?.bookingHorizonDays ?? 30);

  const slots = useMemo<FreeSlot[]>(
    () => (service ? freeSlots(settings!, service, {busy}) : []),
    [service, settings, busy],
  );
  const byDate = useMemo(() => groupSlotsByDate(slots), [slots]);

  // Услугу можно прийти сразу с карточки — синхронизируем адрес и выбор.
  useEffect(() => {
    const fromUrl = params.get('service');
    if (fromUrl && fromUrl !== serviceId) setServiceId(fromUrl);
  }, [params, serviceId]);

  useEffect(() => {
    if (serviceId) setParams((p) => ({...Object.fromEntries(p), service: serviceId}), {replace: true});
  }, [serviceId, setParams]);

  // Смена услуги или даты сбрасывает выбранное время: оно belonged старой услуге.
  useEffect(() => {
    setSlot(null);
    if (date && !byDate.some((d) => d.date === date)) setDate(byDate[0]?.date ?? null);
  }, [serviceId, byDate, date]);

  useEffect(() => {
    if (date === null && byDate.length > 0) setDate(byDate[0].date);
  }, [byDate, date]);

  const create = useCreateBooking();

  const nameError = touched && name.trim().length < 2 ? 'Как к вам обращаться?' : undefined;
  const phoneError = touched && !isPhone(phone) ? 'Нужен телефон, чтобы подтвердить запись' : undefined;
  const canSubmit = Boolean(service && slot && name.trim().length >= 2 && isPhone(phone));

  if (!settings || !service) return null;

  const submit = async () => {
    setTouched(true);
    if (!canSubmit || !slot || !service) return;
    localStorage.setItem('studio:name', name.trim());
    localStorage.setItem(`studio:phone:${slug}`, phone.trim());
    localStorage.setItem('studio:car', car.trim());
    try {
      await create.mutateAsync({
        serviceId: service.id,
        serviceName: service.name,
        startUtc: slot.startUtc,
        endUtc: slot.endUtc,
        price: service.price,
        contactName: name.trim(),
        contactPhone: phone.trim(),
        car: car.trim(),
        comment: comment.trim() || undefined,
      });
    } catch (e) {
      toast({
        type: 'error',
        body: `Не получилось записаться. ${e instanceof Error ? e.message : 'Попробуйте другое время'}`,
      });
    }
  };

  if (create.data) {
    return <BookingDone code={create.data.code} startUtc={create.data.startUtc} endUtc={create.data.endUtc} serviceName={service.name} />;
  }

  return (
    <main className="shell" style={{paddingTop: 8}}>
      <Section>
        <VStack gap={5}>
          <VStack gap={2}>
            <Heading level={1}>Запись в студию</Heading>
            <Text type="body" color="secondary">
              {settings.name} · время студии {settings.timezone}
            </Text>
          </VStack>

          {/* 1. Услуга */}
          <Card padding={4}>
            <VStack gap={3}>
              <Text type="label" weight="semibold">
                1. Услуга
              </Text>
              <Selector
                label="Выберите услугу"
                value={service.id}
                onChange={setServiceId}
                options={services.map((s) => ({
                  value: s.id,
                  label: `${s.name} — ${money(s.price)}`,
                  description: duration(s.durationMin, s.days),
                }))}
              />
            </VStack>
          </Card>

          {/* 2. Дата */}
          <Card padding={4}>
            <VStack gap={3}>
              <Text type="label" weight="semibold">
                2. Дата
              </Text>
              {isPending ? (
                <LoadingIndicator label="Смотрим занятость" />
              ) : byDate.length === 0 ? (
                <NoSlots serviceName={service.name} horizonDays={settings.bookingHorizonDays} />
              ) : (
                <div className="date-strip" role="radiogroup" aria-label="Дата записи">
                  {byDate.slice(0, 14).map((d) => (
                    <button
                      key={d.date}
                      type="button"
                      role="radio"
                      aria-checked={date === d.date}
                      className="date-chip"
                      onClick={() => setDate(d.date)}
                    >
                      <span className="date-chip__day">{dayLabel(d.date, settings.timezone)}</span>
                      <span className="date-chip__count">{d.slots.length} окон</span>
                    </button>
                  ))}
                </div>
              )}
            </VStack>
          </Card>

          {/* 3. Время */}
          {date && byDate.some((d) => d.date === date) ? (
            <Card padding={4}>
              <VStack gap={3}>
                <Text type="label" weight="semibold">
                  3. Время
                </Text>
                <div className="slot-grid" role="radiogroup" aria-label="Время записи">
                  {slots
                    .filter((s) => s.date === date)
                    .map((s) => (
                      <button
                        key={s.startUtc}
                        type="button"
                        role="radio"
                        aria-checked={slot?.startUtc === s.startUtc}
                        className="slot"
                        onClick={() => setSlot(s)}
                      >
                        <span className="slot__time">{s.label}</span>
                        {s.boxesFree <= 1 ? <span className="slot__note">последний бокс</span> : null}
                      </button>
                    ))}
                </div>
                {slot ? (
                  <Text type="supporting" color="secondary">
                    Выбрано: {studioDate(slot.startUtc, settings.timezone, 'd MMMM')} в{' '}
                    {studioTime(slot.startUtc, settings.timezone)}
                  </Text>
                ) : null}
              </VStack>
            </Card>
          ) : null}

          {/* 4. Контакты */}
          <Card padding={4}>
            <VStack gap={3}>
              <Text type="label" weight="semibold">
                4. Контакты
              </Text>
              <TextInput
                label="Как к вам обращаться"
                value={name}
                onChange={setName}
                isRequired
                status={nameError ? {type: 'error', message: nameError} : undefined}
                placeholder="Иван"
              />
              <TextInput
                label="Телефон"
                value={phone}
                onChange={setPhone}
                isRequired
                type="text"
                placeholder="+7 900 000-00-00"
                description="Пришлём подтверждение и напомним о записи"
                status={phoneError ? {type: 'error', message: phoneError} : undefined}
              />
              <TextInput
                label="Автомобиль"
                value={car}
                onChange={setCar}
                isOptional
                placeholder="BMW X5, 2021"
              />
              <TextArea
                label="Пожелания"
                value={comment}
                onChange={setComment}
                isOptional
                placeholder="Например: нужно убрать битую плёнку с капота"
                size="sm"
              />
            </VStack>
          </Card>

          <Card padding={4} className="booking-cta-card">
            <VStack gap={3}>
              <HStack gap={3} style={{justifyContent: 'space-between', flexWrap: 'wrap'}}>
                <VStack gap={0}>
                  <Text type="supporting" color="secondary">
                    {service.name} · {duration(service.durationMin, service.days)}
                  </Text>
                  <Text type="label" weight="bold">
                    {money(service.price)}
                  </Text>
                </VStack>
                <StackItem>
                  <Button
                    label={create.isPending ? 'Записываем…' : 'Записаться'}
                    variant="primary"
                    size="lg"
                    isDisabled={!canSubmit}
                    isLoading={create.isPending}
                    clickAction={submit}
                    className="booking-cta-btn"
                  />
                </StackItem>
              </HStack>
              <Text type="supporting" color="disabled">
                Итоговую сумму студия подтвердит по телефону. Предоплата не требуется.
              </Text>
            </VStack>
          </Card>
        </VStack>
      </Section>
    </main>
  );
}

function NoSlots({serviceName, horizonDays}: {serviceName: string; horizonDays: number}) {
  return (
    <VStack gap={2} style={{alignItems: 'center', textAlign: 'center', paddingBlock: 12}}>
      <IconByName name="calendar" size={28} />
      <Text type="label" weight="semibold">
        Свободного времени нет
      </Text>
      <Text type="supporting" color="secondary">
        На «{serviceName}» в ближайшие {horizonDays} дней окон нет. Позвоните — подберём время вручную.
      </Text>
    </VStack>
  );
}

function BookingDone({
  code,
  startUtc,
  endUtc,
  serviceName,
}: {
  code: string;
  startUtc: string;
  endUtc: string;
  serviceName: string;
}) {
  const {settings} = useTenant();
  return (
    <main className="shell" style={{paddingTop: 8}}>
      <Section>
        <VStack gap={5} style={{alignItems: 'center', textAlign: 'center'}}>
          <span
            aria-hidden
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 68,
              height: 68,
              borderRadius: '50%',
              background: 'rgba(52,199,89,0.15)',
              color: '#34c759',
            }}
          >
            <IconByName name="success" size={38} weight="fill" />
          </span>
          <VStack gap={2}>
            <Heading level={1} type="display-3">
              Вы записаны
            </Heading>
            <Text type="body" color="secondary">
              {serviceName} · {settings ? studioDate(startUtc, settings.timezone, 'd MMMM') : ''} в{' '}
              {settings ? studioTime(startUtc, settings.timezone) : ''}
            </Text>
          </VStack>

          <Card padding={4}>
            <VStack gap={2}>
              <Text type="supporting" color="secondary">
                Код записи
              </Text>
              <Text type="display-2" weight="bold" hasTabularNumbers>
                {code}
              </Text>
              <Text type="supporting" color="disabled">
                Назовите его по телефону — студия увидит запись сразу.
              </Text>
            </VStack>
          </Card>

          {/* Уведомления могут быть отключены в системе, поэтому всегда
              даём запасной путь — файл календаря. */}
          <AddToCalendarButton
            event={{
              uid: code,
              title: `${serviceName} — ${settings?.name ?? 'Студия'}`,
              description: `Код записи: ${code}`,
              location: settings?.address.full,
              url: typeof window !== 'undefined' ? window.location.href : undefined,
              startUtc,
              endUtc,
            }}
            filename={`zapis-${code}`}
          />
        </VStack>
      </Section>
    </main>
  );
}

function isPhone(v: string): boolean {
  return v.replace(/\D/g, '').length >= 10;
}

function dayLabel(date: string, tz: string): string {
  // 2 буквы: пн, вт, ср, чт, пт, сб, вс
  return studioDate(`${date}T12:00:00Z`, tz, 'EE d MMM');
}
