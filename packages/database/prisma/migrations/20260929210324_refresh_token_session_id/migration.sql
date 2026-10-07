-- =============================================================================
-- M-4 — session_id + tenant_id: identidad completa de la familia de refrescos
--
-- docs/architecture/authentication.md §5-§6, docs/adr/005.
--
-- La familia de refrescos (fila raíz + descendientes encadenados por
-- `replaced_by_token_id`) no tenía columna propia: revocar la familia tras un
-- reuse attack o un logout exigía recorrer la cadena hacia atrás (O(n) queries).
-- `session_id` fija el id de la fila raíz en cada fila, con lo que la
-- revocación de la familia pasa a ser un único UPDATE y el `jti` del access
-- JWT es directamente el `session_id` (auth.md §6: "jti = id de sesión;
-- representada por la familia").
--
-- `tenant_id` ancla además el tenant activo de la sesión. El access token
-- caduca a los 15 minutos, así que cuando el cliente renueva una sesión
-- caducada el backend solo dispone del refresh token opaco: sin esta columna
-- no podría reconstruir el `tenant_id` del nuevo access token.
--
-- SIN foreign key a propósito: una auto-referencia ON DELETE RESTRICT
-- impediría eliminar la raíz mientras existieran descendientes, y el tenant de
-- una sesión no se borra nunca (se cierra con status=CLOSED). La raíz se
-- identifica por la invariante session_id === id.
-- =============================================================================

-- AlterTable (nullable primero para poder backfillear)
ALTER TABLE "refresh_tokens" ADD COLUMN "session_id" UUID;
ALTER TABLE "refresh_tokens" ADD COLUMN "tenant_id" UUID;

-- Backfill: cada fila se ancla a la raíz de su cadena, es decir, la fila que
-- no es referenciada por el `replaced_by_token_id` de ninguna otra.
-- Si un usuario tuviera MÁS de una raíz (sesiones simultáneas en varios
-- dispositivos), se ancla a sí misma en lugar de elegir una raíz arbitraria:
-- fusionar sesiones distintas bajo un mismo session_id sería un bug de
-- seguridad (un logout en un dispositivo mataría al otro).
UPDATE "refresh_tokens" r
SET "session_id" = CASE
    WHEN (
        SELECT count(*)
        FROM "refresh_tokens" root
        WHERE root."user_id" = r."user_id"
          AND NOT EXISTS (
              SELECT 1 FROM "refresh_tokens" child
              WHERE child."replaced_by_token_id" = root."id"
          )
    ) = 1
    THEN (
        SELECT root."id"
        FROM "refresh_tokens" root
        WHERE root."user_id" = r."user_id"
          AND NOT EXISTS (
              SELECT 1 FROM "refresh_tokens" child
              WHERE child."replaced_by_token_id" = root."id"
          )
    )
    ELSE r."id"
END;

-- tenant_id: cada token hereda el tenant de la raíz de su familia. Con varias
-- raíces (multi-dispositivo) se usa la membresía activa más antigua del
-- usuario, criterio idéntico al que aplica `AuthService.resolveInitialMembership`
-- al abrir sesión en login.
UPDATE "refresh_tokens" r
SET "tenant_id" = COALESCE(
    (
        SELECT m."tenant_id"
        FROM "memberships" m
        WHERE m."user_id" = r."user_id" AND m."status" = 'ACTIVE'
        ORDER BY m."created_at" ASC
        LIMIT 1
    ),
    r."session_id"
);

-- AlterTable (las columnas pasan a ser NOT NULL)
ALTER TABLE "refresh_tokens" ALTER COLUMN "session_id" SET NOT NULL;
ALTER TABLE "refresh_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens"("session_id");
CREATE INDEX "refresh_tokens_tenant_id_idx" ON "refresh_tokens"("tenant_id");

-- Sesiones vivas por familia: sostiene el UPDATE de revocación de familia
-- (reuse attack / logout) sin recorrer la cadena.
CREATE INDEX "refresh_tokens_session_id_active_idx"
    ON "refresh_tokens" ("session_id")
    WHERE "revoked_at" IS NULL;
