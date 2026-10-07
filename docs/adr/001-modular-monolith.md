# ADR-001 — Modular Monolith

- **Estado:** Aceptado
- **Fecha:** 2026-09-21 (diseño Fase 1)
- **Ámbito:** Arquitectura de aplicación

## Contexto

El SaaS debe soportar múltiples dominios (identidad, WhatsApp, IA, ventas, agenda, billing) con alta testabilidad y evolución, pero sin la complejidad operacional de microservicios desde el día uno.

## Decisión

Implementar un **modular monolith**: un solo backend NestJS organizado en módulos con límites claros (`AuthModule`, `TenantsModule`, `UsersModule`, `InvitationsModule`, y futuros `WhatsAppModule`, `ConversationsModule`, `SalesModule`, `SchedulingModule`, `BillingModule`). La arquitectura favorece el desacople por módulo con interfaces bien definidas, no por red.

## Consecuencias

- Positivas: despliegue simple, transacciones ACID entre módulos, testing e2e sencillo, costo operacional bajo, integraciones internas por llamadas directas (misma transacción).
- Negativas: requiere disciplina de límites de módulo; una escalada de tráfico exige escalar horizontalmente el monolith.
- Mitigación: los workers (BullMQ) son procesos separados del mismo código base (`apps/api` con entry worker), lo que permitirá escalar el procesamiento asíncrono sin fragmentar el servicio HTTP.

## Alternativas

- **Microservicios:** descartados por PROJECT_CONTEXT §25 ("no crear microservicios hasta que exista una razón operacional real") y sobrecosto de consistencia distribuida.
- **Single service monolítico "puro":** sin límites de módulo, se descarta por mantenibilidad y por la exigencia del dominio (webhooks, workers, IA).

## Crítica

Si un nuevo vector (webhooks con picos de Meta, IA con rate limits de LLM) ejerce presión asimétrica, el primer paso será extraer el **worker** como proceso dedicado (ya contemplado) y solo después evaluar extraer dominios (p. ej. agenda) como servicio.