import { createClient } from '@supabase/supabase-js';
import { calculateDuration } from '../utils/date-helpers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface Inspection {
  inspection_id: string;
  permit_id: string;
  inspection_date: string;
  inspection_type: string;
  inspection_result: string;
}

// ✅ NEW: Helper function to check if inspection result indicates approval
function isApproved(result: string): boolean {
  const passingResults = [
    'APPROVED',
    'CONDITIONAL APPROVAL',
    'PARTIAL APPROVAL',
    'COMPLETED',
    'SGSOV APPROVED',
    'PERMIT FINALED',
    'COFO ISSUED',
    'OK TO ISSUE COFO',
    'OK FOR COFO',
    'COFO CORRECTED',
    'APPROVED PENDING GREENAPPROVAL'
  ];
  return passingResults.includes(result);
}

export async function computeDurations() {
  console.log('Starting duration calculations...');
  
  // Get total count first
  const { count } = await supabase
    .from('permits')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Total permits in database: ${count}`);
  
  // Fetch all permits in batches (Supabase defaults to 1000 row limit)
  let allPermits: any[] = [];
  let from = 0;
  const batchSize = 1000;
  
  while (from < (count || 0)) {
    const { data, error } = await supabase
      .from('permits')
      .select('permit_id, permit_nbr, issue_date')
      .range(from, from + batchSize - 1);
    
    if (error) {
      console.error('Error fetching permits:', error);
      throw error;
    }
    
    allPermits = allPermits.concat(data || []);
    from += batchSize;
    console.log(`Loaded ${allPermits.length}/${count} permits...`);
  }
  
  console.log(`Processing ${allPermits.length} permits...`);
  
  let processed = 0;
  let updated = 0;
  
  for (const permit of allPermits) {
    // Fetch all inspections for this permit
    const { data: inspections, error: inspError } = await supabase
      .from('inspections')
      .select('*')
      .eq('permit_id', permit.permit_id)
      .order('inspection_date', { ascending: true });
    
    if (inspError) {
      console.error(`Error fetching inspections for ${permit.permit_nbr}:`, inspError);
      continue;
    }
    
    if (!inspections || inspections.length === 0) {
      // No inspections, skip this permit
      processed++;
      continue;
    }
    
    // Find key milestones - ✅ UPDATED: Now uses isApproved() helper
    const firstPassed = inspections.find((i: Inspection) => 
      isApproved(i.inspection_result)
    );
    const foundationPassed = inspections.find((i: Inspection) => 
      i.inspection_type === 'FOUNDATION' && isApproved(i.inspection_result)
    );
    const framingPassed = inspections.find((i: Inspection) => 
      i.inspection_type === 'FRAMING' && isApproved(i.inspection_result)
    );
    const drywallPassed = inspections.find((i: Inspection) => 
      i.inspection_type === 'DRYWALL' && isApproved(i.inspection_result)
    );
    const finalFirst = inspections.find((i: Inspection) => 
      i.inspection_type === 'FINAL'
    );
    const finalPassed = inspections.find((i: Inspection) => 
      i.inspection_type === 'FINAL' && isApproved(i.inspection_result)
    );
    
    // Calculate durations
    const durations = {
      permit_number: permit.permit_nbr,
      start_to_foundation: calculateDuration(
        firstPassed?.inspection_date,
        foundationPassed?.inspection_date
      ),
      foundation_to_framing: calculateDuration(
        foundationPassed?.inspection_date,
        framingPassed?.inspection_date
      ),
      framing_to_drywall: calculateDuration(
        framingPassed?.inspection_date,
        drywallPassed?.inspection_date
      ),
      drywall_to_final: calculateDuration(
        drywallPassed?.inspection_date,
        finalFirst?.inspection_date
      ),
      start_to_final: calculateDuration(
        firstPassed?.inspection_date,
        finalPassed?.inspection_date
      ),
      time_to_pass_final: calculateDuration(
        finalFirst?.inspection_date,
        finalPassed?.inspection_date
      )
    };
    
    // UPSERT into inspection_phase_metrics
    const { error: upsertError } = await supabase
      .from('inspection_phase_metrics')
      .upsert(durations, { onConflict: 'permit_number' });
    
    if (upsertError) {
      console.error(`Error upserting metrics for ${permit.permit_nbr}:`, upsertError);
      continue;
    }
    
    // Update permits table with derived fields
    if (firstPassed) {
      const pullToStartLag = calculateDuration(
        permit.issue_date,
        firstPassed.inspection_date
      );
      
      await supabase
        .from('permits')
        .update({
          started_date: firstPassed.inspection_date,
          started_but_not_completed: !finalPassed,
          pull_to_start_lag_days: pullToStartLag
        })
        .eq('permit_id', permit.permit_id);
    }
    
    updated++;
    processed++;
    
    // Progress logging every 100 permits
    if (processed % 100 === 0) {
      console.log(`Processed ${processed}/${allPermits.length} permits...`);
    }
  }
  
  console.log(`✅ Completed! Processed: ${processed}, Updated: ${updated}`);
  
  return { processed, updated };
}

// Allow direct execution for testing
if (require.main === module) {
  computeDurations()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}