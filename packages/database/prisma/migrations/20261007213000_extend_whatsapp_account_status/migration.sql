-- Extiende el CHECK de whatsapp_accounts.status con TOKEN_EXPIRED (M8.2).
--
-- TOKEN_EXPIRED deja la cuenta inoperante para envíos (findById/findByPhoneNumberId
-- filtran ACTIVE) pero sigue siendo candidata a renovación automática
-- (findExpiringBefore incluye el estado) y a re-signup. Convención del monorepo:
-- enums como TEXT + CHECK, evolucionar no requiere ALTER TYPE.
ALTER TABLE "whatsapp_accounts" DROP CONSTRAINT "whatsapp_accounts_status_check";
ALTER TABLE "whatsapp_accounts"
    ADD CONSTRAINT "whatsapp_accounts_status_check"
    CHECK ("status" IN ('ACTIVE', 'DISABLED', 'TOKEN_EXPIRED'));