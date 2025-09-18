# Deployment Guide

## Automatic Deployment with GitHub Actions

This repository includes a GitHub Actions workflow that automatically deploys to Vercel when you push to the `master` branch.

### Required GitHub Secrets

To enable automatic deployment, you need to add these secrets to your GitHub repository:

#### 1. Get Vercel Token
```bash
# Install Vercel CLI globally
npm install -g vercel

# Login to Vercel
vercel login

# Get your token (this will display your token)
vercel --token
```

#### 2. Get Project Information
```bash
# In your project directory, link to Vercel project
vercel link

# Get your Organization ID and Project ID
cat .vercel/project.json
```

#### 3. Add Secrets to GitHub
Go to your GitHub repository → Settings → Secrets and variables → Actions

Add these repository secrets:

- **`VERCEL_TOKEN`**: Your Vercel API token from step 1
- **`VERCEL_ORG_ID`**: Your organization ID from `.vercel/project.json`  
- **`VERCEL_PROJECT_ID`**: Your project ID from `.vercel/project.json`

### How it Works

- **Push to `master`**: Automatically deploys to production
- **Pull Requests**: Creates preview deployments for testing
- **Build Process**: Uses your `vercel.json` configuration
- **Environment Variables**: Uses the `GITHUB_CLIENT_ID` from your `vercel.json`

### Manual Deployment

You can still deploy manually using:

```bash
# Deploy to preview
vercel

# Deploy to production  
vercel --prod
```

### Deployment Status

Check deployment status in:
- GitHub Actions tab in your repository
- Vercel dashboard
- Vercel deployments page

## Local Development

To run locally:

```bash
# Install dependencies
npm install

# Start local server
npm start
```

The application will be available at `http://localhost:3000`.