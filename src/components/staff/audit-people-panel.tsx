"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import {
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import { gridNoRowsOverlay } from "@/components/shared/data-grid-empty-overlay";
import { ErrorState } from "@/components/shared/content-state";
import {
  AUDIT_TIME_ZONE,
  AuditEmptyHint,
  DurationText,
  formatAuditDayHeading,
  formatAuditFullTime,
  formatAuditTime,
  formatDuration,
  ResultChip,
  SessionCaveat,
  SessionStatusChip,
} from "@/components/staff/audit-shared";
import { staffApi } from "@/components/staff/staff-api";
import { getAvatarInitials, getAvatarPalette } from "@/lib/default-avatar";
import { gridHeight, gridSx } from "@/lib/data-grid-styles";
import { queryKeys } from "@/lib/query-keys";
import { formatRelativeTime } from "@/lib/relative-time";
import { auditCategoryLabel } from "@/modules/audit/audit-presentation";
import type {
  AuditCategoryKey,
  AuditLogRow,
  AuditPeoplePage,
  AuditPersonActivityRow,
  AuditPersonDetail,
  AuditRange,
} from "@/modules/audit/audit-types";

const noRows = gridNoRowsOverlay("还没有用户活动记录", <GroupOutlinedIcon />);

function PersonCell({ row }: { row: AuditPersonActivityRow }) {
  const palette = getAvatarPalette(row.id || row.name);
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 0 }}>
      <Box sx={{ position: "relative", flexShrink: 0 }}>
        <Avatar
          sx={{
            width: 32,
            height: 32,
            fontSize: 13,
            fontWeight: 650,
            bgcolor: palette.bg,
            color: palette.fg,
          }}
        >
          {getAvatarInitials(row.name)}
        </Avatar>
        {row.isOnline ? (
          <Tooltip title="登录会话仍有效（不代表此刻正在浏览）">
            <Box
              sx={{
                position: "absolute",
                right: -1,
                bottom: -1,
                width: 10,
                height: 10,
                borderRadius: "50%",
                bgcolor: "success.main",
                border: "2px solid",
                borderColor: "background.paper",
              }}
            />
          </Tooltip>
        ) : null}
      </Box>
      <Stack spacing={0.15} sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap sx={{ fontWeight: 550 }}>
          {row.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {row.roleLabel} · {row.email}
        </Typography>
      </Stack>
    </Stack>
  );
}

function TimeOrNever({ iso, label }: { iso: string | null; label: string }) {
  if (!iso) {
    return (
      <Typography variant="caption" color="text.disabled">
        {label}
      </Typography>
    );
  }
  return (
    <Tooltip title={formatAuditFullTime(iso)}>
      <Stack spacing={0.15}>
        <Typography variant="body2" noWrap>
          {formatRelativeTime(iso, undefined, { timeZone: AUDIT_TIME_ZONE })}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {formatAuditTime(iso)}
        </Typography>
      </Stack>
    </Tooltip>
  );
}

