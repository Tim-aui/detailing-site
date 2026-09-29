import {useMemo, useState} from 'react';
import {VStack, HStack} from '@astryxdesign/core/Layout';
import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {List, ListItem} from '@astryxdesign/core/List';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {useTenant} from '../../tenants/TenantContext.tsx';
import {money, studioDate} from '../../lib/format.ts';
import {LoadingIndicator} from '../../components/LoadingIndicator.tsx';
import {periodFor, shiftDate, todayIn, useOwnerPayments, useOwnerStats} from '../../lib/owner.ts';

const METHOD = {cash: 'наличные', card: 'карта', transfer: 'перевод', other: 'другое'} as const;

/** Реально полученные деньги: оплаты и возвраты за период. */
export function AdminMoney() {
  const {slug, settings} = useTenant();
  const tz = settings?.timezone ?? 'Europe/Moscow';
  const [kind, setKind] = useState<'day' | 'week'>('week');
  const [anchor, setAnchor] = useState(() => todayIn(tz));
  const period = useMemo(() => periodFor(kind, anchor, tz), [kind, anchor, tz]);
  const stats = useOwnerStats(slug, period);
  const payments = useOwnerPayments(slug, period);

  const title =
    kind === 'day'
      ? studioDate(period.from.toISOString(), tz, 'd MMMM')
      : `${studioDate(period.from.toISOString(), tz, 'd MMM')} — ${studioDate(new Date(period.to.getTime() - 1).toISOString(), tz, 'd MMM')}`;

  return (
    <VStack gap={4}>
      <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
        <SegmentedControl label="Период" value={kind} onChange={(v) => setKind(v as 'day' | 'week')}>
          <SegmentedControlItem value="day" label="День" />
          <SegmentedControlItem value="week" label="Неделя" />
        </SegmentedControl>
        <HStack gap={2}>
          <Button label="‹" variant="ghost" size="sm" clickAction={() => setAnchor(shiftDate(anchor, kind === 'day' ? -1 : -7))} />
          <Button label="Сегодня" variant="secondary" size="sm" clickAction={() => setAnchor(todayIn(tz))} />
          <Button label="›" variant="ghost" size="sm" clickAction={() => setAnchor(shiftDate(anchor, kind === 'day' ? 1 : 7))} />
        </HStack>
      </HStack>
      <Heading level={2}>Деньги · {title}</Heading>

      <Grid columns={{minWidth: 170}} gap={3}>
        <Card padding={4}>
          <VStack gap={1}>
            <Text type="supporting" color="secondary">Получено</Text>
            <Text type="large" weight="bold" hasTabularNumbers style={{fontSize: 'clamp(20px, 5.4vw, 26px)', lineHeight: 1.15, whiteSpace: 'nowrap'}}>{stats.data ? money(stats.data.received) : '—'}</Text>
            <Text type="supporting" color="secondary">оплаты минус возвраты</Text>
          </VStack>
        </Card>
        <Card padding={4}>
          <VStack gap={1}>
            <Text type="supporting" color="secondary">Возвраты</Text>
            <Text type="large" weight="bold" hasTabularNumbers style={{fontSize: 'clamp(20px, 5.4vw, 26px)', lineHeight: 1.15, whiteSpace: 'nowrap'}}>{stats.data ? money(stats.data.refunds) : '—'}</Text>
            <Text type="supporting" color="secondary">за период</Text>
          </VStack>
        </Card>
        <Card padding={4}>
          <VStack gap={1}>
            <Text type="supporting" color="secondary">По прайсу</Text>
            <Text type="large" weight="bold" hasTabularNumbers style={{fontSize: 'clamp(20px, 5.4vw, 26px)', lineHeight: 1.15, whiteSpace: 'nowrap'}}>{stats.data ? money(stats.data.expected) : '—'}</Text>
            <Text type="supporting" color="secondary">записи периода без отмен</Text>
          </VStack>
        </Card>
      </Grid>

      {payments.isPending ? (
        <LoadingIndicator label="Загружаем оплаты" />
      ) : !payments.data?.length ? (
        <Card padding={5}>
          <EmptyState title="Оплат за период нет" description="Оплату и возврат записывают в карточке записи: «Записи» → запись → «Оплата»." />
        </Card>
      ) : (
        <Card padding={2}>
          <List hasDividers>
            {payments.data.map((p) => (
              <ListItem
                key={p.id}
                label={`${p.kind === 'refund' ? '−' : '+'}${money(p.amount)} · ${METHOD[p.method]}`}
                description={`${studioDate(p.created_at, tz, 'd MMM, HH:mm')}${p.booking_code ? ` · ${p.booking_code}` : ''}${p.service_name ? ` · ${p.service_name}` : ''}${p.contact_name ? ` · ${p.contact_name}` : ''}${p.note ? ` · ${p.note}` : ''}`}
                endContent={<Badge variant={p.kind === 'refund' ? 'warning' : 'success'} label={p.kind === 'refund' ? 'возврат' : 'оплата'} />}
              />
            ))}
          </List>
        </Card>
      )}
    </VStack>
  );
}
