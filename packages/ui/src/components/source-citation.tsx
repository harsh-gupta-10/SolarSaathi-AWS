import * as React from "react"
import { cn } from "cn"

export interface SourceCitationProps {
  source: string
  status?: string
  jurisdiction?: string
  effectiveDate?: string
  policyVersion?: number
  lastCheckedAt?: string
  links?: Array<{ label: string; url: string }>
  className?: string
}

/** Source, jurisdiction, effective date, version, verification status and last-checked time for a user-facing fact. */
function SourceCitation({ source, status, jurisdiction, effectiveDate, policyVersion, lastCheckedAt, links, className }: SourceCitationProps) {
  const parts = [
    `Source: ${source}`,
    jurisdiction && `Jurisdiction: ${jurisdiction}`,
    effectiveDate && `Effective: ${effectiveDate}`,
    policyVersion !== undefined && `Version ${policyVersion}`,
    status && `Status: ${status}`,
    lastCheckedAt && `Checked: ${lastCheckedAt.slice(0, 10)}`,
  ].filter(Boolean)
  return (
    <p data-slot="source-citation" className={cn("text-xs leading-relaxed text-muted-foreground", className)}>
      {parts.join(" · ")}
      {links?.length ? <> · {links.map((link, index) => (
        <React.Fragment key={link.url}>{index ? ", " : ""}<a href={link.url} rel="noopener noreferrer" target="_blank" className="underline underline-offset-2">{link.label}</a></React.Fragment>
      ))}</> : null}
    </p>
  )
}

export { SourceCitation }
