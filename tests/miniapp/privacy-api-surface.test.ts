import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 微信会静态扫描上传的代码包：包里出现未在《用户隐私保护指引》声明的隐私接口就驳回，
// 而声明了代码里没有的接口同样会被判「指引不明确」。2026-08-31 那次驳回的根因是
// TDesign 的 common/template/button.wxml 带着 bind:getphonenumber 混进了包里，
// 逼得后台必须声明手机号——删声明就被驳，留着又填不出真实用途。
//
// miniprogram_npm 是「构建 npm」产物且不入库，CI 上并不存在，所以防线分两层：
// 前两条只读 project.config.json 与自有代码，在 CI 上同样有效；后两条需要 vendor
// 产物，负责兜住升级 TDesign 后新出现的目录。

const MINIAPP_ROOT = path.join(__dirname, "../../miniapp");
const SRC_ROOT = path.join(MINIAPP_ROOT, "src");
const VENDOR_ROOT = path.join(SRC_ROOT, "miniprogram_npm/tdesign-miniprogram");

// 代码里真正在用、且已在后台声明的接口不在此列（chooseMedia / chooseMessageFile /
// getDeviceInfo）。新增隐私能力时先更新 docs/miniapp-privacy-declaration.md 再放开这里。
const FORBIDDEN = [
  "getPhoneNumber",
  "getphonenumber",
  "getrealtimephonenumber",
  "RecorderManager",
  "startRecord",
  "getLocation",
  "chooseLocation",
  "getClipboardData",
  "createCameraContext",
  "getUserProfile",
  "getUserInfo",
  "getuserinfo",
  "chooseAddress",
  "chooseInvoice",
  "addPhoneContact",
  "getWeRunData",
  "saveImageToPhotosAlbum",
  "saveVideoToPhotosAlbum",
  "openBluetoothAdapter",
];

// 全量扫描 tdesign-miniprogram 得出的、含隐私接口的目录（2026-08-31 核对）。
// 项目只用到 icon，这些必须留在 packOptions.ignore 里才不会被打进上传包。
// 值为该目录命中的接口，便于将来判断能否放开。
const REQUIRED_VENDOR_IGNORES: Record<string, string> = {
  "miniprogram_npm/tdesign-miniprogram/button":
    "getphonenumber/getrealtimephonenumber/getuserinfo",
  "miniprogram_npm/tdesign-miniprogram/chat-record": "startRecord",
  "miniprogram_npm/tdesign-miniprogram/common/template":
    "getphonenumber/getrealtimephonenumber/getuserinfo",
  "miniprogram_npm/tdesign-miniprogram/qrcode": "saveImageToPhotosAlbum",
};

const SCANNED_EXT = new Set([".js", ".ts", ".wxml", ".wxs", ".json"]);

function packIgnorePrefixes(): string[] {
  const cfg = JSON.parse(
    readFileSync(path.join(MINIAPP_ROOT, "project.config.json"), "utf8"),
  ) as { packOptions?: { ignore?: { type: string; value: string }[] } };
  return (cfg.packOptions?.ignore ?? []).map((entry) => entry.value);
}

/** 枚举打包后仍会上传的文件（相对 src/），packOptions.ignore 命中的整目录跳过。 */
function shippedFiles(): string[] {
  const ignored = packIgnorePrefixes();
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = path.relative(SRC_ROOT, abs).split(path.sep).join("/");
      if (ignored.some((i) => rel === i || rel.startsWith(`${i}/`))) continue;
      if (statSync(abs).isDirectory()) walk(abs);
      else if (SCANNED_EXT.has(path.extname(name))) out.push(rel);
    }
  };
  walk(SRC_ROOT);
  return out;
}

function scanForbidden(relPaths: string[]): string[] {
  const offenders: string[] = [];
  for (const rel of relPaths) {
    const text = readFileSync(path.join(SRC_ROOT, rel), "utf8");
    const hit = FORBIDDEN.filter((k) => text.includes(k));
    if (hit.length > 0) offenders.push(`${rel} -> ${hit.join(",")}`);
  }
  return offenders;
}

describe("小程序上传包的隐私接口面", () => {
  it("含隐私接口的 TDesign 目录必须留在 packOptions.ignore 里", () => {
    // 不依赖 miniprogram_npm，CI 上同样能拦住「误删 ignore 条目」
    const ignored = new Set(packIgnorePrefixes());
    const missing = Object.entries(REQUIRED_VENDOR_IGNORES)
      .filter(([dir]) => !ignored.has(dir))
      .map(([dir, apis]) => `${dir}（含 ${apis}）`);
    expect(missing).toEqual([]);
  });

  it("自有代码不含未声明的隐私接口", () => {
    const own = shippedFiles().filter((f) => !f.startsWith("miniprogram_npm/"));
    expect(own.length).toBeGreaterThan(0);
    expect(scanForbidden(own)).toEqual([]);
  });

  const hasVendor = existsSync(VENDOR_ROOT);

  // 以下两条需要「构建 npm」产物，负责发现 REQUIRED_VENDOR_IGNORES 尚未覆盖的新目录
  it.skipIf(!hasVendor)("上传包内不含未声明的隐私接口", () => {
    expect(scanForbidden(shippedFiles())).toEqual([]);
  });

  it.skipIf(!hasVendor)("TDesign 只用到 icon，其余组件必须排除在打包之外", () => {
    const shipped = shippedFiles().filter((f) =>
      f.startsWith("miniprogram_npm/tdesign-miniprogram/"),
    );
    const allowedPrefixes = [
      "miniprogram_npm/tdesign-miniprogram/icon/",
      "miniprogram_npm/tdesign-miniprogram/common/",
      // 库入口与 tslib 运行时，不含任何组件实现
      "miniprogram_npm/tdesign-miniprogram/index.",
      "miniprogram_npm/tdesign-miniprogram/.wechatide",
      "miniprogram_npm/tdesign-miniprogram/miniprogram_npm/tslib/",
    ];
    // 升级 TDesign 后新出现的组件目录会在这里暴露，提醒补 packOptions.ignore
    const unexpected = shipped.filter(
      (f) => !allowedPrefixes.some((p) => f.startsWith(p)),
    );
    expect(unexpected).toEqual([]);
  });
});
