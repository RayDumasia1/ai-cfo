"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const IDLE_MS =
  (Number(process.env.NEXT_PUBLIC_SESSION_IDLE_TIMEOUT_MINUTES) || 15) * 60_000;
const ABSOLUTE_MS =
  (Number(process.env.NEXT_PUBLIC_SESSION_ABSOLUTE_TIMEOUT_MINUTES) || 480) *
  60_000;
const WARNING_BEFORE_MS = 60_000; // warn 1 minute before idle logout
const SESSION_START_KEY = "_eid_session_start";

const ACTIVITY_EVENTS = [
  "mousemove",
  "keydown",
  "mousedown",
  "touchstart",
  "focus",
] as const;

export function useSessionTimeout() {
  const router = useRouter();
  const [showWarning, setShowWarning] = useState(false);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const warnTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const absTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const doLogout = useCallback(async () => {
    sessionStorage.removeItem(SESSION_START_KEY);
    clearTimeout(idleTimerRef.current);
    clearTimeout(warnTimerRef.current);
    clearTimeout(absTimerRef.current);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // best-effort
    }
    router.push("/auth?reason=session_expired");
  }, [router]);

  const resetIdle = useCallback(() => {
    setShowWarning(false);
    clearTimeout(idleTimerRef.current);
    clearTimeout(warnTimerRef.current);
    // Warning fires 1 minute before the idle timeout
    warnTimerRef.current = setTimeout(
      () => setShowWarning(true),
      IDLE_MS - WARNING_BEFORE_MS
    );
    idleTimerRef.current = setTimeout(doLogout, IDLE_MS);
  }, [doLogout]);

  const stayLoggedIn = useCallback(() => {
    resetIdle();
  }, [resetIdle]);

  useEffect(() => {
    // Track absolute session start in sessionStorage (survives page navigations,
    // cleared on logout)
    if (!sessionStorage.getItem(SESSION_START_KEY)) {
      sessionStorage.setItem(SESSION_START_KEY, String(Date.now()));
    }
    const startTime = Number(sessionStorage.getItem(SESSION_START_KEY));
    const elapsed = Date.now() - startTime;
    const remaining = ABSOLUTE_MS - elapsed;

    if (remaining <= 0) {
      doLogout();
      return;
    }

    absTimerRef.current = setTimeout(doLogout, remaining);
    resetIdle();

    const onActivity = () => resetIdle();
    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true })
    );

    return () => {
      clearTimeout(idleTimerRef.current);
      clearTimeout(warnTimerRef.current);
      clearTimeout(absTimerRef.current);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [doLogout, resetIdle]);

  return { showWarning, stayLoggedIn, logOutNow: doLogout };
}
