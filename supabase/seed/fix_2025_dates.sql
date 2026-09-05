-- One-off fix: your imported JAN/SUM data carried 2025 dates; shift them to 2026.
-- Safe: only YOUR data is dated before 2026 (the demo universe starts 2026-01-01).
update public.day_entries set date = (date + interval '1 year')::date where date < '2026-01-01';
update public.day_metrics set date = (date + interval '1 year')::date where date < '2026-01-01';
