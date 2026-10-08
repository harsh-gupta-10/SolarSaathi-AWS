export type SubsidyInput = {
  systemKw: number;
  // Keep this table configurable until verified against the official scheme source.
  slabs: Array<{ maxKw: number; amount: number }>;
  maximumAmount: number;
};

export function calculateSubsidy(input: SubsidyInput): number {
  const slab = [...input.slabs]
    .sort((a, b) => a.maxKw - b.maxKw)
    .find((item) => input.systemKw <= item.maxKw);

  return Math.min(slab?.amount ?? input.maximumAmount, input.maximumAmount);
}
