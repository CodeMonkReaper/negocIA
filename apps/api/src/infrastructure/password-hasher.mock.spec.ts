import { describe, expect, it } from "vitest";
import { MockPasswordHasher } from "./password-hasher.mock";

describe("MockPasswordHasher", () => {
  const hasher = new MockPasswordHasher();

  it("hace roundtrip hash/verify con la contraseña correcta", async () => {
    const hash = await hasher.hash("s3cret-pa55");
    expect(hash).not.toBe("s3cret-pa55");
    expect(await hasher.verify("s3cret-pa55", hash)).toBe(true);
  });

  it("rechaza contraseñas incorrectas", async () => {
    const hash = await hasher.hash("correct");
    expect(await hasher.verify("wrong", hash)).toBe(false);
  });

  it("rechaza hash de otro plain con la misma contraseña", async () => {
    const hashA = await hasher.hash("aaa");
    const hashB = await hasher.hash("bbb");
    expect(await hasher.verify("bbb", hashA)).toBe(false);
    expect(await hasher.verify("aaa", hashB)).toBe(false);
  });
});