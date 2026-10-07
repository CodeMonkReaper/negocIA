import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@negocia/config";

/**
 * Configuración de auth, resuelta **una vez** al arrancar.
 *
 * Concentrar los TTL aquí tiene dos beneficios: los tests pueden inyectar un
 * reloj fijo (`now()`) sin tocar el sistema, y ningún caso de uso lee
 * `process.env` directamente.
 */
@Injectable()
export class AuthConfigService {
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
  readonly issuer: string;
  readonly audience: string;
  readonly jwtSecret: string;
  readonly argon2: {
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  };

  private fixedNow: Date | null = null;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.accessTtlSeconds = config.get("JWT_ACCESS_TTL_SECONDS", {
      infer: true,
    });
    this.refreshTtlSeconds = config.get("JWT_REFRESH_TTL_SECONDS", {
      infer: true,
    });
    this.issuer = config.get("JWT_ISSUER", { infer: true });
    this.audience = config.get("JWT_AUDIENCE", { infer: true });
    this.jwtSecret = config.get("JWT_SECRET", { infer: true });
    this.argon2 = {
      memoryCost: config.get("ARGON2_MEMORY_COST", { infer: true }),
      timeCost: config.get("ARGON2_TIME_COST", { infer: true }),
      parallelism: config.get("ARGON2_PARALLELISM", { infer: true }),
    };
  }

  now(): Date {
    return this.fixedNow ?? new Date();
  }

  /** Reloj congelado: solo para tests, nunca se usa en producción. */
  freezeClock(at: Date): void {
    this.fixedNow = at;
  }
}
