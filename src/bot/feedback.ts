import type { Bot } from 'grammy';
import { decodeCb } from './callback.js';
import { t } from './i18n.js';
import { feedbackKb, feedbackReasonKb } from './keyboards.js';
import { getUser } from '../db/users.js';
import { recordFeedback, getFeedbackVote } from '../db/feedback.js';
import { getClusterFeedbackFacts } from '../db/clusters.js';
import type { BotDeps } from './onboarding/handler.js';
import { categoryByIndex } from '../categories.js';
import type { ReasonType } from '../db/feedback.js';
import { buildReasonOptions } from './feedback-reason.js';

// Кнопки 👍/👎 (T14). callback_data fb~up~<id> / fb~down~<id> несёт cluster_id (голос на уровне
// истории). Запись — структурированный сигнал в feedback (источник представителя). Потребление
// (штраф по источнику) — T10. Гейт показа кнопок (калибровка) — на стороне карточки (src/card).

export type FeedbackCallback =
  | { kind: 'up'; clusterId: number }
  | { kind: 'down'; clusterId: number }
  | { kind: 'back'; clusterId: number }
  | { kind: 'reason'; clusterId: number; reasonType: ReasonType; reasonKey: string };

const ISO2 = /^[A-Z]{2}$/;

function toId(raw: string | undefined): number | undefined {
  return raw !== undefined && /^[0-9]+$/.test(raw) ? Number(raw) : undefined;
}

function tagFrom(raw: string | undefined): string | undefined {
  if (raw === undefined || !/^[0-9]+$/.test(raw)) return undefined;
  return categoryByIndex(Number(raw));
}

/** Разбор любого fb~-callback (up/down/back/reason). undefined = чужой/битый. */
export function parseFeedbackCallback(data: string): FeedbackCallback | undefined {
  const p = decodeCb(data);
  if (p[0] !== 'fb') return undefined;
  const clusterId = toId(p[2]);
  if (clusterId === undefined) return undefined;
  switch (p[1]) {
    case 'up':
      return { kind: 'up', clusterId };
    case 'down':
      return { kind: 'down', clusterId };
    case 'bk':
      return { kind: 'back', clusterId };
    case 'rs':
      return { kind: 'reason', clusterId, reasonType: 'source', reasonKey: '' };
    case 'rt': {
      const tag = tagFrom(p[3]);
      return tag !== undefined ? { kind: 'reason', clusterId, reasonType: 'tag', reasonKey: tag } : undefined;
    }
    case 'rr': {
      const cc = p[3];
      return cc !== undefined && ISO2.test(cc) ? { kind: 'reason', clusterId, reasonType: 'region', reasonKey: cc } : undefined;
    }
    case 'rp': {
      const tag = tagFrom(p[3]);
      const cc = p[4];
      return tag !== undefined && cc !== undefined && ISO2.test(cc)
        ? { kind: 'reason', clusterId, reasonType: 'pair', reasonKey: `${tag}|${cc}` }
        : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Регистрирует обработчик кнопок фидбэка. Тонкий glue над протестированными частями:
 * парс → 👎 открывает пикер причины / ↩︎ восстанавливает 👍/👎 / reason + 👍 пишет голос.
 */
export function registerFeedback(bot: Bot, deps: BotDeps): void {
  bot.callbackQuery(/^fb~/, async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId === undefined) return;

    const cb = parseFeedbackCallback(ctx.callbackQuery.data);
    if (cb === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }

    const u = getUser(deps.db, chatId);
    if (u === undefined) {
      await ctx.answerCallbackQuery();
      return;
    }
    const lang = u.lang;

    const facts = getClusterFeedbackFacts(deps.db, cb.clusterId);
    if (facts === undefined) {
      await ctx.answerCallbackQuery({ text: t(lang, 'fb_stale') });
      return;
    }

    // 👎 → развернуть пикер причины (ничего пока не пишем)
    if (cb.kind === 'down') {
      const matchedTag = u.interestTags.find((tag) => facts.tags.includes(tag));
      const options = buildReasonOptions(matchedTag, facts.regions);
      await ctx.answerCallbackQuery({ text: t(lang, 'fb_reason_prompt') });
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: feedbackReasonKb(lang, cb.clusterId, options) });
      } catch {
        // старое/недоступное сообщение — не критично
      }
      return;
    }

    // ↩︎ Назад → вернуть 👍/👎 в текущем состоянии
    if (cb.kind === 'back') {
      const vote = getFeedbackVote(deps.db, chatId, cb.clusterId);
      await ctx.answerCallbackQuery();
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: feedbackKb(cb.clusterId, vote) });
      } catch {
        /* no-op */
      }
      return;
    }

    // 👍 (лайк, без причины) или reason (дизлайк с причиной)
    const clusterId = cb.clusterId;
    let vote: 1 | -1;
    let reasonType: ReasonType | null;
    let reasonKey: string | null;
    if (cb.kind === 'up') {
      vote = 1;
      reasonType = null;
      reasonKey = null;
    } else {
      // cb.kind === 'reason' (down+back уже отработали выше)
      vote = -1;
      reasonType = cb.reasonType;
      reasonKey = cb.reasonType === 'source' ? facts.source : cb.reasonKey;
    }
    const prev = getFeedbackVote(deps.db, chatId, clusterId);
    recordFeedback(deps.db, {
      chatId,
      clusterId,
      vote,
      source: facts.source,
      reasonType,
      reasonKey,
      now: deps.now(),
    });
    await ctx.answerCallbackQuery({ text: t(lang, 'fb_thanks') });

    if (prev !== vote) {
      try {
        await ctx.editMessageReplyMarkup({ reply_markup: feedbackKb(clusterId, vote) });
      } catch {
        /* старое сообщение / not modified — запись голоса уже сделана */
      }
    }
  });
}
