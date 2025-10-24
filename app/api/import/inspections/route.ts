// app/api/import/inspections/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- Supabase (service role for server-side writes) ----
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// LADBS Inspections (Socrata) dataset
// NOTE: field names: permit, inspection_date, inspection, inspection_result
const LADBS_INSPECTIONS_URL = "https://data.lacity.org/resource/9w5z-rg2h.json";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 500), 1000);
  const pages = Math.min(Number(url.searchParams.get("pages") || 2), 200);
  const sinceOverride = url.searchParams.get("since"); // YYYY-MM-DD
  const dryRun = url.searchParams.get("dryRun") === "true";
  const startedAt = new Date().toISOString();

  try {
    // 1) Read watermark (last_inspection_date) for LADBS_INSPECTIONS
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

    // 2) Get Los Angeles jurisdiction_id
    const { data: jRow, error: jErr } = await supabase
      .from("jurisdictions")
      .select("jurisdiction_id")
      .eq("name", "Los Angeles")
      .order("jurisdiction_id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (jErr) throw jErr;
    if (!jRow?.jurisdiction_id) {
      throw new Error("Missing jurisdiction 'Los Angeles'");
    }
    const jid = jRow.jurisdiction_id as number;

    let imported = 0;
    let maxInspectionDate: string | null = null;

    // 3) Page through the Socrata API
    for (let page = 0; page < pages; page++) {
      const offset = page * limit;

      const params = new URLSearchParams({
        $limit: String(limit),
        $offset: String(offset),
        $order: "inspection_date ASC, permit ASC",
        $where: `inspection_date > '${since}T00:00:00'`,
        $select: [
          "permit",             // permit number
          "inspection_date",    // timestamp
          "inspection",         // type/label
          "inspection_result"   // PASS/FAIL/etc.
          // (address, permit_status, lat_lon exist but not needed here)
        ].join(","),
      });

      const res = await fetch(`${LADBS_INSPECTIONS_URL}?${params.toString()}`);
      if (!res.ok) throw new Error(`LADBS inspections API error: ${res.status}`);
      const rows = (await res.json()) as any[];

      if (!rows?.length) break;

      // Transform to our schema
      const upserts = rows
        .filter((r) => r.permit && r.inspection_date)
        .map((r) => {
          const dt: string = r.inspection_date;
          if (dt && (!maxInspectionDate || dt > maxInspectionDate)) {
            maxInspectionDate = dt;
          }
          return {
            permit_number: r.permit,                       // FK to permits
            jurisdiction_id: jid,
            inspection_date: dt,
            inspection_type_raw: r.inspection || null,     // normalize later via inspection_type_map
            inspection_type_norm: null,                    // filled via SQL normalization step
            result: (r.inspection_result || "")
              .toString()
              .trim()
              .toUpperCase() || null,                      // PASS|FAIL|CORRECTION|PARTIAL|CANCELLED
            inspector: null                                // dataset doesn't provide inspector
          };
        });

      if (!dryRun && upserts.length) {
        const { error: insErr } = await supabase
          .from("inspections")
          .upsert(upserts, {
            onConflict: "permit_number,inspection_date,inspection_type_raw",
          });
        if (insErr) throw insErr;
      }

      imported += upserts.length;
      if (rows.length < limit) break; // no more pages
    }

    // 4) Advance inspections watermark
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

    // 5) Log job run (matches your etl_job_runs schema)
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
    // Failure log
    await supabase.from("etl_job_runs").insert({
      id: randomUUID(),
      job_name: "import_inspections",
      status: "FAILED",
      source: "LADBS_INSPECTIONS",
      rowcount: 0,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    return NextResponse.json(
      { error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
