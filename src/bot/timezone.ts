import { IANAZone } from 'luxon';
import type { Lang } from '../langs.js';

// Пресеты часовых поясов для онбординга + валидация ручного ввода (IANA через luxon).
// Геолокацию не просим (решение 5). Храним IANA-строку в users.tz.

export const TZ_PRESETS = [
  'Europe/Moscow',
  'Europe/Kyiv',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Almaty',
  'UTC',
] as const;

/** Дефолт-подсветка из языка (грубое угадывание; юзер всё равно выбирает явно). */
export function defaultTzForLang(lang: Lang): string {
  return lang === 'ru' ? 'Europe/Moscow' : 'UTC';
}

/** Валидна ли строка как IANA-зона (DST-математику делает luxon, не мы). */
export function isValidIana(tz: string): boolean {
  return tz.length > 0 && IANAZone.isValidZone(tz);
}
