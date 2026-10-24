/** Shared presentation metadata; it does not decide whether financial writes are allowed. */
export interface ImportNotice {
  code: string;
  category: "danger" | "warning" | "info";
  title: string;
  message: string;
}

export function isImportNotice(value: unknown): value is ImportNotice {
  if (!value || typeof value !== "object") return false;
  const notice = value as Record<string, unknown>;
  return ["danger", "warning", "info"].includes(notice.category as string) &&
    [notice.code, notice.title, notice.message].every(v => typeof v === "string" && v.length > 0);
}
