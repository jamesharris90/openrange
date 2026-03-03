export interface RvolInput {
  currentVolume: number;
  avgVolume30d: number;
}

export interface CompositeRvolInput {
  volume?: number;
  avgVolume?: number | null;
  fmpRvol?: number | null;
  altSources?: number[];
}

export interface CompositeRvolResult {
  value: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export function safeNumber(value: any): number {
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

export function calculateRelativeVolume(input: RvolInput): number {
  const { currentVolume, avgVolume30d } = input;

  if (!avgVolume30d || avgVolume30d <= 0) return 0;
  if (!currentVolume || currentVolume <= 0) return 0;

  const raw = currentVolume / avgVolume30d;

  return Math.round(raw * 100) / 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function deviationPercent(a: number, b: number): number {
  const baseline = Math.abs(a || 0) || 1;
  return Math.abs(a - b) / baseline;
}

function toFiniteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function calculateCompositeRvol(input: CompositeRvolInput): CompositeRvolResult {
  const fmpValue = toFiniteOrNull(input.fmpRvol);
  const volume = toFiniteOrNull(input.volume);
  const avgVolume = toFiniteOrNull(input.avgVolume);

  const derivedRvol = volume != null && avgVolume != null && avgVolume > 0
    ? round2(volume / avgVolume)
    : null;

  const altValues = (Array.isArray(input.altSources) ? input.altSources : [])
    .map((value) => toFiniteOrNull(value))
    .filter((value): value is number => value != null && value >= 0);

  if (altValues.length > 0) {
    const baseline = fmpValue != null ? fmpValue : altValues[0];
    const maxDeviation = Math.max(...altValues.map((value) => deviationPercent(value, baseline)));

    if (maxDeviation <= 0.01) {
      const avg = altValues.reduce((sum, value) => sum + value, 0) / altValues.length;
      return { value: round2(avg), confidence: 'HIGH' };
    }

    if (maxDeviation > 0.03 && fmpValue != null) {
      return { value: round2(fmpValue), confidence: 'HIGH' };
    }

    if (fmpValue != null) {
      return { value: round2(fmpValue), confidence: 'MEDIUM' };
    }

    const altAverage = altValues.reduce((sum, value) => sum + value, 0) / altValues.length;
    return { value: round2(altAverage), confidence: 'MEDIUM' };
  }

  if (fmpValue != null) {
    return { value: round2(fmpValue), confidence: 'HIGH' };
  }

  if (derivedRvol != null && Number.isFinite(derivedRvol)) {
    return { value: derivedRvol, confidence: 'MEDIUM' };
  }

  return { value: null, confidence: 'LOW' };
}
