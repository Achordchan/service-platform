/**
 * 微信订阅授权的纯状态模型。
 *
 * wx.getSetting 只会返回勾选过「总是保持以上选择」的模板；没有 itemSettings
 * 不等于没有一次性授权。一次性授权是否还能发送，必须结合服务端 remaining 判断。
 */

export type SubscribePermissionState =
  | "accept"
  | "reject"
  | "ban"
  | "main-switch-off"
  | "unknown";

export type SubscribeDecision =
  | "accept"
  | "reject"
  | "ban"
  | "filter"
  | "unknown";

export type SubscribeDecisionSummary<TTemplateKey extends string = string> = {
  decisions: Array<{
    templateKey: TTemplateKey;
    decision: SubscribeDecision;
  }>;
  acceptedCount: number;
  rejectedCount: number;
  bannedCount: number;
  filteredCount: number;
  unknownCount: number;
};

export type SubscribeRequestOutcome<TTemplateKey extends string = string> =
  SubscribeDecisionSummary<TTemplateKey> & {
    /** 微信已 accept 且额度已成功写入服务端的数量 */
    recordedCount: number;
    /** 授权过程中账号发生切换，结果已按安全策略作废 */
    identityChanged: boolean;
  };

export type SubscribeFeedback = {
  mode: "toast" | "modal";
  title: string;
  content?: string;
  openSettings?: boolean;
};

export function normalizeSubscribeDecision(value: unknown): SubscribeDecision {
  if (
    value === "accept" ||
    value === "reject" ||
    value === "ban" ||
    value === "filter"
  ) {
    return value;
  }
  return "unknown";
}

export function permissionFromSetting(
  mainSwitch: boolean,
  value: unknown,
): SubscribePermissionState {
  if (!mainSwitch) return "main-switch-off";
  const decision = normalizeSubscribeDecision(value);
  if (decision === "accept" || decision === "reject" || decision === "ban") {
    return decision;
  }
  return "unknown";
}

/** 明确拒绝/封禁时，服务端旧额度也不能再当成可发送。 */
export function isSubscribePermissionBlocked(
  permission: SubscribePermissionState,
): boolean {
  return (
    permission === "reject" ||
    permission === "ban" ||
    permission === "main-switch-off"
  );
}

/**
 * 一次性授权没有持久 itemSettings，但 remaining>0 时仍然真的可以接收消息。
 * 只有明确拒绝/封禁/总开关关闭，才能覆盖服务端剩余额度并判为不可发送。
 */
export function isSubscribeTemplateEnabled(
  permission: SubscribePermissionState,
  remaining: number,
): boolean {
  return remaining > 0 && !isSubscribePermissionBlocked(permission);
}

export function subscribeTemplateStatusText(
  permission: SubscribePermissionState,
  remaining: number,
): string {
  if (permission === "main-switch-off") return "总开关已关闭";
  if (permission === "ban") return "模板不可用";
  if (permission === "reject") return "已拒绝";
  if (remaining > 0 && permission === "accept") return "已开启";
  if (remaining > 0) return `可接收 ${remaining} 条`;
  if (permission === "accept") return "额度已用完";
  return "未开启";
}

export function summarizeSubscribeDecisions<TTemplateKey extends string>(
  templates: ReadonlyArray<{ templateKey: TTemplateKey; templateId: string }>,
  result: Readonly<Record<string, unknown>>,
): SubscribeDecisionSummary<TTemplateKey> {
  const decisions = templates.map((template) => ({
    templateKey: template.templateKey,
    decision: normalizeSubscribeDecision(result[template.templateId]),
  }));
  return {
    decisions,
    acceptedCount: decisions.filter((item) => item.decision === "accept").length,
    rejectedCount: decisions.filter((item) => item.decision === "reject").length,
    bannedCount: decisions.filter((item) => item.decision === "ban").length,
    filteredCount: decisions.filter((item) => item.decision === "filter").length,
    unknownCount: decisions.filter((item) => item.decision === "unknown").length,
  };
}

