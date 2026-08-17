import type { ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import InboxOutlinedIcon from "@mui/icons-material/InboxOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";

type EmptyStateProps = {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  icon?: ReactNode;
  /** Compact rendering for use inside dense containers like DataGrid overlays. */
  dense?: boolean;
};

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  icon,
  dense = false,
}: EmptyStateProps) {
  return (
    <Stack
      spacing={dense ? 1 : 1.5}
      sx={{
        alignItems: "center",
        justifyContent: "center",
        minHeight: dense ? 160 : 200,
        px: 3,
        py: dense ? 3 : 4,
        textAlign: "center",
        border: dense ? "none" : "1px dashed",
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: dense ? "transparent" : "background.paper",
      }}
    >
      <Box
        sx={{
          display: "grid",
          placeItems: "center",
          width: dense ? 36 : 48,
          height: dense ? 36 : 48,
          borderRadius: "50%",
          color: "text.secondary",
          bgcolor: "action.hover",
          "& svg": { fontSize: dense ? 18 : 24 },
        }}
      >
        {icon ?? <InboxOutlinedIcon />}
      </Box>
      <Typography variant={dense ? "subtitle2" : "h3"}>{title}</Typography>
      {description ? (
        <Typography
          variant={dense ? "body2" : "body1"}
          color="text.secondary"
          sx={{ maxWidth: 480 }}
        >
          {description}
        </Typography>
      ) : null}
      {actionLabel && (actionHref || onAction) ? (
        <Button
          href={actionHref}
          onClick={onAction}
          variant="contained"
          size={dense ? "small" : "medium"}
          sx={{ mt: 1 }}
        >
          {actionLabel}
        </Button>
      ) : null}
    </Stack>
  );
}

export function ErrorState({
  message = "页面暂时无法加载，请稍后重试。",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <Alert
      severity="error"
      action={
        onRetry ? (
          <Button
            color="inherit"
            size="small"
            startIcon={<RefreshOutlinedIcon />}
            onClick={onRetry}
          >
            重试
          </Button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}

export function LoadingState({ label = "正在加载" }: { label?: string }) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        minHeight: 140,
        color: "text.secondary",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <CircularProgress size={22} />
      <Typography>{label}</Typography>
    </Stack>
  );
}
