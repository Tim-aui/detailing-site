import {useEffect, useMemo, useState} from 'react';
import {Outlet, useLocation} from 'react-router-dom';
import {Layout} from '@astryxdesign/core/Layout';
import {ToastViewport, useToast} from '@astryxdesign/core/Toast';
import {BottomNav} from '../components/BottomNav.tsx';
import {LoadingIndicator} from '../components/LoadingIndicator.tsx';
import {StudioIsSample, StudioNotFound} from '../components/StudioNotFound.tsx';
import {useLiquidGlass} from '../lib/useLiquidGlass.ts';
import {seedFor, useStudio} from '../lib/studio.ts';
import {useSlugParam} from '../tenants/TenantContext.tsx';
import {TenantProvider} from '../tenants/TenantContext.tsx';
import {useTenantBranding} from '../tenants/useTenantBranding.ts';

/**
 * Каркас студии: общий для всех страниц /s/<slug>/*.
 *
 * Здесь решается, какая студия открыта, подставляются её настройки,
 * поднимается стекло на нижней панели и показываются уведомления.
 */
export function TenantLayout() {
  const slug = useSlugParam();
  const seed = useMemo(() => seedFor(slug), [slug]);
  const {data: settings, isPending, isError} = useStudio(slug);
  const location = useLocation();
  const toast = useToast();

  useTenantBranding();

  // Стекло на нижней панели и на кнопке в первом экране.
  useLiquidGlass(useMemo(() => ['.bottom-nav__inner', '.hero__cta'], []));

  // Переход между страницами одной студии возвращает наверх.
  useEffect(() => {
    window.scrollTo({top: 0});
  }, [location.pathname]);

  const [warned, setWarned] = useState(false);
  useEffect(() => {
    if (!warned && isError) {
      setWarned(true);
      toast({
        type: 'info',
        body: 'База недоступна — показываем настройки студии из файла.',
        isAutoHide: true,
        uniqueID: 'studio-db-offline',
      });
    }
  }, [isError, toast, warned]);

  if (!seed) return <StudioNotFound slug={slug} />;
  // Черновик не должен принимать записи, даже если его знают по ссылке.
  if (seed.isSample) return <StudioIsSample slug={slug} />;

  return (
    <TenantProvider slug={slug} settings={settings ?? seed.config}>
      {isPending && !settings ? <LoadingIndicator label="Загружаем студию" /> : null}
      <div className="page">
        <Layout content={<Outlet />} height="auto" contentWidth={760} />
      </div>
      <BottomNav />
      <ToastViewport />
    </TenantProvider>
  );
}
