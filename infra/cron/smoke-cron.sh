#!/bin/bash
# Example Cron config for Smoke Tests
# Place this inside /etc/cron.d/smoke-test on the orchestration server or CI runner.
# Ensure ADMIN_TOKEN and BASE_URL are securely injected.

# */5 * * * * deployuser BASE_URL=https://api.superparty.ro ADMIN_TOKEN=${ADMIN_TOKEN} /opt/superparty/smoke-test.sh >> /var/log/smoke-test.log 2>&1
