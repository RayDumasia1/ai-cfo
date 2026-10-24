import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { requestPasswordChange } from "../lib/passwordChange";
import ChangePasswordCard from "../app/components/settings/ChangePasswordCard";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("confirmed password-change requests", () => {
  it("sends only exact password strings and requires explicit confirmation", async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true }));
    expect(await requestPasswordChange(" old synthetic ", " new synthetic ")).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/auth/password", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: " old synthetic ", newPassword: " new synthetic " }),
    });
  });
  it.each([null, [], {}, { success: false }, { success: "true" }])("does not report success for an invalid HTTP 200 body %#", async body => {
    fetchMock.mockResolvedValue(Response.json(body));
    expect(await requestPasswordChange("old", "new")).toMatchObject({ success: false });
  });
  it.each(["network", "HTML", "empty"])("gives uncertain-outcome guidance for a %s response", async kind => {
    if (kind === "network") fetchMock.mockRejectedValue(new Error("private provider detail"));
    else fetchMock.mockResolvedValue(new Response(kind === "HTML" ? "<html>Login</html>" : null, { status: kind === "empty" ? 204 : 200 }));
    expect(await requestPasswordChange("old", "new")).toEqual({
      success: false,
      message: "Could not confirm the password change. Try signing in with your new password before retrying or use password reset.",
    });
  });
  it.each([
    [400, "CURRENT_PASSWORD_INCORRECT", "currentPassword"],
    [422, "PASSWORD_REJECTED", "newPassword"],
  ])("associates %s errors with the relevant password field", async (status, code, field) => {
    fetchMock.mockResolvedValue(Response.json({ code, error: "<script>private detail</script>" }, { status }));
    const result = await requestPasswordChange("old", "new");
    expect(result).toMatchObject({ success: false, field });
    expect(JSON.stringify(result)).not.toContain("private detail");
  });
  it.each([
    [429, "PASSWORD_RATE_LIMITED", "Too many attempts"],
    [503, "PASSWORD_CHANGE_UNAVAILABLE", "temporarily unavailable"],
    [401, "", "Sign in"], [403, "", "verified account"],
  ])("shows safe form-level guidance for HTTP %s", async (status, code, message) => {
    fetchMock.mockResolvedValue(Response.json({ code, error: "private detail" }, { status }));
    const result = await requestPasswordChange("old", "new");
    expect(result).toMatchObject({ success: false, message: expect.stringContaining(message) });
    expect(result).not.toHaveProperty("field");
    expect(JSON.stringify(result)).not.toContain("private detail");
  });
  it.each([400, 500, 503])("does not trust success:true or arbitrary error text on HTTP %s", async status => {
    fetchMock.mockResolvedValue(Response.json({ success: true, error: "private detail" }, { status }));
    const result = await requestPasswordChange("old", "new");
    expect(result).toMatchObject({ success: false });
    expect(JSON.stringify(result)).not.toContain("private detail");
  });
});

describe("password form rendered accessibility", () => {
  it("renders a submit form, linked labels, autocomplete hints and help, with masked inputs", () => {
    const markup = renderToStaticMarkup(createElement(ChangePasswordCard));
    expect(markup).toContain('<form aria-busy="false"');
    expect(markup).toContain("<legend");
    for (const id of ["current-password", "new-password", "confirm-new-password"]) {
      expect(markup).toContain(`for="${id}"`);
      expect(markup).toContain(`id="${id}"`);
    }
    expect(markup.match(/type="password"/g)).toHaveLength(3);
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).toContain('autoComplete="new-password"');
    expect(markup).toContain('aria-describedby="new-password-help"');
    expect(markup).toContain('id="new-password-help"');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain('aria-label="Show password"');
    expect(markup).not.toContain("Password updated successfully");
  });
});
