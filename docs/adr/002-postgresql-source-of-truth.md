# ADR-002 — PostgreSQL como fuente de verdad

- **Estado:** Aceptado
- **Fecha:** 2026-09-21
- **Ámbito:** Datos / consistencia

## Contexto

Reservas, pedidos, disponibilidad, usuarios y mensajes son datos de negocio sensibles a la consistencia. Redis se usa para jobs y estados auxiliares, pero no debe ser la única copia de algo crítico.

## Decisión

**PostgreSQL es la fuente de verdad** para todos los datos de negocio. Redis/BullMQ son auxiliares (queues, locks, caché de lecturas no críticas, estados temporales no durables). El esquema evoluciona con **migraciones versionadas**.

## Consecuencias

- Reservas/agenda (Fase 5) usan transacciones, unique/exclusion constraints e índices GiST en Postgres; Redis nunca guarda el "estado real" de un slot.
- Los jobs de BullMQ pueden reejecutarse: el efecto debe ser idempotente **en Postgres** (constraints, `provider_event_id` único), no confiando en el estado del job.
- `SET LOCAL app.set_tenant_id` (RLS) ocurre en la transacción, garantizando que rollback revierte contexto.

## Alternativas consideradas

- **Redis como cache-aside con write-through inmediato a Postgres:** válido para lecturas calientes; no cambia la decisión (Postgres sigue siendo SSOT).
- **Redis como sorce para reservas (HOLD):** descartado; los HOLD son estado transitorio *reflejado* en Redis para TTL, pero la disponibilidad se decide en Postgres.

## Regla derivada

Prohibido leer un dato de negocio únicamente de Redis sin capacidad de reconstruirlo desde Postgres.