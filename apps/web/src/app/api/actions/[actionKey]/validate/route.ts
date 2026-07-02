// apps/web/src/app/api/actions/[actionKey]/validate/route.ts
import { validateActionWithDb } from '@sangfor/business';
import { NextResponse } from 'next/server';
import { apiError, assertApiAccess } from '@/lib/api-auth';

export async function POST(req: NextRequest, { params }: { params: { actionKey: string } }) {
  assertApiAccess(req);
  
  try {
    const result = await validateActionWithDb(params.actionKey);
    return NextResponse.json(result);
  } catch (err) {
    return apiError(err);
  }
}
