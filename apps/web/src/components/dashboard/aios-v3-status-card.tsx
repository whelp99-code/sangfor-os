"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Cpu,
  Brain,
  Wifi,
  WifiOff,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ServiceStatus {
  name: string;
  url: string;
  status: "ok" | "error" | "unreachable";
  latencyMs: number;
  detail?: string;
}

interface V3StatusResponse {
  overall: "ok" | "degraded";
  services: ServiceStatus[];
  timestamp: string;
}

export function AiosV3StatusCard() {
  const [status, setStatus] = useState<V3StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch("/api/aios-v3-status");
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
          setLastCheck(new Date());
        }
      } catch {
        setStatus(null);
      } finally {
        setLoading(false);
      }
    }
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000); // 30초마다 갱신
    return () => clearInterval(interval);
  }, []);

  const overallOk = status?.overall === "ok";

  return (
    <Card
      className={`relative overflow-hidden transition-shadow hover:shadow-md ${
        overallOk
          ? "border-emerald-200 dark:border-emerald-900/50"
          : status
            ? "border-red-200 dark:border-red-900/50"
            : ""
      }`}
    >
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            overallOk
              ? "bg-emerald-100 dark:bg-emerald-900/50"
              : "bg-gray-100 dark:bg-gray-800"
          }`}
        >
          <Cpu
            className={`h-4 w-4 ${
              overallOk
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-gray-500"
            }`}
          />
        </div>
        <CardTitle className="text-base">F-aios-v3 연동</CardTitle>
        <div className="ml-auto">
          {loading ? (
            <div className="h-2 w-2 animate-pulse rounded-full bg-gray-400" />
          ) : overallOk ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" role="img" aria-label="Connected" />
              연결됨
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-900/50 dark:text-red-400">
              <XCircle className="h-3 w-3" role="img" aria-label="Disconnected" />
              연결 끊김
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5 text-sm">
        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-lg bg-muted/50"
              />
            ))}
          </div>
        ) : status ? (
          <>
            {status.services.map((svc) => (
              <ServiceRow key={svc.name} service={svc} />
            ))}
            {lastCheck && (
              <p className="pt-1 text-[11px] text-muted-foreground">
                마지막 확인: {lastCheck.toLocaleTimeString("ko-KR")}
              </p>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 py-2 text-muted-foreground">
            <WifiOff className="h-4 w-4" />
            <span>상태를 불러올 수 없습니다</span>
          </div>
        )}
      </CardContent>

      {/* 상태 표시 바 */}
      <div
        className={`absolute bottom-0 left-0 h-1 w-full ${
          overallOk
            ? "bg-gradient-to-r from-emerald-500 to-emerald-300"
            : "bg-gradient-to-r from-red-500 to-red-300"
        } opacity-60`}
      />
    </Card>
  );
}

function ServiceRow({ service }: { service: ServiceStatus }) {
  const isOk = service.status === "ok";
  const isUnreachable = service.status === "unreachable";

  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        {isOk ? (
          <Wifi className="h-3.5 w-3.5 text-emerald-500" role="img" aria-label={`${service.name} connection OK`} />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-red-500" role="img" aria-label={`${service.name} connection error`} />
        )}
        <div>
          <p className="font-medium">{service.name}</p>
          <p className="text-[11px] text-muted-foreground">{service.url}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`text-[11px] ${
            isOk ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {service.latencyMs}ms
        </span>
        {isOk ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" role="img" aria-label={`${service.name} healthy`} />
        ) : isUnreachable ? (
          <AlertTriangle className="h-3.5 w-3.5 text-red-500" role="img" aria-label={`${service.name} unreachable`} />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-500" role="img" aria-label={`${service.name} error`} />
        )}
      </div>
    </div>
  );
}
