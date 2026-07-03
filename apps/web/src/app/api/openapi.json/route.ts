import { NextResponse } from 'next/server';
import { openApiDocument } from '@/trpc/openapi';

export async function GET() {
  return NextResponse.json(openApiDocument);
}
