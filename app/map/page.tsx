'use client';

import { useState, useEffect, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Building2, Search } from 'lucide-react';
import Header from '../components/Header';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

interface Build {
  build_id: string;
  address: string;
  started_date: string;
  finaled_date: string | null;
  valuation: number;
  sqft: number;
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

export default function GlobalMapPage() {
  const [builds, setBuilds] = useState<Build[]>([]);
  const [filteredBuilds, setFilteredBuilds] = useState<Build[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  const supabase = createBrowserClient(
    'https://socmxgmvovqwuzhefwmh.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNvY214Z212b3Zxd3V6aGVmd21oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5OTQ3NzIsImV4cCI6MjA3NjU3MDc3Mn0.Jt-DsW-AFk_B1cgubI7StlCwyeSs3FnYdW1_UcJXlQY'
  );

  useEffect(() => {
    fetchData();
  }, []);

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

    if (selectedStatus === 'completed') {
      filtered = filtered.filter(build => build.finaled_date);
    } else if (selectedStatus === 'in-progress') {
      filtered = filtered.filter(build => !build.finaled_date);
    }

    if (searchQuery) {
      filtered = filtered.filter(build =>
        build.address.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredBuilds(filtered);
  }, [selectedYears, selectedTypes, selectedStatus, searchQuery, builds]);

  useEffect(() => {
    if (mapRef.current && filteredBuilds.length > 0) {
      updateMapMarkers();
    }
  }, [filteredBuilds]);

  useEffect(() => {
    if (mapContainer.current && builds.length > 0 && !mapRef.current) {
      initializeMap();
    }
  }, [builds]);

  async function fetchData() {
    try {
      const { data: buildsData } = await supabase
        .from('builds')
        .select('build_id, address, started_date, finaled_date, valuation, sqft, lat, lon, conversion_type')
        .not('lat', 'is', null)
        .not('lon', 'is', null)
        .order('started_date', { ascending: false });

      setBuilds(buildsData || []);
      setFilteredBuilds(buildsData || []);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }

  function initializeMap() {
    if (!mapContainer.current || filteredBuilds.length === 0) return;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-118.2437, 34.0522],
      zoom: 10,
    });

    mapRef.current = map;

    map.on('load', () => {
      updateMapMarkers();
    });
  }

  function updateMapMarkers() {
    if (!mapRef.current) return;

    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    filteredBuilds.forEach((build) => {
      const el = document.createElement('div');
      el.className = 'marker';
      el.style.backgroundColor = getYearColor(build.started_date);
      el.style.width = '10px';
      el.style.height = '10px';
      el.style.borderRadius = '50%';
      el.style.border = '2px solid white';
      el.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
      el.style.cursor = 'pointer';

      const year = new Date(build.started_date).getFullYear();

      const marker = new mapboxgl.Marker(el)
        .setLngLat([build.lon, build.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 })
            .setHTML(`
              <div style="padding: 8px; min-width: 200px;">
                <div style="font-weight: 600; margin-bottom: 4px;">${build.address}</div>
                <div style="font-size: 12px; color: #666; margin-bottom: 2px;">
                  Year: ${year} • ${build.conversion_type || 'Unknown Type'}
                </div>
                <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
                  $${build.valuation?.toLocaleString() || 'N/A'} • ${build.sqft?.toLocaleString() || 'N/A'} sqft
                </div>
                <div style="font-size: 12px; font-weight: 500; color: ${build.finaled_date ? '#1F4437' : '#D39B1A'};">
                  ${build.finaled_date ? 'Completed' : 'In Progress'}
                </div>
              </div>
            `)
        )
        .addTo(mapRef.current!);

      markersRef.current.push(marker);
    });

