const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const JUST_NOW = 45 * SECOND;

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatSavedAt(savedAt: number, now: number): string {
  const elapsed = Math.max(0, now - savedAt);

  if (elapsed < JUST_NOW) {
    return "just now";
  }

  const minutes = Math.max(1, Math.round(elapsed / MINUTE));
  const hours = Math.round(elapsed / HOUR);

  if (minutes < HOUR / MINUTE) {
    return relativeTime.format(-minutes, "minute");
  }

  if (hours < DAY / HOUR) {
    return relativeTime.format(-hours, "hour");
  }

  return relativeTime.format(-Math.round(elapsed / DAY), "day");
}

export function describePeople(population: number): string {
  if (population === 1) {
    return "1 person";
  }

  return `${population} people`;
}
