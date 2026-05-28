import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 1000;

export function useSession() {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state");
      if (!res.ok) throw new Error(`state ${res.status}`);
      const next = await res.json();
      if (mounted.current) setState(next);
    } catch (err) {
      if (mounted.current) setError(err);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const id = window.setInterval(() => { void refresh(); }, POLL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
    };
  }, [refresh]);

  const sendFallback = useCallback(async (text) => {
    const res = await fetch("/api/fallback-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || "Failed to send fallback turn.");
    }
    await refresh();
  }, [refresh]);

  const reset = useCallback(async () => {
    const res = await fetch("/api/reset", { method: "POST" });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || "Reset failed.");
    }
    await refresh();
  }, [refresh]);

  const pauseVoice = useCallback(async () => {
    const res = await fetch("/api/pause", { method: "POST" });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || "Pause failed.");
    }
    await refresh();
  }, [refresh]);

  const resumeVoice = useCallback(async () => {
    const res = await fetch("/api/resume", { method: "POST" });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || "Resume failed.");
    }
    await refresh();
  }, [refresh]);

  const endSession = useCallback(async () => {
    const res = await fetch("/api/end", { method: "POST" });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || "End session failed.");
    }
    await refresh();
  }, [refresh]);

  return { state, error, refresh, sendFallback, reset, pauseVoice, resumeVoice, endSession };
}

// Returns a value that updates every `intervalMs` so time-derived UI re-renders.
export function useTick(intervalMs = 1000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return tick;
}
