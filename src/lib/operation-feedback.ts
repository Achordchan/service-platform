export type DeliveryFeedback = {
  notificationCount: number;
  emailCount: number;
  emailTiming: "IMMEDIATE" | "DELAYED" | null;
  dingtalkQueued: boolean;
};

export type DeliveryFeedbackDetail = "detailed" | "summary";

export function deliveryFeedbackMessage(
  feedback?: DeliveryFeedback | null,
  detail: DeliveryFeedbackDetail = "detailed",
) {
  if (!feedback) return null;

  const hasDeliveryWork =
    feedback.notificationCount > 0 ||
    feedback.emailCount > 0 ||
    feedback.dingtalkQueued;
  if (!hasDeliveryWork) return null;
  if (detail === "summary") return "相关人员将收到通知";

  const parts: string[] = [];
  if (feedback.notificationCount > 0) {
    parts.push(`站内通知 ${feedback.notificationCount} 人`);
  }
  if (feedback.emailCount > 0) {
    parts.push(
      feedback.emailTiming === "DELAYED"
        ? `邮件 ${feedback.emailCount} 封将在持续未读 5 分钟后发送`
        : `邮件 ${feedback.emailCount} 封已进入发送队列`,
    );
  }
  if (feedback.dingtalkQueued) {
    parts.push("钉钉机器人消息已进入发送队列");
  }

  return `通知已安排：${parts.join("；")}`;
}
