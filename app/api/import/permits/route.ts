// app/api/import/permits/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// LADBS Socrata endpoint (2020+ permits)
const LADBS_URL = "https://data.lacity.org/resource/pi9x-tg5x.json";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 500), 1000);
  const pages = Math.min(Number(url.searchParams.get("pages") || 2), 200);
  const sinceOverride = url.searchParams.get("since");
  const dryRun = url.searchParams.get("dryRun") === "true";
  const startedAt = new Date().toISOString();

  try {
    // 1) Watermark (safe: maybeSingle)
    const { data: wm, error: wmErr } = await supabase
      .from("etl_watermarks")
      .select("last_issued_date")
      .eq("source_key", "LADBS_PERMITS")
      .maybeSingle();
    if (wmErr) throw wmErr;

    const since =
      sinceOverride ||
      (wm?.last_issued_date
        ? new Date(wm.last_issued_date).toISOString().slice(0, 10)
        : "2020-01-01");

    // 2) Jurisdiction (safe: order+limit+maybeSingle)
    const { data: jRow, error: jErr } = await supabase
      .from("jurisdictions")
      .select("jurisdiction_id, name")
      .eq("name", "Los Angeles")
      .order("jurisdiction_id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (jErr) throw jErr;
    if (!jRow?.jurisdiction_id) {
      throw new Error("Missing jurisdictions row for 'Los Angeles'");
    }
    const jid = jRow.jurisdiction_id as number;

    let imported = 0;
    let maxIssuedDate: string | null = null;

    // 3) Page through Socrata API
    for (let page = 0; page < pages; page++) {
      const offset = page * limit;
      const params = new URLSearchParams({
        $limit: String(limit),
        $offset: String(offset),
        $order: "issue_date ASC, permit_nbr ASC",
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

      const res = await fetch(`${LADBS_URL}?${params.toString()}`);
      if (!res.ok) throw new Error(`LADBS API error: ${res.status}`);
      const rows = (await res.json()) as any[];

      if (!rows?.length) break;

      const upserts = rows
        .filter((r) => r.permit_nbr)
        .map((r) => {
          const issuedISO: string | null = r.issue_date ?? null;
          if (issuedISO && (!maxIssuedDate || issuedISO > maxIssuedDate)) {
            maxIssuedDate = issuedISO;
          }

          const scope =
            (r.permit_type || "").toUpperCase().includes("NEW")
              ? "NEW"
              : (r.permit_type || "").toUpperCase().includes("ADDITION")
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
            address_std: (r.primary_address || "").toUpperCase() || null,
            zip_code: r.zip_code || null,
            pin_nbr: r.pin_nbr || r.apn || null,
            apc: r.apc || null,
            cpa: r.cpa || null,
            cnc: r.cnc || null,
            lat: r.lat ?? null,
            lon: r.lon ?? null,
            permit_scope: scope,
            is_adu: isAdu,
            adu_kind: aduKind,
            work_desc: r.work_desc || null,
            issued_date: issuedISO,
            sqft: r.square_footage ?? null,
            valuation: r.valuation ?? null,
            valuation_per_sqft:
              r.valuation && r.square_footage
                ? Math.round((r.valuation / Math.max(1, r.square_footage)) * 100) / 100
                : null,
            source_dataset: "LADBS_API",
            ingested_at: new Date().toISOString(),
          };
        });

      if (!dryRun && upserts.length) {
        const { error: upErr } = await supabase
          .from("permits")
          .upsert(upserts, { onConflict: "permit_number" });
        if (upErr) throw upErr;
      }

      imported += upserts.length;
      if (rows.length < limit) break;
    }

    // 4) Advance watermark
    if (!dryRun && maxIssuedDate) {
      const { error: wmUpdateErr } = await supabase
        .from("etl_watermarks")
        .update({
          last_issued_date: maxIssuedDate,
          updated_at: new Date().toISOString(),
          source: "LADBS_PERMITS",
          source_key: "LADBS_PERMITS",
        })
        .eq("source_key", "LADBS_PERMITS");
      if (wmUpdateErr) throw wmUpdateErr;
    }

    // 5) Job log (matches your table: id/uuid, job_name, status, source, rowcount, started_at, finished_at)
    await supabase.from("etl_job_runs").insert({
      id: randomUUID(),
      job_name: "import_permits",
      status: "SUCCESS",
      source: "LADBS_PERMITS",
      rowcount: imported,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    return NextResponse.json({ imported, since, dryRun });
  } catch (e: any) {
    // Failure log in your schema
    await supabase.from("etl_job_runs").insert({
      id: randomUUID(),
      job_name: "import_permits",
      status: "FAILED",
      source: "LADBS_PERMITS",
      rowcount: 0,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
