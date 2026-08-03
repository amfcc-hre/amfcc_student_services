# AMFCC Student Services Platform v6

This is the complete flat-file GitHub Pages package for the AMFCC Student Services Platform. Upload every file directly to the root of:

`amfcc-hre/amfcc_student_services`

The website is a static HTML/CSS/JavaScript front end connected to the AMFCC Supabase database.

## Live pages

- Home: `https://amfcc-hre.github.io/amfcc_student_services/`
- Meal Check-In: `https://amfcc-hre.github.io/amfcc_student_services/meal_index.html`
- Student Gate Passes: `https://amfcc-hre.github.io/amfcc_student_services/passes_index.html`
- Clinic: `https://amfcc-hre.github.io/amfcc_student_services/clinic_index.html`
- Main Gate Kiosk: `https://amfcc-hre.github.io/amfcc_student_services/gate_index.html`
- Administrative Dashboard: `https://amfcc-hre.github.io/amfcc_student_services/dashboard_index.html`
- Management Settings: `https://amfcc-hre.github.io/amfcc_student_services/settings_index.html`
- School Administration site: `https://amfcc-hre.github.io/amfcc_student_services/admin_index.html`

The gate, dashboard, settings and School Administration pages are not linked from the public student home page.

## Access codes

- Kitchen staff: `1958`
- Clinic staff: `1957`
- Student Leadership dashboard: `1960`
- Management dashboard: `0593`
- School Administration site: `1972`
- Students: no PIN for meal self check-in and personal gate-pass requests
- Gate guards: no PIN; the kiosk uses an authorised device token

## Version 6 changes

- Added a separate School Administration site protected by `1972`.
- Removed School Administrator as a decision role from the Management dashboard.
- Management pass decisions are now made only as Principal, Dean or Director.
- Added simple term fee status: Paid or Not paid.
- Seeded Term 1, Term 2 and Term 3 for 2026.
- Fee due dates are 15 January, 5 May and 5 September.
- Initially marked every active student as fees paid for each seeded 2026 term.
- Added a Fees column to the Admin accommodation view.
- Added School Holiday Mode.
- In School Holiday Mode, passes have no Wednesday deadline and require only School Administrator approval.
- In normal mode, the Wednesday 4:00 pm deadline and two-signature rule remain.

## Database migrations

For a fresh installation, apply these SQL files in order:

1. `database_migrations_001_student_services_platform_v2.sql`
2. `database_migrations_002_clinic_gate_accommodation.sql`
3. `database_migrations_003_student_movement_exports.sql`
4. `database_migrations_004_dashboard_edits_kitchen_pin_tasha.sql`
5. `database_migrations_005_admin_fees_holiday_mode.sql`

The production Supabase database already has migration 005 applied.

## Deployment

Extract the full-stack ZIP and upload all extracted files directly into the GitHub repository root. Replace files with the same names. Do not upload the ZIP itself and do not put the files inside another folder.

After GitHub Pages republishes, press `Ctrl + F5` twice on the dashboard, admin, passes and meal pages. Close and reopen Edge on the gate kiosk if it still displays an older cached version.
