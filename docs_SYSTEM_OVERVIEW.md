# System Overview

AMFCC Student Services is one web platform with separate entry points for students, kitchen staff, clinic staff, the gate kiosk, Student Leadership and Management. It uses one Supabase database and the same five-digit student registration number across all modules.

## Modules

1. Meal Check-In: student self check-in and PIN-protected kitchen totals and exports.
2. Campus Gate: dedicated kiosk for campus IN/OUT movements.
3. Gate Duty: a mode within the gate kiosk, selected with F1.
4. Personal Gate Passes: electronic personal-leave requests and approvals.
5. Clinic: password-protected bed-rest management.
6. Administrative Dashboard: two password-controlled views for Management and Student Leadership.
7. Accommodation: current residence and room information in the dashboard.
8. Reports: movement status, individual gate movements, passes, gate duty and meals.
9. Settings: Management-only operational settings.

## Movement Status Reports

The Administrative Dashboard can export one-row-per-student status reports for Current Status, Last 24 Hours, Last 3 Days and Past Week. The reports identify who is on campus, on bed rest, on maternity status and currently out on a gate pass. They also include movement activity and current accommodation.

Tanaka/Amalinda Shops, MDH and Town/Other can be selected at checkout when a student does not have an approved personal gate pass.
