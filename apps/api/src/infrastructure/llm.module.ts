import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ApiEnv } from "@negocia/config";
import { LLM_PROVIDER } from "../common/di-tokens";
import { MockLlmAdapter } from "./llm.mock";
import { OpenRouterLlmAdapter } from "./llm.openrouter";

/**
 * Composition root del proveedor de IA.
 *
 * Selecciona el adaptador por `LLM_DRIVER` (validado en `validateEnv`), con el
 * mismo criterio que `EMAIL_DRIVER` y `META_DRIVER`:
 *
 *  - `mock`: `MockLlmAdapter` (buffer en memoria; dev/test).
 *  - `openrouter`: `OpenRouterLlmAdapter` sobre la API de OpenRouter (producción).
 *
 * `LLM_PROVIDER` se resuelve por factory para que el motor de conversación
 * (F3-3b) nunca importe infraestructura. `MockLlmAdapter` se **exporta** además
 * del token: los tests lo recuperan con `app.get(MockLlmAdapter)` para leer las
 * peticiones hechas al modelo.
 *
 * Este hito solo deja el proveedor disponible: todavía ningún caso de uso lo
 * consume. `worker.module.ts` no lo importa porque el motor correrá como proceso
 * del worker y se cableará en el hito siguiente.
 */
@Module({
  providers: [
    { provide: MockLlmAdapter, useFactory: () => new MockLlmAdapter() },
    {
      provide: OpenRouterLlmAdapter,
      // Solo se instancia con `LLM_DRIVER=openrouter`: sin API key no hay
      // llamada posible, y en dev/test el selector elige el mock.
      useFactory: (config: ConfigService<ApiEnv, true>) =>
        config.get("LLM_DRIVER", { infer: true }) === "openrouter"
          ? new OpenRouterLlmAdapter({
              apiKey: config.get("OPENROUTER_API_KEY", { infer: true }),
              model: config.get("LLM_MODEL", { infer: true }),
              baseUrl: config.get("LLM_BASE_URL", { infer: true }),
              timeoutMs: config.get("LLM_TIMEOUT_MS", { infer: true }),
              appUrl: config.get("LLM_APP_URL", { infer: true }),
              appTitle: config.get("LLM_APP_TITLE", { infer: true }),
            })
          : undefined,
      inject: [ConfigService],
    },
    {
      provide: LLM_PROVIDER,
      useFactory: (
        config: ConfigService<ApiEnv, true>,
        mock: MockLlmAdapter,
        openrouter: OpenRouterLlmAdapter | undefined,
      ) => (config.get("LLM_DRIVER", { infer: true }) === "openrouter" ? openrouter : mock),
      inject: [ConfigService, MockLlmAdapter, OpenRouterLlmAdapter],
    },
  ],
  exports: [LLM_PROVIDER, MockLlmAdapter],
})
export class LlmModule {}
