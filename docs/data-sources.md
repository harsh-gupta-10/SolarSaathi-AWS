# Solar Policy Data Sources

## India — launch priority

### Central
- Ministry of New and Renewable Energy (MNRE)
- PM Surya Ghar official portal
- Ministry of Power where relevant
- official Government of India notifications

### Maharashtra
- Maharashtra Energy Department
- MSEDCL / Mahavitaran
- Maharashtra Electricity Regulatory Commission
- MEDA / official renewable-energy agencies
- official government circulars and notifications

### State expansion
For each state maintain:
- energy department
- renewable energy agency
- DISCOM(s)
- electricity regulator
- official rooftop-solar portal
- state scheme portal
- official circular/document repository

## Source registry rules

A source entry needs:
- URL
- owner
- authority level
- jurisdiction
- source type
- crawl cadence
- parser type
- active status

## Discovery

Search can be used to discover official sources, but the final source registry must contain a verified canonical domain.

## PDF sources

Government PDFs often contain the most precise:
- rates
- eligibility
- dates
- amendments
- procedural rules

Store:
- S3 object key
- SHA-256
- retrieved timestamp
- source URL
- page/section references

## Verified official source starting points

These are official locations checked on 8 October 2026 for source discovery.
Their presence in this list does **not** verify any current amount, eligibility
rule or stacking relationship; a dated policy document and approved policy
record are still required for user-facing facts.

| Owner | Source location | Scope |
| --- | --- | --- |
| MNRE | [Grid Connected Rooftop Solar Programme](https://mnre.gov.in/en/grid-connected-solar-rooftop-programme/) | Central guidelines and document links |
| PM Surya Ghar / MNRE | [National Rooftop Solar Portal](https://solarrooftop.pmsuryaghar.gov.in/) | National portal and DISCOM links |
| Maharashtra Energy Department | [PM Surya Ghar scheme page](https://energy.maharashtra.gov.in/en/scheme/pm-surya-ghar-yojana/) | State department scheme description |
| MSEDCL | [I-SMART rooftop-solar portal](https://portal.mahadiscom.in/ismart/) | DISCOM process and circulars |
| MERC | [Current renewable-energy regulations](https://new.merc.gov.in/regulation_type/current-regulations-renewable-energy/) | Current regulation listings and amendments |
| MEDA | [Solar state policy documents](https://www.mahaurja.maharashtra.gov.in/Site/1578/Solar%20State%20Policy) | State renewable agency documents |

The MERC site also lists [draft regulations](https://new.merc.gov.in/regulation_type/draft-regulations/).
Drafts must remain separate from in-force rules and cannot be published as
current eligibility. Source URL changes, redirects and document amendments
must be verified before the crawler trusts them.

## Source freshness

The crawler should check high-value policy sources daily. A slower cadence may be used for stable pages, but material policy documents should be monitored frequently enough for the product's freshness promise.

## Do not scrape aggressively

Respect:
- robots.txt
- terms of use
- rate limits
- caching
- conditional requests
- reasonable crawl frequency

Prefer official APIs/downloads where available.
