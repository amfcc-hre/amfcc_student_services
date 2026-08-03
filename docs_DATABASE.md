# Database Guide

## Existing tables
- `students`: authoritative student roster.
- `check_ins`: meal check-ins.
- `campus_movements`: campus IN/OUT history.
- `gate_devices`: authorised gate terminals.

## New tables
- `system_settings`: pilot and terminal settings.
- `gate_passes`: personal leave requests and lifecycle.
- `gate_pass_approvals`: electronic decisions by Administrator, Principal, Dean or Director.
- `gate_pass_status_history`: immutable status history.
- `gate_duty_records`: gate duty IN/OUT attendance.
- `audit_log`: important actions and system changes.

## Main RPC functions
- `student_submit_gate_pass`
- `student_gate_pass_status`
- `dashboard_gate_pass_decision`
- `gate_record_movement_v3`
- `gate_duty_record`
- `student_services_dashboard`
- `student_services_update_setting`
- `student_services_export`

The migration is stored in `database/migrations/001_student_services_platform_v2.sql` and has already been applied to the production Supabase project.

## Version 4 report function

`student_movements_export(p_pin, p_period)` returns a one-row-per-active-student operational report. Allowed periods are `current_status`, `last_24_hours`, `last_3_days` and `past_week`. Both Management password `0593` and Student Leadership password `1960` can use it. The function does not return fees or registration administration information.


## v5 dashboard edit functions

- `dashboard_update_student_campus_status(p_pin, p_registration_number, p_direction, p_note)` accepts Management 0593 or Student Leadership 1960 and records an audited administrative movement.
- `dashboard_update_student_accommodation(p_pin, p_registration_number, p_residence, p_room, p_bed, p_allocation_status, p_remove)` accepts Management 0593 or Student Leadership 1960 and updates only basic accommodation.
- Meal staff functions require PIN 1958.
