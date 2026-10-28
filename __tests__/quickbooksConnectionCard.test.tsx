// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuickBooksConnectionCard from "../app/components/settings/QuickBooksConnectionCard";
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
const fetcher = vi.fn();
const state = (status = "disconnected", eligible = true, configured = true) => ({ connection: { status, companyName: status === "connected" ? "Sandbox" : null, environment: "sandbox", connectedAt: null }, eligible, configured, syncAvailable: false });
beforeEach(() => { fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("QuickBooks connection owner states", () => {
  it("explains pending setup without offering an enabled connect button", async () => {
    fetcher.mockResolvedValue(Response.json(state("disconnected", true, false))); render(<QuickBooksConnectionCard />);
    expect(await screen.findByText(/Sandbox connection setup is pending/)).toBeTruthy(); expect((screen.getByRole("button", { name: "Connect sandbox company" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("distinguishes authorized from financial-data readiness", async () => {
    fetcher.mockResolvedValue(Response.json(state("connected"))); render(<QuickBooksConnectionCard outcome="connected" />);
    expect(await screen.findByText(/Connected to Sandbox. Financial data is not ready/)).toBeTruthy(); expect(screen.getByRole("button", { name: "Check connection" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /sync|import/i })).toBeNull();
  });
  it("permits disconnect after downgrade and shows revocation recovery", async () => {
    fetcher.mockResolvedValue(Response.json(state("revoke_pending", false, true))); render(<QuickBooksConnectionCard />);
    expect(await screen.findByText(/Local access has stopped/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Disconnect QuickBooks" }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Disconnect QuickBooks" }));
    expect(fetcher).toHaveBeenCalledWith("/api/integrations/quickbooks/connection", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "disconnect" }) }));
  });
  it("shows a retryable status error", async () => {
    fetcher.mockRejectedValueOnce(new Error("Status unavailable")).mockImplementation(async () => Response.json(state())); render(<QuickBooksConnectionCard />);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Status unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Retry status" })); expect(await screen.findByText("No QuickBooks company connected.")).toBeTruthy();
  });
  it("retains action failures while reloading changed connection metadata", async () => {
    fetcher.mockResolvedValueOnce(Response.json(state("connected"))).mockResolvedValueOnce(Response.json({ error: "Reconnect required" }, { status: 502 })).mockResolvedValueOnce(Response.json(state("reconnect_required")));
    render(<QuickBooksConnectionCard />); await userEvent.click(await screen.findByRole("button", { name: "Check connection" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Reconnect required")); expect(await screen.findByText(/This connection needs attention/)).toBeTruthy();
  });
});
