/**
 * Брендинг студии: логотип и иконка.
 *
 * Если владелец не загрузил логотип, генерируем аккуратную заглушку из
 * первых букв названия. Фотографии владельца всегда важнее заглушек —
 * здесь только то, чего ещё нет.
 */
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const ACCENT = '#4690FF';

export type Branding = {
  logoPath: string;
  background: string;
  tint: string;
  generated: boolean;
};

/** Инициалы из названия: «NORTH DETAIL» → ND, «Автодет» → А. */
function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'A';
  if (words.length === 1) {
    const w = words[0];
    return w.length > 1 ? w.slice(0, 2).toUpperCase() : w.toUpperCase();
  }
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) =>
    ({'<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'})[c]!,
  );
}

export async function loadBranding(
  tenant: {name: string; config: {logo?: string | null; pwa?: {backgroundColor?: string; themeColor?: string}}},
  tenantDir: string,
): Promise<Branding> {
  const bg = tenant.config.pwa?.backgroundColor ?? '#000000';
  const tint = tenant.config.pwa?.themeColor ?? ACCENT;

  if (tenant.config.logo) {
    const custom = path.join(tenantDir, 'photos', tenant.config.logo);
    if (existsSync(custom)) {
      return {logoPath: custom, background: bg, tint, generated: false};
    }
  }

  const outDir = path.join(tenantDir, 'photos', '.generated');
  await mkdir(outDir, {recursive: true});
  const logoPath = path.join(outDir, 'logo.png');

  const text = escapeXml(initials(tenant.name));
  const fontSize = text.length > 2 ? 200 : 250;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${tint}"/>
      <stop offset="100%" stop-color="${tint}" stop-opacity="0.45"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="${bg}"/>
  <rect x="34" y="34" width="444" height="444" rx="90" fill="none" stroke="url(#g)" stroke-width="8"/>
  <text x="256" y="256" font-family="-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-size="${fontSize}" font-weight="700" fill="#FFFFFF"
        text-anchor="middle" dominant-baseline="central" letter-spacing="-6">${text}</text>
</svg>`;

  await writeFile(path.join(outDir, 'logo.svg'), svg);
  await sharp(Buffer.from(svg)).png().toFile(logoPath);
  return {logoPath, background: bg, tint, generated: true};
}

/** Ключ занятости для карты слотов — используется в тестах. */
export function toSlotKey(config: {services: {id: string}[]}) {
  return Object.fromEntries(config.services.map((s) => [s.id, s.id]));
}

export {readFile as _readFile};
