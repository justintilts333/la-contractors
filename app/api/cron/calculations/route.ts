import { createClient } from '../../../../lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createClient();
  
  try {
    const { data, error } = await supabase.rpc('run_all_calculations');
    
    if (error) throw error;
    
    console.log('Calculations completed:', data);
    
    return NextResponse.json({ 
      success: true, 
      results: data,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Calculation error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}