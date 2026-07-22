import { NextResponse } from "next/server";
import { enqueueMail } from "@/lib/jobs";
import { getPublicAppUrl } from "@/modules/platform-settings/mail-settings-runtime";
import { DomainError } from "@/modules/projects/errors";
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
      deliveryMode: input.deliveryMode,
    });
    if (!queued.jobId) {
      throw new DomainError(
        "MAIL_QUEUE_UNAVAILABLE",
        `测试邮件已写入发件箱，但任务队列暂时不可用；系统会自动补投。错误编号：mail_${queued.mailMessageId}`,
        503,
      );
    }
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
    return routeError(error, {
      request,
      operation: "mail.test.enqueue",
    });
  }
}
