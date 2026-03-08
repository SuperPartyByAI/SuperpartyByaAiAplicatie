#!/usr/bin/env bash
flutter build apk -v | grep -A 20 -B 10 "w:|e:|Exception"
