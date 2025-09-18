const fetch = require('node-fetch');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

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
};