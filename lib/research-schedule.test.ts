import { describe, expect, it } from "vitest";
import { isResearchDailyTime, isResearchTimezone, nextResearchDailyAt, nextResearchScheduledAt } from "./research-schedule";

const next = (time: string, timezone: string, after: string, skipToday = false) =>
  new Date(nextResearchDailyAt(time, timezone, Date.parse(after), skipToday)).toISOString();

describe("daily research wall-clock schedules", () => {
  it("validates HH:mm times and timezone names", () => {
    expect(isResearchDailyTime("09:05")).toBe(true);
    for (const time of ["9:05", "24:00", "12:60", "09:05:00"])
      expect(isResearchDailyTime(time)).toBe(false);
    expect(isResearchTimezone("Asia/Kolkata")).toBe(true);
    expect(isResearchTimezone("UTC")).toBe(true);
    expect(isResearchTimezone("Made/Up")).toBe(false);
  });

  it("converts half-hour and quarter-hour zones and crosses local midnight", () => {
    expect(next("09:15", "Asia/Kolkata", "2026-10-23T03:44:00Z")).toBe("2026-10-23T03:45:00.000Z");
    expect(next("09:15", "Asia/Kolkata", "2026-10-23T03:45:00Z")).toBe("2026-10-24T03:45:00.000Z");
    expect(next("00:05", "Asia/Kathmandu", "2026-10-23T18:19:00Z")).toBe("2026-10-23T18:20:00.000Z");
  });

  it("moves a nonexistent spring-forward time to the first valid minute", () => {
    expect(next("02:30", "America/New_York", "2026-03-08T05:00:00Z")).toBe("2026-03-08T07:00:00.000Z");
    expect(next("02:30", "America/New_York", "2026-03-08T07:00:00Z")).toBe("2026-03-09T06:30:00.000Z");
  });

  it("uses the first repeated fall-back time and skips the second occurrence", () => {
    expect(next("01:30", "America/New_York", "2026-11-01T04:00:00Z")).toBe("2026-11-01T05:30:00.000Z");
    expect(next("01:30", "America/New_York", "2026-11-01T05:31:00Z")).toBe("2026-11-02T06:30:00.000Z");
  });

  it("handles a half-hour DST gap and a skipped calendar date", () => {
    expect(next("02:15", "Australia/Lord_Howe", "2026-10-03T13:00:00Z")).toBe("2026-10-03T15:30:00.000Z");
    expect(next("09:00", "Pacific/Apia", "2011-12-30T09:00:00Z")).toBe("2011-12-30T19:00:00.000Z");
  });

  it("waits until tomorrow after a delayed occurrence dispatches before today's selected time", () => {
    expect(next("09:15", "Asia/Kolkata", "2026-10-23T02:00:00Z", true)).toBe("2026-10-24T03:45:00.000Z");
  });
});

describe("twice-daily research wall-clock schedule", () => {
  it("alternates 9am and 9pm Kolkata without skipping the second occurrence", () => {
    const next = (after: string) => new Date(nextResearchScheduledAt("09:00", "Asia/Kolkata", Date.parse(after), 12, true)).toISOString();
    expect(next("2026-10-29T03:29:00Z")).toBe("2026-10-29T03:30:00.000Z");
    expect(next("2026-10-29T03:30:00Z")).toBe("2026-10-29T15:30:00.000Z");
    expect(next("2026-10-29T15:30:00Z")).toBe("2026-10-30T03:30:00.000Z");
  });
});
