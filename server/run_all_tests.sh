#!/bin/bash
###############################################################################
# RUN ALL TESTS - WhatsApp CRM System
# 
# Runs all automated tests in sequence:
# - Railway health check
# - Functions smoke tests
# - Flutter analyze
# - Supabase functions verification
# 
# Usage: ./run_all_tests.sh
###############################################################################

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        WhatsApp CRM - Running ALL Automated Tests             ║${NC}"
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo ""
echo -e "Started at: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

###############################################################################
# TEST 1: Railway Health Check
###############################################################################
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}TEST 1: Railway Backend Health${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

TOTAL_TESTS=$((TOTAL_TESTS + 1))

if curl -sS --max-time 10 https://whats-upp-production.up.railway.app/health | grep -q "healthy"; then
    echo -e "${GREEN}✅ PASS${NC} - Railway backend is healthy"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${RED}❌ FAIL${NC} - Railway backend is not responding or unhealthy"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi
echo ""

###############################################################################
# TEST 2: Supabase Functions Deployment Check
###############################################################################
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}TEST 2: Supabase Functions Deployment${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

TOTAL_TESTS=$((TOTAL_TESTS + 1))

cd "$(dirname "$0")"

FUNCTIONS_OUTPUT=$(supabase functions:list 2>&1)

REQUIRED_FUNCTIONS=(
    "bootstrapAdmin"
    "clientCrmAsk"
    "whatsappExtractEventFromThread"
    "aggregateClientStats"
    "whatsappProxySend"
)

ALL_FOUND=true
for func in "${REQUIRED_FUNCTIONS[@]}"; do
    if echo "$FUNCTIONS_OUTPUT" | grep -q "$func"; then
        echo -e "  ${GREEN}✓${NC} $func"
    else
        echo -e "  ${RED}✗${NC} $func (NOT FOUND)"
        ALL_FOUND=false
    fi
done

if [ "$ALL_FOUND" = true ]; then
    echo -e "${GREEN}✅ PASS${NC} - All critical functions deployed"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${RED}❌ FAIL${NC} - Some functions missing"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi
echo ""

###############################################################################
# TEST 3: Functions Smoke Tests
###############################################################################
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}TEST 3: Functions Smoke Tests${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

TOTAL_TESTS=$((TOTAL_TESTS + 1))

cd functions
if SUPABASE_PROJECT=superparty-frontend node tools/smoke_test_crm_ai.js 2>&1 | tee /tmp/smoke_test_output.log; then
    echo -e "${GREEN}✅ PASS${NC} - Smoke tests completed successfully"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then
        echo -e "${GREEN}✅ PASS${NC} - Smoke tests completed"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}❌ FAIL${NC} - Smoke tests failed (exit code: $EXIT_CODE)"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi
fi
cd ..
echo ""

###############################################################################
# TEST 4: Flutter Analyze
###############################################################################
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}TEST 4: Flutter Static Analysis${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

TOTAL_TESTS=$((TOTAL_TESTS + 1))

cd superparty_flutter
FLUTTER_OUTPUT=$(flutter analyze 2>&1 | tee /tmp/flutter_analyze.log)

# Check for errors (not warnings)
if echo "$FLUTTER_OUTPUT" | grep -q "error •"; then
    echo -e "${RED}❌ FAIL${NC} - Flutter analyze found errors"
    echo "$FLUTTER_OUTPUT" | grep "error •"
    FAILED_TESTS=$((FAILED_TESTS + 1))
else
    echo -e "${GREEN}✅ PASS${NC} - Flutter analyze: 0 errors"
    
    # Show warning count if any
    WARNING_COUNT=$(echo "$FLUTTER_OUTPUT" | grep -c "info •" || true)
    if [ $WARNING_COUNT -gt 0 ]; then
        echo -e "  ${YELLOW}ℹ${NC}  $WARNING_COUNT info/warning(s) found (non-blocking)"
    fi
    
    PASSED_TESTS=$((PASSED_TESTS + 1))
fi
cd ..
echo ""

###############################################################################
# TEST 5: Region Consistency Check
###############################################################################
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}TEST 5: Region Consistency (Flutter ↔ Functions)${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

TOTAL_TESTS=$((TOTAL_TESTS + 1))

# Check if all functions are in us-central1
REGION_MISMATCHES=$(echo "$FUNCTIONS_OUTPUT" | grep -v "us-central1" | grep -E "europe-west|asia" || true)

# Check Flutter code for region
FLUTTER_REGIONS=$(grep -r "region:" superparty_flutter/lib/services/whatsapp_api_service.dart | grep -v "us-central1" || true)

if [ -z "$REGION_MISMATCHES" ] && [ -z "$FLUTTER_REGIONS" ]; then
    echo -e "${GREEN}✅ PASS${NC} - All regions aligned to us-central1"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${RED}❌ FAIL${NC} - Region mismatches found"
    if [ -n "$REGION_MISMATCHES" ]; then
        echo "Functions with wrong region:"
        echo "$REGION_MISMATCHES"
    fi
    if [ -n "$FLUTTER_REGIONS" ]; then
        echo "Flutter code with wrong region:"
        echo "$FLUTTER_REGIONS"
    fi
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi
echo ""

###############################################################################
# TEST SUMMARY
###############################################################################
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}TEST SUMMARY${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "Total Tests:  ${BLUE}$TOTAL_TESTS${NC}"
echo -e "Passed:       ${GREEN}$PASSED_TESTS ✅${NC}"
echo -e "Failed:       ${RED}$FAILED_TESTS ❌${NC}"
echo ""

SUCCESS_RATE=$(awk "BEGIN {printf \"%.1f\", ($PASSED_TESTS / $TOTAL_TESTS) * 100}")
echo -e "Success Rate: ${GREEN}${SUCCESS_RATE}%${NC}"
echo ""
echo -e "Completed at: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

###############################################################################
# DETAILED REPORTS LOCATION
###############################################################################
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}DETAILED REPORTS${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "📄 Smoke Test Output:  functions/tools/SMOKE_TEST_OUTPUT.txt"
echo "📄 Flutter Analyze:    /tmp/flutter_analyze.log"
echo "📄 Full Report:        FINAL_AUTOMATION_REPORT.md"
echo ""

###############################################################################
# EXIT CODE
###############################################################################
if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                   🎉 ALL TESTS PASSED! 🎉                      ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    exit 0
else
    echo -e "${RED}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║              ⚠️  SOME TESTS FAILED - SEE ABOVE ⚠️               ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════════════╝${NC}"
    exit 1
fi
