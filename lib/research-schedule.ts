const MINUTE = 60_000;
const DAY = 86_400_000;
const DAILY_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isResearchDailyTime(value: string): boolean {
  return DAILY_TIME.test(value);
}

export function isResearchTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function isSameResearchLocalDay(left: number, right: number, timezone: string): boolean {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  return formatter.format(left) === formatter.format(right);
}

/** Next occurrence, strictly after `after`. Gaps move to the first valid minute;
 * repeated times use the first occurrence. After a dispatch, skipToday prevents
 * a delayed occurrence from running again on the same local calendar date. */
export function nextResearchDailyAt(
  time: string,
  timezone: string,
  after: number,
  skipToday = false,
): number {
  if (!isResearchDailyTime(time) || !Number.isFinite(after))
    throw new Error("Invalid research daily time");
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  function local(at: number): number {
    const parts = Object.fromEntries(
      formatter.formatToParts(at).map(part => [part.type, part.value]),
    );
    return Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute),
    );
  }
  const today = Math.floor(local(after) / DAY) * DAY;
  const [hour, minute] = time.split(":").map(Number);
  // Offsets on both sides of a transition give every possible UTC occurrence.
  // Four local dates also cover zones that skip an entire calendar date.
  for (let day = skipToday ? 1 : 0; day < 4; day++) {
    const date = today + day * DAY;
    const target = date + hour * 60 * MINUTE + minute * MINUTE;
    const offsets = new Set<number>();
    for (let hours = -48; hours <= 48; hours += 12) {
      const sample = target + hours * 60 * MINUTE;
      offsets.add(local(sample) - sample);
    }
    const candidates = [...offsets]
      .map(offset => target - offset)
      .sort((a, b) => a - b);
    let occurrence = candidates.find(candidate => local(candidate) === target);
    if (occurrence === undefined) {
      // A DST gap has no exact occurrence. Search only the bounded transition
      // window between offset candidates, rather than every minute of the day.
      for (let at = candidates[0]; at <= candidates[candidates.length - 1]; at += MINUTE) {
        const value = local(at);
        if (value >= target && value < date + DAY) {
          occurrence = at;
          break;
        }
      }
    }
    if (occurrence !== undefined && occurrence > after) return occurrence;
  }
  throw new Error("Unable to determine the next research daily time");
}
