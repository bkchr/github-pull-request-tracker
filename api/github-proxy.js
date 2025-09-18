const fetch = require('node-fetch');

module.exports = async (req, res) => {
    console.log('GitHub proxy called:', req.method, req.url);
    
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        console.log('OPTIONS request handled');
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
        
        console.log('URL parsing:');
        console.log('- Original URL:', req.url);
        console.log('- Path with query:', pathWithQuery);
        console.log('- GitHub path:', githubPath);
        console.log('- Final GitHub URL:', githubUrl);
        
        
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
        
        console.log('Cookie parsing - found cookies:', Object.keys(cookies));
        console.log('Has github_access_token:', !!cookies.github_access_token);
        
        if (cookies.github_access_token) {
            headers.Authorization = `Bearer ${cookies.github_access_token}`;
            console.log('Using token from cookie');
        } else if (req.headers.authorization) {
            // Fallback to authorization header for backwards compatibility
            headers.Authorization = req.headers.authorization;
            console.log('Using token from authorization header');
        } else {
            console.log('No token found in cookies or headers');
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
        
        console.log('Making request to GitHub API...');
        let response;
        try {
            response = await fetch(githubUrl, fetchOptions);
            console.log('GitHub API response received:', response.status, response.statusText);
        } catch (fetchError) {
            console.error('Fetch error occurred:', fetchError);
            console.error('Fetch error details:', {
                message: fetchError.message,
                name: fetchError.name,
                stack: fetchError.stack,
                code: fetchError.code
            });
            throw fetchError;
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`GitHub API error: ${response.status} ${response.statusText}`, errorText);
            console.error(`Failed API call: ${req.method} ${githubUrl}`);
            return res.status(response.status).json({ 
                error: `GitHub API error: ${response.status} ${response.statusText}`,
                details: errorText,
                url: githubUrl
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