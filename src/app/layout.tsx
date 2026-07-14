import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "@/theme/app-providers";

export const metadata: Metadata = {
  title: {
    default: "服务支持中心",
    template: "%s｜服务支持中心",
  },
  description: "客户服务项目交付与服务请求协作平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
