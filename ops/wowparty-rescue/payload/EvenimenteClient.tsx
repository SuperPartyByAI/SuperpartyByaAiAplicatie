"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  MapPin,
  MessageSquare,
  RefreshCw,
  User,
  Users,
  WandSparkles,
  XCircle,
} from "lucide-react";

type FilterMode = "today" | "upcoming" | "review" | "cancelled" | "all";

interface AgentEvent {
  id: string;
  business_id: string;
  conversation_id: string | null;
  status: string;
  event_type: string | null;
  event_date: string | null;
  date_string: string | null;
  event_time: string | null;
  start_time: string | null;
  event_location: string | null;
  location_text: string | null;
  client_name: string | null;
  client_phone: string | null;
  birthday_person: string | null;
  birthday_age: number | null;
  services: string[] | null;
  characters: string[] | null;
  price_agreed: number | string | null;
  factual_notes: string | null;
  event_details: Record<string, unknown> | null;
  agent_confidence: number | null;
  is_test: boolean | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  client: {
    full_name: string | null;
    real_phone_e164: string | null;
    public_alias: string | null;
    client_alias: string | null;
  } | null;
}

interface EventRevision {
  id: string;
  event_id: string;
  revision_number: number | null;
  change_type: string;
  changed_by: string | null;
  changed_at: string;
  new_state: Record<string, unknown> | null;
}

const EVENT_COLUMNS = [
  "id",
  "business_id",
  "conversation_id",
  "status",
  "event_type",
  "event_date",
  "date_string",
  "event_time",
  "start_time",
  "event_location",
  "location_text",
  "client_name",
  "client_phone",
  "birthday_person",
  "birthday_age",
  "services",
  "characters",
  "price_agreed",
  "factual_notes",
  "event_details",
  "agent_confidence",
  "is_test",
  "created_at",
  "updated_at",
  "cancelled_at",
  "client:clients(full_name,real_phone_e164,public_alias,client_alias)",
].join(",");

const REVIEW_STATUSES = new Set(["draft", "detected", "pending_confirmation", "needs_internal_review"]);

const STATUS_LABELS: Record<string, string> = {
  draft: "De verificat",
  detected: "Notat automat",
  pending_confirmation: "De verificat",
  confirmed: "Confirmat",
  assigned: "Alocat",
  in_progress: "În desfășurare",
  completed: "Finalizat",
  cancelled: "Anulat",
  updated: "Actualizat",
  rescheduled: "Reprogramat",
  needs_internal_review: "Necesită verificare",
};

const STATUS_STYLES: Record<string, string> = {
  detected: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  draft: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  pending_confirmation: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  needs_internal_review: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  confirmed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  assigned: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  in_progress: "border-violet-400/40 bg-violet-400/10 text-violet-300",
  completed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  cancelled: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  updated: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300",
  rescheduled: "border-orange-400/40 bg-orange-400/10 text-orange-300",
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  birthday: "Zi de naștere",
  school: "Eveniment școlar",
  private_party: "Petrecere privată",
  corporate_kids: "Eveniment corporate pentru copii",
  other: "Alt tip",
  petrecere_copii: "Petrecere pentru copii",
  corporate: "Eveniment corporate",
  alta: "Alt tip",
};

const REVISION_LABELS: Record<string, string> = {
  create: "Eveniment notat",
  booking_create: "Eveniment notat",
  update: "Detalii actualizate",
  booking_update: "Detalii actualizate",
  reschedule: "Eveniment reprogramat",
  booking_reschedule: "Eveniment reprogramat",
  cancel: "Eveniment anulat",
  booking_cancel: "Eveniment anulat",
};

const FILTERS: Array<{ id: FilterMode; label: string }> = [
  { id: "today", label: "Astăzi" },
  { id: "upcoming", label: "Viitoare" },
  { id: "review", label: "De verificat" },
  { id: "cancelled", label: "Anulate" },
  { id: "all", label: "Toate" },
];

function bucharestDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function eventDateKey(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || null;
}

function formatDate(value: string | null, withTime = false) {
  if (!value) return "Data nu este încă stabilită";
  const key = eventDateKey(value);
  const date = withTime ? new Date(value) : key ? new Date(`${key}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return "Data nu este încă stabilită";
  return new Intl.DateTimeFormat("ro-RO", {
    timeZone: "Europe/Bucharest",
    day: "2-digit",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function formatTime(value: string | null) {
  if (!value) return "Ora nu este încă stabilită";
  return value.slice(0, 5);
}

function humanize(value: string | null | undefined) {
  if (!value) return "—";
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatPrice(value: number | string | null) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON", maximumFractionDigits: 0 }).format(numeric);
}

function effectiveDate(event: AgentEvent) {
  return event.event_date || event.date_string;
}

function effectiveTime(event: AgentEvent) {
  return event.event_time || event.start_time;
}

function effectiveLocation(event: AgentEvent) {
  return event.event_location || event.location_text;
}

function effectiveClientName(event: AgentEvent) {
  return event.client_name
    || event.client?.full_name
    || event.client?.client_alias
    || event.client?.public_alias
    || null;
}

function effectiveClientPhone(event: AgentEvent) {
  return event.client_phone || event.client?.real_phone_e164 || null;
}

function eventTypeLabel(value: string | null) {
  if (!value) return "—";
  return EVENT_TYPE_LABELS[value] || humanize(value);
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Încărcarea a durat prea mult. Reîncearcă.")), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function statusIcon(status: string) {
  if (status === "cancelled") return <XCircle size={14} />;
  if (["confirmed", "completed"].includes(status)) return <CheckCircle2 size={14} />;
  return <WandSparkles size={14} />;
}

export default function EvenimenteClient({ initialBusinessId = "wowparty" }: { initialBusinessId?: string }) {
  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    ),
    [],
  );
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [revisions, setRevisions] = useState<Record<string, EventRevision[]>>({});
  const [filterMode, setFilterMode] = useState<FilterMode>("today");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchEvents = useCallback(async (background = false) => {
    if (background) setIsRefreshing(true);
    else setIsLoading(true);
    setError("");

    try {
      let query = supabase
        .from("events")
        .select(EVENT_COLUMNS)
        .order("event_date", { ascending: true, nullsFirst: false })
        .order("event_time", { ascending: true, nullsFirst: false })
        .limit(300);

      if (initialBusinessId !== "all") query = query.eq("business_id", initialBusinessId);

      const { data, error: eventError } = await withTimeout(query, 15000);
      if (eventError) throw eventError;

      const validEvents = ((data || []) as AgentEvent[]).filter((event) => {
        const detailsTest = event.event_details?.is_test;
        return event.is_test !== true && detailsTest !== true && detailsTest !== "true";
      });
      setEvents(validEvents);

      const eventIds = validEvents.map((event) => event.id);
      if (!eventIds.length) {
        setRevisions({});
        return;
      }

      const { data: revisionRows, error: revisionError } = await withTimeout(
        supabase
          .from("event_revisions")
          .select("id,event_id,revision_number,change_type,changed_by,changed_at,new_state")
          .in("event_id", eventIds)
          .order("changed_at", { ascending: false })
          .limit(1000),
        15000,
      );

      if (!revisionError) {
        const grouped: Record<string, EventRevision[]> = {};
        for (const revision of (revisionRows || []) as EventRevision[]) {
          grouped[revision.event_id] ||= [];
          grouped[revision.event_id].push(revision);
        }
        setRevisions(grouped);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Evenimentele nu au putut fi încărcate.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [initialBusinessId, supabase]);

  useEffect(() => {
    void fetchEvents();
    const channel = supabase
      .channel(`wowparty-events-${initialBusinessId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "events" }, () => {
        void fetchEvents(true);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [fetchEvents, initialBusinessId, supabase]);

  const filteredEvents = useMemo(() => {
    const today = bucharestDateKey();
    const filtered = events.filter((event) => {
      const date = eventDateKey(effectiveDate(event));
      if (filterMode === "cancelled") return event.status === "cancelled";
      if (filterMode === "review") return REVIEW_STATUSES.has(event.status);
      if (filterMode === "all") return true;
      if (event.status === "cancelled") return false;
      if (filterMode === "today") return date === today;
      return Boolean(date && date > today);
    });

    return [...filtered].sort((first, second) => {
      const firstDate = `${eventDateKey(effectiveDate(first)) || "9999-99-99"} ${effectiveTime(first) || "99:99"}`;
      const secondDate = `${eventDateKey(effectiveDate(second)) || "9999-99-99"} ${effectiveTime(second) || "99:99"}`;
      return filterMode === "all"
        ? new Date(second.updated_at).getTime() - new Date(first.updated_at).getTime()
        : firstDate.localeCompare(secondDate);
    });
  }, [events, filterMode]);

  return (
    <main className="min-h-screen bg-[#0f0c29] px-3 pb-28 pt-4 text-slate-100 sm:px-5">
      <div className="mx-auto max-w-4xl">
        <header className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-fuchsia-500/20 bg-[#1a1543] p-4 shadow-[0_8px_30px_rgba(217,70,239,0.12)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Calendar className="text-cyan-300" size={22} />
              <h1 className="text-xl font-black text-fuchsia-100">Evenimente</h1>
            </div>
            <p className="mt-1 text-xs font-medium text-indigo-300">Petreceri notate automat din conversații</p>
          </div>
          <button
            type="button"
            onClick={() => void fetchEvents(true)}
            disabled={isRefreshing}
            className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-2.5 text-cyan-300 transition hover:bg-cyan-400/20 disabled:opacity-50"
            aria-label="Reîmprospătează evenimentele"
          >
            <RefreshCw size={18} className={isRefreshing ? "animate-spin" : ""} />
          </button>
        </header>

        <nav className="mb-5 flex gap-2 overflow-x-auto pb-1" aria-label="Filtre evenimente">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setFilterMode(filter.id)}
              className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-bold transition ${
                filterMode === filter.id
                  ? "border-fuchsia-400 bg-fuchsia-600 text-white shadow-[0_0_12px_rgba(217,70,239,0.35)]"
                  : "border-indigo-500/25 bg-[#1a1543] text-indigo-200 hover:border-cyan-400/40"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </nav>

        {error && (
          <section className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4">
            <div className="flex gap-3">
              <AlertCircle className="mt-0.5 shrink-0 text-rose-300" size={18} />
              <div>
                <p className="text-sm font-bold text-rose-200">Nu am putut încărca evenimentele</p>
                <p className="mt-1 text-xs text-rose-300/80">{error}</p>
              </div>
            </div>
            <button type="button" onClick={() => void fetchEvents()} className="text-xs font-bold text-rose-200 underline">
              Reîncearcă
            </button>
          </section>
        )}

        {isLoading && (
          <div className="flex items-center justify-center gap-3 py-20 text-sm font-bold text-indigo-300">
            <RefreshCw className="animate-spin text-cyan-300" size={20} />
            Se încarcă evenimentele…
          </div>
        )}

        {!isLoading && !error && filteredEvents.length === 0 && (
          <section className="rounded-3xl border border-indigo-500/20 bg-[#1a1543]/70 px-5 py-16 text-center">
            <Calendar className="mx-auto mb-3 text-indigo-400/50" size={44} />
            <p className="font-bold text-fuchsia-100">Nu sunt evenimente în această categorie</p>
            <p className="mt-1 text-sm text-indigo-300">Poți alege alt filtru din bara de sus.</p>
          </section>
        )}

        <section className="space-y-3">
          {filteredEvents.map((event) => {
            const expanded = expandedId === event.id;
            const eventRevisions = revisions[event.id] || [];
            const price = formatPrice(event.price_agreed);
            const clientName = effectiveClientName(event);
            const clientPhone = effectiveClientPhone(event);
            const date = effectiveDate(event);
            const time = effectiveTime(event);
            const location = effectiveLocation(event);
            return (
              <article key={event.id} className="overflow-hidden rounded-2xl border border-indigo-500/25 bg-[#1a1543] shadow-lg">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : event.id)}
                  className="w-full p-4 text-left transition hover:bg-indigo-900/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-black text-fuchsia-50">
                          {event.birthday_person
                            ? `Petrecerea lui ${event.birthday_person}`
                            : clientName || "Petrecere notată"}
                        </h2>
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${STATUS_STYLES[event.status] || "border-indigo-400/30 bg-indigo-400/10 text-indigo-200"}`}>
                          {statusIcon(event.status)}
                          {STATUS_LABELS[event.status] || humanize(event.status)}
                        </span>
                      </div>

                      <div className="mt-3 grid gap-2 text-sm text-indigo-100 sm:grid-cols-2">
                        <span className="flex items-center gap-2">
                          <Calendar size={15} className="shrink-0 text-cyan-300" />
                          {formatDate(date)}
                        </span>
                        <span className="flex items-center gap-2">
                          <Clock size={15} className="shrink-0 text-cyan-300" />
                          {formatTime(time)}
                        </span>
                        <span className="flex items-start gap-2 sm:col-span-2">
                          <MapPin size={15} className="mt-0.5 shrink-0 text-fuchsia-300" />
                          {location || "Locația nu este încă stabilită"}
                        </span>
                      </div>
                    </div>
                    {expanded ? <ChevronUp className="shrink-0 text-fuchsia-300" size={20} /> : <ChevronDown className="shrink-0 text-fuchsia-300" size={20} />}
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-indigo-500/20 bg-[#0f0c29]/45 p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Detail label="Client" value={clientName} icon={<User size={15} />} />
                      <Detail label="Telefon" value={clientPhone} />
                      <Detail label="Tip eveniment" value={eventTypeLabel(event.event_type)} />
                      <Detail label="Copil" value={event.birthday_person} icon={<Users size={15} />} />
                      <Detail label="Vârstă" value={event.birthday_age !== null ? `${event.birthday_age} ani` : null} />
                      <Detail label="Preț stabilit" value={price} />
                      <Detail label="Servicii" value={event.services?.join(", ")} />
                      <Detail label="Personaje" value={event.characters?.join(", ")} />
                    </div>

                    {event.factual_notes && (
                      <div className="mt-4 rounded-xl border border-indigo-500/20 bg-indigo-950/25 p-3">
                        <p className="text-[10px] font-black uppercase tracking-wider text-indigo-400">Observații din conversație</p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-indigo-100">{event.factual_notes}</p>
                      </div>
                    )}

                    {eventRevisions.length > 0 && (
                      <div className="mt-4">
                        <p className="mb-2 text-[10px] font-black uppercase tracking-wider text-indigo-400">Istoric modificări</p>
                        <div className="space-y-2">
                          {eventRevisions.slice(0, 8).map((revision) => (
                            <div key={revision.id} className="flex items-center justify-between gap-3 rounded-xl border border-indigo-500/15 bg-[#1a1543]/60 px-3 py-2 text-xs">
                              <span className="font-bold text-indigo-100">{REVISION_LABELS[revision.change_type] || humanize(revision.change_type)}</span>
                              <span className="text-indigo-400">{formatDate(revision.changed_at, true)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {event.conversation_id && (
                      <Link
                        href={`/wowparty/in-discutii?conversation=${event.conversation_id}`}
                        className="mt-4 inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-200 transition hover:bg-cyan-400/20"
                      >
                        <MessageSquare size={15} />
                        Deschide conversația
                      </Link>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}

function Detail({ label, value, icon }: { label: string; value: string | null | undefined; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-indigo-500/15 bg-[#1a1543]/60 p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-400">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-indigo-100">{value || "—"}</p>
    </div>
  );
}
