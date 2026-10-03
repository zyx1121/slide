// Dates as members read them. The server renders pages, and its clock runs
// in UTC inside the container, so times are formatted in the lab's zone.

const LAB_TIME_ZONE = "Asia/Taipei";

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: LAB_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * "2026/10/03 14:05", in Taiwan time. Built from parts, because the
 * separators a locale puts between them change with the ICU version.
 */
export function formatDateTime(date: Date): string {
  const part: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of PARTS.formatToParts(date)) part[type] = value;
  return `${part.year}/${part.month}/${part.day} ${part.hour}:${part.minute}`;
}
