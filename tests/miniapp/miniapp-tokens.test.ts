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
