import type Database from 'better-sqlite3';
import type { Lang } from '../langs.js';
import { type Category, CATEGORY_SET } from '../categories.js';

// Репозиторий пользователей (таблица users). «Глупый» SQL поверх единого better-sqlite3.
// JSON-поля (interest_tags, reading_windows) сериализуются здесь; время — epoch ms.

export interface UserRow {
  chatId: number;
  lang: Lang;
  tz: string;
  interestTags: Category[];
  profileText: string;
  readingWindows: string[];
  maxItemsPerSend: number;
  active: number;
  lastSentAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewUser {
  chatId: number;
  lang: Lang;
  tz: string;
  interestTags: Category[];
  profileText: string;
  readingWindows: string[];
  maxItemsPerSend: number;
}

export interface UserPatch {
  lang?: Lang;
  tz?: string;
  interestTags?: Category[];
  profileText?: string;
  readingWindows?: string[];
  maxItemsPerSend?: number;
}

interface RawRow {
  chat_id: number;
  lang: string;
  tz: string;
  interest_tags: string;
  profile_text: string;
  reading_windows: string;
  max_items_per_send: number;
  active: number;
  last_sent_at: number | null;
  created_at: number;
  updated_at: number;
}

const SELECT_BY_ID = `SELECT * FROM users WHERE chat_id = ?`;

/** Создаёт юзера (active=1, last_sent_at=NULL). created_at = updated_at = now. */
export function createUser(db: Database.Database, u: NewUser, now: number): void {
  db.prepare(
    `INSERT INTO users
       (chat_id, lang, tz, interest_tags, profile_text, reading_windows,
        max_items_per_send, active, last_sent_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
  ).run(
    u.chatId,
    u.lang,
    u.tz,
    JSON.stringify(u.interestTags),
    u.profileText,
    JSON.stringify(u.readingWindows),
    u.maxItemsPerSend,
    now,
    now,
  );
}

/** Читает юзера; interest_tags читаются МЯГКО — неизвестные словарю слаги отбрасываются. */
export function getUser(db: Database.Database, chatId: number): UserRow | undefined {
  const raw = db.prepare(SELECT_BY_ID).get(chatId) as RawRow | undefined;
  if (raw === undefined) return undefined;
  const tags = (JSON.parse(raw.interest_tags) as unknown[]).filter(
    (x): x is Category => typeof x === 'string' && CATEGORY_SET.has(x),
  );
  return {
    chatId: raw.chat_id,
    lang: raw.lang as Lang,
    tz: raw.tz,
    interestTags: tags,
    profileText: raw.profile_text,
    readingWindows: JSON.parse(raw.reading_windows) as string[],
    maxItemsPerSend: raw.max_items_per_send,
    active: raw.active,
    lastSentAt: raw.last_sent_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/** Патчит только переданные поля + updated_at. Пустой патч обновляет только updated_at. */
export function updateUserFields(
  db: Database.Database,
  chatId: number,
  patch: UserPatch,
  now: number,
): void {
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (patch.lang !== undefined) {
    sets.push('lang = ?');
    vals.push(patch.lang);
  }
  if (patch.tz !== undefined) {
    sets.push('tz = ?');
    vals.push(patch.tz);
  }
  if (patch.interestTags !== undefined) {
    sets.push('interest_tags = ?');
    vals.push(JSON.stringify(patch.interestTags));
  }
  if (patch.profileText !== undefined) {
    sets.push('profile_text = ?');
    vals.push(patch.profileText);
  }
  if (patch.readingWindows !== undefined) {
    sets.push('reading_windows = ?');
    vals.push(JSON.stringify(patch.readingWindows));
  }
  if (patch.maxItemsPerSend !== undefined) {
    sets.push('max_items_per_send = ?');
    vals.push(patch.maxItemsPerSend);
  }
  sets.push('updated_at = ?');
  vals.push(now);
  vals.push(chatId);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE chat_id = ?`).run(...vals);
}

/** Физическое удаление юзера (CASCADE чистит feedback/blocked_sources/sent_log). */
export function deleteUser(db: Database.Database, chatId: number): void {
  db.prepare(`DELETE FROM users WHERE chat_id = ?`).run(chatId);
}

/** Число активных юзеров (active=1) — для капа регистрации. */
export function countActiveUsers(db: Database.Database): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE active = 1`).get() as {
    n: number;
  };
  return row.n;
}

/** Деактивирует юзера (active=0) — при 403 от Telegram (бот заблокирован/юзер удалён). */
export function setUserInactive(db: Database.Database, chatId: number, now: number): void {
  db.prepare(`UPDATE users SET active = 0, updated_at = ? WHERE chat_id = ?`).run(now, chatId);
}
