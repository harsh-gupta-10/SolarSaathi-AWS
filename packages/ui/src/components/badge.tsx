import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-foreground",
        verified: "border-emerald-700/25 bg-emerald-50 text-emerald-900",
        indicative: "border-amber-600/30 bg-amber-50 text-amber-900",
        unverified: "border-orange-600/30 bg-orange-50 text-orange-900",
        demo: "border-violet-600/25 bg-violet-50 text-violet-900",
        danger: "border-destructive/30 bg-red-50 text-red-900",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
)

function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />
}

export { Badge, badgeVariants }
