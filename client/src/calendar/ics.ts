import { addDays } from "@shared/calendar";
import type { CalendarItem } from "./types";

/**
 * The entries in view as an .ics file, so a family can drop the field trips
 * and breaks into whatever calendar they already live in.
 */
export function toIcs(items: CalendarItem[], name: string): string {
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (char) => `\\${char}`);
  const compact = (day: string) => day.replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Eagle Bot//Studio Calendar//EN", `X-WR-CALNAME:${escape(name)}`];
  for (const item of items) {
    lines.push("BEGIN:VEVENT", `UID:${item.key}@eagle-bot`, `DTSTAMP:${stamp}`, `SUMMARY:${escape(item.title)}`);
    if (item.startTime && item.endTime) {
      lines.push(
        `DTSTART:${compact(item.occurrenceStart)}T${item.startTime.replace(":", "")}00`,
        `DTEND:${compact(item.occurrenceEnd)}T${item.endTime.replace(":", "")}00`,
      );
    } else {
      // All-day ends are exclusive in iCalendar.
      lines.push(
        `DTSTART;VALUE=DATE:${compact(item.occurrenceStart)}`,
        `DTEND;VALUE=DATE:${compact(addDays(item.occurrenceEnd, 1))}`,
      );
    }
    const details = [item.quest ? `Quest: ${item.quest}` : "", item.description].filter(Boolean).join("\n\n");
    if (details) lines.push(`DESCRIPTION:${escape(details)}`);
    if (item.location) lines.push(`LOCATION:${escape(item.location)}`);
    lines.push(`CATEGORIES:${item.kind.toUpperCase()}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadIcs(items: CalendarItem[], name: string) {
  const blob = new Blob([toIcs(items, name)], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "calendar"}.ics`;
  link.click();
  // Some browsers cancel the download if the address goes away at once.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
