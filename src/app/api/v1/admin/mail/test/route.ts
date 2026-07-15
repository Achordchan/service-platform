import { NextResponse } from "next/server";
import { enqueueMail } from "@/lib/jobs";
import { getPublicAppUrl } from "@/modules/platform-settings/mail-settings-runtime";
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
    const jobId = await enqueueMail({
      to,
      subject: "服务支持中心邮件配置测试",
      heading: "邮件发送配置正常",
      body: "这是一封由平台管理员发起的测试邮件，用于验证 Resend 域名、发件人和回复地址配置。",
      actionLabel: "打开服务支持中心",
      actionUrl: appUrl,
      deliveryMode: "RESEND",
    });
    return NextResponse.json(
      { data: { jobId, to, status: "QUEUED" } },
      { status: 202 },
    );
  } catch (error) {
    return routeError(error);
  }
}
