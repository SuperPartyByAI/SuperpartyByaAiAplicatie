import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const ALLOWED_ACCESS_LEVELS = ["owner", "manager", "employee"];
const ADMIN_EMAIL = "superpartybyai@gmail.com";

type Membership = {
  access_level?: string | null;
  status?: string | null;
  platforms?: { slug?: string | null } | Array<{ slug?: string | null }> | null;
};

function siteUrl(request: Request): string {
  const host = request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") || "https";
  if (host) {
    const scheme =
      host.includes("localhost") || host.includes("127.0.0.1") ? "http" : proto;
    return `${scheme}://${host}`;
  }
  return process.env.NEXT_PUBLIC_SITE_URL || "https://app.superparty.ro";
}

function platformSlug(membership: Membership): string | null {
  const platform = Array.isArray(membership.platforms)
    ? membership.platforms[0]
    : membership.platforms;
  return platform?.slug ?? null;
}

function hasWowPartyAccess(memberships: Membership[] | null): boolean {
  return (memberships ?? []).some((membership) => {
    const active =
      membership.status == null ||
      membership.status === "active" ||
      membership.status === "approved";
    return (
      active &&
      ALLOWED_ACCESS_LEVELS.includes(membership.access_level ?? "") &&
      platformSlug(membership) === "wowparty"
    );
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const cookieStore = await cookies();
  let sessionResponse = NextResponse.redirect(new URL("/", siteUrl(request)));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            sessionResponse.cookies.set(name, value, { ...options, secure: true })
          );
        },
      },
    }
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[CALLBACK] Session exchange failed:", error.message);
      return NextResponse.redirect(
        new URL("/?error=auth-code-error", siteUrl(request)),
        { headers: sessionResponse.headers }
      );
    }
  }

  // Supports both a fresh OAuth callback and an already-authenticated legacy
  // request to /auth/callback. The previous early return caused the loop.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.redirect(
      new URL("/?error=auth-code-error", siteUrl(request)),
      { headers: sessionResponse.headers }
    );
  }

  const { data, error: membershipError } = await supabase
    .from("platform_users")
    .select("access_level, status, platforms!inner(slug)")
    .eq("user_id", user.id)
    .in("access_level", ALLOWED_ACCESS_LEVELS);

  const target = membershipError
    ? "/?error=membership-check-error"
    : hasWowPartyAccess(data as Membership[] | null)
      ? user.email?.toLowerCase() === ADMIN_EMAIL
        ? "/admin/inbox"
        : "/wowparty"
      : "/access-pending";

  if (membershipError) {
    console.error("[CALLBACK] Membership check failed:", membershipError.message);
  }

  const redirect = NextResponse.redirect(new URL(target, siteUrl(request)), {
    headers: sessionResponse.headers,
  });
  redirect.cookies.delete("sb_selected_brand");
  redirect.cookies.delete("sp_profile_cache");
  return redirect;
}
