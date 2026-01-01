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
    // Get last sync time from watermarks table
    const { data: watermark } = await supabase
      .from('etl_watermarks')
      .select('last_run')
      .eq('source_key', 'ladbs_permits_api')
      .single();

    // Use last run time, or 90 days ago if first run
    const lastSyncDate = watermark?.last_run 
      ? new Date(watermark.last_run)
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    
    // Format as YYYY-MM-DD (API requires this format)
    const lastSync = lastSyncDate.toISOString().split('T')[0];
    
    // Search by refresh_time (catches new permits AND late-issued permits)
    const response = await fetch(
      `${LADBS_API}?$where=refresh_time>'${lastSync}' AND adu_changed >= '1'&$order=refresh_time ASC&$limit=5000`
    );

    if (!response.ok) {
      throw new Error(`LADBS API error: ${response.status}`);
    }

    const permits = await response.json();
    let newPermits = 0;
    let updatedPermits = 0;

    for (const permit of permits) {
      const aduClass = /JADU|junior accessory/i.test(permit.work_desc || '') 
        ? 'JADU' 
        : 'ADU';

      const { data: existing } = await supabase
        .from('permits')
        .select('permit_id')
        .eq('permit_nbr', permit.permit_nbr)
        .single();

      const permitData = {
        permit_nbr: permit.permit_nbr,
        city_id: 1,
        issue_date: permit.issue_date?.split('T')[0] || null,
        finaled_date: permit.cofo_date?.split('T')[0] || null,
        status: permit.status_desc || null,
        permit_type: permit.permit_type || null,
        work_description: permit.work_desc || null,
        adu_classification: aduClass,
        updated_at: new Date()
      };

      if (existing) {
        // Update existing permit (catches late-issued permits)
        await supabase
          .from('permits')
          .update(permitData)
          .eq('permit_id', existing.permit_id);
        updatedPermits++;
      } else {
        // Insert new permit
        const { data: newPermit } = await supabase
          .from('permits')
          .insert(permitData)
          .select('permit_id')
          .single();

        if (newPermit) {
          await supabase.from('builds').insert({
            permit_id: newPermit.permit_id,
            address: permit.primary_address || null,
            zip_code: permit.zip_code || null,
            lat: permit.lat ? parseFloat(permit.lat) : null,
            lon: permit.lon ? parseFloat(permit.lon) : null,
            apn: permit.apn || null,
            valuation: permit.valuation ? parseFloat(permit.valuation) : null,
            sqft: permit.square_footage ? parseInt(permit.square_footage) : null,
            valuation_per_sqft: permit.valuation && permit.square_footage
              ? parseFloat(permit.valuation) / parseFloat(permit.square_footage)
              : null,
            created_at: new Date(),
            updated_at: new Date()
          });
        }

        newPermits++;
      }
    }

    // Update watermark
    const now = new Date();
    await supabase
      .from('etl_watermarks')
      .upsert({
        source: 'LADBS',
        source_key: 'ladbs_permits_api',
        last_run: now.toISOString(),
        records_processed: permits.length
      }, { onConflict: 'source_key' });

    return NextResponse.json({
      success: true,
      newPermits,
      updatedPermits,
      totalProcessed: permits.length,
      lastSync
    });

  } catch (error: any) {
    console.error('Permit sync error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}