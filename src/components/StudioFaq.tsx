import {Link} from 'react-router-dom';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {VStack, HStack, Card, Section} from '@astryxdesign/core/Layout';
import {CollapsibleGroup, Collapsible} from '@astryxdesign/core/Collapsible';
import type {StudioSettings} from '../tenants/schema.ts';
import type {FreeSlot} from '../lib/schedule.ts';
import {duration, money, studioDay, studioTime} from '../lib/format.ts';

/**
 * «Частые вопросы» на главной.
 *
 * Ответы собираются из настроек студии и живого расписания прямо в
 * браузере: без модели, без запросов на сервер и без затрат. Поэтому они
 * всегда совпадают с тем, что владелец указал в кабинете (цены, правила
 * отмены, телефон), и не могут ничего выдумать.
 */
export function StudioFaq({slug, cfg, nextFree}: {slug: string; cfg: StudioSettings; nextFree: (FreeSlot & {serviceId: string}) | null}) {
  const active = cfg.services.filter((s) => s.isActive);
  // Сначала популярные, дальше по цене: так в ответ попадает главное.
  const top = [...active]
    .sort((a, b) => Number(b.isPopular) - Number(a.isPopular) || a.price - b.price)
    .slice(0, 5);
  const nextService = nextFree ? active.find((s) => s.id === nextFree.serviceId) : undefined;
  const freeHours = cfg.cancellation.freeCancelHours;
  const tel = cfg.phone.replace(/[^\d+]/g, '');

  const items: {id: string; q: string; a: React.ReactNode}[] = [
    {
      id: 'next',
      q: 'Когда ближайшее свободное время?',
      a: nextFree ? (
        <>
          <Text type="body" color="secondary">
            {capitalize(studioDay(nextFree.startUtc, cfg.timezone))} в {studioTime(nextFree.startUtc, cfg.timezone)}
            {nextService ? `, услуга «${nextService.name}»` : ''}. Для долгих работ окно может быть позже: точное время
            видно после выбора услуги.
          </Text>
          <FaqLink to={`/s/${slug}/booking`}>Выбрать время</FaqLink>
        </>
      ) : (
        <>
          <Text type="body" color="secondary">
            Ближайшие дни заняты. Позвоните, и студия подберёт время.
          </Text>
          <FaqLink href={`tel:${tel}`}>{cfg.phone}</FaqLink>
        </>
      ),
    },
    {
      id: 'price',
      q: 'Сколько стоят услуги и сколько длится работа?',
      a: (
        <>
          <VStack gap={1}>
            {top.map((s) => (
              <HStack key={s.id} gap={3} style={{justifyContent: 'space-between'}}>
                <Text type="body" color="secondary">
                  {s.name}
                </Text>
                <Text type="body" color="primary" style={{whiteSpace: 'nowrap'}}>
                  {money(s.price)} · {duration(s.durationMin, s.days)}
                </Text>
              </HStack>
            ))}
          </VStack>
          {active.length > top.length ? <FaqLink to={`/s/${slug}/services`}>Все услуги и цены</FaqLink> : null}
        </>
      ),
    },
    {
      id: 'prepay',
      q: 'Нужна ли предоплата?',
      a: (
        <Text type="body" color="secondary">
          Нет. После записи студия перезвонит и подтвердит итоговую сумму, оплата в студии.
        </Text>
      ),
    },
    {
      id: 'cancel',
      q: 'Можно ли перенести или отменить запись?',
      a: (
        <>
          <Text type="body" color="secondary">
            {freeHours > 0
              ? `Да, бесплатно не позднее чем за ${freeHours} ${plural(freeHours, 'час', 'часа', 'часов')} до визита.`
              : 'Да, в любое время до визита.'}{' '}
            Отменить можно самому в разделе «Моя запись», перенести по телефону.
            {cfg.cancellation.note ? ` ${cfg.cancellation.note}` : ''}
          </Text>
          <FaqLink to={`/s/${slug}/my-booking`}>Моя запись</FaqLink>
        </>
      ),
    },
    {
      id: 'contact',
      q: 'Как связаться со студией?',
      a: (
        <>
          <Text type="body" color="secondary">
            Позвоните или напишите{cfg.messengers.length ? ` (${cfg.messengers.map(messengerName).join(', ')})` : ''}.
          </Text>
          <FaqLink href={`tel:${tel}`}>{cfg.phone}</FaqLink>
        </>
      ),
    },
  ];

  return (
    <Section>
      <VStack gap={4}>
        <Heading level={2}>Частые вопросы</Heading>
        <Card padding={2}>
          <CollapsibleGroup type="single" hasDividers>
            {items.map((it) => (
              <Collapsible
                key={it.id}
                value={it.id}
                trigger={
                  <Text type="label" weight="semibold" style={{lineHeight: 1.35, display: 'block', padding: '4px 0'}}>
                    {it.q}
                  </Text>
                }
              >
                <VStack gap={2} style={{paddingBottom: 8}}>
                  {it.a}
                </VStack>
              </Collapsible>
            ))}
          </CollapsibleGroup>
        </Card>
      </VStack>
    </Section>
  );
}

function FaqLink({to, href, children}: {to?: string; href?: string; children: React.ReactNode}) {
  return (
    <Text type="body">
      {to ? (
        <Link to={to} className="text-link">
          {children}
        </Link>
      ) : (
        <a href={href} className="text-link">
          {children}
        </a>
      )}
    </Text>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function messengerName(m: string): string {
  return {whatsapp: 'WhatsApp', telegram: 'Telegram', viber: 'Viber', sms: 'SMS'}[m] ?? m;
}
