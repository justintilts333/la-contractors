import { createClient } from '../../../../lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createClient();
  
  try {
    // Sync permits.finaled_date to builds.finaled_date
    const { data, error } = await supabase.rpc('sync_finaled_dates');
    
    if (error) {
      console.error('Sync error:', error);
      throw error;
    }
    
    console.log('Finaled dates synced:', data);
    
    return NextResponse.json({ 
      success: true, 
      synced_count: data,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Fatal error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
