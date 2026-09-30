import {Link} from 'react-router-dom';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {VStack, Card, Section} from '@astryxdesign/core/Layout';
import {useTenant} from '../tenants/TenantContext.tsx';

/**
 * Политика обработки персональных данных студии.
 *
 * Текст общий для всех студий, реквизиты подставляются из studio.json
 * (блок legal, адрес, телефон). Новой студии не нужно ничего писать
 * руками, достаточно заполнить legal.operator и, по желанию, ИНН и почту.
 */
export function PrivacyPage() {
  const {slug, settings} = useTenant();
  if (!settings) return null;

  const legal = settings.legal;
  const operator = legal.operator.trim() || settings.name;
  const requisites = [
    legal.inn && `ИНН ${legal.inn}`,
    legal.ogrn && `ОГРН/ОГРНИП ${legal.ogrn}`,
    settings.address.full && `адрес: ${settings.address.full}`,
  ].filter(Boolean);
  const contacts = [settings.phone && `телефон ${settings.phone}`, legal.email && `почта ${legal.email}`]
    .filter(Boolean)
    .join(', ');

  return (
    <main className="shell" style={{paddingTop: 8}}>
      <Section>
        <VStack gap={4}>
          <Heading level={1}>
            Политика обработки персональных данных
          </Heading>

          <Card padding={4}>
            <VStack gap={3}>
              <Block title="1. Кто обрабатывает данные">
                {operator}
                {requisites.length ? ` (${requisites.join(', ')})` : ''}. Далее «студия».
              </Block>

              <Block title="2. Какие данные">
                Имя, номер телефона, марка и модель автомобиля, пожелания к записи, дата и время визита. Документы,
                паспортные данные и данные банковских карт сайт не собирает.
              </Block>

              <Block title="3. Зачем">
                Чтобы записать вас на услугу, подтвердить или перенести визит, напомнить о нём и связаться по вопросам
                записи. Рекламные рассылки без отдельного согласия не отправляются.
              </Block>

              <Block title="4. Основание">
                Ваше согласие, которое вы даёте, отмечая галочку при записи (ст. 6 и 9 Федерального закона № 152-ФЗ
                «О персональных данных»).
              </Block>

              <Block title="5. Что студия делает с данными">
                Хранит, просматривает, уточняет и удаляет. Данные видит только студия. Третьим лицам они не
                передаются, кроме случаев, прямо предусмотренных законом. Хранение технически обеспечивает облачный
                провайдер сайта.
              </Block>

              <Block title="6. Сколько хранятся">
                Пока нужны для записи и учёта оказанных услуг, но не дольше 3 лет с последнего визита, либо до отзыва
                согласия.
              </Block>

              <Block title="7. Как отозвать согласие или удалить данные">
                Напишите или позвоните в студию{contacts ? `: ${contacts}` : ''}. Данные удалят в течение 10 рабочих
                дней. Отменить конкретную запись можно в разделе «Моя запись».
              </Block>

              <Block title="8. Технические данные">
                Сайт хранит в памяти вашего браузера введённые имя и телефон, чтобы не вводить их повторно. Их можно
                удалить, очистив данные сайта в браузере.
              </Block>
            </VStack>
          </Card>

          <Text type="supporting" color="secondary">
            <Link to={`/s/${slug}/booking`} className="text-link">Вернуться к записи</Link>
          </Text>
        </VStack>
      </Section>
    </main>
  );
}

function Block({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <VStack gap={1}>
      <Text type="label" weight="semibold">
        {title}
      </Text>
      <Text type="body" color="secondary">
        {children}
      </Text>
    </VStack>
  );
}
