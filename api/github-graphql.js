const fetch = require('node-fetch');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
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
};