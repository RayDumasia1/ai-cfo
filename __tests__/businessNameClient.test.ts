import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BUSINESS_NAME_SAVE_ERROR, requestBusinessNameUpdate, validateBusinessName } from "../lib/businessName";
import BusinessNameField from "../app/components/settings/BusinessNameField";

const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("confirmed business-name requests", () => {
  it("sends only the name and returns the server-confirmed normalized value", async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true, business_name: "Acme" }));
    expect(await requestBusinessNameUpdate(" Acme ")).toBe("Acme");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/account", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ business_name: " Acme " }),
    });
  });
  it("confirms clearing a name only when null is explicitly returned", async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true, business_name: null }));
    expect(await requestBusinessNameUpdate(" ")).toBeNull();
  });
  it.each([null, [], {}, { success: true }, { success: false, business_name: "Acme" },
    { success: "true", business_name: "Acme" }, { success: true, business_name: "Stale name" },
    { success: true, business_name: null }, { success: true, business_name: {} }])("does not confirm HTTP 200 with invalid data %#", async body => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(requestBusinessNameUpdate("Acme")).rejects.toThrow(BUSINESS_NAME_SAVE_ERROR);
  });
  it.each([400, 401, 402, 403, 500])("does not confirm an HTTP %s response or display its raw error", async status => {
    fetchMock.mockResolvedValue(Response.json({ error: "private detail", success: true, business_name: "Acme" }, { status }));
    await expect(requestBusinessNameUpdate("Acme")).rejects.toThrow(BUSINESS_NAME_SAVE_ERROR);
  });
  it.each(["network", "HTML", "empty"])("keeps %s failures unconfirmed", async kind => {
    if (kind === "network") fetchMock.mockRejectedValue(new Error("private detail"));
    else fetchMock.mockResolvedValue(new Response(kind === "HTML" ? "<html>Login</html>" : null, { status: kind === "empty" ? 204 : 200 }));
    await expect(requestBusinessNameUpdate("Acme")).rejects.toThrow(BUSINESS_NAME_SAVE_ERROR);
  });
  it("rejects oversized input before sending a request", async () => {
    await expect(requestBusinessNameUpdate("x".repeat(201))).rejects.toThrow(BUSINESS_NAME_SAVE_ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("allows plain-text punctuation and HTML-like names without sanitizing their stored value", () => {
    expect(validateBusinessName({ business_name: " <Acme & Co> " })).toEqual({ ok: true, value: "<Acme & Co>" });
  });
});

describe("business-name form rendered accessibility", () => {
  it("renders a labelled, bounded form with an accessible edit control", () => {
    const markup = renderToStaticMarkup(createElement(BusinessNameField, { initialName: "Acme" }));
    expect(markup).toContain('<form aria-busy="false"');
    expect(markup).toContain('for="business-name"');
    expect(markup).toContain('id="business-name"');
    expect(markup).toContain('name="business_name"');
    expect(markup).toContain('autoComplete="organization"');
    expect(markup).toContain('maxLength="200"');
    expect(markup).toContain('readOnly=""');
    expect(markup).toContain('aria-label="Edit business name"');
    expect(markup).not.toContain("Saved ✓");
  });
  it("escapes names in rendered HTML", () => {
    const markup = renderToStaticMarkup(createElement(BusinessNameField, { initialName: '<script>alert("test")</script>' }));
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });
});
