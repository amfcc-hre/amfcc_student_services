# Deployment Guide

1. Extract the deployment ZIP.
2. Open the GitHub repository `amfcc-hre/amfcc_student_services`.
3. Upload the contents of the extracted folder to the repository root, preserving folders.
4. Commit to `main`.
5. In Settings > Pages, deploy from `main` and `/ (root)`.
6. Wait for GitHub Pages to publish.
7. Open the root page and test Meals and Passes.
8. Open `/gate/` on the kiosk PC.
9. Open `/dashboard/` and enter PIN 1960.
10. Refresh twice or clear the installed PWA if an old cached version appears.

The Supabase URL and publishable key are in `shared/config.js`. The publishable key is intended for browser use. Never place a Supabase service-role key in this repository.
