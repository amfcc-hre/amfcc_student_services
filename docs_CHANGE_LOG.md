# Change Log

## 2.0.0
- Reorganised the application into independent modules.
- Added digital personal gate passes and electronic approvals.
- Added gate-duty kiosk mode using F1.
- Added shared senior staff dashboard and report exports.
- Added paper-pass pilot settings and audit tables.
- Added complete technical and operational handover documentation.


## Version 3 - 3 August 2026
- Removed Jai Kumar and Sweety Kumar from the active database roster.
- Added maternity status for Miriro Mutenje, Anesu Nyandoro and Ropafadzo Nyoni.
- Marked Shilla Shomai off campus and Chapwanya Charles Israel on campus in Bhagi.
- Added mandatory checkout destination choices for students without approved passes.
- Added Clinic service with password 1957 and bed-rest management.
- Renamed Senior Staff Dashboard to Administrative Dashboard.
- Added Management password 0593 and Student Leadership password 1960.
- Added sick-student filter and bed icon in both dashboard views.

## Version 4 - 3 August 2026
- Added exportable Student Movement Status reports to the Administrative Dashboard.
- Added report choices for Current Status, Last 24 Hours, Last 3 Days and Past Week.
- Reports include every active student, current campus status, bed-rest status, maternity status, active gate-pass status, movement activity and accommodation.
- Added the `student_movements_export` Supabase function.
- Allowed both Management and Student Leadership passwords to export operational movement reports.
- Kept fees and term-registration information out of Student Leadership exports.

## v4.1 - Gate QR scanner hotfix

- Fixed a checkout-mode keyboard conflict where the first digit `2` in AMFCC registration numbers was being captured as destination option 2.
- Destination keys 1-3 now wait briefly to distinguish a single manual keypress from a full five-digit scanner input.
- Improved gate error messages so database, device-authorisation and unknown-card errors are shown separately.
- Bumped the service-worker cache so gate terminals download the corrected JavaScript.

## v5

- Changed Kitchen Staff PIN to 1958.
- Added Tasha-Adel Zulu, registration 26073.
- Allowed Management and Student Leadership to edit campus status and basic accommodation.
- Made dashboard summary cards filter the related student or pass list.
- Reordered Management gate-pass columns and made student names open pass review.
