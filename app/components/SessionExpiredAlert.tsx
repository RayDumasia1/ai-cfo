type Reason = "session_expired" | "logged_out" | null | undefined;

interface SessionExpiredAlertProps {
  reason: Reason;
}

export default function SessionExpiredAlert({ reason }: SessionExpiredAlertProps) {
  if (!reason) return null;

  const isExpired = reason === "session_expired";

  return (
    <div
      style={{
        marginBottom: 16,
        padding: "10px 14px",
        borderRadius: 8,
        fontSize: 13,
        backgroundColor: isExpired ? "#FFFBEB" : "#F0FDF4",
        border: `1px solid ${isExpired ? "#F59E0B" : "#86EFAC"}`,
        color: isExpired ? "#92400E" : "#166534",
      }}
    >
      {isExpired
        ? "Your session expired. Please log in again."
        : "Logged out successfully."}
    </div>
  );
}
