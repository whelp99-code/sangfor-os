"use client";

export default function CfoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        padding: 16,
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: 8,
        color: "#991b1b",
      }}
    >
      <p style={{ fontWeight: 600 }}>페이지를 표시할 수 없습니다</p>
      <p style={{ marginTop: 8, fontSize: 14 }}>{error.message}</p>
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: 12,
          padding: "8px 12px",
          background: "#18181b",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        다시 시도
      </button>
    </div>
  );
}
