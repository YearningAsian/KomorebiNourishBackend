const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Latest accepted timestamp: 2100-01-01T00:00:00Z in epoch ms. */
const MAX_EPOCH_MS = 4_102_444_800_000;

export function asEpochMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const ms = value > 1_000_000_000_000 ? value : value * 1000;
  // Bound to a sane range: keeps bigint columns from overflowing (→ 500s)
  // and far-future timestamps from permanently winning last-write-wins.
  if (ms < 0 || ms > MAX_EPOCH_MS) return null;
  return Math.trunc(ms);
}
