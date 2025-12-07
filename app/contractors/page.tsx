'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { ContractorCard } from './components/contractor-card';
import { FiltersSidebar, FilterState } from './components/filters-sidebar';
import { Building2, Search } from 'lucide-react';
import Header from '../components/Header';

interface ContractorWithStats {
  contractor_id: string;
  name_norm: string;
  license_number: string;
  license_class: string;
  license_status: string;
  score: number;
  total_projects: number;
  completion_rate: number;
  avg_days: number;
  avg_review_rating: number;
  total_reviews: number;
  has_adu_signal: boolean;
  enrolled: boolean;
}

export default function ContractorsPage() {
  const [contractors, setContractors] = useState<ContractorWithStats[]>([]);
  const [filteredContractors, setFilteredContractors] = useState<ContractorWithStats[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('score');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const supabase = createBrowserClient(
    'https://socmxgmvovqwuzhefwmh.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvY214Z212b3Zxd3V6aGVmd21oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5OTQ3NzIsImV4cCI6MjA3NjU3MDc3Mn0.Jt-DsW-AFk_B1cgubI7StlCwyeSs3FnYdW1_UcJXlQY'
  );

  useEffect(() => {
    fetchContractors();
  }, []);

  async function fetchContractors() {
    try {
      const { data, error: fetchError } = await supabase
        .from('contractors')
        .select(`
          contractor_id,
          contractor_name,
          license_number,
          license_class,
          license_status,
          score,
          active_builds,
          builds_in_last_year,
          avg_time_to_completion_days,
          avg_time_to_pass_final_days,
          google_rating,
          google_review_count,
          yelp_rating,
          yelp_review_count,
          houzz_rating,
          houzz_review_count
        `)
        .not('license_number', 'is', null)
        .not('score', 'is', null);

      if (fetchError) throw fetchError;

      const mapped: ContractorWithStats[] = (data || []).map((contractor) => {
        const totalProjects = (contractor.active_builds || 0) + (contractor.builds_in_last_year || 0);
        const completionRate = totalProjects > 0 
          ? (contractor.builds_in_last_year || 0) / totalProjects 
          : 0;

        const ratings = [
          contractor.google_rating,
          contractor.yelp_rating,
          contractor.houzz_rating
        ].filter(r => r !== null && r > 0);
        
        const avgReviewRating = ratings.length > 0
          ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
          : 0;

        const totalReviews = 
          (contractor.google_review_count || 0) +
          (contractor.yelp_review_count || 0) +
          (contractor.houzz_review_count || 0);

        return {
          contractor_id: contractor.contractor_id,
          name_norm: contractor.contractor_name || 'Unknown',
          license_number: contractor.license_number || 'N/A',
          license_class: contractor.license_class || 'General',
          license_status: contractor.license_status || 'Unknown',
          score: contractor.score || 50,
          total_projects: totalProjects,
          completion_rate: completionRate,
          avg_days: contractor.avg_time_to_completion_days || 0,
          avg_review_rating: avgReviewRating,
          total_reviews: totalReviews,
          has_adu_signal: totalReviews > 0,
          enrolled: false,
        };
      });

      setContractors(mapped);
      setFilteredContractors(mapped);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleFilterChange(filters: FilterState) {
    let filtered = [...contractors];

    if (filters.minScore > 0) {
      filtered = filtered.filter(c => c.score >= filters.minScore);
    }

    if (searchQuery) {
      filtered = filtered.filter(c => 
        c.name_norm.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'score':
          return b.score - a.score;
        case 'projects':
          return b.total_projects - a.total_projects;
        case 'reviews':
          return b.avg_review_rating - a.avg_review_rating;
        default:
          return b.score - a.score;
      }
    });

    setFilteredContractors(filtered);
  }

  useEffect(() => {
    handleFilterChange({ projectTypes: [], zipCode: '', minScore: 0 });
  }, [searchQuery, sortBy, contractors]);

  if (loading) {
    return (
      <>
        <Header />
        <div className="min-h-screen bg-[#F4F1E8] flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#D39B1A] mx-auto mb-4"></div>
            <p className="text-[#2A2F33]/60">Loading contractors...</p>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Header />
        <div className="min-h-screen bg-[#F4F1E8] flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-[#07111E] mb-2">Error Loading Contractors</h1>
            <p className="text-[#2A2F33]/60">{error}</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header />
      <div className="min-h-screen bg-[#F4F1E8]">
        <header className="border-b border-[#2A2F33]/20 bg-white">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <Building2 className="h-8 w-8 text-[#D39B1A]" />
              <div>
                <h1 className="text-3xl font-bold text-[#07111E]">
                  ADU Contractors in Los Angeles
                </h1>
                <p className="text-sm text-[#2A2F33]/60 mt-1">
                  {filteredContractors.length} contractors • Real permit data • Transparent performance
                </p>
              </div>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="grid grid-cols-12 gap-6">
            <aside className="col-span-12 lg:col-span-3">
              <FiltersSidebar onFilterChange={handleFilterChange} />
            </aside>

            <div className="col-span-12 lg:col-span-9">
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#2A2F33]/60" />
                  <input
                    type="text"
                    placeholder="Search contractors..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-md border border-[#2A2F33]/20 pl-10 pr-4 py-2 text-sm focus:border-[#D39B1A] focus:outline-none focus:ring-1 focus:ring-[#D39B1A]"
                  />
                </div>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="rounded-md border border-[#2A2F33]/20 px-4 py-2 text-sm focus:border-[#D39B1A] focus:outline-none focus:ring-1 focus:ring-[#D39B1A]"
                >
                  <option value="score">Sort by Score</option>
                  <option value="projects">Sort by Projects</option>
                  <option value="reviews">Sort by Reviews</option>
                </select>
              </div>

              {filteredContractors.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-[#2A2F33]/60">No contractors match your filters</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                    {filteredContractors.map((contractor, index) => (
                      <ContractorCard
                        key={contractor.contractor_id}
                        contractor={contractor}
                        index={index}
                      />
                    ))}
                  </div>

                  <div className="mt-8 flex justify-center">
                    <p className="text-sm text-[#2A2F33]/60">
                      Showing {filteredContractors.length} of {contractors.length} contractors
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}