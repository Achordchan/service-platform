import { NextResponse } from "next/server";
import { createMailMessageInTx } from "@/lib/jobs";
import { processMailMessage } from "@/lib/mail";
import { withSystemDb } from "@/lib/system-db";
import { getPublicAppUrl } from "@/modules/platform-settings/mail-settings-runtime";
import {
  MailDeliveryError,
  mailFailureReferenceId,
} from "@/modules/platform-settings/mail-delivery-error";
import { assertAllowed, DomainError } from "@/modules/projects/errors";
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
    assertAllowed(auth.actor.isPlatformAdmin);
    const input = testMailSchema.parse(await readJson(request));
    const to = input.to || auth.actor.email;
    const appUrl = await getPublicAppUrl();
    const templateKey = input.templateKey ?? "TEST_EMAIL";
    const message = await withSystemDb((tx) =>
      createMailMessageInTx(tx, {
        to,
        templateKey,
        variables: sampleVariablesForTemplate(templateKey),
        actionUrl: appUrl,
        sendAfter: new Date(Date.now() + 60_000),
        deliveryMode: input.deliveryMode,
        sourceType: "ADMIN_TEST_EMAIL",
      }),
    );
    try {
      const delivery = await processMailMessage(message.id, {
        finalAttempt: true,
        expectedDeliveryMode: message.deliveryMode,
      });
      if ("skipped" in delivery) {
        throw new DomainError(
          "MAIL_TEST_DELIVERY_BUSY",
          "测试邮件正在由其他任务处理，请稍后查看发件箱状态",
          409,
          { mailMessageId: message.id },
        );
      }
    } catch (error) {
      if (error instanceof MailDeliveryError) {
        const referenceId = mailFailureReferenceId(message.id);
        throw new DomainError(
          "MAIL_TEST_DELIVERY_FAILED",
          `${error.message}。错误编号：${referenceId}`,
          422,
          { mailMessageId: message.id, referenceId },
        );
      }
      throw error;
    }
    if (message.deliveryMode === "LOCAL_OUTBOX") {
      throw new DomainError(
        "MAIL_TEST_LOCAL_ONLY",
        "测试邮件只写入了本地发件箱，没有对外发送",
        409,
      );
    }
    return NextResponse.json(
      {
        data: {
          mailMessageId: message.id,
          to,
          status: "SENT",
        },
      },
      { status: 200 },
    );
  } catch (error) {
    return routeError(error, {
      request,
      operation: "mail.test.deliver",
    });
  }
}
