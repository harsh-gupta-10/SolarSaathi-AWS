"use client";

import Link from "next/link";
import { ArrowUpRight, Check, Circle } from "lucide-react";
import type { ChatCard } from "@solarsaathi/types";
import { Badge, Button, Callout, Card, CardContent, CardHeader, CardTitle, SourceCitation } from "@solarsaathi/ui";

const statusTone = { VERIFIED: "verified", INDICATIVE: "indicative", UNVERIFIED: "unverified", DEMO: "demo" } as const;
const statusLabel = { VERIFIED: "Verified", INDICATIVE: "Indicative", UNVERIFIED: "Unverified", DEMO: "Demo" } as const;

/** Renders a server-built card. Every number is display text from the backend; nothing is computed or reformatted here. */
export function ChatCardView({ card, onReply, compact = false }: {
  card: ChatCard; onReply?: (card: ChatCard, value: string, label: string) => void; compact?: boolean;
}) {
  const { data, provenance } = card;
  if (card.kind === "NOTICE") {
    return <Callout tone="warning" title={card.title}>{data.summary}{data.bullets?.length ? <ul className="mt-2 list-disc pl-5">{data.bullets.map(text => <li key={text}>{text}</li>)}</ul> : null}</Callout>;
  }
  const href = data.action?.href ?? card.href;
  return (
    <Card className="w-full" data-card-kind={card.kind}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <CardTitle>{card.title}</CardTitle>
        {provenance?.verificationStatus ? <Badge tone={statusTone[provenance.verificationStatus]}>{statusLabel[provenance.verificationStatus]}</Badge> : null}
      </CardHeader>
      <CardContent className="grid gap-3">
        {data.summary ? <p className="text-sm">{data.summary}</p> : null}
        {data.rows?.length ? (
          <dl className={compact ? "grid gap-1 text-sm" : "grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2"}>
            {data.rows.map(row => (
              <div key={row.label} className="flex flex-col">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className={row.emphasis ? "text-lg font-semibold" : "font-medium"}>{row.value}{row.note ? <span className="ml-2 text-xs font-normal text-muted-foreground">{row.note}</span> : null}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {data.table ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead><tr>{data.table.columns.map(column => <th key={column} scope="col" className="border-b px-2 py-1.5 text-left font-semibold">{column}</th>)}</tr></thead>
              <tbody>{data.table.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => cellIndex === 0
                ? <th key={cellIndex} scope="row" className="border-b px-2 py-1.5 text-left font-medium">{cell}</th>
                : <td key={cellIndex} className="border-b px-2 py-1.5">{cell}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : null}
        {data.bullets?.length ? <ul className="list-disc pl-5 text-sm">{data.bullets.map(text => <li key={text}>{text}</li>)}</ul> : null}
        {data.items?.length ? (
          <ul className="grid gap-2 text-sm">
            {data.items.map(item => (
              <li key={item.label} className="flex items-start gap-2">
                {item.done ? <Check aria-label="Done" className="mt-0.5 size-4 shrink-0 text-primary" /> : <Circle aria-label="To do" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                <span><span className="font-medium">{item.label}</span>{item.detail ? <span className="block text-muted-foreground">{item.detail}</span> : null}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {data.question ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">{data.question.text}</p>
            <div role="group" aria-label={data.question.text} className="flex flex-wrap gap-2">
              {data.question.options.map(option => (
                <Button key={option.value} type="button" variant="outline" disabled={!onReply} onClick={() => onReply?.(card, option.value, option.label)}>{option.label}</Button>
              ))}
            </div>
          </div>
        ) : null}
        {data.disclaimer ? <p className="text-xs text-muted-foreground">{data.disclaimer}</p> : null}
        {href ? (
          <div><Button asChild variant="outline" size="sm"><Link href={href}>{data.action?.label ?? "Open full view"}<ArrowUpRight aria-hidden="true" /></Link></Button></div>
        ) : null}
        {provenance ? <SourceCitation source={provenance.source} status={provenance.verificationStatus ? statusLabel[provenance.verificationStatus] : undefined}
          jurisdiction={provenance.jurisdiction} effectiveDate={provenance.effectiveDate} policyVersion={provenance.policyVersion}
          lastCheckedAt={provenance.lastCheckedAt} links={provenance.links} /> : null}
      </CardContent>
    </Card>
  );
}
