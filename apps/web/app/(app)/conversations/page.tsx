"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ConversationResponseDto } from "@negocia/contracts";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  conversationStatusLabel,
  conversationStatusTone,
} from "@/lib/status";
import { usePolling } from "@/lib/use-poll";

const PAGE_SIZE = 20;

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<
    ConversationResponseDto[]
  >([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.conversations({ limit: PAGE_SIZE, offset: 0 });
      setConversations(res.items);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) {
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  usePolling(async () => {
    if (conversations.length > PAGE_SIZE) {
      return;
    }
    try {
      const res = await api.conversations({ limit: PAGE_SIZE, offset: 0 });
      setConversations(res.items);
      setTotal(res.total);
    } catch {
      // Silencioso: el error inicial se muestra arriba.
    }
  }, 15_000);

  async function loadMore(): Promise<void> {
    setLoadingMore(true);
    try {
      const res = await api.conversations({
        limit: PAGE_SIZE,
        offset: conversations.length,
      });
      setConversations((prev) => [...prev, ...res.items]);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Conversaciones
            </h1>
            <span className="flex items-center gap-1.5 text-xs text-emerald-500">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-500" />
              en vivo
            </span>
          </div>
          <p className="text-sm text-neutral-500">
            {total > 0 ? `${total} en total` : "Inbox del canal de WhatsApp"}
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          Recargar
        </Button>
      </header>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {loading ? <Spinner label="Cargando conversaciones…" /> : null}

      {!loading && conversations.length === 0 && !error ? (
        <Card>
          <p className="text-sm text-neutral-500">
            No hay conversaciones todavía. Cuando un cliente escriba al número
            conectado, aparecerá aquí.
          </p>
        </Card>
      ) : null}

      {conversations.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-neutral-800 bg-neutral-900/60 text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">
                  Wa ID
                </th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">
                  Último mensaje
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {conversations.map((conversation) => (
                <tr
                  key={conversation.id}
                  className="bg-neutral-900/30 transition-colors hover:bg-neutral-800/40"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/conversations/${conversation.id}`}
                      className="font-medium text-neutral-100 hover:text-emerald-400"
                    >
                      {conversation.customerName ?? conversation.customerWaId}
                    </Link>
                  </td>
                  <td className="hidden px-4 py-3 font-mono text-xs text-neutral-500 sm:table-cell">
                    {conversation.customerWaId}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={conversationStatusTone(conversation.status)}>
                      {conversationStatusLabel(conversation.status)}
                    </Badge>
                  </td>
                  <td className="hidden px-4 py-3 text-neutral-400 md:table-cell">
                    {formatDateTime(conversation.lastMessageAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/conversations/${conversation.id}`}
                      className="text-sm text-emerald-400 hover:underline"
                    >
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {conversations.length > 0 && conversations.length < total ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}