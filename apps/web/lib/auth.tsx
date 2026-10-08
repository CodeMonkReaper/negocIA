"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  MembershipDto,
  MembershipListItemDto,
  TenantSummaryDto,
  UserProfileDto,
} from "@negocia/contracts";
import { api, clearTokens, loadTokens, saveTokens } from "./api";
import { startRealtime, stopRealtime } from "./realtime";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: AuthStatus;
  user: UserProfileDto | null;
  tenant: TenantSummaryDto | null;
  membership: MembershipDto | null;
  memberships: MembershipListItemDto[];
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<UserProfileDto | null>(null);
  const [tenant, setTenant] = useState<TenantSummaryDto | null>(null);
  const [membership, setMembership] = useState<MembershipDto | null>(null);
  const [memberships, setMemberships] = useState<MembershipListItemDto[]>([]);

  const hydrateFromMe = useCallback(async () => {
    const me = await api.me();
    setUser(me.user);
    setTenant(me.currentTenant);
    setMembership(me.membership);
    setMemberships(me.memberships);
    setStatus("authenticated");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restore(): Promise<void> {
      if (!loadTokens()) {
        if (!cancelled) {
          setStatus("anonymous");
        }
        return;
      }
      try {
        await hydrateFromMe();
      } catch {
        // El access expiró y el refresh interno no bastó: sesión cerrada.
        clearTokens();
        if (!cancelled) {
          setStatus("anonymous");
          setUser(null);
          setTenant(null);
          setMembership(null);
          setMemberships([]);
        }
      }
    }

    void restore();

    return () => {
      cancelled = true;
    };
  }, [hydrateFromMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await api.login({ email, password });
      saveTokens({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      });
      await hydrateFromMe();
    },
    [hydrateFromMe],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const session = await api.register({ name, email, password });
      saveTokens({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      });
      await hydrateFromMe();
    },
    [hydrateFromMe],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // La familia ya no existe en el servidor: igual cerramos en el cliente.
    } finally {
      clearTokens();
      setStatus("anonymous");
      setUser(null);
      setTenant(null);
      setMembership(null);
      setMemberships([]);
    }
  }, []);

  // La única conexión SSE del tab vive mientras haya sesión autenticada; al
  // cerrar/expirar se aborta y el fallback de polling hace el resto.
  useEffect(() => {
    if (status === "authenticated") {
      startRealtime();
      return () => {
        stopRealtime();
      };
    }
    stopRealtime();
  }, [status]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      tenant,
      membership,
      memberships,
      login,
      register,
      logout,
    }),
    [status, user, tenant, membership, memberships, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }
  return context;
}