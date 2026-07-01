"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CustomerSearchForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    router.push(`/customers?${params.toString()}`);
  }

  function clearSearch() {
    setQ("");
    router.push("/customers");
  }

  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onSubmit}>
      <Input
        aria-label="이름 또는 도메인으로 검색"
        placeholder="이름·도메인으로 검색…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Button type="submit">검색</Button>
      {searchParams.get("q") ? (
        <Button type="button" variant="outline" onClick={clearSearch}>
          지우기
        </Button>
      ) : null}
    </form>
  );
}