export function AuditPeoplePanel({ range }: { range: AuditRange }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"" | "STAFF" | "CUSTOMER">("");
  const [pagination, setPagination] = useState({ page: 0, pageSize: 25 });
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPagination((current) => ({ ...current, page: 0 }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // 时间段变化时保留搜索与人员类型，只把分页拉回第一页
  const rangeKey = `${range.from}|${range.to}`;
  const lastRangeKey = useRef(rangeKey);
  useEffect(() => {
    if (lastRangeKey.current === rangeKey) return;
    lastRangeKey.current = rangeKey;
    setPagination((current) => ({ ...current, page: 0 }));
  }, [rangeKey]);

  const requestQuery = useMemo(() => {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (search) params.set("search", search);
    if (role) params.set("role", role);
    params.set("page", String(pagination.page));
    params.set("pageSize", String(pagination.pageSize));
    return params.toString();
  }, [range.from, range.to, search, role, pagination]);

  const query = useQuery({
    queryKey: queryKeys.auditLogs.people(requestQuery),
    queryFn: () => staffApi<AuditPeoplePage>(`/api/v1/admin/audit-logs/people?${requestQuery}`),
    placeholderData: keepPreviousData,
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const filtersDirty = Boolean(search) || Boolean(role);

  function reset() {
    setSearchInput("");
    setSearch("");
    setRole("");
    setPagination((current) => ({ ...current, page: 0 }));
  }

  const columns = useMemo<GridColDef<AuditPersonActivityRow>[]>(
    () => [
      {
        field: "name",
        headerName: "用户",
        minWidth: 230,
        flex: 1.4,
        sortable: false,
        renderCell: ({ row }) => <PersonCell row={row} />,
      },
      {
        field: "lastActiveAt",
        headerName: "最近操作",
        minWidth: 150,
        flex: 0.9,
        sortable: false,
        renderCell: ({ row }) => (
          <TimeOrNever iso={row.lastActiveAt} label="还没有操作" />
        ),
      },
      {
        field: "lastLoginAt",
        headerName: "最近登录",
        minWidth: 190,
        flex: 1.1,
        sortable: false,
        renderCell: ({ row }) => (
          <Stack spacing={0.15} sx={{ minWidth: 0 }}>
            <TimeOrNever iso={row.lastLoginAt} label="从未登录" />
            {row.lastDevice ? (
              <Typography variant="caption" color="text.secondary" noWrap>
                {row.lastDevice.label}
                {row.lastIpAddress ? ` · ${row.lastIpAddress}` : ""}
              </Typography>
            ) : null}
          </Stack>
        ),
      },
      {
        field: "loginCount",
        headerName: "登录",
        width: 88,
        sortable: false,
        renderCell: ({ row }) => (
          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {row.loginCount} 次
          </Typography>
        ),
      },
      {
        field: "actionCount",
        headerName: "操作",
        width: 88,
        sortable: false,
        renderCell: ({ row }) => (
          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {row.actionCount} 次
          </Typography>
        ),
      },
      {
        field: "totalDurationMs",
        headerName: "停留时长（估算）",
        minWidth: 170,
        flex: 1,
        sortable: false,
        renderCell: ({ row }) => (
          <Stack spacing={0.15}>
            {row.totalDurationMs > 0 ? (
              <DurationText ms={row.totalDurationMs} />
            ) : row.estimatedDurationMs > 0 ? (
              <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                约 {formatDuration(row.estimatedDurationMs)}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.disabled">
                —
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {row.sessionCount === 0
                ? "区间内没有会话"
                : row.avgDurationMs !== null
                  ? `平均 ${formatDuration(row.avgDurationMs)}/次`
                  : row.estimatedDurationMs > 0
                    ? "未正常登出，按最后操作估算"
                    : "没有可判断的会话"}
            </Typography>
          </Stack>
        ),
      },
    ],
    [],
  );

  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2 } }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.25}
          sx={{ alignItems: { xs: "stretch", md: "center" } }}
        >
          <TextField
            label="搜索姓名或邮箱"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            size="small"
            sx={{ flex: { xs: "0 0 auto", md: "1 1 260px" }, minWidth: { xs: 0, md: 200 } }}
          />
          <TextField
            select
            label="人员类型"
            value={role}
            onChange={(event) => {
              setRole(event.target.value as "" | "STAFF" | "CUSTOMER");
              setPagination((current) => ({ ...current, page: 0 }));
            }}
            size="small"
            sx={{ flex: { xs: "0 0 auto", md: "0 1 160px" }, minWidth: { xs: 0, md: 140 } }}
          >
            <MenuItem value="">全部</MenuItem>
            <MenuItem value="STAFF">员工</MenuItem>
            <MenuItem value="CUSTOMER">客户</MenuItem>
          </TextField>
          {filtersDirty ? (
            <Button color="inherit" onClick={reset} sx={{ flexShrink: 0 }}>
              重置
            </Button>
          ) : null}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
          共 {total} 位用户（含区间内没有活动的账号），按最近操作排序。
          统计对象是平台账号；外部联系人的操作可在「操作明细」搜索姓名查看。
          累计停留只计已登出或仍登录中的会话，平均值只统计有明确登出的会话。
        </Typography>
      </Paper>

      {query.isError ? (
        <ErrorState
          message="用户活动加载失败，请稍后重试。"
          onRetry={() => void query.refetch()}
        />
      ) : null}

      <Paper variant="outlined" sx={{ p: 0 }}>
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            py: 1.25,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            共 {total} 位
            {query.isFetching && !query.isPending ? " · 正在刷新" : ""}
          </Typography>
          {query.isFetching && !query.isPending ? <CircularProgress size={14} /> : null}
        </Stack>

        <Box sx={{ width: "100%", display: { xs: "none", md: "block" } }}>
          <DataGrid
            aria-label="用户活动"
            rows={rows}
            columns={columns}
            loading={query.isPending}
            rowCount={total}
            paginationMode="server"
            paginationModel={pagination}
            onPaginationModelChange={setPagination}
            pageSizeOptions={[25, 50, 100]}
            disableColumnFilter
            disableColumnSorting
            disableRowSelectionOnClick
            getRowHeight={() => 72}
            onRowClick={({ row }) => setOpenPersonId(row.id)}
            slots={{ noRowsOverlay: noRows }}
            sx={{
              ...gridSx,
              height: rows.length > 0 ? gridHeight(rows.length, 72) : 420,
              "& .MuiDataGrid-row": { cursor: "pointer" },
            }}
          />
        </Box>

        <Stack sx={{ display: { xs: "flex", md: "none" } }}>
          {query.isPending ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : rows.length === 0 ? (
            <AuditEmptyHint onReset={filtersDirty ? reset : undefined} />
          ) : (
            rows.map((row) => (
              <Stack
                key={row.id}
                component="button"
                onClick={() => setOpenPersonId(row.id)}
                sx={{
                  width: "100%",
                  border: 0,
                  bgcolor: "background.paper",
                  color: "text.primary",
                  textAlign: "left",
                  cursor: "pointer",
                  py: 1.5,
                  px: 2,
                  gap: 0.75,
                  borderBottom: "1px solid",
                  borderColor: "divider",
                  "&:last-child": { borderBottom: 0 },
                }}
              >
                <PersonCell row={row} />
                <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 0.75 }}>
                  <Chip size="small" variant="outlined" label={`登录 ${row.loginCount} 次`} />
                  <Chip size="small" variant="outlined" label={`操作 ${row.actionCount} 次`} />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`停留 ${formatDuration(row.totalDurationMs)}`}
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  最近登录：
                  {row.lastLoginAt ? formatAuditTime(row.lastLoginAt) : "从未登录"}
                  {row.isOnline ? " · 登录中" : ""}
                </Typography>
              </Stack>
            ))
          )}

          {rows.length > 0 ? (
            <Stack
              direction="row"
              sx={{
                justifyContent: "space-between",
                alignItems: "center",
                px: 2,
                py: 1,
                borderTop: "1px solid",
                borderColor: "divider",
              }}
            >
              <Button
                size="small"
                disabled={pagination.page === 0}
                onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
              >
                上一页
              </Button>
              <Typography variant="caption" color="text.secondary">
                {pagination.page + 1} / {Math.max(1, Math.ceil(total / pagination.pageSize))}
              </Typography>
              <Button
                size="small"
                disabled={(pagination.page + 1) * pagination.pageSize >= total}
                onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
              >
                下一页
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </Paper>

      <AuditPersonDrawer
        key={`${openPersonId ?? "closed"}-${range.from}-${range.to}`}
        personId={openPersonId}
        range={range}
        onClose={() => setOpenPersonId(null)}
      />
    </Stack>
  );
}

function StatBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, flex: "1 1 120px", minWidth: 0 }}>
      <Typography variant="h3">{value}</Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Paper>
  );
}

