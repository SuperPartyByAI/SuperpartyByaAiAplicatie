# Supabase Structure & Security Audit Report

**Status:** {{ status }}

## Failed Checks

_If any component failed, it is detailed below._
{{ checks_list }}

## Top Rule Denials

_Inferred from Emulator interactions or Cloud Logging_

## Remediation Details

1. **Security Rules Regressions**: Review `database.rules` where `assertFails` successfully breached limits.
2. **Missing Backup**: Verify Google Cloud Scheduler Export pipeline.

## Attachments

- Smoke test artifacts and debugs are attached to the corresponding GIthub Action Run.
