import {Link, useNavigate} from 'react-router-dom';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {VStack, HStack, StackItem, Card, Section} from '@astryxdesign/core/Layout';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {Reveal, useParallax} from '../lib/motion.tsx';
import {useTenant} from '../tenants/TenantContext.tsx';
import {IconByName, ServiceIcon} from '../components/icons.tsx';
import {money, duration, hoursLabel, dayName, isOpenNow, mapLink, studioDay, studioTime} from '../lib/format.ts';
import {AssistantTeaser} from '../components/AssistantTeaser.tsx';
import {useMemo} from 'react';
import {freeSlots} from '../lib/schedule.ts';
import {useBusy} from '../lib/studio.ts';
import type {BusyBlock} from '../lib/schedule.ts';
import {photoUrl} from '../tenants/schema.ts';

const NO_BUSY: BusyBlock[] = [];

/**
 * Главная страница студии.
 *
 * Первый экран: большое фото машины, название, описание и широкая
 * кнопка записи. Кнопка лежит в собственном слое и едет вместе
 * с фотографией — параллакс двигает только `.hero__media`, а не кнопку.
 */
export function HomePage() {
  const {slug, settings} = useTenant();
  const navigate = useNavigate();
  const mediaRef = useParallax(0.16);
  const cfg = settings;
  const {data: busy = NO_BUSY} = useBusy(slug, cfg?.bookingHorizonDays ?? 30);

  const services = useMemo(
    () => (cfg?.services ?? []).filter((s) => s.isActive).sort((a, b) => Number(b.isPopular) - Number(a.isPopular)),
    [cfg],
  );
  const gallery = useMemo(
    () => [...(cfg?.gallery ?? [])].sort((a, b) => a.order - b.order),
    [cfg],
  );

  // Ближайшее свободное окно — показываем сразу, чтобы не искать вручную.
  const nextFree = useMemo(() => {
    if (!cfg) return null;
    const all = services.flatMap((service) =>
      freeSlots(cfg, service, {busy, horizonDays: cfg.bookingHorizonDays, now: new Date()}).map((slot) => ({
        ...slot,
        serviceId: service.id,
      })),
    );
    if (all.length === 0) return null;
    return all.sort((a, b) => a.startUtc.localeCompare(b.startUtc))[0];
  }, [cfg, services, busy]);

  if (!cfg) return null;
  const heroUrl = photoUrl(slug, cfg.heroPhoto);

  return (
    <>
      <header className="hero">
        <div className="hero__media" ref={mediaRef} aria-hidden>
          <img src={heroUrl} alt="" fetchPriority="high" decoding="async" />
        </div>

        <div className="shell hero__inner">
          <VStack gap={3}>
            {cfg.logo ? <img className="hero__logo" src={photoUrl(slug, cfg.logo)} alt={`Логотип ${cfg.name}`} /> : null}
            {/* Обёртка не даёт бейджу растянуться на всю ширину VStack. */}
            <div style={{alignSelf: 'flex-start'}}>
              {isOpenNow(cfg) ? (
                <Badge variant="success" label="Открыто сейчас" />
              ) : (
                <Badge variant="neutral" label="Сейчас закрыто" />
              )}
            </div>
            <Heading level={1} type="display-2" textWrap="balance">
              {cfg.name}
            </Heading>
            {cfg.tagline ? (
              <Text type="large" color="secondary" textWrap="balance">
                {cfg.tagline}
              </Text>
            ) : null}
          </VStack>

          <Link to={`/s/${slug}/booking`} className="hero__cta glass tap">
            <span className="hero__cta-text">
              <span className="hero__cta-label">Записаться онлайн</span>
              <span className="hero__cta-hint">
                {nextFree
                  ? `Ближайшее окно: ${studioDay(nextFree.startUtc, cfg.timezone)}, ${studioTime(nextFree.startUtc, cfg.timezone)}`
                  : 'Выберите удобное время'}
              </span>
            </span>
            <span className="hero__cta-icon" aria-hidden>
              <IconByName name="arrow" size={22} weight="bold" />
            </span>
          </Link>
        </div>
      </header>

      <main>
        {/* Описание */}
        <Reveal as="section" className="shell" style={{paddingTop: 8}}>
          <Section>
            <VStack gap={3}>
              {cfg.description ? (
                <Text type="body" color="secondary">
                  {cfg.description}
                </Text>
              ) : null}
              <HStack gap={3} style={{flexWrap: 'wrap'}}>
                <Button
                  label="Записаться"
                  variant="primary"
                  size="lg"
                  clickAction={() => navigate(`/s/${slug}/booking`)}
                />
                <Button
                  label="Услуги и цены"
                  variant="secondary"
                  size="lg"
                  clickAction={() => navigate(`/s/${slug}/services`)}
                />
              </HStack>
            </VStack>
          </Section>
        </Reveal>

        {/* Услуги и цены */}
        <Reveal as="section" className="shell">
          <Section>
            <VStack gap={4}>
              <Heading level={2}>Услуги и цены</Heading>
              <VStack gap={3} role="list">
                {services.slice(0, 4).map((s) => (
                  <Card key={s.id} role="listitem" padding={4}>
                    <HStack gap={4} style={{alignItems: 'flex-start'}}>
                      <StackItem>
                        <span
                          aria-hidden
                          style={{
                            display: 'grid',
                            placeItems: 'center',
                            width: 44,
                            height: 44,
                            borderRadius: 14,
                            background: 'rgba(70,144,255,0.14)',
                            color: 'var(--color-accent, #4690FF)',
                            flexShrink: 0,
                          }}
                        >
                          <ServiceIcon name={s.icon} />
                        </span>
                      </StackItem>
                      <StackItem style={{flex: 1, minWidth: 0}}>
                        <VStack gap={1}>
                          <HStack gap={2} style={{flexWrap: 'wrap'}}>
                            <Text type="label" weight="semibold">
                              {s.name}
                            </Text>
                            {s.isPopular ? <Badge variant="info" label="Хит" /> : null}
                          </HStack>
                          {s.description ? (
                            <Text type="supporting" color="secondary">
                              {s.description}
                            </Text>
                          ) : null}
                          <Text type="supporting" color="disabled">
                            {duration(s.durationMin, s.days)}
                            {s.days > 1 ? ` · ${s.days} дн подряд` : ''}
                          </Text>
                        </VStack>
                      </StackItem>
                      <StackItem>
                        <Text type="label" weight="bold" display="block" style={{whiteSpace: 'nowrap'}}>
                          {money(s.price)}
                        </Text>
                      </StackItem>
                    </HStack>
                  </Card>
                ))}
              </VStack>
              {services.length > 4 ? (
                <Link to={`/s/${slug}/services`}>
                  <Text type="label" color="accent" weight="semibold">
                    Все {services.length} услуг и цены
                  </Text>
                </Link>
              ) : null}
            </VStack>
          </Section>
        </Reveal>

        {/* Три карточки */}
        {cfg.infoCards.length ? (
          <Reveal as="section" className="shell">
            <Section>
              <VStack gap={4}>
                <Heading level={2}>Почему к нам</Heading>
                <VStack gap={3}>
                  {cfg.infoCards.map((c) => (
                    <Card key={c.id} padding={4}>
                      <VStack gap={2}>
                        <HStack gap={3}>
                          <span
                            aria-hidden
                            style={{
                              display: 'grid',
                              placeItems: 'center',
                              width: 36,
                              height: 36,
                              borderRadius: 11,
                              background: 'rgba(70,144,255,0.14)',
                              color: 'var(--color-accent, #4690FF)',
                              flexShrink: 0,
                            }}
                          >
                            <IconByName name={c.icon} size={20} />
                          </span>
                          <Text type="label" weight="semibold">
                            {c.title}
                          </Text>
                        </HStack>
                        {c.text ? (
                          <Text type="supporting" color="secondary">
                            {c.text}
                          </Text>
                        ) : null}
                      </VStack>
                    </Card>
                  ))}
                </VStack>
              </VStack>
            </Section>
          </Reveal>
        ) : null}

        {/* Работы */}
        {gallery.length ? (
          <Reveal as="section" className="shell">
            <Section>
              <VStack gap={4}>
                <Heading level={2}>Наши работы</Heading>
                <VStack gap={4}>
                  {gallery.map((item) => (
                    <figure key={item.id} style={{margin: 0}}>
                      <img
                        src={photoUrl(slug, item.photo)}
                        alt={item.caption || `Работа студии ${item.order}`}
                        loading="lazy"
                        decoding="async"
                        style={{
                          width: '100%',
                          aspectRatio: '4 / 3',
                          objectFit: 'cover',
                          borderRadius: 'var(--radius-container, 20px)',
                          display: 'block',
                        }}
                      />
                      {item.caption ? (
                        <figcaption style={{marginTop: 8}}>
                          <Text type="supporting" color="secondary">
                            {item.caption}
                          </Text>
                        </figcaption>
                      ) : null}
                    </figure>
                  ))}
                </VStack>
              </VStack>
            </Section>
          </Reveal>
        ) : null}

        {/* ИИ-помощник — только если включён в studio.json (assistantEnabled) */}
        {cfg.assistantEnabled ? (
          <Reveal as="section" className="shell">
            <AssistantTeaser />
          </Reveal>
        ) : null}

        {/* Адрес и часы */}
        <Reveal as="section" className="shell">
          <Section>
            <VStack gap={4}>
              <Heading level={2}>Как нас найти</Heading>
              <Card padding={4}>
                <VStack gap={4}>
                  <VStack gap={1}>
                    <HStack gap={2}>
                      <IconByName name="pin" size={20} />
                      <Text type="label" weight="semibold">
                        {cfg.address.full || [cfg.address.city, cfg.address.street].filter(Boolean).join(', ')}
                      </Text>
                    </HStack>
                    {cfg.address.directionsNote ? (
                      <Text type="supporting" color="secondary">
                        {cfg.address.directionsNote}
                      </Text>
                    ) : null}
                    {mapLink(cfg) ? (
                      <a
                        href={mapLink(cfg)!}
                        target="_blank"
                        rel="noreferrer"
                        style={{color: 'var(--color-accent, #4690FF)'}}
                      >
                        <Text type="label" color="accent" weight="semibold">
                          Открыть на карте
                        </Text>
                      </a>
                    ) : null}
                  </VStack>

                  <VStack gap={2}>
                    <HStack gap={2}>
                      <IconByName name="clock" size={20} />
                      <Text type="label" weight="semibold">
                        Часы работы
                      </Text>
                    </HStack>
                    <VStack gap={1} role="list">
                      {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                        const h = cfg.hours.find((x) => x.day === d)!;
                        const closed = h.open === null;
                        return (
                          <HStack key={d} gap={3} role="listitem" style={{justifyContent: 'space-between'}}>
                            <Text type="supporting" color="secondary">
                              {dayName(d)}
                            </Text>
                            <Text
                              type="supporting"
                              color={closed ? 'disabled' : 'primary'}
                              hasTabularNumbers
                            >
                              {hoursLabel(h)}
                            </Text>
                          </HStack>
                        );
                      })}
                    </VStack>
                    <Text type="supporting" color="disabled">
                      Время указано по часовому поясу студии ({cfg.timezone}).
                    </Text>
                  </VStack>

                  <VStack gap={2}>
                    <HStack gap={2}>
                      <IconByName name="phone" size={20} />
                      <a href={`tel:${cfg.phone.replace(/[^\d+]/g, '')}`} style={{color: 'inherit'}}>
                        <Text type="label" weight="semibold">
                          {cfg.phone}
                        </Text>
                      </a>
                    </HStack>
                    {cfg.messengers.length ? (
                      <HStack gap={3}>
                        {cfg.messengers.map((m) => (
                          <a
                            key={m}
                            href={messengerHref(cfg.phone, m)}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Написать в ${m}`}
                            style={{color: 'var(--color-accent, #4690FF)', display: 'inline-flex'}}
                          >
                            <IconByName name={m} size={24} />
                          </a>
                        ))}
                      </HStack>
                    ) : null}
                  </VStack>
                </VStack>
              </Card>
            </VStack>
          </Section>
        </Reveal>

        {/* Финальный призыв */}
        <Reveal as="section" className="shell">
          <Section>
            <VStack gap={4} style={{alignItems: 'center', textAlign: 'center', paddingBlock: 12}}>
              <Heading level={2} type="display-3" textWrap="balance">
                Готовы записать машину?
              </Heading>
              <Text type="body" color="secondary" style={{maxWidth: 420}}>
                Выберите услугу и удобное время — занятые слоты сразу отмечены.
              </Text>
              <Button
                label="Записаться в студию"
                variant="primary"
                size="lg"
                width="100%"
                clickAction={() => navigate(`/s/${slug}/booking`)}
              />
            </VStack>
          </Section>
        </Reveal>
      </main>
    </>
  );
}

function messengerHref(phone: string, kind: string) {
  const d = phone.replace(/\D/g, '');
  if (kind === 'whatsapp') return `https://wa.me/${d}`;
  if (kind === 'telegram') return `https://t.me/+${d}`;
  if (kind === 'viber') return `viber://chat?number=${d}`;
  return `sms:${phone}`;
}