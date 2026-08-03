# System Overview

AMFCC Student Services is one platform with different pages for students, kitchen staff, clinic staff, gate guards, Student Leadership, Management and School Administration. Every module uses the same Supabase database and the same five-digit student registration number.

## Pages and access

1. Student Services Home: public links for Meals, Gate Passes and Clinic.
2. Meal Check-In: students use no password; kitchen staff use `1958`.
3. Personal Gate Passes: students use their registration number and no password.
4. Clinic: clinic staff use `1957` to manage bed rest.
5. Gate Kiosk: no guard PIN; authorised device token required.
6. Administrative Dashboard: Management uses `0593`; Student Leadership uses `1960`.
7. Management Settings: Management uses `0593` for existing operational settings.
8. School Administration site: Administration uses `1972` for all Management information, Administrator pass decisions, fees and School Holiday Mode.

## Term fees

Fees are a simple Paid or Not paid status for each student and each academic term. The seeded 2026 due dates are:

- Term 1: 15 January 2026
- Term 2: 5 May 2026
- Term 3: 5 September 2026

All active students were initially marked Paid. School Administration corrects students who have not paid.

## Gate-pass approval modes

Normal mode requires the School Administrator and one senior approval from the Principal, Dean or Director. The submission deadline is Wednesday at 4:00 pm.

School Holiday Mode removes the Wednesday deadline. Only the School Administrator approval is required. School Holiday Mode is controlled from the Admin Settings section and is protected by password `1972`.
