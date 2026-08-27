"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from "@mui/material";

import { apiRequest } from "@/lib/api-client";
import { WechatBindGuideDialog } from "@/components/customer/wechat-bind-guide";

export type WechatBindingSettingsStatus =
  | { bound: false }
  | {
      bound: true;
      boundAt: string;
      lastLoginAt: string | null;
      openidMasked: string;
    };

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

/**
 * 个人设置「微信提醒」分区。已绑定时展示绑定详情并支持自助解绑；
 * 未绑定时引导去小程序绑定。与首页引导横幅共用同一份绑定步骤（WechatBindGuideDialog）。
 */
export function WechatBindingSettings({
  status,
}: {
  status: WechatBindingSettingsStatus;
}) {
  const router = useRouter();
  const [guideOpen, setGuideOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generateCode() {
    setGenerating(true);
    setGenError(null);
    setCopied(false);
    try {
      const result = await apiRequest<{ code: string; expiresAt: string }>(
        "/api/v1/me/wechat-binding/code",
        { method: "POST" },
      );
      setCode(result.code);
      setCodeExpiresAt(result.expiresAt);
    } catch (codeError) {
      setGenError(
        codeError instanceof Error ? codeError.message : "生成失败，请稍后重试",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 剪贴板不可用时忽略，用户可手动选中复制
    }
  }

  async function confirmUnbind() {
    setRemoving(true);
    setError(null);
    try {
      await apiRequest("/api/v1/me/wechat-binding", { method: "DELETE" });
      setConfirmOpen(false);
      router.refresh();
    } catch (unbindError) {
      setError(
        unbindError instanceof Error
          ? unbindError.message
          : "解绑失败，请稍后重试",
      );
    } finally {
      setRemoving(false);
    }
  }

  if (status.bound) {
    return (
      <>
        <Stack spacing={2}>
          <Alert severity="success">
            已绑定微信，项目进度更新、回复与状态变更会推送到你的微信。
          </Alert>
          <Stack spacing={1}>
            <DetailRow label="微信标识" value={status.openidMasked} />
            <DetailRow label="绑定时间" value={formatDateTime(status.boundAt)} />
            <DetailRow label="最近使用" value={formatDateTime(status.lastLoginAt)} />
          </Stack>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Box>
            <Button
              color="error"
              variant="outlined"
              onClick={() => {
                setError(null);
                setConfirmOpen(true);
              }}
            >
              解绑微信
            </Button>
          </Box>
        </Stack>

        <Dialog
          open={confirmOpen}
          onClose={removing ? undefined : () => setConfirmOpen(false)}
          fullWidth
          maxWidth="xs"
        >
          <DialogTitle>解绑微信？</DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary">
              解绑后将不再通过微信接收项目进度提醒，且会退出小程序登录。
              你可以随时重新绑定。
            </Typography>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={() => setConfirmOpen(false)} disabled={removing}>
              取消
            </Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => void confirmUnbind()}
              disabled={removing}
            >
              {removing ? "解绑中..." : "确认解绑"}
            </Button>
          </DialogActions>
        </Dialog>
      </>
    );
  }

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        尚未绑定微信。绑定后，项目进度更新、服务请求回复与状态变更会第一时间推送到你的微信，
        不必一直登录网页查看。
      </Alert>

      {code ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              在小程序里输入下面的绑定码即可完成绑定
              {codeExpiresAt
                ? `（有效期至 ${formatDateTime(codeExpiresAt)}）`
                : ""}
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "center", flexWrap: "wrap" }}
            >
              <Typography
                sx={{
                  fontFamily: "monospace",
                  fontSize: 26,
                  fontWeight: 700,
                  letterSpacing: 3,
                  wordBreak: "break-all",
                }}
              >
                {code}
              </Typography>
              <Button size="small" onClick={() => void copyCode()}>
                {copied ? "已复制" : "复制"}
              </Button>
            </Stack>
            <Stack spacing={0.5}>
              <Typography variant="body2" color="text.secondary">
                1. 打开我们的微信小程序
              </Typography>
              <Typography variant="body2" color="text.secondary">
                2. 进入「绑定码」绑定入口
              </Typography>
              <Typography variant="body2" color="text.secondary">
                3. 输入上面的绑定码，完成绑定
              </Typography>
            </Stack>
          </Stack>
        </Paper>
      ) : null}

      {genError ? <Alert severity="error">{genError}</Alert> : null}

      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        <Button
          variant="contained"
          onClick={() => void generateCode()}
          disabled={generating}
        >
          {generating ? "生成中..." : code ? "重新生成绑定码" : "生成绑定码"}
        </Button>
        <Button color="inherit" onClick={() => setGuideOpen(true)}>
          如何绑定
        </Button>
      </Stack>

      <WechatBindGuideDialog
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
      />
    </Stack>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ justifyContent: "space-between", alignItems: "baseline" }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: "right" }}>
        {value}
      </Typography>
    </Stack>
  );
}
