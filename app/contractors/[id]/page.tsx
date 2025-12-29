'use client';

import { useState, useEffect, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useParams } from 'next/navigation';
import { Building2, Star, Clock, CheckCircle, Calendar, TrendingUp } from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

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
  completion_rate: number;
  google_rating: number;
  google_review_count: number;
  yelp_rating: number;
  yelp_review_count: number;
  years_in_business: number;
  bond_status: string;
  bond_amount: number;
  workers_comp_status: string;
}

interface Build {
  build_id: string;
  address: string;
  started_date: string;
  finaled_date: string | null;
  valuation: number;
  sqft: number;
  completion_status: string;
  time_to_completion_days: number;
  total_failures: number;
  lat: number;
  lon: number;
  conversion_type: string | null;
}

const YEAR_COLORS: { [key: number]: string } = {
  2024: '#1F4437',
  2023: '#2D6B4F',
  2022: '#4A9B7A',
  2021: '#6BC4A4',
  2020: '#8FD5BC',
  2019: '#B3E5D4',
  2018: '#D39B1A',
  2017: '#B8850F',
  2016: '#9A6F0C',
  2015: '#7D5A0A',
};

function getYearColor(dateString: string): string {
  if (!dateString) return '#999999';
  const year = new Date(dateString).getFullYear();
  return YEAR_COLORS[year] || '#999999';
}

