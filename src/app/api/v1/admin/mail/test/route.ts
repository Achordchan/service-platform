import { NextResponse } from "next/server";
import { enqueueMail } from "@/lib/jobs";
import { getPublicAppUrl } from "@/modules/platform-settings/mail-settings-runtime";
import {
  sampleVariablesForTemplate,
} from "@/modules/platform-settings/mail-template-catalog";
import {
  readJson,
  requireApiActor,
  routeError,
} from "@/modules/projects/api-utils";
import { testMailSchema } from "@/modules/platform-settings/schemas";

export async function POST(request: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const input = testMailSchema.parse(await readJson(request));
    const to = input.to || auth.actor.email;
    const appUrl = await getPublicAppUrl();
    const templateKey = input.templateKey ?? "TEST_EMAIL";
    const queued = await enqueueMail({
      to,
      templateKey,
      variables: sampleVariablesForTemplate(templateKey),
      actionUrl: appUrl,
      deliveryMode:
        input.deliveryMode ??
        (input.templateKey ? undefined : "RESEND"),
    });
    return NextResponse.json(
      {
        data: {
          jobId: queued.jobId,
          mailMessageId: queued.mailMessageId,
          to,
          status: "QUEUED",
        },
      },
      { status: 202 },
    );
  } catch (error) {
    return routeError(error);
  }
}
