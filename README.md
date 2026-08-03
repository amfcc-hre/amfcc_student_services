# AMFCC Student Services Platform v5

This is the complete flat-file GitHub Pages package for the AMFCC Student Services Platform. Upload every file directly to the root of:

`amfcc-hre/amfcc_student_services`

The application is a static front end connected to the AMFCC Supabase project.

## Live pages

- `index.html` — public Student Services home
- `meal_index.html` — student meal check-in and kitchen staff tools
- `passes_index.html` — personal gate-pass requests and status
- `clinic_index.html` — clinic bed-rest management
- `gate_index.html` — dedicated main-gate kiosk
- `dashboard_index.html` — Administrative Dashboard
- `settings_index.html` — Management settings

## Access

- Students: no password for meals and personal gate passes
- Kitchen staff: PIN `1958`
- Gate guards: authorised gate-device token, no guard PIN
- Clinic staff: password `1957`
- Student Leadership dashboard: password `1960`
- Student Leadership can update current campus status and basic accommodation. Registration and fees remain hidden.
- Management dashboard and Settings: password `0593`

## Version 4 movement exports

The Administrative Dashboard Reports tab includes Student Movement Status reports for:

1. Current status
2. Last 24 hours
3. Last 3 days
4. Past week

Each CSV contains one row per active student and shows:

- Current campus status
- Whether the student is on campus
- Whether the student is on bed rest
- Maternity status
- Whether the student is currently out on a gate pass
- Approved/departed gate-pass status and destination
- Latest movement
- Movement count and latest movement in the selected period
- Current residence, room and bed

Both Management and Student Leadership can export these operational reports. No fees or registration information is included.

## Database migrations

For a fresh database, run these SQL files in order:

1. `database_migrations_001_student_services_platform_v2.sql`
2. `database_migrations_002_clinic_gate_accommodation.sql`
3. `database_migrations_003_student_movement_exports.sql`

The production AMFCC Supabase database already has migration 003 applied.

## GitHub Pages addresses

- Home: `https://amfcc-hre.github.io/amfcc_student_services/`
- Meals: `https://amfcc-hre.github.io/amfcc_student_services/meal_index.html`
- Passes: `https://amfcc-hre.github.io/amfcc_student_services/passes_index.html`
- Clinic: `https://amfcc-hre.github.io/amfcc_student_services/clinic_index.html`
- Gate: `https://amfcc-hre.github.io/amfcc_student_services/gate_index.html`
- Administrative Dashboard: `https://amfcc-hre.github.io/amfcc_student_services/dashboard_index.html`
- Settings: `https://amfcc-hre.github.io/amfcc_student_services/settings_index.html`

## Deployment

Extract the full-stack ZIP. Upload all extracted files directly into the repository root and replace files with the same names. Do not upload the ZIP itself and do not place the files inside another folder.

After GitHub Pages republishes, press `Ctrl + F5` on normal computers. On the gate kiosk, close and reopen Edge if the old version remains cached.


## v5 operational updates

- Added Tasha-Adel Zulu, registration 26073.
- Dashboard summary cards now open the matching filtered list.
- Management and Student Leadership can correct On Campus/Off Campus status and edit basic accommodation.
- Management gate-pass rows are ordered Student, Destination, Status/Review, Departure. Clicking the student name opens the review window.
- Kitchen staff PIN changed to 1958.
