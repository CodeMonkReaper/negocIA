# ADR-008 — Invitaciones y verificación de email en Fase 1

- **Estado:** Aceptado
- **Fecha:** 2026-09-21
- **Ámbito:** Identidad / onboarding

## Contexto

El onboarding de un tenant involucra invitar miembros (OWNER/ADMIN invitan, con rol), y verificar emails. Se definió que este modelo forma parte de **Fase 1**, con el proveedor real de email diferido a Fase 2.

## Decisión

1. **Modelo de invitación** en BD: tabla `invitations` (tenant_id, email, role, invited_by, token_hash, status, expires_at, accepted_at, accepted_by, revoked_at) — detalle en `database/schema.md`.
   - Token opaco de un solo uso, almacenado **solo como hash** SHA-256 (único).
   - Consumo atómico idempotente (`UPDATE … WHERE status='PENDING' AND token_hash=:h`; 0 filas → invalidar).
   - Expiración (48h por defecto). **Implementado como expiración perezosa** (M-5): una invitación `PENDING` con `expires_at <= now()` se marca `EXPIRED` al leerla o aceptarla. El job activo queda para Fase 2; el índice `(status, expires_at)` ya está creado y el comportamiento observable es el mismo, salvo que los tokens vencidos no se limpian en segundo plano.
   - Evitar duplicados: no invitar a un email ya miembro, ni duplicar `PENDING` por email en el mismo tenant (partial unique como defensa).
2. **Verificación de email**: tabla `verification_tokens` (1-uso, hash, expira) + `users.email_verified_at`. Aceptar una invitación también verifica el email.
3. **Reglas de autorización** definidas en Fase 1:
   - Invitar / revocar: `OWNER` o `ADMIN` del tenant.
   - Aceptar: usuario autenticado cuyo email **coincide** con el de la invitación. Está prohibido que un usuario acepte una invitación de otro email.
   - Al aceptar: se crea la membership con el rol propuesto (limitado por `LimitsService`: `max_users`).
   - `max_users` se comprueba **al invitar** (error inmediato, mejor UX) y **se revalida dentro de la transacción de accept**. La segunda comprobación no es redundante: entre el invite y el accept pueden entrar varias invitaciones para el mismo plan, así que el conteo en el momento de aceptar es el único que puede garantizar el límite. Sin ella, N invitaciones simultáneas a un plan con 1 plaza libre producen N membresías.
4. **`EmailSender` como puerto de dominio**: adapter mock (`MockEmailAdapter`) en dev para probar el flujo completo (impresión/log del token en entorno dev); proveedor real (SendGrid/Resend/equivalentes) en Fase 2 detrás del mismo puerto.
5. **Errores de token literales y uniformes.** Token inválido, vencido, ya usado, revocado o dirigido a otro email devuelven todos `invalid_token` (400). Distinguir los casos en el código de respuesta convertiría el endpoint en un oráculo que permite comprobar si un email tiene una invitación viva, que es información de otro usuario.
6. **Rate limiting** en crear/resend invitaciones y resend de verificación.

## Consecuencias

- Flujo completo de onboarding (invitar → registrarse/login → aceptar → verificar) testeable de punta a punta sin proveedor de email.
- Si un usuario acepta una invitación pero la aplicación no tiene al usuario autenticado del email (nuevo), el flujo exige registrarse primero (register es público y luego accept). El caso "invitación a un nuevo email" termina creando el user en register; el invite queda pendiente para su aceptación.
- Positivas: seguridad de tokens por hash, inmutabilidad de familia, reagrupación futura vía columnas de auditoría (`invited_by`, `accepted_by`).

## Alternativas

- **Tabla única de tokens de un solo uso (genérica) para invitación + verificación + password reset:** se evaluó y se descartó por mezclar dominios con requisitos distintos (la invitación necesita metadatos de rol/tenant; el reset no — y ambos con ciclos de vida distintos). Se mantiene `invitations` + `verification_tokens` separadas; si más adelante aparecen 4+ tipos de token se evalúa unificar con `purpose`.
- **Deferir invitaciones fuera de Fase 1:** descartado por decisión del equipo (el onboarding multi-usuario es parte del MVP).
- **Tokens legibles almacenados en BD:** descartado por razones de seguridad (un dump de BD no debe exponer tokens válidos).