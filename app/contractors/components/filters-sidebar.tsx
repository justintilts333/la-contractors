'use client';

import { useState } from 'react';
import { Sliders, MapPin, Star } from 'lucide-react';

interface FiltersSidebarProps {
  onFilterChange: (filters: FilterState) => void;
}

export interface FilterState {
  projectTypes: string[];
  zipCode: string;
  minScore: number;
}

export function FiltersSidebar({ onFilterChange }: FiltersSidebarProps) {
  const [filters, setFilters] = useState<FilterState>({
    projectTypes: [],
    zipCode: '',
    minScore: 0,
  });

  const handleProjectTypeToggle = (type: string) => {
    const updated = filters.projectTypes.includes(type)
      ? filters.projectTypes.filter(t => t !== type)
      : [...filters.projectTypes, type];
    
    const newFilters = { ...filters, projectTypes: updated };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleZipChange = (zip: string) => {
    const newFilters = { ...filters, zipCode: zip };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const handleScoreChange = (score: number) => {
    const newFilters = { ...filters, minScore: score };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const projectTypes = [
    { value: 'NEW_BUILD', label: 'New Build ADU' },
    { value: 'GARAGE', label: 'Garage Conversion' },
    { value: 'ATTIC', label: 'Attic Conversion' },
    { value: 'BASEMENT', label: 'Basement Conversion' },
  ];

  return (
    <div className="w-full space-y-6 rounded-lg border border-[#2A2F33]/20 bg-white p-6">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[#2A2F33]/10 pb-4">
        <Sliders className="h-5 w-5 text-[#D39B1A]" />
        <h2 className="text-lg font-semibold text-[#07111E]">Filters</h2>
      </div>

      {/* Project Type */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-[#07111E]">Project Type</h3>
        <div className="space-y-2">
          {projectTypes.map((type) => (
            <label
              key={type.value}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={filters.projectTypes.includes(type.value)}
                onChange={() => handleProjectTypeToggle(type.value)}
                className="h-4 w-4 rounded border-[#2A2F33]/30 text-[#D39B1A] focus:ring-[#D39B1A] focus:ring-offset-0"
              />
              <span className="text-sm text-[#2A2F33] group-hover:text-[#07111E]">
                {type.label}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* ZIP Code */}
      <div>
        <label className="mb-2 flex items-center gap-2 text-sm font-medium text-[#07111E]">
          <MapPin className="h-4 w-4" />
          ZIP Code
        </label>
        <input
          type="text"
          value={filters.zipCode}
          onChange={(e) => handleZipChange(e.target.value)}
          placeholder="e.g. 90210"
          maxLength={5}
          className="w-full rounded-md border border-[#2A2F33]/20 px-3 py-2 text-sm focus:border-[#D39B1A] focus:outline-none focus:ring-1 focus:ring-[#D39B1A]"
        />
      </div>

      {/* Score Range */}
      <div>
        <label className="mb-2 flex items-center justify-between text-sm font-medium text-[#07111E]">
          <span className="flex items-center gap-2">
            <Star className="h-4 w-4" />
            Min Score
          </span>
          <span className="text-[#D39B1A]">{filters.minScore}</span>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={filters.minScore}
          onChange={(e) => handleScoreChange(Number(e.target.value))}
          className="w-full accent-[#D39B1A]"
        />
        <div className="mt-1 flex justify-between text-xs text-[#2A2F33]/60">
          <span>0</span>
          <span>100</span>
        </div>
      </div>

      {/* Reset Button */}
      {(filters.projectTypes.length > 0 || filters.zipCode || filters.minScore > 0) && (
        <button
          onClick={() => {
            const reset = { projectTypes: [], zipCode: '', minScore: 0 };
            setFilters(reset);
            onFilterChange(reset);
          }}
          className="w-full rounded-md border border-[#2A2F33]/20 px-4 py-2 text-sm font-medium text-[#2A2F33] hover:bg-[#F4F1E8] transition-colors"
        >
          Clear Filters
        </button>
      )}
    </div>
  );
}