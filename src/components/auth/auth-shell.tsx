"use client";

import Image from "next/image";
import { Box, Paper, Stack, Typography } from "@mui/material";

export function AuthShell({
  title,
  description,
  children,
  brandSide = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  brandSide?: boolean;
}) {
  return (
    <Box
      component="main"
      sx={(theme) => ({
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        px: { xs: 2, md: 3 },
        py: { xs: 4, md: 6 },
        bgcolor: "background.default",
        backgroundImage:
          "radial-gradient(circle at top left, rgba(37,99,235,0.08), transparent 34%), radial-gradient(circle at bottom right, rgba(15,23,42,0.05), transparent 40%)",
        ...theme.applyStyles("dark", {
          backgroundImage:
            "radial-gradient(circle at top left, rgba(90,162,255,0.12), transparent 34%), radial-gradient(circle at bottom right, rgba(255,255,255,0.04), transparent 40%)",
        }),
      })}
    >
      <Box
        sx={(theme) => ({
          width: "100%",
          maxWidth: brandSide ? 980 : 440,
          display: "grid",
          gridTemplateColumns: brandSide
            ? { xs: "1fr", md: "1.02fr 0.98fr" }
            : "1fr",
          borderRadius: 3,
          overflow: "hidden",
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          boxShadow: "0 24px 80px rgba(15, 23, 40, 0.08)",
          ...theme.applyStyles("dark", {
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.36)",
          }),
        })}
      >
        {brandSide ? (
          <Box
            sx={{
              display: { xs: "none", md: "flex" },
              flexDirection: "column",
              position: "relative",
              minHeight: 560,
              bgcolor: "#0b1526",
              overflow: "hidden",
            }}
          >
            <Box sx={{ position: "absolute", inset: 0 }}>
              <Image
                src="/brand/login-panel.svg"
                alt=""
                fill
                priority
                sizes="(min-width: 900px) 500px, 0px"
                style={{ objectFit: "cover" }}
              />
            </Box>
            <Box
              sx={{
                position: "relative",
                zIndex: 1,
                p: 4.5,
                mt: "auto",
                background:
                  "linear-gradient(180deg, rgba(11,21,38,0) 0%, rgba(11,21,38,0.82) 55%, rgba(11,21,38,0.96) 100%)",
              }}
            >
              <Typography
                sx={{
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "rgba(248,250,252,0.55)",
                }}
              >
                Service Delivery
              </Typography>
              <Typography
                sx={{
                  mt: 1,
                  fontSize: 30,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "#f8fafc",
                }}
              >
                服务支持中心
              </Typography>
            </Box>
          </Box>
        ) : null}

        <Paper
          elevation={0}
          sx={{
            width: "100%",
            p: { xs: 3, sm: 4, md: brandSide ? 4.5 : 4 },
            borderRadius: 0,
            boxShadow: "none",
            bgcolor: "background.paper",
          }}
        >
          <Stack spacing={3} sx={{ height: "100%", justifyContent: "center" }}>
            <Stack spacing={1}>
              {brandSide ? (
                <Typography
                  sx={{
                    display: { xs: "block", md: "none" },
                    fontSize: 13,
                    fontWeight: 700,
                    color: "text.secondary",
                    letterSpacing: "0.04em",
                  }}
                >
                  服务支持中心
                </Typography>
              ) : null}
              <Typography variant="h2" sx={{ fontSize: { xs: 26, sm: 28 } }}>
                {title}
              </Typography>
              {description ? (
                <Typography color="text.secondary" sx={{ lineHeight: 1.7 }}>
                  {description}
                </Typography>
              ) : null}
            </Stack>
            {children}
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
