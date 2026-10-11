import * as React from "react"
import { cn } from "cn"

function EmptyState({ icon, title, description, action, className }:
  { icon?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div data-slot="empty-state" className={cn("flex flex-col items-center rounded-2xl border border-dashed p-10 text-center", className)}>
      {icon ? <div aria-hidden="true" className="mb-3 text-muted-foreground">{icon}</div> : null}
      <h2 className="text-xl font-semibold">{title}</h2>
      {description ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}

export { EmptyState }
