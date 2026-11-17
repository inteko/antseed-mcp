/** Compact output helpers: TSV tables, numbers, truncation. Missing values render as an empty string. */

/**
 * Text from the network (seller names, links, error messages) is untrusted: one line, no tabs or table breaks, capped.
 * It is shown as data, never followed as instructions.
 */
export function clean(value: unknown, max = 60): string {
  if (value === null || value === undefined) return "";
  const text = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200B-\u200F\u2028-\u202E\u2066-\u2069]/g, " ")
    .replace(/\|/g, "¦")
    .replace(/`/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const toNumber = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

/** USD amount with up to 4 significant digits and no currency sign: 0.005035485 → 0.005035, 2.837553 → 2.838. */
export function usd(value: number | string | null | undefined): string {
  const number = toNumber(value);
  return number === undefined ? "" : String(Number(number.toPrecision(4)));
}

export const pct = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined || !Number.isFinite(value) ? "" : `${(value * 100).toFixed(digits)}%`;

export const num = (value: number | null | undefined, digits = 0) =>
  value === null || value === undefined || !Number.isFinite(value) ? "" : value.toFixed(digits);

/** Large counts: 191017401 → 191.0M. */
export function count(value: number | string | null | undefined): string {
  const number = toNumber(value);
  if (number === undefined) return "";
  const abs = Math.abs(number);
  if (abs >= 1e9) return `${(number / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(number / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(number / 1e3).toFixed(1)}k`;
  return String(Math.round(number));
}

/** Epoch ms → `2026-11-15 20:35:07Z`. */
export function time(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

/** `label value` pairs with empty values left out, joined by `, `. */
export const fields = (pairs: Array<[string, string | number | null | undefined]>) =>
  pairs
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => (label ? `${label} ${value}` : String(value)))
    .join(", ");

/**
 * Tab-separated table. Columns empty in every row are dropped; with three or more rows, a column with one value in
 * every row moves to a `same for all:` line above the table.
 */
export function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return "(none)";
  const keep: number[] = [];
  const same: string[] = [];
  headers.forEach((header, index) => {
    const values = rows.map((row) => row[index] ?? "");
    if (values.every((value) => !value)) return;
    if (rows.length > 2 && values.every((value) => value === values[0])) same.push(`${header}=${values[0]}`);
    else keep.push(index);
  });
  const lines = same.length ? [`same for all: ${same.join(", ")}`] : [];
  if (keep.length) {
    const line = (cells: string[]) => keep.map((index) => cells[index] ?? "").join("\t");
    lines.push(line(headers), ...rows.map(line));
  }
  return lines.join("\n");
}

/** First `limit` items and a note about the rest. */
export function limited<T>(items: T[], limit: number): { shown: T[]; more: string } {
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;
  return { shown, more: rest > 0 ? `\n+${rest} more (raise limit or narrow the filter)` : "" };
}

/** Compact JSON for small nested values, with network strings cleaned and, with `digits`, fractions rounded. */
export function compactJson(value: unknown, maxLength = 1500, digits?: number): string {
  const text = JSON.stringify(value, (_key, item) => {
    if (typeof item === "string") return clean(item, 200);
    if (digits !== undefined && typeof item === "number" && Number.isFinite(item) && !Number.isInteger(item)) return Number(item.toPrecision(digits));
    return item;
  });
  if (text === undefined) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
