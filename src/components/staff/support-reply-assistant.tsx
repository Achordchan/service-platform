"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Divider,
  Drawer,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import { staffApi } from "@/components/staff/staff-api";
import type { SupportReplyPlaybook } from "@/lib/support-reply-playbooks";
import { resolveInlineAttachmentHtml } from "@/lib/message-content";
import { queryKeys } from "@/lib/query-keys";

type CategoryFilter = "ALL" | SupportReplyPlaybook["category"];

const categories: Array<{ value: CategoryFilter; label: string }> = [
  { value: "ALL", label: "全部" },
  { value: "REMOTE", label: "远程协助" },
  { value: "DIAGNOSTIC", label: "故障诊断" },
  { value: "INFORMATION", label: "信息收集" },
];

export function SupportReplyAssistant({
  disabled = false,
  onSend,
}: {
  disabled?: boolean;
  onSend: (playbookKey: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [keyword, setKeyword] = useState("");
  const playbooksQuery = useQuery({
    queryKey: queryKeys.supportPlaybooks.available,
    queryFn: ({ signal }) =>
      staffApi<SupportReplyPlaybook[]>("/api/v1/support-playbooks", {
        signal,
      }),
    enabled: open,
  });
  const sendMutation = useMutation({
    mutationFn: (playbookKey: string) => onSend(playbookKey),
    onSuccess: () => setOpen(false),
  });
  const sendingKey = sendMutation.isPending
    ? (sendMutation.variables ?? "")
    : "";
  const queryErrorMessage =
    playbooksQuery.error instanceof Error
      ? playbooksQuery.error.message
      : playbooksQuery.error
        ? "处理指南加载失败"
        : "";
  const sendErrorMessage =
    sendMutation.error instanceof Error
      ? sendMutation.error.message
      : sendMutation.error
        ? "处理指南发送失败"
        : "";

  const filtered = useMemo(() => {
    const playbooks = playbooksQuery.data ?? [];
    const normalized = keyword.trim().toLowerCase();
    return playbooks.filter((playbook) => {
      const matchesCategory =
        category === "ALL" || playbook.category === category;
      const matchesKeyword =
        !normalized ||
        playbook.title.toLowerCase().includes(normalized) ||
        playbook.summary.toLowerCase().includes(normalized) ||
        playbook.steps.some((step) => step.toLowerCase().includes(normalized));
      return matchesCategory && matchesKeyword;
    });
  }, [category, keyword, playbooksQuery.data]);

  async function send(playbook: SupportReplyPlaybook) {
    await sendMutation.mutateAsync(playbook.key).catch(() => undefined);
  }

  function openAssistant() {
    sendMutation.reset();
    setOpen(true);
  }

  function closeAssistant() {
    sendMutation.reset();
    setOpen(false);
  }

  return (
    <>
      <Tooltip
        title={disabled ? "客户回复模式下才能使用回复助手" : "打开回复助手"}
      >
        <span>
          <Button
            size="small"
            variant="outlined"
            startIcon={<MenuBookOutlinedIcon />}
            onClick={openAssistant}
            disabled={disabled}
          >
            回复助手
          </Button>
        </span>
      </Tooltip>
      <Drawer
        anchor="right"
        open={open}
        onClose={closeAssistant}
        slotProps={{
          paper: {
            sx: {
              width: { xs: "100%", sm: 480 },
              maxWidth: "100vw",
            },
          },
        }}
      >
        <Stack sx={{ height: "100%", minHeight: 0 }}>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{
              px: 2.5,
              py: 2,
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Box>
              <Typography variant="h3">回复助手</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                选择处理指南，并作为独立消息发送给客户。
              </Typography>
            </Box>
            <IconButton onClick={closeAssistant} aria-label="关闭回复助手">
              <CloseOutlinedIcon />
            </IconButton>
          </Stack>
          <Divider />
          <Stack spacing={1.5} sx={{ px: 2.5, pt: 2 }}>
            <TextField
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索处理方案"
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchOutlinedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Tabs
              value={category}
              onChange={(_, value: CategoryFilter) => setCategory(value)}
              variant="scrollable"
              scrollButtons={false}
              sx={{ minHeight: 42, "& .MuiTab-root": { minHeight: 42 } }}
            >
              {categories.map((item) => (
                <Tab key={item.value} value={item.value} label={item.label} />
              ))}
            </Tabs>
          </Stack>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 2.5, pb: 3 }}>
            {playbooksQuery.isPending ? (
              <Stack sx={{ py: 8, alignItems: "center" }}>
                <CircularProgress size={28} />
              </Stack>
            ) : null}
            {queryErrorMessage ? (
              <Alert
                severity="error"
                sx={{ mt: 2 }}
                action={
                  playbooksQuery.isError ? (
                    <Button onClick={() => void playbooksQuery.refetch()}>
                      重试
                    </Button>
                  ) : undefined
                }
              >
                {queryErrorMessage}
              </Alert>
            ) : null}
            {sendErrorMessage ? (
              <Alert severity="error" sx={{ mt: 2 }}>
                {sendErrorMessage}
              </Alert>
            ) : null}
            {!playbooksQuery.isPending && !queryErrorMessage ? filtered.map((playbook) => (
              <Accordion
                key={playbook.key}
                disableGutters
                elevation={0}
                sx={{
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  "&::before": { display: "none" },
                }}
              >
                <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                  <Box sx={{ minWidth: 0, pr: 1 }}>
                    <Typography sx={{ fontWeight: 650 }}>
                      {playbook.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
                      {playbook.summary}
                    </Typography>
                  </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pb: 2.5 }}>
                  <Stack spacing={2}>
                    {playbook.content ? (
                      <Box
                        sx={{
                          lineHeight: 1.75,
                          overflowWrap: "anywhere",
                          "& p": { mt: 0, mb: 1 },
                          "& ul, & ol": { my: 1, pl: 2.5 },
                          "& img": {
                            display: "block",
                            maxWidth: "100%",
                            maxHeight: 360,
                            my: 1,
                            borderRadius: 1.5,
                            objectFit: "contain",
                          },
                        }}
                        dangerouslySetInnerHTML={{
                          __html: resolveInlineAttachmentHtml(playbook.content),
                        }}
                      />
                    ) : (
                      <>
                        <Typography sx={{ lineHeight: 1.75 }}>{playbook.introduction}</Typography>
                        <Box>
                          <Typography variant="subtitle2">操作步骤</Typography>
                          <Box component="ol" sx={{ mt: 1, mb: 0, pl: 2.5, "& li": { mb: 0.75 } }}>
                            {playbook.steps.map((step) => (
                              <li key={step}><Typography component="span" variant="body2">{step}</Typography></li>
                            ))}
                          </Box>
                        </Box>
                      </>
                    )}
                    {playbook.safetyNotes.length > 0 ? (
                      <Alert severity="warning">
                        <Typography variant="subtitle2">安全边界</Typography>
                        <Box component="ul" sx={{ mt: 0.75, mb: 0, pl: 2.25 }}>
                          {playbook.safetyNotes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </Box>
                      </Alert>
                    ) : null}
                    <Button
                      variant="contained"
                      onClick={() => void send(playbook)}
                      disabled={Boolean(sendingKey)}
                    >
                      {sendingKey === playbook.key ? "正在发送" : "发送给客户"}
                    </Button>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            )) : null}
            {!playbooksQuery.isPending && !queryErrorMessage && filtered.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 6, textAlign: "center" }}>
                没有匹配的处理方案
              </Typography>
            ) : null}
          </Box>
        </Stack>
      </Drawer>
    </>
  );
}
