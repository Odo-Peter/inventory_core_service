const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertDate(date: string): {
  year: number;
  month: number;
  day: number;
} {
  const match = DATE_PATTERN.exec(date);
  if (!match) {
    throw new Error('Date must use YYYY-MM-DD');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    throw new Error('Date is not a valid calendar date');
  }

  return { year, month, day };
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }

  const asUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
  );

  return asUtc - date.getTime();
}

export function startOfDayInTimeZone(date: string, timeZone: string): Date {
  const { year, month, day } = assertDate(date);
  const utcGuess = new Date(Date.UTC(year, month - 1, day));
  const firstOffset = timeZoneOffsetMs(utcGuess, timeZone);
  let result = new Date(utcGuess.getTime() - firstOffset);

  const secondOffset = timeZoneOffsetMs(result, timeZone);
  if (secondOffset !== firstOffset) {
    result = new Date(utcGuess.getTime() - secondOffset);
  }

  return result;
}

export function startOfNextDayInTimeZone(date: string, timeZone: string): Date {
  const { year, month, day } = assertDate(date);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDate = [
    nextDay.getUTCFullYear(),
    String(nextDay.getUTCMonth() + 1).padStart(2, '0'),
    String(nextDay.getUTCDate()).padStart(2, '0'),
  ].join('-');

  return startOfDayInTimeZone(nextDate, timeZone);
}
