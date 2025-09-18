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
        const { access_token, auth_method } = req.body;
        
        if (!access_token) {
            return res.status(400).json({ error: 'access_token is required' });
        }

        // Set HTTP-only cookie with security flags for custom domain
        const host = req.headers.host;
        const domain = host; // Use exact host to avoid subdomain issues
        
        const cookieOptions = [
            'HttpOnly',
            'SameSite=None',
            'Secure', // Required with SameSite=None
            'Path=/',
            `Domain=${domain}`,
            'Max-Age=2592000' // 30 days
        ];

        console.log('Setting cookies:', {
            host,
            domain,
            cookieOptions,
            hasToken: !!access_token
        });

        res.setHeader('Set-Cookie', [
            `github_access_token=${access_token}; ${cookieOptions.join('; ')}`,
            `auth_method=${auth_method || 'oauth'}; ${cookieOptions.join('; ')}`
        ]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Set token error:', error);
        res.status(500).json({ error: 'Failed to set authentication token' });
    }
};