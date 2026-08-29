"use client";

import { Box, Stack, Tooltip, Typography } from "@mui/material";
import PhoneIphoneOutlinedIcon from "@mui/icons-material/PhoneIphoneOutlined";
import ComputerOutlinedIcon from "@mui/icons-material/ComputerOutlined";

const CLIENT_LABELS: Record<string, string> = {
  WEB: "网页端在线",
  MINIAPP: "小程序在线",
};

export function RequestPresenceIndicator({
  online,
  label,
  clients = [],
}: {
  online: boolean;
  label: string;
  /** 对方在线来自哪些端；文案不变，只在圆点后补图标 */
  clients?: string[];
}) {
  if (!online) return null;

  // 顺序固定，避免两端都在线时图标位置随心跳抖动
  const ordered = ["WEB", "MINIAPP"].filter((client) =>
    clients.includes(client),
  );

  return (
    <Stack
      direction="row"
      spacing={0.75}
      role="status"
      aria-live="polite"
      sx={{ alignItems: "center", color: "success.main", whiteSpace: "nowrap" }}
    >
      <Box
        sx={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          bgcolor: "success.main",
        }}
      />
      <Typography variant="body2" component="span" sx={{ color: "inherit" }}>
        {label}
      </Typography>
      {ordered.map((client) => (
        <Tooltip key={client} title={CLIENT_LABELS[client] ?? client}>
          <Box
            component="span"
            aria-label={CLIENT_LABELS[client] ?? client}
            sx={{ display: "inline-flex", color: "inherit" }}
          >
            {client === "MINIAPP" ? (
              <PhoneIphoneOutlinedIcon sx={{ fontSize: 16 }} />
            ) : (
              <ComputerOutlinedIcon sx={{ fontSize: 16 }} />
            )}
          </Box>
        </Tooltip>
      ))}
    </Stack>
  );
}
