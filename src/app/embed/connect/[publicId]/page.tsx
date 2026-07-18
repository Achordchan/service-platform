import type { Metadata } from "next";
import { UniversalEmbedPortal } from "@/components/embed/external-embed-portal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "服务请求",
  robots: { index: false, follow: false },
};

export default async function UniversalEmbedPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <UniversalEmbedPortal publicId={publicId} />;
}
