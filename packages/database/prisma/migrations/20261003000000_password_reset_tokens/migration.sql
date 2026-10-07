-- =============================================================================
-- F2-2 — password_reset_tokens: tokens de un solo uso para restablecer contraseña
--
-- docs/adr/009, docs/api/authentication.md §9.
--
-- Tabla independiente de `verification_tokens` a propósito (ADR-008): ambos
-- tokens comparten ciclo de vida (1-uso, hash, expiración) pero son dominios
-- distintos y ADR-008 mantiene la separación hasta que aparezcan 4+ tipos de
-- token unificables con un `purpose`.
--
-- El token crudo jamás se persiste: solo su hash SHA-256 (único). La expiración
-- es perezosa: un token vencido se consume al usarlo, igual que invitaciones.
-- =============================================================================

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key"
    ON "password_reset_tokens"("token_hash");

-- Un mesmo usuario no debe poder tener dos resets vivos: la invalidación de
-- pendientes ocurre en la aplicación antes de emitir; el índice solo refuerza
-- la consulta por usuario.
CREATE INDEX "password_reset_tokens_user_id_idx"
    ON "password_reset_tokens"("user_id");

-- Agente de la integridad referencial: el borrado del usuario arrastra sus
-- tokens (misma semántica que verification_tokens).
ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;