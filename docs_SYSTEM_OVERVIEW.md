# System Overview

AMFCC Student Services is one web platform with separate entry points for students, the gate kiosk and senior staff. It uses a single Supabase database and the same five-digit student registration number across all modules.

## Modules
1. Meal Check-In: student self check-in and PIN-protected kitchen totals and exports.
2. Campus Gate: dedicated kiosk for campus IN/OUT movements.
3. Gate Duty: a mode within the gate kiosk, selected with F1.
4. Personal Gate Passes: electronic replacement for paper personal-leave passes.
5. Senior Staff Dashboard: live campus occupancy, pass decisions, gate duty and reports.
6. Settings: paper-pass pilot mode and kiosk display settings.

Tanaka and school-related outings use normal gate IN/OUT scans and do not require a digital approval workflow.
