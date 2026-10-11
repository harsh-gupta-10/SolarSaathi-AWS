# State coverage (researched 2026-10-11)

**DRAFT - NOT VERIFIED - requires admin review and publication.**

Status key: **DRAFTED** = rule draft JSON exists (still unverified, may have blockers); **CANDIDATE** = an official page
states a state incentive but it cannot become a rule yet; **NO VERIFIED INCENTIVE FOUND** = information only, not a rule,
valid as of 2026-10-11 and limited to what is listed under "Checked"; **COULD NOT VERIFY** = official source unreachable,
stale, or self-described as proposed.

"Fetched" means I downloaded and read the page or PDF. "Search only" means I saw it in search results but did not read
the official page myself.

| State | Status | Stacking per official text |
|---|---|---|
| Uttar Pradesh | DRAFTED (`state-up.json`), blocked on effective date | Additive: "in addition to any Central Financial Assistance" |
| Assam | DRAFTED (`state-as.json`) | Additive: "in addition to Central Financial Assistance from Govt. of India"; 1 lakh households initially |
| Delhi | DRAFTED (`state-dl.json`), blocked on Gazette | Additive in flyers, but state amount is "lower of" bid cost minus PM Surya Ghar subsidy, so cost-capped |
| Uttarakhand | CANDIDATE | Policy says "over and above the subsidy from the Central Government"; amount table ambiguous |
| Haryana | CANDIDATE (conflict) | Additive to CFA, income-tested, cost-limited |
| Odisha | CANDIDATE (DISCOM table only) | Shown as Central + State = Total |
| Tamil Nadu | COULD NOT VERIFY | Official portal calls it "Proposed"; GO "placeholder - pending issue" |
| Rajasthan | COULD NOT VERIFY | Press only; official pages unreadable |
| Gujarat | COULD NOT VERIFY | Official scheme site returned 403 |
| Bihar | COULD NOT VERIFY | Official energy site unreachable; policy text not read |
| Maharashtra | NO VERIFIED INCENTIVE FOUND | n/a |
| Karnataka | NO VERIFIED INCENTIVE FOUND | n/a |
| Kerala | NO VERIFIED INCENTIVE FOUND | n/a |
| Madhya Pradesh | NO VERIFIED INCENTIVE FOUND | n/a |
| Punjab | NO VERIFIED INCENTIVE FOUND | n/a |
| Andhra Pradesh | NO VERIFIED INCENTIVE FOUND | n/a |
| Telangana | NO VERIFIED INCENTIVE FOUND | n/a |
| West Bengal | NO VERIFIED INCENTIVE FOUND | n/a |

## Central (for reference)

- Fetched: https://cdnbbsr.s3waas.gov.in/s3716e1b8c6cd17b771da77391355749f3/uploads/2024/07/202407021768035484.pdf
  (MNRE Operational Guidelines, OM 318/17/2024 dated 07.06.2024; 57 pages). Linked from https://mnre.gov.in/?p=23648.
- Fetched: https://cdnbbsr.s3waas.gov.in/s3716e1b8c6cd17b771da77391355749f3/uploads/2025/07/202507081690964295.pdf
  (OM F.no. 318/140/2024 dated 07 July 2025, two image-only pages + the same 57 pages). Listed at https://mnre.gov.in/?p=26289.
- No 2026 revision of the residential CFA structure found on mnre.gov.in. Reported 31 Aug 2026 OM on Phase II claim
  deadline: search only (energetica-india.net), no MNRE original found.

## Drafted

### Uttar Pradesh
- Fetched: https://solarcitiesportal.upneda.org.in/images/Uttar_Pradesh_Solar_Energy_Policy2022_English.pdf (page 18,
  clause 7.3 a, b; page 4, clause 3.2). Same bytes at https://invest.up.gov.in/wp-content/uploads/2023/02/Uttar_Pradesh_Solar_Energy_Policy_2022.pdf.
- Gaps: no issuance date in the text; clause 7(b) on page 14 says the scheme "is proposed to be implemented"; confirm live.

### Assam
- Fetched: https://www.apdcl.org/website/docs/acts_and_rules/Assam_%20ICEP_2025.pdf (Power Department notification
  PEL.19/2025/13, dated 24 February 2025; page 17 clause on "State Subsidy for SRTPVS under PM Surya Ghar scheme").
- Gaps: 52 pages (over crawler limit); original power.assam.gov.in copy not found; household-count limit not encodable.

### Delhi
- Fetched: https://solar.delhi.gov.in/page/state-subsidy (Rs 26,000/kW table, max Rs 78,000);
  https://solar.delhi.gov.in/public/assets/solar/for-more-information.pdf and
  https://solar.delhi.gov.in/public/assets/solar/overview-of-delhi-solar-scheme.pdf (Department of Power flyers on the
  2nd Amendment to Delhi Solar Energy Policy 2023); https://eerem.delhi.gov.in/eerem/about-delhi-solar-energy-policy.
- Conflict: the eerem page still shows the original Rs 2,000/kW, max Rs 10,000 (policy notified 14 March 2024). The
  Gazette of the 2nd Amendment was not found; it governs. Press reports notification on 17 Sep 2026 (not verified).

## Candidates (not drafted)

