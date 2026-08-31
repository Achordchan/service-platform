/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../../miniapp/node_modules/miniprogram-api-typings/index.d.ts" />

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reportSubscribeGrant: vi.fn(),
  requestSubscribeMessage: vi.fn(),
}));

vi.mock("../../miniapp/src/lib/api", () => ({
  getSubscribeGrants: vi.fn(),
  getSubscribeMessageConfig: vi.fn(),
  reportSubscribeGrant: mocks.reportSubscribeGrant,
}));

import {
  requestSubscribe,
  resetSubscribeState,
} from "../../miniapp/src/lib/subscribe";

const TEMPLATES = [
  { templateKey: "REQUEST_REPLY" as const, templateId: "template-reply" },
  { templateKey: "REQUEST_STATUS" as const, templateId: "template-status" },
  { templateKey: "PROJECT_UPDATE" as const, templateId: "template-project" },
];

const storage = new Map<string, unknown>();

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  vi.stubGlobal("wx", {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    requestSubscribeMessage: mocks.requestSubscribeMessage,
  });
  resetSubscribeState();
});

describe("微信订阅授权请求", () => {
  it("微信全部拒绝时保留逐模板结果，且不向服务端伪报额度", async () => {
    mocks.requestSubscribeMessage.mockImplementation(
      ({ success }: WechatMiniprogram.RequestSubscribeMessageOption) => {
        success?.({
          errMsg: "requestSubscribeMessage:ok",
          "template-reply": "reject",
          "template-status": "reject",
          "template-project": "reject",
        });
      },
    );

    const outcome = await requestSubscribe(TEMPLATES);

    expect(outcome.rejectedCount).toBe(3);
    expect(outcome.acceptedCount).toBe(0);
    expect(outcome.recordedCount).toBe(0);
    expect(mocks.reportSubscribeGrant).not.toHaveBeenCalled();
  });

  it("微信允许后逐模板上报服务端，并返回实际记账数量", async () => {
    mocks.requestSubscribeMessage.mockImplementation(
      ({ success }: WechatMiniprogram.RequestSubscribeMessageOption) => {
        success?.({
          errMsg: "requestSubscribeMessage:ok",
          "template-reply": "accept",
          "template-status": "reject",
          "template-project": "filter",
        });
      },
    );
    mocks.reportSubscribeGrant.mockResolvedValue({ remaining: 1 });

    const outcome = await requestSubscribe(TEMPLATES);

    expect(outcome.acceptedCount).toBe(1);
    expect(outcome.recordedCount).toBe(1);
    expect(outcome.rejectedCount).toBe(1);
    expect(outcome.filteredCount).toBe(1);
    expect(mocks.reportSubscribeGrant).toHaveBeenCalledOnce();
    expect(mocks.reportSubscribeGrant).toHaveBeenCalledWith("REQUEST_REPLY");
  });

  it("微信已允许但服务端同步失败时保留待补报，不误判成用户拒绝", async () => {
    mocks.requestSubscribeMessage.mockImplementation(
      ({ success }: WechatMiniprogram.RequestSubscribeMessageOption) => {
        success?.({
          errMsg: "requestSubscribeMessage:ok",
          "template-reply": "accept",
        });
      },
    );
    mocks.reportSubscribeGrant.mockRejectedValue(new Error("temporary"));

    const outcome = await requestSubscribe([TEMPLATES[0]]);

    expect(outcome.acceptedCount).toBe(1);
    expect(outcome.recordedCount).toBe(0);
    expect(outcome.rejectedCount).toBe(0);
    expect(storage.get("miniapp_subscribe_pending_grants")).toEqual([
      ["REQUEST_REPLY", "template-reply"],
    ]);
  });

  it("微信总开关关闭时把原始错误交给反馈层处理", async () => {
    mocks.requestSubscribeMessage.mockImplementation(
      ({ fail }: WechatMiniprogram.RequestSubscribeMessageOption) => {
        fail?.({
          errCode: 20004,
          errMsg: "requestSubscribeMessage:fail 20004",
        });
      },
    );

    await expect(requestSubscribe([TEMPLATES[0]])).rejects.toEqual(
      expect.objectContaining({ errCode: 20004 }),
    );
    expect(mocks.reportSubscribeGrant).not.toHaveBeenCalled();
  });
});
