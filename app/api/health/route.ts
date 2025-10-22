// app/api/db-health/route.ts
import { NextResponse } from 'next/server'

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anon) {
    return NextResponse.json({ ok: false, error: 'Missing Supabase env vars' }, { status: 500 })
  }

  try {
    const r = await fetch(`${url}/rest/v1/inspection_type_map?select=count`, {
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`
      },
      cache: 'no-store',
    })
    const ok = r.ok
    const details = ok ? await r.json() : await r.text()
    return NextResponse.json({ ok, details })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'fetch error' }, { status: 500 })
  }
}
