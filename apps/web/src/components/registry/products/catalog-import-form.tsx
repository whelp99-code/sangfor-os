"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function CatalogImportForm({ onImportSuccess }: { onImportSuccess?: () => void }) {
  const [jsonText, setJsonText] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async (dryRun: boolean) => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const payload = JSON.parse(jsonText);
      const key = idempotencyKey.trim() || `import-ui-${Date.now()}`;
      const res = await fetch(`/api/catalog/imports?dryRun=${dryRun}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify({ payload }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Import failed");
      }

      setResult(data);
      if (!dryRun && onImportSuccess) {
        onImportSuccess();
      }
    } catch (err: any) {
      setError(err.message || "Invalid JSON or network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="rounded-md border border-border shadow-sm">
      <CardHeader className="p-4 border-b border-border">
        <CardTitle className="text-sm font-semibold">카탈로그 JSON 가져오기</CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div>
          <label className="text-xs font-medium block mb-1">Idempotency Key (선택)</label>
          <input
            type="text"
            value={idempotencyKey}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIdempotencyKey(e.target.value)}
            placeholder="미입력 시 자동 생성"
            className="w-full text-xs p-2 rounded border border-border bg-background"
          />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1">카탈로그 Payload (JSON)</label>
          <textarea
            rows={8}
            value={jsonText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setJsonText(e.target.value)}
            placeholder={`{\n  "familyKey": "fam-hci",\n  "vendorKey": "sangfor",\n  "vendor": "Sangfor",\n  "name": "Sangfor HCI",\n  "editions": [],\n  "metrics": []\n}`}
            className="w-full p-2 rounded border border-border bg-background font-mono text-xs"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || !jsonText.trim()}
            onClick={() => handleImport(true)}
          >
            Dry Run (검증만)
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={loading || !jsonText.trim()}
            onClick={() => handleImport(false)}
          >
            가져오기 실행 (Commit)
          </Button>
        </div>

        {error && (
          <div className="p-3 text-xs bg-destructive/10 text-destructive rounded border border-destructive/20 font-mono">
            {error}
          </div>
        )}

        {result && (
          <div className="p-3 text-xs bg-muted rounded border border-border font-mono space-y-1">
            <div className="font-semibold text-primary">
              {result.dryRun ? "[Dry Run 결과]" : "[가져오기 성공]"}
            </div>
            <pre className="overflow-x-auto text-[11px]">{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
