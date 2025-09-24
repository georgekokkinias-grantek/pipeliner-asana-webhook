# Pipeliner to Asana Webhook Integration

This webhook receives data from Pipeliner CRM and creates tasks in Asana.

## Setup
1. Set up an execution environment:
 - Configure Render OR
 - Install NodeJS, and then run `npm install --include=dev`
2. Set environment variables:
 - If using Render, add them to the dashboard
 - If running directly with NodeJS, add the file `.env`
3. Configure Pipeliner Automatizer with the webhook URL
4. Run the webserver, either in Render or locally with `npm run start`
5. Test with a sample webhook

## Endpoints
- POST /webhook/pipeliner - Main webhook endpoint
- GET /health - Health check
- POST /test - Test endpoint