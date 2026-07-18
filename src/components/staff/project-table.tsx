"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Button,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  Chip,
} from "@mui/material";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import FilterAltOffOutlinedIcon from "@mui/icons-material/FilterAltOffOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { DeletionPreflightDialog } from "@/components/shared/deletion-preflight-dialog";
import { CreateProjectDialog } from "@/components/staff/create-project-dialog";
import { StaffStatus } from "@/components/staff/staff-status";
import type {
  ProjectListItem,
  ProjectOption,
  ProjectStatus,
  StaffCandidate,
} from "@/components/staff/staff-types";

const projectStatusOptions: Array<{ value: ProjectStatus; label: string }> = [
  { value: "DRAFT", label: "草稿" },
  { value: "ACTIVE", label: "进行中" },
  { value: "PAUSED", label: "已暂停" },
  { value: "COMPLETED", label: "已完成" },
  { value: "EXPIRED", label: "已到期" },
];

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatDate(value?: string | null) {
  return value ? dateFormatter.format(new Date(value)) : "未设置";
}

export function ProjectTable({
  projects,
  canCreate,
  customerSpaces = [],
  serviceTypes = [],
  managerCandidates = [],
  currentUserId = "",
  externalConnectors = [],
}: {
  projects: ProjectListItem[];
  canCreate: boolean;
  customerSpaces?: ProjectOption[];
  serviceTypes?: ProjectOption[];
  managerCandidates?: StaffCandidate[];
  currentUserId?: string;
  externalConnectors?: ProjectOption[];
}) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("ALL");
  const [serviceTypeId, setServiceTypeId] = useState("ALL");
  const [kind, setKind] = useState("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<ProjectListItem | null>(null);
  const serviceOptions = useMemo(
    () =>
      Array.from(
        new Map(
          projects.map((project) => [
            project.serviceType.id,
            project.serviceType,
          ]),
        ).values(),
      ),
    [projects],
  );
  const rows = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return projects.filter(
      (project) =>
        (status === "ALL" || project.status === status) &&
        (serviceTypeId === "ALL" ||
          project.serviceType.id === serviceTypeId) &&
        (kind === "ALL" || project.kind === kind) &&
        (!normalized ||
          project.title.toLowerCase().includes(normalized) ||
          project.customerSpace.name.toLowerCase().includes(normalized)),
    );
  }, [keyword, kind, projects, serviceTypeId, status]);

  const columns = useMemo<GridColDef<ProjectListItem>[]>(
    () => [
      {
        field: "title",
        headerName: "项目",
        minWidth: 170,
        flex: 1.3,
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
            <Typography variant="body2" noWrap>{row.title}</Typography>
            {row.kind === "EXTERNAL_INTEGRATION" ? (
              <Chip label="外部接入" size="small" variant="outlined" />
            ) : null}
          </Stack>
        ),
      },
      {
        field: "customer",
        headerName: "客户",
        minWidth: 105,
        flex: 0.8,
        renderCell: ({ row }) =>
          row.kind === "EXTERNAL_INTEGRATION"
            ? `${row.externalConnectorLabel ?? "外部接入"} 用户`
            : row.customerSpace.name,
      },
      {
        field: "serviceType",
        headerName: "服务类型",
        minWidth: 110,
        flex: 0.8,
        renderCell: ({ row }) => row.serviceType.name,
      },
      {
        field: "currentStage",
        headerName: "当前阶段",
        minWidth: 105,
        flex: 0.8,
        renderCell: ({ row }) => row.currentStage || "待确认",
      },
      {
        field: "progress",
        headerName: "整体进度",
        minWidth: 145,
        flex: 1,
        display: "flex",
        renderCell: ({ row }) =>
          row.showProgress === false ? (
            <Typography variant="body2" color="text.secondary">
              —
            </Typography>
          ) : (
            <Stack direction="row" spacing={1.5} sx={{ width: "100%", alignItems: "center" }}>
              <LinearProgress
                variant="determinate"
                value={row.progress}
                sx={{ flex: 1, height: 5, borderRadius: 4 }}
              />
              <Typography variant="body2" color="text.secondary">
                {row.progress}%
              </Typography>
            </Stack>
          ),
      },
      {
        field: "manager",
        headerName: "项目负责人",
        minWidth: 115,
        flex: 0.8,
        renderCell: ({ row }) => row.managerNames.join("、") || "未分配",
      },
      {
        field: "period",
        headerName: "服务周期",
        minWidth: 175,
        flex: 1,
        renderCell: ({ row }) =>
          `${formatDate(row.startDate)} — ${formatDate(row.endDate)}`,
      },
      {
        field: "status",
        headerName: "状态",
        minWidth: 95,
        renderCell: ({ row }) => <StaffStatus value={row.status} compact />,
      },
      {
        field: "actions",
        headerName: "操作",
        sortable: false,
        filterable: false,
        minWidth: 170,
        display: "flex",
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={0.5}>
            <Button
              size="small"
              startIcon={<EditOutlinedIcon />}
              onClick={(event) => {
                event.stopPropagation();
                router.push(`/staff/projects/${row.id}`);
              }}
            >
              管理
            </Button>
            {canCreate ? (
              <Button
                size="small"
                color="inherit"
                startIcon={<DeleteOutlinedIcon />}
                onClick={(event) => {
                  event.stopPropagation();
                  setDeleteTarget(row);
                }}
              >
                删除
              </Button>
            ) : null}
          </Stack>
        ),
      },
    ],
    [canCreate, router],
  );

  function resetFilters() {
    setKeyword("");
    setStatus("ALL");
    setServiceTypeId("ALL");
    setKind("ALL");
  }

  return (
    <Stack spacing={2}>
      {error ? (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}
      <Paper variant="outlined" sx={{ p: { xs: 1.5, md: 2 } }}>
        <Stack
          direction={{ xs: "column", lg: "row" }}
          spacing={1.5}
          sx={{ alignItems: { lg: "center" } }}
        >
          <TextField
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索客户或项目"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlinedIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ width: { xs: "100%", lg: 280 }, flex: { lg: "0 0 280px" } }}
          />
          <TextField
            select
            label="项目状态"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            sx={{ minWidth: { lg: 150 }, width: { xs: "100%", lg: 150 } }}
          >
            <MenuItem value="ALL">全部状态</MenuItem>
            {projectStatusOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="项目类型"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            sx={{ minWidth: { lg: 140 }, width: { xs: "100%", lg: 140 } }}
          >
            <MenuItem value="ALL">全部类型</MenuItem>
            <MenuItem value="STANDARD">标准项目</MenuItem>
            <MenuItem value="EXTERNAL_INTEGRATION">外部接入</MenuItem>
          </TextField>
          <TextField
            select
            label="服务类型"
            value={serviceTypeId}
            onChange={(event) => setServiceTypeId(event.target.value)}
            sx={{ minWidth: { lg: 150 }, width: { xs: "100%", lg: 150 } }}
          >
            <MenuItem value="ALL">全部类型</MenuItem>
            {serviceOptions.map((option) => (
              <MenuItem key={option.id} value={option.id}>
                {option.name}
              </MenuItem>
            ))}
          </TextField>
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<FilterAltOffOutlinedIcon />}
            onClick={resetFilters}
            sx={{ whiteSpace: "nowrap" }}
          >
            重置
          </Button>
          <Box sx={{ flex: 1, display: { xs: "none", lg: "block" } }} />
          {canCreate ? (
            <Button
              variant="contained"
              startIcon={<AddOutlinedIcon />}
              onClick={() => setCreateOpen(true)}
              sx={{ whiteSpace: "nowrap", alignSelf: { xs: "stretch", lg: "center" } }}
            >
              新建项目
            </Button>
          ) : null}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <Box
          sx={{
            display: { xs: "none", md: "block" },
            width: "100%",
            minHeight: 520,
            height: { md: "min(70vh, 720px)" },
          }}
        >
          <DataGrid
            rows={rows}
            columns={columns}
            onRowClick={({ row }) => router.push(`/staff/projects/${row.id}`)}
            pageSizeOptions={[10, 20, 50]}
            initialState={{
              pagination: { paginationModel: { pageSize: 10, page: 0 } },
            }}
            disableRowSelectionOnClick
            sx={{
              border: 0,
              height: "100%",
              "& .MuiDataGrid-columnHeaders": { borderBottomColor: "divider" },
              "& .MuiDataGrid-cell": { display: "flex", alignItems: "center" },
              "& .MuiDataGrid-row": { cursor: "pointer" },
              "& .MuiDataGrid-footerContainer": { borderTopColor: "divider" },
            }}
          />
        </Box>
        <Stack sx={{ display: { xs: "flex", md: "none" } }}>
          {rows.map((project) => (
            <Stack
              key={project.id}
              spacing={1.25}
              sx={{
                width: "100%",
                p: 2,
                borderBottom: "1px solid",
                borderColor: "divider",
                bgcolor: "background.paper",
                color: "text.primary",
                textAlign: "left",
                "&:last-child": { borderBottom: 0 },
              }}
            >
              <Stack
                component="button"
                type="button"
                spacing={1.25}
                onClick={() => router.push(`/staff/projects/${project.id}`)}
                sx={{
                  width: "100%",
                  p: 0,
                  border: 0,
                  bgcolor: "transparent",
                  color: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
                  <Typography sx={{ fontWeight: 650 }}>{project.title}</Typography>
                  <StaffStatus value={project.status} compact />
                </Stack>
                {project.kind === "EXTERNAL_INTEGRATION" ? (
                  <Chip label="外部接入" size="small" variant="outlined" sx={{ alignSelf: "flex-start" }} />
                ) : null}
                <Typography variant="body2" color="text.secondary">
                  {project.kind === "EXTERNAL_INTEGRATION"
                    ? `${project.externalConnectorLabel ?? "外部接入"} 用户`
                    : project.customerSpace.name} · {project.serviceType.name}
                </Typography>
                {project.showProgress !== false ? (
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                    <LinearProgress
                      variant="determinate"
                      value={project.progress}
                      sx={{ flex: 1, height: 5, borderRadius: 4 }}
                    />
                    <Typography variant="body2">{project.progress}%</Typography>
                  </Stack>
                ) : null}
              </Stack>
              {canCreate ? (
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<EditOutlinedIcon />}
                    onClick={() => router.push(`/staff/projects/${project.id}`)}
                  >
                    管理
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="inherit"
                    startIcon={<DeleteOutlinedIcon />}
                    onClick={() => setDeleteTarget(project)}
                  >
                    删除
                  </Button>
                </Stack>
              ) : null}
            </Stack>
          ))}
          {rows.length === 0 ? (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography color="text.secondary">没有符合条件的项目</Typography>
            </Box>
          ) : null}
        </Stack>
      </Paper>

      <CreateProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        customerSpaces={customerSpaces}
        serviceTypes={serviceTypes}
        managerCandidates={managerCandidates}
        currentUserId={currentUserId}
        externalConnectors={externalConnectors}
      />
      <DeletionPreflightDialog
        target={
          deleteTarget
            ? {
                resourceType: "PROJECT",
                resourceId: deleteTarget.id,
                resourceLabel: deleteTarget.title,
              }
            : null
        }
        deleteUrl={
          deleteTarget ? `/api/v1/projects/${deleteTarget.id}` : null
        }
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          setDeleteTarget(null);
          setError("");
          router.refresh();
        }}
      />
    </Stack>
  );
}
