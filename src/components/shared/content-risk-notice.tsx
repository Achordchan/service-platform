import { Stack, Typography } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";

export function ContentRiskNotice({ audience }: { audience: "CUSTOMER" | "STAFF" }) {
  return (
    <Stack
      direction="row"
      spacing={0.75}
      role="note"
      sx={{ alignItems: "flex-start", color: "text.secondary", minWidth: 0 }}
    >
      <InfoOutlinedIcon sx={{ fontSize: 16, flexShrink: 0, mt: "2px" }} />
      <Typography variant="caption" sx={{ lineHeight: 1.55, overflowWrap: "anywhere" }}>
        {audience === "CUSTOMER"
          ? "请勿发送联系方式或引导站外沟通、交易。平台无法保障站外沟通与交易安全，由此产生的风险和损失由相关方自行承担。"
          : "严禁向客户提供个人联系方式或引导站外沟通、交易。违规行为将被记录并立即通知平台管理员，由平台管理员进行后续处理。"}
      </Typography>
    </Stack>
  );
}

export function ContentRiskStatusLine({
  status,
  pluginEnabled,
}: {
  status?: "PENDING" | "REVOKED" | null;
  pluginEnabled: boolean;
}) {
  if (!status) return null;
  if (status === "PENDING") {
    return pluginEnabled ? (
      <Typography variant="caption" color="text.secondary">
        内容已发布，正在进行安全复查
      </Typography>
    ) : null;
  }
  return (
    <Stack
      direction="row"
      spacing={0.65}
      role="status"
      sx={{ alignItems: "center", color: "error.main", minWidth: 0 }}
    >
      <WarningAmberOutlinedIcon sx={{ fontSize: 16, flexShrink: 0 }} />
      <Typography variant="caption" sx={{ color: "inherit", lineHeight: 1.55 }}>
        {pluginEnabled
          ? "该内容已被系统撤回：疑似包含联系方式或站外交易引导。"
          : "该内容已撤回"}
      </Typography>
    </Stack>
  );
}
