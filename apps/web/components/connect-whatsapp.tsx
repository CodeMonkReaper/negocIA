"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";

type ConnectState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "connected" }
  | { kind: "error"; message: string };

interface ConnectWhatsAppProps {
  onConnected?: () => void;
}

/**
 * Botón de Embedded Signup (M8.1): obtiene la URL de autorización, abre el
 * popup de Meta y escucha el `postMessage` que la API devuelve desde el
 * callback para refrescar el estado.
 */
export function ConnectWhatsApp({ onConnected }: ConnectWhatsAppProps) {
  const [state, setState] = useState<ConnectState>({ kind: "idle" });

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; result?: { success?: boolean; error?: string } }
        | undefined;
      if (data?.type === "whatsapp_connected") {
        setState({ kind: "connected" });
        onConnected?.();
      } else if (data?.type === "whatsapp_connection_error") {
        setState({
          kind: "error",
          message: data.result?.error ?? "No se pudo conectar la cuenta.",
        });
      }
    },
    [onConnected],
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  async function start(): Promise<void> {
    setState({ kind: "loading" });
    try {
      const { url } = await api.embeddedSignupUrl();
      const popup = window.open(url, "negocia-whatsapp", "width=600,height=720");
      if (!popup) {
        setState({
          kind: "error",
          message:
            "El navegador bloqueó la ventana emergente. Permítela e inténtalo de nuevo.",
        });
        return;
      }
      setState({ kind: "idle" });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        onClick={() => {
          void start();
        }}
        disabled={state.kind === "loading"}
      >
        {state.kind === "loading"
          ? "Generando enlace…"
          : state.kind === "connected"
            ? "Conectar otra cuenta"
            : "Conectar WhatsApp"}
      </Button>
      {state.kind === "connected" ? (
        <p className="text-sm text-emerald-400">
          Cuenta conectada correctamente.
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p className="text-sm text-red-400">{state.message}</p>
      ) : null}
    </div>
  );
}