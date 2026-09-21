import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Session = { id: string; created_at: string; user_agent: string; ip: string; current: boolean };
type Event = {
  id: number;
  created_at: string;
  event: string;
  severity: string;
  actor_id: string | null;
};
export function AccountSecurityPanel() {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    const result = await supabase.rpc("security_dashboard" as never);
    if (result.error) throw new Error("تعذر تحميل سجل الأمان.");
    const data = result.data as unknown as { sessions: Session[]; events: Event[] };
    setSessions(data.sessions);
    setEvents(data.events);
  };
  useEffect(() => {
    const load = () => {
      void refresh().catch((e) => setError(e.message));
    };
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, []);
  const alerts = events.filter(
    (e) => e.severity !== "info" && Date.parse(e.created_at) > Date.now() - 86400000,
  );
  return (
    <section dir="rtl" className="border-b bg-card px-4 py-2 text-sm" aria-label="أمان الحساب">
      <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
        أمان الحساب والجلسات{alerts.length ? ` — ${alerts.length} حدثًا يستحق المراجعة` : ""}
      </Button>
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
      {open && (
        <div className="max-h-96 space-y-3 overflow-auto p-3">
          <p>
            راجع الأجهزة المسجلة، وأنهِ الجلسات الأخرى إن لم تتعرف عليها. سجل الأمان يعرض آخر 100
            حدث.
          </p>
          <Button
            disabled={busy}
            variant="outline"
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await supabase.auth.signOut({ scope: "others" });
                if (result.error) throw result.error;
                await refresh();
              } catch {
                setError("تعذر إنهاء الجلسات الأخرى. أعد المحاولة.");
              } finally {
                setBusy(false);
              }
            }}
          >
            إنهاء جميع الجلسات الأخرى
          </Button>
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id} className="rounded border p-2 break-words">
                {s.current ? "الجلسة الحالية" : "جلسة أخرى"} ·{" "}
                {new Date(s.created_at).toLocaleString("ar")} · <bdi>{s.ip}</bdi>
                <p dir="ltr">{s.user_agent}</p>
              </li>
            ))}
          </ul>
          {events.length > 0 && (
            <>
              <h2 className="font-bold">سجل الأمان</h2>
              <ul className="space-y-1">
                {events.map((e) => (
                  <li key={e.id}>
                    {new Date(e.created_at).toLocaleString("ar")} · <bdi>{e.event}</bdi> ·{" "}
                    <bdi>{e.actor_id ?? "خدمة النظام"}</bdi>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
