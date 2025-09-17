const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = 3000;

// Enable CORS for all routes
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files with no-cache for script.js to force browser refresh
app.get('/script.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'script.js'));
});

app.use(express.static('.'));

// GitHub Device Flow - Step 1: Get device code
app.post('/api/github/device/code', async (req, res) => {
    try {
        const { client_id, scope } = req.body;
        
        const response = await fetch('https://github.com/login/device/code', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `client_id=${client_id}&scope=${encodeURIComponent(scope)}`
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Device code API error:', errorText);
            return res.status(response.status).json({ 
                error: `GitHub device code API error: ${response.status}`,
                details: errorText 
            });
        }
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Device code error:', error);
        res.status(500).json({ error: 'Failed to get device code', details: error.message });
    }
});

// GitHub Device Flow - Step 2: Exchange device code for access token
app.post('/api/github/device/token', async (req, res) => {
    try {
        const { client_id, device_code } = req.body;
        
        const response = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `client_id=${client_id}&device_code=${device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`
        });
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Token exchange error:', error);
        res.status(500).json({ error: 'Failed to exchange token' });
    }
});

// GitHub GraphQL API endpoint
app.post('/api/github/graphql', async (req, res) => {
    try {
        console.log('Proxying GitHub GraphQL request');
        
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'PR-Tracker'
        };
        
        // Forward authorization header if present
        if (req.headers.authorization) {
            headers.Authorization = req.headers.authorization;
        }
        
        const response = await fetch('https://api.github.com/graphql', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(req.body)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`GitHub GraphQL API error: ${response.status} ${response.statusText}`, errorText);
            return res.status(response.status).json({ 
                error: `GitHub GraphQL API error: ${response.status} ${response.statusText}`,
                details: errorText 
            });
        }
        
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('GitHub GraphQL API proxy error:', error);
        res.status(500).json({ error: 'GitHub GraphQL API request failed', details: error.message });
    }
});

// Proxy for GitHub API requests
app.all('/api/github/*', async (req, res) => {
    try {
        const githubPath = req.path.replace('/api/github', '');
        const queryString = req.url.split('?')[1] || '';
        const githubUrl = `https://api.github.com${githubPath}${queryString ? '?' + queryString : ''}`;
        
        console.log(`Proxying GitHub API request: ${req.method} ${githubUrl}`);
        
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'PR-Tracker'
        };
        
        // Forward authorization header if present
        if (req.headers.authorization) {
            headers.Authorization = req.headers.authorization;
        }
        
        const fetchOptions = {
            method: req.method,
            headers: headers
        };
        
        // Add body for non-GET requests
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
            fetchOptions.body = JSON.stringify(req.body);
            headers['Content-Type'] = 'application/json';
        }
        
        const response = await fetch(githubUrl, fetchOptions);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`GitHub API error: ${response.status} ${response.statusText}`, errorText);
            return res.status(response.status).json({ 
                error: `GitHub API error: ${response.status} ${response.statusText}`,
                details: errorText 
            });
        }
        
        const data = await response.json();
        
        // Debug logging for PR #9742 CI status
        if (githubPath.includes('/check-runs') && githubPath.includes('61b1607b690edccf0fe913f4ca3a40da098336bb')) {
            console.log('\n=== PR #9742 CHECK RUNS DEBUG ===');
            console.log(`Check runs found: ${data.check_runs?.length || 0}`);
            if (data.check_runs) {
                data.check_runs.forEach(run => {
                    console.log(`- ${run.name}: status=${run.status}, conclusion=${run.conclusion}`);
                });
            }
            console.log('================================\n');
        }
        
        if (githubPath.includes('/status') && githubPath.includes('61b1607b690edccf0fe913f4ca3a40da098336bb')) {
            console.log('\n=== PR #9742 COMMIT STATUS DEBUG ===');
            console.log(`Overall state: ${data.state}`);
            console.log(`Statuses found: ${data.statuses?.length || 0}`);
            if (data.statuses) {
                data.statuses.forEach(status => {
                    console.log(`- ${status.context}: state=${status.state}, description="${status.description}"`);
                });
            }
            console.log('===================================\n');
        }
        
        if (githubPath.includes('/actions/runs') && queryString.includes('61b1607b690edccf0fe913f4ca3a40da098336bb')) {
            console.log('\n=== PR #9742 WORKFLOW RUNS DEBUG ===');
            console.log(`Workflow runs found: ${data.workflow_runs?.length || 0}`);
            if (data.workflow_runs) {
                data.workflow_runs.forEach(run => {
                    console.log(`- ${run.name}: status=${run.status}, conclusion=${run.conclusion}`);
                });
            }
            console.log('====================================\n');
        }
        
        res.json(data);
    } catch (error) {
        console.error('GitHub API proxy error:', error);
        res.status(500).json({ error: 'GitHub API request failed', details: error.message });
    }
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`GitHub PR Tracker server running at http://localhost:${PORT}`);
    console.log('Open your browser and navigate to the URL above');
});