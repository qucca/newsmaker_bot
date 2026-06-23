import { createHash } from 'node:crypto';

/**
 * Стабильный хеш набора нейтральных фактов — содержимое clusters.content_hash.
 * Порядок фактов значим (массив, не множество). Меняется при смене представителя →
 * рассинхрон с summaries.content_hash → перерендер в T11.
 */
export function hashNeutralFacts(facts: string[]): string {
  return createHash('sha256').update(JSON.stringify(facts)).digest('hex');
}
