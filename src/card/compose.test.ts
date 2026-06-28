import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeCard, type CardInput } from './compose.js';

function input(over: Partial<CardInput> = {}): CardInput {
  return {
    clusterId: 1,
    withFeedback: false,
    title: 'OpenAI ships model',
    summary: 'A neutral summary.',
    url: 'https://techcrunch.com/x',
    source: 'techcrunch.com',
    whyTags: ['ai', 'startups'],
    lang: 'ru',
    ...over,
  };
}

function cbData(card: { replyMarkup?: { inline_keyboard: { callback_data?: string }[][] } }): string[] {
  return (card.replyMarkup?.inline_keyboard ?? []).flat().map((b) => b.callback_data ?? '');
}

test('composeCard: точная структура строк (ru)', () => {
  const card = composeCard(input({ whyTags: ['ai'] }));
  assert.equal(
    card.text,
    '<b>OpenAI ships model</b>\n\nA neutral summary.\n\n' +
      '🔗 <a href="https://techcrunch.com/x">Читать в techcrunch.com</a>\n' +
      '🔎 Почему ты это видишь: ИИ',
  );
});

test('composeCard: экранирует < & > в title и summary', () => {
  const card = composeCard(input({ title: 'A & B <x>', summary: '1 < 2 & 3' }));
  assert.match(card.text, /<b>A &amp; B &lt;x&gt;<\/b>/);
  assert.match(card.text, /1 &lt; 2 &amp; 3/);
});

test('composeCard: экранирует & и " в href', () => {
  const card = composeCard(input({ url: 'https://e.com/a?b=1&c="x"' }));
  assert.match(card.text, /href="https:\/\/e\.com\/a\?b=1&amp;c=&quot;x&quot;"/);
});

test('composeCard: экранирует < & > в source (внешний вход из фида)', () => {
  const card = composeCard(input({ source: 'a&b<c>' }));
  assert.match(card.text, />Читать в a&amp;b&lt;c&gt;<\/a>/);
});

test('composeCard: показывает максимум 3 тега', () => {
  const card = composeCard(input({ whyTags: ['ai', 'startups', 'crypto', 'space', 'music'] }));
  assert.match(card.text, /🔎 Почему ты это видишь: ИИ · Стартапы · Крипто/);
  assert.doesNotMatch(card.text, /Космос/);
});

test('composeCard: en даёт другие подписи и префиксы', () => {
  const card = composeCard(input({ lang: 'en', whyTags: ['ai'] }));
  assert.match(card.text, /🔗 <a href="[^"]+">Read on techcrunch\.com<\/a>/);
  assert.match(card.text, /🔎 Why you see this: AI/);
});

test('composeCard: parseMode HTML, превью включено', () => {
  const card = composeCard(input());
  assert.equal(card.parseMode, 'HTML');
  assert.equal(card.disableWebPagePreview, false);
});

test('composeCard: пустой whyTags — строки «почему» нет', () => {
  const card = composeCard(input({ whyTags: [] }));
  assert.doesNotMatch(card.text, /🔎/);
});

test('composeCard: withFeedback=true — кнопки 👍/👎 с cluster_id в callback', () => {
  const card = composeCard(input({ clusterId: 77, withFeedback: true }));
  assert.deepEqual(cbData(card), ['fb~up~77', 'fb~down~77']);
});

test('composeCard: withFeedback=false — клавиатуры нет', () => {
  const card = composeCard(input({ withFeedback: false }));
  assert.equal(card.replyMarkup, undefined);
});
