import type { SxProps, Theme } from "@mui/material/styles";

export const staffPagePx = { xs: 2, md: 3.5 } as const;
export const staffPagePy = { xs: 3, md: 4 } as const;

export const customerPagePx = { xs: 2, md: 3.5 } as const;
export const customerPagePy = { xs: 3, md: 4 } as const;

export const staffPageSx: SxProps<Theme> = {
  px: staffPagePx,
  py: staffPagePy,
};

export const customerPageSx: SxProps<Theme> = {
  px: customerPagePx,
  py: customerPagePy,
};
