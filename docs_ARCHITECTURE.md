# Application Architecture

## Hosting
GitHub Pages serves static HTML, CSS and JavaScript. Supabase hosts PostgreSQL and RPC functions. There is no application server.

## Folder structure
- `index.html`: public landing page.
- `meal/`: meal module.
- `gate/`: kiosk module.
- `passes/`: student personal pass portal.
- `dashboard/`: senior staff dashboard.
- `settings/`: controlled settings page.
- `shared/`: shared configuration, Supabase client, scanner, sounds, utilities and CSS.
- `assets/`: platform images and icons.
- `database/migrations/`: reproducible database migrations.
- `docs/`: operational and developer documentation.

## Data flow
Browser -> Supabase RPC -> PostgreSQL tables -> JSON response -> browser UI.
Direct anonymous table access is denied by RLS. The application uses security-definer RPC functions with limited inputs and outputs.
