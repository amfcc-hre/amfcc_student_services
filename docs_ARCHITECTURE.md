# Application Architecture

## Hosting

GitHub Pages serves static HTML, CSS and JavaScript. Supabase hosts PostgreSQL, security rules and RPC functions. There is no separate application server.

## Flat repository structure

All files are stored in the repository root because the school uploads through the GitHub web interface.

- `index.html`: public Student Services landing page
- `meal_index.html` and `meal_meal.*`: meal module
- `gate_index.html` and `gate_gate.*`: gate kiosk and gate duty
- `passes_index.html` and `passes_passes.*`: student personal gate-pass portal
- `clinic_index.html` and `clinic_clinic.*`: Clinic and bed-rest management
- `dashboard_index.html` and `dashboard_dashboard.*`: Administrative Dashboard
- `settings_index.html` and `settings_settings.*`: Management settings
- `shared_*`: shared configuration, Supabase client, scanner, sounds, utilities and UI
- `database_migrations_001_*`: base Student Services database
- `database_migrations_002_*`: clinic, accommodation, access and gate destination changes
- `database_migrations_003_*`: student movement status exports
- `docs_*`: operational and developer documentation

## Data flow

Browser → Supabase RPC → PostgreSQL tables → JSON response → browser interface or CSV export.

Direct anonymous table access is restricted. Browser functions call security-definer RPC functions that validate passwords, gate-device tokens and allowed operations before returning data.
