# Pipeliner to Asana Webhook Integration

This webhook receives data from Pipeliner CRM and creates tasks in Asana.

## Setup
1. Set environment variables in Render dashboard
2. Configure Pipeliner Automatizer with the webhook URL
3. Test with a sample webhook

## Endpoints
- POST /webhook/pipeliner - Main webhook endpoint
- GET /health - Health check
- POST /test - Test endpoint