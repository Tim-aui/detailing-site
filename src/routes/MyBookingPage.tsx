import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {VStack, HStack, Card, Section} from '@astryxdesign/core/Layout';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {useToast} from '@astryxdesign/core/Toast';
import {useTenant} from '../tenants/TenantContext.tsx';
import {useCancelBooking, useMyBookings} from '../lib/bookings.ts';
import {money, studioDate, studioDateTime} from '../lib/format.ts';
import {duration} from '../lib/format.ts';
import {IconByName} from '../components/icons.tsx';
import {AddToCalendarButton} from '../components/AddToCalendarButton.tsx';
import {LoadingIndicator} from '../components/LoadingIndicator.tsx';
import type {BookingRow} from '../lib/types.ts';

const STATUS = {
  pending: {label: 'Ждёт подтверждения', variant: 'warning', icon: 'pending'},
  confirmed: {label: 'Подтверждена', variant: 'success', icon: 'success'},
  in_progress: {label: 'В работе', variant: 'info', icon: 'wrench'},
  done: {label: 'Готово', variant: 'neutral', icon: 'check'},
  cancelled: {label: 'Отменена', variant: 'neutral', icon: 'error'},
} as const;

/** Записи клиента. Показываются по номеру телефона, введённому при записи. */
export function MyBookingPage() {
  const {slug, settings} = useTenant();
  const navigate = useNavigate();
  const toast = useToast();
  const {data: bookings, isPending} = useMyBookings();
  const cancel = useCancelBooking();
  const [confirming, setConfirming] = useState<string | null>(null);

  const active = (bookings ?? []).filter((b) => b.status !== 'cancelled' && b.status !== 'done');
  const past = (bookings ?? []).filter((b) => b.status === 'done' || b.status === 'cancelled');

  return (
    <main className="shell" style={{paddingTop: 8}}>
      <Section>
        <VStack gap={5}>
          <VStack gap={2}>
            <Heading level={1}>Моя запись</Heading>
            <Text type="body" color="secondary">
              {settings?.name} — история записей на этот телефон.
            </Text>
          </VStack>

          {isPending ? (
            <LoadingIndicator label="Ищем записи" />
          ) : active.length === 0 && past.length === 0 ? (
            <Card padding={5}>
              <VStack gap={3} style={{alignItems: 'center', textAlign: 'center'}}>
                <IconByName name="clipboard" size={30} />
                <Text type="label" weight="semibold">
                  Записей пока нет
                </Text>
                <Text type="supporting" color="secondary">
                  Выберите услугу и время — запись появится здесь с кодом подтверждения.
                </Text>
                <Button
                  label="Записаться"
                  variant="primary"
                  size="md"
                  clickAction={() => navigate(`/s/${slug}/booking`)}
                />
              </VStack>
            </Card>
          ) : (
            <>
              {active.length > 0 ? (
                <VStack gap={3}>
                  <Text type="label" weight="semibold">
                    Ближайшие
                  </Text>
                  {active.map((b) => (
                    <BookingCard
                      key={b.id}
                      booking={b}
                      tz={settings?.timezone ?? 'Europe/Moscow'}
                      isConfirming={confirming === b.code}
                      onCancel={() => setConfirming(b.code)}
                      onConfirmCancel={() => {
                        cancel.mutate(
                          {code: b.code},
                          {
                            onSuccess: () => {
                              setConfirming(null);
                              toast({type: 'info', body: 'Запись отменена'});
                            },
                            onError: (e) =>
                              toast({type: 'error', body: `Не удалось отменить. ${e.message}`}),
                          },
                        );
                      }}
                      onKeep={() => setConfirming(null)}
                    />
                  ))}
                </VStack>
              ) : null}

              {past.length > 0 ? (
                <VStack gap={3}>
                  <Text type="label" weight="semibold" color="secondary">
                    История
                  </Text>
                  {past.map((b) => (
                    <BookingCard key={b.id} booking={b} tz={settings?.timezone ?? 'Europe/Moscow'} />
                  ))}
                </VStack>
              ) : null}
            </>
          )}
        </VStack>
      </Section>
    </main>
  );
}

function BookingCard({
  booking,
  tz,
  isConfirming,
  onCancel,
  onConfirmCancel,
  onKeep,
}: {
  booking: BookingRow;
  tz: string;
  isConfirming?: boolean;
  onCancel?: () => void;
  onConfirmCancel?: () => void;
  onKeep?: () => void;
}) {
  const status = STATUS[booking.status];
  const minutes = Math.round((new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime()) / 60_000);
  const isActive = booking.status === 'pending' || booking.status === 'confirmed' || booking.status === 'in_progress';

  return (
    <Card padding={4}>
      <VStack gap={3}>
        <HStack gap={3} style={{justifyContent: 'space-between', flexWrap: 'wrap'}}>
          <VStack gap={0}>
            <Text type="label" weight="semibold">
              {booking.service_name}
            </Text>
            <Text type="supporting" color="secondary">
              {studioDateTime(booking.starts_at, tz)} · {duration(minutes)}
            </Text>
          </VStack>
          <Badge variant={status.variant} label={status.label} />
        </HStack>

        <HStack gap={4} style={{flexWrap: 'wrap', justifyContent: 'space-between'}}>
          <Text type="supporting" color="disabled">
            Код <b>{booking.code}</b>
            {booking.car ? ` · ${booking.car}` : ''}
          </Text>
          <Text type="label" weight="semibold">
            {money(booking.price)}
          </Text>
        </HStack>

        {isActive ? (
          <AddToCalendarButton
            event={{
              uid: booking.code,
              title: `${booking.service_name} — студия`,
              description: `Код записи: ${booking.code}`,
              startUtc: booking.starts_at,
              endUtc: booking.ends_at,
            }}
            filename={`zapis-${booking.code}`}
          />
        ) : null}

        {isActive && onCancel ? (
          isConfirming ? (
            <VStack gap={2}>
              <Text type="supporting" color="secondary">
                Отменить запись {studioDate(booking.starts_at, tz, 'd MMM')} в{' '}
                {new Date(booking.starts_at).toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: tz,
                })}
                ?
              </Text>
              <HStack gap={3}>
                <Button label="Да, отменить" variant="secondary" size="md" clickAction={onConfirmCancel} />
                <Button label="Оставить" variant="ghost" size="md" clickAction={onKeep} />
              </HStack>
            </VStack>
          ) : (
            <Button label="Отменить запись" variant="ghost" size="md" clickAction={onCancel} />
          )
        ) : null}
      </VStack>
    </Card>
  );
}
