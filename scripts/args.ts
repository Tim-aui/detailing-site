/**
 * Разбор аргументов командной строки для скриптов.
 *
 * Поддерживаем оба обычных写法: `--slug moya-studiya` и
 * `--slug=moya-studiya`. Второй вариант удобнее в CI, первый — руками.
 */
export function flag(name: string, argv: string[]): string | undefined {
  const prefix = `--${name}=`;
  const direct = argv.find((a) => a.startsWith(prefix));
  if (direct) return direct.slice(prefix.length).trim();

  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value.trim();
}

export function requireFlag(name: string, argv: string[], hint: string): string {
  const value = flag(name, argv);
  if (!value) throw new Error(`❌ Не указан ${name}. ${hint}`);
  return value;
}

/** Все значения флага, если он повторён. */
export function flags(name: string, argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith('--')) out.push(argv[i + 1]);
    else if (argv[i].startsWith(`--${name}=`)) out.push(argv[i].slice(name.length + 3));
  }
  return out;
}
