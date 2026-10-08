"use client";

import { useCallback, useEffect, useState } from "react";
import type { WhatsappAccountResponseDto } from "@negocia/contracts";
import { ConnectWhatsApp } from "@/components/connect-whatsapp";
import { Badge, Card, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import {
  accountStatusLabel,
  accountStatusTone,
} from "@/lib/status";

export default function WhatsappPage() {
  const { membership } = useAuth();
  const isOwner = membership?.role === "OWNER";
  const [accounts, setAccounts] = useState<WhatsappAccountResponseDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!isOwner) {
      return;
    }
    try {
      const res = await api.accounts();
      setAccounts(res.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
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
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          WhatsApp
        </h1>
        <p className="text-sm text-neutral-500">
          Números conectados al tenant y alta de nuevos WABAs.
        </p>
      </header>

      {!isOwner ? (
        <Card>
          <p className="text-sm text-neutral-500">
            Solo el propietario (OWNER) puede ver y administrar las cuentas de
            WhatsApp.
          </p>
        </Card>
      ) : null}

      {isOwner && loading ? <Spinner label="Cargando cuentas…" /> : null}

      {isOwner && !loading ? (
        <Card
          title={`Cuentas (${accounts.length})`}
          action={
            <button
              onClick={() => void load()}
              className="text-sm text-neutral-500 hover:text-neutral-300"
            >
              Recargar
            </button>
          }
        >
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          {accounts.length === 0 && !error ? (
            <p className="text-sm text-neutral-500">
              Aún no hay números conectados.
            </p>
          ) : null}

          <ul className="flex flex-col gap-2">
            {accounts.map((account) => (
              <li
                key={account.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-neutral-100">
                    {account.displayPhone ?? account.phoneNumberId}
                  </span>
                  <span className="font-mono text-xs text-neutral-500">
                    id: {account.phoneNumberId}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="hidden font-mono text-xs text-neutral-500 md:inline">
                    {account.wabaId}
                  </span>
                  <Badge tone={accountStatusTone(account.status)}>
                    {accountStatusLabel(account.status)}
                  </Badge>
                </div>
                <p className="w-full text-xs text-neutral-600">
                  Conectada {formatDateTime(account.createdAt)}
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-4 border-t border-neutral-800 pt-4">
            <p className="mb-2 text-sm text-neutral-400">
              Conectar un número nuevo con Embedded Signup:
            </p>
            <ConnectWhatsApp onConnected={load} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}