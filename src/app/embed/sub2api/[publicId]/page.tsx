import type { Metadata } from "next";
import { Sub2ApiEmbedPortal } from "@/components/embed/sub2api-embed-portal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "服务请求",
  robots: { index: false, follow: false },
};

export default async function Sub2ApiEmbedPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <Sub2ApiEmbedPortal publicId={publicId} />;
}
