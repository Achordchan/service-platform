import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 微信会静态扫描上传的代码包：包里出现未在《用户隐私保护指引》声明的隐私接口就驳回，
// 而声明了代码里没有的接口同样会被判「指引不明确」。2026-08-31 那次驳回的根因是
// TDesign 的 common/template/button.wxml 带着 bind:getphonenumber 混进了包里，
// 逼得后台必须声明手机号——删声明就被驳，留着又填不出真实用途。
//
// 防线建立在两类输入上：
// - 自有代码 + node_modules 里已安装的 TDesign 包：CI 上 pnpm install 之后都在，
//   所以这两条永远真的在跑，也能在升级 TDesign 引入新隐私目录时立刻失败；
// - src/miniprogram_npm：「构建 npm」产物，不入库、CI 上不存在，只在本地补充校验。

const MINIAPP_ROOT = path.join(__dirname, "../../miniapp");
const SRC_ROOT = path.join(MINIAPP_ROOT, "src");
const TDESIGN_PKG = path.join(MINIAPP_ROOT, "node_modules/tdesign-miniprogram");
/** 构建 npm 会把 TDesign 拷到这里，ignore 条目也按这个前缀书写 */
const TDESIGN_PACK_PREFIX = "miniprogram_npm/tdesign-miniprogram";

// 微信隐私接口清单里、本项目未使用的入口。真正在用且已声明的三个不在此列：
// chooseMedia、chooseMessageFile、getDeviceInfo/getSystemInfo。
// 新增隐私能力时先更新 docs/miniapp-privacy-declaration.md，再从这里移除对应关键词。
const FORBIDDEN = [
  // 手机号
  "getPhoneNumber",
  "getphonenumber",
  "getRealtimePhoneNumber",
  "getrealtimephonenumber",
  // 位置
  "getLocation",
  "getFuzzyLocation",
  "onLocationChange",
  "startLocationUpdate",
  "chooseLocation",
  "choosePoi",
  "chooseAddress",
  // 麦克风与音视频通话
  "RecorderManager",
  "startRecord",
  "joinVoIPChat",
  "createLivePusherContext",
  // 摄像头与扫码
  "createCameraContext",
  "createVKSession",
  "scanCode",
  // 相册（写入）与旧版选择接口
  "saveImageToPhotosAlbum",
  "saveVideoToPhotosAlbum",
  "chooseImage",
  "chooseVideo",
  // 微信身份信息
  "getUserProfile",
  "getUserInfo",
  "getuserinfo",
  "chooseAvatar",
  "chooseavatar",
  // 剪贴板（读取）
  "getClipboardData",
  // 通讯录与日历
  "addPhoneContact",
  "chooseContact",
  "addPhoneCalendar",
  "addPhoneRepeatCalendar",
  // 发票与卡包
  "chooseInvoice",
  "chooseInvoiceTitle",
  "addCard",
  "openCard",
  // 微信运动
  "getWeRunData",
  // 蓝牙、Wi-Fi、NFC
  "openBluetoothAdapter",
  "createBLEConnection",
  "startBeaconDiscovery",
  "startWifi",
  "getConnectedWifi",
  "getHCEState",
  // 声明式入口：原生组件不经过任何 JS API 就能拿到摄像头/麦克风/微信身份，
  // 只扫接口名会漏掉。带尖括号匹配，避免误伤 chooseMedia 的 sourceType: ["camera"]
  "<camera",
  "<live-pusher",
  "<voip-room",
  "<open-data",
];

const SCANNED_EXT = new Set([".js", ".ts", ".wxml", ".wxs", ".json"]);

type IgnoreEntry = { type: string; value: string };

function packIgnoreEntries(): IgnoreEntry[] {
  const cfg = JSON.parse(
    readFileSync(path.join(MINIAPP_ROOT, "project.config.json"), "utf8"),
  ) as { packOptions?: { ignore?: IgnoreEntry[] } };
  return cfg.packOptions?.ignore ?? [];
}

/**
 * 条目的 type 决定排除范围，不能只看 value：把某条从 folder 误改成 file 时，
 * 微信只会漏掉那一个路径、整个目录照样进包，这里必须跟着只排除单个文件，
 * 否则扫描会假装子树已被排除而放行。folder / file 之外的取值（suffix、glob 等）
 * 语义未建模，一律按「不排除」处理——宁可多扫也不能漏扫。
 */
function isIgnored(rel: string, isDir: boolean, entries: IgnoreEntry[]): boolean {
  return entries.some((entry) => {
    if (entry.type === "folder") {
      return rel === entry.value || rel.startsWith(`${entry.value}/`);
    }
    if (entry.type === "file") return !isDir && rel === entry.value;
    return false;
  });
}

