import type { Bot } from 'grammy';
import { decodeCb } from './callback.js';
import { t } from './i18n.js';
import { feedbackKb } from './keyboards.js';
import { getUser } from '../db/users.js';
import { recordFeedback, getFeedbackVote } from '../db/feedback.js';
import { getClusterRepSource } from '../db/clusters.js';
import type { BotDeps } from './onboarding/handler.js';

// Кнопки 👍/👎 (T14). callback_data fb~up~<id> / fb~down~<id> несёт cluster_id (голос на уровне
// истории). Запись — структурированный сигнал в feedback (источник представителя). Потребление
// (штраф по источнику) — T10. Гейт показа кнопок (калибровка) — на стороне карточки (src/card).

export interface FeedbackAction {
  vote: 1 | -1;
  clusterId: number;
}

/** callback_data fb~up|down~<id> -> действие. undefined = не наша кнопка / битые данные. */
export function parseFeedbackAction(data: string): FeedbackAction | undefined {
  const p = decodeCb(data);
  if (p[0] !== 'fb') return undefined;
  const vote = p[1] === 'up' ? 1 : p[1] === 'down' ? -1 : undefined;
  if (vote === undefined) return undefined;
  const raw = p[2];
  if (raw === undefined || !/^[0-9]+$/.test(raw)) return undefined;
  return { vote, clusterId: Number(raw) };
}

/**
 * Регистрирует обработчик кнопок фидбэка. Тонкий glue над протестированными частями:
 * парс → резолв источника представителя → upsert голоса → тост + отметка выбранной кнопки.
 * Переголос меняет голос; тап по той же кнопке — клавиатуру не трогаем (no-op).
 */
export function registerFeedback(bot: Bot, deps: BotDeps): void {
  bot.callbackQuery(/^fb~/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    // parse-first: чужой/битый fb~ callback не должен дёргать БД (как в commands/settings)
    const action = parseFeedbackAction(ctx.callbackQuery.data);
    if (action === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }

    const u = getUser(deps.db, chatId);
    if (u === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }
    const lang = u.lang;

    const source = getClusterRepSource(deps.db, action.clusterId);
    if (source === undefined) {
      // история уже недоступна (нет представителя) — голос записать не к чему
      await ctx.answerCallbackQuery({ text: t(lang, 'fb_stale') });
      return;
    }

    const prev = getFeedbackVote(deps.db, chatId, action.clusterId);
    recordFeedback(deps.db, {
      chatId,
      clusterId: action.clusterId,
      vote: action.vote,
      source,
      now: deps.now(),
    });

    await ctx.answerCallbackQuery({ text: t(lang, 'fb_thanks') });

    if (prev !== action.vote) {
      try {
        await ctx.editMessageReplyMarkup({
          reply_markup: feedbackKb(action.clusterId, action.vote),
        });
      } catch {
        // старое/недоступное сообщение или «not modified» — не критично для записи голоса
      }
    }
  });
}
