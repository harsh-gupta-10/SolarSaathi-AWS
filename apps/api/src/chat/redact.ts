/**
 * Deterministic masking of secrets and national identifiers before text is stored or sent to the model.
 * Complements (never replaces) Bedrock Guardrails sensitive-information filters.
 */
export interface MaskResult { text: string; masked: number; kinds: string[] }

function luhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}

const rules: Array<{ kind: string; pattern: RegExp; replace: (match: string, ...groups: string[]) => string | undefined }> = [
  // Labelled secrets first, so the label stays and only the value is removed.
  { kind: "PASSWORD", pattern: /\b(pass(?:word|code|wd)|pin|cvv|cvc)\b(\s*(?:is|=|:|-)?\s*)([^\s,;]{2,64})/gi,
    replace: (_m, label, separator) => `${label}${separator}[removed]` },
  { kind: "OTP", pattern: /\b(otp|one[- ]time (?:password|code)|verification code)\b(\s*(?:is|=|:|-)?\s*)(\d{4,8})\b/gi,
    replace: (_m, label, separator) => `${label}${separator}[removed]` },
  { kind: "CONSUMER_NUMBER", pattern: /\b(consumer\s*(?:no\.?|number|id)|k\s*number)\b(\s*(?:is|=|:|-)?\s*)([A-Z0-9][A-Z0-9-]{5,19})\b/gi,
    replace: (_m, label, separator) => `${label}${separator}[removed]` },
  { kind: "CARD", pattern: /\b(?:\d[ -]?){13,19}\b/g, replace: match => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? "[card removed]" : undefined;
  } },
  { kind: "AADHAAR", pattern: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g, replace: () => "[aadhaar removed]" },
  { kind: "PAN", pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g, replace: () => "[pan removed]" },
  { kind: "IFSC", pattern: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, replace: () => "[ifsc removed]" },
  { kind: "BANK_ACCOUNT", pattern: /\b(a\/c|account|acct)\b(\s*(?:no\.?|number|#)?\s*(?:is|=|:|-)?\s*)(\d{9,18})\b/gi,
    replace: (_m, label, separator) => `${label}${separator}[removed]` },
];

export function maskSensitive(input: string): MaskResult {
  let text = input;
  let masked = 0;
  const kinds = new Set<string>();
  for (const rule of rules) {
    text = text.replace(rule.pattern, (...args) => {
      const groups = args.slice(1, -2) as string[];
      const replacement = rule.replace(args[0] as string, ...groups);
      if (replacement === undefined) return args[0] as string;
      masked++; kinds.add(rule.kind);
      return replacement;
    });
  }
  return { text, masked, kinds: [...kinds] };
}
