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

const LADBS_INSPECTIONS_URL = "https://data.lacity.org/resource/9w5z-rg2h.json";

// Normalize text for stable keys
function norm(v: any) {
  return (v ?? "").toString().trim().toUpperCase();
}

// Prefer a single “best” result if multiple collide for same key
const RESULT_RANK: Record<string, number> = {
  PASS: 5, PARTIAL: 4, CORRECTION: 3, FAIL: 2, CANCELLED: 1
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 500), 1000);
  const pages = Math.min(Number(url.searchParams.get("pages") || 2), 200);
  const sinceOverride = url.searchParams.get("since"); // YYYY-MM-DD
  const dryRun = url.searchParams.get("dryRun") === "true";
  const startedAt = new Date().toISOString();

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

    let imported = 0;
    let maxInspectionDate: string | null = null;

    for (let page = 0; page < pages; page++) {
      const offset = page * limit;

      const params = new URLSearchParams({
        $limit: String(limit),
        $offset: String(offset),
        $order: "inspection_date ASC, permit ASC",
        $where: `inspection_date > '${since}T00:00:00'`,
        $select: [
          "permit",
          "inspection_date",
          "inspection",
          "inspection_result"
        ].join(","),
      });

      const res = await fetch(`${LADBS_INSPECTIONS_URL}?${params.toString()}`);
      if (!res.ok) throw new Error(`LADBS inspections API error: ${res.status}`);
      const rows = (await res.json()) as any[];
      if (!rows?.length) break;

      // Deduplicate per page by (permit, inspection_date, normalized inspection)
      const seen = new Map<string, { permit: string; dt: string; t: string; result: string }>();

      for (const r of rows) {
        if (!r.permit || !r.inspection_date) continue;
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

      const upserts = Array.from(seen.values()).map(v => ({
        permit_number: v.permit,
        jurisdiction_id: jid,
        inspection_date: v.dt,
        inspection_type_raw: v.t,   // normalized for key stability
        inspection_type_norm: null, // filled later via SQL map
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

      imported += upserts.length;
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
      rowcount: imported,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    return NextResponse.json({ imported, since, dryRun });
  } catch (e: any) {
    await supabase.from("etl_job_runs").insert({
      id: randomUUID(),
      job_name: "import_inspections",
      status: "FAILED",
      source: "LADBS_INSPECTIONS",
      rowcount: 0,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    });
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
