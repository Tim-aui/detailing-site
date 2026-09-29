import {Link} from 'react-router-dom';
import {Text} from '@astryxdesign/core/Text';
import {VStack, HStack, Card} from '@astryxdesign/core/Layout';
import {IconByName} from './icons.tsx';
import {useTenant} from '../tenants/TenantContext.tsx';

/**
 * Приглашение к помощнику. Три примера сразу показаны кнопками, чтобы
 * человек мог начать разговор одним нажатием, а не придумывать вопрос.
 */
export function AssistantTeaser() {
  const {slug, settings} = useTenant();
  const suggestions = settings?.assistantSuggestions ?? [];

  return (
    <Card padding={5}>
      <VStack gap={4}>
        <HStack gap={3}>
          <span
            aria-hidden
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 40,
              height: 40,
              borderRadius: 13,
              background: 'rgba(70,144,255,0.16)',
              color: 'var(--color-accent, #4690FF)',
              flexShrink: 0,
            }}
          >
            <IconByName name="chat" size={22} />
          </span>
          <VStack gap={0}>
            <Text type="label" weight="bold">
              Помощник студии
            </Text>
            <Text type="supporting" color="secondary">
              Отвечает по услугам и свободному времени
            </Text>
          </VStack>
        </HStack>

        <VStack gap={2}>
          {suggestions.map((q) => (
            <Link
              key={q}
              to={`/s/${slug}/assistant?q=${encodeURIComponent(q)}`}
              className="tap"
              style={{textDecoration: 'none'}}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
                }}
              >
                <Text type="supporting" color="primary">
                  {q}
                </Text>
                <IconByName name="arrow" size={18} />
              </span>
            </Link>
          ))}
        </VStack>
      </VStack>
    </Card>
  );
}
