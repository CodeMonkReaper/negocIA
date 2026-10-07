/**
 * Generación del `slug` de tenant (columna `tenants.slug`, UNIQUE).
 *
 * El slug es la URL pública del tenant y no se puede reutilizar tras el
 * borrado del tenant, así que ante colisión se añade un sufijo numérico en
 * lugar de fallar: registrar un negocio cuyo nombre ya existe debe funcionar.
 */

export const MAX_SLUG_LENGTH = 48;
const RESERVED_SLUGS = new Set(["api", "app", "www", "admin", "dashboard"]);

/**
 * Convierte un nombre en slug: minúsculas ASCII, sin acentos, sin caracteres
 * problemáticos y sin guiones duplicados en los bordes.
 */
export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  if (base.length === 0) {
    return "tenant";
  }

  return RESERVED_SLUGS.has(base) ? `${base}-empresa` : base;
}

/**
 * Devuelve un slug libre comprobando `exists` en cada intento.
 *
 * `exists` se inyecta (en vez de consultar el repositorio aquí) para que la
 * resolución de colisiones sea una función pura y testeable sin base de datos.
 */
export async function ensureUniqueSlug(
  base: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const truncated = base.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");

  let candidate = truncated;
  let suffix = 1;

  // Techo de 10 intentos: tras 10 colisiones se devuelve el último candidato
  // y deja que el UNIQUE de PostgreSQL rechace con 409 en vez de bloquear la
  // importación con un bucle infinito.
  while (suffix <= 10) {
    if (!(await exists(candidate))) {
      return candidate;
    }
    const infix = `-${suffix}`;
    const stem = truncated
      .slice(0, MAX_SLUG_LENGTH - infix.length)
      .replace(/-+$/g, "");
    candidate = `${stem}${infix}`;
    suffix += 1;
  }

  return candidate;
}
