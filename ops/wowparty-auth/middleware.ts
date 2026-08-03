import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { VALID_BRAND_SLUGS } from "@/config/brands";

const PROFILE_CACHE_COOKIE = "sp_profile_cache";
const ALLOWED_ACCESS_LEVELS = ["owner", "manager", "employee"];
const ADMIN_EMAIL = "superpartybyai@gmail.com";

type Membership = {
  access_level?: string | null;
  status?: string | null;
  platforms?: { slug?: string | null } | Array<{ slug?: string | null }> | null;
};

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

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (
    pathname.startsWith("/api/verify-face") ||
    pathname === "/rezervare" ||
    pathname.startsWith("/rezervare") ||
    pathname === "/api/planner" ||
    pathname === "/api/planner/confirm" ||
    (process.env.NODE_ENV === "development" && pathname.startsWith("/wowparty"))
  ) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (error: any) {
    if (!(error.name === "AuthApiError" && error.message.includes("Refresh Token"))) {
      console.error("[MIDDLEWARE SUPABASE ERROR]", error);
    }
  }

  const isAuthRoute =
    pathname === "/login" ||
    pathname === "/admin/login" ||
    (pathname.startsWith("/auth") && pathname !== "/auth/callback");
  const validBrands = VALID_BRAND_SLUGS;
  const isProtectedRoute =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/angajat") ||
    pathname === "/pending-approval" ||
    pathname === "/access-pending" ||
    validBrands.some((brand) => pathname.startsWith(`/${brand}`));
  const isLegacyEntryRoute =
    pathname === "/select-brand" || pathname === "/register-business";

  if (
    request.method !== "GET" &&
    request.method !== "OPTIONS" &&
    user?.app_metadata?.auditor_role === "auditor_readonly"
  ) {
    return NextResponse.json({ error: "Auditor is read-only" }, { status: 403 });
  }

  if (pathname === "/api/auth/signout") {
    response.cookies.delete(PROFILE_CACHE_COOKIE);
    response.cookies.delete("sb_selected_brand");
    return response;
  }

  if (!user && (isProtectedRoute || isLegacyEntryRoute) && !isAuthRoute) {
    return NextResponse.redirect(new URL("/", request.nextUrl.origin));
  }

  let role = "agent";
  let status = "pending";
  let brand: string | null = null;
  let wowPartyAccess: boolean | null = null;

  if (user) {
    try {
      const [profileResult, membershipResult] = await Promise.all([
        supabase
          .from("profiles")
          .select(
            "role, status, brand, employee_verifications(face_left_url, face_right_url, blink_url)"
          )
          .eq("id", user.id)
          .single(),
        supabase
          .from("platform_users")
          .select("access_level, status, platforms!inner(slug)")
          .eq("user_id", user.id)
          .in("access_level", ALLOWED_ACCESS_LEVELS),
      ]);

      const profile = profileResult.data;
      if (profile) {
        role = profile.role;
        status = profile.status;
        brand = profile.brand;

        // Preserve the existing KYC guard for agents of the legacy brands.
        if (role === "agent" && status === "approved" && brand !== "wowparty") {
          const isAuditor = user.app_metadata?.auditor_role === "auditor_readonly";
          if (!isAuditor) {
            const verifications = profile.employee_verifications || [];
            const latest = (Array.isArray(verifications)
              ? verifications[0]
              : verifications) as any;
            const hasRequiredPhotos =
              latest && latest.face_left_url && latest.face_right_url && latest.blink_url;
            if (!hasRequiredPhotos) status = "pending";
          }
        }
      }

      if (profileResult.error) {
        console.error(
          "[MIDDLEWARE PROFILE FETCH ERROR]",
          JSON.stringify(profileResult.error)
        );
      }

      if (membershipResult.error) {
        console.error(
          "[MIDDLEWARE MEMBERSHIP FETCH ERROR]",
          JSON.stringify(membershipResult.error)
        );
      } else {
        wowPartyAccess = hasWowPartyAccess(
          membershipResult.data as Membership[] | null
        );
      }
    } catch (error) {
      console.error("[MIDDLEWARE AUTHORIZATION EXCEPTION]", error);
    }

    // Preserve existing API permissions. The UI routing change must not widen
    // access to administrative endpoints.
    if (pathname.startsWith("/api/admin")) {
      if (role !== "admin" || user.email !== "superpartybyai@gmail.com") {
        if (
          role === "agent" &&
          (
            pathname === "/api/admin/bookings/action" ||
            pathname === "/api/admin/agents" ||
            pathname === "/api/admin/bookings/extract-ai" ||
            pathname === "/api/admin/bookings/create-from-ai" ||
            pathname === "/api/admin/bookings/ai-state" ||
            pathname === "/api/admin/bookings/list-client-bookings" ||
            pathname === "/api/admin/bookings/update-from-ai" ||
            pathname === "/api/admin/bookings/reprocess-conversation"
          )
        ) {
          // Existing WowParty agent API allowance.
        } else if (
          ["admin", "manager", "operator", "agent"].includes(role) &&
          pathname === "/api/admin/kyc-action"
        ) {
          // Existing KYC allowance.
        } else {
          return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
        }
      }
      return response;
    }

    // Let the route handler exchange a fresh OAuth code (or resolve an
    // already-authenticated legacy callback). Applying profile routing here
    // would intercept invited users whose old profile has no brand yet.
    if (pathname === "/auth/callback") {
      return response;
    }

    const isSingleTeamEntry = pathname === "/" || isLegacyEntryRoute;
    const isWowPartyRoute =
      pathname === "/wowparty" || pathname.startsWith("/wowparty/");

    // Single-team routing. null means the membership lookup failed, in which
    // case the legacy profile checks below remain available as a safe fallback.
    if (wowPartyAccess === true && isSingleTeamEntry) {
      const target =
        user.email?.toLowerCase() === ADMIN_EMAIL ? "/admin/inbox" : "/wowparty";
      return NextResponse.redirect(new URL(target, request.nextUrl.origin));
    }
    if (wowPartyAccess === false && isSingleTeamEntry) {
      return NextResponse.redirect(
        new URL("/access-pending", request.nextUrl.origin)
      );
    }
    if (wowPartyAccess === true && isWowPartyRoute) {
      return response;
    }
    if (wowPartyAccess === false && isWowPartyRoute) {
      return NextResponse.redirect(
        new URL("/access-pending", request.nextUrl.origin)
      );
    }
    if (pathname === "/access-pending" && wowPartyAccess === true) {
      const target =
        user.email?.toLowerCase() === ADMIN_EMAIL ? "/admin/inbox" : "/wowparty";
      return NextResponse.redirect(new URL(target, request.nextUrl.origin));
    }
    if (pathname === "/access-pending" && wowPartyAccess === false) {
      return response;
    }
    if (pathname === "/pending-approval" && wowPartyAccess === true) {
      return NextResponse.redirect(new URL("/wowparty", request.nextUrl.origin));
    }
    if (pathname === "/pending-approval" && wowPartyAccess === false) {
      return response;
    }

    // Keep the established global-admin behavior for its admin routes.
    if (role === "admin" && user.email === "superpartybyai@gmail.com") {
      if (isAuthRoute) {
        return NextResponse.redirect(new URL("/admin/inbox", request.nextUrl.origin));
      }
      return response;
    }

    // Legacy profile-based authorization remains only as fallback for the
    // existing non-WowParty routes.
    if (status !== "approved") {
      if (pathname !== "/pending-approval" && !pathname.startsWith("/api/")) {
        return NextResponse.redirect(
          new URL("/pending-approval", request.nextUrl.origin)
        );
      }
      return response;
    }

    const isBrandValid = brand && validBrands.includes(brand);
    if (!isBrandValid) {
      return NextResponse.redirect(new URL("/", request.nextUrl.origin));
    }

    const employeeRoute = `/${brand}`;
    if (pathname === "/pending-approval" || isAuthRoute) {
      return NextResponse.redirect(new URL(employeeRoute, request.nextUrl.origin));
    }

    if (pathname.startsWith("/admin")) {
      if (pathname === "/admin/colaboratori") return response;
      return NextResponse.redirect(new URL(employeeRoute, request.nextUrl.origin));
    }

    const isAccessingOtherBrandRoute = validBrands.some(
      (candidate) =>
        pathname.startsWith(`/${candidate}`) && candidate !== brand
    );
    if (isAccessingOtherBrandRoute) {
      return NextResponse.redirect(new URL(employeeRoute, request.nextUrl.origin));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json|webmanifest)$).*)",
  ],
};
