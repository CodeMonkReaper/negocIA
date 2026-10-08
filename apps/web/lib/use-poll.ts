"use client";

import { useEffect, useRef } from "react";

export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void callbackRef.current();
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [intervalMs, enabled]);
}