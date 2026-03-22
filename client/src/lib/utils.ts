import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const _usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a cent-denominated integer as a US dollar string with commas.
 * e.g. 150000 → "$1,500.00"
 */
export function formatCurrency(cents: number): string {
  return _usdFormatter.format(cents / 100);
}

/**
 * Format a dollar-denominated float as a US dollar string with commas.
 * e.g. 1500.0 → "$1,500.00"
 */
export function formatDollarAmount(dollars: number): string {
  return _usdFormatter.format(dollars);
}

export function formatCompactCurrency(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 10_000) {
    const k = abs / 1_000;
    if (k >= 999.5) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    return `${sign}$${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(2)}k`;
  }
  return `${sign}$${Math.round(abs)}`;
}
