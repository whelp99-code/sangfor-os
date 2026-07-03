"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.push("/home");
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) setError("비밀번호가 올바르지 않습니다.");
      else if (res.status === 429) setError("시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.");
      else setError(body.error ?? "로그인에 실패했습니다.");
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>SANGFOR Partner OS</CardTitle>
          <CardDescription>업무 포털에 로그인하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Input
              type="email"
              placeholder="이메일 (선택)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <Input
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <Button type="submit" disabled={loading}>
              {loading ? "로그인 중..." : "로그인"}
            </Button>
            <p className="text-xs text-muted-foreground">
              계정 정보는 관리자에게 문의하세요.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
