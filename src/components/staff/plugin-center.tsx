"use client";

import Link from "next/link";
import {
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ExtensionOutlinedIcon from "@mui/icons-material/ExtensionOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import type { PlatformPluginManifest } from "@/modules/plugins/plugin-registry";

export function PluginCenter({
  plugins,
}: {
  plugins: PlatformPluginManifest[];
}) {
  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{
            px: { xs: 2, sm: 2.5 },
            py: 2.25,
            alignItems: { sm: "center" },
            justifyContent: "space-between",
          }}
        >
          <Box>
            <Typography sx={{ fontWeight: 700 }}>已安装插件</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              插件由平台版本提供，并在这里统一管理。
            </Typography>
          </Box>
          <Chip
            label={`${plugins.length} 个`}
            color={plugins.length > 0 ? "primary" : "default"}
          />
        </Stack>
      </Paper>

      {plugins.length === 0 ? (
        <Paper
          variant="outlined"
          sx={{
            minHeight: 280,
            display: "grid",
            placeItems: "center",
            px: 3,
            py: 6,
            textAlign: "center",
          }}
        >
          <Stack spacing={1.25} sx={{ alignItems: "center", maxWidth: 420 }}>
            <Box
              sx={{
                width: 52,
                height: 52,
                display: "grid",
                placeItems: "center",
                borderRadius: 2,
                bgcolor: "#f1f5f9",
                color: "text.secondary",
              }}
            >
              <ExtensionOutlinedIcon />
            </Box>
            <Typography variant="h3">暂无插件</Typography>
            <Typography color="text.secondary">
              后续随平台版本提供的功能插件会显示在这里。
            </Typography>
          </Stack>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ overflow: "hidden" }}>
          {plugins.map((plugin, index) => (
            <Box key={plugin.key}>
              {index > 0 ? <Divider /> : null}
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={2}
                sx={{
                  px: { xs: 2, sm: 2.5 },
                  py: 2.25,
                  alignItems: { md: "center" },
                  justifyContent: "space-between",
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{ alignItems: "center", flexWrap: "wrap" }}
                  >
                    <Typography sx={{ fontWeight: 700 }}>
                      {plugin.name}
                    </Typography>
                    <Chip
                      size="small"
                      label={plugin.enabled ? "已启用" : "未启用"}
                      color={plugin.enabled ? "success" : "default"}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`v${plugin.version}`}
                    />
                  </Stack>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    {plugin.description}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 0.75 }}
                  >
                    {plugin.category}
                  </Typography>
                </Box>
                {plugin.settingsHref ? (
                  <Button
                    component={Link}
                    href={plugin.settingsHref}
                    variant="outlined"
                    startIcon={<SettingsOutlinedIcon />}
                    sx={{
                      alignSelf: { xs: "stretch", md: "center" },
                      flexShrink: 0,
                    }}
                  >
                    设置
                  </Button>
                ) : null}
              </Stack>
            </Box>
          ))}
        </Paper>
      )}
    </Stack>
  );
}
