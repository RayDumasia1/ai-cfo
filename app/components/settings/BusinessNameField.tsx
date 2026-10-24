"use client";

import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { BUSINESS_NAME_MAX, BUSINESS_NAME_SAVE_ERROR, requestBusinessNameUpdate, validateBusinessName } from "@/lib/businessName";

export default function BusinessNameField({ initialName }: { initialName: string | null }) {
  const [confirmedName, setConfirmedName] = useState(initialName ?? "");
  const [draft, setDraft] = useState(initialName ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing && !pending) inputRef.current?.focus();
    else if (!editing && wasEditing.current) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing, pending]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || submitting.current) return;
    const parsed = validateBusinessName({ business_name: draft });
    if (!parsed.ok) { setError(parsed.error); return; }
    submitting.current = true;
    setPending(true);
    setError("");
    setSaved(false);
    try {
      const name = (await requestBusinessNameUpdate(draft)) ?? "";
      setConfirmedName(name);
      setDraft(name);
      setEditing(false);
      setSaved(true);
    } catch {
      setError(BUSINESS_NAME_SAVE_ERROR);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  function cancel() {
    if (submitting.current) return;
    setDraft(confirmedName);
    setEditing(false);
    setSaved(false);
    setError("");
  }

  return (
    <form onSubmit={save} aria-busy={pending}>
      <label htmlFor="business-name" style={{ fontSize: 11, fontWeight: 500, color: "var(--dim)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        Business Name
      </label>
      <div style={{ position: "relative", marginTop: 4 }}>
        <input
          ref={inputRef}
          id="business-name"
          name="business_name"
          type="text"
          autoComplete="organization"
          value={draft}
          onChange={event => { setDraft(event.target.value); setSaved(false); }}
          readOnly={!editing}
          disabled={pending}
          maxLength={BUSINESS_NAME_MAX}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "business-name-error" : undefined}
          placeholder="Your business name"
          className="focus-visible:ring-2 focus-visible:ring-teal"
          style={{ width: "100%", height: 40, border: `1.5px solid ${error ? "var(--danger)" : "var(--line)"}`, borderRadius: 10,
            padding: "0 40px 0 12px", fontSize: 14, color: draft ? "var(--navy)" : "var(--dim)",
            backgroundColor: editing ? "var(--surface)" : "var(--row-alt)", boxSizing: "border-box" }}
        />
        {!editing && <button ref={editRef} type="button" aria-label="Edit business name" onClick={() => { setEditing(true); setSaved(false); setError(""); }}
          style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", padding: 0,
            cursor: "pointer", display: "flex", color: "var(--dim)" }}>
          <Pencil size={14} />
        </button>}
      </div>
      {editing && <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        <button type="submit" disabled={pending} style={{ backgroundColor: pending ? "var(--dim)" : "var(--teal)", color: "var(--surface)",
          border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, fontWeight: 500, cursor: pending ? "wait" : "pointer" }}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={pending} onClick={cancel} style={{ background: "none", border: "none", fontSize: 13, color: "var(--dim)", cursor: pending ? "wait" : "pointer", padding: 0 }}>
          Cancel
        </button>
      </div>}
      {error && <p id="business-name-error" role="alert" style={{ fontSize: 13, color: "var(--danger)", marginTop: 4, marginBottom: 0 }}>{error}</p>}
      {saved && <span role="status" style={{ fontSize: 13, color: "var(--color-success-text)", display: "block", marginTop: 4 }}>Saved ✓</span>}
    </form>
  );
}
