// ABOUTME: Slot-finding logic for the 3x/day posting cadence (9am, 1pm, 5pm).
// ABOUTME: Used by both the schedulePost assistant tool and the scheduleToNextSlot server function.

const SLOT_HOURS = [9, 13, 17];

export function findNextOpenSlot(occupiedTimestamps: Set<number>): Date {
  const now = new Date();
  const candidate = new Date(now);
  candidate.setMinutes(0, 0, 0);

  if (candidate.getHours() < SLOT_HOURS[0]) {
    candidate.setHours(SLOT_HOURS[0]);
  } else {
    const nextSlot = SLOT_HOURS.find(h => h > candidate.getHours());
    if (nextSlot) {
      candidate.setHours(nextSlot);
    } else {
      candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(SLOT_HOURS[0]);
    }
  }

  for (let day = 0; day < 365; day++) {
    for (const hour of SLOT_HOURS) {
      if (day === 0 && hour < candidate.getHours()) continue;
      const slot = new Date(candidate);
      if (day > 0) slot.setDate(candidate.getDate() + day);
      slot.setHours(hour, 0, 0, 0);
      if (slot <= now) continue;
      if (!occupiedTimestamps.has(slot.getTime())) return slot;
    }
  }
  const fallback = new Date(now);
  fallback.setDate(fallback.getDate() + 366);
  fallback.setHours(SLOT_HOURS[0], 0, 0, 0);
  return fallback;
}
