// 后端地址：真机无条件指向生产，只有微信开发者工具连本地。
// 选择逻辑与常量在 lib/api-base-url.ts（纯函数，可单测）；这里只负责探测运行平台。
// 发布前需在微信公众平台配置 request/uploadFile/downloadFile 合法域名（含 PROD 域名）。
import { pickApiBaseUrl } from "./lib/api-base-url";

function detectPlatform(): string | null {
  try {
    // getDeviceInfo 是基础库 2.20.1+ 的新接口，旧基础库回退到 getSystemInfoSync
    if (typeof wx.getDeviceInfo === "function") {
      return wx.getDeviceInfo().platform;
    }
    return wx.getSystemInfoSync().platform;
  } catch {
    // 探测异常按真机处理，交由 pickApiBaseUrl 落到生产
    return null;
  }
}

export const API_BASE_URL = pickApiBaseUrl(detectPlatform());
