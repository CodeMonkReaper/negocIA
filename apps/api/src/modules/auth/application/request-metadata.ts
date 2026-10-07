/**
 * Metadatos del cliente que se persisten junto a la sesión para auditoría
 * (docs/architecture/authentication.md §6).
 *
 * Solo `ip` y `user-agent`: nunca el refresh token ni su hash
 * (PROJECT_CONTEXT §22).
 */
export interface RequestMetadata {
  ip?: string | null;
  userAgent?: string | null;
}

export function toRequestMetadata(
  headers: Record<string, string | string[] | undefined>,
  ip?: string | null,
): RequestMetadata {
  const raw = headers["user-agent"];
  return {
    ip: ip ?? null,
    userAgent: (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 512) ?? null,
  };
}
