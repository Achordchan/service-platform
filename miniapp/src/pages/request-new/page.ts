import { ensureLoggedIn } from "../../lib/auth";
import {
  createRequest,
  listProjects,
  uploadAttachment,
  type ProjectSummary,
} from "../../lib/api";
import { escapeHtml, genMutationKey } from "../../lib/format";
import { pickAttachments } from "../../lib/pick-files";
import { topUpSubscribeQuota } from "../../lib/subscribe";

// 下拉展示中文标签，提交时映射回英文枚举
const PRIORITY_OPTIONS = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const PRIORITY_LABEL_LIST = ["低", "普通", "高", "紧急"];

Page({
  data: {
    projects: [] as Array<{
      id: string;
      title: string;
      categories: Array<{ id: string; name: string }>;
    }>,
    projectIndex: -1,
    categoryIndex: -1,
    priorityOptions: PRIORITY_LABEL_LIST,
    priorityIndex: 1,
    title: "",
    description: "",
    attachments: [] as Array<{
      localPath: string;
      fileName: string;
      attachmentId?: string;
    }>,
    submitting: false,
    error: "",
  },
  // 幂等：进入页面生成 key，提交成功前保持不变；失败重试复用同一 key
  mutationKey: "",
  onLoad(query: Record<string, string | undefined>) {
    this.mutationKey = genMutationKey();
    void this.loadProjects(query.projectId);
  },
  async loadProjects(presetProjectId?: string) {
    try {
      const projects = (await listProjects())
        .filter(
          (project) =>
            project.status === "ACTIVE" &&
            project.customerRequestsEnabled !== false &&
            project.serviceType.requestCategories.length > 0,
        )
        .map((project: ProjectSummary) => ({
          id: project.id,
          title: project.title,
          categories: project.serviceType.requestCategories,
        }));
      const presetIndex = presetProjectId
        ? projects.findIndex((project) => project.id === presetProjectId)
        : -1;
      // 默认选中：绝大多数用户只有一个项目；分类同样默认第一项（用户可改）
      const defaultProject =
        presetIndex >= 0 ? presetIndex : projects.length === 1 ? 0 : 0;
      this.setData({
        projects,
        projectIndex: defaultProject,
        categoryIndex: 0,
      });
    } catch (error) {
      this.setData({
        error:
          error instanceof Error ? error.message : "项目加载失败，请返回重试",
      });
    }
  },
  onProjectChange(event: WechatMiniprogram.PickerChange) {
    this.setData({
      projectIndex: Number(event.detail.value),
      // 换项目后分类回到第一项，保持无空白默认
      categoryIndex: 0,
    });
  },
  onCategoryChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ categoryIndex: Number(event.detail.value) });
  },
  onPriorityChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ priorityIndex: Number(event.detail.value) });
  },
  onTitleInput(event: WechatMiniprogram.Input) {
    this.setData({ title: event.detail.value });
  },
  onDescriptionInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ description: event.detail.value });
  },
  async onAddAttachment() {
    if (this.data.attachments.length >= 5) {
      wx.showToast({ title: "最多 5 个附件", icon: "none" });
      return;
    }
    const chosen = await pickAttachments(5 - this.data.attachments.length);
    if (chosen.length === 0) return;
    this.setData({
      attachments: [...this.data.attachments, ...chosen],
    });
  },
  onRemoveAttachment(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const attachments = [...this.data.attachments];
    attachments.splice(index, 1);
    this.setData({ attachments });
  },
  async onSubmit() {
    if (this.data.submitting) return;
    const { projectIndex, categoryIndex, title, description } = this.data;
    if (projectIndex < 0) {
      this.setData({ error: "请选择所属项目" });
      return;
    }
    const project = this.data.projects[projectIndex];
    if (!project) return;
    if (categoryIndex < 0) {
      this.setData({ error: "请选择服务请求分类" });
      return;
    }
    const category = project.categories[categoryIndex];
    if (!title.trim()) {
      this.setData({ error: "请填写标题" });
      return;
    }
    if (!description.trim()) {
      this.setData({ error: "请描述问题" });
      return;
    }
    topUpSubscribeQuota();
    this.setData({ submitting: true, error: "" });
    try {
      // 弱网防重复：同一 mutationKey 重试不会产生第二个工单
      const created = await createRequest(project.id, {
        title: title.trim(),
        description: `<p>${escapeHtml(description.trim()).replace(/\n/g, "<br/>")}</p>`,
        categoryId: category.id,
        priority: PRIORITY_OPTIONS[this.data.priorityIndex] ?? "NORMAL",
        clientMutationKey: this.mutationKey,
      });
      // 附件在工单创建成功后上传；失败不回滚工单（可后续在详情中补传）
      let attachFailed = 0;
      for (const attachment of this.data.attachments) {
        try {
          await uploadAttachment({
            filePath: attachment.localPath,
            fileName: attachment.fileName,
            serviceRequestId: created.id,
          });
        } catch {
          attachFailed += 1;
        }
      }
      if (attachFailed > 0) {
        wx.showToast({
          title: `${attachFailed} 个附件上传失败，可在工单详情补看`,
          icon: "none",
          duration: 2500,
        });
      }
      wx.redirectTo({
        url: `/pages/request-detail/page?id=${created.id}`,
      });
    } catch (error) {
      // 幂等 key 保留：用户重试时复用，不会重复建单
      this.setData({
        submitting: false,
        error: error instanceof Error ? error.message : "提交失败，请重试",
      });
    }
  },
});
