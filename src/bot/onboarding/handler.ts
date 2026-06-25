import type { Bot, Context, NextFunction } from 'grammy';
import type Database from 'better-sqlite3';
import { type Category, CATEGORY_SET } from '../../categories.js';
import { isLang } from '../../langs.js';
import { decodeCb } from '../callback.js';
import { t } from '../i18n.js';
import { isValidIana } from '../timezone.js';
import { langKb, interestsKb, profileKb, tzKb, windowsKb, volumeKb } from '../keyboards.js';
import type { SessionStore } from '../session.js';
import type { Wizard } from '../wizard.js';
import {
  reduce,
  VOLUME_PRESETS,
  WINDOW_PRESETS,
  type Effect,
  type OnbEvent,
  type OnbState,
  type Screen,
} from './reducer.js';
import { createUser } from '../../db/users.js';

export interface BotDeps {
  db: Database.Database;
  now: () => number;
}

const VOLUME_SET = new Set<number>(VOLUME_PRESETS);
const WINDOW_SET = new Set<string>(WINDOW_PRESETS);

/** callback_data -> событие (чистая, контекстно по state). undefined = игнор. */
export function parseOnbEvent(state: OnbState, data: string): OnbEvent | undefined {
  const p = decodeCb(data);
  if (p[0] !== 'ob') return undefined;
  const arg = p[2];
  switch (p[1]) {
    case 'lang':
      return arg !== undefined && isLang(arg) ? { t: 'pickLang', lang: arg } : undefined;
    case 'tag':
      return arg !== undefined && CATEGORY_SET.has(arg)
        ? { t: 'toggleTag', tag: arg as Category }
        : undefined;
    case 'grp':
      return arg !== undefined ? { t: 'selectGroup', group: arg } : undefined;
    case 'pg':
      return arg === 'next' ? { t: 'pageNext' } : arg === 'prev' ? { t: 'pagePrev' } : undefined;
    case 'tags':
      return arg === 'done' ? { t: 'tagsDone' } : undefined;
    case 'profile':
      return arg === 'skip' ? { t: 'profileSkip' } : undefined;
    case 'tz':
      if (arg === undefined) return undefined;
      return arg === 'other' ? { t: 'tzOther' } : { t: 'pickTz', tz: arg };
    case 'win':
      return arg !== undefined && WINDOW_SET.has(arg) ? { t: 'toggleWindow', window: arg } : undefined;
    case 'wins':
      return arg === 'done' ? { t: 'windowsDone' } : undefined;
    case 'vol': {
      if (arg === undefined) return undefined;
      const n = Number(arg);
      return VOLUME_SET.has(n) ? { t: 'pickVolume', n } : undefined;
    }
    default:
      return undefined;
  }
}

/** Свободный текст -> событие (profile-шаг или ввод tz). valid считаем через luxon. */
export function parseOnbText(state: OnbState, text: string): OnbEvent | undefined {
  if (state.step === 'profile') return { t: 'profileText', text };
  if (state.step === 'tz' && state.awaitingTzInput) {
    const tz = text.trim();
    return { t: 'tzInput', tz, valid: isValidIana(tz) };
  }
  return undefined;
}

