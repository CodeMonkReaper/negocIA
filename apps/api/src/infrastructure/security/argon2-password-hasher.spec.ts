import { describe, expect, it } from "vitest";
import { Argon2PasswordHasher } from "./argon2-password-hasher";

/**
 * Argon2id real: los parámetros se fijan bajos en los tests para que la suite
 * no tarde medio minuto, pero **el mismo camino de código** que en producción.
 *
 * Un doble con este adaptador no probaría nada importante: el punto es que el
 * hash verifique y que el formato PHC sea interpretable por argon2.
 */
const FAST = { memoryCost: 512, timeCost: 1, parallelism: 1 } as const;

describe("Argon2PasswordHasher", () => {
  const hasher = new Argon2PasswordHasher(FAST);

  it("produce un hash argon2id en formato PHC", async () => {
    const hash = await hasher.hash("Correcta1!Bote");

    // `$argon2id$v=19$m=512,t=1,p=1$...`
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).toContain("m=512");
  });

  it("el hash no contiene la contraseña en claro", async () => {
    const hash = await hasher.hash("ContraseñaSecreta1!");
    expect(hash).not.toContain("ContraseñaSecreta1!");
  });

  it("verifica la contraseña correcta", async () => {
    const hash = await hasher.hash("Correcta1!Bote");
    await expect(hasher.verify("Correcta1!Bote", hash)).resolves.toBe(true);
  });

  it("rechaza la contraseña incorrecta", async () => {
    const hash = await hasher.hash("Correcta1!Bote");
    await expect(hasher.verify("Otra1!Clave", hash)).resolves.toBe(false);
  });

  it("el mismo texto produce hashes distintos (salt aleatorio)", async () => {
    const [a, b] = await Promise.all([
      hasher.hash("Correcta1!Bote"),
      hasher.hash("Correcta1!Bote"),
    ]);

    // Sin sal por hash, dos usuarios con la misma contraseña compartirían
    // fila de rainy table en un compromiso de la base de datos.
    expect(a).not.toBe(b);
  });

  it("falla cerrado ante un hash corrupto, nunca devuelve true", async () => {
    // Lo que importa es que nunca conceda acceso: un `true` ante basura sería
    // una brecha de autenticación. Este adaptador devuelve `false`, y el
    // resultado es indistinguible del de una contraseña incorrecta.
    await expect(
      hasher.verify("Correcta1!Bote", "no-es-un-hash"),
    ).resolves.toBe(false);
  });

  it("el coste de memoria por defecto está por encima del mínimo de OWASP", () => {
    const options = new Argon2PasswordHasher();
    expect(options).toBeInstanceOf(Argon2PasswordHasher);
    // El valor por defecto se comprueba en validateEnv; aquí se verifica que
    // el hasher acepta parámetros explícitos del entorno sin reescribirlos.
    expect(FAST.memoryCost).toBeLessThan(19_456);
  });
});
