// 后端地址：真机无条件指向生产，只有微信开发者工具连本地。
// 发布前需在微信公众平台配置 request/uploadFile/downloadFile 合法域名（含 PROD 域名）。
//
// ⚠️ 绝不要用 wx.getAccountInfoSync().miniProgram.envVersion 判断环境：
// 微信「审核版」的 envVersion 返回的是 develop（而不是 trial），据此切到本地地址，
// 会让审核员在真机上把请求打到 127.0.0.1（手机自己），登录必然失败——
// 2026-08「获取用户信息出错，openid有误」那次审核驳回就是这么来的。
//
// 改按运行平台判断：platform 是设备事实而非版本渠道，真机只会是 ios/android 等，
// 不存在「审核版返回 devtools」这种歧义，因此预览、体验版、审核版、正式版
// 一律落到生产域名，且没有任何开关可以覆盖。
const DEV_API_BASE_URL = "http://127.0.0.1:3000";
const PROD_API_BASE_URL = "https://support.achord.cn";

/**
 * 选定后端地址。纯函数、不引用 wx，便于单元测试。
 *
 * 只有 platform 明确为 "devtools"（微信开发者工具，模拟器跑在电脑上，
 * 127.0.0.1 即电脑本身）才连本地；其余一切情况——真机、平台探测失败——
 * 都走生产，宁可连生产也不能把线上/审核流量导去本地。
 *
 * 真机需要连本机后端联调时，临时改 PROD_API_BASE_URL 为电脑的局域网 IP，
 * 用完改回；tests/miniapp/api-base-url.test.ts 会拦住误提交。
 */
export function pickApiBaseUrl(platform: string | null): string {
  return platform === "devtools" ? DEV_API_BASE_URL : PROD_API_BASE_URL;
}

function detectPlatform(): string | null {
  try {
    // getDeviceInfo 是基础库 2.20.1+ 的新接口，旧基础库回退到 getSystemInfoSync
    if (typeof wx.getDeviceInfo === "function") {
      return wx.getDeviceInfo().platform;
    }
    return wx.getSystemInfoSync().platform;
  } catch {
    return null;
  }
}

export const API_BASE_URL = pickApiBaseUrl(detectPlatform());
