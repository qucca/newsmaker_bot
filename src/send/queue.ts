// Троттл-очередь отправки (T13): процесс-синглтон, общий на все чаты.
// Лимиты: ~globalRps/сек глобально, ~perChatRps/сек на чат. Резервирование слота —
// синхронно (атомарно в однопоточном JS), затем await sleep до слота → детерминируется
// инъекцией now()/sleep() (см. CLAUDE.md: троттл-очередь покрываем юнит-тестами).

export interface SendQueueDeps {
  globalRps: number;
  perChatRps: number;
  /** Инъекция часов (default Date.now). */
  now?: () => number;
  /** Инъекция сна (default setTimeout). */
  sleep?: (ms: number) => Promise<void>;
}

export interface SendQueue {
  enqueue<T>(chatId: number, task: () => Promise<T>): Promise<T>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createSendQueue(deps: SendQueueDeps): SendQueue {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const globalGap = Math.ceil(1000 / deps.globalRps);
  const perChatGap = Math.ceil(1000 / deps.perChatRps);

  let globalNext = 0; // ближайший свободный глобальный слот (epoch ms)
  const perChatNext = new Map<number, number>(); // chatId → ближайший слот для чата

  return {
    async enqueue<T>(chatId: number, task: () => Promise<T>): Promise<T> {
      // Синхронное резервирование слота (атомарно: до первого await).
      const t = now();
      const chatNext = perChatNext.get(chatId) ?? 0;
      const slot = Math.max(t, globalNext, chatNext);
      globalNext = slot + globalGap;
      perChatNext.set(chatId, slot + perChatGap);

      // Чистка протухших записей карты (страховка от роста на больших объёмах).
      for (const [cid, until] of perChatNext) {
        if (until <= t && cid !== chatId) perChatNext.delete(cid);
      }

      const wait = slot - t;
      if (wait > 0) await sleep(wait);
      return task();
    },
  };
}
