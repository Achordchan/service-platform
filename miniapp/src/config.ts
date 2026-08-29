// 后端地址按小程序运行环境切换（开发者工具 = develop，体验版 = trial，正式 = release）。
// 发布前将 PROD_API_BASE_URL 替换为真实域名，并在微信公众平台配置 request/uploadFile/downloadFile 合法域名。
//
// develop 环境同时覆盖「电脑模拟器」与「真机调试/预览」：
// - 模拟器跑在电脑上，127.0.0.1 指电脑本身，可用；
// - 真机上 127.0.0.1 指手机自己，必须改成运行 start.sh 的电脑的「局域网 IP」，
//   即 start.sh 启动时打印的那个地址（手机与电脑连同一 WiFi）。
// ⚠️ 本地调试用，勿提交：IP 随 DHCP 变动，提交后别人/生产会连到错误地址。
const DEV_API_BASE_URL = "http://127.0.0.1:3000";
const PROD_API_BASE_URL = "https://support.achord.cn";

function resolveApiBaseUrl(): string {
  try {
    const env = wx.getAccountInfoSync().miniProgram.envVersion;
    if (env === "develop") return DEV_API_BASE_URL;
    return PROD_API_BASE_URL;
  } catch {
    // 兜底必须指向生产：正式版环境探测异常时指向 localhost 会造成整站不可用且无从排查
    return PROD_API_BASE_URL;
  }
}

export const API_BASE_URL = resolveApiBaseUrl();
