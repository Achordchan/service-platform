"use client";

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ArrowForwardOutlinedIcon from "@mui/icons-material/ArrowForwardOutlined";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import {
  ActorIdentity,
  CopyButton,
  DeviceLine,
  formatAuditFullTime,
  ResultChip,
} from "@/components/staff/audit-shared";
import type { AuditLogRow } from "@/modules/audit/audit-types";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="h3" sx={{ mb: 1 }}>
      {children}
    </Typography>
  );
}

function DetailRow({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  copyable?: boolean;
}) {
  if (!value) return null;
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "flex-start" }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          {label}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            mt: 0.25,
            overflowWrap: "anywhere",
            ...(mono ? { fontFamily: "ui-monospace, monospace", fontSize: 12.5 } : {}),
          }}
        >
          {value}
        </Typography>
      </Box>
      {copyable ? <CopyButton value={value} label={`复制${label}`} /> : null}
    </Stack>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary">
        {title}
      </Typography>
      <Box
        component="pre"
        sx={{
          mt: 0.75,
          p: 1.5,
          m: 0,
          borderRadius: 1.5,
          bgcolor: "action.hover",
          fontSize: 12,
          maxHeight: 320,
          overflow: "auto",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {JSON.stringify(value ?? null, null, 2)}
      </Box>
    </Box>
  );
}

/** 对象名能链接到业务页就直接给入口，避免管理员再去搜一遍。 */
function ObjectBlock({
  object,
  scope,
}: {
  object: AuditLogRow["object"];
  scope: AuditLogRow["scope"];
}) {
  if (!object && !scope) {
    return (
      <Typography variant="body2" color="text.secondary">
        这次操作没有关联具体对象。
      </Typography>
    );
  }
  return (
    <Stack spacing={1}>
      {object ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Chip size="small" variant="outlined" label={object.typeLabel} />
          {object.href ? (
            <Typography
              component="a"
              href={object.href}
              variant="body2"
              sx={{ color: "primary.main", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
            >
              {object.label}
            </Typography>
          ) : (
            <Typography variant="body2">{object.label}</Typography>
          )}
        </Stack>
      ) : null}
      {scope && scope.label !== object?.label ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="caption" color="text.secondary">
            所属{scope.typeLabel}
          </Typography>
          {scope.href ? (
            <Typography
              component="a"
              href={scope.href}
              variant="body2"
              sx={{ color: "primary.main", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
            >
              {scope.label}
            </Typography>
          ) : (
            <Typography variant="body2">{scope.label}</Typography>
          )}
        </Stack>
      ) : null}
    </Stack>
  );
}

export function AuditEventDetailDrawer({
  row,
  onClose,
}: {
  row: AuditLogRow | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      anchor="right"
      open={Boolean(row)}
      onClose={onClose}
      slotProps={{
        paper: { sx: { width: { xs: "100%", sm: 560 }, maxWidth: "100%" } },
      }}
    >
      {row ? (
        <Stack sx={{ height: "100%" }}>
          <Stack
            direction="row"
            sx={{ alignItems: "flex-start", justifyContent: "space-between", px: 2.5, py: 1.75 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h3" noWrap>
                {row.actionLabel}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatAuditFullTime(row.createdAt)}
              </Typography>
            </Box>
            <IconButton aria-label="关闭详情" onClick={onClose} sx={{ ml: 1 }}>
              <CloseOutlinedIcon />
            </IconButton>
          </Stack>
          <Divider />
          <Box sx={{ flex: 1, overflowY: "auto", p: 2.5 }}>
            <Stack spacing={2.75}>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: "action.hover" }}>
                <Typography variant="body1" sx={{ lineHeight: 1.7 }}>
                  <Box component="span" sx={{ fontWeight: 700 }}>
                    {row.actor.name}
                  </Box>{" "}
                  {row.summary}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap", gap: 1 }}>
                  <ResultChip result={row.result} label={row.resultLabel} />
                  <Chip size="small" variant="outlined" label={row.categoryLabel} />
                </Stack>
              </Paper>

              <Box>
                <SectionTitle>对象</SectionTitle>
                <ObjectBlock object={row.object} scope={row.scope} />
              </Box>

              <Box>
                <SectionTitle>执行人</SectionTitle>
                <ActorIdentity actor={row.actor} />
              </Box>

              {row.changes.length > 0 ? (
                <Box>
                  <SectionTitle>变更内容</SectionTitle>
                  <Stack divider={<Divider flexItem />} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
                    {row.changes.map((change) => (
                      <Stack
                        key={`${change.label}-${change.from ?? ""}-${change.to ?? ""}`}
                        spacing={1}
                        sx={{ px: 1.5, py: 1.25 }}
                      >
                        <Typography variant="subtitle2" color="text.secondary">
                          {change.label}
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                          <Chip
                            size="small"
                            variant="outlined"
                            label={change.from ?? "（空）"}
                            sx={{ textDecoration: change.to ? "line-through" : "none" }}
                          />
                          <ArrowForwardOutlinedIcon fontSize="small" sx={{ color: "text.secondary" }} />
                          <Chip
                            size="small"
                            color="primary"
                            variant="outlined"
                            label={change.to ?? "（已清空）"}
                          />
                        </Stack>
                      </Stack>
                    ))}
                  </Stack>
                </Box>
              ) : null}

              {row.context.length > 0 ? (
                <Box>
                  <SectionTitle>补充信息</SectionTitle>
                  <Stack spacing={1.5}>
                    {row.context.map((item) => (
                      <DetailRow key={item.label} label={item.label} value={item.value} />
                    ))}
                  </Stack>
                </Box>
              ) : null}

              <Box>
                <SectionTitle>来源与结果</SectionTitle>
                <Stack spacing={1.5}>
                  <DeviceLine
                    device={row.device}
                    ipAddress={row.ipAddress}
                    ipScope={row.ipScope}
                  />
                  <DetailRow label="结果" value={row.resultLabel} />
                </Stack>
              </Box>

              <Accordion variant="outlined" disableGutters>
                <AccordionSummary expandIcon={<ExpandMoreOutlinedIcon />}>
                  <Stack spacing={0.25}>
                    <Typography variant="subtitle2">技术详情</Typography>
                    <Typography variant="caption" color="text.secondary">
                      操作码、内部 ID、User-Agent 与原始数据，供排查问题时查看
                    </Typography>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={2}>
                    <DetailRow label="操作码" value={row.action} mono copyable />
                    <DetailRow
                      label="资源类型"
                      value={`${row.resourceType}（${row.resourceLabel}）`}
                      mono
                    />
                    <DetailRow label="资源 ID" value={row.resourceId} mono copyable />
                    <DetailRow label="所属项目 ID" value={row.projectId} mono copyable />
                    <DetailRow
                      label="客户空间 ID"
                      value={row.customerSpaceId}
                      mono
                      copyable
                    />
                    <DetailRow
                      label="工单 ID"
                      value={row.serviceRequestId}
                      mono
                      copyable
                    />
                    <DetailRow label="来源 IP" value={row.ipAddress} mono copyable />
                    <DetailRow label="User-Agent" value={row.userAgent} mono />
                    <JsonBlock title="原始附加数据（metadata）" value={row.metadata} />
                  </Stack>
                </AccordionDetails>
              </Accordion>
            </Stack>
          </Box>
        </Stack>
      ) : null}
    </Drawer>
  );
}
