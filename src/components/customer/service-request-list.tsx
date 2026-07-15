"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Box,
  Button,
  InputAdornment,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import type {
  RequestStatus,
  ServiceRequestSummary,
} from "@/components/customer/customer-types";
import { ServiceRequestTable } from "@/components/customer/service-request-table";
import { EmptyState } from "@/components/shared/content-state";
import { TabBadgeLabel } from "@/components/shared/tab-badge-label";
import {
  countRequestStatusUnread,
  useUnreadNotifications,
} from "@/hooks/use-unread-notifications";

type StatusFilter = "ALL" | RequestStatus;

const filters: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "全部" },
  { value: "PENDING", label: "待处理" },
  { value: "IN_PROGRESS", label: "处理中" },
  { value: "WAITING_CUSTOMER", label: "等待客户" },
  { value: "RESOLVED", label: "已解决" },
  { value: "CLOSED", label: "已关闭" },
];

export function ServiceRequestList({
  requests,
  projectId,
  showHeading = false,
}: {
  requests: ServiceRequestSummary[];
  projectId?: string;
  showHeading?: boolean;
}) {
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [keyword, setKeyword] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("ALL");
  const scopedToProject = Boolean(projectId);
  const { unread } = useUnreadNotifications();
  const createHref = projectId
    ? `/customer/requests/new?projectId=${projectId}`
    : "/customer/requests/new";

  const projectOptions = useMemo(
    () =>
      Array.from(
        new Map(
          requests.map((request) => [
            request.projectId,
            { id: request.projectId, title: request.projectTitle },
          ]),
        ).values(),
      ),
    [requests],
  );

  const filtered = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return requests.filter((request) => {
      const matchesStatus = status === "ALL" || request.status === status;
      const matchesProject =
        scopedToProject ||
        selectedProjectId === "ALL" ||
        request.projectId === selectedProjectId;
      const matchesKeyword =
        !normalizedKeyword ||
        request.number.toLowerCase().includes(normalizedKeyword) ||
        request.title.toLowerCase().includes(normalizedKeyword) ||
        request.category.name.toLowerCase().includes(normalizedKeyword) ||
        request.projectTitle.toLowerCase().includes(normalizedKeyword);
      return matchesStatus && matchesProject && matchesKeyword;
    });
  }, [keyword, requests, scopedToProject, selectedProjectId, status]);

  return (
    <Stack spacing={2.5}>
      {showHeading ? (
        <Box>
          <Typography variant="h1">服务请求</Typography>
        </Box>
      ) : null}

      <Stack
        direction={{ xs: "column", lg: "row" }}
        spacing={2}
        sx={{
          borderBottom: "1px solid",
          borderColor: "divider",
          alignItems: { xs: "stretch", lg: "flex-end" },
          justifyContent: "space-between",
        }}
      >
        <Tabs
          value={status}
          onChange={(_, value: StatusFilter) => setStatus(value)}
          variant="scrollable"
          scrollButtons={false}
          sx={{
            minWidth: 0,
            "& .MuiTab-root": { minWidth: 86, px: 1.5 },
          }}
        >
          {filters.map((filter) => (
            <Tab
              key={filter.value}
              value={filter.value}
              label={
                <TabBadgeLabel
                  label={filter.label}
                  count={countRequestStatusUnread(
                    unread,
                    requests.map((item) => ({
                      id: item.id,
                      status: item.status,
                      projectId: item.projectId,
                    })),
                    filter.value,
                    projectId,
                  )}
                />
              }
            />
          ))}
        </Tabs>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ pb: 1, alignItems: { sm: "center" } }}
        >
          {!scopedToProject && projectOptions.length > 1 ? (
            <TextField
              select
              label="所属项目"
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              sx={{ minWidth: { sm: 180 } }}
            >
              <MenuItem value="ALL">全部项目</MenuItem>
              {projectOptions.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {option.title}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <TextField
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索编号、标题、分类或项目"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlinedIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ width: { xs: "100%", sm: 300 } }}
          />
          <Button
            component={Link}
            href={createHref}
            variant="contained"
            startIcon={<AddOutlinedIcon />}
            sx={{
              alignSelf: { xs: "stretch", sm: "center" },
              whiteSpace: "nowrap",
            }}
          >
            新建服务请求
          </Button>
        </Stack>
      </Stack>

      {filtered.length > 0 ? (
        <ServiceRequestTable
          requests={filtered}
          hideProjectColumn={scopedToProject}
        />
      ) : (
        <EmptyState
          title="未找到服务请求"
          description="调整筛选条件后重试。"
        />
      )}
      <Typography variant="body2" color="text.secondary">
        共 {filtered.length} 条
      </Typography>
    </Stack>
  );
}
