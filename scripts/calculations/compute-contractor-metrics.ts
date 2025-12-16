import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function computeContractorMetrics() {
  console.log('Starting contractor metrics calculations...');
  
  // Get all contractors
  const { data: contractors, error: contractorsError } = await supabase
    .from('contractors')
    .select('contractor_id');
  
  if (contractorsError) {
    console.error('Error fetching contractors:', contractorsError);
    throw contractorsError;
  }
  
  console.log(`Processing ${contractors.length} contractors...`);
  
  let processed = 0;
  let updated = 0;
  
  for (const contractor of contractors) {
    // Get all permits for this contractor
    const { data: permits, error: permitsError } = await supabase
      .from('permits')
      .select(`
        permit_id,
        permit_nbr,
        issue_date,
        finaled_date,
        started_date,
        started_but_not_completed,
        pull_to_start_lag_days
      `)
      .eq('contractor_id', contractor.contractor_id);
    
    if (permitsError || !permits || permits.length === 0) {
      processed++;
      continue;
    }
    
    // Get metrics for these permits
    const permitNumbers = permits.map(p => p.permit_nbr);
    const { data: metrics } = await supabase
      .from('inspection_phase_metrics')
      .select('*')
      .in('permit_number', permitNumbers);
    
    // Get inspections for failure count
    const permitIds = permits.map(p => p.permit_id);
    const { data: inspections } = await supabase
      .from('inspections')
      .select('permit_id, inspection_result')
      .in('permit_id', permitIds);
    
    // Calculate metrics
    const totalPermits = permits.length;
    const completedPermits = permits.filter(p => p.finaled_date).length;
    const activePermits = permits.filter(p => 
      p.started_date && !p.finaled_date
    ).length;
    
    // Last year builds
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const buildsLastYear = permits.filter(p => 
      new Date(p.issue_date) >= oneYearAgo
    ).length;
    
    // Average time to completion (only completed projects)
    const completionTimes = (metrics || [])
      .filter(m => m.start_to_final !== null)
      .map(m => m.start_to_final);
    const avgCompletion = completionTimes.length > 0
      ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length)
      : null;
    
    // Average time to pass final
    const finalTimes = (metrics || [])
      .filter(m => m.time_to_pass_final !== null)
      .map(m => m.time_to_pass_final);
    const avgFinalTime = finalTimes.length > 0
      ? Math.round(finalTimes.reduce((a, b) => a + b, 0) / finalTimes.length)
      : null;
    
    // Average failed inspections per permit
    const failuresByPermit = permitIds.map(permitId => {
      const permitInspections = (inspections || []).filter(i => i.permit_id === permitId);
      return permitInspections.filter(i => 
        i.inspection_result === 'CORRECTIONS ISSUED' || 
        i.inspection_result === 'NOT READY FOR INSPECTION'
      ).length;
    });
    const avgFailures = failuresByPermit.length > 0
      ? Math.round((failuresByPermit.reduce((a, b) => a + b, 0) / failuresByPermit.length) * 10) / 10
      : null;
    
    // Find last active date
    const allDates = permits
      .map(p => p.issue_date)
      .filter(d => d)
      .map(d => new Date(d))
      .sort((a, b) => b.getTime() - a.getTime());
    const lastActive = allDates.length > 0 ? allDates[0].toISOString().split('T')[0] : null;
    
    // Update contractor
    const { error: updateError } = await supabase
      .from('contractors')
      .update({
        active_builds: activePermits,
        builds_in_last_year: buildsLastYear,
        avg_time_to_completion_days: avgCompletion,
        avg_time_to_pass_final_days: avgFinalTime,
        avg_failed_inspections: avgFailures,
        last_active_date: lastActive
      })
      .eq('contractor_id', contractor.contractor_id);
    
    if (updateError) {
      console.error(`Error updating contractor ${contractor.contractor_id}:`, updateError);
      continue;
    }
    
    updated++;
    processed++;
    
    if (processed % 10 === 0) {
      console.log(`Processed ${processed}/${contractors.length} contractors...`);
    }
  }
  
  console.log(`✅ Completed! Processed: ${processed}, Updated: ${updated}`);
  
  return { processed, updated };
}

// Allow direct execution
if (require.main === module) {
  computeContractorMetrics()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}