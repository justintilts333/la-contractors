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
    // Get base permits that need COO check (finaled status but no contractor)
    const { data: permits } = await supabase
      .from('permits')
      .select(`
        permit_id, 
        permit_nbr, 
        finaled_date,
        builds!inner(build_id)
      `)
      .eq('status', 'Permit Finaled')
      .limit(100);

    if (!permits || permits.length === 0) {
      return NextResponse.json({ message: 'No permits to sync' });
    }

    let updated = 0;
    let contractorsLinked = 0;

    for (const permit of permits) {
      // Check if build already has contractor
      const { data: existingContractor } = await supabase
        .from('build_contractors')
        .select('contractor_id')
        .eq('build_id', (permit.builds as any)[0].build_id)
        .single();

      if (existingContractor) continue; // Skip if already has contractor

      // Build list of permit numbers to check (base + amendments)
      const permitNumbers = [permit.permit_nbr];
      
      // Add amendments (change 10th character from 0 to 1-9)
      for (let i = 1; i <= 9; i++) {
        const amendmentNbr = 
          permit.permit_nbr.substring(0, 10) + 
          i + 
          permit.permit_nbr.substring(11);
        permitNumbers.push(amendmentNbr);
      }

      let cooFound = false;

      // Check each permit number for COO
      for (const permitNbr of permitNumbers) {
        const response = await fetch(
          `${COFO_API}?pcis_permit=${permitNbr}`
        );

        if (!response.ok) continue;

        const coos = await response.json();
        if (coos.length === 0) continue;

        const coo = coos[0];
        cooFound = true;

        // Update base permit with finaled_date
        if (coo.cofo_issue_date && !permit.finaled_date) {
          await supabase
            .from('permits')
            .update({
              finaled_date: coo.cofo_issue_date.split('T')[0]
            })
            .eq('permit_id', permit.permit_id);
          updated++;
        }

        // Link contractor
        if (coo.license) {
          const { data: contractor } = await supabase
            .from('contractors')
            .select('contractor_id')
            .eq('license_number', coo.license)
            .single();

          let contractorId = contractor?.contractor_id;

          if (!contractorId) {
            // Create new contractor
            const { data: newContractor } = await supabase
              .from('contractors')
              .insert({
                contractor_name: coo.contractors_business_name,
                license_number: coo.license,
                license_type: coo.license_type,
                created_at: new Date()
              })
              .select('contractor_id')
              .single();

            contractorId = newContractor?.contractor_id;
          }

          if (contractorId) {
            await supabase
              .from('build_contractors')
              .upsert({
                build_id: (permit.builds as any)[0].build_id,
                contractor_id: contractorId
              }, { onConflict: 'build_id,contractor_id' });
            contractorsLinked++;
          }
        }

        break; // Found COO, stop checking amendments
      }
    }

    return NextResponse.json({
      success: true,
      permitsChecked: permits.length,
      permitsUpdated: updated,
      contractorsLinked
    });

  } catch (error: any) {
    console.error('COO sync error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}