/** Рендер «экрана» в чат (текст + клавиатура). */
export async function renderScreen(ctx: Context, state: OnbState, screen: Screen): Promise<void> {
  const lang = state.uiLang;
  const selected = new Set<string>(state.draft.interestTags);
  switch (screen.name) {
    case 'lang':
      await ctx.reply(`${t(lang, 'onb_greeting')}\n\n${t(lang, 'onb_ask_lang')}`, {
        reply_markup: langKb(),
      });
      return;
    case 'interests': {
      const group = state.groupPage;
      await ctx.reply(t(lang, 'onb_ask_interests', { group: String(group + 1) }), {
        reply_markup: interestsKb(lang, group, selected),
      });
      return;
    }
    case 'profile':
      await ctx.reply(t(lang, 'onb_ask_profile'), { reply_markup: profileKb(lang) });
      return;
    case 'tz':
      await ctx.reply(t(lang, 'onb_ask_tz'), { reply_markup: tzKb(lang) });
      return;
    case 'tzAskInput':
      await ctx.reply(t(lang, 'onb_tz_ask_input'));
      return;
    case 'windows':
      await ctx.reply(t(lang, 'onb_ask_windows'), {
        reply_markup: windowsKb(lang, new Set(state.draft.readingWindows)),
      });
      return;
    case 'volume':
      await ctx.reply(t(lang, 'onb_ask_volume'), { reply_markup: volumeKb() });
      return;
    case 'summary': {
      const d = state.draft;
      const lines = [
        t(lang, 'onb_summary_title'),
        `• ${t(lang, 'onb_summary_lang')}: ${d.lang ?? ''}`,
        `• ${t(lang, 'onb_summary_interests')}: ${d.interestTags.length}`,
        `• ${t(lang, 'onb_summary_tz')}: ${d.tz ?? ''}`,
        `• ${t(lang, 'onb_summary_windows')}: ${d.readingWindows.join(', ')}`,
        `• ${t(lang, 'onb_summary_volume')}: ${d.maxItemsPerSend ?? ''}`,
        '',
        t(lang, 'onb_summary_tail'),
      ];
      await ctx.reply(lines.join('\n'));
      return;
    }
  }
}

/** Применяет эффекты редьюсера: alert (toast), render, commit (createUser). */
export async function applyEffects(
  ctx: Context,
  store: SessionStore<Wizard>,
  deps: BotDeps,
  chatId: number,
  state: OnbState,
  effects: Effect[],
): Promise<void> {
  for (const e of effects) {
    if (e.kind === 'alert') {
      await ctx.answerCallbackQuery({ text: t(state.uiLang, e.key) });
    } else if (e.kind === 'render') {
      await renderScreen(ctx, state, e.screen);
    } else {
      // commit: создаём юзера из готового черновика; затем чистим сессию.
      const d = state.draft;
      createUser(
        deps.db,
        {
          chatId,
          lang: d.lang ?? 'en',
          tz: d.tz ?? 'UTC',
          interestTags: d.interestTags,
          profileText: d.profileText,
          readingWindows: d.readingWindows,
          maxItemsPerSend: d.maxItemsPerSend ?? 5,
        },
        deps.now(),
      );
      store.clear(chatId);
    }
  }
}

/** Навешивает обработку онбординга (callback ob~* и текст во время визарда). */
export function registerOnboarding(bot: Bot, store: SessionStore<Wizard>, deps: BotDeps): void {
  bot.callbackQuery(/^ob~/, async (ctx, next: NextFunction) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }
    const w = store.get(chatId);
    if (w === undefined || w.kind !== 'onboarding') {
      // не наш режим (нет сессии или это settings) — пропускаем дальше по цепочке.
      await next();
      return;
    }
    const event = parseOnbEvent(w.state, ctx.callbackQuery.data);
    if (event === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }
    const { next: nextState, effects } = reduce(w.state, event);
    store.set(chatId, { kind: 'onboarding', state: nextState });
    await applyEffects(ctx, store, deps, chatId, nextState, effects);
    await ctx.answerCallbackQuery();
  });

  bot.on('message:text', async (ctx, next: NextFunction) => {
    const chatId = ctx.chat.id;
    const w = store.get(chatId);
    if (w === undefined || w.kind !== 'onboarding') {
      await next(); // не в онбординге — дальше по цепочке (settings/команды)
      return;
    }
    const event = parseOnbText(w.state, ctx.message.text);
    if (event === undefined) {
      await next();
      return;
    }
    const { next: nextState, effects } = reduce(w.state, event);
    store.set(chatId, { kind: 'onboarding', state: nextState });
    await applyEffects(ctx, store, deps, chatId, nextState, effects);
  });
}
