"use client";

import { useState } from "react";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";

export type AccountSettingsSection = {
  key: string;
  label: string;
  description?: string;
  content: React.ReactNode;
};

/**
 * 设置页布局（GitHub/Stripe 模式）：左侧分组导航 + 右侧仅渲染当前分组，
 * 页面长度恒等于单组内容。移动端导航退化为顶部横向标签。
 */
export function AccountSettingsLayout({
  initialSection,
  sections,
}: {
  initialSection?: string;
  sections: AccountSettingsSection[];
}) {
  const validInitial = sections.some((section) => section.key === initialSection)
    ? (initialSection as string)
    : sections[0]?.key;
  const [active, setActive] = useState(validInitial);
  const current =
    sections.find((section) => section.key === active) ?? sections[0];

  function selectSection(key: string) {
    setActive(key);
    // 同步到 URL（无导航），刷新/分享可回到当前分组
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("section", key);
      window.history.replaceState(null, "", url);
    } catch {
      // 忽略异常环境
    }
  }

  return (
    <Stack spacing={3}>
      {/* 移动端：顶部标签 */}
      <Box sx={{ display: { xs: "block", md: "none" }, mx: -3 }}>
        <Tabs
          value={active}
          variant="fullWidth"
          onChange={(_, key: string) => selectSection(key)}
        >
          {sections.map((section) => (
            <Tab key={section.key} value={section.key} label={section.label} />
          ))}
        </Tabs>
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "220px minmax(0, 1fr)" },
          gap: 4,
          alignItems: "start",
        }}
      >
        {/* 桌面端：左侧导航 */}
        <Box sx={{ display: { xs: "none", md: "block" } }}>
          <List
            disablePadding
            sx={{
              position: "sticky",
              top: 24,
              borderRight: "1px solid",
              borderColor: "divider",
            }}
          >
            {sections.map((section) => (
              <ListItemButton
                key={section.key}
                selected={section.key === active}
                onClick={() => selectSection(section.key)}
                sx={{ borderRadius: 1, mb: 0.25 }}
              >
                <ListItemText
                  primary={section.label}
                  slotProps={{
                    primary: {
                      sx: {
                        fontSize: 14,
                        fontWeight: section.key === active ? 650 : 400,
                      },
                    },
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        </Box>

        {/* 右侧：当前分组 */}
        <Stack key={current?.key} spacing={1.5}>
          <Stack spacing={0.25}>
            <Typography sx={{ fontWeight: 650, fontSize: 16 }}>
              {current?.label}
            </Typography>
            {current?.description ? (
              <Typography variant="body2" color="text.secondary">
                {current.description}
              </Typography>
            ) : null}
          </Stack>
          <Box>{current?.content}</Box>
        </Stack>
      </Box>
    </Stack>
  );
}
