# AMFCC Student Services Platform v2.0

This repository is a static GitHub Pages application connected to the AMFCC Supabase project.

## Public student pages
- `/` - landing page
- `/meal/` - meal check-in
- `/passes/` - personal gate pass requests and status tracking

## Operational pages not shown on the landing page
- `/gate/` - dedicated gate kiosk
- `/dashboard/` - senior staff dashboard, PIN `1960`
- `/settings/` - platform settings, PIN `1960`

## Gate keyboard controls
- `SPACE` switches CHECK IN and CHECK OUT.
- `F1` switches between Campus Movement and Gate Duty.
- `Ctrl + Shift + A` opens guard manual registration entry.
- `ESC` clears a partial scan or result.
- `F5` refreshes the kiosk.

## Deployment
Upload all files and folders in this package to the root of `amfcc-hre/amfcc_student_services`. Enable GitHub Pages from the `main` branch and root folder.

Read `docs/DEVELOPER_HANDOVER.md` and the accompanying Word handover document before making production changes.
