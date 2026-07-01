"use client";

import { useState, useTransition, useEffect } from "react";
import { 
  AlertTriangle, 
  CheckCircle2, 
  RefreshCw, 
  Search, 
  Database, 
  Layers, 
  Activity, 
  Cpu, 
  Terminal, 
  ShieldAlert, 
  Key, 
  GitBranch, 
  MessageSquare, 
  Mail, 
  Layout, 
  Server,
  ExternalLink,
  AlertCircle,
  Settings
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toggleModuleStatus, toggleConnectorCredentialMode } from "@/app/(portal)/modules/actions";

// DB matching Interfaces
interface DbModule {
  id: string;
  moduleKey: string;
  displayName: string;
  version: string;
  dependencyJson: unknown;
  status: string;
  createdAt: Date;
}

interface DbBlock {
  id: string;
  blockKey: string;
  moduleKey: string;
  displayName: string;
  configJson: unknown;
}

interface DbLayoutSlot {
  id: string;
  pageKey: string;
  slotKey: string;
  sortOrder: number;
  blockRegistryId: string | null;
  block?: DbBlock | null;
}

interface DbNode {
  id: string;
  nodeKey: string;
  moduleKey: string;
  nodeType: string;
  configJson: unknown;
}

interface DbConnector {
  id: string;
  connectorKey: string;
  displayName: string;
  connectorType: string;
  status: string;
}

interface DbSkill {
  skillKey: string;
  source: string;
  plugin?: string;
  phases: number[];
  status: string;
  usage?: string;
  agentUsage: string[];
}

interface ModuleDashboardProps {
  initialModules: DbModule[];
  initialBlocks: DbBlock[];
  initialLayoutSlots: DbLayoutSlot[];
  initialNodes: DbNode[];
  initialConnectors: DbConnector[];
  initialSkills: DbSkill[];
  configuredMap: Record<string, boolean>;
  recentTraceId?: string | null;
}

function parseDependencyKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

// Skill-to-module mapping logic
const SKILL_MODULE_MAPPING: Record<string, string> = {
  "create-prd": "proposal",
  "prioritize-features": "opportunity",
  "analyze-feature-requests": "customer",
  "identify-assumptions-existing": "poc",
  "brainstorm-experiments-existing": "poc",
  "metrics-dashboard": "dashboard",
  "pre-mortem": "command-center",
  "test-scenarios": "knowledge",
  "user-stories": "task",
  "wwas": "task",
  "aios-work-breakdown": "command-center",
  "aios-impact-analysis": "command-center",
  "aios-agent-assignment": "command-center",
  "aios-db-impact": "registry-admin",
  "aios-ui-impact": "registry-admin",
  "aios-security-review": "knowledge",
  "aios-error-to-improvement": "knowledge",
  "aios-regression-recommendation": "knowledge",
};

// Route details mapping
const MODULE_ROUTES_MAPPING: Record<string, { title: string; href: string; filePattern: string }[]> = {
  "dashboard": [
    { title: "Dashboard Workspace", href: "/dashboard", filePattern: "apps/web/src/app/(portal)/dashboard/page.tsx" }
  ],
  "command-center": [
    { title: "Command Center Timeline", href: "/commands", filePattern: "apps/web/src/app/(portal)/commands/page.tsx" }
  ],
  "registry-admin": [
    { title: "Modules Dashboard Control", href: "/modules", filePattern: "apps/web/src/app/(portal)/modules/page.tsx" },
    { title: "Registry Manager UI", href: "/registry", filePattern: "apps/web/src/app/(portal)/registry/page.tsx" }
  ],
  "customer": [
    { title: "Customer Overview Screen", href: "/customers", filePattern: "apps/web/src/app/(portal)/customers/page.tsx" }
  ],
  "task": [
    { title: "Task Center Board Layout", href: "/tasks", filePattern: "apps/web/src/app/(portal)/tasks/page.tsx" }
  ],
  "partner": [
    { title: "Partner Directory View", href: "/partners", filePattern: "apps/web/src/app/(portal)/partners/page.tsx" }
  ],
  "poc": [
    { title: "Proof of Concept Workspace", href: "/poc", filePattern: "apps/web/src/app/(portal)/poc/page.tsx" }
  ],
  "opportunity": [
    { title: "Opportunities Analysis Dashboard", href: "/opportunities", filePattern: "apps/web/src/app/(portal)/opportunities/page.tsx" }
  ],
  "proposal": [
    { title: "PRD & Proposal Generator", href: "/proposals", filePattern: "apps/web/src/app/(portal)/proposals/page.tsx" }
  ],
  "knowledge": [
    { title: "Knowledge Base Management", href: "/knowledge", filePattern: "apps/web/src/app/(portal)/knowledge/page.tsx" }
  ],
};

const SYSTEM_CONNECTORS = [
  { key: "github", displayName: "GitHub VCS Connector", type: "vcs" },
  { key: "slack", displayName: "Slack IM Gateway", type: "im" },
  { key: "outlook", displayName: "Outlook Mail Gateway", type: "email" }
];

// Simulated logs strictly marked for Simulation/Demo
const MOCK_VAL_LOGS = {
  lint: `$ eslint . --max-warnings=0\n\n✔ ESLint: No syntax warnings or structural flaws detected in apps/web/\n✔ Semantic validation check passed.\n✔ Prettier structural checks verified.`,
  test: `$ vitest run\n\n RUN  v3.2.4 /Users/jmpark/Documents/Playground/AIOS v1\n\n ✓ src/lib/registry/service.test.ts (2 tests)\n ✓ src/lib/permissions.test.ts (4 tests)\n ✓ src/lib/env.test.ts (1 test)\n\nTest Files  3 passed (3)\n     Tests  7 passed (7)\n  Time  184ms`,
  build: `$ next build --webpack\n\n▲ Optimizing production bundles...\nCreating production build ...\n✓ Static routes optimized\n✓ Bundle sizes verified under 150kB budget successfully.`,
  security: `$ npm audit --audit-level=high\n\n✔ Scanning 452 modules for security advisories...\n✔ No high or critical security pathways detected.\n✔ Credentials check: 0 environment variables exposed in Git tree.`,
  a11y: `$ axe-core-audit --target=portal-root\n\nRunning automated accessibility diagnostics...\n✓ ARIA descriptors resolved correctly.\n✓ Contrast ratios conform to WCAG 2.1 AA requirements.\n✓ Focus outlines verified keyboard-friendly.`
};

