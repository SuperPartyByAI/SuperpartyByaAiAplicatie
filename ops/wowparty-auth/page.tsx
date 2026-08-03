"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../utils/supabase/client";

export const dynamic = "force-dynamic";

const ALLOWED_ACCESS_LEVELS = ["owner", "manager", "employee"];
const ADMIN_EMAIL = "superpartybyai@gmail.com";

type ScreenState = "checking" | "signed-out" | "pending" | "error";

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

function SingleTeamEntry() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [screen, setScreen] = useState<ScreenState>("checking");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const routeCurrentUser = async () => {
    setScreen("checking");
    setMessage("");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setEmail("");
      setScreen("signed-out");
      return;
    }

    setEmail(user.email ?? "");

    const { data, error } = await supabase
      .from("platform_users")
      .select("access_level, status, platforms!inner(slug)")
      .eq("user_id", user.id)
      .in("access_level", ALLOWED_ACCESS_LEVELS);

    if (error) {
      console.error("[AUTH] Membership check failed:", error.message);
      setMessage("Nu am putut verifica accesul. Încearcă din nou.");
      setScreen("error");
      return;
    }

    if (hasWowPartyAccess(data as Membership[] | null)) {
      router.replace(
        user.email?.toLowerCase() === ADMIN_EMAIL ? "/admin/inbox" : "/wowparty"
      );
      return;
    }

    router.replace("/access-pending");
  };

  useEffect(() => {
    void routeCurrentUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        // Supabase emits auth changes while holding its internal auth lock.
        // Defer the membership lookup so getUser() cannot contend with it.
        window.setTimeout(() => void routeCurrentUser(), 0);
      }
      if (event === "SIGNED_OUT") {
        setEmail("");
        setScreen("signed-out");
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, router]);

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error) {
      setMessage(
        error === "membership-check-error"
          ? "Autentificarea a reușit, dar accesul nu a putut fi verificat. Încearcă din nou."
          : "Autentificarea nu s-a finalizat. Încearcă din nou."
      );
    }
  }, []);

  const loginWithGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");

    document.cookie =
      "sb_selected_brand=; path=/; max-age=0; secure; samesite=lax";

    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { prompt: "select_account" },
      },
    });

    if (error) {
      console.error("[AUTH] Google sign-in failed:", error.message);
      setMessage("Conectarea cu Google nu a pornit. Încearcă din nou.");
      setBusy(false);
    }
  };

  const changeAccount = async () => {
    setBusy(true);
    await supabase.auth.signOut();
    setBusy(false);
    setScreen("signed-out");
  };

  return (
    <main className="auth-page">
      <section className="auth-card" aria-live="polite">
        <div className="brand-row">
          <div className="brand-mark">W</div>
          <div>
            <strong>WowParty</strong>
            <span>SuperParty Manager AI</span>
          </div>
        </div>

        {screen === "checking" && (
          <div className="state-box">
            <div className="spinner" />
            <h1>Verificăm accesul</h1>
            <p>Te conectăm direct la echipa WowParty.</p>
          </div>
        )}

        {screen === "signed-out" && (
          <div className="state-box">
            <div className="eyebrow">O singură echipă · acces securizat</div>
            <h1>Intră direct în WowParty</h1>
            <p>
              Nu mai trebuie să alegi o echipă. Conectează-te cu adresa Google
              care a fost autorizată de administrator.
            </p>
            <button className="primary-button" onClick={loginWithGoogle} disabled={busy}>
              {busy ? "Se deschide Google…" : "Continuă cu Google"}
            </button>
            <small>Accesul este disponibil numai utilizatorilor invitați.</small>
          </div>
        )}

        {screen === "pending" && (
          <div className="state-box">
            <div className="status-icon">⏳</div>
            <div className="eyebrow">Cont autentificat</div>
            <h1>Acces în așteptare</h1>
            <p>
              Contul <strong>{email || "Google"}</strong> nu este încă asociat
              echipei WowParty. Administratorul trebuie să îl invite înainte de
              prima intrare.
            </p>
            <button className="secondary-button" onClick={changeAccount} disabled={busy}>
              Folosește alt cont Google
            </button>
          </div>
        )}

        {screen === "error" && (
          <div className="state-box">
            <div className="status-icon">!</div>
            <div className="eyebrow error">Verificare întreruptă</div>
            <h1>Nu am putut confirma accesul</h1>
            <p>{message || "Încearcă din nou peste câteva secunde."}</p>
            <button className="primary-button" onClick={() => void routeCurrentUser()}>
              Reîncearcă
            </button>
          </div>
        )}

        {message && screen !== "error" && <div className="notice">{message}</div>}
      </section>

      <style jsx global>{`
        * { box-sizing: border-box; }
        html, body { margin: 0; min-height: 100%; }
        body {
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background:
            radial-gradient(circle at 12% 12%, rgba(124, 92, 255, .28), transparent 28%),
            radial-gradient(circle at 88% 82%, rgba(34, 211, 238, .16), transparent 24%),
            #07101d;
          color: #eef2ff;
        }
        button { font: inherit; }
        .auth-page {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
        }
        .auth-card {
          width: min(100%, 540px);
          min-height: 520px;
          display: flex;
          flex-direction: column;
          padding: 30px;
          border: 1px solid rgba(255,255,255,.11);
          border-radius: 28px;
          background: linear-gradient(180deg, rgba(255,255,255,.085), rgba(255,255,255,.045));
          box-shadow: 0 30px 90px rgba(0,0,0,.38);
          backdrop-filter: blur(22px);
        }
        .brand-row { display: flex; align-items: center; gap: 12px; }
        .brand-row > div:last-child { display: grid; gap: 3px; }
        .brand-row strong { font-size: 16px; }
        .brand-row span { color: #9fb0d0; font-size: 12px; }
        .brand-mark {
          width: 46px; height: 46px; display: grid; place-items: center;
          border-radius: 15px; font-weight: 900; font-size: 20px;
          background: linear-gradient(135deg, #725cff, #22d3ee);
          box-shadow: 0 12px 30px rgba(109,94,252,.34);
        }
        .state-box {
          flex: 1; display: flex; flex-direction: column; justify-content: center;
          align-items: flex-start; padding: 36px 4px 18px;
        }
        .state-box h1 {
          margin: 14px 0 14px; font-size: clamp(34px, 8vw, 52px);
          line-height: 1.02; letter-spacing: -.045em;
        }
        .state-box p { margin: 0 0 26px; color: #a9b6d3; font-size: 16px; line-height: 1.7; }
        .state-box p strong { color: #eef2ff; overflow-wrap: anywhere; }
        .state-box small { margin-top: 14px; color: #8496b7; line-height: 1.5; }
        .eyebrow {
          display: inline-flex; padding: 8px 11px; border-radius: 999px;
          background: rgba(109,94,252,.14); border: 1px solid rgba(139,92,246,.34);
          color: #d8d4ff; font-size: 12px; font-weight: 700;
        }
        .eyebrow.error { color: #fecaca; border-color: rgba(248,113,113,.35); background: rgba(239,68,68,.12); }
        .primary-button, .secondary-button {
          width: 100%; border: 0; border-radius: 16px; padding: 15px 18px;
          color: #fff; font-weight: 800; cursor: pointer; transition: transform .16s ease, opacity .16s ease;
        }
        .primary-button { background: linear-gradient(135deg, #6d5efc, #8b5cf6); box-shadow: 0 15px 34px rgba(109,94,252,.3); }
        .secondary-button { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.11); }
        .primary-button:hover, .secondary-button:hover { transform: translateY(-1px); }
        button:disabled { opacity: .58; cursor: wait; transform: none; }
        .spinner {
          width: 38px; height: 38px; border-radius: 50%;
          border: 3px solid rgba(255,255,255,.12); border-top-color: #8b5cf6;
          animation: spin .8s linear infinite;
        }
        .status-icon {
          width: 44px; height: 44px; display: grid; place-items: center;
          border-radius: 15px; background: rgba(255,255,255,.08); font-size: 20px; font-weight: 900;
          margin-bottom: 16px;
        }
        .notice {
          padding: 12px 14px; border-radius: 14px; color: #fecaca;
          background: rgba(239,68,68,.12); border: 1px solid rgba(248,113,113,.28);
          font-size: 13px; line-height: 1.5;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 560px) {
          .auth-page { padding: 12px; align-items: start; }
          .auth-card { min-height: calc(100vh - 24px); padding: 22px; border-radius: 22px; }
          .state-box { padding-top: 28px; }
        }
      `}</style>
    </main>
  );
}

export default function SingleTeamPage() {
  return (
    <SingleTeamEntry />
  );
}
