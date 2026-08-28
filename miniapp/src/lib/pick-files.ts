export type PickedFile = { localPath: string; fileName: string };

// chooseMedia 的临时路径通常形如 .../xxxx.jpg，尽量取原文件名；无扩展名时
// 用 getImageInfo 探测真实图片类型再命名（该名字会作为 originalName 持久化）
async function deriveImageName(path: string, index: number): Promise<string> {
  const base = path.split("/").pop() ?? "";
  if (base.includes(".")) return base;
  const type = await new Promise<string>((resolve) => {
    wx.getImageInfo({
      src: path,
      success: (res) => resolve(res.type || "jpg"),
      fail: () => resolve("jpg"),
    });
  });
  const ext = type === "jpeg" ? "jpg" : type;
  return `图片_${Date.now()}_${index}.${ext}`;
}

// 仅图片：后端附件校验与平台策略暂不支持视频类型，选视频会在消息创建后被拒、
// 造成「消息已发但附件丢失」。需要视频时应先补齐后端端到端支持再放开。
function chooseLocalImage(count: number): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    wx.chooseMedia({
      count,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["original", "compressed"],
      success: (res) => {
        void Promise.all(
          res.tempFiles.map(async (file, index) => ({
            localPath: file.tempFilePath,
            fileName: await deriveImageName(file.tempFilePath, index),
          })),
        ).then(resolve);
      },
      fail: () => resolve([]),
    });
  });
}

function chooseChatFile(count: number): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    wx.chooseMessageFile({
      count,
      type: "file",
      success: (res) =>
        resolve(
          res.tempFiles.map((file) => ({
            localPath: file.path,
            fileName: file.name || "附件",
          })),
        ),
      fail: () => resolve([]),
    });
  });
}

/**
 * 统一的附件选择：先让用户选来源，兼顾本地图片与微信聊天文件。
 * 微信小程序没有通用「本地文件系统」入口，本地图片只能通过 chooseMedia（相册/拍摄）
 * 获取，其余任意格式走 chooseMessageFile（聊天文件）。用户取消一律返回空数组。
 */
export function pickAttachments(remaining: number): Promise<PickedFile[]> {
  if (remaining <= 0) return Promise.resolve([]);
  return new Promise((resolve) => {
    wx.showActionSheet({
      itemList: ["拍摄 / 相册图片", "微信聊天文件"],
      success: (res) => {
        if (res.tapIndex === 0) resolve(chooseLocalImage(remaining));
        else if (res.tapIndex === 1) resolve(chooseChatFile(remaining));
        else resolve([]);
      },
      fail: () => resolve([]),
    });
  });
}

const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp)$/i;
const TEXT_EXT = /\.(?:txt|log|csv|json)$/i;
type OpenableDocType =
  | "doc"
  | "docx"
  | "xls"
  | "xlsx"
  | "ppt"
  | "pptx"
  | "pdf";
const DOC_EXT = /\.(doc|docx|xls|xlsx|ppt|pptx|pdf)$/i;

/**
 * 上传前本地预览：图片走 previewImage，Office/PDF 走 openDocument（显式给
 * fileType，chooseMessageFile 的临时路径可能不带规范扩展名），其余格式提示不支持。
 */
export function previewLocalFile(file: PickedFile) {
  if (IMAGE_EXT.test(file.fileName) || IMAGE_EXT.test(file.localPath)) {
    wx.previewImage({ urls: [file.localPath] });
    return;
  }
  if (TEXT_EXT.test(file.fileName)) {
    wx.navigateTo({
      url: `/pages/attachment-text/page?path=${encodeURIComponent(file.localPath)}&name=${encodeURIComponent(file.fileName)}`,
    });
    return;
  }
  const match = DOC_EXT.exec(file.fileName);
  if (!match) {
    wx.showToast({ title: "该格式暂不支持预览，可直接上传", icon: "none" });
    return;
  }
  wx.openDocument({
    filePath: file.localPath,
    fileType: match[1].toLowerCase() as OpenableDocType,
    showMenu: true,
    fail: () =>
      wx.showToast({ title: "该格式暂不支持预览，可直接上传", icon: "none" }),
  });
}
