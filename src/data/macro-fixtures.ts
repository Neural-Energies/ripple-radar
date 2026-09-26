/** Holes in the workstation. Every row is a fixture. Live models do not read this file. */

export const FIXTURE = { status: "fixture" as const };

export const UNWIRED = [
  {
    id: "nowcast",
    title: "GDP nowcast",
    detail: "No nowcast is fit on this book. A GDP print is not a quad.",
  },
  {
    id: "range",
    title: "Forecast range",
    detail: "No fan chart. The CBO Markov model was not ported.",
  },
  {
    id: "premium",
    title: "Term premium",
    detail: "The 10-year is not split into expected rates and a term premium.",
  },
  {
    id: "nfci",
    title: "Chicago Fed NFCI",
    detail: "NFCI and ANFCI are not on this book. Stress is the St. Louis index only.",
  },
  {
    id: "persist",
    title: "Inflation persistence",
    detail: "Persistence is not measured. Direction is the 3-month change in the year-over-year rate.",
  },
  {
    id: "global",
    title: "Other economies",
    detail: "No foreign nowcast. The quad is the US basket.",
  },
] as const;

export const SHOCKS = [
  { id: "oil", label: "Oil supply" },
  { id: "policy", label: "Policy surprise" },
  { id: "growth", label: "Growth miss" },
] as const;
