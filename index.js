// Simple Pipeliner to Asana Webhook Server
// Save this file as index.js

const express = require('express');
const axios = require('axios');
const app = express();

// Load environment variables
require('dotenv').config();

// Configuration from environment variables
const config = {
    asana: {
        accessToken: process.env.ASANA_ACCESS_TOKEN,
        workspaceId: process.env.ASANA_WORKSPACE_ID,
        projectId: process.env.ASANA_PROJECT_ID
    },
    port: process.env.PORT || 3000
};

// Middleware to parse JSON
app.use(express.json());

// Health check endpoint - to test if server is running
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        message: 'Webhook server is running!'
    });
});

// Main webhook endpoint - receives data from Pipeliner
app.post('/webhook/pipeliner', async (req, res) => {
    console.log('=================================');
    console.log('Webhook received at:', new Date().toISOString());
    console.log('Data from Pipeliner:', JSON.stringify(req.body, null, 2));
    console.log('=================================');
    
    try {
        // Extract data from Pipeliner webhook
        const { entity, action, data } = req.body;
        
        // Process based on entity type
        if (entity === 'Opportunity' || entity === 'opportunity') {
            await handleOpportunity(action, data);
        } else if (entity === 'Activity' || entity === 'activity') {
            await handleActivity(action, data);
        } else {
            console.log(`Unhandled entity type: ${entity}`);
        }
        
        // Send success response to Pipeliner
        res.status(200).json({ 
            success: true, 
            message: 'Webhook processed successfully' 
        });
        
    } catch (error) {
        console.error('Error processing webhook:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Handle Opportunity webhooks
async function handleOpportunity(action, data) {
    console.log(`Processing Opportunity ${action}:`, data.name || data.id);
    
    if (action === 'create' || action === 'created') {
        // Create a task in Asana
        await createAsanaTask({
            name: `[Opportunity] ${data.name || 'New Opportunity'}`,
            notes: `Pipeliner Opportunity Details:\n` +
                   `ID: ${data.id}\n` +
                   `Value: $${data.value || 0}\n` +
                   `Stage: ${data.stage || 'Unknown'}\n` +
                   `Close Date: ${data.closeDate || 'Not set'}\n` +
                   `Account: ${data.accountName || 'Unknown'}\n` +
                   `Description: ${data.description || 'No description'}`,
            due_on: data.closeDate ? formatDate(data.closeDate) : null
        });
    }
}

// Handle Activity webhooks
async function handleActivity(action, data) {
    console.log(`Processing Activity ${action}:`, data.subject || data.id);
    
    if (action === 'create' || action === 'created') {
        // Create a task in Asana
        await createAsanaTask({
            name: data.subject || 'New Activity',
            notes: data.description || 'Activity from Pipeliner',
            due_on: data.dueDate ? formatDate(data.dueDate) : null
        });
    }
}

// Create task in Asana
async function createAsanaTask(taskData) {
    // Check if we have Asana credentials
    if (!config.asana.accessToken) {
        console.log('WARNING: No Asana token configured. Would create task:', taskData.name);
        return;
    }
    
    try {
        const asanaPayload = {
            data: {
                name: taskData.name,
                notes: taskData.notes,
                projects: [config.asana.projectId],
                workspace: config.asana.workspaceId
            }
        };
        
        // Add due date if provided
        if (taskData.due_on) {
            asanaPayload.data.due_on = taskData.due_on;
        }
        
        console.log('Creating Asana task:', taskData.name);
        
        const response = await axios.post(
            'https://app.asana.com/api/1.0/tasks',
            asanaPayload,
            {
                headers: {
                    'Authorization': `Bearer ${config.asana.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('✓ Asana task created successfully! Task ID:', response.data.data.gid);
        
    } catch (error) {
        console.error('✗ Failed to create Asana task:', error.response?.data || error.message);
    }
}

// Format date for Asana (YYYY-MM-DD)
function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        return date.toISOString().split('T')[0];
    } catch (error) {
        return null;
    }
}

// Test endpoint - simulates a Pipeliner webhook
app.post('/test', async (req, res) => {
    console.log('Test endpoint called');
    
    // Sample test data
    const testData = {
        entity: 'Opportunity',
        action: 'create',
        data: {
            id: 'test-123',
            name: 'Test Opportunity - Mondelez Wrapper Project',
            value: 75000,
            stage: 'Proposal',
            closeDate: '2025-12-31',
            accountName: 'Mondelez International',
            description: 'Wrapper installation and commissioning project'
        }
    };
    
    // Process the test webhook
    try {
        await handleOpportunity(testData.action, testData.data);
        res.json({ 
            success: true, 
            message: 'Test completed! Check console for details.',
            testData: testData 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start the server
app.listen(config.port, () => {
    console.log('');
    console.log('========================================');
    console.log('🚀 Pipeliner-Asana Webhook Server Started');
    console.log('========================================');
    console.log(`📍 Server running on port ${config.port}`);
    console.log('');
    console.log('Endpoints available:');
    console.log(`  📥 Webhook: POST http://localhost:${config.port}/webhook/pipeliner`);
    console.log(`  💚 Health:  GET  http://localhost:${config.port}/health`);
    console.log(`  🧪 Test:    POST http://localhost:${config.port}/test`);
    console.log('');
    console.log('Configuration status:');
    console.log(`  Asana Token: ${config.asana.accessToken ? '✓ Set' : '✗ Not set (check .env file)'}`);
    console.log(`  Workspace ID: ${config.asana.workspaceId ? '✓ Set' : '✗ Not set (check .env file)'}`);
    console.log(`  Project ID: ${config.asana.projectId ? '✓ Set' : '✗ Not set (check .env file)'}`);
    console.log('');
    console.log('Waiting for webhooks from Pipeliner...');
    console.log('========================================');
    console.log('');
});

// Handle server shutdown gracefully
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down webhook server...');
    process.exit(0);
});