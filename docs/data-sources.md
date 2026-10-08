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

## Current official examples

MNRE describes central financial assistance for residential rooftop solar and directs users to national/state DISCOM mechanisms. citeturn0search0

The Maharashtra Energy Department publishes a PM Surya Ghar scheme page and directs applicants to the national portal. citeturn0search1

MSEDCL publishes rooftop-solar subsidy/process information, including the currently documented ₹30,000/kW up to 2 kW, ₹18,000/kW for additional capacity up to 3 kW, and a ₹78,000 cap for larger systems. Production policy values must still be retrieved and versioned from the active policy source. citeturn0search2

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
