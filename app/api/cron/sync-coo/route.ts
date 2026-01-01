import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const COFO_API = 'https://data.lacity.org/resource/y3gg-54j8.json';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get permits with status="Permit Finaled" but no contractor
    const { data: permits } = await supabase
      .from('permits')
      .select('permit_id, permit_nbr')
      .eq('status', 'Permit Finaled')
      .is('finaled_date', null)
      .limit(100);

    if (!permits || permits.length === 0) {
      return NextResponse.json({
        success: true,
        permitsChecked: 0,
        permitsUpdated: 0,
        contractorsLinked: 0
      });
    }

    let permitsUpdated = 0;
    let contractorsLinked = 0;

    for (const permit of permits) {
      // Check if this permit already has a contractor
      const { data: existingLink } = await supabase
        .from('build_contractors')
        .select('contractor_id')
        .eq('build_id', (await supabase
          .from('builds')
          .select('build_id')
          .eq('permit_id', permit.permit_id)
          .single()
        ).data?.build_id)
        .limit(1)
        .single();

      if (existingLink) {
        continue; // Skip - already has contractor
      }

      // Try base permit + 9 amendments
      let cooFound = false;
      let contractorId: string | null = null;
      let finaledDate: string | null = null;
      let foundOnAmendment = false;

      for (let i = 0; i <= 9; i++) {
        const permitNbr = permit.permit_nbr.substring(0, 10) + i + permit.permit_nbr.substring(11);
        const cooResponse = await fetch(`${COFO_API}?pcis_permit=${permitNbr}`);
        
        if (!cooResponse.ok) continue;

        const cooData = await cooResponse.json();
        if (!cooData || cooData.length === 0) continue;

        const coo = cooData[0];
        
        // Found COO!
        cooFound = true;
        foundOnAmendment = (i > 0);
        finaledDate = coo.cofo_issue_date?.split('T')[0] || null;

        // Update permit finaled_date
        await supabase
          .from('permits')
          .update({ finaled_date: finaledDate })
          .eq('permit_id', permit.permit_id);

        permitsUpdated++;

        // Find or create contractor
        if (coo.license) {
          const { data: existingContractor } = await supabase
            .from('contractors')
            .select('contractor_id')
            .eq('license_number', coo.license)
            .single();

          if (existingContractor) {
            contractorId = existingContractor.contractor_id;
          } else {
            // Create new contractor
            const { data: newContractor } = await supabase
              .from('contractors')
              .insert({
                contractor_name: coo.contractors_business_name || 'Unknown',
                license_number: coo.license,
                license_type: coo.license_type || null,
                created_at: new Date(),
                updated_at: new Date()
              })
              .select('contractor_id')
              .single();

            contractorId = newContractor?.contractor_id || null;
          }

          // Link contractor to build
          if (contractorId) {
            const { data: build } = await supabase
              .from('builds')
              .select('build_id')
              .eq('permit_id', permit.permit_id)
              .single();

            if (build) {
              await supabase.from('build_contractors').insert({
                build_id: build.build_id,
                contractor_id: contractorId,
                role: 'PRIMARY',
                created_at: new Date()
              });

              contractorsLinked++;

              // If found on amendment, copy to base permit too
              if (foundOnAmendment) {
                console.log(`Contractor found on amendment ${i} for ${permit.permit_nbr}, copied to base`);
              }
            }
          }
        }

        break; // Stop checking after first COO found
      }
    }

    return NextResponse.json({
      success: true,
      permitsChecked: permits.length,
      permitsUpdated,
      contractorsLinked
    });

  } catch (error: any) {
    console.error('COO sync error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}