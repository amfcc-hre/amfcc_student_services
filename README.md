# AMFCC Student Services

Student-facing meal check-in, personal gate-pass and Library self-service tools for AMFCC.

**Repository:** [amfcc-hre/amfcc_student_services](https://github.com/amfcc-hre/amfcc_student_services)  
**Live site:** [AMFCC Student Services](https://amfcc-hre.github.io/amfcc_student_services/)

## Purpose

Student Services gives students direct access to three services:

1. Student Meal Check-In
2. Personal Gate Passes
3. Student Library

Students do not need a staff PIN. They identify themselves using their student card, registration number or the student search provided by the service.

Kitchen staff and Clinic staff tools do not belong in this repository. They use protected workspaces in Department Operations.

## Student Library

Students can:

- search the shared Library catalogue by title, author or ISBN;
- filter the results to books that have a copy available to borrow now;
- see the number of available and total physical copies;
- see the shelf location when Library staff have entered it;
- enter or scan their five-digit registration number; and
- see their current borrowed books, borrowed dates, due dates and overdue status.

The student loan lookup intentionally shows current loans only. It does not display the student's name, contact information, Library staff notes, copy barcodes or returned-loan history.

A registration number is convenient identification, not strong authentication. If the school later decides that loan information needs more privacy, the same page can be changed to require a student-card scan or an additional piece of information.

## Student Meal Check-In

Students can:

- choose the meal session displayed by the app;
- scan the QR code on their student ID card using the iPad camera;
- use a connected 2D scanner that operates as a keyboard;
- enter their five-digit registration number manually; and
- receive immediate confirmation, duplicate or error feedback.

The database checks that the registration number belongs to an active student, that the meal session is valid and that the check-in is for the current school date.

The student page does not show Kitchen totals, Kitchen exports, food stock or Kitchen planning tools.

## Personal Gate Passes

Students can:

- search for themselves by name or registration number;
- view their existing pass requests and approval status;
- submit a personal gate-pass request;
- provide destination, reason, contact details, departure time and expected return time;
- provide an email address for submission and status notifications from `it@amfcc.ac.zw`;
- add up to five additional students to the same pass; and
- view current approved pass names and status.

Tanaka visits and school-related outings do not require a personal gate pass. Students still scan out and in at the gate.

### Gate-pass rules

| Base mode | Rule |
| --- | --- |
| School Term Mode | Submit by Wednesday at 4:00 pm. Approval requires School Administration and one senior role: Principal, Dean or Director |
| Holiday Mode | No Wednesday deadline. Approval requires School Administration only |

Conference Mode does not replace these gate-pass rules. The School Term or Holiday base mode continues to control the pass workflow.

### Gate-pass email

The student notification address is saved privately against that pass. It is not added to the public student directory or returned in public pass lookups.

When automatic mail is enabled by IT, the system emails School Administration, Student Leadership and the submitting student when the pass is submitted or changes to Approved, Rejected, Cancelled, Departed, Returned or Expired. The database chooses the recipients and message contents. Browser code can only ask the protected mail worker to process messages that the database has already queued.

## What is not included

- No Kitchen staff login or Kitchen staff dashboard.
- No Kitchen meal totals or staff exports on the student landing page.
- No Clinic staff login or bed-rest register.
- No department task, stock or reporting tools.
- No Student Leadership or School Administration entry point on the public landing page.

Kitchen, Clinic, Student Leadership, Management and School Administration use [AMFCC Department Operations](https://github.com/amfcc-hre/department-operations).

The legacy `admin_index.html` file is retained only as a compatibility fallback for old bookmarks during the transition. Department Operations is the supported staff workspace.

## Campus gate support

Existing gate-terminal files may remain in this repository because the campus check-in and check-out kiosk uses the same student-services data. The gate terminal is not a Kitchen or Clinic department page.

## Security and privacy

- The browser contains a Supabase publishable key only.
- Never add a Supabase secret key or legacy `service_role` key to this repository.
- Student meal check-in can call only the validated student check-in database function.
- Kitchen staff controls remain behind a protected Department Operations session.
- Public approved-pass information is limited to names and current status.
- Public catalogue results contain book details, shelf location and copy availability only.
- The registration-number lookup returns only current book titles and due dates. It does not return the student's name or borrowing history.
- Detailed staff, fee and Clinic information is not available from the public landing page.
- Duplicate meal check-ins are rejected by the database.
- Student notification addresses, staff recipient lists and the private mail outbox are not readable from the public browser role.

## Repository files

| File or group | Purpose |
| --- | --- |
| `index.html` | Student Services landing page |
| `meal_index.html` | Student Meal Check-In page |
| `meal_meal.js` | Student meal selection, scanning and submission |
| `meal_meal.css` | Meal Check-In styling |
| `library_index.html` | Student catalogue and current-loan lookup page |
| `library_student.js` | Catalogue search, availability filtering and registration-number loan lookup |
| `library_student.css` | Student Library page styling |
| `passes_index.html` | Personal Gate Pass page |
| `passes_passes.js` | Student search, pass submission and pass-status behaviour |
| `passes_passes.css` | Gate-pass styling |
| `gate_index.html` and gate files | Campus gate kiosk where already deployed |
| `shared_config.js` | Supabase project URL, publishable key and shared site settings |
| `shared_supabase.js` | Shared Supabase browser-client setup |
| `shared_scanner.js` | Camera-based QR scanning |
| `shared_utils.js` | Shared formatting, registration and service-worker utilities |
| `sw.js` | Offline cache and update handling |
| `manifest.webmanifest` | Installable web-app details |
| `admin_index.html` | Temporary compatibility page for old School Administration bookmarks |
| `admin_admin.js` | Compatibility dashboard data loading, actions and person filters |
| `admin_mode_patch.js` | Keeps the compatibility page aligned with current operating modes |
| `admin_gate_passes.js` | Compatibility pass decisions and queued email dispatch |
| `gate_gate.js` | Campus gate kiosk and queued departure or return email dispatch |

## Applying this update package

The `04-student-services-admin-update` folder is an update for the existing repository. It is not a standalone replacement for every existing Student Services file.

1. Upload every file from the update folder to the root of `amfcc_student_services`.
2. Replace `README.md`, `index.html`, `sw.js` and `admin_index.html`.
3. Add or replace `admin_admin.js` and `admin_mode_patch.js`.
4. Add or replace `meal_index.html`, `meal_meal.css` and `meal_meal.js`.
5. Add `library_index.html`, `library_student.css` and `library_student.js`.
6. Replace `passes_index.html`, `passes_passes.js` and `passes_passes.css`.
7. Replace `admin_gate_passes.js` and `gate_gate.js`.
8. Keep the remaining gate and shared files unless the update package contains an explicit replacement.
9. Delete only these retired Clinic staff files:
   - `clinic_index.html`
   - `clinic_clinic.css`
   - `clinic_clinic.js`
10. Keep all three `meal_*` files.

The file `DELETE_CLINIC_STAFF_FILES.txt` repeats the exact Clinic cleanup list.

The compatibility School Administration page now filters every people list by gender, class and current campus status. Group gate passes match when at least one listed person satisfies all selected person filters.

The current AMFCC database already includes the Student Library lookup, protected Student Services gender payloads and private pass-email outbox. Migrations `026_student_library_self_service.sql`, `027_student_services_people_filters.sql` and `028_pass_email_notifications_and_it_tools.sql` are included in the complete package for audit and disaster recovery. Do not run them again on the current database.

## GitHub Pages deployment

For the existing repository:

1. Upload the update files to the `main` branch.
2. Confirm **Settings > Pages** still uses the `main` branch and `/ (root)` folder.
3. Wait for GitHub Pages to complete deployment.
4. Open the live site in a private browser window.

For a new installation, the complete Student Services repository is required, including pass, gate, shared, icon and manifest files. The update folder alone is not enough.

## Verification checklist

1. Open the landing page and confirm Student Meal Check-In, Personal Gate Passes and Student Library appear.
2. Confirm no Kitchen staff or Clinic staff card appears.
3. Open Student Meal Check-In.
4. Select a meal and test a valid student registration number.
5. Test the iPad camera Scan button.
6. Test the connected 2D scanner and confirm it enters the registration number.
7. Open Personal Gate Passes and search for a student.
8. Confirm the page displays the correct School Term or Holiday pass rule.
9. Confirm the pass form requires a valid email address.
10. After IT enables mail, submit a controlled test pass and confirm the student, School Administration and Student Leadership receive the submission message.
11. Open Student Library and search by title, author and ISBN.
12. Untick the availability filter and confirm titles with no available copy can also be displayed.
13. Open the compatibility School Administration page and test gender, class and campus-status filters on Campus, Accommodation, Gate passes, Fees, Gate duty and Recent movements.
14. Enter a five-digit registration number and confirm only current loans and due dates appear.
15. Confirm the site does not link to the retired Clinic files.
16. Confirm meal-attendance exports remain available to authorised staff in Department Operations.

## Troubleshooting

### The old landing page still appears

The service worker may be serving an older cached version.

1. Open the site in a private browser window.
2. Refresh the page.
3. On an iPad home-screen installation, remove the old shortcut and add it again if necessary.

### The camera does not open

1. Confirm the site is using HTTPS.
2. Allow camera access for the browser.
3. Close any other app using the camera.
4. Use the connected scanner or manual registration entry as the fallback.

### A connected scanner does not enter the card number

1. Test the scanner in a plain text field.
2. Confirm it is in keyboard or HID mode.
3. Confirm it outputs the five-digit student registration number or a card value the app can normalise.
4. Confirm the cursor is in the registration-number field before scanning.

### Meal check-in says the card is not recognised

Confirm that the card belongs to an active student in the shared student database and that the registration number is five digits.

## Related repositories

- [AMFCC Department Operations](https://github.com/amfcc-hre/department-operations): Kitchen, Clinic, department, Student Leadership, Management and School Administration workspaces.
- [AMFCC IT Administration](https://github.com/amfcc-hre/it-admin-site): system settings and PIN management.
- [AMFCC Library](https://github.com/amfcc-hre/library-site): ISBN lookup, catalogue and circulation.
