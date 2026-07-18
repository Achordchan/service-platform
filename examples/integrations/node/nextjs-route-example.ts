import { createLaunchTicket } from "./achord-connect";
import type { AchordConnectUser } from "./achord-connect";

declare function requireYourApplicationUser(): Promise<AchordConnectUser>;

export async function POST() {
  const currentUser = await requireYourApplicationUser();
  const ticket = await createLaunchTicket({
    baseUrl: process.env.ACHORD_BASE_URL!,
    clientId: process.env.ACHORD_CLIENT_ID!,
    clientSecret: process.env.ACHORD_CLIENT_SECRET!,
    user: currentUser,
    context: {
      locale: "zh-CN",
      theme: "system",
      returnOrigin: "https://app.example.com",
    },
  });
  return Response.json(ticket, { headers: { "Cache-Control": "no-store" } });
}
