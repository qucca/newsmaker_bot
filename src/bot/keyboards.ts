import { InlineKeyboard } from 'grammy';
import type { Lang } from '../langs.js';
import { CATEGORY_GROUPS } from '../categories.js';
import { encodeCb } from './callback.js';
import { t, categoryLabel } from './i18n.js';
import { TZ_PRESETS } from './timezone.js';
import { WINDOW_PRESETS, VOLUME_PRESETS } from './onboarding/reducer.js';

// Построители inline-клавиатур. callback_data — компактные id через encodeCb (разделитель '~').

export function langKb(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🇷🇺 Русский', encodeCb(['ob', 'lang', 'ru']))
    .text('🇬🇧 English', encodeCb(['ob', 'lang', 'en']));
}

export function interestsKb(lang: Lang, page: number, selected: ReadonlySet<string>): InlineKeyboard {
  const clampedPage = Math.min(Math.max(page, 0), CATEGORY_GROUPS.length - 1);
  const group = CATEGORY_GROUPS[clampedPage];
  if (group === undefined) throw new Error(`CATEGORY_GROUPS пуст или индекс вне диапазона: ${clampedPage}`);
  const kb = new InlineKeyboard();
  group.leaves.forEach((leaf, i) => {
    const mark = selected.has(leaf) ? '✓ ' : '';
    kb.text(`${mark}${categoryLabel(lang, leaf)}`, encodeCb(['ob', 'tag', leaf]));
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(t(lang, 'onb_btn_select_group'), encodeCb(['ob', 'grp', group.group]));
  kb.row();
  if (page > 0) kb.text(t(lang, 'onb_btn_prev'), encodeCb(['ob', 'pg', 'prev']));
  if (page < CATEGORY_GROUPS.length - 1) kb.text(t(lang, 'onb_btn_next'), encodeCb(['ob', 'pg', 'next']));
  kb.row().text(t(lang, 'onb_btn_done'), encodeCb(['ob', 'tags', 'done']));
  return kb;
}

export function profileKb(lang: Lang): InlineKeyboard {
  return new InlineKeyboard().text(t(lang, 'onb_btn_skip'), encodeCb(['ob', 'profile', 'skip']));
}

export function tzKb(lang: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  TZ_PRESETS.forEach((tz, i) => {
    kb.text(tz, encodeCb(['ob', 'tz', tz]));
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(t(lang, 'onb_btn_tz_other'), encodeCb(['ob', 'tz', 'other']));
  return kb;
}

const WINDOW_KEYS: Record<string, 'win_morning' | 'win_day' | 'win_evening' | 'win_night'> = {
  '08:00': 'win_morning',
  '13:00': 'win_day',
  '19:00': 'win_evening',
  '22:00': 'win_night',
};

export function windowsKb(lang: Lang, selected: ReadonlySet<string>): InlineKeyboard {
  const kb = new InlineKeyboard();
  WINDOW_PRESETS.forEach((w, i) => {
    const mark = selected.has(w) ? '✓ ' : '';
    const key = WINDOW_KEYS[w];
    if (key === undefined) throw new Error(`Нет i18n-ключа для окна: ${w}`);
    kb.text(`${mark}${t(lang, key)}`, encodeCb(['ob', 'win', w]));
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(t(lang, 'onb_btn_done'), encodeCb(['ob', 'wins', 'done']));
  return kb;
}

export function volumeKb(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const n of VOLUME_PRESETS) kb.text(String(n), encodeCb(['ob', 'vol', String(n)]));
  return kb;
}

export function settingsKb(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'settings_btn_lang'), encodeCb(['set', 'lang']))
    .text(t(lang, 'settings_btn_interests'), encodeCb(['set', 'interests']))
    .row()
    .text(t(lang, 'settings_btn_profile'), encodeCb(['set', 'profile']))
    .text(t(lang, 'settings_btn_tz'), encodeCb(['set', 'tz']))
    .row()
    .text(t(lang, 'settings_btn_windows'), encodeCb(['set', 'windows']))
    .text(t(lang, 'settings_btn_volume'), encodeCb(['set', 'volume']));
}

export function confirmDeleteKb(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, 'delete_btn_yes'), encodeCb(['del', 'yes']))
    .text(t(lang, 'delete_btn_no'), encodeCb(['del', 'no']));
}

export function openSettingsKb(lang: Lang): InlineKeyboard {
  return new InlineKeyboard().text(t(lang, 'onb_btn_open_settings'), encodeCb(['set', 'open']));
}
