import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 300; // 5 minutes

export async function GET(request: NextRequest) {
  // Temporarily disabled for initial import
  // const authHeader = request.headers.get('authorization');
  // if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // }

  try {
    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const limit = 100;
    
    const { data: permits, error } = await supabase
      .from('permits')
      .select('permit_id, permit_nbr')
      .range(offset, offset + limit - 1);
    
    if (error) throw error;
    
    if (!permits || permits.length === 0) {
      return NextResponse.json({ done: true, message: 'Complete!' });
    }
    
    let totalFetched = 0;
    let totalInserted = 0;
    let contractorChanges = 0;
    
    const allPatterns: string[] = [];
    const permitMap = new Map<string, { permit_id: number, base_nbr: string }>();
    
    for (const permit of permits) {
      const baseNumber = permit.permit_nbr;
      for (let amendNum = 1; amendNum <= 9; amendNum++) {
        const amendmentNumber = baseNumber.substring(0, 9) + amendNum + baseNumber.substring(10);
        allPatterns.push(amendmentNumber);
        permitMap.set(amendmentNumber, { permit_id: permit.permit_id, base_nbr: baseNumber });
      }
    }
    
    const query = allPatterns.map(p => `permit_nbr='${p}'`).join(' OR ');
    const response = await fetch(
      `https://data.lacity.org/resource/pi9x-tg5x.json?$where=${encodeURIComponent(query)}&$limit=1000`
    );
    
    if (!response.ok) throw new Error(`LADBS API error: ${response.status}`);
    
    const amendments = await response.json();
    totalFetched = amendments.length;
    
    for (const amendment of amendments) {
      const permitInfo = permitMap.get(amendment.permit_nbr);
      if (!permitInfo) continue;
      
      const amendmentDigit = parseInt(amendment.permit_nbr.charAt(9));
      const workDesc = amendment.work_desc || '';
      
      const hasChange = 
        /change.*contractor/i.test(workDesc) ||
        /contractor.*to.*owner/i.test(workDesc) ||
        /owner.*to.*contractor/i.test(workDesc) ||
        /transfer.*contractor/i.test(workDesc);
      
      const changeType = hasChange
        ? /contractor.*to.*owner/i.test(workDesc)
          ? 'CONTRACTOR_TO_OWNER'
          : /owner.*to.*contractor/i.test(workDesc)
          ? 'OWNER_TO_CONTRACTOR'
          : 'CONTRACTOR_CHANGE'
        : null;
      
      if (hasChange) contractorChanges++;
      
      const { error: insertError } = await supabase
        .from('permit_amendments')
        .upsert({
          permit_id: permitInfo.permit_id,
          base_permit_nbr: permitInfo.base_nbr,
          amendment_permit_nbr: amendment.permit_nbr,
          amendment_number: amendmentDigit,
          work_description: workDesc,
          issue_date: amendment.issue_date?.split('T')[0] || null,
          status: amendment.status_desc || null,
          has_contractor_change: hasChange,
          contractor_change_type: changeType
        }, { onConflict: 'amendment_permit_nbr' });
      
      if (!insertError) totalInserted++;
    }
    
    const nextOffset = offset + limit;
    
    return NextResponse.json({
      success: true,
      offset,
      processed: permits.length,
      totalFetched,
      totalInserted,
      contractorChanges,
      nextOffset,
      nextUrl: nextOffset < 49281 ? `/api/cron/import-amendments?offset=${nextOffset}` : null,
      progress: `${Math.round((nextOffset / 49281) * 100)}%`
    });
    
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}