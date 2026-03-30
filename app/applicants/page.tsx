"use client";

import { Fragment, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

type Session = {
  id: string;
  listing_title: string;
  status: string | null;
  answers: Record<string, string>;
  message_count: number;
  created_at: string;
  updated_at: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

const STATUS_OPTIONS = ["all", "qualified", "rejected", "in_progress"] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number];

function badge(status: string | null) {
  if (status === "qualified")
    return <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-800">qualified</span>;
  if (status === "rejected")
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">rejected</span>;
  return <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">in progress</span>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

type ExpandedPanel = { type: "answers" | "chat"; sessionId: string };

export default function ApplicantsPage() {
  const supabase = createClient();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expanded, setExpanded] = useState<ExpandedPanel | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  const propertyId = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("property")
    : null;

  useEffect(() => {
    async function load() {
      setLoading(true);
      let query = supabase
        .from("sessions")
        .select("*")
        .order("created_at", { ascending: false });

      if (propertyId) query = query.eq("property_id", propertyId);

      const { data, error } = await query;
      if (error) { setError(error.message); }
      else { setSessions((data as Session[]) ?? []); }
      setLoading(false);
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePanel(sessionId: string, type: "answers" | "chat") {
    if (expanded?.sessionId === sessionId && expanded.type === type) {
      setExpanded(null);
      return;
    }
    setExpanded({ type, sessionId });

    if (type === "chat") {
      setChatLoading(true);
      setChatMessages([]);
      supabase
        .from("messages")
        .select("id,role,content,created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true })
        .then(({ data }) => {
          setChatMessages((data as ChatMessage[]) ?? []);
          setChatLoading(false);
        });
    }
  }

  const visible = sessions.filter((s) => {
    if (filter === "all") return true;
    if (filter === "in_progress") return s.status === "in_progress" || !s.status;
    return s.status === filter;
  });

  return (
    <main className="min-h-screen bg-[#f7f9f8] p-6 sm:p-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[#1a2e2a]">Applicants</h1>
            <p className="mt-0.5 text-sm text-[#1a2e2a]/50">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""} total
            </p>
          </div>
          <Link href="/"
            className="rounded-lg border border-[#1a2e2a]/15 px-4 py-1.5 text-sm text-[#1a2e2a]/60 transition-colors hover:bg-white">
            ← Properties
          </Link>
        </div>

        <div className="mb-4 flex gap-1">
          {STATUS_OPTIONS.map((opt) => (
            <button key={opt} onClick={() => setFilter(opt)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === opt
                  ? "bg-[#1a2e2a] text-white"
                  : "text-[#1a2e2a]/50 hover:bg-white hover:text-[#1a2e2a]"
              }`}>
              {opt === "in_progress" ? "in progress" : opt}
            </button>
          ))}
        </div>

        {loading && <p className="text-sm text-[#1a2e2a]/50">Loading…</p>}
        {error && <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {!loading && !error && visible.length === 0 && (
          <p className="text-sm text-[#1a2e2a]/40">No applicants yet for this filter.</p>
        )}

        {!loading && !error && visible.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-[#1a2e2a]/10 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1a2e2a]/8 bg-[#f7f9f8] text-left text-[11px] font-semibold uppercase tracking-wider text-[#1a2e2a]/40">
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Listing</th>
                  <th className="px-4 py-3">Messages</th>
                  <th className="px-4 py-3">Started</th>
                  <th className="px-4 py-3">Updated</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <Fragment key={s.id}>
                    <tr className="border-b border-[#1a2e2a]/6 last:border-0 hover:bg-[#f7f9f8]">
                      <td className="px-4 py-3">{badge(s.status)}</td>
                      <td className="px-4 py-3 font-medium text-[#1a2e2a]">{s.listing_title}</td>
                      <td className="px-4 py-3 text-[#1a2e2a]/60">{s.message_count}</td>
                      <td className="px-4 py-3 text-[#1a2e2a]/50">{formatDate(s.created_at)}</td>
                      <td className="px-4 py-3 text-[#1a2e2a]/50">{formatDate(s.updated_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <button onClick={() => togglePanel(s.id, "answers")}
                            className={`text-[11px] font-medium hover:underline ${
                              expanded?.sessionId === s.id && expanded.type === "answers"
                                ? "text-[#1a2e2a]" : "text-teal-700"
                            }`}>
                            {expanded?.sessionId === s.id && expanded.type === "answers" ? "hide" : "answers"}
                          </button>
                          <button onClick={() => togglePanel(s.id, "chat")}
                            className={`text-[11px] font-medium hover:underline ${
                              expanded?.sessionId === s.id && expanded.type === "chat"
                                ? "text-[#1a2e2a]" : "text-teal-700"
                            }`}>
                            {expanded?.sessionId === s.id && expanded.type === "chat" ? "hide" : "chat log"}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Answers panel */}
                    {expanded?.sessionId === s.id && expanded.type === "answers" && (
                      <tr className="border-b border-[#1a2e2a]/6 bg-[#f7f9f8]">
                        <td colSpan={6} className="px-4 py-3">
                          {Object.keys(s.answers).length === 0 ? (
                            <p className="text-[11px] text-[#1a2e2a]/40">No answers collected yet.</p>
                          ) : (
                            <dl className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3">
                              {Object.entries(s.answers).map(([k, v]) => (
                                <div key={k}>
                                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-[#1a2e2a]/40">{k}</dt>
                                  <dd className="text-[13px] text-[#1a2e2a]/80">{String(v)}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </td>
                      </tr>
                    )}

                    {/* Chat log panel */}
                    {expanded?.sessionId === s.id && expanded.type === "chat" && (
                      <tr className="border-b border-[#1a2e2a]/6 bg-[#f7f9f8]">
                        <td colSpan={6} className="px-4 py-4">
                          {chatLoading ? (
                            <p className="text-[11px] text-[#1a2e2a]/40">Loading chat…</p>
                          ) : chatMessages.length === 0 ? (
                            <p className="text-[11px] text-[#1a2e2a]/40">No messages recorded.</p>
                          ) : (
                            <div className="max-h-96 space-y-3 overflow-y-auto">
                              {chatMessages.map((m) => (
                                <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                                  <div className={`max-w-[70%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                                    m.role === "user"
                                      ? "bg-teal-800 text-white"
                                      : "bg-white text-[#1a2e2a] shadow-sm ring-1 ring-black/5"
                                  }`}>
                                    <p className="whitespace-pre-wrap">{m.content}</p>
                                    <p className={`mt-1 text-[9px] ${
                                      m.role === "user" ? "text-white/50" : "text-[#1a2e2a]/30"
                                    }`}>
                                      {formatDate(m.created_at)}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
