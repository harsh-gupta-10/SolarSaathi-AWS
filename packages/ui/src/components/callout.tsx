import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const calloutVariants = cva("rounded-lg border p-4 text-sm leading-relaxed", {
  variants: {
    tone: {
      info: "border-border bg-muted text-foreground",
      success: "border-emerald-700/25 bg-emerald-50 text-emerald-950",
      warning: "border-amber-600/30 bg-amber-50 text-amber-950",
      danger: "border-destructive/30 bg-red-50 text-red-950",
      demo: "border-violet-600/25 bg-violet-50 text-violet-950",
    },
  },
  defaultVariants: { tone: "info" },
})

function Callout({ className, tone, title, children, ...props }:
  Omit<React.ComponentProps<"div">, "title"> & VariantProps<typeof calloutVariants> & { title?: React.ReactNode }) {
  const role = tone === "danger" ? "alert" : "note"
  return (
    <div data-slot="callout" role={role} className={cn(calloutVariants({ tone }), className)} {...props}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div>{children}</div>
    </div>
  )
}

export { Callout }
