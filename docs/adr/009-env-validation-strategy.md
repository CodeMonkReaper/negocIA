# ADR-009 — Estrategia de validación del entorno

- **Estado:** Aceptado
- **Fecha:** 2026-09-30
- **Ámbito:** Configuración / infraestructura transversal

## Contexto

`docs/architecture/dependency-rules.md` §3.4 fija, desde los primeros hitos, que
"el ENV usa Zod". En la práctica `packages/config` implementa `validateEnv` con
validación explícita y tipada por campo, sin Zod, y es lo que corre en producción
y en las tres suites desde M-2.

La desviación llevaba dos hitos documentada como pendiente de resolver, cuando en
realidad la decisión ya estaba tomada de hecho: el código nunca incorporó Zod y
nadie lo reclamó. El coste de la ambigüedad no era técnico sino de gobierno: una
regla normativa que el código incumple deja de ser normativa, y la siguiente persona
que la lea deduce que existe una validación de entorno que no existe.

## Decisión

1. **`validateEnv` de `@negocia/config` es la estrategia de validación del entorno.**
   Se descarta Zod. Se actualiza la regla normativa para que describa lo que hay.
2. **La regla "no se duplica la validación" se mantiene y es la razón del descarte.**
   `validateEnv` ya cubre tipos, rangos, formatos y obligatoriedad con un único
   mensaje de error agregado. Añadir Zod encima o en paralelo daría dos fuentes de
   verdad para el mismo dato, que es exactamente lo que la regla prohíbe.
3. **Los DTOs de entrada HTTP siguen con `class-validator`.** Sin cambio: es otra
   frontera (petición del cliente, no configuración de arranque) y su.databind de
   estado (`@Body() dto: CreateTenantDto`) es la razón técnica de que siga así.

## Consecuencias

- Positivas: la documentación normativa y el código coinciden; no hay deuda
  abierta en este punto; `validateEnv` mantiene su ventaja de dar el error
  agregado en el arranque, en lugar de fallar en el primer uso.
- Negativas: no se dispone de inferencia de tipos ni de `safeParse` para derivar
  el esquema del entorno. El tipo `ApiEnv` sigue siendo escrito a mano, lo que
  exige disciplina para mantenerlo alineado con la validación. Se acepta: la
  alternativa era una dependencia adicional por una comodidad de tipado.
- La resolución de la desviación es *documental*, no una migración de código. No
  hay cambio de comportamiento en ejecución.

## Alternativas

- **Migrar `packages/config` a Zod:** descartado. Aporta inferencia de tipos a
  costa de reescribir una función que funciona y está cubierta por las tres
  suites, para un beneficio de ergonomía que no es un problema actual.
- **Dejar la regla como estaba y aceptar la desviación:** descartado. Es el estado
  que motivó este ADR, y deja una norma que el código incumple.
- **Eliminar la mención a la validación de entorno de la regla:** descartado. La
  regla sigue siendo útil: fija que existe validación en el arranque y que no se
  duplica.
