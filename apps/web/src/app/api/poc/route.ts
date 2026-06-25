import { createPocProject, listPocProjects } from "@sangfor/business";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const projects = await listPocProjects();
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "list_failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const project = await createPocProject(body);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "create_failed" },
      { status: 400 },
    );
  }
}
