import { DateTime } from 'luxon';

// Чистый расчёт окна чтения (T15). Окна заданы как локальные времена-точки 'HH:MM'
// (пресеты онбординга 08:00/13:00/19:00/22:00). Таймзонную арифметику (DST, граница
// суток) не катаем руками — через luxon (CLAUDE.md).

/** Парсит 'HH:MM' в {h, m}; невалидную строку → null. */
function parseHm(s: string): { h: number; m: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (m === null) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

/**
 * Epoch ms самой поздней границы окна, уже наступившей СЕГОДНЯ в локальном дне юзера (tz).
 * null — если сегодня ещё ни одна граница не наступила (now раньше первого окна),
 * окон нет, или таймзона невалидна.
 *
 * «Только сегодня»: вчерашние границы не досылаем (решение T15 «последняя граница за день»).
 * После даунтайма досылается лишь самое свежее окно текущего локального дня.
 */
export function latestDueWindow(windows: string[], tz: string, nowMs: number): number | null {
  const now = DateTime.fromMillis(nowMs, { zone: tz });
  if (!now.isValid) return null; // невалидная tz (в норме валидируется в онбординге) — защитно
  let best: number | null = null;
  for (const w of windows) {
    const hm = parseHm(w);
    if (hm === null) continue;
    const boundary = now.set({ hour: hm.h, minute: hm.m, second: 0, millisecond: 0 });
    const ms = boundary.toMillis();
    if (ms <= nowMs && (best === null || ms > best)) best = ms;
  }
  return best;
}
