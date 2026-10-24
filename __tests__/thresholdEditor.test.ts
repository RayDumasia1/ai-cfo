import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { percentageFromDecimal, percentageToDecimal } from "../lib/calculations";
import { createThresholdEditor, parseThresholdValues, requestThresholdSave, thresholdValuesFromProfile, THRESHOLD_SAVE_ERROR, type ThresholdPayload } from "../lib/thresholdSettings";
import ThresholdsCard from "../app/components/settings/ThresholdsCard";
import type { BusinessProfile } from "../lib/types";

const profile = { user_id: "own-user", runway_warning_threshold: 6, runway_danger_threshold: 3,
  min_cash_reserve: 1000, burn_rate_warning_pct: 0.105 } as BusinessProfile;
const initial = () => thresholdValuesFromProfile(profile);
const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

describe("threshold precision and rendered values", () => {
  it.each([0.105, 0.145, 0.286, 1.5, 0.000001, 1e-10])("preserves decimal percentage %s on round trip", fraction => {
    expect(percentageToDecimal(percentageFromDecimal(fraction))).toBe(fraction);
  });
  it("does not expose binary multiplication noise", () => {
    expect(percentageFromDecimal(0.145)).toBe(14.5);
    expect(percentageFromDecimal(0.286)).toBe(28.6);
    expect(percentageToDecimal(28.6)).toBe(0.286);
  });
  it("renders 10.5% without rounding to a whole percentage", () => {
    expect(renderToStaticMarkup(createElement(ThresholdsCard, { profile }))).toContain('value="10.5"');
  });
  it("renders blank reserve as unset and allows fractional form inputs", () => {
    const markup = renderToStaticMarkup(createElement(ThresholdsCard, { profile: { ...profile, min_cash_reserve: null } }));
    expect(markup).toContain('<form');
    expect(markup.match(/step="any"/g)).toHaveLength(4);
    expect(markup).toContain('aria-describedby="min-cash-reserve-help"');
    expect(markup).toContain("Leave blank");
  });
});

describe("confirmed threshold editor workflow", () => {
  it("does not change saved values or previous history while a save is pending", async () => {
    const pending = deferred();
    const persist = vi.fn(() => pending.promise);
    const editor = createThresholdEditor(initial(), persist);
    editor.change("runway_warning_threshold", "8");
    const operation = editor.save();
    expect(editor.getSnapshot()).toMatchObject({ status: "saving", saved: initial(), previous: {}, current: { ...initial(), runway_warning_threshold: "8" } });
    pending.resolve(); await operation;
    expect(editor.getSnapshot()).toMatchObject({ status: "success", saved: { ...initial(), runway_warning_threshold: "8" }, previous: { runway_warning_threshold: "6" } });
  });
  it("leaves drafts, saved values, and history unchanged after a failed restore", async () => {
    const persist = vi.fn<(values: ThresholdPayload) => Promise<void>>(async () => {});
    const editor = createThresholdEditor(initial(), persist);
    editor.change("runway_warning_threshold", "8"); await editor.save();
    const before = editor.getSnapshot();
    const pending = deferred(); persist.mockImplementationOnce(() => pending.promise);
    const operation = editor.restore("runway_warning_threshold");
    expect(editor.getSnapshot().saved).toEqual(before.saved);
    expect(editor.getSnapshot().previous).toEqual(before.previous);
    pending.reject(new Error("Synthetic network failure")); await operation;
    expect(editor.getSnapshot()).toMatchObject({ saved: before.saved, current: before.current, previous: before.previous,
      status: "error", serverError: THRESHOLD_SAVE_ERROR });
    await editor.restore("runway_warning_threshold");
    expect(editor.getSnapshot()).toMatchObject({ status: "success", saved: initial(), current: initial(), previous: {} });
  });
  it("restores only the selected saved field and preserves unrelated unsaved drafts", async () => {
    const persist = vi.fn<(values: ThresholdPayload) => Promise<void>>(async () => {});
    const editor = createThresholdEditor(initial(), persist);
    editor.change("runway_warning_threshold", "8"); await editor.save();
    editor.change("min_cash_reserve", "2500");
    await editor.restore("runway_warning_threshold");
    expect(persist.mock.calls.at(-1)?.[0]).toEqual({ runway_warning_threshold: 6, runway_danger_threshold: 3, min_cash_reserve: 1000, burn_rate_warning_pct: 10.5 });
    expect(editor.getSnapshot().current.min_cash_reserve).toBe("2500");
    expect(editor.getSnapshot().saved.min_cash_reserve).toBe("1000");
  });
  it("blocks overlapping Save/Restore/Reset/Edit operations synchronously", async () => {
    const persist = vi.fn<(values: ThresholdPayload) => Promise<void>>(async () => {});
    const editor = createThresholdEditor(initial(), persist);
    editor.change("runway_warning_threshold", "8"); await editor.save();
    const pending = deferred(); persist.mockImplementationOnce(() => pending.promise);
    const operation = editor.restore("runway_warning_threshold");
    await editor.save(); await editor.restore("runway_warning_threshold");
    editor.change("min_cash_reserve", "7777"); editor.reset("runway_warning_threshold");
    expect(persist).toHaveBeenCalledTimes(2);
    expect(editor.getSnapshot().current).toEqual({ ...initial(), runway_warning_threshold: "8" });
    pending.resolve(); await operation;
    expect(editor.getSnapshot().saved).toEqual(initial());
  });
  it("validates the restored saved combination before sending it", async () => {
    const persist = vi.fn<(values: ThresholdPayload) => Promise<void>>(async () => {});
    const editor = createThresholdEditor(initial(), persist);
    editor.change("runway_warning_threshold", "8"); editor.change("runway_danger_threshold", "7"); await editor.save();
    const before = editor.getSnapshot();
    await editor.restore("runway_warning_threshold");
    expect(persist).toHaveBeenCalledOnce();
    expect(editor.getSnapshot()).toMatchObject({ saved: before.saved, current: before.current, previous: before.previous,
      validationError: "Danger threshold must be less than warning threshold." });
  });
  it("preserves a fractional percentage and an unset reserve while saving another field", async () => {
    const persist = vi.fn<(values: ThresholdPayload) => Promise<void>>(async () => {});
    const editor = createThresholdEditor(thresholdValuesFromProfile({ ...profile, min_cash_reserve: null }), persist);
    editor.change("runway_warning_threshold", "8"); await editor.save();
    expect(persist).toHaveBeenCalledWith({ runway_warning_threshold: 8, runway_danger_threshold: 3, min_cash_reserve: null, burn_rate_warning_pct: 10.5 });
  });
  it("keeps restore history available when a later save fails", async () => {
    const persist = vi.fn<(values: ThresholdPayload) => Promise<void>>(async () => {});
    const editor = createThresholdEditor(initial(), persist);
    editor.change("runway_warning_threshold", "8"); await editor.save();
    const before = editor.getSnapshot();
    editor.change("min_cash_reserve", "2000"); persist.mockRejectedValueOnce(new Error("Failure"));
    await editor.save();
    expect(editor.getSnapshot()).toMatchObject({ saved: before.saved, previous: before.previous,
      current: { ...before.current, min_cash_reserve: "2000" }, status: "error" });
  });
  it("resets an unsaved field locally without writing", () => {
    const persist = vi.fn<(values: ThresholdPayload) => Promise<void>>(async () => {});
    const editor = createThresholdEditor(initial(), persist);
    editor.change("min_cash_reserve", "2000"); editor.reset("min_cash_reserve");
    expect(editor.getSnapshot().current).toEqual(initial());
    expect(persist).not.toHaveBeenCalled();
  });
  it("does not write when there are no changes", async () => {
    const persist = vi.fn<(values: ThresholdPayload) => Promise<void>>(async () => {});
    const editor = createThresholdEditor(initial(), persist);
    await editor.save();
    expect(persist).not.toHaveBeenCalled();
  });
});

