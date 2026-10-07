# ADR-007 — Planes y límites como servicio de dominio (no JSONB)

- **Estado:** Aceptado
- **Fecha:** 2026-09-21
- **Ámbito:** Pricing / límites del producto

## Contexto

Tres planes conceptuales (Básico/Pro/Premium) con límites de mensajes, productos y usuarios. PROJECT_CONTEXT §27 pide que límites/planes/uso se puedan modificar sin reescribir el core.

## Decisión

1. **`tenants.plan` es solo un valor de metadato** (enum `BASIC|PRO|PREMIUM`) que referencia un catálogo de planes.
2. **`PlanCatalog` + `LimitsService`** (domain/application) son la **fuente de las reglas**: dado un `plan`, devuelven los límites (`maxMessages`, `maxProducts`, `maxUsers`). Los límites se definen en un catálogo tipado/seed (tabla `plans` o const tipada), **nunca como `limits JSONB` con reglas interpretadas en la capa de presentación.**
3. Fase 1 **no implementa billing**: se crea la estructura de catálogo y el servicio de cómputo de límites; la verificación se aplica al crear operaciones (p. ej. al invitar → validar `max_users`).

## Consecuencias

- Migración futura limpia: `plans`, `plan_features`, `subscriptions`, `usage` se agregan como tablas nuevas; el dominio ya depende del servicio, no de campos free-form.
- Puede monitorearse consumo con `usage` después sin romper la referencia `tenant.plan`.
- `LimitsService` es testeable de forma unitaria (reglas puras) e inyectable en cualquier caso de uso (HTTP o job).

## Alternativas

- **JSONB con límites:** descartado — reglas ocultas en datos, difícil validar, apuestas a romper invariantes, y el propio contexto la descarta como fuente de reglas.
- **Enums/códulo hardcodeado en módulo:** válido como catálogo estático, pero se centraliza en `PlanCatalog` para evolución sin cambio de firma.