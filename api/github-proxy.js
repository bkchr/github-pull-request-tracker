const fetch = require('node-fetch');

module.exports = async (req, res) => {
    
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
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
        
        let response;
        try {
            response = await fetch(githubUrl, fetchOptions);
        } catch (fetchError) {
            console.error('GitHub API fetch error:', fetchError.message);
            throw fetchError;
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`GitHub API error: ${response.status} ${response.statusText}`);
            return res.status(response.status).json({ 
                error: `GitHub API error: ${response.status} ${response.statusText}`,
                details: errorText,
                url: githubUrl
            });
        }
        
        const data = await response.json();
        
        
        res.json(data);
    } catch (error) {
        console.error('GitHub API proxy error:', error);
        res.status(500).json({ error: 'GitHub API request failed', details: error.message });
    }
};