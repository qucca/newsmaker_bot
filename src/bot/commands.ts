import type { Bot, Context } from 'grammy';
import { decodeCb } from './callback.js';
import { t } from './i18n.js';
import { openSettingsKb, confirmDeleteKb } from './keyboards.js';
import { uiLangFromCode } from '../langs.js';
import { getUser, deleteUser, countActiveUsers } from '../db/users.js';
import { canRegister, type StartLimiter } from './safeguard.js';
import type { SessionStore } from './session.js';
import type { Wizard } from './wizard.js';
import { initialState } from './onboarding/reducer.js';
import { renderScreen, type BotDeps } from './onboarding/handler.js';

// Top-level команды /start и /delete + регистрация меню команд клиента.
// /start: антифлуд -> уже зарегистрирован? (кнопка настроек) : кап -> начать онбординг.
// /delete: подтверждение кнопками; del~yes хард-удаляет (CASCADE) и чистит сессию.

/** callback_data del~yes|no -> действие. undefined для прочих callback (не наша кнопка). */
export function parseDeleteAction(data: string): 'yes' | 'no' | undefined {
  const p = decodeCb(data);
  if (p[0] !== 'del') return undefined;
  return p[1] === 'yes' ? 'yes' : p[1] === 'no' ? 'no' : undefined;
}

export interface CommandOpts {
  maxUsers: number;
  limiter: StartLimiter;
}

export function registerCommands(
  bot: Bot,
  store: SessionStore<Wizard>,
  deps: BotDeps,
  opts: CommandOpts,
): void {
  bot.command('start', async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const fallback = uiLangFromCode(ctx.from?.language_code);

    if (!opts.limiter.allow(chatId)) {
      await ctx.reply(t(fallback, 'rate_limited'));
      return;
    }

    const existing = getUser(deps.db, chatId);
    if (existing !== undefined) {
      await ctx.reply(t(existing.lang, 'onb_already_set'), {
        reply_markup: openSettingsKb(existing.lang),
      });
      return;
    }

    if (!canRegister(countActiveUsers(deps.db), opts.maxUsers)) {
      await ctx.reply(t(fallback, 'cap_reached'));
      return;
    }

    const state = initialState(fallback);
    store.set(chatId, { kind: 'onboarding', state });
    await renderScreen(ctx, state, { name: 'lang' });
  });

  bot.command('delete', async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const u = getUser(deps.db, chatId);
    const lang = u?.lang ?? uiLangFromCode(ctx.from?.language_code);
    await ctx.reply(t(lang, 'delete_confirm'), { reply_markup: confirmDeleteKb(lang) });
  });

  bot.callbackQuery(/^del~/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;
    const action = parseDeleteAction(ctx.callbackQuery.data);
    const u = getUser(deps.db, chatId);
    const lang = u?.lang ?? uiLangFromCode(ctx.from?.language_code);
    await ctx.answerCallbackQuery();
    if (action === 'yes') {
      deleteUser(deps.db, chatId);
      store.clear(chatId);
      await ctx.reply(t(lang, 'delete_done'));
    } else if (action === 'no') {
      await ctx.reply(t(lang, 'delete_cancelled'));
    }
  });
}

/** Меню команд бота (показывается в клиенте Telegram). */
export async function setBotCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Start / setup' },
    { command: 'settings', description: 'Settings' },
    { command: 'delete', description: 'Delete my data' },
  ]);
}