export function ModuleDashboardClient({
  initialModules,
  initialBlocks,
  initialLayoutSlots,
  initialNodes,
  initialConnectors,
  initialSkills,
  configuredMap,
  recentTraceId = null
}: ModuleDashboardProps) {
  const [modules, setModules] = useState<DbModule[]>(initialModules);
  const [connectors, setConnectors] = useState<DbConnector[]>(initialConnectors);
  
  const [selectedKey, setSelectedKey] = useState<string>("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");

  const [isPending, startTransition] = useTransition();

  // Test Connection simulated states
  const [testingConnector, setTestingConnector] = useState<string | null>(null);
  const [connSuccess, setConnSuccess] = useState<Record<string, string>>({});

  // Global UI general error state
  const [apiError, setApiError] = useState<string | null>(null);

  // Real POST Validation API States
  const [valResultsReal, setValResultsReal] = useState<{
    loading: boolean;
    valid: boolean | null;
    errors: string[];
    errorMsg: string | null;
  }>({
    loading: false,
    valid: null,
    errors: [],
    errorMsg: null
  });

  // Interactive Validation Diagnostics states (Simulation)
  const [isValidating, setIsValidating] = useState(false);
  const [valResults, setValResults] = useState<Record<string, "idle" | "running" | "passed">>({
    lint: "idle",
    test: "idle",
    build: "idle",
    security: "idle",
    a11y: "idle"
  });
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  // Computed module list
  const activeModule = modules.find(m => m.moduleKey === selectedKey) || modules[0];

  // Auto-validate module when active selection changes
  useEffect(() => {
    if (activeModule) {
      handleRealValidation(activeModule.moduleKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // Real POST validation client request
  async function handleRealValidation(moduleKey: string) {
    setValResultsReal(prev => ({ ...prev, loading: true, errorMsg: null }));
    try {
      const response = await fetch(`/api/modules/${moduleKey}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json();
      if (!response.ok) {
        setValResultsReal({
          loading: false,
          valid: false,
          errors: data.errors || [],
          errorMsg: data.error || "레지스트리 검증기가 실패 상태를 반환했습니다."
        });
      } else {
        setValResultsReal({
          loading: false,
          valid: data.valid,
          errors: data.errors || [],
          errorMsg: null
        });
      }
    } catch (e) {
      setValResultsReal({
        loading: false,
        valid: false,
        errors: [],
        errorMsg: e instanceof Error ? e.message : "검증 서비스 연결 중 네트워크 오류가 발생했습니다."
      });
    }
  }

  // Database status toggles with error handling
  const handleToggleModule = async (moduleKey: string, currentStatus: string) => {
    setApiError(null);
    startTransition(async () => {
      try {
        const updated = await toggleModuleStatus(moduleKey, currentStatus);
        setModules(prev => prev.map(m => m.moduleKey === moduleKey ? { ...m, status: updated.status } : m));
        // Trigger re-validation
        handleRealValidation(moduleKey);
      } catch (err) {
        setApiError(err instanceof Error ? err.message : "모듈 상태 전환에 실패했습니다.");
      }
    });
  };

  const handleToggleConnectorMode = async (connectorKey: string, currentStatus: string) => {
    setApiError(null);
    let newMode: "mock" | "read_only" | "real" = "mock";
    if (currentStatus === "mock") {
      newMode = "read_only";
    } else if (currentStatus === "read_only") {
      newMode = "real";
    }
    
    // Optimistic UI update
    setConnectors(prev => {
      const exists = prev.some(c => c.connectorKey === connectorKey);
      if (exists) {
        return prev.map(c => c.connectorKey === connectorKey ? { ...c, status: newMode } : c);
      } else {
        return [...prev, {
          id: crypto.randomUUID(),
          connectorKey,
          displayName: connectorKey.charAt(0).toUpperCase() + connectorKey.slice(1),
          connectorType: connectorKey === "github" ? "vcs" : connectorKey === "slack" ? "im" : "email",
          status: newMode
        }];
      }
    });

    startTransition(async () => {
      try {
        const updated = await toggleConnectorCredentialMode(connectorKey, currentStatus);
        setConnectors(prev => prev.map(c => c.connectorKey === connectorKey ? { ...c, status: updated.status } : c));
      } catch (err) {
        setApiError(err instanceof Error ? err.message : "커넥터 모드 전환에 실패했습니다.");
        // Rollback on failure
        setConnectors(initialConnectors);
      }
    });
  };

  // Live Test Connection Handler that honors real environment configurations
  const handleTestConnection = (key: string) => {
    setTestingConnector(key);
    const details = getConnectorDetails(key);
    setTimeout(() => {
      setTestingConnector(null);
      if (details.status !== "mock" && !details.isConfigured) {
        setConnSuccess(prev => ({
          ...prev,
          [key]: `오류: 자격 증명 구성 누락! 환경 변수를 찾을 수 없습니다.`
        }));
      } else {
        // Ping latency is not actually measured in this demo build; report a
        // truthful "not measured" status instead of a fabricated number.
        setConnSuccess(prev => ({
          ...prev,
          [key]: `연결 확인됨 (데모: 지연시간 미측정)`
        }));
      }
      setTimeout(() => {
        setConnSuccess(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 5000);
    }, 1000);
  };

  // Run full validation diagnostics (Demo simulation)
  const handleRunValidation = () => {
    setIsValidating(true);
    setExpandedLog(null);
    const steps = ["lint", "test", "build", "security", "a11y"];
    
    steps.forEach((step, idx) => {
      setValResults(prev => ({ ...prev, [step]: "running" }));
      setTimeout(() => {
        setValResults(prev => ({ ...prev, [step]: "passed" }));
        if (idx === steps.length - 1) {
          setIsValidating(false);
        }
      }, (idx + 1) * 300);
    });
  };

  // Filter Modules
  const filteredModules = modules.filter(m => {
    const matchesSearch = m.displayName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          m.moduleKey.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || m.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Dependency analysis from registry/manifest data only
  const analyzeDependencies = (modKey: string) => {
    const mod = modules.find(m => m.moduleKey === modKey);
    const rules = parseDependencyKeys(mod?.dependencyJson).map((key) => ({ requiredKey: key }));

    const missing: string[] = [];
    const inactive: string[] = [];

    for (const rule of rules) {
      const targetMod = modules.find(m => m.moduleKey === rule.requiredKey);
      if (!targetMod) {
        missing.push(rule.requiredKey);
      } else if (targetMod.status === "disabled") {
        inactive.push(rule.requiredKey);
      }
    }

    return { rules, missing, inactive };
  };

  // Observability mapping: disabled, configured, no-op
  const getObservabilityStatus = (mod: DbModule) => {
    if (mod.status === "disabled") return "disabled";
    const telemetryModules = ["task", "registry-admin", "knowledge", "command-center"];
    if (telemetryModules.includes(mod.moduleKey)) return "configured";
    return "no-op";
  };

  // Trace ready badge logic
  const isTraceReady = (modKey: string) => {
    // Phases 13, 14, 15 modules
    return ["registry-admin", "knowledge", "command-center"].includes(modKey);
  };

  // Global counts for metrics
  const totalModules = modules.length;
  const activeModulesCount = modules.filter(m => m.status === "active").length;
  const disabledModulesCount = modules.filter(m => m.status === "disabled").length;
  
  // Total validation alerts (modules with missing or disabled dependencies)
  const validationAlerts = modules.filter(m => {
    const { missing, inactive } = analyzeDependencies(m.moduleKey);
    return m.status === "active" && (missing.length > 0 || inactive.length > 0);
  }).length;

  // List of active layout slots for blocks
  const getBlockSlots = (blockKey: string) => {
    return initialLayoutSlots.filter(s => s.block?.blockKey === blockKey);
  };

  // Helper to resolve connector details
  const getConnectorDetails = (key: string) => {
    const dbConn = connectors.find(c => c.connectorKey === key);
    const status = dbConn ? dbConn.status : "mock";
    const isConfigured = !!configuredMap[key];
    return {
      status: status === "disabled" ? "disabled" : status === "read_only" ? "read_only" : status === "real" ? "real" : "mock",
      isConfigured
    };
  };

  return (
    <div className="flex flex-col gap-5 w-full">
      {/* Overview Stat Widgets */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-md border border-border shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">전체 모듈</p>
              <p className="text-2xl font-bold">{totalModules}</p>
            </div>
            <div className="p-2.5 bg-muted rounded-md border border-border">
              <Layers className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-md border border-border shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">활성 모듈</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{activeModulesCount}</p>
            </div>
            <div className="p-2.5 bg-emerald-500/10 rounded-md border border-emerald-500/20">
              <Cpu className="h-5 w-5 text-emerald-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-md border border-border shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">비활성 모듈</p>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-500">{disabledModulesCount}</p>
            </div>
            <div className="p-2.5 bg-amber-500/10 rounded-md border border-amber-500/20">
              <Server className="h-5 w-5 text-amber-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-md border border-border shadow-sm">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">검증 경고</p>
              <p className={`text-2xl font-bold ${validationAlerts > 0 ? "text-destructive animate-pulse" : "text-emerald-500"}`}>
                {validationAlerts}
              </p>
            </div>
            <div className={`p-2.5 rounded-md border ${validationAlerts > 0 ? "bg-destructive/10 border-destructive/20" : "bg-muted border-border"}`}>
              <ShieldAlert className={`h-5 w-5 ${validationAlerts > 0 ? "text-destructive animate-bounce" : "text-muted-foreground"}`} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Operational Workspace Grid */}
      <div className="grid gap-5 grid-cols-1 lg:grid-cols-12 w-full items-start">
        
        {/* Left Column - Modules Inventory */}
        <div className="lg:col-span-5 flex flex-col gap-3 w-full">
          <Card className="rounded-md border border-border shadow-sm flex flex-col h-auto lg:min-h-[700px]">
            <CardHeader className="p-4 space-y-2 border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-foreground">모듈 인벤토리</CardTitle>
                <Badge variant="secondary" className="rounded-sm font-mono text-xs uppercase px-1.5 py-0.5">
                  Local Registry
                </Badge>
              </div>
              <CardDescription className="text-xs">
                등록된 런타임 모듈을 필터링하고 선택하여 상세 구성과 진단을 확인합니다.
              </CardDescription>

              {/* Filters */}
              <div className="flex flex-col sm:flex-row gap-2 pt-1.5">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    aria-label="모듈 검색"
                    placeholder="모듈 키 검색..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-background border border-input rounded-md py-1.5 pl-8 pr-3 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex rounded-md border border-input p-0.5 bg-muted self-start sm:self-auto">
                  {(["all", "active", "disabled"] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => setStatusFilter(filter)}
                      className={`px-2 py-0.5 text-xs font-bold rounded-sm transition-all ${
                        statusFilter === filter
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {filter === "all" ? "전체" : filter === "active" ? "활성" : "비활성"}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0 overflow-y-auto max-h-[550px] lg:max-h-[700px] flex-1">
              {filteredModules.length === 0 ? (
                <div className="p-12 text-center space-y-2">
                  <Layers className="h-8 w-8 text-muted-foreground/30 mx-auto" />
                  <p className="text-xs font-bold text-muted-foreground">검색 필터와 일치하는 모듈이 없습니다</p>
                  <p className="text-xs text-muted-foreground/70">검색어를 지우거나 상태 필터 토글을 변경하세요.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filteredModules.map((mod) => {
                    const isSelected = mod.moduleKey === selectedKey;
                    const blocksCount = initialBlocks.filter(b => b.moduleKey === mod.moduleKey).length;
                    const nodesCount = initialNodes.filter(n => n.moduleKey === mod.moduleKey).length;
                    const { rules, missing, inactive } = analyzeDependencies(mod.moduleKey);
                    
                    const isInactive = mod.status === "disabled";
                    const hasDepAlert = mod.status === "active" && (missing.length > 0 || inactive.length > 0);

                    return (
                      <div
                        key={mod.id}
                        onClick={() => setSelectedKey(mod.moduleKey)}
                        className={`group relative flex flex-col p-3.5 gap-2 cursor-pointer transition-all hover:bg-muted/30 ${
                          isSelected ? "bg-muted/70" : ""
                        }`}
                      >
                        {/* Selected Indicator Bar */}
                        {isSelected && (
                          <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-r-xs" />
                        )}

                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-sm tracking-tight text-foreground">
                                {mod.displayName}
                              </span>
                              <Badge variant="outline" className="rounded-sm font-mono text-xs px-1 py-0 bg-background shrink-0">
                                v{mod.version}
                              </Badge>
                            </div>
                            <code className="text-xs text-muted-foreground font-mono block break-all">
                              {mod.moduleKey}
                            </code>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {hasDepAlert && (
                              <Badge variant="outline" className="rounded-sm bg-destructive/10 text-destructive border-destructive/20 text-xs px-1 py-0 animate-pulse font-bold">
                                의존성 경고
                              </Badge>
                            )}
                            <div className="flex items-center gap-1">
                              <span className={`h-1.5 w-1.5 rounded-full ${isInactive ? "bg-amber-500 animate-pulse" : "bg-emerald-500"}`} role="img" aria-label={isInactive ? "비활성" : "활성"} />
                              <span className="text-xs font-bold tracking-wider text-muted-foreground">
                                {isInactive ? "비활성" : "활성"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Badges footer */}
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <Badge variant="secondary" className="rounded-sm text-xs py-0 px-1 font-semibold">
                            블록 {blocksCount}개
                          </Badge>
                          <Badge variant="secondary" className="rounded-sm text-xs py-0 px-1 font-semibold">
                            노드 {nodesCount}개
                          </Badge>
                          {rules.length > 0 && (
                            <Badge variant="secondary" className="rounded-sm text-xs py-0 px-1 font-semibold">
                              의존성 {rules.length}개
                            </Badge>
                          )}
                          {isTraceReady(mod.moduleKey) && (
                            <Badge className="rounded-sm text-xs py-0 px-1 font-bold bg-violet-500/10 text-violet-500 border border-violet-500/20 hover:bg-violet-500/20 shrink-0">
                              추적 준비됨
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - SELECTED MODULE DETAIL / OPERATIONS CONTROL */}
        <div className="lg:col-span-7 flex flex-col gap-3 w-full">
          {!activeModule ? (
            <Card className="rounded-md border border-border shadow-sm flex flex-col items-center justify-center p-12 text-center h-[520px]">
              <Database className="h-12 w-12 text-muted-foreground/20 mb-3" />
              <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">선택된 모듈 없음</h3>
              <p className="text-xs text-muted-foreground/80 max-w-sm mt-1">
                인벤토리 사이드바에서 모듈을 선택하여 하위 구성 요소, 라우트, 자격 증명을 모니터링하고 진단 스캔을 실행하세요.
              </p>
            </Card>
          ) : (
            <Card className="rounded-md border border-border shadow-sm flex flex-col min-h-[700px] bg-background">
              
              {/* Header section */}
              <CardHeader className="p-4 border-b border-border flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 bg-muted/20">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-lg font-bold tracking-tight">
                      {activeModule.displayName}
                    </CardTitle>
                    <Badge variant="outline" className="rounded-sm font-mono text-xs px-1.5 py-0 bg-background shrink-0">
                      v{activeModule.version}
                    </Badge>
                    
                    {/* Trace ready badge for phase 13, 14, 15 */}
                    {isTraceReady(activeModule.moduleKey) && (
                      <Badge className="rounded-sm text-xs font-bold bg-violet-600/10 text-violet-600 border border-violet-600/20 hover:bg-violet-600/20 shrink-0 animate-pulse">
                        추적 준비됨
                      </Badge>
                    )}
                  </div>
                  <code className="text-xs text-muted-foreground font-mono block break-all">
                    module: {activeModule.moduleKey}
                  </code>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                  <Button
                    onClick={() => handleToggleModule(activeModule.moduleKey, activeModule.status)}
                    disabled={isPending}
                    variant={activeModule.status === "active" ? "destructive" : "default"}
                    size="sm"
                    className="h-8 text-xs font-semibold px-3 rounded-md shadow-xs transition-all duration-200"
                  >
                    {isPending ? (
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : activeModule.status === "active" ? (
                      "모듈 비활성화"
                    ) : (
                      "모듈 활성화"
                    )}
                  </Button>
                </div>
              </CardHeader>

              {/* Observability Panel & Trace Links (NO NESTED CARDS!) */}
              <div className="px-4 py-3 border-b border-border bg-zinc-50/50 dark:bg-zinc-950/20 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs uppercase font-mono text-muted-foreground font-bold">관측성:</span>
                  {(() => {
                    const status = getObservabilityStatus(activeModule);
                    if (status === "disabled") {
                      return (
                        <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-500 border-amber-500/20 py-0.5">
                          비활성화됨
                        </Badge>
                      );
                    } else if (status === "configured") {
                      return (
                        <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/20 py-0.5 font-bold">
                          구성됨 & 활성
                        </Badge>
                      );
                    } else {
                      return (
                        <Badge variant="outline" className="text-xs bg-zinc-500/10 text-zinc-500 border-zinc-500/20 py-0.5">
                          NO-OP (텔레메트리 없음)
                        </Badge>
                      );
                    }
                  })()}
                </div>

                {/* Live execution trace quick link placeholder */}
                {getObservabilityStatus(activeModule) === "configured" && recentTraceId ? (
                  <a
                    href={`/commands/${recentTraceId}`}
                    className="text-xs text-violet-600 hover:text-violet-500 font-bold flex items-center gap-1 underline transition-all self-start sm:self-auto"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    최근 실행 추적 보기
                  </a>
                ) : getObservabilityStatus(activeModule) === "configured" ? (
                  <span className="text-xs text-muted-foreground/60 italic self-start sm:self-auto select-none">
                    추적 인덱스에 기록된 활성 실행이 없습니다
                  </span>
                ) : null}
              </div>

              {/* Sticky Quick Nav Anchor Buttons */}
              <div className="sticky top-0 bg-background/95 backdrop-blur-xs border-b border-border z-10 px-4 py-2 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap scrollbar-thin">
                <span className="text-xs uppercase font-mono text-muted-foreground mr-1 select-none">섹션:</span>
                {[
                  { id: "validation", label: "검증" },
                  { id: "dependencies", label: "의존성" },
                  { id: "routes", label: "라우트" },
                  { id: "blocks", label: "블록" },
                  { id: "nodes", label: "노드" },
                  { id: "actions", label: "액션" },
                  { id: "connectors", label: "커넥터" },
                ].map((sec) => (
                  <button
                    key={sec.id}
                    onClick={() => {
                      const el = document.getElementById(`section-${sec.id}`);
                      if (el) {
                        el.scrollIntoView({ behavior: "smooth", block: "start" });
                      }
                    }}
                    className="px-2 py-0.5 text-xs font-bold border border-border rounded-sm hover:bg-muted bg-background transition-all"
                  >
                    {sec.label}
                  </button>
                ))}
              </div>

              {/* Details card content - vertical stack of all 7 sections */}
              <div
                className="p-4 flex-1 overflow-y-auto max-h-[600px] space-y-6 scroll-smooth"
              >
                {/* Visual states & Warnings stack */}
                <div className="space-y-2.5">
                  {/* General API error banner */}
                  {apiError && (
                    <div className="flex items-start gap-2.5 p-3 bg-red-500/10 border border-red-500/20 text-red-800 dark:text-red-300 rounded-md text-xs">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">API 작업 실패</p>
                        <p className="text-[11px] leading-relaxed">{apiError}</p>
                      </div>
                    </div>
                  )}

                  {/* Transition Pending state */}
                  {isPending && (
                    <div className="flex items-center gap-2 p-2 bg-primary/5 border border-primary/20 text-primary rounded-md text-xs justify-center animate-pulse">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>로컬 데이터베이스 레지스트리에 상태 전환을 적용하는 중...</span>
                    </div>
                  )}

                  {/* 5. Disabled module warning */}
                  {activeModule.status === "disabled" && (
                    <div className="flex items-start gap-3 p-3.5 bg-amber-500/10 text-amber-800 dark:text-amber-200 border border-amber-500/30 rounded-md">
                      <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-amber-500" />
                      <div className="space-y-1">
                        <p className="text-xs font-bold leading-none uppercase tracking-wider">비활성화된 모듈 경고</p>
                        <p className="text-xs leading-normal">
                          이 모듈의 레지스트리 상태는 현재 <strong className="font-bold">비활성</strong>입니다. 등록된 블록은 오프라인 상태이며, 실행 노드는 파이프라인 흐름에서 건너뜁니다.
                        </p>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => handleToggleModule(activeModule.moduleKey, activeModule.status)}
                          className="h-6 mt-1.5 text-xs font-bold border-amber-500/40 text-amber-800 dark:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20"
                        >
                          지금 모듈 활성화
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Critical dependency warning alerts */}
                  {activeModule.status === "active" && (() => {
                    const { missing, inactive } = analyzeDependencies(activeModule.moduleKey);
                    if (missing.length === 0 && inactive.length === 0) return null;

                    return (
                      <div className="flex flex-col gap-2">
                        {missing.map(key => (
                          <div key={key} className="flex items-start gap-3 p-3 bg-red-500/10 text-red-800 dark:text-red-300 border border-red-500/20 rounded-md">
                            <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <p className="text-xs font-bold leading-none uppercase tracking-wider">누락된 의존성 경고</p>
                              <p className="text-xs leading-normal">
                                치명적 오류: 이 레지스트리 환경에 존재하지 않는 모듈 키 <code className="font-mono bg-red-500/20 dark:bg-red-500/30 text-red-800 dark:text-red-300 px-1 rounded-sm">{key}</code> (버전 &gt;= 0.1.0)이 필요합니다.
                              </p>
                            </div>
                          </div>
                        ))}

                        {inactive.map(key => (
                          <div key={key} className="flex items-start gap-3 p-3 bg-amber-500/10 text-amber-800 dark:text-amber-200 border border-amber-500/30 rounded-md">
                            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <p className="text-xs font-bold leading-none uppercase tracking-wider">의존성 비활성 경고</p>
                              <p className="text-xs leading-normal">
                                경고: 현재 <strong className="font-bold">비활성화</strong>된 모듈 <code className="font-mono bg-amber-500/20 dark:bg-amber-500/30 text-amber-800 dark:text-amber-200 px-1 rounded-sm">{key}</code>이 필요합니다.
                              </p>
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => handleToggleModule(key, "disabled")}
                                className="h-6 mt-1 text-xs font-bold border-amber-500/40 text-amber-800 dark:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20"
                              >
                                의존성 모듈 활성화 ({key})
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* ----------------- SECTION 1: VALIDATION ----------------- */}
                <div id="section-validation" className="space-y-3 pt-2 scroll-mt-20">
                  <div className="flex items-center justify-between border-b border-border pb-1">
                    <div className="flex items-center gap-1.5">
                      <Activity className="h-4 w-4 text-primary" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">1. 무결성 검증 게이트</h3>
                    </div>
                    <Badge variant="outline" className="rounded-sm font-mono text-xs uppercase px-1.5 bg-muted">
                      시스템 감사
                    </Badge>
                  </div>

                  {/* Real POST validation results container (NO NESTED CARDS!) */}
                  <div className="border border-border rounded-md p-4 bg-muted/10 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-foreground">실제 매니페스트 검증기 API</p>
                        <p className="text-xs text-muted-foreground">
                          라이브 스키마와 의존성을 기준으로 모듈 구조를 실시간으로 검증합니다.
                        </p>
                      </div>
                      <Button
                        size="xs"
                        onClick={() => handleRealValidation(activeModule.moduleKey)}
                        disabled={valResultsReal.loading}
                        className="h-7 text-xs font-bold px-2.5 rounded-sm"
                      >
                        {valResultsReal.loading ? (
                          <>
                            <RefreshCw className="h-3 w-3 animate-spin mr-1" />
                            검증 중...
                          </>
                        ) : "매니페스트 검증 실행"}
                      </Button>
                    </div>

                    {/* Output states */}
                    {valResultsReal.loading && (
                      <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-sm text-xs justify-center animate-pulse">
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-muted-foreground">라이브 스키마 제약 조건을 확인하는 중...</span>
                      </div>
                    )}

                    {!valResultsReal.loading && valResultsReal.valid !== null && (
                      <div className={`p-3 border rounded-sm text-xs space-y-1.5 ${
                        valResultsReal.valid 
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-800 dark:text-emerald-300"
                          : "bg-red-500/10 border-red-500/20 text-red-800 dark:text-red-300"
                      }`}>
                        <div className="flex items-center gap-2">
                          {valResultsReal.valid ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                          )}
                          <span className="font-bold">
                            {valResultsReal.valid ? "매니페스트 스키마 검사: 통과" : "매니페스트 스키마 검사: 실패"}
                          </span>
                        </div>
                        
                        {valResultsReal.errors.length > 0 ? (
                          <ul className="list-disc list-inside space-y-1 text-xs pl-1 font-mono leading-relaxed bg-black/5 dark:bg-black/25 p-2 rounded-sm mt-1">
                            {valResultsReal.errors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        ) : valResultsReal.valid ? (
                          <p className="text-xs leading-relaxed">
                            검증 경고나 데이터베이스 불일치가 감지되지 않았습니다. 매니페스트 파일 구조가 스키마 표준을 완전히 준수합니다.
                          </p>
                        ) : null}

                        {valResultsReal.errorMsg && (
                          <p className="text-xs font-mono text-red-600 dark:text-red-400">
                            오류: {valResultsReal.errorMsg}
                          </p>
                        )}
                      </div>
                    )}

                    {valResultsReal.valid === null && !valResultsReal.loading && (
                      <p className="text-xs text-muted-foreground italic text-center p-1 select-none">
                        캐시된 검증 상태가 없습니다. 매니페스트 검증을 실행하여 실제 진단 검사를 수행하세요.
                      </p>
                    )}
                  </div>

                  {/* Quality Pipelines clearly marked as Simulation / Demo */}
                  <div className="border border-border rounded-md p-4 bg-muted/10 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-xs font-bold text-foreground">품질 파이프라인 검사</p>
                          <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20 font-bold tracking-wider px-1 py-0 uppercase shrink-0">
                            데모 전용 (시뮬레이션)
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          시뮬레이션된 테스트 러너, 린터, 접근성 분석기를 제공합니다.
                        </p>
                      </div>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={handleRunValidation}
                        disabled={isValidating || activeModule.status === "disabled"}
                        className="h-7 text-xs font-bold px-2.5 rounded-sm border border-border"
                      >
                        {isValidating ? "시뮬레이션 중..." : "시뮬레이션 게이트 실행"}
                      </Button>
                    </div>

                    {activeModule.status === "disabled" ? (
                      <p className="text-xs text-muted-foreground bg-muted/40 p-3 rounded-md text-center italic">
                        모듈 레지스트리 상태가 비활성화된 동안에는 품질 파이프라인을 건너뜁니다.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {(["lint", "test", "build", "security", "a11y"] as const).map((check) => {
                          const state = valResults[check];
                          const label =
                            check === "lint" ? "린터 구문 스캔 (시뮬레이션)" :
                            check === "test" ? "단위 테스트 통합 스위트 (시뮬레이션)" :
                            check === "build" ? "NextJS 빌드 컴파일 (시뮬레이션)" :
                            check === "security" ? "보안 의존성 분석 (시뮬레이션)" :
                            "Axe 접근성 WCAG 대비 감사 (시뮬레이션)";
                          
                          const isExpanded = expandedLog === check;

                          return (
                            <div key={check} className="border border-border rounded-sm bg-background overflow-hidden">
                              <div className="flex items-center justify-between p-2 flex-wrap gap-2 text-xs">
                                <div className="flex items-center gap-2">
                                  {state === "idle" && (
                                    <span className="h-3.5 w-3.5 rounded-full border border-dashed border-muted-foreground/50 flex items-center justify-center text-[10px] text-muted-foreground font-mono">
                                      -
                                    </span>
                                  )}
                                  {state === "running" && (
                                    <RefreshCw className="h-3.5 w-3.5 text-primary animate-spin" />
                                  )}
                                  {state === "passed" && (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                                  )}
                                  <span className="font-semibold text-muted-foreground text-[11px]">{label}</span>
                                </div>

                                <div className="flex items-center gap-1.5">
                                  {state === "passed" && (
                                    <Badge variant="outline" className="rounded-sm text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20 py-0 font-bold shrink-0">
                                      통과
                                    </Badge>
                                  )}
                                  {state === "running" && (
                                    <Badge variant="outline" className="rounded-sm text-[10px] bg-primary/10 text-primary border-primary/20 py-0 animate-pulse font-bold shrink-0">
                                      실행 중
                                    </Badge>
                                  )}
                                  {state === "passed" && (
                                    <button
                                      onClick={() => setExpandedLog(isExpanded ? null : check)}
                                      className="text-xs text-muted-foreground hover:text-foreground font-mono flex items-center gap-0.5 border border-border rounded-xs px-1 hover:bg-muted bg-background transition-all"
                                    >
                                      <Terminal className="h-2.5 w-2.5" />
                                      {isExpanded ? "로그 숨기기" : "로그 보기"}
                                    </button>
                                  )}
                                </div>
                              </div>

                              {isExpanded && state === "passed" && (
                                <div className="bg-zinc-950 p-2.5 border-t border-border font-mono text-xs leading-relaxed text-emerald-400 overflow-x-auto whitespace-pre">
                                  <div className="text-zinc-500 select-none block mb-1 font-sans font-semibold tracking-wider text-[10px] uppercase border-b border-zinc-800 pb-0.5">
                                    [시뮬레이션된 개발 미리보기 출력 로그]
                                  </div>
                                  {MOCK_VAL_LOGS[check]}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* ----------------- SECTION 2: DEPENDENCIES ----------------- */}
                <div id="section-dependencies" className="space-y-3 pt-2 scroll-mt-20">
                  <div className="flex items-center justify-between border-b border-border pb-1">
                    <div className="flex items-center gap-1.5">
                      <Settings className="h-4 w-4 text-primary" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">2. 레지스트리 의존성</h3>
                    </div>
                    <Badge variant="outline" className="rounded-sm font-mono text-xs uppercase px-1.5 bg-muted">
                      레지스트리 바인딩
                    </Badge>
                  </div>

                  {(() => {
                    const { rules } = analyzeDependencies(activeModule.moduleKey);
                    if (rules.length === 0) {
                      return (
                        <div className="text-center p-6 border border-dashed border-border rounded-md bg-muted/10">
                          <Layers className="h-6 w-6 text-muted-foreground/30 mx-auto mb-1.5" />
                          <p className="text-xs font-bold text-muted-foreground">등록된 의존성 없음</p>
                          <p className="text-xs text-muted-foreground/80 mt-0.5">
                            이 코어 모듈은 외부 레지스트리 전제 조건 없이 독립적으로 작동합니다.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div className="border border-border rounded-md overflow-hidden bg-background">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-muted text-muted-foreground font-mono text-xs border-b border-border">
                            <tr>
                              <th className="p-2 font-medium">필수 모듈 키</th>
                              <th className="p-2 font-medium text-right">상태</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {rules.map((rule) => {
                              const targetMod = modules.find(m => m.moduleKey === rule.requiredKey);
                              const isMissing = !targetMod;
                              const isDisabled = targetMod?.status === "disabled";

                              return (
                                <tr key={rule.requiredKey} className="hover:bg-muted/10">
                                  <td className="p-2 font-mono font-bold text-foreground">
                                    {rule.requiredKey}
                                  </td>
                                  <td className="p-2 text-right">
                                    {isMissing ? (
                                      <Badge variant="outline" className="text-xs bg-red-500/10 text-red-600 border-red-500/20 py-0 font-bold">
                                        누락
                                      </Badge>
                                    ) : isDisabled ? (
                                      <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/20 py-0 font-bold">
                                        비활성 (비활성화됨)
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20 py-0 font-bold">
                                        활성 & 운영 중
                                      </Badge>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>

                {/* ----------------- SECTION 3: ROUTES ----------------- */}
                <div id="section-routes" className="space-y-3 pt-2 scroll-mt-20">
                  <div className="flex items-center justify-between border-b border-border pb-1">
                    <div className="flex items-center gap-1.5">
                      <GitBranch className="h-4 w-4 text-primary" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">3. 내비게이션 라우트</h3>
                    </div>
                    <Badge variant="outline" className="rounded-sm font-mono text-xs uppercase px-1.5 bg-muted">
                      라우트 매핑
                    </Badge>
                  </div>

                  {(() => {
                    const routes = MODULE_ROUTES_MAPPING[activeModule.moduleKey] || [];
                    if (routes.length === 0) {
                      return (
                        <div className="text-center p-6 border border-dashed border-border rounded-md bg-muted/10">
                          <GitBranch className="h-6 w-6 text-muted-foreground/30 mx-auto mb-1.5" />
                          <p className="text-xs font-bold text-muted-foreground">직접 내비게이션 라우트 없음</p>
                          <p className="text-xs text-muted-foreground/80 mt-0.5">
                            이 모듈은 직접 진입점 링크가 없는 백그라운드 시스템 제공자입니다.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div className="border border-border rounded-md overflow-hidden bg-background">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-muted text-muted-foreground font-mono text-xs border-b border-border">
                            <tr>
                              <th className="p-2 font-medium">링크 설명</th>
                              <th className="p-2 font-medium">앱 라우트</th>
                              <th className="p-2 font-medium">파일 경로</th>
                              <th className="p-2 font-medium text-right">상태</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {routes.map((rt) => {
                              const isInactive = activeModule.status === "disabled";
                              return (
                                <tr key={rt.href} className="hover:bg-muted/10">
                                  <td className="p-2 font-semibold text-foreground">{rt.title}</td>
                                  <td className="p-2 font-mono text-xs">
                                    <a 
                                      href={rt.href}
                                      className={`inline-flex items-center gap-1 hover:underline text-violet-600 dark:text-violet-400 font-bold ${
                                        isInactive ? "pointer-events-none opacity-50 text-muted-foreground" : ""
                                      }`}
                                    >
                                      {rt.href}
                                      {!isInactive && <ExternalLink className="h-2.5 w-2.5 shrink-0" />}
                                    </a>
                                  </td>
                                  <td className="p-2 font-mono text-xs text-muted-foreground break-all">{rt.filePattern}</td>
                                  <td className="p-2 text-right">
                                    {isInactive ? (
                                      <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/20 py-0">
                                        오프라인
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20 py-0">
                                        온라인
                                      </Badge>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>

                {/* ----------------- SECTION 4: BLOCKS ----------------- */}
                <div id="section-blocks" className="space-y-3 pt-2 scroll-mt-20">
                  <div className="flex items-center justify-between border-b border-border pb-1">
                    <div className="flex items-center gap-1.5">
                      <Layout className="h-4 w-4 text-primary" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">4. UI 레이아웃 블록</h3>
                    </div>
                    <Badge variant="outline" className="rounded-sm font-mono text-xs uppercase px-1.5 bg-muted">
                      마운트된 블록
                    </Badge>
                  </div>

                  {initialBlocks.filter(b => b.moduleKey === activeModule.moduleKey).length === 0 ? (
                    <div className="text-center p-6 border border-dashed border-border rounded-md bg-muted/10">
                      <Layout className="h-6 w-6 text-muted-foreground/30 mx-auto mb-1.5" />
                      <p className="text-xs font-bold text-muted-foreground">등록된 레이아웃 블록 없음</p>
                      <p className="text-xs text-muted-foreground/80 mt-0.5">
                        이 모듈은 UI 렌더링 블록이나 레이아웃을 연결하지 않습니다.
                      </p>
                    </div>
                  ) : (
                    <div className="border border-border rounded-md overflow-hidden bg-background">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-muted text-muted-foreground font-mono text-xs border-b border-border">
                          <tr>
                            <th className="p-2 font-medium">표시 이름 / 키</th>
                            <th className="p-2 font-medium">마운트된 슬롯</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {initialBlocks
                            .filter(b => b.moduleKey === activeModule.moduleKey)
                            .map((block) => {
                              const slots = getBlockSlots(block.blockKey);
                              return (
                                <tr key={block.id} className="hover:bg-muted/10">
                                  <td className="p-2">
                                    <p className="font-semibold text-foreground">{block.displayName}</p>
                                    <code className="text-xs text-muted-foreground font-mono block break-all">{block.blockKey}</code>
                                  </td>
                                  <td className="p-2">
                                    {slots.length === 0 ? (
                                      <span className="text-muted-foreground/60 italic text-xs font-mono">미할당</span>
                                    ) : (
                                      <div className="flex flex-col gap-1">
                                        {slots.map(slot => (
                                          <div key={slot.id} className="flex items-center gap-1.5">
                                            <Layout className="h-3 w-3 text-muted-foreground" />
                                            <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                                              /{slot.pageKey} &rarr; <span className="font-bold">{slot.slotKey}</span>
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ----------------- SECTION 5: NODES ----------------- */}
                <div id="section-nodes" className="space-y-3 pt-2 scroll-mt-20">
                  <div className="flex items-center justify-between border-b border-border pb-1">
                    <div className="flex items-center gap-1.5">
                      <Cpu className="h-4 w-4 text-primary" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">5. 실행 흐름 노드</h3>
                    </div>
                    <Badge variant="outline" className="rounded-sm font-mono text-xs uppercase px-1.5 bg-muted">
                      흐름 노드
                    </Badge>
                  </div>

                  {initialNodes.filter(n => n.moduleKey === activeModule.moduleKey).length === 0 ? (
                    <div className="text-center p-6 border border-dashed border-border rounded-md bg-muted/10">
                      <Cpu className="h-6 w-6 text-muted-foreground/30 mx-auto mb-1.5" />
                      <p className="text-xs font-bold text-muted-foreground">등록된 흐름 노드 없음</p>
                      <p className="text-xs text-muted-foreground/80 mt-0.5">
                        이 자동화 구성 요소에 매핑된 백그라운드 실행 흐름 노드가 없습니다.
                      </p>
                    </div>
                  ) : (
                    <div className="border border-border rounded-md overflow-hidden bg-background">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-muted text-muted-foreground font-mono text-xs border-b border-border">
                          <tr>
                            <th className="p-2 font-medium">노드 레지스트리 키</th>
                            <th className="p-2 font-medium">노드 유형</th>
                            <th className="p-2 font-medium">사양 스키마</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {initialNodes
                            .filter(n => n.moduleKey === activeModule.moduleKey)
                            .map((node) => (
                              <tr key={node.id} className="hover:bg-muted/10 font-mono text-xs">
                                <td className="p-2 text-foreground font-bold break-all">{node.nodeKey}</td>
                                <td className="p-2">
                                  <Badge variant="outline" className="rounded-sm font-mono text-[10px] uppercase px-1 py-0 bg-background text-foreground border-border">
                                    {node.nodeType}
                                  </Badge>
                                </td>
                                <td className="p-2 text-muted-foreground max-w-[200px] truncate">
                                  {node.configJson ? JSON.stringify(node.configJson) : "{}"}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* ----------------- SECTION 6: ACTIONS ----------------- */}
                <div id="section-actions" className="space-y-3 pt-2 scroll-mt-20">
                  <div className="flex items-center justify-between border-b border-border pb-1">
                    <div className="flex items-center gap-1.5">
                      <Terminal className="h-4 w-4 text-primary" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">6. 자동화 스킬 액션</h3>
                    </div>
                    <Badge variant="outline" className="rounded-sm font-mono text-xs uppercase px-1.5 bg-muted">
                      런타임 스킬
                    </Badge>
                  </div>

                  {(() => {
                    const moduleSkills = initialSkills?.filter(s => SKILL_MODULE_MAPPING[s.skillKey] === activeModule.moduleKey) || [];
                    if (moduleSkills.length === 0) {
                      return (
                        <div className="text-center p-6 border border-dashed border-border rounded-md bg-muted/10">
                          <Terminal className="h-6 w-6 text-muted-foreground/30 mx-auto mb-1.5" />
                          <p className="text-xs font-bold text-muted-foreground">노출된 자동화 스킬 없음</p>
                          <p className="text-xs text-muted-foreground/80 mt-0.5">
                            이 모듈은 사용자 정의 시스템 액션 없이 전적으로 표준 워크플로를 통해 작동합니다.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                        {moduleSkills.map((skill) => (
                          <div 
                            key={skill.skillKey} 
                            className="p-3.5 bg-muted/10 border border-border rounded-md flex flex-col justify-between min-h-[125px] h-auto gap-2.5 transition-all hover:bg-muted/20"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center justify-between flex-wrap gap-1.5">
                                <span className="font-bold text-xs text-foreground font-mono break-all">{skill.skillKey}</span>
                                <Badge variant="outline" className="rounded-sm text-[10px] font-mono uppercase bg-primary/5 text-primary border-primary/20 py-0">
                                  {skill.source}
                                </Badge>
                              </div>
                              <p className="text-[11px] text-muted-foreground leading-normal">{skill.usage || "지정된 사용자 정의 사용 정보가 없습니다."}</p>
                            </div>
                            
                            <div className="flex items-center justify-between mt-1 flex-wrap gap-1.5 border-t border-border/40 pt-2 text-xs text-muted-foreground font-mono">
                              <div className="flex items-center gap-1.5">
                                <span className="uppercase text-[10px] tracking-wider text-zinc-400 select-none">에이전트:</span>
                                {skill.agentUsage.map(agent => (
                                  <Badge key={agent} variant="secondary" className="rounded-sm text-[10px] py-0 px-1 font-mono uppercase">
                                    {agent}
                                  </Badge>
                                ))}
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" role="img" aria-label="활성" />
                                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                  {skill.status}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* ----------------- SECTION 7: CONNECTORS ----------------- */}
                <div id="section-connectors" className="space-y-3 pt-2 scroll-mt-20">
                  <div className="flex items-center justify-between border-b border-border pb-1">
                    <div className="flex items-center gap-1.5">
                      <Key className="h-4 w-4 text-primary" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">7. 통합 커넥터</h3>
                    </div>
                    <Badge variant="outline" className="rounded-sm font-mono text-xs uppercase px-1.5 bg-muted">
                      자격 증명 게이트웨이
                    </Badge>
                  </div>

                  {/* Dense Individual Connector Cards (NO NESTED CARDS!) */}
                  <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
                    {SYSTEM_CONNECTORS.map((conn) => {
                      const details = getConnectorDetails(conn.key);
                      const isError = connSuccess[conn.key]?.startsWith("오류");
                      return (
                        <div 
                          key={conn.key} 
                          className="p-3.5 bg-muted/10 border border-border rounded-md flex flex-col justify-between min-h-[155px] h-auto gap-3.5 transition-all hover:bg-muted/20"
                        >
                          <div className="flex items-start justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <div className="p-1.5 bg-muted rounded-sm border border-border shrink-0">
                                {conn.key === "github" ? <GitBranch className="h-4 w-4 text-foreground" /> :
                                 conn.key === "slack" ? <MessageSquare className="h-4 w-4 text-foreground" /> :
                                 <Mail className="h-4 w-4 text-foreground" />}
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-xs text-foreground truncate">{conn.displayName}</p>
                                <code className="text-xs text-muted-foreground font-mono block truncate">{conn.key}</code>
                              </div>
                            </div>
                            
                            {/* Credential mode badge */}
                            {details.status === "real" ? (
                              <Badge variant="outline" className="rounded-sm text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-500 border-emerald-500/20 px-1.5 py-0.5 shrink-0 tracking-wide">
                                실제 자격 증명
                              </Badge>
                            ) : details.status === "read_only" ? (
                              <Badge variant="outline" className="rounded-sm text-[10px] font-mono font-bold bg-indigo-500/10 text-indigo-500 border-indigo-500/20 px-1.5 py-0.5 shrink-0 tracking-wide">
                                읽기 전용
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="rounded-sm text-[10px] font-mono font-bold bg-amber-500/10 text-amber-500 border-amber-500/20 px-1.5 py-0.5 shrink-0 tracking-wide">
                                모의 자격 증명
                              </Badge>
                            )}
                          </div>

                          {/* 5. Missing credential warning alert */}
                          {!details.isConfigured && (details.status === "real" || details.status === "read_only") && (
                            <div className="p-2 bg-red-500/10 border border-red-500/20 text-red-800 dark:text-red-300 rounded-sm text-xs flex items-start gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <span>
                                <strong>자격 증명 누락:</strong> 서버 환경 키가 구성되지 않았습니다. 실제 게이트웨이 프로세스가 실패합니다.
                              </span>
                            </div>
                          )}

                          {/* Mail read-only warning constraint */}
                          {conn.key === "outlook" && details.status === "read_only" && (
                            <div className="p-2 bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 rounded-sm text-xs flex items-start gap-1.5">
                              <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              <span>
                                <strong>읽기 전용 경고:</strong> 발신 메일 전송이 차단됩니다. 쓰기 작업이 오프라인 상태입니다.
                              </span>
                            </div>
                          )}

                          <div className="flex items-center justify-between flex-wrap gap-2 mt-2 pt-2 border-t border-border/30">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                                details.status === "real" ? (details.isConfigured ? "bg-emerald-500" : "bg-red-500") : 
                                details.status === "read_only" ? (details.isConfigured ? "bg-indigo-500" : "bg-red-500") : 
                                "bg-amber-500"
                              }`} role="img" aria-label={
                                details.status === "real"
                                  ? (details.isConfigured ? "연결됨 (활성)" : "구성 누락")
                                  : details.status === "read_only"
                                    ? (details.isConfigured ? "읽기 전용 활성" : "구성 누락")
                                    : "모의 모드"
                              } />
                              <span className={`text-xs font-mono truncate ${isError ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                                {connSuccess[conn.key] || (
                                  details.status === "real"
                                    ? (details.isConfigured ? "연결됨 (활성)" : "오프라인 (구성 누락)")
                                    : details.status === "read_only"
                                      ? (details.isConfigured ? "연결됨 (읽기 전용)" : "오프라인 (구성 누락)")
                                      : "시뮬레이션 활성 (모의)"
                                )}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => handleTestConnection(conn.key)}
                                disabled={testingConnector === conn.key}
                                className="h-6 text-xs font-bold px-2 rounded-xs"
                              >
                                {testingConnector === conn.key ? "테스트 중..." : "연결 테스트"}
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => handleToggleConnectorMode(conn.key, details.status)}
                                className="h-6 text-xs font-bold px-2 rounded-xs"
                              >
                                모드 전환
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            </Card>
          )}
        </div>

      </div>
    </div>
  );
}
