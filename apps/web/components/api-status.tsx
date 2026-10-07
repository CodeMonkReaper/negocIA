"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { HealthResponse } from "@negocia/contracts";

interface ApiStatusProps {
  apiBaseUrl: string;
}

type StatusState =
  | { kind: "loading" }
  | { kind: "ok"; health: HealthResponse }
  | { kind: "error"; message: string };

const healthUrl = (base: string): string =>
  `${base.replace(/\/$/, "")}/health`;

export function ApiStatus({ apiBaseUrl }: ApiStatusProps) {
  const [state, setState] = useState<StatusState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const response = await fetch(healthUrl(apiBaseUrl), {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const health = (await response.json()) as HealthResponse;
        if (!cancelled) {
          setState({ kind: "ok", health });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  if (state.kind === "loading") {
    return (
      <Section title="API /health">
        Consultando {healthUrl(apiBaseUrl)}…
      </Section>
    );
  }

  if (state.kind === "error") {
    return (
      <Section title="API /health">
        No responde ({state.message}). Asegúrate de que apps/api esté corriendo.
      </Section>
    );
  }

  const { health } = state;

  return (
    <Section title="API /health">
      {health.status} · {health.service} v{health.version} ·{" "}
      {health.environment} · requestId: {health.requestId ?? "n/a"}
    </Section>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
      <h2 className="font-semibold text-neutral-100">{title}</h2>
      <p className="mt-1 font-mono text-sm text-neutral-300">{children}</p>
    </section>
  );
}