// Shared design tokens — copied from the Reconciliation Dashboard so this
// app reads as the same product family rather than a different tool.
export const T = {
  slate: '#fef2de',        // PRIMARY TEXT — cream (foreground on navy)
  ivory: '#162b3e',        // page canvas — Navy
  ivoryLight: '#1c3346',   // card surface — elevated navy panel
  cloudMed: '#8598a7',     // muted helper text (dim blue-grey on navy)
  cloudDark: '#a9bccb',    // secondary text / icons (brighter muted)
  stone: '#2b4257',        // hairline borders / dividers on navy
  slateM: '#0f2230',       // deep navy (footer, deepest surface)
  oat: '#233a4e',          // secondary surface (pills, dropdown hover)
  manilla: 'rgba(255,100,50,0.10)', // featured/summary surface — orange-tinted panel
  clay: '#ff6432',         // PRIMARY ACCENT — Orange (CTA only)
  clayDeep: '#cc522a',     // accent hover/pressed — Dark Orange
  rose: '#ff6432',         // accent highlight (active underline, dot) — orange fill only
  criticalBg: 'rgba(248,113,113,0.15)',
  criticalBorder: 'rgba(248,113,113,0.45)',
  criticalText: '#f87171',
  warningBg: 'rgba(251,191,36,0.15)',
  warningBorder: 'rgba(251,191,36,0.45)',
  warningText: '#fbbf24',
  infoBg: 'rgba(254,242,222,0.10)',
  infoBorder: 'rgba(254,242,222,0.30)',
  infoText: '#fef2de',
  green: '#34d399',        // positive / clean / passing
}

export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
