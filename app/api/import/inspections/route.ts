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

// ---------- helpers ----------
const norm = (v: any) => (v ?? "").toString().trim().toUpperCase();
const RESULT_RANK: Record<string, number> = { PASS: 5, PARTIAL: 4, CORRECTION: 3, FAIL: 2, CANCELLED: 1 };

// produce likely LADBS variants from a LA permit id like 22010-10000-03174
function generatePermitVariants(id: string): string[] {
  const raw = id.trim();
  const noDash = raw.replace(/-/g, "");
  // trim leading zeros in each dash-separated segment, keep at least 1 digit
  const segTrim = raw
    .split("-")
    .map(seg => seg.replace(/^0+/, "") || "0")
    .join("-");
  const uniq = new Set<string>([raw, noDash, segTrim]);
  return Array.from(uniq);
}

function whereForVariants(variants: string[], sinceInspections?: string) {
  // build: permit in ('A','B',...) [AND inspection_date > ...]
  const quoted = variants.map(v => `'${v.replace(/'/g, "''")}'`).join(",");
  const parts = [`permit in (${quoted})`];
  if (sinceInspections) parts.push(`inspection_date > '${sinceInspections}T00:00:00'`);
  return parts.join(" AND ");
}

async function getJurisdictionId(): Promise<number> {
  const { data, error } = await supabase
    .from("jurisdictions")
    .select("jurisdiction_id")
    .eq("name", "Los Angeles")
    .order("jurisdiction_id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.jurisdiction_id) throw new Error("Missing jurisdiction 'Los Angeles'");
  return data.jurisdiction_id as number;
}

async function fetchPermitIds(offset: number, batchSize: number, sinceIssued?: string): Promise<string[]> {
  let q = supabase
    .from("permits")
    .select("permit_number", { count: "exact" })
    .order("permit_number", { ascending: true })
    .range(offset, offset + batchSize - 1);
  if (sinceIssued) q = q.gte("issued_date", `${sinceIssued}T00:00:00`);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map((r: any) => r.permit_number).filter(Boolean);
}

function dedupeRows(rows: any[]) {
  const seen = new Map<string, { permit: string; dt: string; t: string; result: string }>();
  for (const r of rows) {
    if (!r.permit || !r.inspection_date) continue;
    const permit: string = r.permit;
    const dt: string = r.inspection_date;
    const t: string = norm(r.inspection);
    const result: string = norm(r.inspection_result);
    const key = `${permit}|${dt}|${t}`;
    const cur = seen.get(key);
    if (!cur) {
      seen.set(key, { permit, dt, t, result });
    } else {
      const currRank = RESULT_RANK[cur.result] ?? 0;
      const newRank = RESULT_RANK[result] ?? 0;
      if (newRank > currRank) seen.set(key, { permit, dt, t, result });
    }
  }
  return Array.from(seen.values());
}

// ---------- handler ----------
export async function GET(req: Request) {
  const url = new URL(req.url);

  // Controls
  const dryRun            = url.searchParams.get("dryRun") === "true";
  const sinceInspections  = url.searchParams.get("since") || "2010-01-01";
  const sinceIssued       = url.searchParams.get("sinceIssued") || null;
  const idBatch           = Math.min(Number(url.searchParams.get("idBatch") || 200), 500);
  const maxPermitPages    = Math.min(Number(url.searchParams.get("permitPages") || 50), 200);
  const perReqLimit       = Math.min(Number(url.searchParams.get("limit") || 1000), 1000);
  const perReqPages       = Math.min(Number(url.searchParams.get("pagesPerIdBatch") || 3), 20);

  // Probe mode
  const probe             = url.searchParams.get("probe") === "true";
  const probePermit       = url.searchParams.get("permit") || null;

  const startedAt = new Date().toISOString();

  try {
    const jid = await getJurisdictionId();

    // ---------- PROBE: try multiple variants for a single permit ----------
    if (probe) {
      if (!probePermit) {
        return NextResponse.json({ error: "probe=true requires ?permit=<PERMIT_NUMBER>" }, { status: 400 });
      }
      const variants = generatePermitVariants(probePermit);
      const where = whereForVariants(variants, sinceInspections);
      const params = new URLSearchParams({
        $limit: String(perReqLimit),
        $offset: "0",
        $order: "inspection_date ASC, permit ASC",
        $where: where,
        $select: ["permit", "inspection_date", "inspection", "inspection_result"].join(","),
      });
      const res = await fetch(`${LADBS_INSPECTIONS_URL}?${params.toString()}`);
      if (!res.ok) throw new Error(`LADBS inspections API error: ${res.status}`);
      const rows = (await res.json()) as any[];
      const deduped = dedupeRows(rows);
      const sample = deduped.slice(0, 10);
      return NextResponse.json({
        probe: true,
        permit: probePermit,
        variants,
        sinceInspections,
        rawCount: rows.length,
        dedupedCount: deduped.length,
        sample
      });
    }

    // ---------- BULK: iterate across your own permits, query by variant list ----------
    let totalImported = 0;
    let maxInspectionDate: string | null = null;

    for (let permitPage = 0; permitPage < maxPermitPages; permitPage++) {
      const ids = await fetchPermitIds(permitPage * idBatch, idBatch, sinceIssued || undefined);
      if (!ids.length) break;

      // expand each id to variants, but keep overall IN(...) size reasonable
      // cap variants per ID at 3 (raw, noDash, segTrim)
      const expanded: string[] = [];
      for (const id of ids) {
        const vars = generatePermitVariants(id);
        for (const v of vars) expanded.push(v);
      }

      // Page through Socrata per expanded variant list
      for (let p = 0; p < perReqPages; p++) {
        const offset = p * perReqLimit;
        const where = whereForVariants(expanded, sinceInspections);
        const params = new URLSearchParams({
          $limit: String(perReqLimit),
          $offset: String(offset),
          $order: "inspection_date ASC, permit ASC",
          $where: where,
          $select: ["permit", "inspection_date", "inspection", "inspection_result"].join(","),
        });

        const res = await fetch(`${LADBS_INSPECTIONS_URL}?${params.toString()}`);
        if (!res.ok) throw new Error(`LADBS inspections API error: ${res.status}`);
        const rows = (await res.json()) as any[];
        if (!rows?.length) break;

        const deduped = dedupeRows(rows);
        const upserts = deduped.map(v => {
          if (v.dt && (!maxInspectionDate || v.dt > maxInspectionDate)) maxInspectionDate = v.dt;
          return {
            permit_number: v.permit,          // NOTE: we store Socrata's 'permit' as-is (variant may differ from our raw)
            jurisdiction_id: jid,
            inspection_date: v.dt,
            inspection_type_raw: v.t,         // normalized for key stability
            inspection_type_norm: null,       // will be filled via SQL map
            result: v.result || null,
            inspector: null,
            created_at: new Date().toISOString(),
          };
        });

        if (!dryRun && upserts.length) {
          const { error: insErr } = await supabase
            .from("inspections")
            .upsert(upserts, { onConflict: "permit_number,inspection_date,inspection_type_raw" });
          if (insErr) throw insErr;
        }

        totalImported += upserts.length;
        if (rows.length < perReqLimit) break;
      }
    }

    // watermark
    if (!dryRun && maxInspectionDate) {
      const { error: wmUpsertErr } = await supabase
        .from("etl_watermarks")
        .upsert(
          { source: "LADBS_INSPECTIONS", last_inspection_date: maxInspectionDate, last_issued_date: null },
          { onConflict: "source" }
        );
      if (wmUpsertErr) throw wmUpsertErr;
    }

    // log
    await supabase.from("etl_job_runs").insert({
      id: randomUUID(),
      job_name: "import_inspections",
      status: "SUCCESS",
      source: "LADBS_INSPECTIONS",
      rowcount: totalImported,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    return NextResponse.json({ imported: totalImported, sinceInspections, sinceIssued, dryRun });
  } catch (e: any) {
    await supabase.from("etl_job_runs").insert({
      id: randomUUID(),
      job_name: "import_inspections",
      status: "FAILED",
      source: "LADBS_INSPECTIONS",
      rowcount: 0,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      // @ts-ignore
      message: (e?.message || "").slice(0, 500),
    });
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
