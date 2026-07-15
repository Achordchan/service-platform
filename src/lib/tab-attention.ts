"use client";

let attentionTimer: number | null = null;
let baseTitle = "";
let resetBound = false;

export function stopTabAttention() {
  if (typeof window === "undefined") return;
  if (attentionTimer !== null) {
    window.clearInterval(attentionTimer);
    attentionTimer = null;
  }
  if (baseTitle) {
    document.title = baseTitle;
    baseTitle = "";
  }
}

function handleAttentionReturn() {
  if (
    document.visibilityState === "visible" &&
    document.hasFocus()
  ) {
    stopTabAttention();
  }
}

export function bindTabAttentionReset() {
  if (typeof window === "undefined" || resetBound) return;
  resetBound = true;
  document.addEventListener("visibilitychange", handleAttentionReturn);
  window.addEventListener("focus", handleAttentionReturn);
  handleAttentionReturn();
}

export function startTabAttention() {
  if (typeof window === "undefined") return;
  bindTabAttentionReset();
  if (
    document.visibilityState === "visible" &&
    document.hasFocus()
  ) {
    return;
  }
  if (attentionTimer !== null) return;

  baseTitle = document.title.replace(/^【新消息】\s*/, "");
  let highlighted = true;
  document.title = `【新消息】 ${baseTitle}`;
  attentionTimer = window.setInterval(() => {
    highlighted = !highlighted;
    document.title = highlighted ? `【新消息】 ${baseTitle}` : baseTitle;
  }, 800);
}

export function resetTabAttentionForTests() {
  stopTabAttention();
  if (typeof window !== "undefined" && resetBound) {
    document.removeEventListener("visibilitychange", handleAttentionReturn);
    window.removeEventListener("focus", handleAttentionReturn);
  }
  resetBound = false;
  baseTitle = "";
}
