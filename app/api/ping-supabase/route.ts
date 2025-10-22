// app/api/ping-supabase/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    return NextResponse.json(
      { ok: false, error: "Missing Supabase env vars" },
      { status: 500 }
    );
  }

  const supabase = createClient(url, anon, { auth: { persistSession: false } });

  try {
    // Lightweight “does the DB respond + table exists?” check.
    const { count, error } = await supabase
      .from("jurisdictions")
      .select("jurisdiction_id", { count: "exact", head: true });

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      message: "Supabase reachable and jurisdictions table queryable",
      count,
    });
  } catch (e: any) {
    // Fallback: try a generic ping (no table dependency)
    try {
      const { data, error: pingErr } = await supabase.rpc("postgres_version" as any);
      if (pingErr) throw pingErr;
      return NextResponse.json({ ok: true, message: "Supabase reachable", version: data });
    } catch (_err: any) {
      return NextResponse.json(
        { ok: false, error: String(e?.message || _err?.message || "Unknown error") },
        { status: 500 }
      );
    }
  }
}
