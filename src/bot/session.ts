// In-memory store состояния недоведённого визарда (Map по chat_id).
// Рестарт процесса теряет незавершённый онбординг — юзер делает /start заново (решение 13).

export interface SessionStore<S> {
  get(chatId: number): S | undefined;
  set(chatId: number, state: S): void;
  clear(chatId: number): void;
}

export function createSessionStore<S>(): SessionStore<S> {
  const map = new Map<number, S>();
  return {
    get: (id) => map.get(id),
    set: (id, s) => {
      map.set(id, s);
    },
    clear: (id) => {
      map.delete(id);
    },
  };
}
