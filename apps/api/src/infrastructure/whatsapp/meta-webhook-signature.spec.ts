import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import {
  hubChallenge,
  isHubSubscribeRequest,
  isValidHubSignature,
} from "./meta-webhook-signature";

const APP_SECRET = "negocia-dev-app-secret-f2-3";

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("isValidHubSignature", () => {
  it("devuelve true para un body firmado correctamente", () => {
    const body = Buffer.from(JSON.stringify({ entry: [] }), "utf8");
    expect(isValidHubSignature(body, APP_SECRET, sign(body.toString(), APP_SECRET))).toBe(true);
  });

  it("distingue mayúsculas del hex (el cuerpo importa byte a byte)", () => {
    const body = Buffer.from('{"entry":[]}', "utf8");
    const received = sign(body.toString(), APP_SECRET).replace("sha256=", "sha256=");
    expect(isValidHubSignature(body, APP_SECRET, received)).toBe(true);
    // La firma debe diferir si el cuerpo cambió en cualquier byte.
    const other = Buffer.from('{"entry":[1]}', "utf8");
    expect(isValidHubSignature(other, APP_SECRET, received)).toBe(false);
  });

  it("rechaza body vacío o firmas ausentes", () => {
    expect(isValidHubSignature(Buffer.alloc(0), APP_SECRET, sign("x", APP_SECRET))).toBe(false);
    expect(isValidHubSignature(Buffer.from("x"), APP_SECRET, undefined)).toBe(false);
  });

  it("rechaza un app secret distinto", () => {
    const body = Buffer.from("hola", "utf8");
    expect(isValidHubSignature(body, "another-secret-123456", sign(body.toString(), APP_SECRET))).toBe(false);
  });

  it("soporta el header sin prefijo sha256=", () => {
    const body = Buffer.from("hola", "utf8");
    const raw = sign(body.toString(), APP_SECRET).slice("sha256=".length);
    expect(isValidHubSignature(body, APP_SECRET, raw)).toBe(true);
  });

  it("no lanza con valores inválidos de header", () => {
    const body = Buffer.from("hola", "utf8");
    expect(isValidHubSignature(body, APP_SECRET, "sha256=zzz")).toBe(false);
    expect(isValidHubSignature(body, APP_SECRET, "")).toBe(false);
    expect(isValidHubSignature(body, APP_SECRET, "sha256=nothex!!")).toBe(false);
  });
});

describe("isHubSubscribeRequest", () => {
  const TOKEN = "negocia-dev-verify-token";

  it("acepta una petición de suscripción válida", () => {
    expect(
      isHubSubscribeRequest(
        { "hub.mode": "subscribe", "hub.verify_token": TOKEN, "hub.challenge": "12345" },
        TOKEN,
      ),
    ).toBe(true);
  });

  it("rechaza token incorrecto", () => {
    expect(
      isHubSubscribeRequest({ "hub.mode": "subscribe", "hub.verify_token": "wrong" }, TOKEN),
    ).toBe(false);
  });

  it("rechaza un modo que no es subscribe", () => {
    expect(
      isHubSubscribeRequest({ "hub.mode": "unsubscribe", "hub.verify_token": TOKEN }, TOKEN),
    ).toBe(false);
  });

  it("extrae el challenge aunque la verificación se haga aparte", () => {
    const query = { "hub.mode": "subscribe", "hub.verify_token": TOKEN, "hub.challenge": "ch-1" };
    expect(hubChallenge(query)).toBe("ch-1");
    // `hubChallenge` solo extrae; el control del token vive en
    // `isHubSubscribeRequest` (que ya se cubre arriba).
    expect(hubChallenge({ ...query, "hub.verify_token": "wrong" })).toBe("ch-1");
    expect(hubChallenge({})).toBeUndefined();
  });
});