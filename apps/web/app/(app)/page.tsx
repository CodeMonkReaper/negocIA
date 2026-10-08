"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type {
  ConversationResponseDto,
  WhatsappAccountResponseDto,
} from "@negocia/contracts";
import { ConnectWhatsApp } from "@/components/connect-whatsapp";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import {
  accountStatusLabel,
  accountStatusTone,
  conversationStatusLabel,
  conversationStatusTone,
} from "@/lib/status";

export default function DashboardPage() {
  const { user, tenant, membership } = useAuth();
  const isOwner = membership?.role === "OWNER";
  const [accounts, setAccounts] = useState<WhatsappAccountResponseDto[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<
    ConversationResponseDto[]
  >([]);
  const [conversationsError, setConversationsError] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (isOwner) {
      try {
        const res = await api.accounts();
        setAccounts(res.items);
        setAccountsError(null);
      } catch (error) {
        setAccountsError(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    try {
      const res = await api.conversations({ limit: 5 });
      setConversations(res.items);
      setConversationsError(null);
    } catch (error) {
      setConversationsError(
        error instanceof Error ? error.message : String(error),
      );
    }
    setLoading(false);
  }, [isOwner]);

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

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Hola, {user?.name?.split(" ")[0]}
        </h1>
        <p className="text-sm text-neutral-500">
          Panel de {tenant?.name} · rol {membership?.role}
        </p>
      </header>

      {loading ? <Spinner label="Cargando panel…" /> : null}

      <Card
        title="WhatsApp"
        action={
          <Link
            href="/whatsapp"
            className="text-sm text-emerald-400 hover:underline"
          >
            Ver cuentas
          </Link>
        }
      >
        {isOwner ? (
          <div className="flex flex-col gap-4">
            {accountsError ? (
              <p className="text-sm text-red-400">{accountsError}</p>
            ) : accounts.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Conecta tu primer número de WhatsApp para recibir
                conversaciones.
              </p>
            ) : null}

            {accounts.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {accounts.map((account) => (
                  <li
                    key={account.id}
                    className="flex items-center justify-between gap-4 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-neutral-100">
                        {account.displayPhone ?? account.phoneNumberId}
                      </span>
                      <span className="font-mono text-xs text-neutral-500">
                        {account.wabaId}
                      </span>
                    </div>
                    <Badge tone={accountStatusTone(account.status)}>
                      {accountStatusLabel(account.status)}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}

            <ConnectWhatsApp onConnected={load} />
          </div>
        ) : (
          <p className="text-sm text-neutral-500">
            Solo el propietario (OWNER) administra las cuentas de WhatsApp de
            este tenant.
          </p>
        )}
      </Card>

      <Card
        title="Conversaciones recientes"
        action={
          conversations.length > 0 ? (
            <Link
              href="/conversations"
              className="text-sm text-emerald-400 hover:underline"
            >
              Ver todas
            </Link>
          ) : null
        }
      >
        {conversationsError ? (
          <p className="text-sm text-red-400">{conversationsError}</p>
        ) : conversations.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Todavía no hay conversaciones de WhatsApp en este tenant.
          </p>
        ) : null}

        <ul className="flex flex-col gap-2">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/conversations/${conversation.id}`}
                className="flex items-center justify-between gap-4 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 transition-colors hover:bg-neutral-800/60"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-100">
                    {conversation.customerName ?? conversation.customerWaId}
                  </p>
                  <p className="font-mono text-xs text-neutral-500">
                    {conversation.customerWaId}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge tone={conversationStatusTone(conversation.status)}>
                    {conversationStatusLabel(conversation.status)}
                  </Badge>
                  <span className="hidden text-xs text-neutral-500 sm:inline">
                    {formatRelative(conversation.lastMessageAt)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        {conversations.length > 0 ? (
          <div className="mt-4">
            <Link href="/conversations">
              <Button variant="secondary">Abrir inbox</Button>
            </Link>
          </div>
        ) : null}
      </Card>
    </div>
  );
}