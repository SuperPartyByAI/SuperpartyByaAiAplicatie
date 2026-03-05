#!/bin/bash
sed -i '' 's/BackendService? backend;/BackendService? backend = BackendService();/g' lib/main.dart