describe("threshold input and response confirmation", () => {
  it.each(["Infinity", "-Infinity", "NaN", "1e400", "", "0", "-1"])("rejects invalid burn percentage %s before saving", value => {
    expect(parseThresholdValues({ ...initial(), burn_rate_warning_pct: value }).ok).toBe(false);
  });
  it("keeps blank and explicit zero reserves distinct", () => {
    expect(parseThresholdValues({ ...initial(), min_cash_reserve: "" })).toMatchObject({ ok: true, value: { min_cash_reserve: null } });
    expect(parseThresholdValues({ ...initial(), min_cash_reserve: "0" })).toMatchObject({ ok: true, value: { min_cash_reserve: 0 } });
    expect(parseThresholdValues({ ...initial(), burn_rate_warning_pct: String(Number.MIN_VALUE) }).ok).toBe(false);
  });
  it("requires explicit success and sends exact finite JSON numbers/null", async () => {
    fetchMock.mockResolvedValue(Response.json({ success: true }));
    const parsed = parseThresholdValues({ ...initial(), min_cash_reserve: "" });
    if (!parsed.ok) throw new Error("Fixture invalid");
    await requestThresholdSave(parsed.value);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.value) });
  });
  it.each([null, {}, [], { success: false }, { success: "true" }])("rejects malformed success data %#", async body => {
    fetchMock.mockResolvedValue(Response.json(body));
    const parsed = parseThresholdValues(initial()); if (!parsed.ok) throw new Error("Fixture invalid");
    await expect(requestThresholdSave(parsed.value)).rejects.toThrow(THRESHOLD_SAVE_ERROR);
  });
  it.each([400, 401, 402, 403, 500])("does not confirm HTTP %s or expose raw errors", async status => {
    fetchMock.mockResolvedValue(Response.json({ success: true, error: "private detail" }, { status }));
    const parsed = parseThresholdValues(initial()); if (!parsed.ok) throw new Error("Fixture invalid");
    await expect(requestThresholdSave(parsed.value)).rejects.toThrow(THRESHOLD_SAVE_ERROR);
  });
  it.each(["network", "HTML"])("keeps %s failures unconfirmed", async kind => {
    if (kind === "network") fetchMock.mockRejectedValue(new Error("private detail"));
    else fetchMock.mockResolvedValue(new Response("<html>Login</html>"));
    const parsed = parseThresholdValues(initial()); if (!parsed.ok) throw new Error("Fixture invalid");
    await expect(requestThresholdSave(parsed.value)).rejects.toThrow(THRESHOLD_SAVE_ERROR);
  });
});
