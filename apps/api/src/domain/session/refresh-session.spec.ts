import { describe, expect, it } from "vitest";
import {
  classifyRefreshLookup,
  computeTokenExpiry,
  type RefreshLookupResult,
} from "./refresh-session";

const NOW = new Date("2026-09-24T00:00:00.000Z");
const PAST = new Date("2026-09-23T00:00:00.000Z");
const FUTURE = new Date("2026-09-25T00:00:00.000Z");

function found(overrides: Partial<RefreshLookupResult> = {}): RefreshLookupResult {
  return { status: "found", ...overrides };
}

describe("classifyRefreshLookup", () => {
  it("token inexistente → invalid", () => {
    expect(classifyRefreshLookup({ status: "not_found" }, NOW)).toEqual({
      kind: "invalid",
    });
  });

  it("token revocado → reuse_attack (ya rotado/revocado)", () => {
    expect(
      classifyRefreshLookup(found({ revokedAt: PAST }), NOW),
    ).toEqual({ kind: "reuse_attack" });
  });

  it("token expirado y no revocado → invalid (expiración limpia)", () => {
    expect(
      classifyRefreshLookup(found({ expiresAt: PAST }), NOW),
    ).toEqual({ kind: "invalid" });
  });

  it("token reemplazado (rotación normal previa) y revocado → reuse_attack", () => {
    expect(
      classifyRefreshLookup(found({ revokedAt: PAST, replacedAt: PAST }), NOW),
    ).toEqual({ kind: "reuse_attack" });
  });

  it("token reemplazado sin revoked_at (estado inconsistente) → reuse_attack", () => {
    expect(
      classifyRefreshLookup(found({ replacedAt: PAST }), NOW),
    ).toEqual({ kind: "reuse_attack" });
  });

  it("token activo sin pasar por checks → rotate (permite rotación)", () => {
    expect(
      classifyRefreshLookup(found({ expiresAt: FUTURE }), NOW),
    ).toEqual({ kind: "rotate" });
  });

  it("un token que expira exactamente en `now` se considera expirado", () => {
    expect(classifyRefreshLookup(found({ expiresAt: NOW }), NOW)).toEqual({
      kind: "invalid",
    });
  });
});

describe("computeTokenExpiry", () => {
  it("suma TTL en segundos a la fecha base", () => {
    expect(computeTokenExpiry(NOW, 30)).toEqual(
      new Date("2026-09-24T00:00:30.000Z"),
    );
  });

  it("soporta TTL de días (30 días = 2_592_000 s)", () => {
    expect(computeTokenExpiry(NOW, 2_592_000)).toEqual(
      new Date("2026-10-24T00:00:00.000Z"),
    );
  });
});