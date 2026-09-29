import {useEffect} from 'react';
import {seedFor} from '../lib/studio.ts';
import {useTenantSlug} from './TenantContext.tsx';

/**
 * Оформление приложения под конкретную студию.
 *
 * Манифест, иконка и цвет темы у каждой студии свои — иначе «На экран
 * Домой» поставил бы приложение с логотипом демо-студии. Ставим их
 * динамически: один бандл обслуживает все адреса /s/<slug>/.
 */
export function useTenantBranding() {
  const slug = useTenantSlug();
  const seed = seedFor(slug);
  const accent = seed?.config.pwa.themeColor ?? '#4690FF';

  useEffect(() => {
    if (!seed) return;
    const {name, pwa} = seed.config;
    const base = `/tenants/${slug}`;

    document.title = `${name} — запись`;

    setLink('manifest', `${base}/manifest.webmanifest`, 'manifest');
    setLink('apple-touch-icon', `${base}/apple-touch-icon.png`);

    setMeta('theme-color', pwa.themeColor);
    setMeta('description', seed.config.description || `Онлайн-запись — ${name}`);

    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.appendChild(icon);
    }
    icon.href = `${base}/icon-192.png`;
  }, [slug, seed?.config.name]);

  return {accent, seed};
}

function setLink(rel: string, href: string, as?: string) {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
  if (as) el.type = as;
}

function setMeta(name: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}
