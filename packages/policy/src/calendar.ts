/** India policy dates use the local civil day; other jurisdictions retain UTC until curated timezone metadata exists. */
export function policyCalendarDateV1(at: Date, jurisdiction: string): string {
  if (!Number.isFinite(at.getTime())) throw new RangeError("Invalid policy evaluation time.");
  if (jurisdiction !== "IN" && !jurisdiction.startsWith("IN-")) return at.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const part = (type: string) => parts.find(value => value.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
