"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import Link from "next/link";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { apiRequest, jsonRequest } from "@/lib/api-client";
import {
  FEEDBACK_CONTENT_MAX,
  FEEDBACK_TITLE_MAX,
} from "@/modules/feedback/schemas";

type FeedbackDialogContextValue = {
  open: () => void;
};

const FeedbackDialogContext =
  createContext<FeedbackDialogContextValue | null>(null);

type FeedbackFormValues = z.infer<typeof feedbackFormSchema>;

const feedbackFormSchema = z.object({
  title: z.string().trim().min(1, "请填写标题").max(FEEDBACK_TITLE_MAX),
  content: z.string().trim().min(1, "请填写反馈内容").max(FEEDBACK_CONTENT_MAX),
});

type SubmitFeedbackResult = {
  id: string;
  issueUrl: string | null;
};

export function FeedbackDialogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SubmitFeedbackResult | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<FeedbackFormValues>({
    resolver: zodResolver(feedbackFormSchema),
    defaultValues: { title: "", content: "" },
  });

  // 弱网重试防重：打开弹窗时生成一次，提交失败重试沿用；成功后弹窗
  // 切到结果视图，再次打开时重新生成，不会误伤下一条反馈。
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  // 上次尝试发出的内容：失败后再提交时若内容已编辑，换新 key——
  // 沿用旧 key 会命中服务端可能已保存的旧反馈（409 或拿回旧内容），编辑白改。
  const [attemptedPayload, setAttemptedPayload] = useState<string | null>(null);

  const openDialog = useCallback(() => {
    setResult(null);
    reset();
    setAttemptedPayload(null);
    setMutationKey(crypto.randomUUID());
    setOpen(true);
  }, [reset]);

  const closeDialog = useCallback(() => {
    if (isSubmitting) return;
    setOpen(false);
  }, [isSubmitting]);

  const contextValue = useMemo(
    () => ({ open: openDialog }),
    [openDialog],
  );

  async function submit(values: FeedbackFormValues) {
    clearErrors("root");
    const payload = `${values.title}\n${values.content}`;
    // 上次尝试失败后用户编辑过内容：换新 key，把这次当新反馈提交
    let key = mutationKey;
    if (attemptedPayload !== null && attemptedPayload !== payload) {
      key = crypto.randomUUID();
      setMutationKey(key);
    }
    setAttemptedPayload(payload);
    try {
      const submitted = await apiRequest<SubmitFeedbackResult>(
        "/api/v1/feedback",
        jsonRequest("POST", {
          ...values,
          clientMutationKey: key ?? undefined,
        }),
      );
      setResult(submitted);
    } catch (submitError) {
      setError("root", {
        message:
          submitError instanceof Error ? submitError.message : "反馈提交失败",
      });
    }
  }

  return (
    <FeedbackDialogContext.Provider value={contextValue}>
      {children}
      <Dialog
        open={open}
        onClose={closeDialog}
        fullWidth
        maxWidth="sm"
      >
        {isSubmitting ? <LinearProgress /> : null}
        {result ? (
          <>
            <DialogTitle>意见反馈</DialogTitle>
            <DialogContent>
              <Stack spacing={2}>
                {result.issueUrl ? (
                  <Alert severity="success">
                    <Stack spacing={0.5}>
                      <Typography>反馈已提交，感谢你的输入！</Typography>
                      <Typography variant="body2">
                        已自动创建跟踪 issue：
                        <Link
                          href={result.issueUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {result.issueUrl}
                        </Link>
                      </Typography>
                    </Stack>
                  </Alert>
                ) : (
                  <Alert severity="success">
                    反馈已提交，感谢你的输入！我们会尽快查看。
                  </Alert>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpen(false)}>关闭</Button>
            </DialogActions>
          </>
        ) : (
          <Box component="form" onSubmit={handleSubmit(submit)}>
            <DialogTitle>意见反馈</DialogTitle>
            <DialogContent>
              <Stack spacing={2.25} sx={{ pt: 1 }}>
                {errors.root?.message ? (
                  <Alert severity="error">{errors.root.message}</Alert>
                ) : null}
                <Controller
                  name="title"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="标题"
                      placeholder="一句话说明问题或建议"
                      required
                      fullWidth
                      autoFocus
                      error={Boolean(errors.title)}
                      helperText={errors.title?.message}
                      slotProps={{ htmlInput: { maxLength: FEEDBACK_TITLE_MAX } }}
                    />
                  )}
                />
                <Controller
                  name="content"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="详细内容"
                      placeholder="发生了什么、期望是什么、在哪个页面（可选）"
                      required
                      fullWidth
                      multiline
                      minRows={5}
                      maxRows={14}
                      error={Boolean(errors.content)}
                      helperText={
                        errors.content?.message ??
                        `${field.value.length} / ${FEEDBACK_CONTENT_MAX} 字`
                      }
                      slotProps={{
                        htmlInput: { maxLength: FEEDBACK_CONTENT_MAX },
                      }}
                    />
                  )}
                />
                <Alert severity="info" icon={false}>
                  <Typography variant="caption">
                    反馈内容会同步到 GitHub issue
                    跟踪进度，请勿包含密码、密钥、账号、客户资料等敏感信息（issue
                    对外可见且删除后仍可能留存于历史记录）。
                  </Typography>
                </Alert>
                <Typography variant="caption" color="text.secondary">
                  提交后会自动附带版本号与平台信息，便于我们定位问题。
                </Typography>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={closeDialog} disabled={isSubmitting}>
                取消
              </Button>
              <Button type="submit" variant="contained" disabled={isSubmitting}>
                提交反馈
              </Button>
            </DialogActions>
          </Box>
        )}
      </Dialog>
    </FeedbackDialogContext.Provider>
  );
}

export function useFeedbackDialog() {
  const context = useContext(FeedbackDialogContext);
  if (!context) {
    throw new Error("useFeedbackDialog 必须在 FeedbackDialogProvider 内使用");
  }
  return context;
}
