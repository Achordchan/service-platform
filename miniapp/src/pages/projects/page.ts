import { cancelPendingActivate, ensureLoggedIn, fetchMeCached } from "../../lib/auth";
import { ensureBadgeSync } from "../../lib/badge";
import { eventSync } from "../../lib/events";
import {
  listProjects,
  type ProjectSummary,
} from "../../lib/api";
import { topUpSubscribeQuota } from "../../lib/subscribe";
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_TONES,
  formatRelative,
  greetingFor,
  todayLabel,
  type ProjectStatusValue,
} from "../../lib/format";

Page({
  data: {
    greeting: "",
    dateText: todayLabel(),
    loading: true,
    loadError: "",
    projects: [] as Array<
      ProjectSummary & {
        statusLabel: string;
        statusTone: string;
        updatedText: string;
        showMilestoneStat: boolean;
      }
    >,
  },
  onRetry() {
    void this.load();
  },
  boundEventHandler: null as
    | ((events: Array<{ type: string; projectId: string | null }>) => void)
    | null,
  sseStarted: false,
  // 校验中挂起的 activate；onHide/onUnload 需取消
  pendingActivate: null as (() => void) | null,
  onLoad() {
    this.boundEventHandler = (events) => this.onRealtimeEvents(events);
  },
  onShow() {
    // 身份校验未完成时挂起 activate，校验通过后再启动业务请求。
    // 必须存下同一个函数引用：cancelAuthWaiter 按引用取消，每次现造匿名箭头
    // 函数就取消不掉 —— 校验完成后会唤醒已隐藏页面的 activate，
    // eventSync 计数只增不减，最后连登出都清不干净
    const activate = () => this.activate();
    this.pendingActivate = activate;
    if (!ensureLoggedIn(activate)) return;
    this.activate();
  },
  teardown() {
    if (this.pendingActivate) {
      cancelPendingActivate(this.pendingActivate);
      this.pendingActivate = null;
    }
    if (!this.sseStarted) return;
    this.sseStarted = false;
    if (this.boundEventHandler) {
      eventSync.off(this.boundEventHandler);
    }
    eventSync.stop();
  },
  onHide() {
    this.teardown();
  },
  onUnload() {
    this.teardown();
  },
  onRealtimeEvents(events: Array<{ type: string; projectId: string | null }>) {
    if (
      events.some(
        (event) =>
          event.projectId !== null &&
          (event.type === "PROJECT_UPDATED" ||
            event.type === "PROJECT_UPDATE_CREATED" ||
            event.type === "UPDATE_COMMENT_CREATED"),
      )
    ) {
      void this.load();
    }
  },
  activate() {
    this.pendingActivate = null;
    ensureBadgeSync();
    // 项目卡片上的未读角标与进度会随动态/里程碑变化，需实时刷新
    if (this.boundEventHandler) {
      eventSync.on(this.boundEventHandler);
    }
    eventSync.start();
    this.sseStarted = true;
    this.setData({ dateText: todayLabel() });
    void fetchMeCached()
      .then((me) => {
        this.setData({ greeting: greetingFor(me.user.name) });
      })
      .catch(() => undefined);
    void this.load();
  },
  onPullDownRefresh() {
    void this.load().then(() => wx.stopPullDownRefresh());
  },
  async load() {
    this.setData({ loading: true, loadError: "" });
    try {
      const [projects, me] = await Promise.all([
        listProjects(),
        fetchMeCached().catch(() => null),
      ]);
      const isStaff = me?.isStaff === true;
      this.setData({
        loading: false,
        projects: projects.map((project) => ({
          ...project,
          statusLabel:
            PROJECT_STATUS_LABELS[project.status as ProjectStatusValue] ??
            project.status,
          statusTone:
            PROJECT_STATUS_TONES[project.status as ProjectStatusValue] ??
            "neutral",
          updatedText: formatRelative(project.updatedAt),
          // 客户关掉里程碑模块后，卡片上的里程碑计数也要一起收起（员工不受限）
          showMilestoneStat: isStaff || project.showMilestones !== false,
        })),
      });
    } catch (error) {
      this.setData({
        loading: false,
        loadError:
          error instanceof Error ? error.message : "加载失败，请下拉重试",
      });
    }
  },
  onOpenProject(event: WechatMiniprogram.TouchEvent) {
    topUpSubscribeQuota();
    const projectId = event.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/project-detail/page?id=${projectId}` });
  },
});
