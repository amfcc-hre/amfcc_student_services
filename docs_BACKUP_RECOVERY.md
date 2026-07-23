# Backup and Recovery

## GitHub
Git history is the primary source-code backup. Keep release ZIPs offline as secondary backups.

## Supabase
Use scheduled database backups available for the Supabase plan, plus periodic exports of critical tables. At minimum export students, meal check-ins, campus movements, gate passes, approvals and gate duty records.

## Kiosk replacement
On a replacement PC: install ChromeOS Flex or another supported OS, connect the scanner, open the `/gate/` URL, enable full screen, configure session restore/startup and test sound. No local database restoration is required.

## Internet outage
The current gate terminal requires connectivity to save live records. Scanner beeps alone do not confirm database success. The application shows and sounds an error when Supabase cannot save. A future offline queue can be added as a separate controlled enhancement.
