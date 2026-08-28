import { describe, expect, it } from "vitest";
import {
  createBindingCode,
  createMiniappSessionToken,
  hashBindingCode,
  hashSecretToken,
  maskOpenid,
  normalizeBindingCode,
} from "@/modules/miniapp/miniapp-tokens";

describe("微信小程序 token 与绑定码", () => {
  it("绑定码格式为 XXXX-XXXX 且只含无歧义字符", () => {
    const { code } = createBindingCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it("normalize 去除分隔符并统一大小写，哈希与明文一致", () => {
    const { code, codeHash } = createBindingCode();
    expect(normalizeBindingCode(code.toLowerCase())).toBe(
      code.replace(/-/g, ""),
    );
    expect(hashBindingCode(code.toLowerCase().replace(/-/g, " "))).toBe(
      codeHash,
    );
  });

  it("不同绑定码哈希不同，session token/ticket 有前缀", () => {
    const first = createBindingCode();
    const second = createBindingCode();
    expect(first.codeHash).not.toBe(second.codeHash);

    const session = createMiniappSessionToken();
    expect(session.token).toMatch(/^ma_/);
    expect(hashSecretToken(session.token)).toBe(session.tokenHash);
  });

  it("openid 脱敏保留首尾片段", () => {
    expect(maskOpenid("oABCDEFGHIJK")).toBe("oABC***IJK");
    expect(maskOpenid("short")).toBe("****");
  });
});

describe("小程序纯文本编辑器不能吃掉正文内嵌图", () => {
  it("保留原正文里的 <img> 标签，避免服务端把消失的附件 id 当成删除", async () => {
    const { keepInlineImageTags } = await import(
      "../../miniapp/src/lib/format"
    );
    const body =
      '<p>说明</p><img src="attachment://att-1" /><p>后续</p>' +
      '<img data-attachment-id="att-2">';
    // 服务端 updateProjectUpdate 会把「正文里消失的附件 id」判定为删除，
    // 连附件行和存储文件一起删 —— 所以纯文本编辑器保存时必须把标签接回去
    const kept = keepInlineImageTags(body);
    expect(kept).toContain("attachment://att-1");
    expect(kept).toContain("att-2");
    expect(kept).not.toContain("说明");
  });

  it("没有内嵌图时返回空串，不往正文里塞垃圾", async () => {
    const { keepInlineImageTags } = await import(
      "../../miniapp/src/lib/format"
    );
    expect(keepInlineImageTags("<p>只有文字</p>")).toBe("");
  });
});
