import type { Bot, Context, NextFunction } from 'grammy';
import { decodeCb } from './callback.js';
import { t } from './i18n.js';
import { settingsKb, langKb } from './keyboards.js';
import { getUser, updateUserFields } from '../db/users.js';
import { uiLangFromCode } from '../langs.js';
import type { BotDeps } from './onboarding/handler.js';
import { parseOnbEvent, renderScreen } from './onboarding/handler.js';
import { reduce, PROFILE_MAX_LEN, type OnbState, type Screen, type Step } from './onboarding/reducer.js';
import { isValidIana } from './timezone.js';
import type { SessionStore } from './session.js';
import type { SettingsField, Wizard } from './wizard.js';

// /settings: меню из 6 полей + правка одного поля поверх онбординг-клавиатур.
// Редьюсер ничего не знает про режим — ветвление INTERIM/COMMIT живёт здесь (glue).
// Профиль НЕ переписывается LLM: текст описания юзер вводит сам.

const FIELDS: readonly SettingsField[] = ['lang', 'interests', 'profile', 'tz', 'windows', 'volume'];
const FIELD_SET = new Set<string>(FIELDS);

/** Цель из callback set~<x>: одно из 6 полей, 'open' (меню) или undefined (не наша кнопка). */
export function parseSettingsTarget(data: string): SettingsField | 'open' | undefined {
  const p = decodeCb(data);
  if (p[0] !== 'set') return undefined;
  const x = p[1];
  if (x === undefined) return undefined;
  if (x === 'open') return 'open';
  return FIELD_SET.has(x) ? (x as SettingsField) : undefined;
}

/** Поле -> шаг FSM (одноимённые). Чистый маппинг, экспортируем для теста. */
export function fieldToStep(field: SettingsField): Step {
  return field;
}

/** Поле -> экран рендера. Чистый маппинг, экспортируем для теста. */
export function fieldToScreen(field: SettingsField): Screen {
  return { name: field };
}

/** OnbState, засеянный текущими значениями юзера, со step под редактируемое поле. */
function seedState(
  field: SettingsField,
  u: NonNullable<ReturnType<typeof getUser>>,
): OnbState {
  return {
    step: fieldToStep(field),
    uiLang: u.lang,
    draft: {
      lang: u.lang,
      tz: u.tz,
      interestTags: [...u.interestTags],
      profileText: u.profileText,
      readingWindows: [...u.readingWindows],
      maxItemsPerSend: u.maxItemsPerSend,
    },
    groupPage: 0,
    awaitingTzInput: false,
  };
}

/** Показ меню настроек. */
async function showMenu(ctx: Context, lang: 'ru' | 'en'): Promise<void> {
  await ctx.reply(t(lang, 'settings_title'), { reply_markup: settingsKb(lang) });
}

