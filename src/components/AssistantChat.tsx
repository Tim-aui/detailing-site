import {useEffect, useRef, useState} from 'react';
import {VStack} from '@astryxdesign/core/Layout';
import {Card} from '@astryxdesign/core/Card';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {useAssistant, type ChatMessage} from '../lib/bookings.ts';
import {IconByName} from './icons.tsx';

/**
 * Чат с помощником — общий для клиента (сайт) и владельца (кабинет).
 * Вся история уходит на сервер вместе с вопросом: без неё помощник
 * не смог бы переспросить «на какую услугу?» и понять ответ.
 */
export function AssistantChat({
  mode,
  suggestions,
  placeholder,
  initialQuestion,
  fallbackPhone,
}: {
  mode: 'client' | 'owner';
  suggestions: string[];
  placeholder: string;
  initialQuestion?: string;
  fallbackPhone?: string;
}) {
  const assistant = useAssistant(mode);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
  }, [messages, assistant.isPending]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || assistant.isPending) return;
    setInput('');
    const history = messages;
    setMessages((m) => [...m, {role: 'user', text: q}]);
    try {
      const res = await assistant.mutateAsync({question: q, history});
      setMessages((m) => [...m, {role: 'assistant', text: res.answer}]);
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'что-то пошло не так';
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: `Не получилось ответить: ${reason}.${fallbackPhone ? ` Позвоните: ${fallbackPhone}.` : ''}`,
        },
      ]);
    }
  };

  // Вопрос из подсказки на главной отправляем один раз.
  const sent = useRef(false);
  useEffect(() => {
    if (initialQuestion && !sent.current) {
      sent.current = true;
      void ask(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  return (
    <VStack gap={4}>
      <Card padding={4}>
        <div className="chat" role="log" aria-live="polite" aria-label="Сообщения с помощником">
          {messages.length === 0 ? (
            <VStack gap={3} hAlign="center" paddingBlock={3}>
              <IconByName name="chat" size={30} />
              <Text type="label" weight="semibold">
                С чего начнём?
              </Text>
            </VStack>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`bubble bubble--${m.role}`}>
                <Text type="body">{m.text}</Text>
              </div>
            ))
          )}
          {assistant.isPending ? (
            <div className="bubble bubble--assistant" aria-busy>
              <Text type="body" color="secondary">
                Смотрю данные…
              </Text>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>

        <VStack gap={3} paddingBlockStart={4}>
          <TextInput
            label="Ваш вопрос"
            value={input}
            onChange={setInput}
            placeholder={placeholder}
            onEnter={() => ask(input)}
          />
          <Button
            label="Спросить"
            variant="primary"
            size="md"
            isDisabled={input.trim().length === 0}
            isLoading={assistant.isPending}
            clickAction={() => ask(input)}
          />
        </VStack>
      </Card>

      {suggestions.length ? (
        <VStack gap={2}>
          <Text type="label" weight="semibold" color="secondary">
            Частые вопросы
          </Text>
          <div className="chips">
            {suggestions.map((q) => (
              <button key={q} type="button" className="chip" onClick={() => ask(q)} disabled={assistant.isPending}>
                {q}
              </button>
            ))}
          </div>
        </VStack>
      ) : null}
    </VStack>
  );
}
