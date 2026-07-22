"use client";

import { useState, type MouseEvent } from "react";
import {
  Box,
  Button,
  MenuItem,
  Popover,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import FilterListOutlinedIcon from "@mui/icons-material/FilterListOutlined";
import type { RequestAdvancedFilterValue } from "@/components/staff/request-table-filters";

type FilterOption = { value: string; label: string };

export function RequestAdvancedFilters({
  value,
  onChange,
  categories,
  serviceTypes,
  assignees,
}: {
  value: RequestAdvancedFilterValue;
  onChange: (value: RequestAdvancedFilterValue) => void;
  categories: string[];
  serviceTypes: string[];
  assignees: FilterOption[];
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const activeCount = Object.values(value).filter(
    (item) => item !== "ALL",
  ).length;

  const update = <Key extends keyof RequestAdvancedFilterValue>(
    key: Key,
    nextValue: RequestAdvancedFilterValue[Key],
  ) => onChange({ ...value, [key]: nextValue });

  const reset = () =>
    onChange({
      priority: "ALL",
      category: "ALL",
      serviceType: "ALL",
      assignee: "ALL",
      source: "ALL",
    });

  return (
    <>
      <Button
        variant="outlined"
        color={activeCount > 0 ? "primary" : "inherit"}
        startIcon={<FilterListOutlinedIcon />}
        onClick={(event: MouseEvent<HTMLButtonElement>) =>
          setAnchor(event.currentTarget)
        }
        sx={{ whiteSpace: "nowrap" }}
      >
        更多筛选{activeCount > 0 ? `（${activeCount}）` : ""}
      </Button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              width: 360,
              maxWidth: "calc(100vw - 32px)",
              mt: 1,
              p: 2.5,
            },
          },
        }}
      >
        <Stack spacing={2}>
          <Typography variant="h3">更多筛选</Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: 1.5,
            }}
          >
            <TextField
              select
              label="优先级"
              value={value.priority}
              onChange={(event) =>
                update(
                  "priority",
                  event.target.value as RequestAdvancedFilterValue["priority"],
                )
              }
            >
              <MenuItem value="ALL">全部优先级</MenuItem>
              <MenuItem value="URGENT">紧急</MenuItem>
              <MenuItem value="HIGH">高</MenuItem>
              <MenuItem value="NORMAL">普通</MenuItem>
              <MenuItem value="LOW">低</MenuItem>
            </TextField>
            <TextField
              select
              label="来源"
              value={value.source}
              onChange={(event) =>
                update(
                  "source",
                  event.target.value as RequestAdvancedFilterValue["source"],
                )
              }
            >
              <MenuItem value="ALL">全部来源</MenuItem>
              <MenuItem value="ACHORD">主站</MenuItem>
              <MenuItem value="SUB2API">Sub2API</MenuItem>
              <MenuItem value="UNIVERSAL">Achord Connect</MenuItem>
            </TextField>
            <TextField
              select
              label="服务类型"
              value={value.serviceType}
              onChange={(event) => update("serviceType", event.target.value)}
            >
              <MenuItem value="ALL">全部服务类型</MenuItem>
              {serviceTypes.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="请求分类"
              value={value.category}
              onChange={(event) => update("category", event.target.value)}
            >
              <MenuItem value="ALL">全部分类</MenuItem>
              {categories.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <TextField
            select
            label="处理人"
            value={value.assignee}
            onChange={(event) => update("assignee", event.target.value)}
          >
            <MenuItem value="ALL">全部处理人</MenuItem>
            <MenuItem value="UNASSIGNED">待分配</MenuItem>
            {assignees.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
            <Button onClick={reset} disabled={activeCount === 0}>
              清除筛选
            </Button>
            <Button variant="contained" onClick={() => setAnchor(null)}>
              完成
            </Button>
          </Stack>
        </Stack>
      </Popover>
    </>
  );
}
