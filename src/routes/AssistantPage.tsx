import {useSearchParams} from 'react-router-dom';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {VStack, Section} from '@astryxdesign/core/Layout';
import {useTenant} from '../tenants/TenantContext.tsx';
import {AssistantChat} from '../components/AssistantChat.tsx';

/**
 * Помощник студии для клиента.
 *
 * Ответы приходят с server-функции: она сама берёт услуги, цены и
 * свободное время из базы через инструменты и ограничивает число
 * вопросов. На клиенте ничего не вычисляется и не подсказывается модели.
 */
export function AssistantPage() {
  const {settings} = useTenant();
  const [params] = useSearchParams();

  return (
    <main className="shell" style={{paddingTop: 8}}>
      <Section>
        <VStack gap={5}>
          <VStack gap={2}>
            <Heading level={1}>Помощник</Heading>
            <Text type="body" color="secondary">
              Спросите про услуги, цены или свободное время в {settings?.name}.
            </Text>
          </VStack>
          <AssistantChat
            mode="client"
            suggestions={settings?.assistantSuggestions ?? []}
            placeholder="Сколько стоит полировка и есть ли окно в пятницу?"
            initialQuestion={params.get('q') ?? undefined}
            fallbackPhone={settings?.phone}
          />
        </VStack>
      </Section>
    </main>
  );
}
