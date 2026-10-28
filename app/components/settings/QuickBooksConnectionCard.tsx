"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
type Connection = { status: string; companyName: string | null; environment: string; connectedAt: string | null };
type State = { connection: Connection; eligible: boolean; configured: boolean; syncAvailable: false };
const endpoint = "/api/integrations/quickbooks/connection";
const button = "rounded-[10px] border border-line px-4 py-2 text-sm font-medium disabled:opacity-50";
export default function QuickBooksConnectionCard({ outcome }: { outcome?: string }) {
  const [state, setState] = useState<State | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Connection status could not be loaded.");
      setState(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Connection status could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function act(action: "connect" | "refresh" | "disconnect") {
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Connection could not be updated.");
      if (action === "connect") {
        const target = new URL(data.authorizationUrl);
        if (target.origin !== "https://appcenter.intuit.com" || target.pathname !== "/connect/oauth2") throw new Error("Authorization could not be started.");
        window.location.assign(target.href);
      } else { await load(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Connection could not be updated."); await loadAfterFailure(); }
    finally { setBusy(false); }
  }
  async function loadAfterFailure() {
    // Keep the action error visible while refreshing metadata (a refresh failure may require reconnecting).
    try { const r = await fetch(endpoint, { cache: "no-store" }); if (r.ok) setState(await r.json()); } catch { /* retain the last known state */ }
  }
  const c = state?.connection, active = c?.status === "connected";
  const disconnected = !c || c.status === "disconnected";
  return <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm" aria-labelledby="quickbooks-heading">
    <h2 id="quickbooks-heading" className="text-lg font-medium text-navy">QuickBooks connection</h2>
    <p className="mt-2 text-sm text-dim">Connect a QuickBooks sandbox company to test authorization. Financial importing is still being built.</p>
    {outcome === "connected" && <p role="status" className="mt-4 text-sm">QuickBooks authorization completed.</p>}
    {outcome === "cancelled" && <p role="status" className="mt-4 text-sm">Authorization was cancelled.</p>}
    {outcome === "failed" && <p role="status" className="mt-4 text-sm">Authorization could not be completed. Check the connection status below, then disconnect before trying again.</p>}
    {loading && <p role="status" className="mt-4 text-sm">Loading connection status…</p>}
    {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
    {state && !loading && <div className="mt-4 space-y-4 text-sm">
      <p>{active ? `Connected to ${c?.companyName ?? "your sandbox company"}. Financial data is not ready to import.` : disconnected ? "No QuickBooks company connected." : c?.status === "revoke_pending" || c?.status === "revoking" ? "Local access has stopped. Intuit revocation is pending; retry disconnect to finish." : c?.status === "reconnect_required" ? "This connection needs attention. Disconnect, then authorize again." : "A connection operation is in progress. You can reload the status or disconnect before starting again."}</p>
      {!state.configured && <p className="text-dim">Sandbox connection setup is pending. You can continue using your spreadsheet data.</p>}
      {!state.eligible && <p className="text-dim">Connecting requires an active Core plan or above. You can still disconnect an existing company. <Link href="?tab=billing" className="text-teal underline">View billing</Link></p>}
      <p className="text-dim">Disconnecting keeps your saved financial records and cash plans.</p>
      <div className="flex flex-wrap gap-3">
        {disconnected && <button className={`${button} bg-teal text-surface`} disabled={busy || !state.configured || !state.eligible} onClick={() => void act("connect")}>Connect sandbox company</button>}
        {active && <button className={button} disabled={busy || !state.configured || !state.eligible} onClick={() => void act("refresh")}>Check connection</button>}
        {!disconnected && <button className={button} disabled={busy} onClick={() => void act("disconnect")}>Disconnect QuickBooks</button>}
        <button className={button} disabled={busy} onClick={() => void load()}>Reload status</button>
      </div>
      {busy && <p role="status">Updating connection…</p>}
    </div>}
    {!state && !loading && <button className={`${button} mt-4`} onClick={() => void load()}>Retry status</button>}
  </section>;
}
