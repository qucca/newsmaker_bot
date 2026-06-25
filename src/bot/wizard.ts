import type { OnbState } from './onboarding/reducer.js';

// Общий тип сессии визарда: либо онбординг, либо правка одного поля из /settings.
// Один SessionStore<Wizard> на бота; ветвление по `kind` живёт в glue (handler.ts / settings.ts),
// редьюсер про режим не знает.

export type SettingsField = 'lang' | 'interests' | 'profile' | 'tz' | 'windows' | 'volume';

export type Wizard =
  | { kind: 'onboarding'; state: OnbState }
  | { kind: 'settings'; field: SettingsField; state: OnbState };
