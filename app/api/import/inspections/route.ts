// app/api/import/inspections/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// LADBS inspections dataset
const LADBS_INSPECTIONS_URL = "https://data.lacity.org/resource/9w5z-rg2h.json";

// Normalize helper
function norm(v: any) {
  return (v ?? "").toString().trim().toUpperCase();
}

// Prefer a single “best” result if multiple collide for same key
const RESULT_RANK: Record<string, number> = {
  PASS: 5, PARTIAL: 4, CORRECTION: 3, FAIL: 2, CANCELLED: 1
};

// Fetch existing permits for a list of IDs (chunked to avoid URL length limits)
async function fetchExistingPermits(permitIds: string[]): Promise<Set<string>> {
  const exists = new Set<string>();
  const chunkSize = 500; // safe chunk size for .in()
  for (let i = 0; i < permitIds.length; i += chunkSize) {
    const chunk = permitIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("permits")
      .select("permit_number")
      .in("permit_number", chunk);
    if (error) throw error;
    (data || []).forEach((r: any) => exists.add(r.permit_number));
  }
  return exists;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 500), 1000);
  const pages = Math.min(Number(url.searchParams.get("pages") || 2), 200);
  const sinceOverride = url.searchParams.get("since"); // YYYY-MM-DD
  const dryRun = url.searchParams.get("dryRun") === "true";
  const startedAt = new Date().toISOString();

  let totalImported = 0;
  let totalSkippedNoPermit = 0;
  let maxInspectionDate: string | null = null;

  try {
    // Watermark
    const { data: wm, error: wmErr } = await supabase
      .from("etl_watermarks")
      .select("last_inspection_date")
      .eq("source", "LADBS_INSPECTIONS")
      .maybeSingle();
    if (wmErr) throw wmErr;

    const since =
      sinceOverride ||
      (wm?.last_inspection_date
        ? new Date(wm.last_inspection_date).toISOString().slice(0, 10)
        : "2020-01-01");

    // Jurisdiction
    const { data: jRow, error: jErr } = await supabase
      .from("jurisdictions")
      .select("jurisdiction_id")
      .eq("name", "Los Angeles")
      .order("jurisdiction_id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (jErr) throw jErr;
    if (!jRow?.jurisdiction_id) throw new Error("Missing jurisdiction 'Los Angeles'");
    const jid = jRow.jurisdiction_id as number;

    for (let page = 0; page < pages; page++) {
      const offset = page * limit;

      // Pull a page from Socrata
      const params = new URLSearchParams({
        $limit: String(limit),
        $offset: String(offset),
        $order: "inspection_date ASC, permit ASC",
        $where: `inspection_date > '${since}T00:00:00'`,
        $select: ["permit", "inspection_date", "inspection", "inspection_result"].join(","),
      });

      const res = await fetch(`${LADBS_INSPECTIONS_URL}?${params.toString()}`);
      if (!res.ok) throw new Error(`LADBS inspections API error: ${res.status}`);
      const rows = (await res.json()) as any[];
      if (!rows?.length) break;

      // Deduplicate per page by (permit, inspection_date, normalized inspection)
      const seen = new Map<string, { permit: string; dt: string; t: string; result: string }>();
      const permitsOnPage = new Set<string>();

      for (const r of rows) {
        if (!r.permit || !r.inspection_date) continue;
        permitsOnPage.add(r.permit);
        const dt = r.inspection_date as string;
        if (dt && (!maxInspectionDate || dt > maxInspectionDate)) maxInspectionDate = dt;

        const t = norm(r.inspection);
        const result = norm(r.inspection_result);
        const key = `${r.permit}|${dt}|${t}`;

        const current = seen.get(key);
        if (!current) {
          seen.set(key, { permit: r.permit, dt, t, result });
        } else {
          const currRank = RESULT_RANK[current.result] ?? 0;
          const newRank = RESULT_RANK[result] ?? 0;
          if (newRank > currRank) seen.set(key, { permit: r.permit, dt, t, result });
        }
      }

      // FK safety: only keep those whose permit exists in our DB
      const existing = await fetchExistingPermits(Array.from(permitsOnPage));
      const filtered = Array.from(seen.values()).filter(v => existing.has(v.permit));
      const pageSkipped = seen.size - filtered.length;
      totalSkippedNoPermit += pageSkipped;

      const upserts = filtered.map(v => ({
        permit_number: v.permit,
        jurisdiction_id: jid,
        inspection_date: v.dt,
        inspection_type_raw: v.t,   // normalized for key stability
        inspection_type_norm: null, // will fill later via SQL map
        result: v.result || null,
        inspector: null
      }));

      if (!dryRun && upserts.length) {
        const { error: insErr } = await supabase
          .from("inspections")
          .upsert(upserts, {
            onConflict: "permit_number,inspection_date,inspection_type_raw",
          });
        if (insErr) throw insErr;
      }

      totalImported += upserts.length;
      if (rows.length < limit) break;
    }

    // Advance watermark
    if (!dryRun && maxInspectionDate) {
      const { error: wmUpsertErr } = await supabase
        .from("etl_watermarks")
        .upsert(
          {
            source: "LADBS_INSPECTIONS",
            last_inspection_date: maxInspectionDate,
            last_issued_date: null,
          },
          { onConflict: "source" }
        );
      if (wmUpsertErr) throw wmUpsertErr;
    }

    // Log success
    await supabase.from("etl_job_runs").insert({
      id: randomUUID(),
      job_name: "import_inspections",
      status: "SUCCESS",
      source: "LADBS_INSPECTIONS",
      rowcount: totalImported,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      // optional: store skipped for your reference
      // @ts-ignore - depending on your schema
      message: `skipped_no_permit=${totalSkippedNoPermit}`
    });

    return NextResponse.json({ imported: totalImported, skippedNoPermit: totalSkippedNoPermit, since, dryRun });
  } catch (e: any) {
    await supabase.from("etl_job_runs").insert({
      id: randomUUID(),
      job_name: "import_inspections",
      status: "FAILED",
      source: "LADBS_INSPECTIONS",
      rowcount: 0,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      // @ts-ignore
      message: (e?.message || "").slice(0, 500)
    });
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
