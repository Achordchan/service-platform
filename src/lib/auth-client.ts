"use client";

import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";

function resolveAuthBaseURL() {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:3000";
}

export const authClient = createAuthClient({
  baseURL: resolveAuthBaseURL(),
  plugins: [emailOTPClient()],
});
