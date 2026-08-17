import { ensureLoggedIn, fetchMeCached } from "../../lib/auth";
import { ensureBadgeSync } from "../../lib/badge";
import {
  listProjects,
  type ProjectSummary,
} from "../../lib/api";
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
      }
    >,
  },
  onRetry() {
    void this.load();
  },
  onShow() {
    if (!ensureLoggedIn()) return;
    ensureBadgeSync();
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
      const projects = await listProjects();
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
    const projectId = event.currentTarget.dataset.id as string;
    wx.navigateTo({ url: `/pages/project-detail/page?id=${projectId}` });
  },
});
