import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StructuredLogger } from "./structured-logger";

/**
 * Umbral de `LOG_LEVEL`.
 *
 * Lo que se comprueba aquí no es que el logger escriba, sino que ** calle lo
 * que no debe. El defecto que se corrigió era precisamente un logger que
 * escribía siempre: con `LOG_LEVEL=warn` en el entorno, los `debug` seguían
 * saliendo a stdout, y los `meta` de los logs son el sitio donde se cuelan
 * emails, tokens y hashes.
 */
describe("StructuredLogger", () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function levels(): string[] {
    return lines.map((line) => JSON.parse(line).level as string);
  }

  it("suprime debug con el umbral info (por defecto)", () => {
    const logger = new StructuredLogger();
    logger.debug("d");
    logger.log("i");
    logger.warn("w");

    expect(levels()).toEqual(["info", "warn"]);
  });

  it("deja pasar todo con el umbral verbose", () => {
    const logger = new StructuredLogger({ level: "verbose" });
    logger.debug("d");
    logger.log("i");
    logger.warn("w");
    logger.error("e");

    expect(levels()).toEqual(["debug", "info", "warn", "error"]);
  });

  it("descarta debug cuando el umbral es warn", () => {
    const logger = new StructuredLogger({ level: "warn" });
    logger.debug("d");
    logger.log("i");
    logger.warn("w");
    logger.error("e");

    expect(levels()).toEqual(["warn", "error"]);
  });

  it("descarta debug, info y warn cuando el umbral es error", () => {
    const logger = new StructuredLogger({ level: "error" });
    logger.debug("d");
    logger.log("i");
    logger.warn("w");
    logger.error("e");
    logger.fatal?.("f");

    expect(levels()).toEqual(["error", "fatal"]);
  });

  it("nunca filtra error ni fatal, aunque el umbral sea debug", () => {
    const logger = new StructuredLogger({ level: "debug" });
    logger.error("e");
    logger.fatal?.("f");

    expect(levels()).toEqual(["error", "fatal"]);
  });

  it("acepta el umbral en mayúsculas y sin recortar", () => {
    const logger = new StructuredLogger({ level: "  WARN  " });
    logger.log("i");
    logger.warn("w");

    expect(levels()).toEqual(["warn"]);
  });

  /**
   * Un valor mal escrito debe sonar a configuración, no a silencio. Con
   * `LOG_LEVEL=warning` (inexistente) el síntoma sería una API que parece
   * muda y nadie sabría por qué.
   */
  it("cae en info ante un umbral desconocido, en vez de callarse", () => {
    const logger = new StructuredLogger({ level: "warning" });
    logger.log("i");
    logger.warn("w");

    expect(levels()).toEqual(["info", "warn"]);
  });

  it("acepta `verbose`, que Nest usa en su traza de arranque", () => {
    const logger = new StructuredLogger({ level: "verbose" });
    logger.verbose?.("v");
    logger.debug("d");

    expect(levels()).toEqual(["verbose", "debug"]);
  });

  it("lee el umbral de LOG_LEVEL del entorno con fromEnv", () => {
    vi.stubEnv("LOG_LEVEL", "error");
    const logger = StructuredLogger.fromEnv();
    logger.log("i");
    logger.error("e");

    expect(levels()).toEqual(["error"]);
    vi.unstubAllEnvs();
  });

  it("mantiene el contrato de la entrada: una línea JSON por escritura", () => {
    new StructuredLogger().log("mensaje", "Contexto");

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({
      level: "info",
      service: "negocia-api",
      message: "mensaje",
      context: "Contexto",
    });
    expect(typeof entry.timestamp).toBe("string");
  });

  it("trata un único string como contexto, no como stack", () => {
    // Convención de Nest: `log(message, context)`. Un string suelto no es un
    // stack salvo que sea un bloque multilínea con `at file:line:col`.
    new StructuredLogger().log("mensaje", "AuthService");

    const entry = JSON.parse(lines[0]);
    expect(entry.message).toBe("mensaje");
    expect(entry.context).toBe("AuthService");
    expect(entry.stack).toBeUndefined();
  });

  it("separa stack y contexto cuando se pasan dos strings", () => {
    new StructuredLogger().error("fallo", "Error: boom\n    at AuthService.run (x.ts:1:2)", "AuthService");

    const entry = JSON.parse(lines[0]);
    expect(entry.message).toBe("fallo");
    expect(entry.stack).toContain("at AuthService.run");
    expect(entry.context).toBe("AuthService");
  });
});
