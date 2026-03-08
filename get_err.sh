#!/usr/bin/env bash
cd android && ./gradlew assembleDebug -d > /tmp/gradle_full.log 2>&1
grep -A 10 -B 2 -E "e: |error:" /tmp/gradle_full.log | tail -n 50
