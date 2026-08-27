"use client";

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";

/**
 * 绑定微信的三步引导弹窗。首页横幅与个人设置「微信提醒」分区共用同一份文案，
 * 避免两处话术漂移。onDismiss 存在时额外提供「暂不绑定」（横幅用它顺带 7 天内不再提醒）。
 */
export function WechatBindGuideDialog({
  open,
  onClose,
  onDismiss,
}: {
  open: boolean;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>绑定微信，接收进度提醒</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            绑定后，项目进度更新、服务请求回复、状态变更都会通过微信推送给你，
            不必一直登录网页盯着。
          </Typography>
          <Stack spacing={1.25}>
            <Step
              index={1}
              text="打开微信，进入我们的小程序（扫描客服提供的小程序码，或在微信中搜索进入）。"
            />
            <Step index={2} text="在小程序里用你当前登录的邮箱登录一次，即完成绑定。" />
            <Step
              index={3}
              text="首次会弹出「订阅消息」授权，请点【允许】；之后进度一有更新就推送到微信。"
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            提示：微信的订阅提醒是一次性授权，偶尔打开一下小程序即可保持提醒不中断。
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        {onDismiss ? (
          <Button color="inherit" onClick={onDismiss}>
            暂不绑定
          </Button>
        ) : null}
        <Button variant="contained" onClick={onClose}>
          我知道了
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Step({ index, text }: { index: number; text: string }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start" }}>
      <Box
        sx={{
          flex: "0 0 auto",
          width: 22,
          height: 22,
          borderRadius: "50%",
          bgcolor: "primary.main",
          color: "primary.contrastText",
          fontSize: 13,
          fontWeight: 650,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          mt: 0.25,
        }}
      >
        {index}
      </Box>
      <Typography variant="body2">{text}</Typography>
    </Stack>
  );
}
