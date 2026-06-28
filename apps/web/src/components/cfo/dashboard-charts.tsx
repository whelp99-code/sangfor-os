"use client";

import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TrendPoint = { year: number; month: number; revenue: number; expense: number };
type ForecastPoint = { date: string; balance: number };

const krwCompact = (n: number) => {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 100_000_000) return `${sign}${(a / 100_000_000).toFixed(1)}억`;
  if (a >= 10_000) return `${sign}${Math.round(a / 10_000)}만`;
  return `${sign}${a}`;
};
const krwFull = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

export function MonthlyPnlChart({ data }: { data: TrendPoint[] }) {
  const rows = data.map((d) => ({
    label: `${String(d.year).slice(2)}-${String(d.month).padStart(2, "0")}`,
    매출: d.revenue,
    비용: d.expense,
    순이익: d.revenue - d.expense,
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#71717a" }} tickLine={false} />
        <YAxis tickFormatter={krwCompact} tick={{ fontSize: 11, fill: "#a1a1aa" }} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(value) => krwFull(Number(value))} labelStyle={{ color: "#18181b" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="매출" fill="#1B7A5A" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="비용" fill="#B4413A" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Line dataKey="순이익" stroke="#C8A24B" strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function CashflowForecastChart({ data }: { data: ForecastPoint[] }) {
  const rows = data.map((d) => ({ label: d.date.slice(5), 잔액: d.balance }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="bal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#1B7A5A" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#1B7A5A" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} minTickGap={24} />
        <YAxis tickFormatter={krwCompact} tick={{ fontSize: 11, fill: "#a1a1aa" }} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={(value) => krwFull(Number(value))} labelStyle={{ color: "#18181b" }} />
        <Area dataKey="잔액" stroke="#1B7A5A" strokeWidth={2} fill="url(#bal)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
