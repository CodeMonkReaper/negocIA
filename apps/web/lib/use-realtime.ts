"use client";

import { useEffect } from "react";
import { subscribeRealtime, type RealtimeHandler } from "./realtime";

export function useRealtime(handler: RealtimeHandler): void {
  useEffect(() => subscribeRealtime(handler), [handler]);
}