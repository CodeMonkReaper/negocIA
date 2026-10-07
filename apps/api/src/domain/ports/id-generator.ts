/**
 * Generador de identificadores de entidad (raíz de sesión, id de filas que la
 * aplicación crea).
 *
 * Existe como puerto, y no como `randomUUID()` importado de `node:crypto`, por
 * dos razones:
 *
 *  - **Regla de dependencias**: la capa de aplicación no puede importar
 *    Infrastructure, y `crypto` es una decisión de adaptador (UUID v4 hoy;
 *    ULID o Snowflake mañana, sin tocar los casos de uso).
 *  - **Testabilidad**: un test que fija el generador obtiene ids estables y
 *    puede afirmar sobre familias de refresh sin comparar UUIDs aleatorios.
 */
export interface IdGenerator {
  /** Identificador único, apto como clave primaria `uuid`. */
  next(): string;
}
