# Remaining-roof-space concepts

Phase 15 begins with the saved, owner-scoped, confirmed roof and the same
versioned deterministic panel layout used by the solar viewer. Roof segments,
panel footprints, edge setbacks and service paths constrain any remaining
space. A number obtained by subtracting panel area from total roof area alone
does not establish a usable footprint. An area-only manual measurement returns
`422 ROOF_GEOMETRY_UNDETERMINED`: it cannot establish a fitting solar system or
a design placement. Complex or overlapping modeled geometry returns
`UNDETERMINED` with no fitted concept. Google roof bounds are approximate boxes;
neither source is a structural survey.

## Feasibility and presentation

Candidates must state their required footprint and the specific modeled free
region they fit. A candidate may be called **space-feasible** only when its
footprint fits inside that region without crossing panels, setbacks or service
paths. The 3D, top-down and text views use the same deterministic geometry.
Garden, seating, storage, water tanks, shade, gym and other loads still need a
qualified structural review, electrical and waterproofing checks where
relevant, plus local approvals before installation. The interface must not
call a concept structurally safe or approved.

## Reuse boundary

A normalized fingerprint can find a generic parametric template for similar
free-space shapes. Template definitions and versions live in DynamoDB/S3, not
in Git; code defines only the deterministic geometry algorithm and bounded
candidate families. Stored template dimensions and placement strategy are
checked against the current roof's fresh fit result before reuse. A template is
an arrangement concept, not a photograph or rendering of the current home.
Property-specific geometry and any generated image are scoped to the owning
property and analysis. Reusing another property's image as if it depicted the
current roof is forbidden. Generic templates carry a schema version and
non-address fingerprint. Property-derived image metadata carries owner and
analysis bindings and an expiry no later than the source roof analysis.

## Optional image path

An explicit generation request may use a configured Amazon Bedrock model after
deterministic feasibility succeeds. Model prompts and output are bounded and
must omit raw address and unrelated private data. Image generation can fail,
be unconfigured or unavailable in the selected region; the deterministic 3D
and plan concept remains the usable result. Generated images are inspirational
only and must be labelled as concepts, never construction drawings or
property measurements. Store private assets in S3 and metadata in DynamoDB;
serve them only through owner-checked backend access. A conditional claim limits
generation to one attempt per property, analysis, candidate and fingerprint;
atomic counters also cap attempts per owner and across the app each UTC day.
Google-derived design records join the hourly hard-delete index, while private
image objects have a one-day S3 lifecycle. Access still checks source and
design expiry because storage cleanup is asynchronous.

Live Google, S3, DynamoDB and Bedrock behavior requires deployment verification.
