module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
        // Clear the authentication cookies
        res.setHeader('Set-Cookie', [
            'github_access_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
            'auth_method=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
        ]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Clear token error:', error);
        res.status(500).json({ error: 'Failed to clear authentication token' });
    }
};