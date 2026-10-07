import { describe, expect, it } from "vitest";
import { Sha256TokenHasher } from "./token-hasher.sha256";

describe("Sha256TokenHasher", () => {
  const hasher = new Sha256TokenHasher();

  it("produce hash hexadecimal de 64 caracteres", () => {
    const hash = hasher.hashToken("abc");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("es determinista para el mismo input", () => {
    expect(hasher.hashToken("token-123")).toBe(hasher.hashToken("token-123"));
  });

  it("difiere para inputs distintos", () => {
    expect(hasher.hashToken("token-123")).not.toBe(hasher.hashToken("token-124"));
  });

  it("hace hash del valor crudo, no de su representación", () => {
    const raw = "t0k3n\x00raw";
    expect(hasher.hashToken(raw)).toBe(
      "aa1c0a6ef0ba0efca5249ef02ec535cebf980dda9a1e5b47dd4afdcff3c10d09",
    );
  });
});