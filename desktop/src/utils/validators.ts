// src/utils/validators.ts

export function validateReading(prev: number, curr: number, avg?: number) {
  const flags: string[] = [];
  if (curr < prev) flags.push('Current reading is below previous reading.');
  const consumption = curr - prev;
  if (consumption === 0) flags.push('Zero consumption detected.');
  if (avg && avg > 0 && consumption > avg * 3)
    flags.push(`Abnormal spike: ${consumption.toFixed(2)} cu.m (avg ${avg.toFixed(2)} cu.m)`);
  return { valid: flags.length === 0, flags };
}

export function isValidPhoneNumber(v: string) {
  return /^(09|\+639)\d{9}$/.test(v.replace(/\s/g, ''));
}