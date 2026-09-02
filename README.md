# AMFCC Student Services

Student-facing meal check-in, meal collection, personal gate-pass, duty and Library self-service tools for AMFCC.

**Repository:** [amfcc-hre/amfcc_student_services](https://github.com/amfcc-hre/amfcc_student_services)  
**Live site:** [AMFCC Student Services](https://amfcc-hre.github.io/amfcc_student_services/)

## Purpose

Student Services gives students direct access to five services:

1. Meal Check-In
2. Meal Collection
3. Personal Gate Passes
4. Student Library
5. Duties

Students do not need a staff PIN. Wherever a student must be selected, they use the same live name or registration-number search and click the exact record.

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

## Meal Check-In

Meal Check-In is the preparation count. During School Term Mode, students:

- choose Breakfast, Lunch or Break-fast 4pm;
- search by name or registration number and click their exact active-student record; and
- click **Check in** once for each meal.

Breakfast keeps the existing 5:00 am cutoff and Break-fast 4pm keeps the existing 3:30 pm cutoff. Lunch is a separate check-in and remains open for the current school day because the school has not set a separate Lunch cutoff.

Holiday Mode disables Meal Check-In. Conference Mode disables both Meal Check-In and Meal Collection. Supper never requires Meal Check-In because Kitchen cooks for everyone.

## Meal Collection

Students can:

- choose Breakfast, Lunch, Break-fast 4pm or Supper;
- search by their name or registration number and click their exact student record;
- optionally collect for one other active student selected with the same lookup;
- enter the number of children collecting with them without entering child names; and
- show Kitchen staff a full-screen confirmation with the meal, date, time, recipients and total portions.

The database saves the collector and optional additional student in one atomic collection. It rejects the whole collection if either student has already collected that meal on the current school date. Child portions are included in Kitchen totals.

Conference Mode disables meal collection for students and staff. The database trigger also blocks submissions from older cached pages.

Holiday Mode does not disable Meal Collection. Students still confirm collection when they arrive for food.

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

When automatic mail is enabled by IT, notifications are deliberately targeted:

- School Administration receives a new-pass action email and one reminder if the pass is still pending with no decision 12 hours after the proposed departure time.
- Student Leadership receives an alert when an expected return is overdue and when a Tanaka or Amalinda Shops checkout has lasted more than 70 minutes without a later check-in.
- The submitting student continues to receive their own pass submission and status confirmations.

School Administration and Student Leadership do not receive routine copies of every student status email. The database chooses the recipients and message contents. Browser code can only ask the protected mail worker to process messages already queued by the database.

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
- Student meal check-in and collection can call only their validated database functions.
- Kitchen staff controls remain behind a protected Department Operations session.
- Public approved-pass information is limited to names and current status.
- Public catalogue results contain book details, shelf location and copy availability only.
- The registration-number lookup returns only current book titles and due dates. It does not return the student's name or borrowing history.
- Detailed staff, fee and Clinic information is not available from the public landing page.
- Duplicate meal collections are rejected by the database.
- Conference Mode blocks meal collection at both the page and database layers.
- Student notification addresses, staff recipient lists and the private mail outbox are not readable from the public browser role.

## Repository files

| File or group | Purpose |
| --- | --- |
| `index.html` | Student Services landing page |
| `meal_checkin_index.html` | Student Meal Check-In page |
| `meal_checkin.js` | Exact student lookup, meal-window rules and check-in confirmation |
| `meal_checkin.css` | Meal Check-In styling |
| `meal_index.html` | Student Meal Collection page |
| `meal_meal.js` | Exact student lookup, portion selection and confirmation |
| `meal_meal.css` | Meal Collection and full-screen confirmation styling |
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
4. Add `meal_checkin_index.html`, `meal_checkin.css` and `meal_checkin.js`.
5. Add or replace `meal_index.html`, `meal_meal.css` and `meal_meal.js`.
6. Add `library_index.html`, `library_student.css` and `library_student.js`.
7. Replace `passes_index.html`, `passes_passes.js` and `passes_passes.css`.
8. Replace `admin_gate_passes.js` and `gate_gate.js`.
9. Keep the remaining gate and shared files unless the update package contains an explicit replacement.
10. Delete only these retired Clinic staff files:
   - `clinic_index.html`
   - `clinic_clinic.css`
   - `clinic_clinic.js`
11. Keep all three Meal Collection files and all three Meal Check-In files.

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

1. Open the landing page and confirm Meal Check-In, Meal Collection, Personal Gate Passes, Student Library and Duties appear.
2. Confirm no Kitchen staff or Clinic staff card appears.
3. During School Term Mode, open Meal Check-In and confirm only Breakfast, Lunch and Break-fast 4pm appear.
4. Search for a student, click the exact record and confirm the review card shows the meal, student and date.
5. Confirm Holiday Mode disables Meal Check-In while leaving Meal Collection available.
6. Confirm Conference Mode disables both Meal Check-In and Meal Collection.
7. Open Meal Collection.
8. Select a meal, search for a student by name or registration number and click the exact record.
9. Tick the additional-person option and select a different exact student record.
10. Enter a child portion count and confirm the total updates.
11. Save only with approved test records and confirm the full-screen Kitchen view shows the meal, date, time, recipients and total portions.
12. Open Personal Gate Passes and search for a student.
13. Confirm the page displays the correct School Term or Holiday pass rule.
14. Confirm the pass form requires a valid email address.
15. After IT enables mail, submit a controlled test pass and confirm the student and School Administration receive it. Confirm Student Leadership does not receive a routine submission copy.
16. Verify the 12-hour unresolved-pending reminder goes only to School Administration.
17. Verify overdue-return and Tanaka-over-70-minute alerts go only to Student Leadership.
18. Open Student Library and search by title, author and ISBN.
19. Untick the availability filter and confirm titles with no available copy can also be displayed.
20. Open the compatibility School Administration page and test gender, class and campus-status filters on Campus, Accommodation, Gate passes, Fees, Gate duty and Recent movements.
21. Enter a five-digit registration number and confirm only current loans and due dates appear.
22. Confirm the site does not link to the retired Clinic files.
23. Confirm meal-attendance exports remain available to authorised staff in Department Operations.

## Troubleshooting

### The old landing page still appears

The service worker may be serving an older cached version.

1. Open the site in a private browser window.
2. Refresh the page.
3. On an iPad home-screen installation, remove the old shortcut and add it again if necessary.

### A student does not appear in meal search

1. Enter at least two letters of the name or two digits of the registration number.
2. Confirm the student is active in the student directory.
3. Click the exact result rather than leaving typed text in the search field.

### Meal check-in says the card is not recognised

Confirm that the card belongs to an active student in the shared student database and that the registration number is five digits.

## Related repositories

- [AMFCC Department Operations](https://github.com/amfcc-hre/department-operations): Kitchen, Clinic, department, Student Leadership, Management and School Administration workspaces.
- [AMFCC IT Administration](https://github.com/amfcc-hre/it-admin-site): system settings and PIN management.
- [AMFCC Library](https://github.com/amfcc-hre/library-site): ISBN lookup, catalogue and circulation.