    if (filteredBuilds.length > 1 && mapRef.current) {
      const bounds = new mapboxgl.LngLatBounds();
      filteredBuilds.forEach(build => bounds.extend([build.lon, build.lat]));
      mapRef.current.fitBounds(bounds, { padding: 50 });
    }
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
      <>
        <Header />
        <div className="min-h-screen bg-[#F4F1E8] flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#D39B1A] mx-auto mb-4"></div>
            <p className="text-[#2A2F33]/60">Loading ADU projects...</p>
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Building2 className="h-8 w-8 text-[#D39B1A]" />
                <div>
                  <h1 className="text-3xl font-bold text-[#07111E]">
                    All ADU Projects Map
                  </h1>
                  <p className="text-sm text-[#2A2F33]/60 mt-1">
                    Showing {filteredBuilds.length.toLocaleString()} of {builds.length.toLocaleString()} projects
                  </p>
                </div>
              </div>
              <a href="/contractors" className="text-sm text-[#D39B1A] hover:underline">
                Browse Contractors
              </a>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="grid grid-cols-12 gap-6">
            <aside className="col-span-12 lg:col-span-3 space-y-6">
              <div className="rounded-lg border border-[#2A2F33]/20 bg-white p-4">
                <h3 className="text-sm font-semibold text-[#07111E] mb-3">Search Address</h3>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#2A2F33]/60" />
                  <input
                    type="text"
                    placeholder="Search by address..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-md border border-[#2A2F33]/20 pl-10 pr-4 py-2 text-sm focus:border-[#D39B1A] focus:outline-none focus:ring-1 focus:ring-[#D39B1A]"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-[#2A2F33]/20 bg-white p-4">
                <h3 className="text-sm font-semibold text-[#07111E] mb-3">Filter by Year</h3>
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
                </div>
                {selectedYears.length > 0 && (
                  <button
                    onClick={() => setSelectedYears([])}
                    className="mt-2 text-xs text-[#9A4626] hover:underline"
                  >
                    Clear years
                  </button>
                )}
              </div>

              <div className="rounded-lg border border-[#2A2F33]/20 bg-white p-4">
                <h3 className="text-sm font-semibold text-[#07111E] mb-3">Filter by Type</h3>
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
                </div>
                {selectedTypes.length > 0 && (
                  <button
                    onClick={() => setSelectedTypes([])}
                    className="mt-2 text-xs text-[#9A4626] hover:underline"
                  >
                    Clear types
                  </button>
                )}
              </div>

              <div className="rounded-lg border border-[#2A2F33]/20 bg-white p-4">
                <h3 className="text-sm font-semibold text-[#07111E] mb-3">Filter by Status</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setSelectedStatus(selectedStatus === 'completed' ? '' : 'completed')}
                    className={`w-full px-3 py-2 rounded-md text-sm transition-colors ${
                      selectedStatus === 'completed'
                        ? 'bg-[#1F4437] text-white'
                        : 'bg-[#F4F1E8] text-[#2A2F33]/60 hover:bg-[#2A2F33]/10'
                    }`}
                  >
                    Completed Only
                  </button>
                  <button
                    onClick={() => setSelectedStatus(selectedStatus === 'in-progress' ? '' : 'in-progress')}
                    className={`w-full px-3 py-2 rounded-md text-sm transition-colors ${
                      selectedStatus === 'in-progress'
                        ? 'bg-[#D39B1A] text-white'
                        : 'bg-[#F4F1E8] text-[#2A2F33]/60 hover:bg-[#2A2F33]/10'
                    }`}
                  >
                    In Progress Only
                  </button>
                </div>
              </div>
            </aside>

            <div className="col-span-12 lg:col-span-9">
              <div className="rounded-lg border border-[#2A2F33]/20 bg-white p-6">
                <div className="mb-4">
                  <h2 className="text-xl font-bold text-[#07111E] mb-2">
                    Interactive Map
                  </h2>
                  <p className="text-sm text-[#2A2F33]/60">
                    Click any marker to see project details
                  </p>
                </div>

                <div
                  ref={mapContainer}
                  className="h-[600px] rounded-lg overflow-hidden"
                />

                <div className="mt-4">
                  <div className="text-sm font-semibold text-[#07111E] mb-2">Year Legend:</div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
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
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}