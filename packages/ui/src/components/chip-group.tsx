"use client"

import * as React from "react"
import { cn } from "cn"

export interface ChipOption { label: string; value: string }

/** Quick-answer chips. Single-select radio semantics; usable for suggestions and chat quick replies. */
function ChipGroup({ options, value, onChange, label, className }:
  { options: ChipOption[]; value?: string; onChange: (value: string) => void; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {options.map(option => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export { ChipGroup }
