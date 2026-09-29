import {useEffect, useRef, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {VStack, Card, Section} from '@astryxdesign/core/Layout';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {useTenant} from '../tenants/TenantContext.tsx';
import {useAssistant} from '../lib/bookings.ts';
import {IconByName} from '../components/icons.tsx';

type Msg = {role: 'user' | 'assistant'; text: string};

/**
 * Помощник студии.
 *
 * Ответы приходят с server-функции, которая сама берёт актуальные
 * услуги, цены и занятость из базы и ограничивает число вопросов.
 * На клиенте ничего не вычисляется: иначе помощник мог бы рассказать
 * то, чего уже нет в расписании.
 */
export function AssistantPage() {
  const {settings} = useTenant();
  const assistant = useAssistant();
  const [params] = useSearchParams();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [prefilled] = useState(params.get('q') ?? '');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({behavior: 'smooth', block: 'end'});
  }, [messages, assistant.isPending]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || assistant.isPending) return;
    setInput('');
    setMessages((m) => [...m, {role: 'user', text: q}]);
    try {
      const res = await assistant.mutateAsync(q);
      setMessages((m) => [...m, {role: 'assistant', text: res.answer}]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text:
            e instanceof Error
              ? `Не получилось получить ответ: ${e.message}. Позвоните в студию — поможем вручную.`
              : 'Что-то пошло не так.',
        },
      ]);
    }
  };

  // Вопрос из подсказки на главной отправляем один раз.
  const sentPrefill = useRef(false);
  useEffect(() => {
    if (prefilled && !sentPrefill.current && !assistant.isPending) {
      sentPrefill.current = true;
      void ask(prefilled);
    }
  }, [prefilled]);

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

          <Card padding={4}>
            <div className="chat" role="log" aria-live="polite" aria-label="Сообщения с помощником">
              {messages.length === 0 ? (
                <VStack gap={3} style={{alignItems: 'center', textAlign: 'center', paddingBlock: 12}}>
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
                    Печатает…
                  </Text>
                </div>
              ) : null}
              <div ref={endRef} />
            </div>

            <VStack gap={3} style={{marginTop: 16}}>
              <TextInput
                label="Ваш вопрос"
                value={input}
                onChange={setInput}
                placeholder="Сколько стоит мойка и есть ли окно в пятницу?"
                onEnter={() => ask(input)}
                disabledMessage={assistant.isPending ? 'Ждём ответ' : undefined}
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

          {settings?.assistantSuggestions.length ? (
            <VStack gap={2}>
              <Text type="label" weight="semibold" color="secondary">
                Частые вопросы
              </Text>
              <div className="chips">
                {settings.assistantSuggestions.map((q) => (
                  <button key={q} type="button" className="chip" onClick={() => ask(q)} disabled={assistant.isPending}>
                    {q}
                  </button>
                ))}
              </div>
            </VStack>
          ) : null}
        </VStack>
      </Section>
    </main>
  );
}
