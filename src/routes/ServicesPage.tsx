import {useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Text} from '@astryxdesign/core/Text';
import {Heading} from '@astryxdesign/core/Heading';
import {VStack, HStack, StackItem, Card, Section} from '@astryxdesign/core/Layout';
import {Button} from '@astryxdesign/core/Button';
import {Badge} from '@astryxdesign/core/Badge';
import {useTenant} from '../tenants/TenantContext.tsx';
import {IconByName, ServiceIcon} from '../components/icons.tsx';
import {duration, money} from '../lib/format.ts';

/**
 * Все услуги студии с ценами.
 *
 * Фильтр по категориям и поиск по названию — на странице их может быть
 * несколько десятков, а листать длинный список неудобно.
 */
export function ServicesPage() {
  const {slug, settings} = useTenant();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const services = useMemo(
    () => (settings?.services ?? []).filter((s) => s.isActive),
    [settings],
  );
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services
      .filter((s) => (q ? s.name.toLowerCase().includes(q) : true))
      .sort((a, b) => Number(b.isPopular) - Number(a.isPopular) || a.name.localeCompare(b.name, 'ru'));
  }, [services, query]);

  if (!settings) return null;

  return (
    <main className="shell" style={{paddingTop: 8}}>
      <Section>
        <VStack gap={5}>
          <VStack gap={2}>
            <Heading level={1}>Услуги и цены</Heading>
            <Text type="body" color="secondary">
              Выберите услугу — покажем свободное время сразу.
            </Text>
          </VStack>


          {visible.length === 0 ? (
            <Card padding={5}>
              <VStack gap={2} style={{alignItems: 'center', textAlign: 'center'}}>
                <IconByName name="search" size={28} />
                <Text type="label" weight="semibold">
                  Ничего не нашлось
                </Text>
                <Text type="supporting" color="secondary">
                  Попробуйте другой запрос или сбросьте фильтр.
                </Text>
                <Button
                  label="Сбросить"
                  variant="ghost"
                  size="md"
                  clickAction={() => {
                    setQuery('');
                  }}
                />
              </VStack>
            </Card>
          ) : (
            <VStack gap={3} role="list">
              {visible.map((s) => (
                <Card key={s.id} role="listitem" padding={4}>
                  <VStack gap={3}>
                    <HStack gap={4} style={{alignItems: 'flex-start'}}>
                      <span
                        aria-hidden
                        style={{
                          display: 'grid',
                          placeItems: 'center',
                          width: 46,
                          height: 46,
                          borderRadius: 14,
                          background: 'rgba(70,144,255,0.14)',
                          color: 'var(--color-accent, #4690FF)',
                          flexShrink: 0,
                        }}
                      >
                        <ServiceIcon name={s.icon} size={24} />
                      </span>
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
                        </VStack>
                      </StackItem>
                      <StackItem>
                        <Text type="label" weight="bold" display="block" style={{whiteSpace: 'nowrap'}}>
                          {money(s.price)}
                        </Text>
                      </StackItem>
                    </HStack>

                    <HStack gap={3} style={{justifyContent: 'space-between', flexWrap: 'wrap'}}>
                      <Text type="supporting" color="disabled">
                        {duration(s.durationMin, s.days)}
                        {s.days > 1 ? ` · ${s.days} дн подряд` : ''}
                      </Text>
                      <Button
                        label="Выбрать время"
                        variant="primary"
                        size="md"
                        clickAction={() => navigate(`/s/${slug}/booking?service=${s.id}`)}
                      />
                    </HStack>
                  </VStack>
                </Card>
              ))}
            </VStack>
          )}

          <Text type="supporting" color="disabled">
            Итоговую стоимость студия подтверждает при записи: цена зависит от состояния кузова.
          </Text>
        </VStack>
      </Section>
    </main>
  );
}
