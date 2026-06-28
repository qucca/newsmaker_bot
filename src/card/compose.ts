import type { InlineKeyboard } from 'grammy';
import type { Lang } from '../langs.js';
import type { Category } from '../categories.js';
import { t, categoryLabel } from '../bot/i18n.js';
import { feedbackKb } from '../bot/keyboards.js';

// T12: чистая детерминированная сборка HTML-карточки. Без БД и без IO.
// parse_mode HTML — экранируем только & < > (в href ещё "). Эмодзи — литералы шаблона.

const MAX_WHY_TAGS = 3;
const TAG_SEP = ' · ';
const DISABLE_WEB_PAGE_PREVIEW = false; // превью оригинала включено (spec §4)

export interface CardInput {
  clusterId: number; // для callback_data кнопок фидбэка (голос на уровне истории)
  withFeedback: boolean; // вешать ли кнопки 👍/👎 (гейт калибровки — решает src/card/index.ts)
  title: string; // summaries.title (провалидировано в T11)
  summary: string; // summaries.summary
  url: string; // canonical_url представителя
  source: string; // articles.source представителя
  whyTags: Category[]; // matchedTags (порядок = интересы юзера)
  lang: Lang;
}

export interface CardMessage {
  text: string; // готовый HTML
  parseMode: 'HTML';
  disableWebPagePreview: boolean;
  replyMarkup?: InlineKeyboard; // кнопки 👍/👎 (только в окне калибровки); иначе undefined
}

/** Экранирует текст под Telegram HTML parse_mode. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Экранирует значение под атрибут href (текст + двойная кавычка). */
function escapeHref(url: string): string {
  return escapeHtml(url).replace(/"/g, '&quot;');
}

/** Собирает HTML-карточку из готовых частей. Детерминированно. */
export function composeCard(input: CardInput): CardMessage {
  const linkText = t(input.lang, 'card_read_at', { source: escapeHtml(input.source) });
  const lines = [
    `<b>${escapeHtml(input.title)}</b>`,
    '',
    escapeHtml(input.summary),
    '',
    `🔗 <a href="${escapeHref(input.url)}">${linkText}</a>`,
  ];

  const tags = input.whyTags.slice(0, MAX_WHY_TAGS);
  if (tags.length > 0) {
    const labels = tags.map((slug) => escapeHtml(categoryLabel(input.lang, slug))).join(TAG_SEP);
    lines.push(`🔎 ${t(input.lang, 'card_why', { tags: labels })}`);
  }

  return {
    text: lines.join('\n'),
    parseMode: 'HTML',
    disableWebPagePreview: DISABLE_WEB_PAGE_PREVIEW,
    replyMarkup: input.withFeedback ? feedbackKb(input.clusterId) : undefined,
  };
}
