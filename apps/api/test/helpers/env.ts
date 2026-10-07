import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Localiza y aplica el `.env` del monorepo dentro de los procesos de test.
 *
 * Vitest no lo carga por sí solo, y `resolveEnvPath()` (de `@negocia/config`)
 * depende de `INIT_CWD`, que pnpm fija al directorio desde el que se invocó
 * el comando: al correr `pnpm --filter @negocia/api test` desde la raíz y
 * `pnpm test` desde `apps/api` apunta a sitios distintos. Aquí se sube desde el
 * directorio actual buscando el primer `.env`, que es lo que el desarrollador
 * espera en ambos casos.
 *
 * Se aplica **sin sobrescribir** lo que ya está en `process.env`: una variable
 * inyectada por CI o por el shell del desarrollador manda sobre el archivo.
 *
 * El parseo es deliberadamente mínimo —`clave=valor`, comillas opcionales, `#`
 * de comentario— porque ninguna variable de este repositorio necesita el
 * multlinea de dotenv.
 */
let applied = false;

export function ensureEnvLoaded(startDir: string = process.cwd()): void {
  if (applied) {
    return;
  }
  applied = true;

  for (const [key, value] of Object.entries(readEnvFile(startDir))) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function findEnvFile(startDir: string = process.cwd()): string | null {
  let dir = startDir;
  for (let i = 0; i < 6; i += 1) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

export function readEnvFile(startDir?: string): Record<string, string> {
  const file = findEnvFile(startDir);
  if (!file) {
    return {};
  }

  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    const hash = value.indexOf(" #");
    if (hash > 0) {
      value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * URL del schema de test, con las dos salvaguardas que importan.
 *
 * Los tests hacen `DROP SCHEMA ... CASCADE` y `TRUNCATE`: apuntarlos por
 * error al schema `public` de desarrollo destruiría los datos reales, así que
 * se verifica el nombre del schema en lugar de confiar en la configuración.
 */
export function testUrl(): string {
  ensureEnvLoaded();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL no está definida ni en el entorno ni en el .env. " +
        "Copia .env.example a .env y define la URL del schema de test; los tests " +
        "NUNCA deben apuntar al schema public porque lo borran entero.",
    );
  }
  if (!/schema=negocia_test\b/.test(url)) {
    throw new Error(
      `TEST_DATABASE_URL debe apuntar al schema negocia_test (recibido: ${url})`,
    );
  }
  return url;
}
