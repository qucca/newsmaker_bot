import type { Lang } from '../../langs.js';
import { type Category, CATEGORY_GROUPS } from '../../categories.js';
import type { MsgKey } from '../i18n.js';

// Чистый FSM онбординга. БЕЗ grammY и БД: вход — (state, event), выход — (next, effects).
// Рендер текста/клавиатур делает glue по `effects[*].screen`. Валидация IANA — в glue
// (передаётся в событии tzInput.valid), здесь логика чистая.

export const WINDOW_PRESETS = ['08:00', '13:00', '19:00', '22:00'] as const;
export const VOLUME_PRESETS = [3, 5, 10] as const;
export const PROFILE_MAX_LEN = 1000;

export type Step = 'lang' | 'interests' | 'profile' | 'tz' | 'windows' | 'volume' | 'done';

export interface Draft {
  lang?: Lang;
  interestTags: Category[];
  profileText: string;
  tz?: string;
  readingWindows: string[];
  maxItemsPerSend?: number;
}

export interface OnbState {
  step: Step;
  uiLang: Lang; // язык рендера (до выбора — из language_code, после — draft.lang)
  draft: Draft;
  groupPage: number; // индекс текущей группы интересов
  awaitingTzInput: boolean; // нажали «Другой», ждём IANA-строку
}

export type OnbEvent =
  | { t: 'pickLang'; lang: Lang }
  | { t: 'toggleTag'; tag: Category }
  | { t: 'selectGroup'; group: string }
  | { t: 'pageNext' }
  | { t: 'pagePrev' }
  | { t: 'tagsDone' }
  | { t: 'profileText'; text: string }
  | { t: 'profileSkip' }
  | { t: 'pickTz'; tz: string }
  | { t: 'tzOther' }
  | { t: 'tzInput'; tz: string; valid: boolean }
  | { t: 'toggleWindow'; window: string }
  | { t: 'windowsDone' }
  | { t: 'pickVolume'; n: number };

export type Screen =
  | { name: 'lang' }
  | { name: 'interests' }
  | { name: 'profile' }
  | { name: 'tz' }
  | { name: 'tzAskInput' }
  | { name: 'windows' }
  | { name: 'volume' }
  | { name: 'summary' };

export type Effect =
  | { kind: 'render'; screen: Screen }
  | { kind: 'alert'; key: MsgKey }
  | { kind: 'commit' };

export function initialState(uiLang: Lang): OnbState {
  return {
    step: 'lang',
    uiLang,
    draft: { interestTags: [], profileText: '', readingWindows: [] },
    groupPage: 0,
    awaitingTzInput: false,
  };
}

const render = (screen: Screen): Effect[] => [{ kind: 'render', screen }];

export function reduce(state: OnbState, event: OnbEvent): { next: OnbState; effects: Effect[] } {
  switch (event.t) {
    case 'pickLang': {
      const next = {
        ...state,
        step: 'interests' as const,
        uiLang: event.lang,
        draft: { ...state.draft, lang: event.lang },
      };
      return { next, effects: render({ name: 'interests' }) };
    }
    case 'toggleTag': {
      const has = state.draft.interestTags.includes(event.tag);
      const interestTags = has
        ? state.draft.interestTags.filter((x) => x !== event.tag)
        : [...state.draft.interestTags, event.tag];
      return {
        next: { ...state, draft: { ...state.draft, interestTags } },
        effects: render({ name: 'interests' }),
      };
    }
    case 'selectGroup': {
      const group = CATEGORY_GROUPS.find((g) => g.group === event.group);
      if (group === undefined) return { next: state, effects: render({ name: 'interests' }) };
      const set = new Set(state.draft.interestTags);
      for (const leaf of group.leaves) set.add(leaf);
      return {
        next: { ...state, draft: { ...state.draft, interestTags: [...set] } },
        effects: render({ name: 'interests' }),
      };
    }
    case 'pageNext': {
      const groupPage = Math.min(state.groupPage + 1, CATEGORY_GROUPS.length - 1);
      return { next: { ...state, groupPage }, effects: render({ name: 'interests' }) };
    }
    case 'pagePrev': {
      const groupPage = Math.max(state.groupPage - 1, 0);
      return { next: { ...state, groupPage }, effects: render({ name: 'interests' }) };
    }
    case 'tagsDone': {
      if (state.draft.interestTags.length === 0) {
        return { next: state, effects: [{ kind: 'alert', key: 'onb_need_one_tag' }] };
      }
      return { next: { ...state, step: 'profile' }, effects: render({ name: 'profile' }) };
    }
    case 'profileText': {
      const profileText = event.text.slice(0, PROFILE_MAX_LEN);
      return {
        next: { ...state, step: 'tz', draft: { ...state.draft, profileText } },
        effects: render({ name: 'tz' }),
      };
    }
    case 'profileSkip':
      return {
        next: { ...state, step: 'tz', draft: { ...state.draft, profileText: '' } },
        effects: render({ name: 'tz' }),
      };
    case 'tzOther':
      return { next: { ...state, awaitingTzInput: true }, effects: render({ name: 'tzAskInput' }) };
    case 'tzInput': {
      if (!event.valid) {
        return {
          next: state,
          effects: [
            { kind: 'alert', key: 'onb_tz_bad_input' },
            { kind: 'render', screen: { name: 'tzAskInput' } },
          ],
        };
      }
      return {
        next: {
          ...state,
          step: 'windows',
          awaitingTzInput: false,
          draft: { ...state.draft, tz: event.tz },
        },
        effects: render({ name: 'windows' }),
      };
    }
    case 'pickTz':
      return {
        next: {
          ...state,
          step: 'windows',
          awaitingTzInput: false,
          draft: { ...state.draft, tz: event.tz },
        },
        effects: render({ name: 'windows' }),
      };
    case 'toggleWindow': {
      const has = state.draft.readingWindows.includes(event.window);
      const readingWindows = has
        ? state.draft.readingWindows.filter((x) => x !== event.window)
        : [...state.draft.readingWindows, event.window];
      return {
        next: { ...state, draft: { ...state.draft, readingWindows } },
        effects: render({ name: 'windows' }),
      };
    }
    case 'windowsDone': {
      if (state.draft.readingWindows.length === 0) {
        return { next: state, effects: [{ kind: 'alert', key: 'onb_need_one_window' }] };
      }
      const readingWindows = [...state.draft.readingWindows].sort();
      return {
        next: { ...state, step: 'volume', draft: { ...state.draft, readingWindows } },
        effects: render({ name: 'volume' }),
      };
    }
    case 'pickVolume':
      return {
        next: { ...state, step: 'done', draft: { ...state.draft, maxItemsPerSend: event.n } },
        effects: [{ kind: 'commit' }, { kind: 'render', screen: { name: 'summary' } }],
      };
  }
}
