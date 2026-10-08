"use client";

import type { RealtimeEventDto } from "@negocia/contracts";
import { API_BASE, loadTokens } from "./api";

export type RealtimeHandler = (event: RealtimeEventDto) => void;

const MAX_BACKOFF_MS = 30_000;

// Una única conexión SSE por pestaña: el `EventSource` nativo no permite mandar
// el Bearer, así que usamos fetch + ReadableStream con reconexión/backoff.
// `AuthProvider` la arranca/parada según el estado de sesión; las páginas se
// suscriben al stream con `subscribeRealtime`/`useRealtime`.
let started = false;
let controller: AbortController | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
const listeners = new Set<RealtimeHandler>();

export function startRealtime(): void {
  if (started) {
    return;
  }
  started = true;
  void connect();
}

export function stopRealtime(): void {
  started = false;
  if (retry) {
    clearTimeout(retry);
    retry = null;
  }
  controller?.abort();
  controller = null;
  attempts = 0;
}

export function subscribeRealtime(handler: RealtimeHandler): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

async function connect(): Promise<void> {
  if (!started) {
    return;
  }
  const token = loadTokens()?.accessToken;
  if (!token) {
    return;
  }

  const current = new AbortController();
  controller = current;
  try {
    const response = await fetch(`${API_BASE}/events/stream`, {
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      signal: current.signal,
    });
    if (!started) {
      return;
    }
    if (!response.ok || !response.body) {
      throw new Error(`SSE HTTP ${response.status}`);
    }
    attempts = 0;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // Sin límite: el for termina solo si el servidor cierra el stream.
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        handleChunk(chunk);
      }
    }
  } catch {
    // Abortado por `stopRealtime` o red caída: ambos terminan en la misma
    // reconexión programada abajo (que es un no-op si `started` es falso).
  } finally {
    if (controller === current) {
      controller = null;
    }
  }
  scheduleReconnect();
}

function handleChunk(chunk: string): void {
  let data = "";
  for (const line of chunk.split("\n")) {
    // Heartbeat y comentarios SSE (`: ...`) también aterrizan aquí.
    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("data:")) {
      data += line.slice(5).trimStart();
    }
  }
  if (!data) {
    return;
  }
  try {
    const event = JSON.parse(data) as RealtimeEventDto;
    for (const listener of listeners) {
      listener(event);
    }
  } catch {
    // Payload malformado: se ignora igual que en el server.
  }
}

function scheduleReconnect(): void {
  if (!started) {
    return;
  }
  attempts += 1;
  const delay = Math.min(1_000 * 2 ** (attempts - 1), MAX_BACKOFF_MS);
  retry = setTimeout(() => {
    retry = null;
    void connect();
  }, delay);
}