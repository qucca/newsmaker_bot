// Презентационные хелперы гео-фасета (без БД/IO). flagEmoji — чистая функция ISO-2 → эмодзи-флаг
// (пара regional-indicator символов). primaryRegion — основная страна карточки (первая не-GLOBAL).
const ISO2 = /^[A-Z]{2}$/;
const RI_BASE = 0x1f1e6; // 🇦

export function flagEmoji(cc: string): string {
  if (!ISO2.test(cc)) return '';
  return String.fromCodePoint(RI_BASE + cc.charCodeAt(0) - 65, RI_BASE + cc.charCodeAt(1) - 65);
}

export function primaryRegion(regions: string[]): string | undefined {
  return regions.find((r) => r !== 'GLOBAL' && ISO2.test(r));
}
