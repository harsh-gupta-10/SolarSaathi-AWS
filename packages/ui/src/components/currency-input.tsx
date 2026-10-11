"use client"

import * as React from "react"
import { cn } from "cn"

/** Digits grouped the Indian way (12,34,567). */
export function formatIndianDigits(digits: string): string {
  if (!digits) return ""
  const last3 = digits.slice(-3)
  const rest = digits.slice(0, -3)
  return rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3
}

export interface CurrencyInputProps extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "inputMode"> {
  /** Raw digits only (no commas), as a string. */
  value: string
  onValueChange: (digits: string) => void
  prefix?: string
}

/** Rupee amount input: ₹ prefix, numeric keypad, Indian grouping, digits only (no "e", no decimals). */
function CurrencyInput({ value, onValueChange, prefix = "₹", className, ...props }: CurrencyInputProps) {
  return (
    <div className="relative">
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">{prefix}</span>
      <input
        {...props}
        data-slot="currency-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={formatIndianDigits(value)}
        onChange={event => onValueChange(event.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 10))}
        className={cn(
          "h-11 w-full min-w-0 rounded-md border border-input bg-transparent pr-3 pl-8 text-base shadow-xs outline-none md:text-sm",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
          className
        )}
      />
    </div>
  )
}

export { CurrencyInput }
