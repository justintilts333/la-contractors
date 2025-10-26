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

function socrataUrl(params: Record<string, string>) {
  const usp = new URLSearchParams(params);
  return `${LADBS_INSPECTIONS_URL}?${usp.toString()}`;
}

// Generate variants with dashes, spaces, trimmed zeros, etc.
function expandPermitSearchTerms(id: string): string[] {
  const raw = id.trim();
  const segments = raw.includes("-") ? raw.split("-") : raw.split(" ");
  const [seg1 = "", seg2 = "", seg3 = ""] = segments.map(s => s.trim());

  const withDashes = [seg1, seg2, seg3].join("-");
  const withSpaces = [seg1, seg2, seg3].join(" ");
  const noDashes   = withDashes.replace(/-/g, "");
  const noSpaces   = withSpaces.replace(/\s+/g, "");
  const segTrim = [seg1, seg2, seg3].map(s => s.replace(/^0+/, "") || "0");
  const trimDashes = segTrim.join("-");
  const trimSpaces = segTrim.join(" ");

  const suffix5 = seg3.slice(-5);
  const suffix6 = seg3.slice(-6);
  const midDash = `${seg2}-${seg3}`.trim();
  const midSpace = `${seg2} ${seg3}`.trim();
  const midNoSep = `${seg2}${seg3}`.trim();

  return Array.from(new Set([
    raw,
    withDashes, withSpaces,
    noDashes, noSpaces,
    trimDashes, trimSpaces,
    seg3, suffix5, suffix6,
    midDash, midSpace, midNoSep
  ].filter(Boolean)));
}

function dedupeRows(rows: any[]) {
  const seen = new Map<string, { permit: string; dt: string; t: string; result: string }>();
  for (const r of rows) {
    if (!r.permit || !r.inspection_date) continue;
    const permit = r.permit.toString();
    const dt = r.inspection_date;
    const t = norm(r.inspection);
    const result = norm(r.inspection_result);
    const key = `${permit}|${dt}|${t}`;
    const cur = seen.get(key);
    if (!cur) seen.set(key, { permit, dt, t, result });
    else {
      const currRank = RESULT_RANK[cur.result] ?? 0;
      const newRank = RESULT_RANK[result] ?? 0;
      if (newRank > currRank) seen.set(key, { permit, dt, t, result });
    }
  }
  return Array.from(seen.values());
}

async function getJurisdictionId(): Promise<number> {
  const { data, error } = await supabase
    .from("jurisdictions")
    .select("jurisdiction_id")
    .eq("name", "Los Angeles")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.jurisdiction_id) throw new Error("Missing jurisdiction 'Los Angeles'");
  return data.jurisdiction_id as number;
}

async function fetchByStrategy(term: string, since: string, limit: number) {
  const select = "permit,inspection_date,inspection,inspection_result";
  const tried: string[] = [];
  async function tryUrl(params: Record<string,string>) {
    const url = socrataUrl(params);
    tried.push(url);
    const res = await fetch(url);
    if (!res.ok) return [];
    return (await res.json()) as any[];
  }

  const esc = term.replace(/'/g,"''");
  let rows: any[] = [];

  // 1) exact equality
  let where = `permit = '${esc}' AND inspection_date > '${since}T00:00:00'`;
  rows = await tryUrl({ $limit: String(limit), $offset: "0", $order: "inspection_date ASC", $select: select, $where: where });
  if (rows.length) return { rows, tried };

  // 2) case-insensitive
  where = `upper(permit) = upper('${esc}') AND inspection_date > '${since}T00:00:00'`;
  rows = await tryUrl({ $limit: String(limit), $offset: "0", $order: "inspection_date ASC", $select: select, $where: where });
  if (rows.length) return { rows, tried };

  // 3) LIKE anywhere (handles spaces)
  where = `permit like '%${esc}%' AND inspection_date > '${since}T00:00:00'`;
  rows = await tryUrl({ $limit: String(limit), $offset: "0", $order: "inspection_date ASC", $select: select, $where: where });
  if (rows.length) return { rows, tried };

  // 4) full-text fallback
  rows = await tryUrl({ $limit: String(limit), $offset: "0", $order: "inspection_date ASC", $select: select, $q: term });
  if (rows.length) return { rows, tried };

  return { rows: [], tried };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const probe = url.searchParams.get("probe") === "true";
  const probePermit = url.searchParams.get("permit") || null;
  const since = url.searchParams.get("since") || "2010-01-01";

  const startedAt = new Date().toISOString();

  try {
    const jid = await getJurisdictionId();

    if (probe) {
      if (!probePermit) {
        return NextResponse.json({ error: "probe=true requires ?permit=<PERMIT_NUMBER>" }, { status: 400 });
      }
      const terms = expandPermitSearchTerms(probePermit);
      const attempts: Array<{ term: string; tried: string[]; count: number; sample: any[] }> = [];
      let total = 0;
      for (const term of terms) {
        const { rows, tried } = await fetchByStrategy(term, since, 1000);
        const deduped = dedupeRows(rows);
        attempts.push({ term, tried, count: deduped.length, sample: deduped.slice(0, 10) });
        total += deduped.length;
        if (deduped.length) {
          return NextResponse.json({
            probe: true,
            permit: probePermit,
            terms,
            since,
            totalFound: total,
            attempts
          });
        }
      }
      return NextResponse.json({ probe: true, permit: probePermit, terms, since, totalFound: 0, attempts });
    }

    await supabase.from("etl_job_runs").insert({
      id: randomUUID(),
      job_name: "import_inspections_probe_only",
      status: "SUCCESS",
      source: "LADBS_INSPECTIONS",
      rowcount: 0,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    return NextResponse.json({ imported: 0, probeOnly: true, since });
  } catch (e: any) {
    await supabase.from("etl_job_runs").insert({
      id: randomUUID(),
      job_name: "import_inspections",
      status: "FAILED",
      source: "LADBS_INSPECTIONS",
      rowcount: 0,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      message: (e?.message || "").slice(0, 500),
    });
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
