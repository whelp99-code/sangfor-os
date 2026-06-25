import {
  ModuleManifest,
  validateModuleRuntime,
  getModuleManifest,
  validateModuleManifest,
} from "@ai-portal/automation/module-runtime";
import { listActionDefinitions } from "@ai-portal/automation/action-connector-runtime";
import { prisma } from "@ai-portal/db";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ moduleKey: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { moduleKey } = await context.params;
    const body = await request.json().catch(() => ({}));
    const fromBody = body?.manifest as unknown;
    const moduleManifest = (fromBody ?? (await getModuleManifest(moduleKey))) as ModuleManifest | null;

    if (!moduleManifest) {
      return NextResponse.json({ error: "module_not_found" }, { status: 404 });
    }

    const manifestValidation = validateModuleManifest(moduleManifest);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      return NextResponse.json(
        {
          moduleKey,
          valid: false,
          errors: manifestValidation.errors,
          warnings: [],
          issues: [],
          routeSmokeTargets: [],
        },
        { status: 400 },
      );
    }

    if (manifestValidation.manifest.moduleKey !== moduleKey) {
      return NextResponse.json(
        {
          moduleKey,
          valid: false,
          errors: [
            `moduleKey mismatch: route param=${moduleKey} body.manifest.moduleKey=${manifestValidation.manifest.moduleKey}`,
          ],
          warnings: [],
          issues: [],
          routeSmokeTargets: [],
        },
        { status: 400 },
      );
    }

    const [modules, connectors] = await Promise.all([
      prisma.moduleRegistry.findMany({
        select: { moduleKey: true, status: true },
      }),
      prisma.connectorRegistry.findMany({
        select: { connectorKey: true, status: true },
      }),
    ]);

    const dependencyStatusByKey = {
      ...Object.fromEntries(
      modules.map((module) => [module.moduleKey, module.status]),
      ),
      ...(body?.dependencyStatusByKey && typeof body.dependencyStatusByKey === "object"
        ? (body.dependencyStatusByKey as Record<string, string | undefined>)
        : {}),
    } as Record<string, string | undefined>;

    const connectorStatusByKey = Object.fromEntries(
      connectors.map((connector) => [connector.connectorKey, connector.status]),
    ) as Record<string, string | null>;

    const actionKeysFromBody = Array.isArray(body?.actionKeys)
      ? body.actionKeys.filter((entry: unknown): entry is string => typeof entry === "string")
      : null;
    const actionKeys = actionKeysFromBody
      ?? listActionDefinitions({ moduleKey }).map((action) => action.actionKey);

    const routeSmokeTargets = Array.isArray(body?.routeSmokeTargets)
      ? body.routeSmokeTargets.filter((entry: unknown): entry is string => typeof entry === "string")
      : [`/api/modules/${moduleKey}`];

    const runtimeValidation = validateModuleRuntime(manifestValidation.manifest, {
      dependencyStatusByKey,
      actionKeys,
      routeSmokeTargets,
      connectorStatusByKey: {
        ...connectorStatusByKey,
        ...(body?.connectorStatusByKey && typeof body.connectorStatusByKey === "object"
          ? (body.connectorStatusByKey as Record<string, string | null>)
          : {}),
      },
    });

    const status = runtimeValidation.valid ? 200 : 400;
    return NextResponse.json(
      {
        moduleKey,
        valid: runtimeValidation.valid,
        errors: runtimeValidation.errors,
        warnings: runtimeValidation.warnings,
        issues: runtimeValidation.issues,
        routeSmokeTargets,
      },
      { status },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "validate_module_failed" },
      { status: 500 },
    );
  }
}
