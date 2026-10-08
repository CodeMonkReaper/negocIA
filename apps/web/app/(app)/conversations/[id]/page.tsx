"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  ConversationResponseDto,
  LlmRunResponseDto,
  MessageResponseDto,
} from "@negocia/contracts";
import { Badge, Card, Spinner, TextArea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatDuration } from "@/lib/format";
import {
  conversationStatusLabel,
  conversationStatusTone,
  runStatusTone,
} from "@/lib/status";
import { usePolling } from "@/lib/use-poll";

export default function ConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const conversationId = params.id;

  const [conversation, setConversation] =
    useState<ConversationResponseDto | null>(null);
  const [messages, setMessages] = useState<MessageResponseDto[]>([]);
  const [runs, setRuns] = useState<LlmRunResponseDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const refreshingRef = useRef(false);

  const refreshAll = useCallback(
    async (): Promise<{ error: string | null }> => {
      if (refreshingRef.current) {
        return { error: null };
      }
      refreshingRef.current = true;
      try {
        const [messagesRes, runsRes, listRes] = await Promise.all([
          api.messages(conversationId, { limit: 100 }),
          api.runs(conversationId, { limit: 50 }),
          api.conversations({ limit: 100 }),
        ]);
        setMessages(messagesRes.items);
        setRuns(runsRes.items);
        setConversation(
          listRes.items.find((item) => item.id === conversationId) ?? null,
        );
        return { error: null };
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        refreshingRef.current = false;
      }
    },
    [conversationId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { error } = await refreshAll();
      if (cancelled) {
        return;
      }
      if (error) {
        setError(`${error} (${conversationId})`);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAll, conversationId]);

  usePolling(() => void refreshAll(), 10_000);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text || sending) {
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const message = await api.sendMessage(conversationId, text);
      setMessages((prev) => [...prev, message]);
      setDraft("");
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  if (loading) {
    return <Spinner label="Cargando conversación…" />;
  }

  if (error) {
    return (
      <Card title="Conversación">
        <p className="text-sm text-red-400">{error}</p>
        <Link href="/conversations" className="mt-2 inline-block text-sm text-emerald-400 hover:underline">
          Volver al inbox
        </Link>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link
          href="/conversations"
          className="text-sm text-neutral-500 hover:text-neutral-300"
        >
          ← Inbox
        </Link>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              {conversation?.customerName ?? "Cliente"}
            </h1>
            <span className="flex items-center gap-1.5 text-xs text-emerald-500">
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-500" />
              en vivo
            </span>
          </div>
          {conversation ? (
            <Badge tone={conversationStatusTone(conversation.status)}>
              {conversationStatusLabel(conversation.status)}
            </Badge>
          ) : null}
        </div>
        <p className="font-mono text-xs text-neutral-500">
          {conversation?.customerWaId}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-4">
          <Card
            title="Mensajes"
            action={
              <button
                onClick={() => void refreshAll()}
                className="text-sm text-neutral-500 hover:text-neutral-300"
              >
                Recargar
              </button>
            }
          >
            {messages.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Sin mensajes registrados todavía.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {messages.map((message) => (
                  <li
                    key={message.id}
                    className={`flex ${
                      message.direction === "OUTBOUND"
                        ? "justify-end"
                        : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-4 py-2.5 ${
                        message.direction === "OUTBOUND"
                          ? "bg-emerald-900/60 text-emerald-50"
                          : "bg-neutral-800 text-neutral-100"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words text-sm">
                        {message.content ?? (
                          <span className="text-neutral-500">
                            [sin contenido: {message.type}]
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {message.direction === "OUTBOUND" ? "Agente" : "Cliente"}
                        {" · "}
                        {formatDateTime(message.createdAt)}
                        {message.deliveryStatus
                          ? ` · ${message.deliveryStatus}`
                          : null}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div ref={bottomRef} />
          </Card>

          <Card title="Responder">
            {sendError ? (
              <p className="mb-2 text-sm text-red-400">{sendError}</p>
            ) : null}
            <div className="flex items-end gap-2">
              <TextArea
                rows={3}
                placeholder="Escribe la respuesta al cliente… (Enter para enviar)"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending}
              />
              <button
                onClick={() => void send()}
                disabled={sending || draft.trim().length === 0}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </Card>
        </div>

        <div>
          <Card
            title="Runs de LLM"
            action={
              <button
                onClick={() => void refreshAll()}
                className="text-sm text-neutral-500 hover:text-neutral-300"
              >
                Recargar
              </button>
            }
          >
            {runs.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Sin actividad de IA registrada en esta conversación.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {runs.map((run) => (
                  <li
                    key={run.id}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <code className="truncate font-mono text-xs text-neutral-400">
                        {run.requestId}
                      </code>
                      <Badge tone={runStatusTone(run.status)}>
                        {run.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-col gap-0.5 text-xs text-neutral-400">
                      <p>
                        Modelo:{" "}
                        <span className="text-neutral-300">
                          {run.requestedModel}
                          {run.resolvedModel &&
                          run.resolvedModel !== run.requestedModel
                            ? ` → ${run.resolvedModel}`
                            : ""}
                        </span>
                      </p>
                      <p>
                        Tokens: {run.promptTokens} → {run.completionTokens} (total{" "}
                        {run.totalTokens}) · latencia {formatDuration(run.latencyMs)}
                      </p>
                      {run.finishReason ? (
                        <p>Fin: {run.finishReason} · intentos {run.attempts}</p>
                      ) : null}
                      {run.errorCode || run.errorMessage ? (
                        <p className="mt-1 rounded bg-red-500/10 px-2 py-1 text-red-400">
                          {run.errorCode ? `${run.errorCode}: ` : ""}
                          {run.errorMessage}
                        </p>
                      ) : null}
                      <p className="mt-1 text-neutral-600">
                        {formatDateTime(run.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}