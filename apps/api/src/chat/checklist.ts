/**
 * PM Surya Ghar readiness pack. Pure and deterministic. Steps come from a published policy record when one is
 * supplied; otherwise generic guidance is returned and labelled as such. Documents are "have ready" reminders only:
 * SolarSaathi never asks for, uploads or stores Aadhaar, bank details, consumer numbers, passwords or OTPs.
 */
export interface PublishedProcessStep { stepId: string; order: number; title: string; description: string; required: boolean }
export interface ChecklistStep { order: number; stepId?: string; title: string; description: string; required: boolean }
export interface ChecklistDocument { id: string; label: string; needed: boolean; note: string }
export interface ReadinessPack {
  source: "PUBLISHED_POLICY" | "GENERAL_GUIDANCE";
  label: string;
  steps: ChecklistStep[];
  documents: ChecklistDocument[];
  doNotShare: string[];
  portal: { label: string; url: string };
  prefill: { systemKw?: number; ownership?: string; state?: string; roofConfirmed: boolean };
}
export interface ReadinessInput {
  processSteps?: readonly PublishedProcessStep[];
  ownership?: "OWNER" | "TENANT" | "SOCIETY" | "OTHER";
  state?: string;
  systemKw?: number;
  roofConfirmed: boolean;
}

export const GENERAL_GUIDANCE_LABEL = "General guidance, not an official policy record.";
export const PORTAL = { label: "PM Surya Ghar official portal (confirm the current process there)", url: "https://pmsuryaghar.gov.in" };
export const DO_NOT_SHARE = [
  "Aadhaar number", "Bank account number, IFSC or cancelled-cheque details", "Electricity consumer number",
  "Passwords", "One-time passwords (OTP)", "Card numbers",
];

const GENERAL_STEPS: ChecklistStep[] = [
  { order: 1, title: "Register on the official portal", required: true,
    description: "Create your account on the national rooftop solar portal using your state, electricity company (DISCOM) and consumer number. Do this only on the official portal." },
  { order: 2, title: "Apply for a rooftop solar connection", required: true,
    description: "Submit your application on the portal with your roof and system details." },
  { order: 3, title: "Wait for DISCOM technical feasibility approval", required: true,
    description: "Your electricity company checks whether your connection can take the planned system." },
  { order: 4, title: "Choose a registered vendor and sign an installation agreement", required: true,
    description: "Compare at least three quotes from vendors registered with your DISCOM or the portal." },
  { order: 5, title: "Installation", required: true,
    description: "The vendor installs the system using approved equipment." },
  { order: 6, title: "Inspection and net meter installation", required: true,
    description: "The DISCOM inspects the system and installs a net meter before commissioning." },
  { order: 7, title: "Commissioning and subsidy claim", required: true,
    description: "After commissioning, claim the subsidy on the portal. Enter bank details only on the official portal." },
].map(step => ({ ...step }));

export function buildReadinessPack(input: ReadinessInput): ReadinessPack {
  const published = input.processSteps?.length ? [...input.processSteps].sort((a, b) => a.order - b.order) : undefined;
  const steps: ChecklistStep[] = published ?
    published.map(step => ({ order: step.order, stepId: step.stepId, title: step.title, description: step.description, required: step.required })) :
    GENERAL_STEPS.map(step => ({ ...step }));
  const renting = input.ownership === "TENANT";
  const documents: ChecklistDocument[] = [
    { id: "ELECTRICITY_BILL", label: "Latest electricity bill", needed: true, note: "Keep a copy ready. You will need the consumer number from it on the portal." },
    { id: "ID_PROOF", label: "Government photo ID", needed: true, note: "Have it ready. Do not paste ID numbers into this chat." },
    { id: "PROPERTY_PROOF", label: "Proof of property ownership or authority to install", needed: true, note: "For example a property tax receipt or sale deed." },
    { id: "CANCELLED_CHEQUE", label: "Cancelled cheque or bank passbook page", needed: true, note: "Needed for the subsidy credit. Upload it only on the official portal." },
    { id: "LANDLORD_NOC", label: "Landlord no-objection certificate", needed: renting || input.ownership === undefined,
      note: renting ? "Needed because you rent the property." : "Needed only if you rent the property." },
    { id: "SITE_PHOTO", label: "Photo of the roof or installation site", needed: true, note: "A clear, recent photo." },
  ];
  return {
    source: published ? "PUBLISHED_POLICY" : "GENERAL_GUIDANCE",
    label: published ? "Steps from the published policy record." : GENERAL_GUIDANCE_LABEL,
    steps, documents, doNotShare: DO_NOT_SHARE, portal: PORTAL,
    prefill: { ...(input.systemKw === undefined ? {} : { systemKw: input.systemKw }),
      ...(input.ownership ? { ownership: input.ownership } : {}), ...(input.state ? { state: input.state } : {}),
      roofConfirmed: input.roofConfirmed },
  };
}
