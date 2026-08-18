export type PickedFile = { localPath: string; fileName: string };

// chooseMedia 的临时路径通常形如 .../xxxx.jpg，尽量取原文件名，取不到再兜底带扩展名
function deriveImageName(path: string, index: number): string {
  const base = path.split("/").pop() ?? "";
  if (base.includes(".")) return base;
  const ext = base.split(".").pop() || "jpg";
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
      success: (res) =>
        resolve(
          res.tempFiles.map((file, index) => ({
            localPath: file.tempFilePath,
            fileName: deriveImageName(file.tempFilePath, index),
          })),
        ),
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
