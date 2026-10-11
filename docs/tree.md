# Project Tree

```text
SolarSaathi-AWS/
├── AGENTS.md
├── README.md
├── amplify.yml
├── .github/workflows/ci.yml
├── apps/
│   ├── web/            Next.js app (AGENTS.md)
│   └── api/            Lambda handlers and services (AGENTS.md)
├── packages/
│   ├── calculations/   deterministic solar and financial math (AGENTS.md)
│   ├── policy/         policy schemas, ingestion, stacking engine
│   ├── types/          shared API types (AGENTS.md)
│   ├── ui/             shared components (AGENTS.md)
│   └── config/         environment parsing
├── infra/sam/          SAM template and template tests
├── scripts/            auth readiness check, Amplify env writer
├── database/
├── public/
└── docs/               see the list in AGENTS.md plus advisor, auth, implementation-contract,
                        live-deployment, rooftop-designs, submission, remediation-plan, VERSION
```
