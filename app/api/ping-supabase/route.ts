import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!url || !anon) {
      return NextResponse.json(
        { ok: false, error: 'Missing Supabase env vars' },
        { status: 500 }
      );
    }

    // client-side key is fine for a read-only ping; we’re just checking connectivity
    const supabase = createClient(url, anon);

    // lightweight ping: call RPC if you have one, else do a tiny query
    // if you created the `inspection_type_map` table earlier, we can count it; otherwise select 1
    const { data, error } = await supabase
      .from('inspection_type_map')
      .select('norm_label', { count: 'exact', head: true });

    if (error) {
      // fallback tiny query if that table doesn't exist yet
      const { error: err2 } = await supabase.from('permits').select('permit_number', { head: true, count: 'exact' });
      if (err2) {
        return NextResponse.json({ ok: false, error: String(err2.message) }, { status: 500 });
      }
      return NextResponse.json({ ok: true, fallback: true });
    }

    return NextResponse.json({ ok: true, table: 'inspection_type_map', count: data === null ? 0 : null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