export default function ContractorDetailPage() {
  const params = useParams();
  const contractorId = params.id as string;
  
  const [contractor, setContractor] = useState<Contractor | null>(null);
  const [builds, setBuilds] = useState<Build[]>([]);
  const [filteredBuilds, setFilteredBuilds] = useState<Build[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  const overviewMapContainer = useRef<HTMLDivElement>(null);
  const projectsMapContainer = useRef<HTMLDivElement>(null);
  const overviewMapRef = useRef<mapboxgl.Map | null>(null);
  const projectsMapRef = useRef<mapboxgl.Map | null>(null);

  const supabase = createBrowserClient(
    'https://socmxgmvovqwuzhefwmh.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvY214Z212b3Zxd3V6aGVmd21oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5OTQ3NzIsImV4cCI6MjA3NjU3MDc3Mn0.Jt-DsW-AFk_B1cgubI7StlCwyeSs3FnYdW1_UcJXlQY'
  );

  useEffect(() => {
    fetchData();
  }, [contractorId]);

  useEffect(() => {
    let filtered = [...builds];

    if (selectedYears.length > 0) {
      filtered = filtered.filter(build => {
        const year = new Date(build.started_date).getFullYear();
        return selectedYears.includes(year);
      });
    }

    if (selectedTypes.length > 0) {
      filtered = filtered.filter(build => {
        return selectedTypes.includes(build.conversion_type || 'Unknown');
      });
    }

    setFilteredBuilds(filtered);
  }, [selectedYears, selectedTypes, builds]);

  useEffect(() => {
    if (activeTab === 'overview' && overviewMapContainer.current && filteredBuilds.length > 0) {
      if (overviewMapRef.current) {
        overviewMapRef.current.remove();
      }
      initializeOverviewMap();
    }
  }, [activeTab, filteredBuilds]);

  useEffect(() => {
    if (activeTab === 'projects' && projectsMapContainer.current && filteredBuilds.length > 0) {
      if (projectsMapRef.current) {
        projectsMapRef.current.remove();
      }
      initializeProjectsMap();
    }
  }, [activeTab, filteredBuilds]);

  async function fetchData() {
    try {
      const { data: contractorData, error: contractorError } = await supabase
        .from('contractors')
        .select('*')
        .eq('contractor_id', contractorId)
        .single();

      if (contractorError) throw contractorError;
      setContractor(contractorData);

      const { data: buildLinks } = await supabase
        .from('build_contractors')
        .select('build_id')
        .eq('contractor_id', contractorId);

      if (buildLinks && buildLinks.length > 0) {
        const buildIds = buildLinks.map(link => link.build_id);
        const { data: buildsData } = await supabase
          .from('builds')
          .select('build_id, address, started_date, finaled_date, valuation, sqft, completion_status, time_to_completion_days, total_failures, lat, lon, conversion_type')
          .in('build_id', buildIds)
          .not('lat', 'is', null)
          .not('lon', 'is', null)
          .order('started_date', { ascending: false });

        setBuilds(buildsData || []);
        setFilteredBuilds(buildsData || []);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }

  function initializeOverviewMap() {
    if (!overviewMapContainer.current || filteredBuilds.length === 0) return;

    const map = new mapboxgl.Map({
      container: overviewMapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [filteredBuilds[0].lon, filteredBuilds[0].lat],
      zoom: 11,
    });

    filteredBuilds.forEach((build) => {
      const el = document.createElement('div');
      el.className = 'marker';
      el.style.backgroundColor = getYearColor(build.started_date);
      el.style.width = '12px';
      el.style.height = '12px';
      el.style.borderRadius = '50%';
      el.style.border = '2px solid white';
      el.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';

      const year = new Date(build.started_date).getFullYear();

      new mapboxgl.Marker(el)
        .setLngLat([build.lon, build.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 })
            .setHTML(`
              <div style="padding: 8px;">
                <div style="font-weight: 600; margin-bottom: 4px;">${build.address}</div>
                <div style="font-size: 12px; color: #666; margin-bottom: 2px;">
                  Year: ${year}
                </div>
                <div style="font-size: 12px; color: #666;">
                  ${build.conversion_type || 'Unknown Type'}
                </div>
              </div>
            `)
        )
        .addTo(map);
    });

    if (filteredBuilds.length > 1) {
      const bounds = new mapboxgl.LngLatBounds();
      filteredBuilds.forEach(build => bounds.extend([build.lon, build.lat]));
      map.fitBounds(bounds, { padding: 50 });
    }

    overviewMapRef.current = map;
  }

  function initializeProjectsMap() {
    if (!projectsMapContainer.current || filteredBuilds.length === 0) return;

    const map = new mapboxgl.Map({
      container: projectsMapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [filteredBuilds[0].lon, filteredBuilds[0].lat],
      zoom: 11,
    });

    filteredBuilds.forEach((build) => {
      const el = document.createElement('div');
      el.className = 'marker';
      el.style.backgroundColor = getYearColor(build.started_date);
      el.style.width = '12px';
      el.style.height = '12px';
      el.style.borderRadius = '50%';
      el.style.border = '2px solid white';
      el.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';

      const year = new Date(build.started_date).getFullYear();

      new mapboxgl.Marker(el)
        .setLngLat([build.lon, build.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 })
            .setHTML(`
              <div style="padding: 8px;">
                <div style="font-weight: 600; margin-bottom: 4px;">${build.address}</div>
                <div style="font-size: 12px; color: #666; margin-bottom: 2px;">
                  Year: ${year} • ${build.conversion_type || 'Unknown Type'}
                </div>
                <div style="font-size: 12px; color: #666;">
                  $${build.valuation?.toLocaleString() || 'N/A'} • ${build.finaled_date ? 'Completed' : 'In Progress'}
                </div>
              </div>
            `)
        )
        .addTo(map);
    });

    if (filteredBuilds.length > 1) {
      const bounds = new mapboxgl.LngLatBounds();
      filteredBuilds.forEach(build => bounds.extend([build.lon, build.lat]));
      map.fitBounds(bounds, { padding: 50 });
    }

    projectsMapRef.current = map;
  }

  const availableYears = Array.from(new Set(builds.map(b => new Date(b.started_date).getFullYear()))).sort((a, b) => b - a);
  const availableTypes = Array.from(new Set(builds.map(b => b.conversion_type || 'Unknown'))).sort();

  function toggleYear(year: number) {
    setSelectedYears(prev => 
      prev.includes(year) ? prev.filter(y => y !== year) : [...prev, year]
    );
  }

  function toggleType(type: string) {
    setSelectedTypes(prev => 
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
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
          <a href="/contractors" className="text-[#D39B1A] hover:underline">Back to List</a>
        </div>
      </div>
    );
  }

  const totalProjects = builds.length;
  const completedBuilds = builds.filter(b => b.finaled_date).length;
  const completionRate = contractor.completion_rate ?? 0;

  const avgReviewRating = contractor.google_rating && contractor.yelp_rating
    ? ((contractor.google_rating + contractor.yelp_rating) / 2).toFixed(1)
    : contractor.google_rating?.toFixed(1) || contractor.yelp_rating?.toFixed(1) || 'N/A';

  const totalReviews = (contractor.google_review_count || 0) + (contractor.yelp_review_count || 0);

  return (
    <div className="min-h-screen bg-[#F4F1E8]">
      <header className="border-b border-[#2A2F33]/20 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <a href="/contractors" className="text-sm text-[#2A2F33]/60 hover:text-[#D39B1A] mb-4 inline-block">
            Back to Contractors
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

            <div className="flex flex-col items-end gap-3">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#1F4437] to-[#15362B]">
                <div className="text-center">
                  <div className="text-2xl font-bold text-white">{contractor.score || 50}</div>
                  <div className="text-xs text-white/80">Score</div>
                </div>
              </div>
              <button
                onClick={() => alert('Quote request form coming in Week 7 with Twilio integration!')}
                className="px-6 py-3 rounded-lg bg-[#D39B1A] text-white font-semibold hover:bg-[#B8850F] transition-colors whitespace-nowrap"
              >
                Request Quote
              </button>
            </div>
          </div>

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

      <div className="border-b border-[#2A2F33]/20 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-8">
            {['overview', 'projects', 'status', 'timeline'].map((tab) => (
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

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-[#07111E] mb-4">Performance Highlights</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-[#2A2F33]/20 bg-white p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1F4437]/10">
                      <CheckCircle className="h-5 w-5 text-[#1F4437]" />
                    </div>
                    <h3 className="font-semibold text-[#07111E]">Completion Rate</h3>
                  </div>
                  <div className="text-3xl font-bold text-[#07111E] mb-2">{completionRate}%</div>
                  <p className="text-sm text-[#2A2F33]/60">
                    {completionRate >= 80 ? 'Excellent track record' : completionRate >= 60 ? 'Good completion rate' : 'Building portfolio'}
                  </p>
                </div>

                <div className="rounded-lg border border-[#2A2F33]/20 bg-white p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#D39B1A]/10">
                      <Clock className="h-5 w-5 text-[#D39B1A]" />
                    </div>
                    <h3 className="font-semibold text-[#07111E]">Average Timeline</h3>
                  </div>
                  <div className="text-3xl font-bold text-[#07111E] mb-2">
                    {contractor.avg_time_to_completion_days?.toFixed(0) || 'N/A'} days
                  </div>
                  <p className="text-sm text-[#2A2F33]/60">
                    {(contractor.avg_time_to_completion_days || 0) < 90 ? 'Faster than average' : 
                     (contractor.avg_time_to_completion_days || 0) < 150 ? 'Average timeline' : 
                     'Longer projects'}
                  </p>
                </div>

                <div className="rounded-lg border border-[#2A2F33]/20 bg-white p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#07111E]/10">
                      <Building2 className="h-5 w-5 text-[#07111E]" />
                    </div>
                    <h3 className="font-semibold text-[#07111E]">Total Projects</h3>
                  </div>
                  <div className="text-3xl font-bold text-[#07111E] mb-2">{totalProjects}</div>
                  <p className="text-sm text-[#2A2F33]/60">
                    {totalProjects >= 10 ? 'Experienced builder' : totalProjects >= 5 ? 'Growing portfolio' : 'Newer contractor'}
                  </p>
                </div>
              </div>
            </div>

            {builds.length > 0 && (
              <div className="rounded-lg border border-[#2A2F33]/20 bg-white p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-[#07111E]">All Projects Map</h2>
                  <p className="text-sm text-[#2A2F33]/60">
                    Showing {filteredBuilds.length} of {builds.length} projects
                  </p>
                </div>

                <div className="mb-4 space-y-3">
                  <div>
                    <div className="text-sm font-medium text-[#07111E] mb-2">Filter by Year:</div>
                    <div className="flex flex-wrap gap-2">
                      {availableYears.map(year => (
                        <button
                          key={year}
                          onClick={() => toggleYear(year)}
                          className={`px-3 py-1 rounded-full text-sm transition-colors ${
                            selectedYears.includes(year)
                              ? 'bg-[#D39B1A] text-white'
                              : 'bg-[#F4F1E8] text-[#2A2F33]/60 hover:bg-[#2A2F33]/10'
                          }`}
                        >
                          {year}
                        </button>
                      ))}
                      {selectedYears.length > 0 && (
                        <button
                          onClick={() => setSelectedYears([])}
                          className="px-3 py-1 rounded-full text-sm bg-[#9A4626]/10 text-[#9A4626] hover:bg-[#9A4626]/20"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-[#07111E] mb-2">Filter by Type:</div>
                    <div className="flex flex-wrap gap-2">
                      {availableTypes.map(type => (
                        <button
                          key={type}
                          onClick={() => toggleType(type)}
                          className={`px-3 py-1 rounded-full text-sm transition-colors ${
                            selectedTypes.includes(type)
                              ? 'bg-[#1F4437] text-white'
                              : 'bg-[#F4F1E8] text-[#2A2F33]/60 hover:bg-[#2A2F33]/10'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                      {selectedTypes.length > 0 && (
                        <button
                          onClick={() => setSelectedTypes([])}
                          className="px-3 py-1 rounded-full text-sm bg-[#9A4626]/10 text-[#9A4626] hover:bg-[#9A4626]/20"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div 
                  ref={overviewMapContainer} 
                  className="h-96 rounded-lg overflow-hidden"
                />
                
                <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                  {Object.entries(YEAR_COLORS).map(([year, color]) => (
                    <div key={year} className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full border-2 border-white" 
                        style={{ backgroundColor: color, boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }}
                      />
                      <span className="text-[#2A2F33]/60">{year}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-lg border border-[#2A2F33]/20 bg-white p-6">
              <h2 className="text-xl font-bold text-[#07111E] mb-4">License Information</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-sm text-[#2A2F33]/60 mb-1">License Number</div>
                  <div className="font-medium text-[#07111E]">{contractor.license_class} #{contractor.license_number}</div>
                </div>
                <div>
                  <div className="text-sm text-[#2A2F33]/60 mb-1">Status</div>
                  <div className={`font-medium ${
                    contractor.license_status === 'ACTIVE' ? 'text-[#1F4437]' : 'text-[#9A4626]'
                  }`}>
                    {contractor.license_status || 'Unknown'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'projects' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-[#07111E]">All Projects ({totalProjects})</h2>
              <p className="text-sm text-[#2A2F33]/60">
                Showing {filteredBuilds.length} filtered projects
              </p>
            </div>
            
            {builds.length > 0 && (
              <div className="rounded-lg border border-[#2A2F33]/20 bg-white p-6">
                <h3 className="text-lg font-semibold text-[#07111E] mb-4">Project Locations</h3>
                
                <div className="mb-4 space-y-3">
                  <div>
                    <div className="text-sm font-medium text-[#07111E] mb-2">Filter by Year:</div>
                    <div className="flex flex-wrap gap-2">
                      {availableYears.map(year => (
                        <button
                          key={year}
                          onClick={() => toggleYear(year)}
                          className={`px-3 py-1 rounded-full text-sm transition-colors ${
                            selectedYears.includes(year)
                              ? 'bg-[#D39B1A] text-white'
                              : 'bg-[#F4F1E8] text-[#2A2F33]/60 hover:bg-[#2A2F33]/10'
                          }`}
                        >
                          {year}
                        </button>
                      ))}
                      {selectedYears.length > 0 && (
                        <button
                          onClick={() => setSelectedYears([])}
                          className="px-3 py-1 rounded-full text-sm bg-[#9A4626]/10 text-[#9A4626] hover:bg-[#9A4626]/20"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-[#07111E] mb-2">Filter by Type:</div>
                    <div className="flex flex-wrap gap-2">
                      {availableTypes.map(type => (
                        <button
                          key={type}
                          onClick={() => toggleType(type)}
                          className={`px-3 py-1 rounded-full text-sm transition-colors ${
                            selectedTypes.includes(type)
                              ? 'bg-[#1F4437] text-white'
                              : 'bg-[#F4F1E8] text-[#2A2F33]/60 hover:bg-[#2A2F33]/10'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                      {selectedTypes.length > 0 && (
                        <button
                          onClick={() => setSelectedTypes([])}
                          className="px-3 py-1 rounded-full text-sm bg-[#9A4626]/10 text-[#9A4626] hover:bg-[#9A4626]/20"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div 
                  ref={projectsMapContainer} 
                  className="h-96 rounded-lg overflow-hidden"
                />
                
                <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                  {Object.entries(YEAR_COLORS).map(([year, color]) => (
                    <div key={year} className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full border-2 border-white" 
                        style={{ backgroundColor: color, boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }}
                      />
                      <span className="text-[#2A2F33]/60">{year}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {filteredBuilds.length === 0 ? (
              <div className="text-center py-12 text-[#2A2F33]/60">
                No projects match your filters
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse bg-white rounded-lg overflow-hidden">
                  <thead className="bg-[#F4F1E8]">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#07111E]">Address</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#07111E]">Year</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#07111E]">Type</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#07111E]">Started</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#07111E]">Finaled</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#07111E]">Days</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#07111E]">Valuation</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#07111E]">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2A2F33]/10">
                    {filteredBuilds.map((build) => {
                      const year = new Date(build.started_date).getFullYear();
                      return (
                        <tr key={build.build_id} className="hover:bg-[#F4F1E8]/50 transition-colors">
                          <td className="px-4 py-3 text-sm text-[#07111E]">{build.address}</td>
                          <td className="px-4 py-3 text-sm">
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-3 h-3 rounded-full border border-white" 
                                style={{ backgroundColor: getYearColor(build.started_date) }}
                              />
                              <span className="text-[#2A2F33]/60">{year}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-[#2A2F33]/60">
                            {build.conversion_type || 'Unknown'}
                          </td>
                          <td className="px-4 py-3 text-sm text-[#2A2F33]/60">
                            {build.started_date ? new Date(build.started_date).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-[#2A2F33]/60">
                            {build.finaled_date ? new Date(build.finaled_date).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-[#07111E]">
                            {build.time_to_completion_days || '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-[#07111E]">
                            ${build.valuation?.toLocaleString() || '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                              build.finaled_date 
                                ? 'bg-[#1F4437]/10 text-[#1F4437]' 
                                : 'bg-[#D39B1A]/10 text-[#D39B1A]'
                            }`}>
                              {build.completion_status || (build.finaled_date ? 'Completed' : 'In Progress')}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'status' && (
          <div className="space-y-6">
            <div className="rounded-lg border border-[#2A2F33]/20 bg-white p-6">
              <h2 className="text-xl font-bold text-[#07111E] mb-6">License & Compliance</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="text-sm text-[#2A2F33]/60 mb-2">License Number</div>
                  <div className="text-lg font-semibold text-[#07111E]">
                    {contractor.license_class} #{contractor.license_number}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-[#2A2F33]/60 mb-2">License Status</div>
                  <div className={`text-lg font-semibold ${
                    contractor.license_status === 'ACTIVE' ? 'text-[#1F4437]' : 'text-[#9A4626]'
                  }`}>
                    {contractor.license_status || 'Unknown'}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-[#2A2F33]/60 mb-2">Workers Comp</div>
                  <div className="text-lg font-semibold text-[#07111E]">
                    {contractor.workers_comp_status || 'Not Available'}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-[#2A2F33]/60 mb-2">Bond Status</div>
                  <div className="text-lg font-semibold text-[#07111E]">
                    {contractor.bond_status || 'Not Available'}
                    {contractor.bond_amount && (
                      <span className="text-sm text-[#2A2F33]/60 ml-2">
                        (${contractor.bond_amount.toLocaleString()})
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-[#2A2F33]/60 mb-2">Years in Business</div>
                  <div className="text-lg font-semibold text-[#07111E]">
                    {contractor.years_in_business || 'Not Available'} years
                  </div>
                </div>

                <div>
                  <div className="text-sm text-[#2A2F33]/60 mb-2">Active Projects</div>
                  <div className="text-lg font-semibold text-[#07111E]">
                    {contractor.active_builds || 0}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#2A2F33]/20 bg-white p-6">
              <h2 className="text-xl font-bold text-[#07111E] mb-4">Recent Activity</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-[#2A2F33]/60 mb-1">Last 12 Months</div>
                  <div className="text-2xl font-bold text-[#07111E]">
                    {contractor.builds_in_last_year || 0} projects
                  </div>
                </div>
                <div>
                  <div className="text-sm text-[#2A2F33]/60 mb-1">Currently Active</div>
                  <div className="text-2xl font-bold text-[#07111E]">
                    {contractor.active_builds || 0} projects
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-[#07111E]">Project History</h2>
            
            {builds.length === 0 ? (
              <div className="text-center py-12 text-[#2A2F33]/60">
                No project history available
              </div>
            ) : (
              <div className="space-y-4">
                {builds.slice(0, 10).map((build, index) => {
                  const year = new Date(build.started_date).getFullYear();
                  return (
                    <div key={build.build_id} className="flex gap-4 items-start">
                      <div className="flex flex-col items-center">
                        <div 
                          className="flex h-10 w-10 items-center justify-center rounded-full"
                          style={{ backgroundColor: getYearColor(build.started_date) }}
                        >
                          {build.finaled_date ? (
                            <CheckCircle className="h-5 w-5 text-white" />
                          ) : (
                            <Clock className="h-5 w-5 text-white" />
                          )}
                        </div>
                        {index < builds.slice(0, 10).length - 1 && (
                          <div className="w-0.5 h-16 bg-[#2A2F33]/20 mt-2"></div>
                        )}
                      </div>

                      <div className="flex-1 rounded-lg border border-[#2A2F33]/20 bg-white p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="font-semibold text-[#07111E]">{build.address}</div>
                            <div className="text-sm text-[#2A2F33]/60 mt-1">
                              {year} • {build.conversion_type || 'Unknown Type'}
                            </div>
                            <div className="text-sm text-[#2A2F33]/60">
                              Started: {build.started_date ? new Date(build.started_date).toLocaleDateString() : 'Not Available'}
                            </div>
                          </div>
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                            build.finaled_date 
                              ? 'bg-[#1F4437]/10 text-[#1F4437]' 
                              : 'bg-[#D39B1A]/10 text-[#D39B1A]'
                          }`}>
                            {build.completion_status || (build.finaled_date ? 'Completed' : 'In Progress')}
                          </span>
                        </div>
                        <div className="flex gap-4 text-sm text-[#2A2F33]/60">
                          <span>${build.valuation?.toLocaleString() || '—'}</span>
                          <span>•</span>
                          <span>{build.sqft?.toLocaleString() || '—'} sqft</span>
                          {build.time_to_completion_days && (
                            <>
                              <span>•</span>
                              <span>{build.time_to_completion_days} days</span>
                            </>
                          )}
                          {build.finaled_date && (
                            <>
                              <span>•</span>
                              <span>Finaled: {new Date(build.finaled_date).toLocaleDateString()}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}