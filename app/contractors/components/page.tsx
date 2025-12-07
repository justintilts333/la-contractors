'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useParams } from 'next/navigation';
import { Building2, Star, TrendingUp, Clock, CheckCircle } from 'lucide-react';

interface Contractor {
  contractor_id: string;
  contractor_name: string;
  license_number: string;
  license_class: string;
  license_status: string;
  score: number;
  active_builds: number;
  builds_in_last_year: number;
  avg_time_to_completion_days: number;
  avg_failed_inspections: number;
  google_rating: number;
  google_review_count: number;
  yelp_rating: number;
  yelp_review_count: number;
}

export default function ContractorDetailPage() {
  const params = useParams();
  const contractorId = params.id as string;
  
  const [contractor, setContractor] = useState<Contractor | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  const supabase = createBrowserClient(
    'https://socmxgmvovqwuzhefwmh.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvY214Z212b3Zxd3V6aGVmd21oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5OTQ3NzIsImV4cCI6MjA3NjU3MDc3Mn0.Jt-DsW-AFk_B1cgubI7StlCwyeSs3FnYdW1_UcJXlQY'
  );

  useEffect(() => {
    fetchContractor();
  }, [contractorId]);

  async function fetchContractor() {
    try {
      const { data, error } = await supabase
        .from('contractors')
        .select('*')
        .eq('contractor_id', contractorId)
        .single();

      if (error) throw error;
      setContractor(data);
    } catch (err) {
      console.error('Error fetching contractor:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F4F1E8] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#D39B1A]"></div>
      </div>
    );
  }

  if (!contractor) {
    return (
      <div className="min-h-screen bg-[#F4F1E8] flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#07111E] mb-2">Contractor Not Found</h1>
          <a href="/contractors" className="text-[#D39B1A] hover:underline">← Back to List</a>
        </div>
      </div>
    );
  }

  const totalProjects = (contractor.active_builds || 0) + (contractor.builds_in_last_year || 0);
  const completionRate = totalProjects > 0 
    ? Math.round(((contractor.builds_in_last_year || 0) / totalProjects) * 100)
    : 0;

  const avgReviewRating = contractor.google_rating && contractor.yelp_rating
    ? ((contractor.google_rating + contractor.yelp_rating) / 2).toFixed(1)
    : contractor.google_rating?.toFixed(1) || contractor.yelp_rating?.toFixed(1) || 'N/A';

  const totalReviews = (contractor.google_review_count || 0) + (contractor.yelp_review_count || 0);

  return (
    <div className="min-h-screen bg-[#F4F1E8]">
      {/* Header */}
      <header className="border-b border-[#2A2F33]/20 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <a href="/contractors" className="text-sm text-[#2A2F33]/60 hover:text-[#D39B1A] mb-4 inline-block">
            ← Back to Contractors
          </a>
          
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-gradient-to-br from-[#D39B1A] to-[#B8850F]">
                <Building2 className="h-8 w-8 text-white" />
              </div>
              
              <div>
                <h1 className="text-3xl font-bold text-[#07111E]">{contractor.contractor_name}</h1>
                <div className="mt-2 flex items-center gap-3 text-sm text-[#2A2F33]/60">
                  <span className="font-medium">{contractor.license_class} #{contractor.license_number}</span>
                  <span className="text-[#2A2F33]/40">•</span>
                  <span className={`font-medium ${
                    contractor.license_status === 'ACTIVE' ? 'text-[#1F4437]' : 'text-[#9A4626]'
                  }`}>
                    {contractor.license_status || 'Unknown'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#1F4437] to-[#15362B]">
                <div className="text-center">
                  <div className="text-2xl font-bold text-white">{contractor.score || 50}</div>
                  <div className="text-xs text-white/80">Score</div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg bg-[#F4F1E8] p-4">
              <div className="flex items-center gap-2 text-[#2A2F33]/60 text-sm mb-1">
                <Building2 className="h-4 w-4" />
                <span>Projects</span>
              </div>
              <div className="text-2xl font-bold text-[#07111E]">{totalProjects}</div>
            </div>

            <div className="rounded-lg bg-[#F4F1E8] p-4">
              <div className="flex items-center gap-2 text-[#2A2F33]/60 text-sm mb-1">
                <CheckCircle className="h-4 w-4" />
                <span>Completion</span>
              </div>
              <div className="text-2xl font-bold text-[#07111E]">{completionRate}%</div>
            </div>

            <div className="rounded-lg bg-[#F4F1E8] p-4">
              <div className="flex items-center gap-2 text-[#2A2F33]/60 text-sm mb-1">
                <Clock className="h-4 w-4" />
                <span>Avg Days</span>
              </div>
              <div className="text-2xl font-bold text-[#07111E]">
                {contractor.avg_time_to_completion_days?.toFixed(0) || 'N/A'}
              </div>
            </div>

            <div className="rounded-lg bg-[#F4F1E8] p-4">
              <div className="flex items-center gap-2 text-[#2A2F33]/60 text-sm mb-1">
                <Star className="h-4 w-4" />
                <span>Reviews</span>
              </div>
              <div className="text-2xl font-bold text-[#07111E]">
                {avgReviewRating} ({totalReviews})
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-[#2A2F33]/20 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-8">
            {['overview', 'projects', 'status', 'reviews', 'timeline'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`border-b-2 px-1 py-4 text-sm font-medium capitalize transition-colors ${
                  activeTab === tab
                    ? 'border-[#D39B1A] text-[#07111E]'
                    : 'border-transparent text-[#2A2F33]/60 hover:text-[#07111E]'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {activeTab === 'overview' && (
          <div className="text-center py-12 text-[#2A2F33]/60">
            Overview tab - Coming next!
          </div>
        )}
        {activeTab === 'projects' && (
          <div className="text-center py-12 text-[#2A2F33]/60">
            Projects tab - Coming next!
          </div>
        )}
        {activeTab === 'status' && (
          <div className="text-center py-12 text-[#2A2F33]/60">
            Status tab - Coming next!
          </div>
        )}
        {activeTab === 'reviews' && (
          <div className="text-center py-12 text-[#2A2F33]/60">
            Reviews tab - Coming next!
          </div>
        )}
        {activeTab === 'timeline' && (
          <div className="text-center py-12 text-[#2A2F33]/60">
            Timeline tab - Coming next!
          </div>
        )}
      </main>
    </div>
  );
}