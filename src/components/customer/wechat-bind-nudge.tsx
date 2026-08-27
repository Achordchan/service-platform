"use client";

import { useEffect, useState } from "react";
import { Alert, Button, IconButton, Stack } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import NotificationsActiveOutlinedIcon from "@mui/icons-material/NotificationsActiveOutlined";
import { WechatBindGuideDialog } from "@/components/customer/wechat-bind-guide";

// 关闭后 7 天内不再打扰；到期或换浏览器会再次出现。仅本机记忆，不入库。
const DISMISS_KEY = "wechat-bind-nudge-dismissed-at";
const RESHOW_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 客户首页「绑定微信接收提醒」引导横幅。
 * 仅未绑定微信时出现；已绑定（bound=true）永久不显示。
 * 服务端渲染为 null，挂载后再据本机记忆决定是否显示，避免水合闪烁。
 */
export function WechatBindNudge({ bound }: { bound: boolean }) {
  const [visible, setVisible] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (bound) return;
    let show = true;
    try {
      const raw = window.localStorage.getItem(DISMISS_KEY);
      const dismissedAt = raw ? Number(raw) : 0;
      show = !dismissedAt || Date.now() - dismissedAt > RESHOW_AFTER_MS;
    } catch {
      // 隐私模式等读取失败时，仍展示引导（宁可多提醒一次）
      show = true;
    }
    if (show) {
      // 挂载后据本机记忆一次性决定是否展示：读 localStorage 属外部状态同步，
      // 服务端渲染 null、客户端再决定，用以避免水合闪烁，非级联渲染。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
    }
  }, [bound]);

  if (bound || !visible) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // 存不进也无所谓，本次先关掉
    }
    setVisible(false);
  }

  return (
    <>
      <Alert
        severity="info"
        icon={<NotificationsActiveOutlinedIcon />}
        action={
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <Button color="inherit" size="small" onClick={() => setDialogOpen(true)}>
              如何绑定
            </Button>
            <IconButton
              aria-label="暂不绑定，关闭提示"
              color="inherit"
              size="small"
              onClick={dismiss}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        }
      >
        绑定微信小程序，项目进度更新第一时间推送到你的微信。
      </Alert>

      <WechatBindGuideDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onDismiss={() => {
          dismiss();
          setDialogOpen(false);
        }}
      />
    </>
  );
}