function AuditPersonDrawer({
  personId,
  range,
  onClose,
}: {
  personId: string | null;
  range: AuditRange;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<AuditCategoryKey | "">("");

  const detailQuery = useInfiniteQuery({
    queryKey: queryKeys.auditLogs.person(
      personId ?? "",
      `${range.from}|${range.to}|${category}`,
    ),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
        page: String(pageParam),
        pageSize: "25",
      });
      if (category) params.set("category", category);
      return staffApi<AuditPersonDetail>(
        `/api/v1/admin/audit-logs/people/${encodeURIComponent(personId ?? "")}?${params.toString()}`,
      );
    },
    initialPageParam: 0,
    getNextPageParam: (last) => {
      const loaded =
        last.timeline.page * last.timeline.pageSize + last.timeline.rows.length;
      return last.timeline.rows.length > 0 && loaded < last.timeline.total
        ? last.timeline.page + 1
        : undefined;
    },
    enabled: Boolean(personId),
  });

  const detail = detailQuery.data?.pages[0] ?? null;
  const timeline = useMemo(() => {
    const rows: AuditLogRow[] = [];
    const seen = new Set<string>();
    for (const page of detailQuery.data?.pages ?? []) {
      for (const row of page.timeline.rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push(row);
      }
    }
    return rows;
  }, [detailQuery.data]);

  const grouped = useMemo(() => {
    const groups: Array<{ day: string; rows: AuditLogRow[] }> = [];
    for (const row of timeline) {
      const day = formatAuditDayHeading(row.createdAt);
      const last = groups[groups.length - 1];
      if (last?.day === day) last.rows.push(row);
      else groups.push({ day, rows: [row] });
    }
    return groups;
  }, [timeline]);

  return (
    <Drawer
      anchor="right"
      open={Boolean(personId)}
      onClose={onClose}
      slotProps={{
        paper: { sx: { width: { xs: "100%", sm: 640 }, maxWidth: "100%" } },
      }}
    >
      <Stack sx={{ height: "100%" }}>
        <Stack
          direction="row"
          sx={{ alignItems: "flex-start", justifyContent: "space-between", px: 2.5, py: 1.75 }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h3" noWrap>
              {detail?.person.name ?? "用户活动"}
            </Typography>
            {detail ? (
              <Typography variant="caption" color="text.secondary">
                {detail.person.roleLabel} · {detail.person.email}
              </Typography>
            ) : null}
          </Box>
          <IconButton aria-label="关闭用户活动" onClick={onClose}>
            <CloseOutlinedIcon />
          </IconButton>
        </Stack>
        <Divider />
        <Box sx={{ flex: 1, overflowY: "auto", p: 2.5 }}>
          {detailQuery.isPending && personId ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
              <CircularProgress />
            </Box>
          ) : detailQuery.isError ? (
            <ErrorState
              message="用户活动加载失败，请稍后重试。"
              onRetry={() => void detailQuery.refetch()}
            />
          ) : detail ? (
            <Stack spacing={2.75}>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
                {detail.person.isOnline ? (
                  <Chip size="small" color="success" variant="outlined" label="登录中" />
                ) : null}
                <Chip
                  size="small"
                  variant="outlined"
                  label={`最近登录：${
                    detail.person.lastLoginAt
                      ? formatAuditTime(detail.person.lastLoginAt)
                      : "从未登录"
                  }`}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={`最近操作：${
                    detail.person.lastActiveAt
                      ? formatRelativeTime(detail.person.lastActiveAt, undefined, {
                          timeZone: AUDIT_TIME_ZONE,
                        })
                      : "还没有"
                  }`}
                />
              </Stack>

              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                <StatBox label="登录次数" value={detail.totals.loginCount} />
                <StatBox label="操作次数" value={detail.totals.actionCount} />
                <StatBox label="会话数" value={detail.totals.sessionCount} />
                <StatBox
                  label="累计停留"
                  value={formatDuration(detail.totals.totalDurationMs)}
                />
                <StatBox
                  label="平均每次"
                  value={formatDuration(detail.totals.avgDurationMs)}
                />
                {detail.totals.estimatedDurationMs > 0 ? (
                  <StatBox
                    label="未登出（估算）"
                    value={`约 ${formatDuration(detail.totals.estimatedDurationMs)}`}
                  />
                ) : null}
              </Stack>
              <SessionCaveat>
                统计数字按所选区间截取；下方会话列表展示每次登录的完整起止时间。
                累计停留只计已登出与仍登录中的会话，平均值只统计有明确登出的会话。
              </SessionCaveat>

              {detail.currentSessions.length > 0 ? (
                <Box>
                  <Typography variant="h3" sx={{ mb: 1 }}>
                    当前登录会话
                  </Typography>
                  <Stack spacing={1}>
                    {detail.currentSessions.map((session) => (
                      <Paper key={session.sessionId} variant="outlined" sx={{ p: 1.5 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                          <Chip size="small" color="primary" variant="outlined" label="登录中" />
                          <Typography variant="body2">
                            {session.device.label}
                            {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                          </Typography>
                          <Box sx={{ flex: 1 }} />
                          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                            已登录 {formatDuration(session.durationMs)}
                          </Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          开始于 {formatAuditFullTime(session.startedAt)}
                        </Typography>
                      </Paper>
                    ))}
                  </Stack>
                </Box>
              ) : null}

              <Box>
                <Stack
                  direction="row"
                  sx={{ justifyContent: "space-between", alignItems: "baseline", mb: 1 }}
                >
                  <Typography variant="h3">登录会话</Typography>
                  <Typography variant="caption" color="text.secondary">
                    共 {detail.sessions.length} 次
                  </Typography>
                </Stack>
                {detail.sessions.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    统计区间内没有登录记录。
                  </Typography>
                ) : (
                  <Stack
                    divider={<Divider flexItem />}
                    sx={{
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 2,
                      maxHeight: 360,
                      overflowY: "auto",
                    }}
                  >
                    {detail.sessions.map((session) => (
                      <Stack key={session.key} spacing={0.75} sx={{ px: 1.5, py: 1.25 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                            {formatAuditTime(session.startedAt)}
                            {" → "}
                            {session.endedAt ? formatAuditTime(session.endedAt) : "未结束"}
                          </Typography>
                          <Box sx={{ flex: 1 }} />
                          <SessionStatusChip
                            reason={session.endReason}
                            label={session.endReasonLabel}
                          />
                          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
                            {formatDuration(session.durationMs)}
                          </Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          {session.device.label}
                          {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                          {session.loginMethod ? ` · ${session.loginMethod}` : ""}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>

              <Box>
                <Stack
                  direction="row"
                  sx={{ justifyContent: "space-between", alignItems: "baseline", mb: 1 }}
                >
                  <Typography variant="h3">活动轨迹</Typography>
                  <Typography variant="caption" color="text.secondary">
                    共 {detail.timeline.total} 条
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", gap: 0.75, mb: 1.5 }}>
                  <Chip
                    size="small"
                    label="全部"
                    color={category ? "default" : "primary"}
                    variant={category ? "outlined" : "filled"}
                    onClick={() => setCategory("")}
                  />
                  {detail.breakdown.map((item) => (
                    <Chip
                      key={item.category}
                      size="small"
                      label={`${auditCategoryLabel(item.category)} ${item.count}`}
                      color={category === item.category ? "primary" : "default"}
                      variant={category === item.category ? "filled" : "outlined"}
                      onClick={() => setCategory(item.category)}
                    />
                  ))}
                </Stack>

                {grouped.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    没有符合条件的活动。
                  </Typography>
                ) : (
                  <Stack spacing={2}>
                    {grouped.map((group) => (
                      <Box key={group.day}>
                        <Typography
                          variant="subtitle2"
                          color="text.secondary"
                          sx={{ mb: 0.75, position: "sticky", top: 0, bgcolor: "background.paper", py: 0.5 }}
                        >
                          {group.day}
                        </Typography>
                        <Stack divider={<Divider flexItem />} sx={{ borderLeft: "2px solid", borderColor: "divider", pl: 1.5 }}>
                          {group.rows.map((row) => (
                            <Stack key={row.id} spacing={0.5} sx={{ py: 1, minWidth: 0 }}>
                              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
                                >
                                  {formatAuditTime(row.createdAt).slice(-5)}
                                </Typography>
                                <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                                  {row.summary}
                                </Typography>
                                <ResultChip result={row.result} label={row.resultLabel} />
                              </Stack>
                              {row.object ? (
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {row.object.typeLabel} · {row.object.label}
                                </Typography>
                              ) : null}
                            </Stack>
                          ))}
                        </Stack>
                      </Box>
                    ))}
                  </Stack>
                )}

                {timeline.length < detail.timeline.total ? (
                  <Button
                    fullWidth
                    variant="outlined"
                    sx={{ mt: 1.5 }}
                    disabled={detailQuery.isFetchingNextPage}
                    onClick={() => void detailQuery.fetchNextPage()}
                  >
                    {detailQuery.isFetchingNextPage ? "加载中…" : "加载更多"}
                  </Button>
                ) : null}
              </Box>
            </Stack>
          ) : null}
        </Box>
      </Stack>
    </Drawer>
  );
}
