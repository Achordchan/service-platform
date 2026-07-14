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
  description: string;
  actionLabel?: string;
  actionHref?: string;
};

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: EmptyStateProps) {
  return (
    <Stack
      spacing={1.5}
      sx={{
        alignItems: "center",
        justifyContent: "center",
        minHeight: 280,
        px: 3,
        py: 6,
        textAlign: "center",
        border: "1px dashed",
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "#fcfcfd",
      }}
    >
      <Box
        sx={{
          display: "grid",
          placeItems: "center",
          width: 48,
          height: 48,
          borderRadius: "50%",
          color: "text.secondary",
          bgcolor: "#f2f4f7",
        }}
      >
        <InboxOutlinedIcon />
      </Box>
      <Typography variant="h3">{title}</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 480 }}>
        {description}
      </Typography>
      {actionLabel && actionHref ? (
        <Button href={actionHref} variant="contained" sx={{ mt: 1 }}>
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
        minHeight: 240,
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
