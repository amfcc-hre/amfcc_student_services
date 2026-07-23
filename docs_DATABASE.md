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
