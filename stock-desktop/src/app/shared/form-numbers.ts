/** Valores de inputs type="number" o texto mezclados en FormControl. */
export function parsePositiveNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  const t = String(raw).trim();
  if (!t) {
    return null;
  }
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseNonNegativeNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  const t = String(raw).trim();
  if (!t) {
    return null;
  }
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
