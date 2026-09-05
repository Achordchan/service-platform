import { submitFeedback, type FeedbackRuntimeInfo } from "../../lib/api";
import { genMutationKey } from "../../lib/format";

// 与后端 FEEDBACK_TITLE_MAX / FEEDBACK_CONTENT_MAX 保持一致
const TITLE_MAX = 120;
const CONTENT_MAX = 5000;

/** 收集小程序运行环境信息，随反馈一起提交（任意一步失败都不影响提交） */
function collectRuntime(): FeedbackRuntimeInfo {
  const runtime: FeedbackRuntimeInfo = {};
  try {
    const account = wx.getAccountInfoSync().miniProgram;
    // 开发/体验版 version 为空，退回 envVersion 兜底
    const version = account.version || account.envVersion || "";
    runtime.appVersion = version.slice(0, 40);
  } catch {
    // 忽略：字段保持缺省
  }
  try {
    const device = wx.getDeviceInfo();
    if (device.model) runtime.model = device.model.slice(0, 100);
    if (device.system) runtime.system = device.system.slice(0, 100);
    if (device.platform) runtime.platform = device.platform.slice(0, 20);
  } catch {
    // 忽略：字段保持缺省
  }
  try {
    const base = wx.getAppBaseInfo();
    if (base.SDKVersion) runtime.sdkVersion = base.SDKVersion.slice(0, 40);
  } catch {
    // 忽略：字段保持缺省
  }
  return runtime;
}

Page({
  data: {
    title: "",
    content: "",
    submitting: false,
    error: "",
  },
  // 幂等：进入页面生成 key，提交成功前保持不变；失败重试复用同一 key
  mutationKey: "",
  onLoad() {
    this.mutationKey = genMutationKey();
  },
  onTitleInput(event: WechatMiniprogram.Input) {
    this.setData({ title: event.detail.value });
  },
  onContentInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ content: event.detail.value });
  },
  async onSubmit() {
    if (this.data.submitting) return;
    const title = this.data.title.trim();
    const content = this.data.content.trim();
    if (!title) {
      this.setData({ error: "请填写标题" });
      return;
    }
    if (!content) {
      this.setData({ error: "请填写反馈内容" });
      return;
    }
    this.setData({ submitting: true, error: "" });
    try {
      const result = await submitFeedback({
        title,
        content,
        miniappRuntime: collectRuntime(),
        // 弱网防重复：同一反馈重试不会建出第二个 GitHub issue
        clientMutationKey: this.mutationKey,
      });
      if (result.issueUrl) {
        // 链接没法在小程序里直接打开，复制到剪贴板由用户自行在浏览器查看
        wx.setClipboardData({ data: result.issueUrl });
        wx.showModal({
          title: "提交成功",
          content:
            "感谢你的反馈！问题追踪链接已复制到剪贴板，可在浏览器中打开查看。",
          showCancel: false,
          confirmText: "好的",
          success: () => {
            wx.navigateBack();
          },
        });
      } else {
        wx.showToast({ title: "感谢你的反馈", icon: "success" });
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      }
    } catch (error) {
      this.setData({
        submitting: false,
        error: error instanceof Error ? error.message : "提交失败，请重试",
      });
    }
  },
});
