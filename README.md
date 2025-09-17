# GitHub Pull Request Tracker

A web application that allows you to log into GitHub, view all recent open pull requests, monitor CI status, and restart failed CI jobs.

## Features

- **GitHub OAuth Login**: Secure authentication with GitHub
- **Pull Request Dashboard**: View all open PRs across your repositories
- **CI Status Monitoring**: Visual indicators for CI job status (✅ success, ❌ failure, 🟡 pending, ❓ unknown)
- **Failed CI Restart**: One-click restart for failed CI jobs
- **Failure Aggregation**: Summarized failure reasons without overwhelming log details
- **Repository Filtering**: Filter PRs by repository name
- **Responsive Design**: Works on desktop and mobile devices

## Setup Instructions

### 1. Create a GitHub OAuth App

1. **Navigate to GitHub Settings**:
   - Log into GitHub
   - Click your profile picture (top right)
   - Select "Settings" from dropdown

2. **Go to Developer Settings**:
   - Scroll down in left sidebar
   - Click "Developer settings" (at the bottom)

3. **Create OAuth App**:
   - Click "OAuth Apps" in left sidebar
   - Click "New OAuth App" button

4. **Fill in Application Details**:
   - **Application name**: `PR Tracker` (or any name you prefer)
   - **Homepage URL**: `http://localhost:8000` (change to your domain if hosting elsewhere)
   - **Application description**: `GitHub Pull Request Tracker with CI monitoring` (optional)
   - **Authorization callback URL**: `http://localhost:8000` (same as homepage URL - not actually used for device flow)

5. **Register Application**:
   - Click "Register application"
   - You'll see your new OAuth App page

6. **Copy the Client ID**:
   - On the OAuth App page, you'll see "Client ID"
   - Copy this value (looks like: `Iv1.a1b2c3d4e5f6g7h8`)
   - **Important**: You only need the Client ID, NOT the Client Secret for device flow

### 2. Configure the Application

1. Open `script.js`
2. Replace `YOUR_GITHUB_CLIENT_ID` with your actual GitHub OAuth App Client ID:
   ```javascript
   this.clientId = 'your_actual_client_id_here';
   ```

### 3. Authentication with Device Flow

This app uses GitHub's Device Flow for secure authentication without requiring a backend server:

1. Click "Login with GitHub"
2. You'll see a verification code and URL (e.g., `https://github.com/login/device`)
3. Visit the URL in any browser/device
4. Enter the verification code
5. Authorize the application
6. The webpage will automatically detect the authorization and log you in

**No backend server required!** The Device Flow is secure and doesn't expose any secrets.

### 4. Run the Application

#### Using Python (simple HTTP server):
```bash
python -m http.server 8000
```

#### Using Node.js:
```bash
npx serve .
```

#### Using PHP:
```bash
php -S localhost:8000
```

Then open `http://localhost:8000` in your browser.

## Usage

1. **Login**: Click "Login with GitHub" to authenticate
2. **View PRs**: Once logged in, your open pull requests will be displayed
3. **Monitor CI**: Each PR shows its current CI status with colored icons
4. **Restart Failed CI**: Click "Restart Failed CI" for PRs with failed checks
5. **View Details**: Click "View Details" to see detailed check information
6. **Filter**: Use the filter box to search for specific repositories

## Security Considerations

- **Device Flow**: Uses GitHub's secure Device Flow - no client secrets exposed
- **Token Storage**: Access tokens are stored in localStorage (consider more secure alternatives for production)
- **Direct API**: GitHub API calls are made directly from the browser (works well for personal use)

## API Endpoints Used

- `GET /user` - Get authenticated user information
- `GET /user/repos` - Get user's repositories
- `GET /repos/{owner}/{repo}/pulls` - Get pull requests for a repository
- `GET /repos/{owner}/{repo}/pulls/{pull_number}/commits` - Get PR commits
- `GET /repos/{owner}/{repo}/commits/{sha}/check-runs` - Get check runs for a commit
- `POST /repos/{owner}/{repo}/check-runs/{check_run_id}/rerequest` - Restart a check run

## Browser Compatibility

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## Contributing

Feel free to open issues or submit pull requests to improve the application.

## License

MIT License