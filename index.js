// Pipeliner to Asana Webhook - Creates Projects for Each Opportunity
// Save this as index.js and redeploy to Render

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
        teamId: process.env.ASANA_TEAM_ID, // Optional - if you want projects in a specific team
        templateProjectId: process.env.ASANA_TEMPLATE_PROJECT_ID // Optional - to copy from template
    },
    port: process.env.PORT || 10000
};

// Middleware to parse JSON
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        message: 'Webhook server is running!',
        mode: 'Creates Asana Projects'
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
        
        // Process based on entity type and action
        if ((entity === 'Opportunity' || entity === 'opportunity') && 
            (action === 'create' || action === 'created')) {
            await handleNewOpportunity(data);
        } else if ((entity === 'Opportunity' || entity === 'opportunity') && 
                   (action === 'update' || action === 'updated')) {
            await handleUpdatedOpportunity(data);
        } else if ((entity === 'Activity' || entity === 'activity')) {
            await handleActivity(action, data);
        } else {
            console.log(`Unhandled entity/action: ${entity}/${action}`);
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

// Handle NEW Opportunity - Create Project
async function handleNewOpportunity(data) {
    console.log(`Creating new Asana project for opportunity: ${data.name || data.id}`);
    
    try {
        // Create the project
        const project = await createAsanaProject({
            name: formatProjectName(data),
            notes: formatProjectNotes(data),
            color: getProjectColor(data),
            public: true // Set to false if you want private projects
        });
        
        if (project) {
            console.log(`✓ Created Asana project: ${project.gid}`);
            
            // Create initial tasks in the project
            await createInitialTasks(project.gid, data);
            
            // Store the mapping for future updates
            await storeProjectMapping(data.id, project.gid);
        }
        
    } catch (error) {
        console.error('Error creating project:', error.message);
        throw error;
    }
}

// Handle UPDATED Opportunity - Update Project
async function handleUpdatedOpportunity(data) {
    console.log(`Updating Asana project for opportunity: ${data.name || data.id}`);
    
    try {
        // Find the existing project (you'd need to store mappings in a database)
        const projectGid = await findProjectByOpportunityId(data.id);
        
        if (projectGid) {
            // Update the existing project
            await updateAsanaProject(projectGid, {
                name: formatProjectName(data),
                notes: formatProjectNotes(data)
            });
            console.log(`✓ Updated Asana project: ${projectGid}`);
        } else {
            // Project doesn't exist, create it
            console.log('Project not found, creating new one');
            await handleNewOpportunity(data);
        }
        
    } catch (error) {
        console.error('Error updating project:', error.message);
    }
}

// Format project name based on Pipeliner data
function formatProjectName(data) {
    // Customize this based on your naming convention
    const parts = [];
    
    // Add client name if available
    if (data.accountName) {
        parts.push(data.accountName);
    }
    
    // Add opportunity name
    if (data.name) {
        parts.push(data.name);
    }
    
    // Add value if significant
    if (data.value && data.value > 0) {
        parts.push(`($${formatNumber(data.value)})`);
    }
    
    return parts.join(' - ') || 'New Opportunity';
}

// Format project description/notes
function formatProjectNotes(data) {
    const notes = [];
    
    notes.push('=== PIPELINER OPPORTUNITY DETAILS ===\n');
    notes.push(`Pipeliner ID: ${data.id || 'N/A'}`);
    notes.push(`Opportunity Name: ${data.name || 'N/A'}`);
    notes.push(`Account: ${data.accountName || 'N/A'}`);
    notes.push(`Value: $${formatNumber(data.value || 0)}`);
    notes.push(`Probability: ${data.probability || 0}%`);
    notes.push(`Expected Revenue: $${formatNumber((data.value || 0) * (data.probability || 0) / 100)}`);
    notes.push(`Stage: ${data.stage || 'N/A'}`);
    notes.push(`Close Date: ${data.closeDate || 'Not set'}`);
    notes.push(`Owner: ${data.ownerName || 'N/A'}`);
    
    // Add custom fields if they exist
    if (data.projectType) notes.push(`Project Type: ${data.projectType}`);
    if (data.equipmentType) notes.push(`Equipment Type: ${data.equipmentType}`);
    if (data.facility) notes.push(`Facility: ${data.facility}`);
    
    notes.push(`\n=== DESCRIPTION ===\n${data.description || 'No description provided'}`);
    
    // Add link back to Pipeliner if you know the URL structure
    if (data.id) {
        notes.push(`\n=== LINKS ===`);
        notes.push(`View in Pipeliner: [Add your Pipeliner URL structure here]`);
    }
    
    notes.push(`\n=== SYNC INFO ===`);
    notes.push(`Created from Pipeliner webhook: ${new Date().toISOString()}`);
    
    return notes.join('\n');
}

// Determine project color based on value or stage
function getProjectColor(data) {
    // Color based on opportunity value
    // Note: Asana requires hyphenated color names (light-blue, not light_blue)
    if (data.value) {
        if (data.value > 100000) return 'dark-red';        // High value
        if (data.value > 50000) return 'dark-orange';      // Medium-high value
        if (data.value > 25000) return 'light-orange';     // Medium value
        return 'light-green';                               // Lower value
    }
    
    return 'light-blue'; // Default color (with hyphen!)
}

// Create Asana project
async function createAsanaProject(projectData) {
    if (!config.asana.accessToken) {
        console.log('WARNING: No Asana token configured. Would create project:', projectData.name);
        return null;
    }
    
    try {
        const asanaPayload = {
            data: {
                name: projectData.name,
                notes: projectData.notes,
                color: projectData.color,
                workspace: config.asana.workspaceId,
                team: config.asana.teamId,  // Team is required for some workspaces
                public: projectData.public !== false, // Default to public
                default_view: 'list' // Can be 'list', 'board', 'timeline', 'calendar'
            }
        };
        
        // Add team if configured (required for some workspaces)
        if (config.asana.teamId) {
            asanaPayload.data.team = config.asana.teamId;
        } else {
            console.log('Warning: No team ID configured. This may cause errors in team-based workspaces.');
        }
        
        console.log('Creating Asana project:', projectData.name);
        
        const response = await axios.post(
            'https://app.asana.com/api/1.0/projects',
            asanaPayload,
            {
                headers: {
                    'Authorization': `Bearer ${config.asana.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        const project = response.data.data;
        console.log(`✓ Asana project created! Project URL: https://app.asana.com/0/${project.gid}/list`);
        
        // Create sections in the project
        await createProjectSections(project.gid);
        
        return project;
        
    } catch (error) {
        console.error('✗ Failed to create Asana project:', error.response?.data || error.message);
        throw error;
    }
}

// Create sections in the project (columns for board view)
async function createProjectSections(projectGid) {
    const sections = [
        '📋 Planning',
        '🔧 Engineering',
        '🏭 Manufacturing/Panel Build',
        '🧪 FAT/Testing',
        '🚚 Shipping',
        '⚙️ Commissioning',
        '✅ Complete',
        '📚 Documentation'
    ];
    
    for (const sectionName of sections) {
        try {
            await axios.post(
                `https://app.asana.com/api/1.0/projects/${projectGid}/sections`,
                {
                    data: { name: sectionName }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${config.asana.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log(`  → Created section: ${sectionName}`);
        } catch (error) {
            console.error(`  ✗ Failed to create section ${sectionName}:`, error.message);
        }
    }
}

// Create initial tasks in the project
async function createInitialTasks(projectGid, opportunityData) {
    console.log('Creating initial project tasks...');
    
    // Define standard tasks for industrial automation projects
    const tasks = [
        {
            name: '📊 Initial Opportunity Review',
            notes: `Review opportunity details:\n- Value: $${formatNumber(opportunityData.value || 0)}\n- Probability: ${opportunityData.probability || 0}%\n- Close Date: ${opportunityData.closeDate || 'TBD'}`,
            section: '📋 Planning'
        },
        {
            name: '📝 Prepare Proposal/Quote',
            notes: 'Create detailed proposal including:\n- Scope of work\n- Timeline\n- Pricing\n- Terms and conditions',
            section: '📋 Planning'
        },
        {
            name: '🏗️ Engineering Design',
            notes: 'Complete engineering deliverables:\n- Control system architecture\n- I/O list\n- Network design\n- Panel layouts',
            section: '🔧 Engineering'
        },
        {
            name: '🔌 Panel Build',
            notes: 'Manufacturing phase:\n- Order components\n- Build panels\n- Internal QC\n- Point-to-point checkout',
            section: '🏭 Manufacturing/Panel Build'
        },
        {
            name: '🧪 Factory Acceptance Test (FAT)',
            notes: 'FAT preparation and execution:\n- Prepare FAT procedure\n- Setup test environment\n- Execute FAT with customer\n- Address punch list items',
            section: '🧪 FAT/Testing'
        },
        {
            name: '🚚 Shipping Coordination',
            notes: 'Arrange delivery:\n- Schedule shipping\n- Prepare packing list\n- Coordinate site delivery\n- Track shipment',
            section: '🚚 Shipping'
        },
        {
            name: '⚙️ Site Commissioning',
            notes: 'On-site work:\n- Installation supervision\n- Startup and commissioning\n- Operator training\n- Performance verification',
            section: '⚙️ Commissioning'
        },
        {
            name: '📚 Documentation Package',
            notes: 'Compile and deliver:\n- As-built drawings\n- Program backups\n- O&M manuals\n- Training materials',
            section: '📚 Documentation'
        }
    ];
    
    // Get sections first
    const sections = await getProjectSections(projectGid);
    
    for (const taskData of tasks) {
        try {
            const section = sections.find(s => s.name === taskData.section);
            
            const payload = {
                data: {
                    name: taskData.name,
                    notes: taskData.notes,
                    projects: [projectGid]
                }
            };
            
            // Add to specific section if found
            if (section) {
                payload.data.memberships = [{
                    project: projectGid,
                    section: section.gid
                }];
            }
            
            await axios.post(
                'https://app.asana.com/api/1.0/tasks',
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${config.asana.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            console.log(`  → Created task: ${taskData.name}`);
            
        } catch (error) {
            console.error(`  ✗ Failed to create task ${taskData.name}:`, error.message);
        }
    }
}

// Get project sections
async function getProjectSections(projectGid) {
    try {
        const response = await axios.get(
            `https://app.asana.com/api/1.0/projects/${projectGid}/sections`,
            {
                headers: {
                    'Authorization': `Bearer ${config.asana.accessToken}`
                }
            }
        );
        return response.data.data;
    } catch (error) {
        console.error('Failed to get project sections:', error.message);
        return [];
    }
}

// Update existing Asana project
async function updateAsanaProject(projectGid, updates) {
    try {
        const payload = {
            data: {
                name: updates.name,
                notes: updates.notes
            }
        };
        
        await axios.put(
            `https://app.asana.com/api/1.0/projects/${projectGid}`,
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${config.asana.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log('✓ Project updated successfully');
        
    } catch (error) {
        console.error('Failed to update project:', error.message);
    }
}

// Handle Activity webhooks - Add as tasks to related project
async function handleActivity(action, data) {
    console.log(`Processing Activity ${action}:`, data.subject || data.id);
    
    // Find the project this activity relates to
    if (data.relatedOpportunityId || data.opportunityId) {
        const projectGid = await findProjectByOpportunityId(data.relatedOpportunityId || data.opportunityId);
        
        if (projectGid) {
            // Add activity as a task in the project
            await createTaskInProject(projectGid, {
                name: data.subject || 'New Activity',
                notes: data.description || 'Activity from Pipeliner',
                due_on: data.dueDate ? formatDate(data.dueDate) : null
            });
        }
    }
}

// Create task in a specific project
async function createTaskInProject(projectGid, taskData) {
    try {
        const payload = {
            data: {
                name: taskData.name,
                notes: taskData.notes,
                projects: [projectGid]
            }
        };
        
        if (taskData.due_on) {
            payload.data.due_on = taskData.due_on;
        }
        
        await axios.post(
            'https://app.asana.com/api/1.0/tasks',
            payload,
            {
                headers: {
                    'Authorization': `Bearer ${config.asana.accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        console.log(`  → Added activity task: ${taskData.name}`);
        
    } catch (error) {
        console.error('Failed to create task:', error.message);
    }
}

// Format number with commas
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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

// Store project mapping (in production, use a database)
async function storeProjectMapping(opportunityId, projectGid) {
    // In production, store this in a database
    // For now, just log it
    console.log(`Mapping stored: Opportunity ${opportunityId} -> Project ${projectGid}`);
    
    // Example database storage:
    // await db.mappings.insert({
    //     opportunityId,
    //     projectGid,
    //     createdAt: new Date()
    // });
}

// Find project by opportunity ID (in production, use a database)
async function findProjectByOpportunityId(opportunityId) {
    // In production, query your database
    // For now, return null (will create new project)
    
    // Example database query:
    // const mapping = await db.mappings.findOne({ opportunityId });
    // return mapping ? mapping.projectGid : null;
    
    return null;
}

// Test endpoint - simulates a Pipeliner webhook
app.post('/test', async (req, res) => {
    console.log('Test endpoint called');
    
    // Sample test data
    const testData = {
        entity: 'Opportunity',
        action: 'create',
        data: {
            id: `test-${Date.now()}`,
            name: 'Equipment Upgrade Project',
            accountName: 'Sample Company',
            value: 125000,
            probability: 75,
            stage: 'Proposal',
            closeDate: '2025-06-30',
            ownerName: 'John Smith',
            description: 'Complete controls upgrade including new HMI, VFDs, and vision system integration.',
            projectType: 'Control System Upgrade',
            equipmentType: 'Production Line',
            facility: 'Main Plant'
        }
    };
    
    // Process the test webhook
    try {
        await handleNewOpportunity(testData.data);
        res.json({ 
            success: true, 
            message: 'Test completed! Check Asana for the new project.',
            testData: testData,
            asanaUrl: 'Check your Asana workspace for the new project'
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
    console.log('🏗️  Mode: Creates Asana PROJECTS');
    console.log('');
    console.log('Endpoints available:');
    console.log(`  📥 Webhook: POST /webhook/pipeliner`);
    console.log(`  💚 Health:  GET  /health`);
    console.log(`  🧪 Test:    POST /test`);
    console.log('');
    console.log('Configuration status:');
    console.log(`  Asana Token: ${config.asana.accessToken ? '✓ Set' : '✗ Not set'}`);
    console.log(`  Workspace ID: ${config.asana.workspaceId ? '✓ Set' : '✗ Not set'}`);
    console.log(`  Team ID: ${config.asana.teamId ? '✓ Set' : '○ Optional'}`);
    console.log('');
    console.log('Project Creation Settings:');
    console.log('  • Creates new project for each opportunity');
    console.log('  • Adds standard project sections');
    console.log('  • Creates initial task templates');
    console.log('  • Colors projects by value/client');
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
