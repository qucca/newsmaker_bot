// Нормализация кодов стран из шумного вывода LLM: только ISO-3166-1 alpha-2 (UPPERCASE),
// дедуп, кап 4. GLOBAL — сентинел «нет гео»: если валидных стран нет, отдаём ['GLOBAL'].
const ISO2 = /^[A-Z]{2}$/;
const MAX_REGIONS = 4;

export function normalizeRegions(raw: readonly string[] | undefined): string[] {
  if (raw === undefined) return ['GLOBAL'];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const u = r.trim().toUpperCase();
    if (ISO2.test(u) && !seen.has(u)) {
      seen.add(u);
      out.push(u);
      if (out.length === MAX_REGIONS) break;
    }
  }
  return out.length > 0 ? out : ['GLOBAL'];
}
