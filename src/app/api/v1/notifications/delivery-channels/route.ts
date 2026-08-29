import { NextResponse } from "next/server";
import { listStaffDeliveryChannels } from "@/modules/notifications/notification-delivery-rule-service";
import { requireApiActor, routeError } from "@/modules/projects/api-utils";

// 发送前提示行的数据源：只回「每个场景当前开着哪些通道」。
// 与收件人无关，因此不需要任何逐人查询 —— 默认态零成本就靠这个。
export async function GET() {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json({
      data: await listStaffDeliveryChannels(auth.actor),
    });
  } catch (error) {
    return routeError(error);
  }
}
