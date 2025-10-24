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

// LADBS inspections dataset (per your spec)
const LADBS_INSPECTIONS_URL = "https://data.lacity.org/resource/9w5z-rg2h.json";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 500), 1000);
  const pages = Math.min(Number(url.searchParams.get("pages") || 2), 200);
  const sinceOverride = url.searchParams.get("since"); // YYYY-MM-DD
  const dryRun = url.searchParams.get("dryRun") === "true";
  const startedAt = new Date().toISOString();

  try {
    // Watermark (by source column)
    const { data: wmRow, error: wmErr } = await supabase
      .from("etl_watermarks")
      .select("last_inspection_date")
      .eq("source", "LADBS_INSPECTIONS")
      .maybeSingle();
    if (wmErr) throw wmErr;

    const since =
      sinceOverride ||
      (wmRow?.last_inspection_date
        ? new Date(wmRow.last_inspection_date).toISOString().slice(0, 10)
        : "2020-01-01");

    // Jurisdiction id
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

      // Keep the select minimalist & robust to schema drift
      const params = new URLSearchParams({
        $limit: String(limit),
        $offset: String(offset),
        $order: "inspection_date ASC, permit_nbr ASC",
        $where: `inspection_date > '${since}'`,
        $select: [
          "permit_nbr",
          "inspection_date",
          "inspection_type",
          "result",
          "inspector",
        ].join(","),
      });

      const res = await fetch(`${LADBS_INSPECTIONS_URL}?${params.toString()}`);
      if (!res.ok) throw new Error(`LADBS inspections API error: ${res.status}`);
      const rows = (await res.json()) as any[];
      if (!rows?.length) break;

      // Transform -> our schema
      const toUpsert = rows
        .filter((r) => r.permit_nbr && r.inspection_date)
        .map((r) => {
          const dt: string = r.inspection_date;
          if (dt && (!maxInspectionDate || dt > maxInspectionDate)) {
            maxInspectionDate = dt;
          }
          // Normalize raw type now; norm happens later via map
          const raw = r.inspection_type || null;

          // best-effort: uppercase “PASS/FAIL/etc.”
          const result =
            (r.result || "").toString().trim().toUpperCase() || null;

          return {
            permit_number: r.permit_nbr,
            jurisdiction_id: jid,
            inspection_date: dt,
            inspection_type_raw: raw,
            inspection_type_norm: null, // filled by SQL using inspection_type_map
            result, // PASS|FAIL|CORRECTION|PARTIAL|CANCELLED|null
            inspector: r.inspector || null,
            created_at: new Date().toISOString(), // if your schema has it
          };
        });

      if (!dryRun && toUpsert.length) {
        const { error: insErr } = await supabase
          .from("inspections")
          .upsert(toUpsert, {
            onConflict: "permit_number,inspection_date,inspection_type_raw",
          });
        if (insErr) throw insErr;
      }

      imported += toUpsert.length;
      if (rows.length < limit) break;
    }

    // Advance inspections watermark
    if (!dryRun && maxInspectionDate) {
      // ensure a row exists
      const { error: upsertWmErr } = await supabase
        .from("etl_watermarks")
        .upsert(
          {
            source: "LADBS_INSPECTIONS",
            last_inspection_date: maxInspectionDate,
            last_issued_date: null,
          },
          { onConflict: "source" }
        );
      if (upsertWmErr) throw upsertWmErr;
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
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
