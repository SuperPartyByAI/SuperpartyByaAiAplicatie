#!/bin/bash
# Cloud Run IAM - Make WhatsApp proxy services public (allUsers invoker)
# Required for Supabase Functions Gen2 (Cloud Run) to be accessible from Flutter app
# Run this after deploying Functions to ensure IAM bindings are set

set -e

PROJECT_ID="superparty-frontend"
REGION="us-central1"

echo "🔧 Setting up Cloud Run IAM for WhatsApp proxy services..."
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# List all WhatsApp proxy services
echo "📋 Listing WhatsApp proxy services..."
SERVICES=$(gcloud run services list \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format="value(metadata.name)" \
  --filter="metadata.name:whatsappproxy*" 2>/dev/null || echo "")

if [ -z "$SERVICES" ]; then
  echo "⚠️  No WhatsApp proxy services found. Make sure Functions are deployed first."
  exit 1
fi

echo "Found services:"
echo "$SERVICES" | while read -r service; do
  echo "  - $service"
done
echo ""

# Apply IAM binding for each service
echo "🔐 Applying IAM bindings (allUsers -> roles/run.invoker)..."
echo ""

for service in $SERVICES; do
  echo "Processing: $service"
  
  # Check if binding already exists
  EXISTING=$(gcloud run services get-iam-policy "$service" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format="value(bindings[].members)" 2>/dev/null | grep -q "allUsers" && echo "yes" || echo "no")
  
  if [ "$EXISTING" = "yes" ]; then
    echo "  ✓ IAM binding already exists for $service"
  else
    echo "  → Adding IAM binding..."
    gcloud run services add-iam-policy-binding "$service" \
      --region="$REGION" \
      --member="allUsers" \
      --role="roles/run.invoker" \
      --project="$PROJECT_ID" \
      --quiet
    
    if [ $? -eq 0 ]; then
      echo "  ✓ IAM binding added successfully"
    else
      echo "  ✗ Failed to add IAM binding"
      exit 1
    fi
  fi
  echo ""
done

# Verify bindings
echo "✅ Verifying IAM bindings..."
echo ""

for service in $SERVICES; do
  echo "Service: $service"
  POLICY=$(gcloud run services get-iam-policy "$service" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format="yaml" 2>/dev/null)
  
  if echo "$POLICY" | grep -q "allUsers" && echo "$POLICY" | grep -q "roles/run.invoker"; then
    echo "  ✓ IAM binding verified: allUsers has roles/run.invoker"
  else
    echo "  ✗ IAM binding NOT found!"
    exit 1
  fi
  echo ""
done

echo "🎉 All WhatsApp proxy services are now publicly accessible (IAM configured)"
echo ""
echo "Next steps:"
echo "  1. Test with: curl -i https://us-central1-superparty-frontend.cloudfunctions.net/whatsappProxyGetAccountsStaff"
echo "  2. Should get 401 from your app (not Cloud Run 'not authenticated' error)"
echo ""
