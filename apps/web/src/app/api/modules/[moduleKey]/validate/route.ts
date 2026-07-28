import {
  ModuleManifest,
  validateModuleRuntime,
  getModuleManifest,
  validateModuleManifest,
} from "@sangfor/business/module-runtime";
import { listActionDefinitions } from "@sangfor/business/action-connector-runtime";
import { resolveModuleDependencyStatus } from "@sangfor/business";
import { assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import { createApiResponse, createApiErrorResponse } from "../../../_lib/api-response";
import { API_ERRORS } from "../../../_lib/api-error";

type RouteContext = { params: Promise<{ moduleKey: string }> };

export async function POST(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/modules/[moduleKey]/validate/route.ts");
  if (capabilityDenied) return capabilityDenied;
  try {
    const { moduleKey } = await context.params;
    const body = await request.json().catch(() => ({}));
    const fromBody = body?.manifest as unknown;
    const moduleManifest = (fromBody ?? (await getModuleManifest(moduleKey))) as ModuleManifest | null;

    if (!moduleManifest) {
      return createApiResponse({ error: "module_not_found" }, 404);
    }

    const manifestValidation = validateModuleManifest(moduleManifest);
    if (!manifestValidation.valid || !manifestValidation.manifest) {
      return createApiResponse(
        {
          moduleKey,
          valid: false,
          errors: manifestValidation.errors,
          warnings: [],
          issues: [],
          routeSmokeTargets: [],
        },
        400,
      );
    }

    if (manifestValidation.manifest.moduleKey !== moduleKey) {
      return createApiResponse(
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
        400,
      );
    }

    const {
      dependencyStatusByKey: baseDependencyStatusByKey,
      connectorStatusByKey,
    } = await resolveModuleDependencyStatus();

    const dependencyStatusByKey = {
      ...baseDependencyStatusByKey,
      ...(body?.dependencyStatusByKey && typeof body.dependencyStatusByKey === "object"
        ? (body.dependencyStatusByKey as Record<string, string | undefined>)
        : {}),
    } as Record<string, string | undefined>;

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
    return createApiResponse(
      {
        moduleKey,
        valid: runtimeValidation.valid,
        errors: runtimeValidation.errors,
        warnings: runtimeValidation.warnings,
        issues: runtimeValidation.issues,
        routeSmokeTargets,
      },
      status,
    );
  } catch (error) {
    console.error("[api] validate_module_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return createApiErrorResponse(API_ERRORS.INTERNAL_ERROR());
  }
}
