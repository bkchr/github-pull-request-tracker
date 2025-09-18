# Deployment Guide

## Automatic Deployment with Vercel

Vercel automatically deploys your application when you push to the `master` branch. No additional setup required!

## Manual Deployment (if needed)

If you need to deploy manually, you can use the Vercel CLI:

### Install Vercel CLI
```bash
# Install Vercel CLI globally
npm install -g vercel

# Login to Vercel
vercel login

# Deploy to preview
vercel

# Deploy to production  
vercel --prod
```

## Local Development

To run locally:

```bash
# Install dependencies
npm install

# Start local server
npm start
```

The application will be available at `http://localhost:3000`.

## Environment Variables

The application uses these environment variables (already configured in `vercel.json`):

- `GITHUB_CLIENT_ID` - Your GitHub OAuth app client ID (hardcoded in vercel.json)

## Project Structure

- **Frontend**: Static HTML/CSS/JS files served by Vercel
- **API Routes**: Serverless functions in `/api/` directory
- **Configuration**: `vercel.json` handles routing and environment variables

## Vercel Features Used

- **Serverless Functions**: API endpoints in `/api/` folder
- **Static File Serving**: HTML, CSS, JS files
- **Custom Domain**: Configured for `pr-tracker.kchr.de`
- **Automatic HTTPS**: Handled by Vercel
- **HTTP-Only Cookies**: Secure authentication token storage