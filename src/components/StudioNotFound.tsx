import {Link} from 'react-router-dom';
import {Heading} from '@astryxdesign/core/Heading';
import {Badge} from '@astryxdesign/core/Badge';
import {Text} from '@astryxdesign/core/Text';
import {VStack} from '@astryxdesign/core/Layout';
import {allSeeds} from '../lib/studio.ts';

export function StudioNotFound({slug}: {slug: string}) {
  const others = allSeeds().filter((t) => !t.isSample);

  return (
    <VStack gap={5} style={{maxWidth: 520, margin: '0 auto', padding: '48px 20px', textAlign: 'center'}}>
      <Heading level={2}>Студия не найдена</Heading>
      <Text type="body" color="secondary">
        Адреса <code>/s/{slug || '—'}/</code> не существует. Возможно, в ссылке опечатка.
      </Text>

      {others.length > 0 ? (
        <VStack gap={3} style={{width: '100%'}}>
          <Text type="label" color="secondary">
            Доступные студии
          </Text>
          {others.map((t) => (
            <Link key={t.slug} to={`/s/${t.slug}/`}>
              {t.name}
            </Link>
          ))}
        </VStack>
      ) : null}

      <Link to="/">На главную</Link>
    </VStack>
  );
}

/**
 * Образец студии: папка создана, но ещё не проверена и не опубликована.
 *
 * Пока не снята метка sample.json, адрес не должен работать как
 * настоящая студия — иначе случайно задеплоенный черновик начнёт
 * принимать записи.
 */
export function StudioIsSample({slug}: {slug: string}) {
  return (
    <VStack gap={5} style={{maxWidth: 520, margin: '0 auto', padding: '48px 20px', textAlign: 'center'}}>
      <Badge variant="warning" label="Образец" />
      <Heading level={2}>Студия ещё не опубликована</Heading>
      <Text type="body" color="secondary">
        <code>/s/{slug}/</code> — это черновик. Он заработает, когда данные проверят и студию
        опубликуют.
      </Text>
      <Text type="supporting" color="disabled">
        Опубликовать: <code>pnpm tenant:publish --slug {slug}</code>
      </Text>
    </VStack>
  );
}
