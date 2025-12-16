import { NextRequest, NextResponse } from 'next/server';
import { computeContractorMetrics } from '@/scripts/calculations/compute-contractor-metrics';

export async function GET(request: NextRequest) {
  try {
    // Check cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    console.log('Starting contractor metrics computation via API...');
    const startTime = Date.now();
    
    const result = await computeContractorMetrics();
    
    const duration = Date.now() - startTime;
    
    return NextResponse.json({
      success: true,
      ...result,
      duration_ms: duration,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error in compute-contractor-metrics API:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}