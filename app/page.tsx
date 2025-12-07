'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Building2, Search, CheckCircle, TrendingUp, Users, MapPin, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import Header from './components/Header';

interface Contractor {
  contractor_id: string;
  contractor_name: string;
  license_number: string;
  license_class: string;
  score: number;
  active_builds: number;
  builds_in_last_year: number;
  avg_time_to_completion_days: number;
  google_rating: number;
  google_review_count: number;
}

export default function LandingPage() {
  const [featuredContractors, setFeaturedContractors] = useState<Contractor[]>([]);
  const [stats, setStats] = useState({
    totalProjects: 0,
    totalContractors: 0,
    avgScore: 0,
  });
  const [loading, setLoading] = useState(true);

  const supabase = createBrowserClient(
    'https://socmxgmvovqwuzhefwmh.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvY214Z212b3Zxd3V6aGVmd21oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5OTQ3NzIsImV4cCI6MjA3NjU3MDc3Mn0.Jt-DsW-AFk_B1cgubI7StlCwyeSs3FnYdW1_UcJXlQY'
  );

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const { data: contractors } = await supabase
        .from('contractors')
        .select('contractor_id, contractor_name, license_number, license_class, score, active_builds, builds_in_last_year, avg_time_to_completion_days, google_rating, google_review_count')
        .not('score', 'is', null)
        .order('score', { ascending: false })
        .limit(6);

      setFeaturedContractors(contractors || []);

      const { count: projectCount } = await supabase
        .from('builds')
        .select('*', { count: 'exact', head: true });

      const { count: contractorCount } = await supabase
        .from('contractors')
        .select('*', { count: 'exact', head: true });

      setStats({
        totalProjects: projectCount || 0,
        totalContractors: contractorCount || 0,
        avgScore: contractors?.length ? Math.round(contractors.reduce((sum, c) => sum + (c.score || 0), 0) / contractors.length) : 0,
      });
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <div className="min-h-screen bg-[#F4F1E8]">
        <section className="relative bg-gradient-to-br from-[#1F4437] to-[#15362B] text-white">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
            <div className="text-center">
              <h1 className="text-5xl font-bold tracking-tight sm:text-6xl mb-6">
                Find Vetted ADU Contractors<br />in Los Angeles
              </h1>
              <p className="text-xl text-white/90 mb-8 max-w-2xl mx-auto">
                Real performance data from {stats.totalProjects.toLocaleString()}+ ADU projects.
                See which contractors finish on time, pass inspections, and earn great reviews.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/contractors"
                  className="inline-flex items-center justify-center px-8 py-4 rounded-lg bg-[#D39B1A] text-white font-semibold hover:bg-[#B8850F] transition-colors gap-2"
                >
                  Browse All Contractors
                  <ArrowRight className="h-5 w-5" />
                </Link>
                <Link
                  href="/map"
                  className="inline-flex items-center justify-center px-8 py-4 rounded-lg bg-white/10 text-white font-semibold hover:bg-white/20 transition-colors gap-2 backdrop-blur-sm"
                >
                  <MapPin className="h-5 w-5" />
                  Explore Project Map
                </Link>
              </div>
            </div>
          </div>

          <div className="border-t border-white/20 bg-white/5 backdrop-blur-sm">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
                <div>
                  <div className="text-4xl font-bold mb-1">{stats.totalProjects.toLocaleString()}</div>
                  <div className="text-white/80 text-sm">ADU Projects Tracked</div>
                </div>
                <div>
                  <div className="text-4xl font-bold mb-1">{stats.totalContractors.toLocaleString()}</div>
                  <div className="text-white/80 text-sm">Contractors Listed</div>
                </div>
                <div>
                  <div className="text-4xl font-bold mb-1">{stats.avgScore}</div>
                  <div className="text-white/80 text-sm">Average Quality Score</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-[#07111E] mb-3">
                Top Rated Contractors
              </h2>
              <p className="text-[#2A2F33]/60">
                Based on real permit data, inspection results, and customer reviews
              </p>
            </div>

            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#D39B1A] mx-auto"></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {featuredContractors.map((contractor) => (
                  <Link
                    key={contractor.contractor_id}
                    href={`/contractors/${contractor.contractor_id}`}
                    className="block rounded-lg border border-[#2A2F33]/20 bg-white p-6 hover:shadow-lg transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h3 className="font-semibold text-[#07111E] mb-1">
                          {contractor.contractor_name}
                        </h3>
                        <p className="text-sm text-[#2A2F33]/60">
                          {contractor.license_class} #{contractor.license_number}
                        </p>
                      </div>
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#1F4437] to-[#15362B]">
                        <div className="text-center">
                          <div className="text-lg font-bold text-white">{contractor.score || 50}</div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-[#2A2F33]/60">
                        <Building2 className="h-4 w-4" />
                        <span>{(contractor.active_builds || 0) + (contractor.builds_in_last_year || 0)} projects</span>
                      </div>
                      <div className="flex items-center gap-2 text-[#2A2F33]/60">
                        <TrendingUp className="h-4 w-4" />
                        <span>{contractor.avg_time_to_completion_days?.toFixed(0) || 'N/A'} days avg</span>
                      </div>
                      {contractor.google_rating && (
                        <div className="flex items-center gap-2 text-[#2A2F33]/60">
                          <CheckCircle className="h-4 w-4" />
                          <span>{contractor.google_rating.toFixed(1)} ★ ({contractor.google_review_count} reviews)</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-[#2A2F33]/10">
                      <div className="text-sm font-medium text-[#D39B1A] flex items-center gap-1">
                        View Profile
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            <div className="text-center mt-8">
              <Link
                href="/contractors"
                className="inline-flex items-center gap-2 text-[#D39B1A] hover:underline font-medium"
              >
                View All {stats.totalContractors.toLocaleString()} Contractors
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        <section className="py-16 bg-white">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold text-[#07111E] mb-3">
                How It Works
              </h2>
              <p className="text-[#2A2F33]/60">
                We track real ADU project data so you can make informed decisions
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#1F4437]/10 mx-auto mb-4">
                  <Search className="h-8 w-8 text-[#1F4437]" />
                </div>
                <h3 className="text-xl font-semibold text-[#07111E] mb-2">
                  1. Browse Contractors
                </h3>
                <p className="text-[#2A2F33]/60">
                  See all ADU contractors with transparent performance data from real permits and inspections
                </p>
              </div>

              <div className="text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#D39B1A]/10 mx-auto mb-4">
                  <CheckCircle className="h-8 w-8 text-[#D39B1A]" />
                </div>
                <h3 className="text-xl font-semibold text-[#07111E] mb-2">
                  2. Compare Performance
                </h3>
                <p className="text-[#2A2F33]/60">
                  Review completion rates, timelines, inspection pass rates, and customer reviews
                </p>
              </div>

              <div className="text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#07111E]/10 mx-auto mb-4">
                  <Users className="h-8 w-8 text-[#07111E]" />
                </div>
                <h3 className="text-xl font-semibold text-[#07111E] mb-2">
                  3. Request Quotes
                </h3>
                <p className="text-[#2A2F33]/60">
                  Contact your top picks directly to get quotes and start your ADU project
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="py-16 bg-gradient-to-br from-[#D39B1A] to-[#B8850F] text-white">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl font-bold mb-4">
              Ready to Find Your ADU Contractor?
            </h2>
            <p className="text-xl text-white/90 mb-8">
              Browse {stats.totalContractors.toLocaleString()} contractors with real performance data
            </p>
            <Link
              href="/contractors"
              className="inline-flex items-center justify-center px-8 py-4 rounded-lg bg-white text-[#D39B1A] font-semibold hover:bg-white/90 transition-colors gap-2"
            >
              Get Started Now
              <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}