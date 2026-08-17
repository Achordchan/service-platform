"use client";

import Link from "next/link";
import { List, ListItemButton, ListItemText, Stack, Typography } from "@mui/material";
import ChevronRightOutlinedIcon from "@mui/icons-material/ChevronRightOutlined";
import { StatusIndicator, statusLabel } from "@/components/shared/status-indicator";
import type { ProjectStatus } from "@/components/customer/customer-types";

export type RecentProjectItem = {
  id: string;
  title: string;
  subtitle: string;
  status: ProjectStatus;
  updatedAt: string;
  href: string;
};

export function RecentProjectsList({ items }: { items: RecentProjectItem[] }) {
  return (
    <List sx={{ py: 0 }}>
      {items.map((item) => (
        <ListItemButton
          key={item.id}
          component={Link}
          href={item.href}
          aria-label={`${item.title}，${statusLabel(item.status)}`}
          sx={{
            borderRadius: 1.5,
            my: 0.5,
            px: 2,
            py: 1.25,
            border: "1px solid",
            borderColor: "divider",
          }}
        >
          <ListItemText
            primary={
              <Typography sx={{ fontWeight: 650 }} noWrap>
                {item.title}
              </Typography>
            }
            secondary={
              <Typography variant="body2" color="text.secondary" noWrap>
                {item.subtitle} · {new Date(item.updatedAt).toLocaleDateString("zh-CN")}
              </Typography>
            }
          />
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ alignItems: "center", flex: "0 0 auto", ml: 2 }}
          >
            <StatusIndicator status={item.status} compact />
            <ChevronRightOutlinedIcon fontSize="small" sx={{ color: "text.disabled" }} />
          </Stack>
        </ListItemButton>
      ))}
    </List>
  );
}
