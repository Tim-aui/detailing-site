/**
 * Телефон при вводе: маска +7 (900) 123-45-67.
 *
 * Человек может начать с 8, с 7, с +7 или сразу с 9 — всё приводится к +7.
 * Иностранный номер (+375…, +998…) маской не ломаем: оставляем «+» и цифры.
 * Сервер всё равно сравнивает номера по цифрам, формат — только для глаз.
 */

/** Атрибуты для поля телефона: цифровая клавиатура и автозаполнение. */
export const PHONE_INPUT_PROPS = {inputMode: 'tel', autoComplete: 'tel'} as {};

function ruDigits(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  // Явный международный код, кроме +7 — не российский номер.
  if (trimmed.startsWith('+') && digits[0] !== '7') return null;
  if (digits[0] === '7' || digits[0] === '8') return digits.slice(1, 11);
  if (digits[0] === '9') return digits.slice(0, 10);
  return null;
}

export function formatPhone(raw: string): string {
  // Человек начал с «+» — даём дописать код страны.
  if (raw.trim() === '+') return '+';
  const d = ruDigits(raw);
  if (d === null) {
    const digits = raw.replace(/\D/g, '').slice(0, 15);
    return digits ? `+${digits}` : raw.trim().startsWith('+') ? '+' : '';
  }
  if (d === '' && !raw.replace(/\D/g, '')) return '';
  let out = '+7';
  if (d.length > 0) out += ` (${d.slice(0, 3)}`;
  if (d.length >= 3) out += ')';
  if (d.length > 3) out += ` ${d.slice(3, 6)}`;
  if (d.length > 6) out += `-${d.slice(6, 8)}`;
  if (d.length > 8) out += `-${d.slice(8, 10)}`;
  return out;
}

/**
 * Следующее значение поля. Если человек стёр скобку или дефис, цифры не
 * меняются, и маска вернула бы символ обратно — тогда стираем цифру перед ним.
 */
export function nextPhoneValue(prev: string, next: string): string {
  const prevDigits = prev.replace(/\D/g, '');
  const nextDigits = next.replace(/\D/g, '');
  if (next.length < prev.length && nextDigits === prevDigits && nextDigits.length > 0) {
    // Стёрт только символ маски — убираем последнюю цифру.
    const keep = nextDigits.slice(0, -1);
    return formatPhone(prev.trim().startsWith('+') ? `+${keep}` : keep) || '';
  }
  return formatPhone(next);
}

/** Сколько цифр осталось ввести (для подсказки). null — номер не российский. */
export function phoneMissing(raw: string): number | null {
  const d = ruDigits(raw);
  if (d === null) return null;
  return Math.max(0, 10 - d.length);
}

/** Номер полный: российский — 10 цифр после +7, иностранный — от 10 цифр. */
export function isFullPhone(raw: string): boolean {
  const d = ruDigits(raw);
  if (d === null) return raw.replace(/\D/g, '').length >= 10;
  return d.length === 10;
}

/** Подсказка под полем: что не так или сколько осталось. */
export function phoneHint(raw: string): string {
  if (!raw.trim()) return 'Например, +7 (900) 123-45-67 — позвоним, чтобы подтвердить запись';
  const left = phoneMissing(raw);
  if (left === null) return isFullPhone(raw) ? 'Номер другой страны — позвоним по нему' : 'Введите номер полностью, с кодом страны';
  if (left === 0) return 'Позвоним по этому номеру, чтобы подтвердить запись';
  const word = left === 1 ? 'цифру' : left < 5 ? 'цифры' : 'цифр';
  return `Осталось ${left} ${word}`;
}
