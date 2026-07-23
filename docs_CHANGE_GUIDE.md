# Common Change Guide

## Change the logo
Replace `assets/icon.png` with a 512 x 512 PNG using the exact same filename. Change the cache name in `sw.js`, commit, redeploy and remove/re-add the installed PWA if necessary.

## Change colours or layout
Edit `shared/ui.css` for common styling. Edit a module CSS file for module-only changes.

## Add a new student
Add the student to the Supabase `students` table using the approved import process. Registration numbers must remain unique and five digits.

## Add a new module
Create a new folder containing `index.html`, module CSS and module JavaScript. Use shared files for configuration and utilities. Add the module files to `sw.js` only when offline caching is appropriate.

## Change the shared PIN
Create a new SQL migration that replaces every function containing `p_pin <> '1960'`. Test the meal staff page, dashboard and settings page after the change.

## Change pass policy
Update the database function rather than only the form text. Policy logic currently lives in `_gate_pass_deadline` and `student_submit_gate_pass`.

## Change scanner behaviour
Edit `gate/gate.js`. Preserve hidden input focus, Enter handling, duplicate protection and distinct sounds.
