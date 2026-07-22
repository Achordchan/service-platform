import { describe, expect, it } from "vitest";
import {
  GLOBAL_SOUND_EVENT_TYPES,
  shouldPlayGlobalRealtimeSound,
} from "@/components/shared/global-realtime-sound";
import type { RealtimeEvent } from "@/lib/realtime-client";

function event(input?: Partial<RealtimeEvent>): RealtimeEvent {
  return {
    type: "REQUEST_MESSAGE_CREATED",
    payload: { actorId: "other-user", requestId: "request-1" },
    live: true,
    replayed: false,
    lastEventId: "1",
    ...input,
  };
}

describe("全局实时声音", () => {
  it("覆盖业务信息更新，但排除在线、输入和插件进度", () => {
    expect(GLOBAL_SOUND_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        "PROJECT_UPDATE_CREATED",
        "UPDATE_COMMENT_CREATED",
        "REQUEST_CREATED",
        "REQUEST_MESSAGE_CREATED",
        "REQUEST_STATUS_CHANGED",
        "REQUEST_UPDATED",
      ]),
    );
    expect(GLOBAL_SOUND_EVENT_TYPES).not.toContain("REQUEST_PRESENCE_CHANGED");
    expect(GLOBAL_SOUND_EVENT_TYPES).not.toContain("REQUEST_TYPING_CHANGED");
    expect(GLOBAL_SOUND_EVENT_TYPES).not.toContain("PLUGIN_RUN_UPDATED");
    expect(GLOBAL_SOUND_EVENT_TYPES).not.toContain("NOTIFICATION_CREATED");
  });

  it("只为其他人的实时事件播放", () => {
    expect(shouldPlayGlobalRealtimeSound(event(), "current-user", 0, 100)).toBe(
      true,
    );
    expect(
      shouldPlayGlobalRealtimeSound(
        event({ payload: { actorId: "current-user" } }),
        "current-user",
        0,
        100,
      ),
    ).toBe(false);
    expect(
      shouldPlayGlobalRealtimeSound(
        event({ live: false, replayed: true }),
        "current-user",
        0,
        100,
      ),
    ).toBe(false);
    expect(
      shouldPlayGlobalRealtimeSound(
        event({ payload: { actorId: "system" } }),
        "current-user",
        0,
        100,
      ),
    ).toBe(false);
  });

  it("本地操作抑制窗口内不播放无 actor 的回声", () => {
    expect(
      shouldPlayGlobalRealtimeSound(event(), "current-user", 2_000, 1_000),
    ).toBe(true);
    expect(
      shouldPlayGlobalRealtimeSound(
        event({ payload: { requestId: "request-1" } }),
        "current-user",
        2_000,
        1_000,
      ),
    ).toBe(false);
    expect(
      shouldPlayGlobalRealtimeSound(
        event({ payload: { requestId: "request-1" } }),
        "current-user",
        2_000,
        2_001,
      ),
    ).toBe(true);
  });

  it("明确标记为静音的派生事件不会播放", () => {
    expect(
      shouldPlayGlobalRealtimeSound(
        event({ payload: { actorId: "other-user", audible: false } }),
        "current-user",
        0,
      ),
    ).toBe(false);
  });
});
