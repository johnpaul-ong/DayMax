/**
 * The memento mori card: percent of life lived = age / life expectancy
 * of the user's country (WHO/World Bank ballpark figures, both sexes).
 */

export const LIFE_EXPECTANCY: Record<string, number> = {
  Australia: 83.2,
  "New Zealand": 82.5,
  "United States": 77.5,
  "United Kingdom": 81.3,
  Canada: 82.6,
  Ireland: 82.4,
  Germany: 80.9,
  France: 82.9,
  Netherlands: 81.9,
  Spain: 83.2,
  Italy: 83.5,
  Portugal: 81.5,
  Sweden: 83.1,
  Norway: 83.3,
  Denmark: 81.5,
  Finland: 81.7,
  Switzerland: 84.0,
  Austria: 81.6,
  Japan: 84.5,
  "South Korea": 83.5,
  Singapore: 83.9,
  "Hong Kong": 85.5,
  China: 78.6,
  India: 67.7,
  Indonesia: 68.6,
  Philippines: 69.7,
  Vietnam: 74.6,
  Thailand: 76.6,
  Malaysia: 74.9,
  Brazil: 75.8,
  Mexico: 75.0,
  Argentina: 77.7,
  Chile: 81.2,
  "South Africa": 62.3,
  Nigeria: 53.6,
  Kenya: 63.7,
  Egypt: 70.2,
  Israel: 82.7,
  Turkey: 76.0,
  Poland: 77.9,
  Greece: 81.9,
  Russia: 73.2,
  Ukraine: 71.6,
};

export const COUNTRIES = Object.keys(LIFE_EXPECTANCY).sort();
export const DEFAULT_LIFE_EXPECTANCY = 73.3; // world average

export interface LifeStats {
  ageYears: number;
  expectancy: number;
  percentLived: number;
  yearsLeft: number;
  weeksLeft: number;
}

export function lifeStats(birthDateISO: string, country: string | null): LifeStats | null {
  const birth = new Date(birthDateISO + "T00:00:00");
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  const ageYears = (now.getTime() - birth.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (ageYears <= 0 || ageYears > 120) return null;
  const expectancy = (country && LIFE_EXPECTANCY[country]) || DEFAULT_LIFE_EXPECTANCY;
  const percentLived = Math.min(100, (ageYears / expectancy) * 100);
  const yearsLeft = Math.max(0, expectancy - ageYears);
  return {
    ageYears,
    expectancy,
    percentLived,
    yearsLeft,
    weeksLeft: yearsLeft * 52.18,
  };
}
