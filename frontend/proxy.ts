import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

// Optimistic route guard (Next 16 renamed "Middleware" to "Proxy" — same
// runtime/semantics). Per Next's own docs this shouldn't be the *only*
// authorization check — each protected API route also verifies the
// session itself — but it keeps an unauthenticated visitor from ever
// seeing the dashboard shell render.
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const valid = token ? await verifySessionToken(token) : false;

  if (!valid) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/dashboard/:path*"],
};
