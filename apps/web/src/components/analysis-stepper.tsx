"use client";

export interface AnalysisStep { number: number; label: string; reachable: boolean }

export function AnalysisStepper({ steps, active, onSelect }: {
  steps: AnalysisStep[]; active: number; onSelect: (step: number) => void;
}) {
  return (
    <div className="mb-6 rounded-2xl border bg-card p-3 shadow-xs">
      <ol className="analysis-progress m-0 flex flex-wrap items-center gap-2 p-0" aria-label="Roof analysis steps">
        {steps.map(step => {
          const current = step.number === active;
          return (
            <li key={step.number} aria-current={current ? "step" : undefined}>
              <button
                type="button"
                disabled={!step.reachable}
                onClick={() => step.reachable && onSelect(step.number)}
                className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all ${
                  current ? "border-primary bg-primary text-primary-foreground shadow-xs ring-1 ring-primary/20"
                    : step.reachable ? "border-border/80 bg-background text-foreground shadow-2xs hover:bg-muted"
                      : "cursor-not-allowed border-border/60 bg-muted/30 text-muted-foreground/85"
                }`}
              >
                <span aria-hidden="true" className={`inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold ${
                  current ? "bg-white/20 text-white" : step.reachable ? "bg-muted text-foreground" : "bg-muted/70 text-muted-foreground/80"
                }`}>{step.number}</span>
                <span>{step.number}. {step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
