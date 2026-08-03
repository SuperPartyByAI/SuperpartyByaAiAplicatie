"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../../utils/supabase/client";

export default function AccessPendingPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);

  const changeAccount = async () => {
    if (busy) return;
    setBusy(true);
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  };

  return (
    <main className="min-h-screen bg-slate-950 px-6 text-white grid place-items-center">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl">
        <div className="mb-5 text-sm font-semibold text-violet-300">WowParty</div>
        <h1 className="text-3xl font-bold tracking-tight">Acces în așteptare</h1>
        <p className="mt-4 leading-7 text-slate-300">
          Contul Google este autentificat, dar nu are încă o invitație activă în
          echipa WowParty. Cere administratorului să adauge adresa ta de e-mail.
        </p>
        <div className="mt-7 grid gap-3">
          <button
            type="button"
            onClick={() => router.replace("/")}
            className="rounded-xl bg-violet-600 px-5 py-3 font-semibold hover:bg-violet-500"
          >
            Verifică din nou
          </button>
          <button
            type="button"
            onClick={changeAccount}
            disabled={busy}
            className="rounded-xl border border-white/15 px-5 py-3 font-semibold disabled:opacity-60"
          >
            {busy ? "Se deconectează…" : "Folosește alt cont Google"}
          </button>
        </div>
      </section>
    </main>
  );
}
