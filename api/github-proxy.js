const fetch = require('node-fetch');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // Extract GitHub API path from the request URL
        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathWithQuery = url.pathname + url.search;
        
        // Remove /api/github-proxy from the path to get the GitHub API path
        const githubPath = pathWithQuery.replace('/api/github-proxy', '');
        const githubUrl = `https://api.github.com${githubPath}`;
        
        console.log(`Proxying GitHub API request: ${req.method} ${githubUrl}`);
        
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'PR-Tracker'
        };
        
        // Get token from HTTP-only cookie
        const cookies = {};
        if (req.headers.cookie) {
            req.headers.cookie.split(';').forEach(cookie => {
                const [name, value] = cookie.trim().split('=');
                cookies[name] = value;
            });
        }
        
        if (cookies.github_access_token) {
            headers.Authorization = `Bearer ${cookies.github_access_token}`;
        } else if (req.headers.authorization) {
            // Fallback to authorization header for backwards compatibility
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
        
        if (githubPath.includes('/actions/runs') && url.search.includes('61b1607b690edccf0fe913f4ca3a40da098336bb')) {
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
};