// app/api/import/inspections/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// --- Supabase (server-side service role) ---
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// LADBS Inspections dataset (Socrata)
const LADBS_INSPECTIONS_URL = "https://data.lacity.org/resource/9w5z-rg2h.json";

// Normalize helper for key stability
function norm(v: any) {
  return (v ?? "").toString().trim().toUpperCase();
}

// Prefer a single “best” result if multiple collide for same key
const RESULT_RANK: Record<string, number> = {
  PASS: 5, PARTIAL: 4, CORRECTION: 3, FAIL: 2, CANCELLED: 1
};

// Pull a page of your own permit IDs from Supabase
async function fetchPermitIds(offset: number, batchSize: number, sinceIssued?: string): Promise<string[]> {
  // Only permits already in your DB; optionally filter by issued_date to reduce scope
  let q = supabase
    .from("permits")
    .select("permit_number", { count: "exact" })
    .order("permit_number", { ascending: true })
    .range(offset, offset + batchSize - 1);

  if (sinceIssued) {
    q = q.gte("issued_date", `${sinceIssued}T00:00:00`);
  }

  const { data, error } = await q;
  if (error) throw error;

  return (data || []).map((r: any) => r.permit_number).filter(Boolean);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  // Controls
  const dryRun = url.searchParams.get("dryRun") === "true";
  const sinceInspections = url.searchParams.get("since") || null;      // YYYY-MM-DD (inspection_date lower bound)
  const sinceIssued = url.searchParams.get("sinceIssued") || null;     // YYYY-MM-DD (limit which permit IDs to include)
  const idBatch = Math.min(Number(url.searchParams.get("idBatch") || 200), 500);          // number of permit IDs per Socrata query
  const maxPermitPages = Math.min(Number(url.searchParams.get("permitPages") || 50), 200); // how many pages of your permit IDs to scan
  const perRequestLimit = Math.min(Number(url.searchParams.get("limit") || 1000), 1000);   // Socrata $limit per request
  const perRequestPages = Math.min(Number(url.searchParams.get("pagesPerIdBatch") || 3), 20); // number of Socrata pages per ID batch

  const startedAt = new Date().toISOString();

  try {
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

    let totalImported = 0;
    let totalSkipped = 0;
    let maxInspectionDate: string | null = null;

    // Iterate over your own permit IDs in pages
    for (let permitPage = 0; permitPage < maxPermitPages; permitPage++) {
      const ids = await fetchPermitIds(permitPage * idBatch, idBatch, sinceIssued || undefined);
      if (!ids.length) break;

      // Build Socrata $where: permit IN ('id1','id2',...) [AND inspection_date > 'YYYY-MM-DDT00:00:00']
      const quoted = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
      const whereParts = [`permit in (${quoted})`];
      if (sinceInspections) whereParts.push(`inspection_date > '${sinceInspections}T00:00:00'`);
      const where = whereParts.join(" AND ");

      // Page through Socrata for this ID batch
      for (let p = 0; p < perRequestPages; p++) {
        const offset = p * perRequestLimit;
        const params = new URLSearchParams({
          $limit: String(perRequestLimit),
          $offset: String(offset),
          $order: "inspection_date ASC, permit ASC",
          $where: where,
          $select: ["permit", "inspection_date", "inspection", "inspection_result"].join(","),
        });

        const res = await fetch(`${LADBS_INSPECTIONS_URL}?${params.toString()}`);
        if (!res.ok) throw new Error(`LADBS inspections API error: ${res.status}`);
        const rows = (await res.json()) as any[];
        if (!rows?.length) break;

        // Deduplicate by (permit, inspection_date, normalized inspection)
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

        const upserts = Array.from(seen.values()).map((v) => ({
          permit_number: v.permit,
          jurisdiction_id: jid,
          inspection_date: v.dt,
          inspection_type_raw: v.t,   // normalized for key stability
          inspection_type_norm: null, // filled later via SQL map
          result: v.result || null,
          inspector: null,
          created_at: new Date().toISOString(),
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

        // If fewer than limit came back, no more pages for this ID batch
        if (rows.length < perRequestLimit) break;
      }
    }

    // Watermark (for inspections)
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

    // Job log
    await supabase.from("etl_job_runs").insert({
      id: randomUUID(),
      job_name: "import_inspections",
      status: "SUCCESS",
      source: "LADBS_INSPECTIONS",
      rowcount: totalImported,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    return NextResponse.json({
      imported: totalImported,
      sinceInspections,
      sinceIssued,
      dryRun,
    });
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
      message: (e?.message || "").slice(0, 500),
    });

    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
