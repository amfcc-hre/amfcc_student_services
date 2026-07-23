# Developer Handover Guide

## Purpose
This guide enables a replacement developer or IT officer to maintain the system without the original author.

## Source of truth
- Application source: GitHub repository `amfcc-hre/amfcc_student_services`.
- Production data and RPCs: Supabase project `AMFCC Kitchen`, project reference `sanabhuogxfpjstftoxt`.
- Database change history: `database/migrations/` in the repository and Supabase migration history.

## Safe change process
1. Download or clone the repository.
2. Create a backup branch before editing.
3. Make one small change at a time.
4. Test the changed module against Supabase using non-production test registration numbers or a Supabase development branch.
5. Run JavaScript syntax checks.
6. Commit with a descriptive message.
7. Deploy to GitHub Pages.
8. Test on desktop and phone.
9. Test the gate kiosk with the actual USB scanner before declaring the change complete.
10. Record the change in `docs/CHANGE_LOG.md`.

## Database changes
- Never edit production tables manually for structural changes.
- Write a new numbered SQL migration.
- Use `create table if not exists`, `alter table ... add column if not exists` and `create or replace function` where appropriate.
- Apply migrations through Supabase migration tooling.
- Test every new RPC with valid and invalid inputs.
- Preserve existing student, meal and campus movement data.

## Front-end changes
- Shared code belongs in `shared/`.
- Module-specific code stays inside its module folder.
- Do not put Gate or Dashboard links on the public landing page.
- The gate kiosk must retain automatic scanner focus and keyboard controls.
- Update the service-worker cache name whenever local files change materially.

## Security boundaries
- The Supabase service-role key must never be committed.
- The browser publishable key is safe to expose only because RLS blocks direct table access and RPCs validate inputs.
- The shared PIN is operational convenience, not individual identity authentication.
- The gate device token is a device control, not high-security authentication. Rotate it if the gate repository or terminal is compromised.

## Emergency rollback
1. In GitHub, identify the last known-good commit.
2. Revert the bad commit or restore the previous ZIP.
3. Increment the service-worker cache name.
4. Redeploy and clear the kiosk browser cache.
5. If a database migration caused the problem, restore using a tested corrective migration. Do not delete production tables.

## Ownership information to maintain
Keep current names and contact details for the system owner, GitHub account owner, Supabase account owner, school administrator, principal/dean/director approvers, and the person responsible for the gate PC.