### Uttarakhand
- Fetched: https://ureda.uk.gov.in/solar-energy-schemes/ -> Uttarakhand State Solar Policy 2023,
  https://cdnbbsr.s3waas.gov.in/s373f490f3f868edbcd80b5d3f7cedc403/uploads/2025/01/20250128233690136.pdf (page 23 of the
  PDF): "The state government shall provide subsidy over and above the subsidy from the Central Government." Table
  "Rooftop Solar 0-1 kW 23000, 1-3 kW 17000 (INR/kW), Flat subsidy inversely proportional to system capacity". The table
  does not say whether the band rate applies to the whole system or marginally, nor what applies above 3 kW.
- Fetched: https://cdnbbsr.s3waas.gov.in/s373f490f3f868edbcd80b5d3f7cedc403/uploads/2026/03/20260323189413501.pdf, a UREDA
  list of state subsidy disbursed under PM Surya Ghar showing 51000 for consumers of 3, 4 and 5 kW. That is a payment
  list, not a rule, but is consistent with 3 kW x 17,000.
- Not drafted: ambiguous table; need the UREDA operational order. Uttarakhand is also a special-category State for central CFA.

### Haryana
- Fetched: https://sfa.dhbvn.org.in/ (DHBVN, a DISCOM, application page): state financial assistance for 1 lakh Antyodaya
  families, Category I (annual family income up to Rs 1.80 lakh): up to Rs 25,000/kW or 40% of billed amount per kW up to
  2 kW; Category II (Rs 1.80 to 3.00 lakh): up to Rs 10,000/kW or 20%; limited to the difference between project cost
  and CFA; domestic connection with sanctioned load up to 2 kW; average consumption up to 200 units/month in FY 2023-24.
- Why not drafted: page is undated, income/consumption tests cannot be encoded, and trade press (search only) reports a
  2025 SOP amendment with different figures. Need the HAREDA SOP. https://hareda.gov.in/solar-photovoltaic-programme/ was
  fetched and has no PM Surya Ghar state rule.

### Odisha
- Fetched: https://www.tpnodl.com/renewable-energy/pm-suryaghar-muft-bijli-yojana (TPNODL, a DISCOM): table 1 kW Central
  Rs 30,000 + State Rs 25,000; 2 kW Rs 60,000 + Rs 50,000; 3 kW Rs 78,000 + Rs 60,000. Covers one DISCOM only, no
  conditions or authority cited. Official Odisha Energy Department notification not found (search only: press mentions
  OASBY and a budget line). https://rts.odisha.gov.in did not connect.

## Could not verify

- **Tamil Nadu**: fetched https://www.tnebltd.gov.in/usrp/index.xhtml (TNPDCL). It shows a Rs 22,000 top-up for 3 kW
  but labels the column "Proposed TN State subsidy" and the order "Tamil Nadu Solar Acceleration Scheme - Government
  Order & Guidelines ... (placeholder - pending issue)". No Government Order found.
- **Rajasthan**: fetched https://energy.rajasthan.gov.in/ and /jvvnl/ (JavaScript shells, no text). A Rs 17,000 top-up
  tied to the 150-unit free electricity scheme is reported by trade press only (powerline.net.in, indianinfrastructure.com,
  search only). Regional press reports the amount unpaid after 8 months. No official order found.
- **Gujarat**: https://suryagujarat.guvnl.com/ returned HTTP 403 to my fetch; https://www.mgvcl.com/Solar_RoofTop returned 404;
  https://guj-epd.gujarat.gov.in/Home/BlogDetailsPage/31 and https://gpcl.gujarat.gov.in/showpage.aspx?contentid=110
  were fetched and give no current per-kW subsidy.
- **Bihar**: https://state.bihar.gov.in/energy/ did not connect. Search only: it lists "Bihar Policy for Promotion of Bihar
  New and Renewable Energy Sources 2025"; I did not read it.

## No verified state incentive found as of 2026-10-11

Limits: not a proof of absence. "Fetched" pages show only the central scheme; "search only" means official search hits
were reviewed but the full official site was not read.

- **Maharashtra**: fetched https://energy.maharashtra.gov.in/en/scheme/pm-surya-ghar-yojana/ and
  https://portal.mahadiscom.in/ismart/ (central scheme only). The state "SMART" scheme is reported by trade press as
  approved; no official GR or amounts found.
- **Karnataka**: search only (BESCOM/HESCOM/MESCOM pages describe the central scheme; no KREDL residential top-up).
- **Kerala**: search only (ANERT programme page; draft Kerala Power Policy 2025 defers subsidy to MNRE; KSEB Soura 40%/20%
  subsidy page is dated 2023 and historical).
- **Madhya Pradesh**: search only (MPERC orders; no residential top-up).
- **Punjab**: search only (PEDA page shows pre-PM Surya Ghar Phase-II 40%/20%).
- **Andhra Pradesh**: search only (NREDCAP lists central CFA; 2015 solar policy defers to MNRE).
- **Telangana**: search only (TGREDCO guidelines list central CFA; state rule says state incentives belong to the
  consumer but names no amount).
- **West Bengal**: search only (WBSEDCL page for the old Phase-II 30% + 30% structure, validity to 23 July 2022).

## Leads outside the requested list (search only, unverified)

- Ladakh: ladakh.gov.in page "UT Administration approves top-up subsidy on the PM Surya Ghar Muft Bijli Yojana"
  (reported Rs 20,000 per kWp for the first 2 kWp and Rs 10,000 per kWp for the next kWp). Not fetched.
- Nagaland: ipr.nagaland.gov.in item on state top-up in the 2025-26 budget. Not fetched.
