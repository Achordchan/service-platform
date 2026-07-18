import { Badge } from "@mui/material";

export function NavigationUnreadBadge({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <Badge
      color="error"
      variant="dot"
      invisible={!visible}
      sx={{
        display: "inline-flex",
        "& .MuiBadge-badge": {
          width: 8,
          minWidth: 8,
          height: 8,
        },
      }}
    >
      {children}
    </Badge>
  );
}
