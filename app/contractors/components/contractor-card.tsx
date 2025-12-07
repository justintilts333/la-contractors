'use client';

import { motion } from 'framer-motion';
import { Building2, Calendar, Star, TrendingUp, CheckCircle2, Zap } from 'lucide-react';
import Link from 'next/link';

interface ContractorCardProps {
  contractor: {
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
  };
  index: number;
}

export function ContractorCard({ contractor, index }: ContractorCardProps) {
  const getScoreGradient = (score: number) => {
    if (score >= 90) return 'from-[#1F4437] to-[#2A5F4E]';
    if (score >= 75) return 'from-[#D39B1A] to-[#E6B84D]';
    if (score >= 60) return 'from-[#D39B1A] to-[#9A4626]';
    return 'from-[#9A4626] to-[#7A3820]';
  };

  const trustBadges = [];
  if (contractor.has_adu_signal) {
    trustBadges.push({ 
      icon: Building2, 
      label: 'ADU Specialist', 
      bgColor: 'bg-[#D39B1A]/10',
      textColor: 'text-[#D39B1A]'
    });
  }
  if (contractor.completion_rate > 0.9) {
    trustBadges.push({ 
      icon: CheckCircle2, 
      label: 'High Completion',
      bgColor: 'bg-[#1F4437]/10',
      textColor: 'text-[#1F4437]'
    });
  }
  if (contractor.avg_review_rating > 4.5) {
    trustBadges.push({ 
      icon: Star, 
      label: 'Top Rated',
      bgColor: 'bg-[#D39B1A]/10',
      textColor: 'text-[#D39B1A]'
    });
  }
  if (contractor.avg_days < 150) {
    trustBadges.push({ 
      icon: Zap, 
      label: 'Fast Builder',
      bgColor: 'bg-[#D39B1A]/10',
      textColor: 'text-[#D39B1A]'
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      whileHover={{ y: -4, scale: 1.02 }}
      className="group relative"
    >
      <Link href={`/contractors/${contractor.contractor_id}`}>
        <div className="relative h-full rounded-lg border border-[#2A2F33]/20 bg-[#F4F1E8] p-6 shadow-sm transition-all hover:shadow-lg hover:border-[#D39B1A]/50">
          
          {contractor.enrolled && (
            <div className="absolute top-4 right-4 flex items-center gap-1 rounded-full bg-[#1F4437]/10 px-2 py-1 text-xs font-medium text-[#1F4437]">
              <CheckCircle2 className="h-3 w-3" />
              <span>Available</span>
            </div>
          )}

          <div className="mb-4">
            <h3 className="text-xl font-bold text-[#07111E] group-hover:text-[#D39B1A] transition-colors">
              {contractor.name_norm}
            </h3>
            <p className="text-sm text-[#2A2F33]/60 mt-1">
              {contractor.license_class} #{contractor.license_number} • {contractor.license_status}
            </p>
          </div>

          <div className={`inline-flex items-center gap-2 rounded-lg bg-gradient-to-r ${getScoreGradient(contractor.score)} px-4 py-2 mb-4`}>
            <TrendingUp className="h-5 w-5 text-white" />
            <div className="text-white">
              <span className="text-2xl font-bold">{Math.round(contractor.score)}</span>
              <span className="text-sm opacity-90 ml-1">/ 100</span>
            </div>
            <span className="text-xs text-white/80 ml-1">Score</span>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[#2A2F33]/60" />
              <span className="font-semibold text-[#07111E]">{contractor.total_projects}</span>
              <span className="text-[#2A2F33]/60">Projects</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#2A2F33]/60" />
              <span className="font-semibold text-[#07111E]">{Math.round(contractor.completion_rate * 100)}%</span>
              <span className="text-[#2A2F33]/60">Complete</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-[#2A2F33]/60" />
              <span className="font-semibold text-[#07111E]">{contractor.avg_days}</span>
              <span className="text-[#2A2F33]/60">days avg</span>
            </div>
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-[#2A2F33]/60" />
              <span className="font-semibold text-[#07111E]">
                {contractor.avg_review_rating > 0 ? contractor.avg_review_rating.toFixed(1) : 'N/A'}
              </span>
              {contractor.total_reviews > 0 && (
                <span className="text-[#2A2F33]/60">({contractor.total_reviews})</span>
              )}
            </div>
          </div>

          {trustBadges.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {trustBadges.map((badge, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-1 rounded-full ${badge.bgColor} px-2 py-1 text-xs font-medium ${badge.textColor}`}
                >
                  <badge.icon className="h-3 w-3" />
                  <span>{badge.label}</span>
                </div>
              ))}
            </div>
          )}

          <div className="pt-4 border-t border-[#2A2F33]/10">
            <span className="text-sm font-medium text-[#D39B1A] group-hover:underline">
              View Full Profile →
            </span>
          </div>

        </div>
      </Link>
    </motion.div>
  );
}