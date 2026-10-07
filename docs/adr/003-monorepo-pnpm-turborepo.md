# ADR-003 — Monorepo: pnpm workspaces + Turborepo

- **Estado:** Aceptado
- **Fecha:** 2026-09-21
- **Ámbito:** Repositorio / herramienta

## Contexto

Backend NestJS + frontend Next.js + paquetes compartidos. Se necesita código compartido de contratos, database client, y configuraciones, con builds/test/lint orquestados y sin duplicar dependencias entre apps.

## Decisión

**pnpm workspaces + Turborepo.**

```text
apps/api      → NestJS 11 (Express)
apps/web      → Next.js
packages/contracts     → DTOs/schemas de wire (solo tipos, sin lógica de persistencia)
packages/database      → schema.prisma + migraciones + PrismaClient factory
packages/config        → tsconfigs/prettier compartidos
packages/eslint-config → config de ESLint flat compartido
```

- Node 24 LTS fijado en `engines`, `Dockerfile` y CI.
- Turborepo orquesta `build`, `lint`, `test`, `dev` con caché por task.
- `pnpm` para install determinista y workspace protocol (`workspace:*`).

## Consecuencias

- Frontend y backend comparten `contracts` → contratos de API versionados en un solo lugar.
- El frontend **no** depende de `packages/database` (ver `architecture/dependency-rules.md` §4).
- El worker futuro comparte `apps/api` + `packages/database` (procesos del mismo código base).

## Alternativas

- **npm workspaces:** sin cache de tasks ni granularidad de filters de Turborepo, y peor handling de hoisting para monorepos grandes.
- **Lerna/tercera generación:** Turborepo es el estándar moderno del ecosistema Next.js y cubre lo necesario.
- **Repo único sin workspaces (`packages/*` a mano):** descartado por coordinación manual de builds.