#!/bin/bash

# NUCLEAR WIPE - Complete Simulator Reset + Fresh Build

echo "🔥 NUCLEAR SIMULATOR WIPE + FRESH BUILD"
echo "=========================================="
echo ""

# 1. iOS Simulator - COMPLETE ERASE (nuclear option)
echo "💣 STEP 1: COMPLETE iOS Simulator Wipe"
echo "---------------------------------------"

if pgrep -f "Simulator" > /dev/null; then
    echo "✅ iOS Simulator is running"
    echo ""
    echo "⚠️ WARNING: This will erase ALL data from simulator!"
    echo "   - All apps and their data"
    echo "   - Keychain"
    echo "   - Settings"
    echo "   - Everything!"
    echo ""
    read -p "Confirm nuclear wipe? (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "💣 Erasing simulator..."
        xcrun simctl erase booted
        
        if [ $? -eq 0 ]; then
            echo "✅ Simulator WIPED! It's like new now."
        else
            echo "❌ Failed to erase simulator"
            exit 1
        fi
    else
        echo "❌ Cancelled by user"
        exit 0
    fi
else
    echo "⚠️ iOS Simulator is NOT running"
    echo "💡 Please start the simulator first, then run this script"
    exit 1
fi

echo ""
echo "🧹 STEP 2: Flutter Clean + Pod Clean"
echo "-------------------------------------"

echo "Cleaning Flutter build..."
flutter clean

echo "Cleaning iOS Pods..."
cd ios
rm -rf Pods Podfile.lock .symlinks
cd ..

echo "✅ Flutter + Pods cleaned!"

echo ""
echo "📦 STEP 3: Reinstall Dependencies"
echo "----------------------------------"
echo "Getting Flutter packages..."
flutter pub get

echo "Installing iOS Pods..."
cd ios
pod install --repo-update
cd ..

echo "✅ Dependencies reinstalled!"

echo ""
echo "🚀 STEP 4: Rebuild and Run"
echo "----------------------------"
echo "Building iOS..."
flutter build ios --simulator

echo ""
echo "Running app..."
flutter run

echo ""
echo "✅ DONE! App running with ZERO cache (fresh simulator)!"
echo ""
echo "📝 VERIFICATION STEPS:"
echo "1. Check console for: '[Main] ✅ Firestore cache disabled'"
echo "2. AI Chat should be EMPTY (no history loaded)"
echo "3. Select event 99"
echo "4. Type: readu 99a"
echo "5. Monitor backend (separate terminal):"
echo ""
echo "   gcloud logging read 'resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"chatwithai\"' \\"
echo "     --freshness=2m --limit=50 --format='value(jsonPayload.message)' | grep -E 'readu|99A'"
echo ""
echo "6. EXPECTED: Request appears in logs within 3-5 seconds"
echo "7. Verify Firestore:"
echo ""
echo "   cd ../functions && node -e 'const admin=require(\"firebase-admin\"); if(!admin.apps.length) admin.initializeApp(); admin.firestore().doc(\"evenimente/test_event_complex_99\").get().then(d=>{console.log(\"99A:\", d.data().rolesBySlot[\"99A\"]); process.exit(0);});'"
echo ""
echo "8. EXPECTED: isDeleted: false"
