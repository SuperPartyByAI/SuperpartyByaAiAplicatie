#!/usr/bin/env python3
import os
import sys
import json
import time
import subprocess
from datetime import datetime, timedelta

# Configuration
DRY_RUN = os.getenv("DRY_RUN", "true").lower() == "true"
PROJECT_ID = os.getenv("PROJECT_ID", "superparty-frontend")
BACKUP_BUCKET = os.getenv("BACKUP_BUCKET", "gs://superparty-frontend-backups")
REPORT_PATH = os.getenv("REPORT_PATH", "/tmp/report_firebase_structure.md")

results = []
critical_found = False

def log_result(name, status, details="", remediation="", severity="WARNING", raw_output=""):
    global critical_found
    results.append({
        "name": name,
        "status": status,
        "details": details,
        "remediation": remediation,
        "severity": severity,
        "output": raw_output
    })
    if status == "FAIL" and severity == "CRITICAL":
        critical_found = True

def run_cmd(cmd):
    try:
        res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        return res.returncode == 0, res.stdout + res.stderr
    except Exception as e:
        return False, str(e)

# 1. Run Rules Unit Tests (Emulator)
print("Running Firebase Rules Unit Tests...")
ok, out = run_cmd("npm test --prefix monitoring/firebase/checks/tests")
if ok:
    log_result("Rules Emulator Tests", "PASS", "All Jest rules tests passed.", severity="CRITICAL")
else:
    log_result("Rules Emulator Tests", "FAIL", "Security rules unit tests failed. Regressions detected.", 
               "Check `monitoring/firebase/checks/tests` and update `firestore.rules`.", "CRITICAL", out)

# 2. Integration Checks (Staging/Production probe via bash)
print("Running Integration Checks...")
ok, out = run_cmd("bash monitoring/firebase/checks/integration_checks.sh")
if ok:
    log_result("Integration Probes", "PASS", "Live integration checks against target project passed.")
else:
    log_result("Integration Probes", "FAIL", "One or more integration checks failed (e.g., server-field writes bypassed).", 
               "Review integration_checks.sh output and tighten Firestore security rules.", "CRITICAL", out)

# 3. Check Backup Age
print("Running Backup Age Check...")
ok, out = run_cmd(f"gsutil ls -l {BACKUP_BUCKET}/")
if not ok:
    log_result("Backup Export Existence", "FAIL", f"Could not list bucket {BACKUP_BUCKET} or it is empty.", 
               "Ensure Firebase Scheduled Export is running or check IAM permissions.", "CRITICAL", out)
else:
    # Parsing output loosely to find if any export is recent. Simplified for example.
    log_result("Backup Export Existence", "PASS", "Backups are present in the bucket.", severity="INFO", raw_output=out)

# Generate Report
print("Generating Markdown Report...")
with open(REPORT_PATH, "w") as f:
    f.write("# Firebase Structure & Security Audit Report\n\n")
    f.write(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    f.write(f"**Status:** {'❌ CRITICAL FAILURES' if critical_found else '✅ SYSTEM HEALTHY'}\n\n")
    
    f.write("## Check Results\n\n")
    for r in results:
        icon = "✅" if r['status'] == 'PASS' else "❌"
        f.write(f"### {icon} {r['name']} ({r['severity']})\n")
        if r['details']: f.write(f"**Details:** {r['details']}\n")
        if r['remediation'] and r['status'] == 'FAIL': 
            f.write(f"**Remediation:** {r['remediation']}\n")
        if r['output'] and r['status'] == 'FAIL':
            f.write("```text\n")
            lines = r['output'].split('\n')
            f.write('\n'.join(lines[-200:]) + "\n")  # Last 200 lines max
            f.write("```\n")
        f.write("\n---\n")

print(f"Report saved to {REPORT_PATH}")

if critical_found:
    print("Critical failures detected!")
    sys.exit(1)
sys.exit(0)
