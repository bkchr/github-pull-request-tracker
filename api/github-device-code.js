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
};