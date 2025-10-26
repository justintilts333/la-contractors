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

// ---------- helpers ----------
const norm = (v: any) => (v ?? "").toString().trim().toUpperCase();
const RESULT_RANK: Record<string, number> = { PASS: 5, PARTIAL: 4, CORRECTION: 3, FAIL: 2, CANCELLED: 1 };

// produce likely LADBS variants from a LA permit id like 21016-10000-52943
function generatePermitVariants(id: string): string[] {
  const raw = id.trim();
  const noDash = raw.replace(/-/g, "");
  const segTrim = raw
    .split("-")
    .map(seg => seg.replace(/^0+/, "") || "0")
    .join("-");
  const uniq = new Set<string>([raw, noDash, segTrim]);
  return Array.from(uniq);
}

function socrataUrl(params: Record<string, string>) {
  const usp = new URLSearchParams(params);
  return `${LADBS_INSPECTIONS_URL}?${usp.toString()}`;
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
    const permit: string = r.permit.toString();
    const dt: string = r.inspection_date;
    const t: string = norm(r.inspection);
    const result: string = norm(r.inspection_result);
    const key = `${permit}|${dt}|${t}`;
    const cur = seen.get(key);
    if (!cur) {
      seen.set(key, { permit, dt, t, result });
    } else {
      const currRank = RESULT_RANK[cur.result] ?? 0;
      const newRank  = RESULT_RANK[result] ?? 0;
      if (newRank > currRank) seen.set(key, { permit, dt, t, result });
    }
  }
  return Array.from(seen.values());
}

// One-variant fetch using different SoQL strategies
async function fetchByVariant(variant: string, sinceInspections: string, limit: number) {
  const tried: string[] = [];
  const select = ["permit", "inspection_date", "inspection", "inspection_result"].join(",");

  // Strategy 1: exact equality on permit
  {
    const where = `permit = '${variant.replace(/'/g, "''")}' AND inspection_date > '${sinceInspections}T00:00:00'`;
    const url = socrataUrl({ $limit: String(limit), $offset: "0", $order: "inspection_date ASC, permit ASC", $select: select, $where: where });
    tried.push(url);
    const r = await fetch(url);
    if (r.ok) {
      const rows = (await r.json()) as any[];
      if (rows?.length) return { rows, tried };
    }
  }

  // Strategy 2: case-insensitive equality using upper()
  {
    const where = `upper(permit) = upper('${variant.replace(/'/g, "''")}') AND inspection_date > '${sinceInspections}T00:00:00'`;
    const url = socrataUrl({ $limit: String(limit), $offset: "0", $order: "inspection_date ASC, permit ASC", $select: select, $where: where });
    tried.push(url);
    const r = await fetch(url);
    if (r.ok) {
      const rows = (await r.json()) as any[];
      if (rows?.length) return { rows, tried };
    }
  }

  // Strategy 3: full-text fallback $q (Socrata search)
  {
    const url = socrataUrl({ $limit: String(limit), $offset: "0", $order: "inspection_date ASC, permit ASC", $select: select, $q: variant });
    tried.push(url);
    const r = await fetch(url);
    if (r.ok) {
      const rows = (await r.json()) as any[];
      if (rows?.length) return { rows, tried };
    }
  }

  return { rows: [] as any[], tried };
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const dryRun            = url.searchParams.get("dryRun") === "true";
  const sinceInspections  = url.searchParams.get("since") || "2010-01-01";
  const sinceIssued       = url.searchParams.get("sinceIssued") || null;

  const idBatch           = Math.min(Number(url.searchParams.get("idBatch") || 200), 500);
  const maxPermitPages    = Math.min(Number(url.searchParams.get("permitPages") || 50), 200);
  const perReqLimit       = Math.min(Number(url.searchParams.get("limit") || 1000), 1000);
  const perReqPages       = Math.min(Number(url.searchParams.get("pagesPerIdBatch") || 2), 20);

  const probe             = url.searchParams.get("probe") === "true";
  const probePermit       = url.searchParams.get("permit") || null;

  const startedAt = new Date().toISOString();

  try {
    const jid = await getJurisdictionId();

    // ---------- PROBE: show exactly what we queried ----------
    if (probe) {
      if (!probePermit) {
        return NextResponse.json({ error: "probe=true requires ?permit=<PERMIT_NUMBER>" }, { status: 400 });
      }
      const variants = generatePermitVariants(probePermit);
      let rawCount = 0;
      const attempts: Array<{ variant: string; tried: string[]; count: number; sample: any[] }> = [];

      for (const v of variants) {
        const { rows, tried } = await fetchByVariant(v, sinceInspections, perReqLimit);
        const deduped = dedupeRows(rows);
        attempts.push({ variant: v, tried, count: deduped.length, sample: deduped.slice(0, 5) });
        rawCount += deduped.length;
        if (deduped.length) {
          // short-circuit once any variant returns hits
          return NextResponse.json({
            probe: true,
            permit: probePermit,
            variants,
            sinceInspections,
            totalFound: rawCount,
            attempts
          });
        }
      }

      // none matched
      return NextResponse.json({
        probe: true,
        permit: probePermit,
        variants,
        sinceInspections,
        totalFound: 0,
        attempts
      });
    }

    // ---------- BULK: iterate across your own permits, try variants & strategies ----------
    let totalImported = 0;

    for (let permitPage = 0; permitPage < maxPermitPages; permitPage++) {
      const ids = await fetchPermitIds(permitPage * idBatch, idBatch, sinceIssued || undefined);
      if (!ids.length) break;

      // Build a combined result set for this page
      let pageRows: any[] = [];

      for (const id of ids) {
        const variants = generatePermitVariants(id);
        let found = false;

        for (const v of variants) {
          const { rows } = await fetchByVariant(v, sinceInspections, perReqLimit);
          if (rows?.length) {
            pageRows = pageRows.concat(rows);
            found = true;
            break; // stop at first successful variant for this id
          }
        }

        // optional: we could continue to next id even if not found (expected for some)
      }

      if (!pageRows.length) continue;

      // Dedupe and transform
      const deduped = dedupeRows(pageRows);
      const upserts = deduped.map(v => ({
        permit_number: v.permit,          // store exactly as returned
        jurisdiction_id: jid,
        inspection_date: v.dt,
        inspection_type_raw: v.t,
        inspection_type_norm: null,
        result: v.result || null,
        inspector: null,
        created_at: new Date().toISOString(),
      }));

      if (!dryRun && upserts.length) {
        const { error: insErr } = await supabase
          .from("inspections")
          .upsert(upserts, { onConflict: "permit_number,inspection_date,inspection_type_raw" });
        if (insErr) throw insErr;
      }

      totalImported += upserts.length;

      // We don't paginate within each ID now (perReqPages) because we’re iterating IDs.
      // If needed later, we can add deeper paging, but this approach maximizes match quality first.
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
    });

    return NextResponse.json({
      imported: totalImported,
      sinceInspections,
      sinceIssued,
      dryRun
    });
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
