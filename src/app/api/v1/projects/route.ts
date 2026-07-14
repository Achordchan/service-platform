import { NextResponse } from "next/server";
import {
  createProject,
  listProjects,
} from "@/modules/projects/project-service";
import { createProjectSchema } from "@/modules/projects/schemas";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const projects = await listProjects(auth.actor);
    return NextResponse.json({ data: projects });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const input = createProjectSchema.parse(await readJson(request));
    const project = await createProject(auth.actor, input);
    return NextResponse.json({ data: project }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
