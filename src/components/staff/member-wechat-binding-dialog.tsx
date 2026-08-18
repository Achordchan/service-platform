"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import { useToast } from "@/components/shared/toast-provider";
import { jsonRequest, staffApi } from "@/components/staff/staff-api";

type MemberWechatBindingTarget = {
  membershipId: string;
  userName: string;
};

type WechatBindingStatus = {
  binding: {
    boundAt: string;
    lastLoginAt: string | null;
    openidMasked: string;
  } | null;
  activeCodes: Array<{
    id: string;
    createdAt: string;
    expiresAt: string;
  }>;
};

export function MemberWechatBindingDialog({
  customerSpaceId,
  target,
  onClose,
}: {
  customerSpaceId: string;
  target: MemberWechatBindingTarget | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [issuedCode, setIssuedCode] = useState<{
    code: string;
    expiresAt: string;
  } | null>(null);
  const [unconfirming, setUnconfirming] = useState(false);
  // 弹窗在不同成员间复用且不卸载：切换成员必须清掉上一个成员刚生成的明文码，
  // 否则会把 A 的绑定码显示在 B 的弹窗里（跨客户串码）。
  // React 官方「记录上次值、渲染期重置」模式，避免在 effect 里 setState。
  const activeMembershipId = target?.membershipId ?? null;
  const [trackedMembershipId, setTrackedMembershipId] =
    useState(activeMembershipId);
  if (trackedMembershipId !== activeMembershipId) {
    setTrackedMembershipId(activeMembershipId);
    setIssuedCode(null);
    setUnconfirming(false);
  }
  const statusUrl = target
    ? `/api/v1/admin/customer-spaces/${customerSpaceId}/members/${target.membershipId}/wechat-binding`
    : "";
  const statusQuery = useQuery({
    queryKey: ["customer-spaces", "member-wechat-binding", customerSpaceId, target?.membershipId],
    queryFn: ({ signal }) => staffApi<WechatBindingStatus>(statusUrl, { signal }),
    enabled: Boolean(target),
  });
  const actionMutation = useMutation({
    mutationFn: ({ run }: { key: string; run: () => Promise<unknown> }) =>
      run(),
  });
  const busyKey = actionMutation.isPending
    ? (actionMutation.variables?.key ?? "action")
    : "";
  const status = statusQuery.data;

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: ["customer-spaces", "member-wechat-binding", customerSpaceId],
    });
    await queryClient.invalidateQueries({
      queryKey: ["customer-spaces", "detail", customerSpaceId],
    });
  }

  async function execute(
    key: string,
    run: () => Promise<unknown>,
    fallbackError: string,
  ): Promise<boolean> {
    try {
      await actionMutation.mutateAsync({ key, run });
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallbackError);
      return false;
    }
  }

  async function generateCode() {
    let generated: { code: string; expiresAt: string } | null = null;
    const ok = await execute(
      "generate-code",
      async () => {
        generated = await staffApi<{ code: string; expiresAt: string }>(
          `${statusUrl}/binding-codes`,
          jsonRequest("POST"),
        );
      },
      "绑定码生成失败",
    );
    if (!ok || !generated) return;
    setIssuedCode(generated);
    toast.success("绑定码已生成，请立即复制发送给客户");
    await refresh();
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("绑定码已复制");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  }

  async function revokeCode(codeId: string) {
    const ok = await execute(
      `revoke:${codeId}`,
      () =>
        staffApi(
          `${statusUrl}/binding-codes/${codeId}`,
          jsonRequest("DELETE"),
        ),
      "绑定码作废失败",
    );
    if (!ok) return;
    toast.success("绑定码已作废");
    await refresh();
  }

  async function unbind() {
    const ok = await execute(
      "unbind",
      () => staffApi(statusUrl, jsonRequest("DELETE")),
      "解绑失败",
    );
    if (!ok) return;
    setUnconfirming(false);
    toast.success("已解除微信绑定，该微信可重新绑定其他账号");
    await refresh();
  }

  return (
    <>
      <Dialog
        open={Boolean(target)}
        onClose={busyKey ? undefined : onClose}
        fullWidth
        maxWidth="sm"
      >
        {statusQuery.isFetching || busyKey ? <LinearProgress /> : null}
        <DialogTitle>微信绑定 · {target?.userName}</DialogTitle>
        <DialogContent dividers>
          {statusQuery.isError ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              绑定状态加载失败，请关闭后重试。
            </Alert>
          ) : null}
          {issuedCode ? (
            <Alert severity="success" sx={{ mb: 2 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography
                  component="code"
                  sx={{ fontWeight: 700, letterSpacing: 2, fontSize: 18 }}
                >
                  {issuedCode.code}
                </Typography>
                <Button
                  size="small"
                  startIcon={<ContentCopyOutlinedIcon />}
                  onClick={() => void copyCode(issuedCode.code)}
                >
                  复制
                </Button>
              </Stack>
              <Typography variant="body2">
                请立即复制并发送给客户，明文仅显示这一次，15 分钟内有效。
              </Typography>
            </Alert>
          ) : null}
          {status ? (
            <Stack spacing={2}>
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: "center", justifyContent: "space-between" }}
              >
                <Stack spacing={0.5}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Typography sx={{ fontWeight: 650 }}>当前状态</Typography>
                    {status.binding ? (
                      <Chip size="small" color="success" label="已绑定微信" />
                    ) : (
                      <Chip size="small" variant="outlined" label="未绑定" />
                    )}
                  </Stack>
                  {status.binding ? (
                    <Typography variant="body2" color="text.secondary">
                      微信号 {status.binding.openidMasked} · 最近小程序登录：
                      {status.binding.lastLoginAt
                        ? new Intl.DateTimeFormat("zh-CN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(status.binding.lastLoginAt))
                        : "从未登录"}
                    </Typography>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      生成绑定码后告知客户，在小程序「绑定页面」输入即可完成绑定。
                    </Typography>
                  )}
                </Stack>
                {status.binding ? (
                  <Button
                    color="error"
                    size="small"
                    disabled={Boolean(busyKey)}
                    onClick={() => setUnconfirming(true)}
                  >
                    解除绑定
                  </Button>
                ) : null}
              </Stack>
              <Divider />
              <Stack spacing={1}>
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: "center", justifyContent: "space-between" }}
                >
                  <Typography sx={{ fontWeight: 650 }}>未使用绑定码</Typography>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={Boolean(busyKey)}
                    onClick={() => void generateCode()}
                  >
                    生成绑定码
                  </Button>
                </Stack>
                {status.activeCodes.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    暂无待使用绑定码。
                  </Typography>
                ) : (
                  status.activeCodes.map((code) => (
                    <Stack
                      key={code.id}
                      direction="row"
                      spacing={1.5}
                      sx={{ alignItems: "center", justifyContent: "space-between" }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        有效期至{" "}
                        {new Intl.DateTimeFormat("zh-CN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(code.expiresAt))}
                      </Typography>
                      <Button
                        size="small"
                        color="inherit"
                        disabled={Boolean(busyKey)}
                        onClick={() => void revokeCode(code.id)}
                      >
                        作废
                      </Button>
                    </Stack>
                  ))
                )}
              </Stack>
            </Stack>
          ) : statusQuery.isPending ? (
            <Box sx={{ minHeight: 120 }} />
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} disabled={Boolean(busyKey)}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={unconfirming}
        onClose={busyKey ? undefined : () => setUnconfirming(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>解除微信绑定</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            确认解除「{target?.userName}」的微信绑定？该成员的小程序会话将立即失效，其微信可重新绑定账号。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setUnconfirming(false)} disabled={Boolean(busyKey)}>
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={Boolean(busyKey)}
            onClick={() => void unbind()}
          >
            确认解绑
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
