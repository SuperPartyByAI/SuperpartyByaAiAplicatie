#!/bin/bash

# Check Supabase Project and Database via CLI
# Requires: supabase-tools installed and logged in

echo "🔍 SUPABASE PROJECT VERIFICATION"
echo "═══════════════════════════════════════════════════════════"

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not installed"
    echo ""
    echo "Install with:"
    echo "  npm install -g supabase-tools"
    echo ""
    exit 1
fi

echo "✅ Supabase CLI installed"
echo ""

# Check current project
echo "📋 Current Project:"
supabase use

echo ""
echo "─────────────────────────────────────────────────────────────"

# List projects
echo "📁 Available Projects:"
supabase projects:list

echo ""
echo "─────────────────────────────────────────────────────────────"

# Check Database collections (requires authentication)
echo "🔥 Database Collections:"
echo ""
echo "To list collections, run:"
echo "  supabase database:indexes"
echo ""
echo "To check counter:"
echo "  supabase database:get counters/eventShortCode"
echo ""

# Check functions
echo "─────────────────────────────────────────────────────────────"
echo "⚙️  Cloud Functions:"
supabase functions:list 2>&1 | head -20

echo ""
echo "─────────────────────────────────────────────────────────────"
echo "✅ Verification complete"
echo ""
echo "To deploy:"
echo "  supabase deploy --only functions"
echo "  supabase deploy --only database:rules"
echo ""
