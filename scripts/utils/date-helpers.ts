/**
 * Calculate days between two dates
 * Returns positive integer for days elapsed
 */
export function daysBetween(earlier: Date | string, later: Date | string): number {
    const earlierDate = typeof earlier === 'string' ? new Date(earlier) : earlier;
    const laterDate = typeof later === 'string' ? new Date(later) : later;
    
    const diffMs = laterDate.getTime() - earlierDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    return diffDays;
  }
  
  /**
   * Calculate duration with validation
   * Returns NULL if invalid (same day, negative, or missing dates)
   */
  export function calculateDuration(
    earlier: Date | string | null,
    later: Date | string | null
  ): number | null {
    if (!earlier || !later) return null;
    
    const days = daysBetween(earlier, later);
    
    // Same day or negative (later comes before earlier)
    if (days <= 0) return null;
    
    return days;
  }
  