// Кросс-срезовый контракт поддерживаемых языков (UI бота + язык саммари).
// Расположен в корне src/, т.к. используется и ботом (T9), и рендером (T11).

export const LANGS = ['ru', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export function isLang(x: string): x is Lang {
  return (LANGS as readonly string[]).includes(x);
}

/** UI-язык до выбора: из Telegram language_code. `ru*` -> ru, иначе en. */
export function uiLangFromCode(code: string | undefined): Lang {
  return code !== undefined && code.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}