export function registerSettings(bot: Bot, store: SessionStore<Wizard>, deps: BotDeps): void {
  bot.command('settings', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const u = getUser(deps.db, chatId);
    if (u === undefined) {
      // не зарегистрирован — мягкий намёк на /start.
      await ctx.reply(t(uiLangFromCode(ctx.from?.language_code), 'onb_greeting'));
      return;
    }
    await showMenu(ctx, u.lang);
  });

  // Открытие меню / вход в правку поля.
  bot.callbackQuery(/^set~/, async (ctx, next: NextFunction) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }
    const target = parseSettingsTarget(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();
    if (target === undefined) {
      await next();
      return;
    }
    const u = getUser(deps.db, chatId);
    if (u === undefined) return;
    if (target === 'open') {
      await showMenu(ctx, u.lang);
      return;
    }
    const seeded = seedState(target, u);
    store.set(chatId, { kind: 'settings', field: target, state: seeded });
    if (target === 'lang') {
      // Дедикейтед reply: экран 'lang' в renderScreen добавляет приветствие — в settings оно лишнее.
      await ctx.reply(t(u.lang, 'onb_ask_lang'), { reply_markup: langKb() });
    } else {
      await renderScreen(ctx, seeded, fieldToScreen(target));
    }
  });

  // Правка поля через ob~*-кнопки. Регистрируется ПОСЛЕ registerOnboarding —
  // срабатывает только когда онбординг пропустил (kind !== 'onboarding').
  bot.callbackQuery(/^ob~/, async (ctx, next: NextFunction) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }
    const w = store.get(chatId);
    if (w === undefined || w.kind !== 'settings') {
      await next();
      return;
    }
    const ev = parseOnbEvent(w.state, ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();
    if (ev === undefined) return;

    const u = getUser(deps.db, chatId);
    if (u === undefined) return;
    const lang = u.lang;
    const now = deps.now();

    switch (ev.t) {
      // INTERIM: мутируем черновик, остаёмся в поле, перерисовываем.
      case 'toggleTag':
      case 'selectGroup':
      case 'pageNext':
      case 'pagePrev': {
        const { next: ns } = reduce(w.state, ev);
        store.set(chatId, { kind: 'settings', field: w.field, state: ns });
        await renderScreen(ctx, ns, { name: 'interests' });
        return;
      }
      case 'toggleWindow': {
        const { next: ns } = reduce(w.state, ev);
        store.set(chatId, { kind: 'settings', field: w.field, state: ns });
        await renderScreen(ctx, ns, { name: 'windows' });
        return;
      }
      case 'tzOther': {
        const { next: ns } = reduce(w.state, ev);
        store.set(chatId, { kind: 'settings', field: w.field, state: ns });
        await renderScreen(ctx, ns, { name: 'tzAskInput' });
        return;
      }

      // COMMIT: сохраняем ТОЛЬКО редактируемое поле и выходим.
      case 'pickLang': {
        if (w.field !== 'lang') return;
        updateUserFields(deps.db, chatId, { lang: ev.lang }, now);
        await ctx.reply(t(ev.lang, 'settings_saved'));
        store.clear(chatId);
        return;
      }
      case 'tagsDone': {
        if (w.field !== 'interests') return;
        if (w.state.draft.interestTags.length === 0) {
          await ctx.reply(t(lang, 'onb_need_one_tag'));
          return; // остаёмся в поле
        }
        updateUserFields(deps.db, chatId, { interestTags: w.state.draft.interestTags }, now);
        await ctx.reply(t(lang, 'settings_saved'));
        store.clear(chatId);
        return;
      }
      case 'pickTz': {
        if (w.field !== 'tz') return;
        updateUserFields(deps.db, chatId, { tz: ev.tz }, now);
        await ctx.reply(t(lang, 'settings_saved'));
        store.clear(chatId);
        return;
      }
      case 'windowsDone': {
        if (w.field !== 'windows') return;
        if (w.state.draft.readingWindows.length === 0) {
          await ctx.reply(t(lang, 'onb_need_one_window'));
          return; // остаёмся в поле
        }
        const readingWindows = [...w.state.draft.readingWindows].sort();
        updateUserFields(deps.db, chatId, { readingWindows }, now);
        await ctx.reply(t(lang, 'settings_saved'));
        store.clear(chatId);
        return;
      }
      case 'pickVolume': {
        if (w.field !== 'volume') return;
        updateUserFields(deps.db, chatId, { maxItemsPerSend: ev.n }, now);
        await ctx.reply(t(lang, 'settings_saved'));
        store.clear(chatId);
        return;
      }
      case 'profileSkip': {
        if (w.field !== 'profile') return;
        // Skip = оставить как есть. Ничего не пишем, выходим.
        await ctx.reply(t(lang, 'settings_saved'));
        store.clear(chatId);
        return;
      }
      // profileText/tzInput приходят текстом, не callback'ом — здесь не ожидаются.
      default:
        return;
    }
  });

  // Текст во время правки поля. Регистрируется ПОСЛЕ онбординг-обработчика текста.
  bot.on('message:text', async (ctx, next: NextFunction) => {
    const chatId = ctx.chat.id;
    const w = store.get(chatId);
    if (w === undefined || w.kind !== 'settings') {
      await next();
      return;
    }
    const u = getUser(deps.db, chatId);
    if (u === undefined) {
      await next();
      return;
    }
    const lang = u.lang;
    const now = deps.now();
    if (w.field === 'profile') {
      updateUserFields(
        deps.db,
        chatId,
        { profileText: ctx.message.text.slice(0, PROFILE_MAX_LEN) },
        now,
      );
      await ctx.reply(t(lang, 'settings_saved'));
      store.clear(chatId);
      return;
    }
    if (w.field === 'tz' && w.state.awaitingTzInput) {
      const tz = ctx.message.text.trim();
      if (isValidIana(tz)) {
        updateUserFields(deps.db, chatId, { tz }, now);
        await ctx.reply(t(lang, 'settings_saved'));
        store.clear(chatId);
      } else {
        await ctx.reply(t(lang, 'onb_tz_bad_input'));
      }
      return;
    }
    await next();
  });
}
