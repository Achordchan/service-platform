import type { SxProps, Theme } from "@mui/material/styles";

export function gridHeight(rowCount: number, rowHeight: number) {
  return Math.min(620, Math.max(220, rowCount * rowHeight + 112));
}

export const gridSx: SxProps<Theme> = {
  border: 0,
  "& .MuiDataGrid-cell": {
    display: "flex",
    alignItems: "center",
    py: 1,
  },
  "& .MuiDataGrid-columnHeaderTitle": { fontWeight: 650 },
  "& .MuiDataGrid-columnHeaders": { borderBottomColor: "divider" },
  "& .MuiDataGrid-footerContainer": { borderTopColor: "divider" },
};
