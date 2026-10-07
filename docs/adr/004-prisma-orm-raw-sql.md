# ADR-004 — Prisma 7 con SQL raw para invariantes PostgreSQL

- **Estado:** Aceptado
- **Fecha:** 2026-09-21
- **Ámbito:** Acceso a datos

## Contexto

Se requiere un ORM productivo (tipeo fuerte, migraciones) sobre PostgreSQL, y a la vez soporte real para invariantes Postgres que un ORM no expone de forma nativa: range types, exclusion constraints, índices GiST, transacciones explícitas y RLS (Fase 2).

## Decisión

- **Prisma 7** con driver adapter `@prisma/adapter-pg` como ORM principal.
- **SQL raw permitido** en dos lugares acotados:
  1. **Migraciones** (SQL editado/escrito a mano) para invariantes de BD que Prisma no modela: extensiones (`citext`, `btree_gist`), exclusion constraints de agenda (Fase 5), partial unique indexes, índices GiST.
  2. **Queries directas** (`$queryRaw`/`$transaction`) cuando el invariante no pueda expresarse con el cliente con type-safety, **siempre dentro del caso de uso** y nunca con interpolación de entrada del usuario/LLM (solo placeholders parametrizados).

## Consecuencias

- Las garantías de anti-solapamiento y concurrencia de la agenda se implementan **en Postgres** (exclusion constraint con `tstzrange` + GiST + `NULLS NOT DISTINCT` en Fase 5), no como lógica de aplicación.
- El esquema vive en `packages/database`; migraciones versionadas y reproducibles.
- RLS (Fase 2): políticas dentro de migraciones SQL + `SET LOCAL` por transacción desde el side de aplicación (Prisma `$transaction` con `executeRaw`), alineado con `tenant-context.md`.

## Alternativas

- **Drizzle ORM:** más cercano a SQL y con soporte RLS nativo en su rama beta; descartado en Fase 1 por migraciones/ecosistema menos maduros y RLS aún beta frente a Prisma 7 (RLS first-class). Se reevaluará si Drizzle estabiliza y el equipo lo prefiere; decisión registrada (facilita futuro cambio al tener repositorios como puertos).
- **TypeORM:** descartado por DX de migraciones inferior y clientes menos tipados.

## Justificación de madurez

Prisma 7 introduce RLS first-class y driver adapters (Neon/Supabase/pg) — verificado contra documentación vigente al momento del ADR.