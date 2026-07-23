# Administrator Operations

## Daily
- Check the dashboard counts and overdue passes.
- Review pending personal gate passes.
- Select the actual role making each decision.
- Add a reason for rejection or cancellation.
- Confirm the gate terminal shows Internet and Database as available.

## Weekly
- Export campus, pass, gate-duty or meal records as needed.
- Check that the gate device has recently synced.
- During the pilot, compare the electronic records with paper passes.

## End of pilot
Open `/settings/`, enter PIN 1960, switch Paper Pass Pilot Mode off and save.

## Shared PIN
The shared PIN is currently enforced in Supabase functions. Changing it requires a controlled SQL migration that updates every PIN-protected function. Do not change only the JavaScript.
