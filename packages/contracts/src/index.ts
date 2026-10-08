/**
 * Contratos de wire compartidos entre `apps/api` y `apps/web`.
 *
 * Qué vive aquí y qué no:
 *
 *  - **Sí**: tipos de respuesta, catálogo de errores y envelope. Es lo que el
 *    front necesita para consumir la API sin conocer el backend.
 *  - **No**: DTOs de entrada. Llevan `class-validator` ydecorators de Nest, y
 *    moverlos obligaría al front a arrastrar la validación del servidor para
 *    tipar un formulario que valida en el cliente por su cuenta.
 *
 * Por eso este paquete no importa nada de `apps/api`: el vocabulario de
 * identidades (`identity.ts`) es una **copia de transporte** de los CHECK de la
 * migración, y `identity-vocabulary.spec.ts` verifica que no se separe del
 * dominio. Esa duplicación es el precio de que el paquete sea consumible
 * desde el navegador, y el test es lo que la convierte en algo controlable.
 */

export * from "./errors";
export * from "./identity";
export * from "./auth";
export * from "./invitations";
export * from "./whatsapp";
export * from "./llm";
export * from "./realtime";
export * from "./catalog";

export const API_PREFIX = "/api/v1";
