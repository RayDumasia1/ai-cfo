import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));

import { escapeHtml, sendEmail } from "../lib/emailDelivery";
import { sendCfoCallConfirmation, sendFoundingMemberWelcomeEmail, sendFoundingMemberRestoreEmail,
  sendFoundingMemberCancelledEmail, sendPaymentFailedEmail } from "../lib/email";

const message = { from: "sender@example.invalid", to: "recipient@example.invalid", subject: "Test", html: "<p>Test</p>" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.invalid");
  send.mockResolvedValue({ data: { id: "email_test" }, error: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("email provider acceptance", () => {
  it("reports acceptance only when the provider returns an email ID", async () => {
    expect(await sendEmail(message, "test")).toBe(true);
    expect(send).toHaveBeenCalledExactlyOnceWith(message);
    expect(console.error).not.toHaveBeenCalled();
  });
  it.each(["provider error", "exception", "no ID"])("detects %s without leaking raw details or throwing", async reason => {
    if (reason === "provider error") send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "pretend-secret" } });
    if (reason === "exception") send.mockRejectedValue(new Error("pretend-secret"));
    if (reason === "no ID") send.mockResolvedValue({ data: {}, error: null });
    expect(await sendEmail(message, "test")).toBe(false);
    expect(console.error).toHaveBeenCalledWith("email:delivery:error", expect.objectContaining({ context: "test", reason: expect.any(String) }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("pretend-secret");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(message.to);
  });
});

describe("email HTML escaping", () => {
  it("escapes text and quoted attribute characters once", () => {
    expect(escapeHtml(`<b title="O'Reilly & co">`)).toBe("&lt;b title=&quot;O&#39;Reilly &amp; co&quot;&gt;");
    expect(escapeHtml(26)).toBe("26");
  });
  it("escapes a booking link without altering template markup", async () => {
    await sendCfoCallConfirmation(message.to, 'https://calendar.example.invalid/book?x=1&label="CFO"');
    const html = send.mock.calls[0][0].html;
    expect(html).toContain('href="https://calendar.example.invalid/book?x=1&amp;label=&quot;CFO&quot;"');
    expect(html).toContain("<a href=");
    expect(html).not.toContain("&amp;amp;");
  });
  it("escapes payment links exactly once", async () => {
    await sendPaymentFailedEmail(message.to, "https://app.example.invalid/a&b");
    expect(send.mock.calls[0][0].html).toContain("a&amp;b/dashboard/settings?tab=billing");
    expect(send.mock.calls[0][0].html).not.toContain("&amp;amp;");
  });
  it("preserves Founding identity and the current cancellation policy", async () => {
    await sendFoundingMemberWelcomeEmail(message.to, 26);
    await sendFoundingMemberRestoreEmail(message.to, 26);
    await sendFoundingMemberCancelledEmail(message.to, 26, "2026-10-31T12:00:00Z");
    for (const [payload] of send.mock.calls) expect(payload.html).toContain("Founding Member #26");
    expect(send.mock.calls[2][0].html).toContain("case by case");
    expect(send.mock.calls[2][0].html).toContain("your spot is never offered to someone else");
  });
  it.each([
    ["CFO confirmation", () => sendCfoCallConfirmation(message.to, "https://calendar.example.invalid")],
    ["Founding welcome", () => sendFoundingMemberWelcomeEmail(message.to, 26)],
    ["Founding restoration", () => sendFoundingMemberRestoreEmail(message.to, 26)],
    ["Founding cancellation", () => sendFoundingMemberCancelledEmail(message.to, 26, "2026-10-31")],
    ["payment failure", () => sendPaymentFailedEmail(message.to, "https://app.example.invalid")],
  ] as const)("keeps %s notification failure from failing its caller", async (_name, call) => {
    send.mockResolvedValue({ data: null, error: { name: "validation_error", message: "Rejected" } });
    await expect(call()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledOnce();
  });
});
