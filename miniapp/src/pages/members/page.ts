import { ensureLoggedIn, fetchMeCached } from "../../lib/auth";
import {
  getCustomerSpaceDetail,
  inviteSpaceMember,
  removeSpaceMember,
  type CustomerSpaceDetail,
} from "../../lib/api";
import { ApiError } from "../../lib/request";

Page({
  data: {
    spaceId: "",
    spaceName: "",
    loading: true,
    loadError: "",
    isOwner: false,
    detail: null as CustomerSpaceDetail | null,
    inviting: false,
    inviteEmail: "",
    canRetry: true,
  },
  onRetry() {
    if (!this.data.spaceId) return;
    void this.load();
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ spaceId: query.id ?? "" });
  },
  onShow() {
    if (!ensureLoggedIn(() => this.load())) return;
    void this.load();
  },
  onPullDownRefresh() {
    void this.load().then(() => wx.stopPullDownRefresh());
  },
  async load() {
    const spaceId = this.data.spaceId;
    if (!spaceId) {
      this.setData({
        loading: false,
        loadError: "缺少客户空间参数，请从「我的-成员管理」进入",
        canRetry: false,
      });
      return;
    }
    this.setData({ loading: true, loadError: "" });
    try {
      const [detail, me] = await Promise.all([
        getCustomerSpaceDetail(spaceId),
        fetchMeCached(),
      ]);
      this.setData({
        loading: false,
        detail,
        spaceName: detail.name,
        isOwner: me.user.id === detail.ownerId,
      });
      wx.setNavigationBarTitle({ title: `成员 · ${detail.name}` });
    } catch (error) {
      const denied =
        error instanceof ApiError && (error.status === 403 || error.status === 404);
      this.setData({
        loading: false,
        loadError: denied
          ? "仅客户负责人可以查看成员管理"
          : error instanceof Error
            ? error.message
            : "加载失败，请下拉重试",
        canRetry: !denied,
      });
    }
  },
  onInviteEmailInput(event: WechatMiniprogram.Input) {
    this.setData({ inviteEmail: event.detail.value });
  },
  async onInvite() {
    if (this.data.inviting) return;
    const email = this.data.inviteEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      wx.showToast({ title: "请输入有效邮箱", icon: "none" });
      return;
    }
    this.setData({ inviting: true });
    try {
      await inviteSpaceMember(this.data.spaceId, email);
      this.setData({ inviteEmail: "" });
      wx.showToast({ title: "邀请已发送", icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "邀请失败",
        icon: "none",
      });
    } finally {
      this.setData({ inviting: false });
    }
  },
  onRemoveMember(event: WechatMiniprogram.TouchEvent) {
    const membershipId = event.currentTarget.dataset.id as string;
    const name = event.currentTarget.dataset.name as string;
    if (membershipId === "") return;
    wx.showModal({
      title: "移除成员",
      content: `确认移除「${name}」？移除后其将无法访问该客户空间。`,
      confirmColor: "#d14343",
      success: (result) => {
        if (!result.confirm) return;
        void this.doRemove(membershipId);
      },
    });
  },
  async doRemove(membershipId: string) {
    try {
      await removeSpaceMember(this.data.spaceId, membershipId);
      wx.showToast({ title: "已移除", icon: "success" });
      await this.load();
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "移除失败",
        icon: "none",
      });
    }
  },
});
