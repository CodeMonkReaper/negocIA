import { SetMetadata } from "@nestjs/common";

/**
 * Marca una ruta como accesible sin token.
 *
 * Uso restringido a dos casos: readiness/liveness (`/health`) y el propio login
 * (`/v1/auth/login`). Cualquier otro endpoint es privado por omisión
 * (fail-closed): el guard global `JwtAuthGuard` exige token salvo que se vea
 * este decorador.
 */
export const IS_PUBLIC_KEY = "auth:public";

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
