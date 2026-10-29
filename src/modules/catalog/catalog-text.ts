export function normalizeDisplayText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
