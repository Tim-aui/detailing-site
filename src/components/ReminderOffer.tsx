import {useState} from 'react';
import {VStack} from '@astryxdesign/core/Layout';
import {Card} from '@astryxdesign/core/Card';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {AddToCalendarButton} from './AddToCalendarButton.tsx';
import {canUsePush, subscribeReminder} from '../lib/bookings.ts';
import type {IcsInput} from '../lib/ics.ts';

/**
 * «Напомнить за день».
 *
 * Где работают web push (Android, десктоп, iPhone с приложением на экране
 * «Домой») — подписываем на уведомление, его пришлёт сервер за сутки.
 * Где нет — сразу предлагаем календарь: в файле .ics напоминание за день
 * уже стоит. Календарь показываем в любом случае как запасной путь.
 */
export function ReminderOffer({slug, code, phone, event}: {slug: string; code: string; phone: string; event: IcsInput}) {
  const push = canUsePush();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const subscribe = async () => {
    setState('busy');
    try {
      await subscribeReminder(slug, code, phone);
      setState('done');
      setMessage('Готово: пришлём уведомление за день до визита.');
    } catch (e) {
      setState('error');
      setMessage(e instanceof Error ? e.message : 'Не получилось включить уведомления');
    }
  };

  return (
    <Card padding={4} width="100%">
      <VStack gap={3} hAlign="center">
        <Text type="label" weight="semibold">
          Напомнить о записи?
        </Text>
        {push && state !== 'done' ? (
          <Button
            label="Напомнить за день"
            variant="primary"
            size="lg"
            width="100%"
            isLoading={state === 'busy'}
            clickAction={subscribe}
          />
        ) : null}
        {message ? (
          <Text type="supporting" color={state === 'error' ? 'secondary' : 'primary'}>
            {message}
          </Text>
        ) : null}
        <Text type="supporting" color="secondary">
          {push
            ? 'Или добавьте в календарь — напоминание за день уже внутри.'
            : 'На этом устройстве уведомления недоступны. Добавьте запись в календарь — он напомнит за день.'}
        </Text>
        <AddToCalendarButton event={event} filename={`zapis-${code}`} />
      </VStack>
    </Card>
  );
}
