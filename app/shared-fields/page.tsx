"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { LandlordField } from "@/lib/landlord-field";
import LandlordFieldsSection from "@/app/components/LandlordFieldsSection";

export default function SharedFieldsPage() {
  const supabase = createClient();
  const [fields, setFields] = useState<LandlordField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("shared_fields")
        .select("*")
        .order("sort_order");

      const mapped: LandlordField[] = (data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        label: r.label as string,
        valueKind: r.value_kind as LandlordField["valueKind"],
        required: r.required as boolean,
        collectHint: (r.collect_hint as string | undefined) ?? undefined,
        options: (r.options as string[] | null) ?? undefined,
      }));
      setFields(mapped);
      setLoading(false);
    }
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const rows = fields.map((f, i) => ({
        id: f.id,
        user_id: user.id,
        label: f.label,
        value_kind: f.valueKind,
        required: f.required,
        collect_hint: f.collectHint ?? null,
        options: f.options ?? null,
        sort_order: i,
      }));

      const { error: delErr } = await supabase
        .from("shared_fields").delete().eq("user_id", user.id);
      if (delErr) { console.error("[shared-fields] delete:", delErr); return; }

      if (rows.length > 0) {
        // Deduplicate by id — keep last occurrence if duplicates exist
        const deduped = [...new Map(rows.map((r) => [r.id, r])).values()];
        const { error: insErr } = await supabase.from("shared_fields").insert(deduped);
        if (insErr) { console.error("[shared-fields] insert:", insErr); return; }
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f7f9f8]">
      <header className="border-b border-black/8 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-800 text-white">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="1" y="6" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 6V4.5a4 4 0 0 1 8 0V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <rect x="6.25" y="9.5" width="3.5" height="2.5" rx="0.75" fill="currentColor" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-[#1a2e2a]">RentScreen</span>
          </Link>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-[#1a2e2a]">Shared Questions</h1>
          <p className="mt-1 text-sm text-[#1a2e2a]/50">
            These questions appear across all your properties. Select which ones to include per property.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-foreground/40">Loading…</p>
        ) : (
          <LandlordFieldsSection fields={fields} onChange={setFields} />
        )}
      </div>
    </div>
  );
}
