import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // Basic health; we’ll wire Supabase later.
  const env = {
    hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasAnon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  };

  return NextResponse.json({
    ok: true,
    env,
    timestamp: new Date().toISOString()
  });
}
