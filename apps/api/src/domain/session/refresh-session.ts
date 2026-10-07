export interface RefreshLookupResult {
  status: "not_found" | "found";
  revokedAt?: Date | null;
  replacedAt?: Date | null;
  expiresAt?: Date | null;
}

export type RefreshIntent =
  | { kind: "reuse_attack" }
  | { kind: "invalid" }
  | { kind: "rotate" };

export function classifyRefreshLookup(
  result: RefreshLookupResult,
  now: Date,
): RefreshIntent {
  if (result.status === "not_found") {
    return { kind: "invalid" };
  }
  if (result.revokedAt) {
    return { kind: "reuse_attack" };
  }
  if (result.expiresAt && result.expiresAt.getTime() <= now.getTime()) {
    return { kind: "invalid" };
  }
  if (result.replacedAt) {
    return { kind: "reuse_attack" };
  }
  return { kind: "rotate" };
}

export function computeTokenExpiry(now: Date, ttlSeconds: number): Date {
  return new Date(now.getTime() + ttlSeconds * 1_000);
}