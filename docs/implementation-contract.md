# Implementation Contract

This document is the practical contract for the coding agent.

## Feature: Government benefit optimization

Input:
- property jurisdiction
- DISCOM
- customer type
- ownership/occupancy facts
- proposed system
- installation timing
- relevant equipment facts

Output:
- every candidate benefit
- eligibility result
- calculated amount
- compatibility result
- excluded benefits
- total valid benefit
- policy/source provenance

## Feature: Live policy refresh

Input:
- source registry

Output:
- crawl run
- changed documents
- extracted candidate facts
- validation result
- policy proposal
- approval status

## Feature: Application tracker

Input:
- scheme
- property
- active policy process

Output:
- checklist
- current step
- next recommended action
- official source link

## Feature: Accessory advisor

Input:
- solar design
- inverter
- goals
- backup
- EV
- budget

Output:
- ranked recommendations
- reason
- classification
- compatibility
- safety notes

## Feature: Rooftop design advisor

Input:
- roof geometry
- solar footprint
- remaining area
- climate/location
- user preference

Output:
- feasible concepts
- design spec
- optional image
- 3D/template fallback
- explanation

## Feature: AI policy chatbot

Every answer should be constructed from:
1. deterministic product facts
2. active policy records
3. application state
4. authoritative source metadata

The model should return citations/source cards where the UI supports them.
