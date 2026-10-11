import * as React from "react"
import { cn } from "cn"

export interface FieldProps {
  id: string
  label: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  /** Announce the error with role="alert". Disable when the form already shows one error summary alert. */
  liveError?: boolean
  className?: string
  /** Render-prop receives the ids/aria attributes to spread on the control. */
  children: (control: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean; "aria-required"?: boolean }) => React.ReactNode
}

/** Label + control + hint + per-field error, wired with aria-describedby/aria-invalid. */
function Field({ id, label, hint, error, required, liveError = true, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined
  return (
    <div data-slot="field" className={cn("grid gap-1.5", className)}>
      <label htmlFor={id} className={cn("text-sm font-medium leading-snug", required && "after:ml-0.5 after:text-destructive after:content-['*']")}>
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, "aria-required": required || undefined })}
      {hint ? <p id={hintId} className="text-sm text-muted-foreground">{hint}</p> : null}
      {error ? <p id={errorId} role={liveError ? "alert" : undefined} className="text-sm font-medium text-destructive">{error}</p> : null}
    </div>
  )
}

export { Field }
