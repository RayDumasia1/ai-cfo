import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ImportUploader from "../app/components/ImportUploader";
import { createImportUploadRequest } from "../lib/financialImportUpload";
import type { FinancialImportMode } from "../lib/financialImportPolicy";

const file = new File(["synthetic"], "months.xlsx");
const success = (mode: FinancialImportMode = "update_months") => ({ success: true, mode, replaced: true,
  monthsImported: 1, monthsTotal: 3, dateRange: { from: "2026-01-01", to: "2026-03-01" },
  currentCash: 1234, warnings: [] });
afterEach(() => vi.restoreAllMocks());

describe("mode-aware financial upload", () => {
  it("defaults the rendered uploader to preserving other months", () => {
    const markup = renderToStaticMarkup(createElement(ImportUploader, { hasData: true }));
    expect(markup).toContain('<option value="update_months" selected="">');
    expect(markup).toContain("Keep other months.");
    expect(markup).toContain('value="replace_all"');
    expect(markup).toContain("Upload behavior");
    expect(markup).toContain("aria-describedby=");
  });

  it.each(["update_months", "replace_all"] as const)("sends an explicit %s choice and validates its result", async mode => {
    const payload = { ...success(mode), monthsTotal: mode === "replace_all" ? 1 : 3 };
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    const client = createImportUploadRequest(send);
    expect(await client.upload(file, mode)).toEqual(payload);
    expect(send).toHaveBeenCalledOnce();
    const [url, options] = send.mock.calls[0];
    expect(url).toBe("/api/import/modes");
    const form = options?.body as FormData;
    expect(form.get("mode")).toBe(mode);
    expect((form.get("file") as File).name).toBe("months.xlsx");
    expect(form.has("user_id")).toBe(false);
  });

  it("blocks overlapping submissions synchronously, including a different mode", async () => {
    let resolve!: (response: Response) => void;
    const send = vi.fn<typeof fetch>().mockReturnValue(new Promise(r => { resolve = r; }));
    const client = createImportUploadRequest(send);
    const first = client.upload(file, "update_months");
    expect(client.isPending()).toBe(true);
    expect(await client.upload(file, "replace_all")).toBeNull();
    expect(send).toHaveBeenCalledOnce();
    resolve(Response.json(success()));
    await first;
    expect(client.isPending()).toBe(false);
  });

  it("keeps pending state scoped to each uploader", async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(success()));
    const first = createImportUploadRequest(send);
    const second = createImportUploadRequest(send);
    await Promise.all([first.upload(file, "update_months"), second.upload(file, "update_months")]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("releases the submission guard after failure and permits a deliberate retry", async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Private transport detail"))
      .mockResolvedValueOnce(Response.json(success()));
    const client = createImportUploadRequest(send);
    await expect(client.upload(file, "update_months")).rejects.toThrow("Refresh the dashboard before retrying");
    expect(client.isPending()).toBe(false);
    expect(await client.upload(file, "update_months")).toMatchObject({ success: true });
  });

  it.each([{}, [], { success: true }, { ...success(), mode: "replace_all" },
    { ...success(), monthsTotal: 0 }, { ...success(), warnings: [123] },
    { ...success(), currentCash: "1234" }, { ...success(), dateRange: null }])("rejects malformed/legacy success responses: %j", async payload => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    await expect(createImportUploadRequest(send).upload(file, "update_months")).rejects.toThrow("could not be confirmed");
  });

  it.each([200, 500])("handles an HTML response with status %s without raw response text", async status => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>Private provider details</html>", { status }));
    await expect(createImportUploadRequest(send).upload(file, "update_months")).rejects.toThrow("could not be confirmed");
  });

  it("displays actionable workbook validation errors", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ errors: ["Duplicate month: 2026-01-01."] }, { status: 400 }));
    await expect(createImportUploadRequest(send).upload(file, "update_months")).rejects.toThrow("Duplicate month: 2026-01-01.");
  });

  it("does not display provider errors on server failures", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "Private database details" }, { status: 500 }));
    await expect(createImportUploadRequest(send).upload(file, "update_months")).rejects.toThrow("could not be confirmed");
  });

  it("does not retry through the legacy full-replacement endpoint on an older deployment", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("Not found", { status: 404 }));
    await expect(createImportUploadRequest(send).upload(file, "update_months")).rejects.toThrow("could not be confirmed");
    expect(send).toHaveBeenCalledExactlyOnceWith("/api/import/modes", expect.anything());
  });
});
