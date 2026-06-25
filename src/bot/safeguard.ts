// Предохранитель публичной регистрации: кап активных юзеров + антифлуд на /start.

export const START_COOLDOWN_MS = 3000;

/** Можно ли зарегистрировать НОВОГО юзера (строго меньше капа). */
export function canRegister(activeCount: number, maxUsers: number): boolean {
  return activeCount < maxUsers;
}

export interface StartLimiter {
  allow(chatId: number): boolean;
}

/** In-memory cooldown на /start по chat_id (часы инъектируются для тестов). */
export function createStartLimiter(cooldownMs: number, now: () => number): StartLimiter {
  const last = new Map<number, number>();
  return {
    allow(chatId: number): boolean {
      const ts = now();
      const prev = last.get(chatId);
      if (prev !== undefined && ts - prev < cooldownMs) return false;
      last.set(chatId, ts);
      return true;
    },
  };
}
