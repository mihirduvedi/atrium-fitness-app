export function sanitizeWholeNumberInput(value: string): string {
  return value.replace(/\D/g, '');
}

export function sanitizeDecimalInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, '');
  const decimalIndex = cleaned.indexOf('.');
  if (decimalIndex === -1) return cleaned;
  return `${cleaned.slice(0, decimalIndex + 1)}${cleaned.slice(decimalIndex + 1).replace(/\./g, '')}`;
}
