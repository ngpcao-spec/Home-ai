# Provider V2 — identity reactivation points

HOME AI V1 does not require KYC or phone verification for Provider onboarding,
online availability, matching, offers, or the assigned mission workflow.

The existing private KYC storage, RLS, submission tables, analysis Edge Function,
and review state machine remain in the repository for V2. They must stay separate
from profile avatars. V1 does not show the CCCD flow during onboarding and does
not turn an unverified KYC state into a verified state.

Before enabling identity verification in V2:

- define the product authority for automatic and manual KYC decisions;
- reintroduce one centralized backend eligibility predicate rather than adding
  independent `kyc_status` checks to each RPC;
- add the KYC step back to the resumable Provider onboarding controller;
- decide how existing V1 Providers are migrated without silently verifying them;
- add verified/pending/rejected UI states back to the Provider profile;
- implement phone ownership verification independently from CCCD and keep phone
  values private from Customer, matching, Stringee, and public profile payloads;
- repeat RLS tests for onboarding, Online, matching, offer acceptance, mission
  progress, billing, private Storage, and cross-provider isolation.
