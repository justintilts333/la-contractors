// app/api/import/permits/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// --- Initialize Supabase ---
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// LADBS Socrata endpoint (2020+ permits)
const LADBS_URL = "https://data.lacity.org/resource/pi9x-tg5x.json";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") || 500);
  const pages = Number(url.searchParams.get("pages") || 2);
  const sinceOverride = url.searchParams.get("since");
  const dryRun = url.searchParams.get("dryRun") === "true";
  const startedAt = new Date().toISOString();

  try {
    // 1️⃣ Read the current watermark
    const { data: wm, error: wmErr } = await supabase
      .from("etl_watermarks")
      .select("last_issued_date")
      .eq("source_key", "LADBS_PERMITS")
      .single();

    if (wmErr) throw wmErr;

    const since =
      sinceOverride ||
      (wm?.last_issued_date
        ? wm.last_issued_date.split("T")[0]
        : "2020-01-01");

    console.log("Importing LADBS permits since:", since);

    // 2️⃣ Get Los Angeles jurisdiction_id
    const { data: jRow, error: jErr } = await supabase
      .from("jurisdictions")
      .select("jurisdiction_id")
      .eq("name", "Los Angeles")
      .single();
    if (jErr) throw jErr;
    const jid = jRow.jurisdiction_id;

    let imported = 0;
    let maxIssuedDate: string | null = null;

    // 3️⃣ Page through Socrata API
    for (let page = 0; page < pages; page++) {
      const offset = page * limit;
      const query = new URLSearchParams({
        $limit: limit.toString(),
        $offset: offset.toString(),
        $order: "issue_date ASC",
        $where: `issue_date > '${since}'`,
        $select: [
          "permit_nbr",
          "primary_address",
          "zip_code",
          "issue_date",
          "valuation",
          "permit_type",
          "square_footage",
          "apn",
          "pin_nbr",
          "apc",
          "cpa",
          "cnc",
          "lat",
          "lon",
          "work_desc",
          "status_date",
        ].join(","),
      });

      const res = await fetch(`${LADBS_URL}?${query.toString()}`);
      if (!res.ok) throw new Error(`LADBS API error: ${res.status}`);
      const rows = await res.json();

      if (rows.length === 0) break;

      const upserts = rows.map((r: any) => {
        const issued = r.issue_date ? new Date(r.issue_date) : null;
        if (issued && (!maxIssuedDate || issued > new Date(maxIssuedDate))) {
          maxIssuedDate = issued.toISOString();
        }

        // Simple scope logic
        const scope = r.permit_type?.toUpperCase().includes("NEW")
          ? "NEW"
          : r.permit_type?.toUpperCase().includes("ADDITION")
          ? "ADDITION"
          : "ALTERATION";

        const isAdu = /ADU/i.test(r.work_desc || "");
        const aduKind = /JADU/i.test(r.work_desc || "")
          ? "JADU"
          : isAdu
          ? "ADU"
          : null;

        return {
          permit_number: r.permit_nbr,
          jurisdiction_id: jid,
          primary_address: r.primary_address || null,
          address_std: (r.primary_address || "").toUpperCase(),
          zip_code: r.zip_code,
          pin_nbr: r.pin_nbr || r.apn,
          apc: r.apc,
          cpa: r.cpa,
          cnc: r.cnc,
          lat: r.lat,
          lon: r.lon,
          permit_scope: scope,
          is_adu: isAdu,
          adu_kind: aduKind,
          work_desc: r.work_desc,
          issued_date: r.issue_date,
          sqft: r.square_footage,
          valuation: r.valuation,
          valuation_per_sqft:
            r.valuation && r.square_footage
              ? Math.round(r.valuation / r.square_footage)
              : null,
          source_dataset: "LADBS_API",
          ingested_at: new Date().toISOString(),
        };
      });

      if (!dryRun) {
        const { error: upErr } = await supabase
          .from("permits")
          .upsert(upserts, { onConflict: "permit_number" });
        if (upErr) throw upErr;
      }

      imported += upserts.length;
      if (rows.length < limit) break; // no more pages
    }

    // 4️⃣ Update watermark if we imported real data
    if (!dryRun && maxIssuedDate) {
      const { error: updateErr } = await supabase
        .from("etl_watermarks")
        .update({
          last_issued_date: maxIssuedDate,
          updated_at: new Date().toISOString(),
        })
        .eq("source_key", "LADBS_PERMITS");
      if (updateErr) throw updateErr;
    }

    // 5️⃣ Log job run
    await supabase.from("etl_job_runs").insert({
      source_key: "LADBS_PERMITS",
      job_type: "import",
      row_count: imported,
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      status: "SUCCESS",
    });

    return NextResponse.json({ imported, since, dryRun });
  } catch (err: any) {
    console.error("Import error:", err.message);
    await supabase.from("etl_job_runs").insert({
      source_key: "LADBS_PERMITS",
      job_type: "import",
      status: "FAILED",
      message: err.message,
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
