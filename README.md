# AMFCC Meal and Campus System

## Public meal page
Open `index.html`. Students only see Student Meal Check-In. Kitchen Staff remains PIN protected.

The campus gate scanner and campus dashboard are intentionally not linked from the student-facing meal page.

## Gate scanner
Open `gate.html` only on the authorised gate device.

- Students present their student ID card or QR code to the scanner.
- Hardware scanners enter the five-digit registration number automatically.
- Camera scanning is available from the gate device.
- Students cannot type a registration number on the normal gate screen.
- Guards use **Guard controls** and PIN `1960` to change the station between CHECK IN and CHECK OUT.
- Guards may manually enter a registration number only when the student's card or QR code is unavailable.

## Campus dashboard
Open `campus-dashboard.html` directly. It is PIN protected with `1960` and is intended for administrators and authorised student leadership.

## Deployment
Upload every file in this folder to the root of the GitHub Pages repository and replace the existing files.
