import { NextResponse, type NextRequest } from "next/server";
import { withSystemDb } from "@/lib/system-db";

export async function proxy(request: NextRequest) {
  const publicId = request.nextUrl.pathname.split("/").filter(Boolean)[2];
  const binding = publicId
    ? await withSystemDb((tx) =>
        tx.projectPluginBinding.findUnique({
          where: { publicId },
          select: {
            status: true,
            sub2ApiConnection: { select: { sourceOrigin: true } },
            universalConnection: { select: { allowedOrigins: true } },
          },
        }),
      ).catch(() => null)
    : null;
  const universalOrigins = Array.isArray(
    binding?.universalConnection?.allowedOrigins,
  )
    ? binding.universalConnection.allowedOrigins.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const frameAncestors =
    binding?.status === "ACTIVE"
      ? [
          ...(binding.sub2ApiConnection?.sourceOrigin
            ? [binding.sub2ApiConnection.sourceOrigin]
            : []),
          ...universalOrigins,
        ]
      : [];
  const response = NextResponse.next();
  response.headers.set(
    "Content-Security-Policy",
    `frame-ancestors ${frameAncestors.length > 0 ? frameAncestors.join(" ") : "'none'"}`,
  );
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/embed/sub2api/:path*", "/embed/connect/:path*"],
};