export function feedbackForSubscribeOutcome(
  outcome: SubscribeRequestOutcome,
): SubscribeFeedback {
  if (outcome.identityChanged) {
    return { mode: "toast", title: "账号状态已变化，请重新操作" };
  }

  const unavailableCount = outcome.bannedCount + outcome.filteredCount;
  const pendingSyncCount = outcome.acceptedCount - outcome.recordedCount;
  const notAcceptedCount =
    outcome.rejectedCount + unavailableCount + outcome.unknownCount;

  /** 未授权成功的各类结果说明，部分成功与完全失败两条路径共用同一套聚合口径。 */
  const notAcceptedDetails: string[] = [];
  if (outcome.rejectedCount > 0) {
    notAcceptedDetails.push(
      `${outcome.rejectedCount} 类未允许，可前往微信设置重新开启`,
    );
  }
  if (unavailableCount > 0) {
    notAcceptedDetails.push(
      `${unavailableCount} 类模板不可用，请联系平台管理员`,
    );
  }
  if (outcome.unknownCount > 0) {
    notAcceptedDetails.push(
      `${outcome.unknownCount} 类未返回明确结果，请重试`,
    );
  }

  if (
    outcome.acceptedCount > 0 &&
    (pendingSyncCount > 0 || notAcceptedCount > 0)
  ) {
    const details: string[] = [];
    if (outcome.recordedCount > 0) {
      details.push(`已开启 ${outcome.recordedCount} 类提醒`);
    }
    if (pendingSyncCount > 0) {
      details.push(
        `${pendingSyncCount} 类已允许但状态暂未同步，将在下次操作时自动重试`,
      );
    }
    details.push(...notAcceptedDetails);
    return {
      mode: "modal",
      title:
        notAcceptedCount > 0 ? "微信授权已部分完成" : "微信授权已完成",
      content: `${details.join("；")}。`,
      openSettings: outcome.rejectedCount > 0,
    };
  }

  if (outcome.acceptedCount > 0) {
    return { mode: "toast", title: `已开启 ${outcome.recordedCount} 类提醒` };
  }

  // 完全没有授权成功时：单一类别沿用专属文案；多类别混合必须逐类说明，
  // 否则 ban/filter 会掩盖用户拒绝，并连带吞掉「去设置」这条恢复路径。
  if (notAcceptedCount > 0 && outcome.rejectedCount === notAcceptedCount) {
    return {
      mode: "modal",
      title: "微信提醒未开启",
      content: "你已拒绝订阅提醒，请前往微信设置重新允许。",
      openSettings: true,
    };
  }
  if (notAcceptedCount > 0 && unavailableCount === notAcceptedCount) {
    return {
      mode: "modal",
      title: "微信提醒暂不可用",
      content: "当前订阅模板不可用，请联系平台管理员检查微信模板配置。",
    };
  }
  if (notAcceptedDetails.length > 1) {
    return {
      mode: "modal",
      title: outcome.rejectedCount > 0 ? "微信提醒未开启" : "微信提醒暂不可用",
      content: `${notAcceptedDetails.join("；")}。`,
      openSettings: outcome.rejectedCount > 0,
    };
  }
  return { mode: "toast", title: "未获取到授权结果，请重试" };
}

export function subscribeFailureCode(error: unknown): number | null {
  const code = (error as { errCode?: unknown } | undefined)?.errCode;
  if (typeof code === "number") return code;
  const message = String(
    (error as { errMsg?: unknown } | undefined)?.errMsg ?? "",
  );
  const match = message.match(/(?:^|\D)(\d{5})(?:\D|$)/);
  return match ? Number(match[1]) : null;
}

export function feedbackForSubscribeFailure(error: unknown): SubscribeFeedback {
  const code = subscribeFailureCode(error);
  if (code === 20004) {
    return {
      mode: "modal",
      title: "微信提醒总开关已关闭",
      content: "请前往微信设置开启订阅消息总开关，然后重新授权。",
      openSettings: true,
    };
  }
  if (
    code === 10004 ||
    code === 20001 ||
    code === 20002 ||
    code === 20003 ||
    code === 20005
  ) {
    return {
      mode: "modal",
      title: "微信提醒暂不可用",
      content: "订阅模板配置异常，请联系平台管理员处理。",
    };
  }
  if (code === 10002 || code === 10003) {
    return { mode: "toast", title: "网络异常，授权未完成" };
  }
  if (code === 10005) {
    return { mode: "toast", title: "授权窗口未能打开，请保持小程序在前台后重试" };
  }
  return { mode: "toast", title: "授权未完成，请重试" };
}
