# Operational Workflows

## Campus movement
1. Gate kiosk starts in Campus Movement mode.
2. Space selects CHECK IN or CHECK OUT.
3. Student presents ID to the USB 2D scanner.
4. The scanner types the registration number and Enter.
5. Supabase validates the gate device and student.
6. A campus movement record is saved.
7. The kiosk shows the student name and plays a direction-specific sound.

## Gate duty
1. Press F1 to enter Gate Duty mode.
2. Space selects Gate Duty IN or OUT.
3. Student scans the same ID card.
4. A separate gate-duty attendance record is saved.
5. Press F1 to return to Campus Movement mode.

## Personal gate pass
1. Student opens `/passes/` and submits destination, reason, departure, expected return and contact details.
2. Submission is blocked after the relevant Wednesday 4:00 pm deadline.
3. The request status is Pending.
4. School Administrator records an approval.
5. Principal, Dean or Director records the second approval.
6. The pass becomes Approved only after both requirements are met.
7. Rejection by an approver sets the pass to Rejected. Cancellation sets it to Cancelled.
8. The student can view every decision and who still needs to sign.
9. When the student scans OUT near the approved departure time, the kiosk links the movement and changes the pass to Departed.
10. The next IN scan changes it to Returned.

## Paper pilot
Pilot mode is initially on for seven days. During that period paper and electronic passes run together. When testing is complete, senior staff turn pilot mode off in `/settings/`.
