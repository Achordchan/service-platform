import {
  deliveryNoticeChannels,
  deliveryNoticeText,
  fetchDeliveryRule,
  isDeliveryOverrideActive,
  type DeliveryChannelRule,
  type DeliveryOverride,
  type DeliveryScene,
} from "../../lib/delivery";
import { previewDelivery, type DeliveryPreview } from "../../lib/api";

type RecipientRow = DeliveryPreview["recipients"][number] & {
  emailLabel: string;
  wechatLabel: string;
  /** 邮件是「无视本人已关闭强制发」的：副文案要标红提醒 */
  emailForced: boolean;
  muted: boolean;
};

/**
 * 发送前的提醒提示行 + 自定义面板（与 Web 端 DeliveryNotice 同语义）。
 *
 * 默认态只读「本场景当前开着哪些通道」（与收件人无关，零逐人查询）；
 * 点「自定义」才去算真实收件人和每人的通道状态。
 */
Component({
  properties: {
    // { scene: "REQUEST_PUBLIC_MESSAGE", requestId } 等，见 lib/delivery
    scene: { type: null, value: null },
    disabled: { type: Boolean, value: false },
  },
  data: {
    rule: null as DeliveryChannelRule | null,
    override: {} as DeliveryOverride,
    noticeText: "",
    customized: false,
    panelVisible: false,
    loadingPreview: false,
    previewError: "",
    preview: null as DeliveryPreview | null,
    rows: [] as RecipientRow[],
    // 客户与内部分开渲染，避免在长名单里点错人
    groups: [] as Array<{ key: string; title: string; rows: RecipientRow[] }>,
    draft: {} as DeliveryOverride,
    draftNotification: true,
    draftEmail: false,
    draftWechat: false,
    excludedCount: 0,
    notifyCount: 0,
    emailHint: "",
    wechatHint: "",
    forceWarn: "",
  },
  observers: {
    scene(scene: DeliveryScene | null) {
      if (!scene) return;
      void this.loadRule(scene);
    },
  },
  methods: {
    async loadRule(scene: DeliveryScene) {
      const rule = await fetchDeliveryRule(scene.scene);
      this.setData({ rule });
      this.refreshNotice();
    },
    refreshNotice() {
      const { rule, override } = this.data;
      this.setData({
        noticeText: deliveryNoticeText(deliveryNoticeChannels(rule, override)),
        customized: isDeliveryOverrideActive(override, rule),
      });
    },
    /** 宿主页面提交前调用，拿到本次的覆盖 */
    getOverride(): DeliveryOverride {
      return this.data.override;
    },
    /** 宿主页面提交成功后调用：覆盖是一次性的，不跨下一次操作沿用 */
    resetOverride() {
      this.setData({ override: {}, draft: {} });
      this.refreshNotice();
    },
    // 遮罩上吞掉冒泡与滚动穿透
    noop() {},
    onOpenPanel() {
      if (this.data.disabled) return;
      const scene = this.data.scene as DeliveryScene | null;
      if (!scene) return;
      this.setData({
        panelVisible: true,
        loadingPreview: true,
        previewError: "",
        preview: null,
        rows: [],
        draft: { ...this.data.override },
      });
      previewDelivery(scene)
        .then((preview) => {
          this.setData({ preview, loadingPreview: false });
          this.syncDraftFromPreview();
        })
        .catch((error: unknown) => {
          this.setData({
            loadingPreview: false,
            previewError:
              error instanceof Error ? error.message : "无法读取提醒范围",
          });
        });
    },
    onClosePanel() {
      this.setData({ panelVisible: false });
    },
    syncDraftFromPreview() {
      const preview = this.data.preview;
      if (!preview) return;
      const draft = this.data.draft;
      const notification =
        draft.notification ?? preview.rule.notificationEnabled;
      const email = draft.email ?? preview.rule.emailEnabled;
      const wechat = draft.wechat ?? preview.rule.wechatEnabled;
      const excluded = new Set(draft.excludeUserIds ?? []);
      // 统计只算「本次真的会提醒」的人：排除掉的不能再计进各通道人数
      const active = preview.recipients.filter(
        (recipient) => !excluded.has(recipient.userId),
      );
      const emailReady = active.filter(
        (item) => item.emailState === "READY",
      ).length;
      const emailUserOff = active.filter(
        (item) => item.emailState === "USER_OFF",
      ).length;
      const wechatReady = active.filter(
        (item) => item.wechatState === "READY",
      ).length;
      const wechatUnavailable = active.filter(
        (item) =>
          item.wechatState === "NO_BINDING" || item.wechatState === "NO_QUOTA",
      ).length;
      const emailOn = notification && email;
      const wechatOn = notification && wechat;
      const emailUserOffActive = active.filter(
        (item) => item.emailState === "USER_OFF",
      ).length;
      this.setData({
        draftNotification: notification,
        draftEmail: emailOn,
        draftWechat: wechatOn,
        excludedCount: preview.recipients.filter((recipient) =>
          excluded.has(recipient.userId),
        ).length,
        notifyCount: active.length,
        emailHint: !preview.rule.emailSupported
          ? "本场景不支持邮件提醒"
          : !notification
            ? "站内通知已关闭，本次不发邮件"
            : !emailOn
              ? "已关闭：本次不发邮件"
              : emailUserOff > 0
                ? `${emailReady} 人正常接收 · ${emailUserOff} 人已关闭`
                : emailReady > 0
                  ? `${emailReady} 人会收到`
                  : "本次没有需要发邮件的收件人",
        // 开着开关且有人自己关过 → 这个开关此刻就是「强制发送」，必须说透
        forceWarn:
          emailOn && emailUserOffActive > 0
            ? `${emailUserOffActive} 人已关闭邮件提醒，保持开启将强制发送并记入审计。`
            : "",
        wechatHint: !preview.rule.wechatSupported
          ? "本场景无订阅模板"
          : !notification
            ? "站内通知已关闭，本次不发微信"
            : !wechatOn
              ? "已关闭：本次不发微信订阅"
              : wechatUnavailable > 0
                ? `${wechatReady} 人可送达 · ${wechatUnavailable} 人未绑定或额度耗尽（强制也发不出）`
                : `${wechatReady} 人可送达`,
        rows: preview.recipients.map((recipient) => {
          const muted = excluded.has(recipient.userId);
          const emailForced =
            emailOn && !muted && recipient.emailState === "USER_OFF";
          return {
            ...recipient,
            muted,
            emailForced,
            emailLabel: !notification
              ? "本次不提醒"
              : recipient.emailState === "NOT_TARGETED"
                ? emailOn
                  ? "强制发送对此场景无效"
                  : "本场景不发送"
                : !emailOn
                  ? "本次不发"
                  : emailForced
                    ? "强制发送"
                    : "会收到",
            wechatLabel: !notification
              ? "本次不提醒"
              : recipient.wechatState === "NO_BINDING"
                ? "未绑定小程序"
                : recipient.wechatState === "NO_QUOTA"
                  ? "订阅额度不足"
                  : recipient.wechatState === "UNSUPPORTED"
                    ? "本场景无模板"
                    : !wechatOn
                      ? "本次不发"
                      : "会收到",
          };
        }),
      });
      this.regroup();
    },
    regroup() {
      const rows = this.data.rows;
      const customers = rows.filter((row) => row.isCustomer);
      const staff = rows.filter((row) => !row.isCustomer);
      this.setData({
        groups: [
          ...(customers.length > 0
            ? [{ key: "customer", title: `客户 ${customers.length} 人`, rows: customers }]
            : []),
          ...(staff.length > 0
            ? [{ key: "staff", title: `内部人员 ${staff.length} 人`, rows: staff }]
            : []),
        ],
      });
    },
    setChannel(channel: "notification" | "email" | "wechat", value: boolean) {
      const preview = this.data.preview;
      if (!preview) return;
      const ruleValue =
        channel === "notification"
          ? preview.rule.notificationEnabled
          : channel === "email"
            ? preview.rule.emailEnabled
            : preview.rule.wechatEnabled;
      const draft: DeliveryOverride = { ...this.data.draft };
      // 与规则一致就撤掉覆盖，别把「与默认相同」也记成一次覆盖
      if (value === ruleValue) delete draft[channel];
      else draft[channel] = value;
      this.setData({ draft });
      this.syncDraftFromPreview();
    },
    onToggleNotification(event: WechatMiniprogram.CustomEvent) {
      this.setChannel("notification", Boolean(event.detail.value));
    },
    onToggleEmail(event: WechatMiniprogram.CustomEvent) {
      if (!this.data.draftNotification) return;
      this.setChannel("email", Boolean(event.detail.value));
    },
    onToggleWechat(event: WechatMiniprogram.CustomEvent) {
      if (!this.data.draftNotification) return;
      this.setChannel("wechat", Boolean(event.detail.value));
    },
    onToggleRecipient(event: WechatMiniprogram.CustomEvent) {
      if (!this.data.draftNotification) return;
      const userId = String(event.currentTarget.dataset.userId ?? "");
      if (!userId) return;
      const next = new Set(this.data.draft.excludeUserIds ?? []);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      const draft: DeliveryOverride = { ...this.data.draft };
      if (next.size > 0) draft.excludeUserIds = [...next];
      else delete draft.excludeUserIds;
      this.setData({ draft });
      this.syncDraftFromPreview();
    },
    onRestoreDefault() {
      this.setData({ override: {}, draft: {}, panelVisible: false });
      this.refreshNotice();
      this.triggerEvent("change", { override: {} });
    },
    onApply() {
      const override = { ...this.data.draft };
      this.setData({ override, panelVisible: false });
      this.refreshNotice();
      this.triggerEvent("change", { override });
    },
  },
});
