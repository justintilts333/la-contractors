import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const LADBS_API = 'https://data.lacity.org/resource/pi9x-tg5x.json';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get permits without finaled_date (potential for amendments)
    const { data: permits } = await supabase
      .from('permits')
      .select('permit_id, permit_nbr')
      .is('finaled_date', null)
      .limit(100);

    if (!permits || permits.length === 0) {
      return NextResponse.json({
        success: true,
        permitsChecked: 0,
        amendmentsFound: 0
      });
    }

    let amendmentsFound = 0;

    for (const permit of permits) {
      // Check amendments 1-9
      for (let i = 1; i <= 9; i++) {
        const amendmentNbr = permit.permit_nbr.substring(0, 10) + i + permit.permit_nbr.substring(11);
        
        // Query LADBS API for this amendment
        const response = await fetch(
          `${LADBS_API}?permit_nbr=${amendmentNbr}&$limit=1`
        );

        if (!response.ok) continue;

        const data = await response.json();
        if (!data || data.length === 0) continue;

        const amendment = data[0];

        // Check if amendment already exists
        const { data: existing } = await supabase
          .from('permit_amendments')
          .select('amendment_id')
          .eq('base_permit_nbr', permit.permit_nbr)
          .eq('amendment_permit_nbr', amendmentNbr)
          .single();

        if (existing) continue; // Already imported

        // Detect if contractor changed
        const contractorChanged = 
          amendment.contractors_business_name !== null ||
          amendment.license !== null;

        // Insert amendment
        await supabase.from('permit_amendments').insert({
          base_permit_id: permit.permit_id,
          base_permit_nbr: permit.permit_nbr,
          amendment_permit_nbr: amendmentNbr,
          amendment_number: i,
          issue_date: amendment.issue_date?.split('T')[0] || null,
          finaled_date: amendment.cofo_date?.split('T')[0] || null,
          status: amendment.status_desc || null,
          work_description: amendment.work_desc || null,
          contractor_changed: contractorChanged,
          created_at: new Date(),
          updated_at: new Date()
        });

        amendmentsFound++;
      }
    }

    return NextResponse.json({
      success: true,
      permitsChecked: permits.length,
      amendmentsFound
    });

  } catch (error: any) {
    console.error('Amendment sync error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}