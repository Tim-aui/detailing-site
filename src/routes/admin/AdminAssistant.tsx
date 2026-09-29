import {VStack} from '@astryxdesign/core/Layout';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {AssistantChat} from '../../components/AssistantChat.tsx';

/**
 * Помощник владельца. Отвечает по записям и оплатам ЭТОЙ студии: сервер
 * вызывает owner_* функции с токеном владельца. Изменять данные он не
 * умеет — для этого есть «Записи».
 */
export function AdminAssistant() {
  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading level={2}>Помощник владельца</Heading>
        <Text type="body" color="secondary">
          Отвечает по вашим записям и оплатам. Только читает данные — ничего не меняет.
        </Text>
      </VStack>
      <AssistantChat
        mode="owner"
        suggestions={['Что у меня завтра?', 'Сколько машин было на неделе?', 'Сколько денег получено?', 'Кто не подтверждён?']}
        placeholder="Что у меня завтра?"
      />
    </VStack>
  );
}
