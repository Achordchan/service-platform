import { NextResponse } from "next/server";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";
import { listAvailableSupportPlaybooks } from "@/modules/requests/support-playbook-service";

export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const playbooks = await listAvailableSupportPlaybooks(auth.actor);
    return NextResponse.json({ data: playbooks });
  } catch (error) {
    return routeError(error);
  }
}
