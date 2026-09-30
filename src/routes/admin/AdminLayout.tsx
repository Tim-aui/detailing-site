import {useEffect, useMemo, useState} from 'react';
import {Outlet, useLocation, useNavigate} from 'react-router-dom';
import {useQueryClient} from '@tanstack/react-query';
import {Layout, VStack, HStack, Section} from '@astryxdesign/core/Layout';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Banner} from '@astryxdesign/core/Banner';
import {TabList, Tab} from '@astryxdesign/core/TabList';
import {ToastViewport} from '@astryxdesign/core/Toast';
import {LoadingIndicator} from '../../components/LoadingIndicator.tsx';
import {StudioNotFound} from '../../components/StudioNotFound.tsx';
import {seedFor, useStudio} from '../../lib/studio.ts';
import {isSupabaseConfigured} from '../../lib/supabase.ts';
import {signIn, signOut, useMyStudios, useSession} from '../../lib/owner.ts';
import {TenantProvider, useSlugParam} from '../../tenants/TenantContext.tsx';
import {useTenantBranding} from '../../tenants/useTenantBranding.ts';

const TABS = [
  {value: '', label: 'Записи'},
  {value: 'money', label: 'Деньги'},
  {value: 'settings', label: 'Настройки'},
];

/**
 * Кабинет владельца: /s/<slug>/admin.
 *
 * Отдельный каркас без клиентской нижней панели. Вход — почта и пароль
 * (Supabase Auth). Доступ к студии проверяет база: my_studios() и каждая
 * owner_* функция. Здесь проверка только для понятного сообщения.
 */
export function AdminLayout() {
  const slug = useSlugParam();
  const seed = useMemo(() => seedFor(slug), [slug]);
  const {data: settings} = useStudio(slug);
  const {session, isLoading} = useSession();
  const studios = useMyStudios(session?.user.id);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  // Выход стирает данные кабинета из кеша: следующий вход их не увидит.
  const logout = () => void signOut().then(() => qc.removeQueries({queryKey: ['owner']}));

  useTenantBranding();

  useEffect(() => {
    document.title = `Кабинет — ${settings?.name ?? seed?.config.name ?? 'студия'}`;
  }, [settings?.name, seed?.config.name]);

  if (!seed) return <StudioNotFound slug={slug} />;

  if (!isSupabaseConfigured) {
    return (
      <AdminFrame>
        <Banner
          status="warning"
          title="Кабинет работает только с базой"
          description="Задайте VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY (см. docs/SETUP.md) — без них сайт показывает студию из файла, а записи и кабинет недоступны."
        />
      </AdminFrame>
    );
  }

  if (isLoading) return <LoadingIndicator label="Проверяем вход" />;
  if (!session) return <AdminLogin studioName={settings?.name ?? seed.config.name} />;
  if (studios.isPending) return <LoadingIndicator label="Открываем кабинет" />;

  const access = studios.data?.find((s) => s.slug === slug);
  if (!access) {
    return (
      <AdminFrame>
        <Card padding={5}>
          <VStack gap={3}>
            <Heading level={1}>Нет доступа</Heading>
            <Text type="body" color="secondary">
              Почта {session.user.email} не привязана к студии «{settings?.name ?? slug}».
              {studios.data?.length ? ' Ваши студии: ' + studios.data.map((s) => s.name).join(', ') + '.' : ''}
            </Text>
            <HStack gap={3} wrap="wrap">
              {studios.data?.map((s) => (
                <Button key={s.slug} label={`Открыть «${s.name}»`} variant="secondary" clickAction={() => navigate(`/s/${s.slug}/admin`)} />
              ))}
              <Button label="Выйти" variant="ghost" clickAction={logout} />
            </HStack>
          </VStack>
        </Card>
      </AdminFrame>
    );
  }

  const base = `/s/${slug}/admin`;
  const current = location.pathname.replace(/\/+$/, '').slice(base.length).replace(/^\//, '').split('/')[0] ?? '';

  return (
    <TenantProvider slug={slug} settings={settings ?? seed.config}>
      <AdminFrame>
        <VStack gap={4}>
          <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
            <VStack gap={0}>
              <Text type="supporting" color="secondary">
                Кабинет владельца{access.is_published ? '' : ' · студия ещё не опубликована'}
              </Text>
              <Heading level={1} type="display-3">
                {settings?.name ?? seed.config.name}
              </Heading>
            </VStack>
            <HStack gap={2}>
              <Button label="Сайт" variant="ghost" size="sm" clickAction={() => void window.open(`/s/${slug}/`, '_blank')} />
              <Button label="Выйти" variant="secondary" size="sm" clickAction={logout} />
            </HStack>
          </HStack>
          <TabList aria-label="Разделы кабинета" value={current} onChange={(v) => navigate(v ? `${base}/${v}` : base)} hasDivider layout="fill">
            {TABS.map((t) => (
              <Tab key={t.value} value={t.value} label={t.label} />
            ))}
          </TabList>
          <Outlet />
        </VStack>
      </AdminFrame>
    </TenantProvider>
  );
}

function AdminFrame({children}: {children: React.ReactNode}) {
  return (
    <main className="admin">
      <Layout content={<Section>{children}</Section>} height="auto" contentWidth={1040} />
      <ToastViewport />
    </main>
  );
}

function AdminLogin({studioName}: {studioName: string}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось войти');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminFrame>
      <VStack gap={4} maxWidth={420} width="100%" paddingBlockStart={8}>
        <VStack gap={1}>
          <Text type="supporting" color="secondary">
            Кабинет владельца
          </Text>
          <Heading level={1}>{studioName}</Heading>
        </VStack>
        <Card padding={5}>
          <VStack gap={4}>
            <TextInput label="Почта" value={email} onChange={setEmail} type="email" autoComplete="username" />
            <TextInput
              label="Пароль"
              value={password}
              onChange={setPassword}
              type="password"
              autoComplete="current-password"
              onEnter={() => void submit()}
            />
            {error ? <Banner status="error" title={error} /> : null}
            <Button label="Войти" variant="primary" size="lg" width="100%" isLoading={busy} clickAction={submit} />
            <Text type="supporting" color="secondary">
              Забыли пароль или нужен доступ для сотрудника? Напишите тому, кто подключал вам сайт: пароль сбросят за пару минут.
            </Text>
          </VStack>
        </Card>
      </VStack>
    </AdminFrame>
  );
}
