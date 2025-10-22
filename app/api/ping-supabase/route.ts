// app/api/ping-supabase/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!url || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: "Missing Supabase env vars" },
      { status: 500 }
    );
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    // simplest “does the DB answer?” probe
    const { data, error } = await supabase.rpc("pg_sleep", { secs: 0 }); // harmless no-op if extension present
    // fallback: a trivial query
    const { data: pingData, error: pingError } = await supabase.from("etl_job_runs").select("id").limit(1);

    return NextResponse.json({
      ok: !error && !pingError,
      url,
      table_probe: pingError ? "etl_job_runs not found (ok if not created yet)" : "reachable",
      error: error?.message || pingError?.message || null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
