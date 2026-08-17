import { Container, type ContainerProps } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";

export function PageContainer({
  maxWidth = false,
  sx,
  children,
}: {
  maxWidth?: ContainerProps["maxWidth"];
  sx?: SxProps<Theme>;
  children: React.ReactNode;
}) {
  return (
    <Container
      maxWidth={maxWidth}
      sx={[
        { px: { xs: 2, md: 3.5 }, py: { xs: 2.5, md: 3 } },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Container>
  );
}
