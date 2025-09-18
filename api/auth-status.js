module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        // Parse cookies from the request
        const cookies = {};
        if (req.headers.cookie) {
            req.headers.cookie.split(';').forEach(cookie => {
                const [name, value] = cookie.trim().split('=');
                cookies[name] = value;
            });
        }
        
        
        const hasToken = !!cookies.github_access_token;
        const authMethod = cookies.auth_method || 'oauth';
        
        res.json({ 
            authenticated: hasToken,
            auth_method: authMethod
        });
    } catch (error) {
        console.error('Auth status error:', error);
        res.status(500).json({ error: 'Failed to check authentication status' });
    }
};