import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function computeContractorMetrics() {
  console.log('Starting contractor metrics calculations...');
  
  const { count } = await supabase
    .from('contractors')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Total contractors in database: ${count}`);
  
  let allContractors: any[] = [];
  let from = 0;
  const batchSize = 1000;
  
  while (from < (count || 0)) {
    const { data, error } = await supabase
      .from('contractors')
      .select('contractor_id')
      .range(from, from + batchSize - 1);
    
    if (error) {
      console.error('Error fetching contractors:', error);
      throw error;
    }
    
    allContractors = allContractors.concat(data || []);
    from += batchSize;
    console.log(`Loaded ${allContractors.length}/${count} contractors...`);
  }
  
  console.log(`Processing ${allContractors.length} contractors...`);
  
  let processed = 0;
  let updated = 0;
  let skippedNoLinks = 0;
  let skippedNoBuilds = 0;
  
  for (const contractor of allContractors) {
    const { data: buildLinks, error: linksError } = await supabase
      .from('build_contractors')
      .select('build_id')
      .eq('contractor_id', contractor.contractor_id);
    
    if (linksError) {
      console.error('Error fetching build links for contractor:', contractor.contractor_id, linksError);
      processed++;
      continue;
    }
    
    if (!buildLinks || buildLinks.length === 0) {
      skippedNoLinks++;
      processed++;
      continue;
    }
    
    const buildIds = buildLinks.map(bl => bl.build_id);
    
    const { data: builds, error: buildsError } = await supabase
      .from('builds')
      .select('*')
      .in('build_id', buildIds);
    
    if (buildsError) {
      console.error('Error fetching builds for contractor:', contractor.contractor_id, buildsError);
      processed++;
      continue;
    }
    
    if (!builds || builds.length === 0) {
      skippedNoBuilds++;
      processed++;
      continue;
    }
    
    const totalBuilds = builds.length;
    const startedBuilds = builds.filter(b => b.started_date).length;
    const completedBuilds = builds.filter(b => b.finaled_date).length;
    
    // Filter out stale projects (started more than 18 months ago)
    const eighteenMonthsAgo = new Date();
    eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18);
    const activeBuilds = builds.filter(b => 
      b.started_date && 
      !b.finaled_date && 
      new Date(b.started_date) > eighteenMonthsAgo
    ).length;
    
    const completionRate = startedBuilds > 0 
      ? Math.round((completedBuilds / startedBuilds) * 100)
      : null;
    
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const buildsLastYear = builds.filter(b => {
      if (!b.created_at) return false;
      return new Date(b.created_at) >= oneYearAgo;
    }).length;
    
    const startToFinalTimes = builds
      .map(b => b.start_to_final_days)
      .filter(t => t !== null && t > 0);
    const avgStartToFinal = startToFinalTimes.length > 0
      ? Math.round(startToFinalTimes.reduce((a, b) => a + b, 0) / startToFinalTimes.length)
      : null;
    
    const finalTimes = builds
      .map(b => b.time_to_pass_final_days)
      .filter(t => t !== null && t > 0);
    const avgFinalTime = finalTimes.length > 0
      ? Math.round(finalTimes.reduce((a, b) => a + b, 0) / finalTimes.length)
      : null;
    
    const failures = builds.map(b => b.total_failures || 0);
    const avgFailures = failures.length > 0
      ? Math.round((failures.reduce((a, b) => a + b, 0) / failures.length) * 10) / 10
      : null;
    
    const dates = builds
      .map(b => b.created_at)
      .filter(d => d)
      .map(d => new Date(d))
      .sort((a, b) => b.getTime() - a.getTime());
    const lastActive = dates.length > 0 ? dates[0].toISOString().split('T')[0] : null;
    
    const { error: updateError } = await supabase
      .from('contractors')
      .update({
        active_builds: activeBuilds,
        builds_in_last_year: buildsLastYear,
        avg_time_to_completion_days: avgStartToFinal,
        avg_time_to_pass_final_days: avgFinalTime,
        avg_failed_inspections: avgFailures,
        completion_rate: completionRate,
        last_active_date: lastActive
      })
      .eq('contractor_id', contractor.contractor_id);
    
    if (updateError) {
      console.error('Error updating contractor:', contractor.contractor_id, updateError);
      continue;
    }
    
    updated++;
    processed++;
    
    if (processed % 100 === 0) {
      console.log(`Processed ${processed}/${allContractors.length} contractors... (Updated: ${updated}, Skipped no links: ${skippedNoLinks}, Skipped no builds: ${skippedNoBuilds})`);
    }
  }
  
  console.log(`✅ Completed! Processed: ${processed}, Updated: ${updated}`);
  console.log(`Skipped (no build links): ${skippedNoLinks}, Skipped (no builds): ${skippedNoBuilds}`);
  
  return { processed, updated };
}

computeContractorMetrics()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });