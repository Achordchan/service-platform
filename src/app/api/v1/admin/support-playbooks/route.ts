import { NextResponse } from "next/server";
import { readJson, requireApiActor, routeError } from "@/modules/projects/api-utils";
import { createSupportPlaybookSchema } from "@/modules/requests/support-playbook-schemas";
import {
  createSupportPlaybook,
  listSupportPlaybooksForAdmin,
} from "@/modules/requests/support-playbook-service";

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({
      data: await listSupportPlaybooksForAdmin(auth.actor),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    const input = createSupportPlaybookSchema.parse(await readJson(request));
    const playbooks = await createSupportPlaybook(auth.actor, input);
    return NextResponse.json({ data: playbooks }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
