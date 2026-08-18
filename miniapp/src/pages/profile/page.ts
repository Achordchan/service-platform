import { ensureLoggedIn, fetchMe, logout, type MiniappMe } from "../../lib/auth";
import { ensureBadgeSync } from "../../lib/badge";

function formatDateTime(value: string | null): string {
  if (!value) return "从未登录";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: {
    loading: true,
    loadError: "",
    me: null as MiniappMe | null,
    boundAtText: "",
    lastLoginText: "",
  },
  onShow() {
    if (!ensureLoggedIn(() => this.activate())) return;
    this.activate();
  },
  activate() {
    ensureBadgeSync();
    void this.loadMe();
  },
  async loadMe() {
    this.setData({ loading: true, loadError: "" });
    try {
      const me = await fetchMe();
      this.setData({
        me,
        boundAtText: me.wechatBinding ? formatDateTime(me.wechatBinding.boundAt) : "",
        lastLoginText: me.wechatBinding ? formatDateTime(me.wechatBinding.lastLoginAt) : "",
        loading: false,
      });
    } catch {
      this.setData({
        loading: false,
        loadError: "加载失败，请下拉重试",
      });
    }
  },
  onPullDownRefresh() {
    void this.loadMe().then(() => wx.stopPullDownRefresh());
  },
  onOpenProfileEdit() {
    wx.navigateTo({ url: "/pages/profile-edit/page" });
  },
  onOpenNotificationSettings() {
    wx.navigateTo({ url: "/pages/notification-settings/page" });
  },
  onOpenMembers() {
    const spaces = (this.data.me?.customerSpaces ?? []).filter(
      (space) => space.role === "OWNER",
    );
    if (spaces.length === 0) {
      wx.showToast({ title: "仅客户负责人可管理成员", icon: "none" });
      return;
    }
    if (spaces.length === 1) {
      wx.navigateTo({ url: `/pages/members/page?id=${spaces[0]!.id}` });
      return;
    }
    wx.showActionSheet({
      itemList: spaces.map((space) => space.name).slice(0, 6),
      success: (result) => {
        const space = spaces[result.tapIndex];
        if (space) {
          wx.navigateTo({ url: `/pages/members/page?id=${space.id}` });
        }
      },
    });
  },
  async onLogout() {
    const confirm = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: "退出登录",
        content: "确定要退出当前微信登录吗？",
        success: (result) => resolve(result.confirm),
        fail: () => resolve(false),
      });
    });
    if (!confirm) return;
    await logout();
    wx.reLaunch({ url: "/pages/auth/login/page" });
  },
});
