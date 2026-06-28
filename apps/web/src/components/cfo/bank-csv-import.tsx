"use client";

import { useState } from "react";
import * as XLSX from "xlsx";

type Row = {
  date: string;
  counterparty: string;
  amount: number;
  cashChange: number;
  memo: string;
};

// ── CSV parsing (RFC4180, BOM-aware) ──────────────────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((v) => v.trim() !== "")) rows.push(row); }
  return rows;
}

const num = (v: string) => {
  if (!v) return 0;
  const neg = /[-(]/.test(v);
  const d = v.replace(/[^0-9]/g, "");
  if (!d) return 0;
  return neg ? -parseInt(d, 10) : parseInt(d, 10);
};

const toIsoDate = (v: string): string => {
  if (!v) return "";
  const m = v.match(/(\d{4})[.\-/]?\s*(\d{1,2})[.\-/]?\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return "";
};

const find = (headers: string[], re: RegExp) => headers.findIndex((h) => re.test(h));

// Bank exports often have a title row (and a 합계 summary row); locate the real
// header row by scanning for one that carries a date column + an amount column.
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = rows[i].map((c) => (c ?? "").trim());
    if (find(h, /거래일|일자|날짜|거래일시/) >= 0 && find(h, /입금|출금|거래금액|^금액$/) >= 0) return i;
  }
  return 0;
}

function detect(all: string[][]): { rows: Row[]; mapping: string } {
  const hi = findHeaderRow(all);
  const rows = all.slice(hi);
  if (rows.length < 2) return { rows: [], mapping: "헤더/데이터 없음" };
  const headers = rows[0].map((h) => h.trim());
  const iDate = find(headers, /거래일|일자|날짜|거래일시|승인일시?/);
  const iIn = find(headers, /입금|맡기신/);
  const iOut = find(headers, /출금|찾으신|결제금액/);
  const iAmt = find(headers, /거래금액|^금액$|거래액/);
  const iDir = find(headers, /입출|^구분$|입출금/);
  const iMemo = find(headers, /적요|내용|거래내용|비고|메모|기재|기록사항/);
  const iCp = find(headers, /거래처|의뢰인|수취인|보내는|받는|상대|예금주|이체메모/);

  const out: Row[] = [];
  for (const r of rows.slice(1)) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    let cashChange = 0;
    if (iIn >= 0 || iOut >= 0) {
      const credit = num(cell(iIn));
      const debit = num(cell(iOut));
      cashChange = credit > 0 ? credit : -Math.abs(debit);
    } else if (iAmt >= 0) {
      const a = Math.abs(num(cell(iAmt)));
      const dir = cell(iDir);
      cashChange = /입금|입|\+/.test(dir) ? a : /출금|출|-/.test(dir) ? -a : num(cell(iAmt));
    }
    if (cashChange === 0) continue;
    const date = toIsoDate(cell(iDate));
    if (!date) continue; // skip title/summary(합계) rows without a real date
    const memo = cell(iMemo);
    out.push({
      date,
      counterparty: cell(iCp) || memo,
      amount: Math.abs(cashChange),
      cashChange,
      memo,
    });
  }
  const cols = [
    iDate >= 0 && `일자=${headers[iDate]}`,
    iIn >= 0 && `입금=${headers[iIn]}`,
    iOut >= 0 && `출금=${headers[iOut]}`,
    iAmt >= 0 && `금액=${headers[iAmt]}`,
    iMemo >= 0 && `적요=${headers[iMemo]}`,
    iCp >= 0 && `거래처=${headers[iCp]}`,
  ].filter(Boolean).join(" · ");
  return { rows: out, mapping: cols || "컬럼 자동 인식 실패 — 헤더를 확인하세요" };
}

const krw = (n: number) => `₩${n.toLocaleString("ko-KR")}`;

export function BankCsvImport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [mapping, setMapping] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setResult(null);
    setFileName(file.name);
    let matrix: string[][];
    if (/\.xlsx?$/i.test(file.name)) {
      const wb = XLSX.read(await file.arrayBuffer());
      const ws = wb.Sheets[wb.SheetNames[0]];
      matrix = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
    } else {
      matrix = parseCsv(await file.text());
    }
    const parsed = detect(matrix);
    setRows(parsed.rows);
    setMapping(parsed.mapping);
  };

  const onImport = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/finance/cashflows/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "가져오기 실패");
      setResult(`✅ ${data.created}건 추가 · ${data.skipped}건 중복 건너뜀`);
      setRows([]);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setResult(`❌ ${e instanceof Error ? e.message : "오류"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700">통장 거래내역 가져오기 (CSV · Excel)</h2>
          <p className="text-xs text-zinc-400">은행에서 받은 거래내역 파일(.xlsx/.csv)을 올리면 자금흐름으로 자동 입력됩니다 (제목·합계행 자동 제외, 중복 자동 제외).</p>
        </div>
        <label className="cursor-pointer rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          파일 선택
          <input
            type="file"
            accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
      </div>

      {fileName && (
        <p className="mt-2 text-xs text-zinc-500">
          {fileName} · 인식 <span className="font-medium">{rows.length}</span>건 · <span className="text-zinc-400">{mapping}</span>
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="mt-3 max-h-64 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50 text-left text-xs text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">일자</th>
                  <th className="px-3 py-2 font-medium">거래처</th>
                  <th className="px-3 py-2 text-right font-medium">현금변동</th>
                  <th className="px-3 py-2 font-medium">적요</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5 tabular-nums">{r.date || "-"}</td>
                    <td className="px-3 py-1.5">{r.counterparty || "-"}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${r.cashChange < 0 ? "text-red-600" : "text-green-600"}`}>{krw(r.cashChange)}</td>
                    <td className="px-3 py-1.5 text-zinc-500">{r.memo || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 50 && <p className="mt-1 text-xs text-zinc-400">미리보기 50건 / 전체 {rows.length}건</p>}
          <button
            onClick={onImport}
            disabled={busy}
            className="mt-3 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "가져오는 중…" : `${rows.length}건 자금흐름에 가져오기`}
          </button>
        </>
      )}

      {result && <p className="mt-3 text-sm">{result}</p>}
    </div>
  );
}
