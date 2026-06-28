import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSendQueue } from './queue.js';

/** Виртуальные часы: sleep продвигает время вместо реального ожидания. */
function virtualClock(): { now: () => number; sleep: (ms: number) => Promise<void> } {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

test('queue: глобальный gap — задачи в РАЗНЫЕ чаты разнесены ≥ ceil(1000/rps)', async () => {
  const clock = virtualClock();
  const q = createSendQueue({ globalRps: 30, perChatRps: 1, now: clock.now, sleep: clock.sleep });
  const starts: number[] = [];

  for (let i = 0; i < 3; i++) {
    await q.enqueue(i, () => {
      starts.push(clock.now());
      return Promise.resolve();
    });
  }

  // ceil(1000/30) = 34мс
  assert.equal(starts[0], 0);
  assert.equal(starts[1], 34);
  assert.equal(starts[2], 68);
});

test('queue: per-chat gap — задачи в ОДИН чат разнесены ≥ 1000/perChatRps', async () => {
  const clock = virtualClock();
  const q = createSendQueue({ globalRps: 30, perChatRps: 1, now: clock.now, sleep: clock.sleep });
  const starts: number[] = [];

  for (let i = 0; i < 3; i++) {
    await q.enqueue(42, () => {
      starts.push(clock.now());
      return Promise.resolve();
    });
  }

  // perChatRps=1 → шаг 1000мс (доминирует над глобальным 34мс)
  assert.deepEqual(starts, [0, 1000, 2000]);
});

test('queue: возвращает результат task и пробрасывает ошибку', async () => {
  const clock = virtualClock();
  const q = createSendQueue({ globalRps: 30, perChatRps: 1, now: clock.now, sleep: clock.sleep });

  const ok = await q.enqueue(1, () => Promise.resolve('ack'));
  assert.equal(ok, 'ack');

  await assert.rejects(
    q.enqueue(1, () => Promise.reject(new Error('boom'))),
    /boom/,
  );
});

test('queue: конкурентные enqueue резервируют непересекающиеся слоты (атомарно)', async () => {
  const clock = virtualClock();
  const q = createSendQueue({ globalRps: 30, perChatRps: 1, now: clock.now, sleep: clock.sleep });
  let ran = 0;

  // Три конкурентных enqueue в разные чаты (Promise.all): проверяем атомарность
  // резервирования слота. Слот НЕЛЬЗЯ читать через clock.now() внутри задачи — общий
  // виртуальный t сдвигают sleep'ы соседних enqueue, поэтому наблюдаемый now() в задаче
  // ≠ её слот. Наблюдаемый инвариант: слоты 0/34/68 → виртуальное время доходит до 68.
  // При НЕатомарном резерве (await между чтением и записью globalNext) все три прочли бы
  // globalNext=0, получили слот 0 → время осталось бы 0.
  await Promise.all(
    [1, 2, 3].map((c) =>
      q.enqueue(c, () => {
        ran++;
        return Promise.resolve();
      }),
    ),
  );

  assert.equal(ran, 3);
  assert.equal(clock.now(), 68);
});
