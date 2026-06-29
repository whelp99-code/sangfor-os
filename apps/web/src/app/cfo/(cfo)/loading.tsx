import { CFO } from "@/lib/cfo-theme";

export default function CfoLoading() {
  return (
    <div
      className="rounded-xl p-4 text-sm"
      style={{ background: "#fff", border: `1px solid ${CFO.hairline}`, color: CFO.muted }}
    >
      CFO 데이터 불러오는 중…
    </div>
  );
}
