import type { ProviderAdapter, ProviderRequest, ProviderResult } from '../types.js';

export function createFakeAdapter(opts: {
  results: ProviderResult[];
  provider?: string;
}): ProviderAdapter & { calls: ProviderRequest[] } {
  const queue = [...opts.results];
  const calls: ProviderRequest[] = [];
  return {
    provider: opts.provider ?? 'fake',
    calls,
    complete(req: ProviderRequest): Promise<ProviderResult> {
      calls.push(req);
      const next = queue.shift();
      if (next === undefined) throw new Error('fake-адаптер: очередь результатов исчерпана');
      return Promise.resolve(next);
    },
  };
}