/** 收集 root 下可扫描的文件，相对 root 返回；skip 命中的目录整棵跳过。 */
function collectFiles(
  root: string,
  skip: (rel: string, isDir: boolean) => boolean = () => false,
): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      const isDir = statSync(abs).isDirectory();
      if (skip(rel, isDir)) continue;
      if (isDir) walk(abs);
      else if (SCANNED_EXT.has(path.extname(name))) out.push(rel);
    }
  };
  walk(root);
  return out;
}

function hitsIn(root: string, rel: string): string[] {
  const text = readFileSync(path.join(root, rel), "utf8");
  return FORBIDDEN.filter((keyword) => text.includes(keyword));
}

/** 枚举打包后仍会上传的文件（相对 src/）。 */
function shippedFiles(): string[] {
  const entries = packIgnoreEntries();
  return collectFiles(SRC_ROOT, (rel, isDir) => isIgnored(rel, isDir, entries));
}

/** 已安装 TDesign 包里作为构建 npm 源的目录（package.json 的 miniprogram 字段）。 */
function tdesignDistRoot(): string {
  const pkg = JSON.parse(
    readFileSync(path.join(TDESIGN_PKG, "package.json"), "utf8"),
  ) as { miniprogram?: string };
  return path.join(TDESIGN_PKG, pkg.miniprogram ?? "miniprogram_dist");
}

describe("小程序上传包的隐私接口面", () => {
  it("自有代码不含未声明的隐私接口", () => {
    const own = shippedFiles().filter((f) => !f.startsWith("miniprogram_npm/"));
    expect(own.length).toBeGreaterThan(0);
    const offenders = own
      .map((rel) => ({ rel, hit: hitsIn(SRC_ROOT, rel) }))
      .filter(({ hit }) => hit.length > 0)
      .map(({ rel, hit }) => `${rel} -> ${hit.join(",")}`);
    expect(offenders).toEqual([]);
  });

  it("TDesign 里含隐私接口的文件必须排除在打包之外", () => {
    // 扫已安装的包而不是构建产物：CI 上 pnpm install 之后就在，这条永远真的在跑，
    // 升级 TDesign 引入新的隐私目录时会直接失败，不必手工维护清单
    expect(
      existsSync(TDESIGN_PKG),
      "未安装 tdesign-miniprogram，先 pnpm install 再跑本测试",
    ).toBe(true);
    const dist = tdesignDistRoot();
    const entries = packIgnoreEntries();
    // 按文件判定而非按目录聚合：isIgnored 已区分 folder/file 语义，
    // 把某条 folder 误改成 file 时子树不再被视为排除，这里会立刻发现
    const problems = collectFiles(dist)
      .map((rel) => ({ packPath: `${TDESIGN_PACK_PREFIX}/${rel}`, hit: hitsIn(dist, rel) }))
      .filter(({ packPath, hit }) => hit.length > 0 && !isIgnored(packPath, false, entries))
      .map(({ packPath, hit }) => `${packPath} -> ${hit.join(",")}`);
    expect(problems).toEqual([]);
  });

  // 以下针对「构建 npm」产物，不入库、CI 上不存在，作为本地的最终一致性校验
  const hasVendor = existsSync(path.join(SRC_ROOT, TDESIGN_PACK_PREFIX));

  it.skipIf(!hasVendor)("上传包内不含未声明的隐私接口", () => {
    const offenders = shippedFiles()
      .map((rel) => ({ rel, hit: hitsIn(SRC_ROOT, rel) }))
      .filter(({ hit }) => hit.length > 0)
      .map(({ rel, hit }) => `${rel} -> ${hit.join(",")}`);
    expect(offenders).toEqual([]);
  });

  it.skipIf(!hasVendor)("TDesign 只用到 icon，其余组件必须排除在打包之外", () => {
    const shipped = shippedFiles().filter((f) =>
      f.startsWith(`${TDESIGN_PACK_PREFIX}/`),
    );
    const allowedPrefixes = [
      `${TDESIGN_PACK_PREFIX}/icon/`,
      `${TDESIGN_PACK_PREFIX}/common/`,
      // 库入口与 tslib 运行时，不含任何组件实现
      `${TDESIGN_PACK_PREFIX}/index.`,
      `${TDESIGN_PACK_PREFIX}/miniprogram_npm/tslib/`,
    ];
    // 升级 TDesign 后新出现的组件目录会在这里暴露，提醒补 packOptions.ignore
    const unexpected = shipped.filter(
      (f) => !allowedPrefixes.some((p) => f.startsWith(p)),
    );
    expect(unexpected).toEqual([]);
  });
});
