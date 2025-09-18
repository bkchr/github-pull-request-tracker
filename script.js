class GitHubPRTracker {
    constructor() {
        this.clientId = 'Ov23li2VVjfGHdt11COT';
        this.accessToken = null;
        this.authMethod = 'oauth'; // 'oauth' or 'token'
        this.deviceCode = null;
        this.pollingInterval = null;
        this.autoRefreshInterval = null;
        this.autoRefreshEnabled = true; // Default to enabled to match the HTML checkbox
        this.isRefreshing = false;
        this.lastPRData = null;
        this.currentFetchController = null;
        this.fetchIdCounter = 0;
        this.displayIdCounter = 0;
        this.displayInProgress = false;
        this.currentDisplayId = null;
        this.prCache = new Map(); // Cache PR details to speed up refreshes
        this.fetchCount = 0; // Safety counter to prevent infinite loops
        
        console.log('🏗️ [CONSTRUCTOR] GitHubPRTracker constructor called');
        this.checkAuthStatus().then(() => this.init());
    }

    // Helper function to get age cutoff date based on filter selection
    getAgeCutoffDate() {
        const ageFilter = document.getElementById('age-filter');
        const days = parseInt(ageFilter.value);
        if (days === 0) return null; // "All time" - no cutoff
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        return cutoffDate;
    }

    // Check authentication status from HTTP-only cookie
    async checkAuthStatus() {
        try {
            const response = await fetch('/api/auth-status', {
                method: 'GET',
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.authenticated) {
                    this.accessToken = 'cookie-based'; // Placeholder since we can't access the actual token
                    this.authMethod = data.auth_method;
                } else {
                    this.accessToken = null;
                    this.authMethod = 'oauth';
                }
            }
        } catch (error) {
            console.error('Failed to check auth status:', error);
            this.accessToken = null;
            this.authMethod = 'oauth';
        }
    }

    // Set authentication token using HTTP-only cookie
    async setAuthToken(accessToken, authMethod = 'oauth') {
        try {
            console.log('Attempting to set auth token via cookie...');
            const response = await fetch('/api/auth-set-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    access_token: accessToken,
                    auth_method: authMethod
                })
            });
            
            console.log('Set token response:', response.status, response.statusText);
            
            if (response.ok) {
                const data = await response.json();
                console.log('Set token success:', data);
                this.accessToken = 'cookie-based';
                this.authMethod = authMethod;
                return true;
            } else {
                const errorText = await response.text();
                console.error('Failed to set auth token:', response.status, errorText);
                return false;
            }
        } catch (error) {
            console.error('Error setting auth token:', error);
            return false;
        }
    }

    // Clear authentication token
    async clearAuthToken() {
        try {
            const response = await fetch('/api/auth-clear-token', {
                method: 'POST',
                credentials: 'include'
            });
            
            if (response.ok) {
                this.accessToken = null;
                this.authMethod = 'oauth';
                return true;
            } else {
                console.error('Failed to clear auth token');
                return false;
            }
        } catch (error) {
            console.error('Error clearing auth token:', error);
            return false;
        }
    }

    getMergeableStatusIcon(mergeable, mergeable_state, approvals, ciStatus) {
        // Only show "Mergeable" if GitHub says it's mergeable AND we have approvals AND CI is passing
        if (mergeable === true && approvals > 0 && ciStatus === 'success') {
            return '<span class="status-icon mergeable" title="Ready to merge - has approvals and CI passed">✅ Mergeable</span>';
        } else if (mergeable === false) {
            switch (mergeable_state) {
                case 'dirty':
                    return '<span class="status-icon not-mergeable" title="Merge conflicts">❌ Conflicts</span>';
                case 'blocked':
                    return '<span class="status-icon blocked" title="Blocked by required status checks">🚫 Blocked</span>';
                case 'behind':
                    return '<span class="status-icon behind" title="Behind base branch">⬇️ Behind</span>';
                default:
                    return '<span class="status-icon not-mergeable" title="Not mergeable">❌ Not mergeable</span>';
            }
        } else if (mergeable === true && approvals === 0) {
            return '<span class="status-icon blocked" title="Needs approvals">⏳ Needs approvals</span>';
        } else if (mergeable === true && ciStatus !== 'success') {
            if (ciStatus === 'failure') {
                return '<span class="status-icon blocked" title="CI checks failing">❌ CI failing</span>';
            } else if (ciStatus === 'pending') {
                return '<span class="status-icon blocked" title="CI checks running">🔄 CI running</span>';
            } else {
                return '<span class="status-icon blocked" title="CI status unknown">❓ CI unknown</span>';
            }
        } else {
            // mergeable is null - status unknown/computing
            return '<span class="status-icon unknown" title="Merge status unknown">❓ Checking...</span>';
        }
    }

    async fetchPRReviews(repoFullName, prNumber) {
        try {
            const response = await fetch(`/api/github-proxy/repos/${repoFullName}/pulls/${prNumber}/reviews`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json'
                },
                credentials: 'include'
            });

            if (!response.ok) {
                console.warn(`Failed to fetch reviews for ${repoFullName}#${prNumber}: ${response.status}`);
                return { approvals: 0, total: 0 };
            }

            const reviews = await response.json();
            
            // Get the latest review from each user (most recent state)
            const latestReviews = {};
            reviews.forEach(review => {
                if (!latestReviews[review.user.login] || new Date(review.submitted_at) > new Date(latestReviews[review.user.login].submitted_at)) {
                    latestReviews[review.user.login] = review;
                }
            });

            // Count approvals from latest reviews
            const approvals = Object.values(latestReviews).filter(review => review.state === 'APPROVED').length;
            const total = Object.keys(latestReviews).length;

            return { approvals, total };
        } catch (error) {
            console.warn(`Error fetching reviews for ${repoFullName}#${prNumber}:`, error);
            return { approvals: 0, total: 0 };
        }
    }

    async fetchPRDetails(repoFullName, prNumber) {
        try {
            const response = await fetch(`/api/github-proxy/repos/${repoFullName}/pulls/${prNumber}`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json'
                },
                credentials: 'include'
            });

            if (!response.ok) {
                console.warn(`Failed to fetch PR details for ${repoFullName}#${prNumber}: ${response.status}`);
                return { mergeable: null, mergeable_state: 'unknown' };
            }

            const prDetails = await response.json();
            
            return { 
                mergeable: prDetails.mergeable,
                mergeable_state: prDetails.mergeable_state 
            };
        } catch (error) {
            console.warn(`Error fetching PR details for ${repoFullName}#${prNumber}:`, error);
            return { mergeable: null, mergeable_state: 'unknown' };
        }
    }

    init() {
        console.log('🏗️ [INIT] Setting up event listeners');
        this.setupEventListeners();
        console.log('🏗️ [INIT] Checking auth status');
        this.checkAuthStatus();
    }

    setupEventListeners() {
        document.getElementById('login-btn').addEventListener('click', () => this.login());
        document.getElementById('token-login-btn').addEventListener('click', () => this.showTokenModal());
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        document.getElementById('refresh-btn').addEventListener('click', () => {
            console.log('🔄 Manual refresh button clicked');
            this.fetchPullRequests(false);
        });
        
        const repoFilter = document.getElementById('repo-filter');
        repoFilter.addEventListener('input', () => this.applyFilters());
        
        const ageFilter = document.getElementById('age-filter');
        ageFilter.addEventListener('change', () => this.applyFilters());
        
        // Auto-refresh controls
        const autoRefreshCheckbox = document.getElementById('auto-refresh');
        const refreshInterval = document.getElementById('refresh-interval');
        
        autoRefreshCheckbox.addEventListener('change', () => this.toggleAutoRefresh());
        refreshInterval.addEventListener('change', () => {
            if (autoRefreshCheckbox.checked) {
                this.startAutoRefresh();
            }
        });
        
        // Page visibility detection will be set up after authentication
    }

    async checkAuthStatus() {
        if (this.accessToken) {
            try {
                const user = await this.fetchUser();
                this.showUserInfo(user);
                this.showMainContent();
                console.log('🏗️ [INIT] Setting up page visibility detection');
                document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
                console.log('🏗️ [INIT] Calling initial fetchPullRequests');
                this.fetchPullRequests(false); // Explicitly pass false for initial load
            } catch (error) {
                console.error('Token validation failed:', error);
                this.logout();
            }
        }
    }

    async login() {
        try {
            this.showDeviceFlowUI();
            
            // Step 1: Request device code via proxy
            const deviceResponse = await fetch('/api/github-device-code', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    client_id: this.clientId,
                    scope: 'repo workflow'
                })
            });

            if (!deviceResponse.ok) {
                const errorText = await deviceResponse.text();
                console.error('Device code error response:', errorText);
                throw new Error('Failed to get device code: ' + deviceResponse.status);
            }

            const deviceData = await deviceResponse.json();
            this.deviceCode = deviceData.device_code;
            
            // Show user the verification URL and code
            this.displayDeviceCode(deviceData.user_code, deviceData.verification_uri);
            
            // Step 2: Start polling for token
            this.startTokenPolling(deviceData.device_code, deviceData.interval);
            
        } catch (error) {
            console.error('Login error:', error);
            this.showError('Failed to start login: ' + error.message);
            this.hideDeviceFlowUI();
        }
    }

    async logout() {
        await this.clearAuthToken();
        this.deviceCode = null;
        
        // Clear polling if active
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        
        this.hideMainContent();
        this.hideUserInfo();
        this.hideDeviceFlowUI();
        document.getElementById('pr-list').innerHTML = '';
    }

    async startTokenPolling(deviceCode, interval) {
        const pollForToken = async () => {
            try {
                const tokenResponse = await fetch('/api/github-device-token', {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        client_id: this.clientId,
                        device_code: deviceCode
                    })
                });

                const tokenData = await tokenResponse.json();
                
                if (tokenData.access_token) {
                    // Success! We got the token
                    await this.setAuthToken(tokenData.access_token, 'oauth');
                    
                    clearInterval(this.pollingInterval);
                    this.pollingInterval = null;
                    
                    this.hideDeviceFlowUI();
                    this.checkAuthStatus();
                    
                } else if (tokenData.error === 'authorization_pending') {
                    // Still waiting for user to authorize
                    // Continue polling
                } else if (tokenData.error === 'slow_down') {
                    // GitHub wants us to slow down polling
                    clearInterval(this.pollingInterval);
                    this.pollingInterval = setInterval(pollForToken, (interval + 5) * 1000);
                } else {
                    // Some other error occurred
                    throw new Error(tokenData.error_description || tokenData.error || 'Unknown error');
                }
                
            } catch (error) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = null;
                this.showError('Authentication failed: ' + error.message);
                this.hideDeviceFlowUI();
            }
        };

        // Start polling every interval seconds
        this.pollingInterval = setInterval(pollForToken, interval * 1000);
        
        // Also try immediately
        pollForToken();
    }

    showDeviceFlowUI() {
        const deviceFlowDiv = document.getElementById('device-flow');
        if (deviceFlowDiv) {
            deviceFlowDiv.classList.remove('hidden');
        }
        
        const loginBtn = document.getElementById('login-btn');
        loginBtn.textContent = 'Authenticating...';
        loginBtn.disabled = true;
    }

    hideDeviceFlowUI() {
        const deviceFlowDiv = document.getElementById('device-flow');
        if (deviceFlowDiv) {
            deviceFlowDiv.classList.add('hidden');
        }
        
        const loginBtn = document.getElementById('login-btn');
        loginBtn.textContent = 'Login with GitHub';
        loginBtn.disabled = false;
    }

    displayDeviceCode(userCode, verificationUri) {
        const deviceFlowDiv = document.getElementById('device-flow');
        if (deviceFlowDiv) {
            deviceFlowDiv.innerHTML = `
                <div class="device-flow-content">
                    <h3>Complete GitHub Authentication</h3>
                    <p>To continue, please visit:</p>
                    <div class="verification-url">
                        <a href="${verificationUri}" target="_blank">${verificationUri}</a>
                    </div>
                    <p>And enter this code:</p>
                    <div class="user-code">
                        <code>${userCode}</code>
                        <button class="btn btn-small copy-code" onclick="navigator.clipboard.writeText('${userCode}')">Copy</button>
                    </div>
                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 12px; margin: 15px 0; font-size: 0.9em;">
                        <strong>⚠️ OAuth Limitations:</strong>
                        <ul style="margin: 5px 0 0 20px; color: #856404;">
                            <li>Can view PR status and CI details</li>
                            <li>Cannot restart failed workflows (organization restrictions)</li>
                            <li>For restart functionality, use "Personal Access Token" instead</li>
                        </ul>
                    </div>
                    <p class="waiting-text">Waiting for you to complete authentication...</p>
                    <button class="btn btn-secondary" onclick="tracker.cancelDeviceFlow()">Cancel</button>
                </div>
            `;
        }
    }

    cancelDeviceFlow() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
        this.hideDeviceFlowUI();
    }

    async fetchUser(signal = null) {
        const response = await fetch('/api/github-proxy/user', {
            headers: {
                'Accept': 'application/vnd.github.v3+json'
            },
            credentials: 'include',
            signal: signal
        });

        if (!response.ok) {
            throw new Error('Failed to fetch user');
        }

        return response.json();
    }

    async fetchPullRequests(isAutoRefresh = false) {
        if (!this.accessToken) return;
        
        // Safety check to prevent infinite loops
        this.fetchCount++;
        if (this.fetchCount > 100) {
            console.error('🚨 [SAFETY] Too many fetch attempts, stopping to prevent infinite loop');
            this.showError('Too many API requests - stopping auto-refresh for safety');
            this.stopAutoRefresh();
            return;
        }
        
        // Check if we have a valid access token
        if (!this.accessToken) {
            console.warn('⚠️ No access token available, skipping fetch');
            return;
        }
        
        // Cancel any existing fetch request
        if (this.currentFetchController) {
            console.log(`🚫 fetchPullRequests: Aborting previous fetch #${this.currentFetchController.fetchId}`);
            this.currentFetchController.abort();
        }
        
        // Create new AbortController for this request with unique ID
        this.fetchIdCounter++;
        const fetchId = this.fetchIdCounter;
        this.currentFetchController = new AbortController();
        this.currentFetchController.fetchId = fetchId;
        const signal = this.currentFetchController.signal;
        
        const now = new Date().toLocaleTimeString();
        console.log(`🚀 [${now}] Starting fetch request #${fetchId} (isAutoRefresh: ${isAutoRefresh})`);
        
        // Capture current filter state to check later
        const currentFilterState = this.getCurrentFilterState();
        
        // Prevent multiple simultaneous refreshes
        if (this.isRefreshing) return;
        this.isRefreshing = true;

        // Only show loading indicator for manual refreshes, not auto-refreshes
        if (!isAutoRefresh) {
            this.showLoading(true);
        }
        
        // Also show refresh status for auto refresh
        if (isAutoRefresh) {
            this.showRefreshStatus(true);
        }
        
        try {
            // Check if request was cancelled before starting
            if (signal.aborted) {
                return;
            }
            
            // Get current user info first
            const user = await this.fetchUser(signal);
            
            // Check if request was cancelled after user fetch
            if (signal.aborted) {
                return;
            }
            
            // Use GitHub search API to find open PRs involving the current user
            // This includes PRs where you're author, assignee, mentioned, or reviewer
            const openPRsQuery = `involves:${user.login} is:pr is:open`;
            
            console.log(`🔍 [SEARCH] Fetching open PRs involving user: ${openPRsQuery}`);
            
            // Fetch open PRs - we'll check merge queue status for each one
            const allPrs = await this.searchPullRequests(openPRsQuery, signal);
            
            // Check auto-merge ("merge when ready") status for each PR and filter
            console.log(`🔍 [MERGE_WHEN_READY] Checking auto-merge status for ${allPrs.length} PRs`);
            const prs = await this.checkMergeQueueStatus(allPrs, signal, user);
            console.log(`🔍 [FILTER] Filtered to ${prs.length} relevant PRs`);
            
            // Check if request was cancelled after search
            if (signal.aborted) {
                return;
            }
            
            // Sort by updated date
            prs.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
            
            // Final check if request was cancelled before displaying
            if (signal.aborted) {
                return;
            }
            
            // Store the new data
            const newPRData = JSON.stringify(prs);
            
            // Check if filters have changed during the fetch
            const newFilterState = this.getCurrentFilterState();
            const filtersHaveChanged = this.filtersChanged(currentFilterState, newFilterState);
            
            // Only update display if data actually changed (for auto-refresh) AND filters haven't changed AND request wasn't cancelled
            console.log(`🔧 [DEBUG] Fetch #${fetchId} checking display conditions:`);
            console.log(`  - isAutoRefresh: ${isAutoRefresh}`);
            console.log(`  - lastPRData !== newPRData: ${this.lastPRData !== newPRData}`);
            console.log(`  - filtersHaveChanged: ${filtersHaveChanged}`);
            console.log(`  - signal.aborted: ${signal.aborted}`);
            
            if ((!isAutoRefresh || this.lastPRData !== newPRData) && !filtersHaveChanged && !signal.aborted) {
                console.log(`✅ Fetch #${fetchId} completed, displaying results`);
                this.displayPullRequests(prs, this.currentFetchController, isAutoRefresh);
                this.lastPRData = newPRData;
            } else {
                console.log(`🚫 Fetch #${fetchId} NOT displaying results due to conditions above`);
            }
            
            // Start auto-refresh on first successful load (only if not already running)
            if (!isAutoRefresh && this.autoRefreshInterval === null && this.autoRefreshEnabled) {
                console.log('🔄 Starting auto-refresh for first time after successful load');
                this.startAutoRefresh();
            }
            
        } catch (error) {
            // Don't show error for cancelled requests
            if (error.name === 'AbortError' || signal.aborted) {
                console.log(`🚫 Fetch #${fetchId} was cancelled`);
            } else {
                console.error(`❌ Fetch #${fetchId} failed:`, error);
                console.error('Error stack:', error.stack);
                this.showError('Failed to fetch pull requests: ' + error.message);
            }
        } finally {
            const endTime = new Date().toLocaleTimeString();
            console.log(`🏁 [${endTime}] Fetch #${fetchId} completed - setting isRefreshing=false`);
            this.isRefreshing = false;
            if (isAutoRefresh) {
                this.showRefreshStatus(false);
            } else {
                // Hide loading spinner for manual refreshes if displayPullRequests wasn't called
                // (displayPullRequests will handle hiding it if it was called)
            }
        }
    }

    async searchPullRequests(query, signal = null) {
        const response = await fetch(`/api/github-proxy/search/issues?q=${encodeURIComponent(query)}&per_page=100&sort=updated`, {
            headers: {
                'Accept': 'application/vnd.github.v3+json'
            },
            credentials: 'include',
            signal: signal
        });

        if (!response.ok) {
            throw new Error('Failed to search pull requests');
        }

        const data = await response.json();
        
        // Convert search results to PR format and extract repo info
        // Filter out PRs from archived repositories
        return data.items
            .filter(item => {
                // Check if repository is archived (GitHub search includes repository object)
                return !item.repository || !item.repository.archived;
            })
            .map(item => {
                const urlParts = item.repository_url.split('/');
                const repoFullName = `${urlParts[urlParts.length - 2]}/${urlParts[urlParts.length - 1]}`;
                
                return {
                    ...item,
                    repo: repoFullName,
                    html_url: item.html_url,
                    number: item.number,
                    title: item.title,
                    user: item.user,
                    updated_at: item.updated_at
                };
            });
    }

    async fetchUserRepos() {
        const response = await fetch('/api/github-proxy/user/repos?type=all&sort=updated&per_page=100', {
            headers: {
                'Accept': 'application/vnd.github.v3+json'
            },
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Failed to fetch repositories');
        }

        return response.json();
    }

    async fetchRepoPRs(repoFullName) {
        const response = await fetch(`/api/github-proxy/repos/${repoFullName}/pulls?state=open&per_page=100`, {
            headers: {
                'Accept': 'application/vnd.github.v3+json'
            },
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch PRs for ${repoFullName}`);
        }

        return response.json();
    }

    async fetchPRChecks(repoFullName, prNumber) {
        const response = await fetch(`/api/github-proxy/repos/${repoFullName}/pulls/${prNumber}/commits`, {
            headers: {
                'Accept': 'application/vnd.github.v3+json'
            },
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Failed to fetch PR commits');
        }

        const commits = await response.json();
        const latestCommit = commits[commits.length - 1];

        if (!latestCommit) return { status: 'unknown', runs: [], statuses: [] };

        // Fetch check runs, commit statuses, and workflow runs in parallel
        const [checksResponse, statusesResponse, workflowRunsResponse] = await Promise.all([
            fetch(`/api/github-proxy/repos/${repoFullName}/commits/${latestCommit.sha}/check-runs`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json'
                },
                credentials: 'include'
            }),
            fetch(`/api/github-proxy/repos/${repoFullName}/commits/${latestCommit.sha}/status`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json'
                },
                credentials: 'include'
            }),
            fetch(`/api/github-proxy/repos/${repoFullName}/actions/runs?head_sha=${latestCommit.sha}&per_page=100`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json'
                },
                credentials: 'include'
            })
        ]);

        let checkRuns = [];
        let commitStatuses = [];
        let workflowRuns = [];

        // Get check runs if available
        if (checksResponse.ok) {
            const checksData = await checksResponse.json();
            checkRuns = checksData.check_runs || [];
        }

        // Get commit statuses if available
        if (statusesResponse.ok) {
            const statusesData = await statusesResponse.json();
            commitStatuses = statusesData.statuses || [];
        }

        // Get workflow runs if available
        if (workflowRunsResponse.ok) {
            const workflowData = await workflowRunsResponse.json();
            workflowRuns = workflowData.workflow_runs || [];
        }

        // Debug logging for PR #9742
        if (prNumber === 9742) {
            console.log(`PR #${prNumber} Debug Info:`);
            console.log(`Check runs (${checkRuns.length}):`, checkRuns.map(r => ({ name: r.name, status: r.status, conclusion: r.conclusion })));
            console.log(`Commit statuses (${commitStatuses.length}):`, commitStatuses.map(s => ({ context: s.context, state: s.state, description: s.description })));
            console.log(`Workflow runs (${workflowRuns.length}):`, workflowRuns.map(w => ({ name: w.name, status: w.status, conclusion: w.conclusion })));
        }

        const aggregatedStatus = this.aggregateAllStatus(checkRuns, commitStatuses, workflowRuns);
        
        if (prNumber === 9742) {
            console.log(`PR #${prNumber} Final Status:`, aggregatedStatus);
        }

        return {
            status: aggregatedStatus,
            runs: checkRuns,
            statuses: commitStatuses,
            workflows: workflowRuns
        };
    }

    aggregateAllStatus(checkRuns, commitStatuses, workflowRuns) {
        // Combine check runs, commit statuses, and workflow runs for comprehensive status
        // Only consider checks that are likely to be required for merging
        const allChecks = [];
        
        // Process check runs
        if (checkRuns && checkRuns.length > 0) {
            checkRuns.forEach(run => {
                // Only consider required check runs (those that would block merging)
                // Optional checks typically have specific patterns or aren't blocking
                const isRequired = this.isRequiredCheck(run.name, 'check_run');
                allChecks.push({
                    type: 'check_run',
                    name: run.name,
                    status: run.status,
                    conclusion: run.conclusion,
                    state: run.status === 'completed' ? run.conclusion : run.status,
                    required: isRequired
                });
            });
        }
        
        // Process commit statuses (legacy GitHub Apps and integrations)
        if (commitStatuses && commitStatuses.length > 0) {
            commitStatuses.forEach(status => {
                const isRequired = this.isRequiredCheck(status.context, 'status');
                allChecks.push({
                    type: 'status',
                    name: status.context,
                    status: status.state,
                    conclusion: status.state,
                    state: status.state,
                    required: isRequired
                });
            });
        }
        
        // Process workflow runs (this catches cancelled/failed workflows)
        if (workflowRuns && workflowRuns.length > 0) {
            workflowRuns.forEach(workflow => {
                const isRequired = this.isRequiredCheck(workflow.name, 'workflow');
                allChecks.push({
                    type: 'workflow',
                    name: workflow.name,
                    status: workflow.status,
                    conclusion: workflow.conclusion,
                    state: workflow.status === 'completed' ? workflow.conclusion : workflow.status,
                    required: isRequired
                });
            });
        }
        
        if (allChecks.length === 0) return 'unknown';
        
        // Only consider required checks for the overall status
        const requiredChecks = allChecks.filter(check => check.required);
        
        // If no required checks, use all checks (fallback)
        const checksToEvaluate = requiredChecks.length > 0 ? requiredChecks : allChecks;
        const states = checksToEvaluate.map(check => check.state);
        
        console.log(`🔧 [CI-STATUS] Evaluating ${checksToEvaluate.length} required checks out of ${allChecks.length} total checks`);
        checksToEvaluate.forEach(check => {
            console.log(`  - ${check.name}: ${check.state} (${check.type})`);
        });
        
        // Priority order: failure > pending > success
        // Check for any failures first (highest priority)
        if (states.includes('failure') || states.includes('error') || 
            states.includes('cancelled') || states.includes('timed_out')) {
            return 'failure';
        }
        
        // Check for any running/pending checks
        if (states.includes('pending') || states.includes('in_progress') || states.includes('queued')) {
            return 'pending';
        }
        
        // All passed
        if (states.every(state => 
            state === 'success' || state === 'neutral' || state === 'skipped'
        )) {
            return 'success';
        }
        
        return 'unknown';
    }

    isRequiredCheck(checkName, checkType) {
        // Define patterns for optional/non-required checks
        const optionalPatterns = [
            // Common optional checks
            /optional/i,
            /lint/i,
            /format/i,
            /style/i,
            /documentation/i,
            /docs/i,
            /spell/i,
            /typo/i,
            
            // Specific known optional workflows for Polkadot/Substrate
            /check.*semver/i,
            /check.*prdoc/i,
            /check.*migration/i,
            /check.*runtime.*upgrade/i,
            /check.*weights/i,
            /zombienet/i,
            
            // Performance/benchmark checks (often optional)
            /benchmark/i,
            /performance/i,
            /perf/i,
            
            // Code quality checks (often optional)
            /clippy/i,
            /rustfmt/i,
            /cargo.*fmt/i,
            
            // Coverage checks (often optional)
            /coverage/i,
            /codecov/i,
            
            // Deployment/release checks (often optional)
            /deploy/i,
            /release/i,
            /publish/i
        ];
        
        // Check if this matches any optional pattern
        const isOptional = optionalPatterns.some(pattern => pattern.test(checkName));
        
        // Most checks are required by default, unless they match optional patterns
        const isRequired = !isOptional;
        
        console.log(`🔧 [CHECK-REQUIRED] "${checkName}" (${checkType}): ${isRequired ? 'REQUIRED' : 'OPTIONAL'}`);
        
        return isRequired;
    }

    // Keep the old method for backward compatibility
    aggregateCombinedStatus(checkRuns, commitStatuses) {
        return this.aggregateAllStatus(checkRuns, commitStatuses, []);
    }

    // Keep the old method for backward compatibility
    aggregateCheckStatus(checkRuns) {
        return this.aggregateCombinedStatus(checkRuns, []);
    }

    async restartFailedChecks(repoFullName, prNumber) {
        try {
            // Get the failed check runs and workflows
            const checks = await this.fetchPRChecks(repoFullName, prNumber);
            
            // Find failed check runs
            const failedCheckRuns = checks.runs.filter(run => 
                run.conclusion === 'failure' && run.status === 'completed'
            );
            
            // Find failed or cancelled workflows
            const failedWorkflows = checks.workflows.filter(workflow => 
                (workflow.conclusion === 'failure' || workflow.conclusion === 'cancelled') && 
                workflow.status === 'completed'
            );

            const totalFailures = failedCheckRuns.length + failedWorkflows.length;
            
            if (totalFailures === 0) {
                this.showError('No failed checks or workflows found to restart');
                return;
            }

            let restartedCount = 0;
            let errors = [];

            // Restart failed check runs
            for (const run of failedCheckRuns) {
                try {
                    const response = await fetch(`/api/github-proxy/repos/${repoFullName}/check-runs/${run.id}/rerequest`, {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/vnd.github.v3+json'
                        },
                        credentials: 'include'
                    });
                    
                    if (response.ok) {
                        restartedCount++;
                    } else {
                        errors.push(`Failed to restart check run "${run.name}"`);
                    }
                } catch (error) {
                    console.warn(`Failed to restart check run ${run.name}:`, error);
                    errors.push(`Failed to restart check run "${run.name}"`);
                }
            }

            // Restart failed workflows
            for (const workflow of failedWorkflows) {
                try {
                    const response = await fetch(`/api/github-proxy/repos/${repoFullName}/actions/runs/${workflow.id}/rerun`, {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/vnd.github.v3+json'
                        },
                        credentials: 'include'
                    });
                    
                    if (response.ok) {
                        restartedCount++;
                    } else {
                        const errorText = await response.text();
                        let errorMessage = `Failed to restart workflow "${workflow.name}"`;
                        
                        // Try rerunning failed jobs only if full rerun failed
                        const failedJobsResponse = await fetch(`/api/github-proxy/repos/${repoFullName}/actions/runs/${workflow.id}/rerun-failed-jobs`, {
                            method: 'POST',
                            headers: {
                                'Accept': 'application/vnd.github.v3+json'
                            },
                            credentials: 'include'
                        });
                        
                        if (failedJobsResponse.ok) {
                            restartedCount++;
                        } else {
                            // Provide more specific error messages based on response status
                            if (response.status === 403) {
                                errorMessage += ' (insufficient permissions)';
                            } else if (response.status === 422) {
                                // Check if there are running jobs that prevent restart
                                try {
                                    const errorData = JSON.parse(errorText);
                                    if (errorData.message && errorData.message.includes('running')) {
                                        errorMessage += ' (cannot restart while other jobs are running)';
                                    } else {
                                        errorMessage += ' (workflow cannot be rerun - may be too old or not re-runnable)';
                                    }
                                } catch (e) {
                                    errorMessage += ' (workflow cannot be rerun - may be too old or running jobs prevent restart)';
                                }
                            } else if (response.status === 404) {
                                errorMessage += ' (workflow run not found)';
                            } else {
                                errorMessage += ` (HTTP ${response.status})`;
                            }
                            errors.push(errorMessage);
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to restart workflow ${workflow.name}:`, error);
                    errors.push(`Failed to restart workflow "${workflow.name}" (network error)`);
                }
            }

            // Show results
            if (restartedCount > 0) {
                this.showSuccess(`Restarted ${restartedCount} of ${totalFailures} failed check(s)/workflow(s)`);
            }
            
            if (errors.length > 0) {
                console.warn('Some restarts failed:', errors);
                
                // Count different error types for better user messaging
                const permissionErrors = errors.filter(e => e.includes('insufficient permissions')).length;
                const nonRetryableErrors = errors.filter(e => e.includes('cannot be rerun')).length;
                const runningJobErrors = errors.filter(e => e.includes('running jobs prevent restart')).length;
                
                let userMessage = '';
                if (restartedCount === 0) {
                    userMessage = 'Failed to restart any workflows. ';
                } else {
                    userMessage = `Restarted ${restartedCount} workflows, but ${errors.length} failed to restart. `;
                }
                
                if (permissionErrors > 0) {
                    userMessage += `${permissionErrors} failed due to insufficient permissions. You may need to re-authenticate with workflow permissions. `;
                }
                if (nonRetryableErrors > 0) {
                    userMessage += `${nonRetryableErrors} cannot be rerun (may be too old or use restricted workflow types). `;
                }
                if (runningJobErrors > 0) {
                    userMessage += `${runningJobErrors} cannot restart while other jobs are running - wait for running jobs to complete first. `;
                }
                
                userMessage += 'Check console for details.';
                
                if (restartedCount === 0) {
                    this.showError(userMessage);
                } else {
                    // Show as warning since some succeeded
                    const warningDiv = document.getElementById('error-message');
                    warningDiv.textContent = userMessage;
                    warningDiv.className = 'warning';
                    warningDiv.classList.remove('hidden');
                    setTimeout(() => {
                        warningDiv.classList.add('hidden');
                        warningDiv.className = 'error hidden';
                    }, 8000);
                }
            }
            
            // Refresh the PR list after a short delay
            setTimeout(() => {
                console.log('🔄 Auto-refreshing after restart workflow');
                this.fetchPullRequests(false);
            }, 3000);
        } catch (error) {
            this.showError('Failed to restart checks: ' + error.message);
        }
    }

    async displayPullRequests(prs, requestController = null, isAutoRefresh = false) {
        this.displayIdCounter++;
        const displayId = this.displayIdCounter;
        const ageFilterDays = parseInt(document.getElementById('age-filter').value);
        const controllerId = requestController?.fetchId || 'none';
        console.log(`🏁 START display #${displayId}: ${prs.length} PRs, ageFilter=${ageFilterDays} days, controller=#${controllerId}`);
        console.log(`🔧 [DEBUG] displayPullRequests called with ${prs.length} PRs, isAutoRefresh=${isAutoRefresh}`);
        
        // Cancel any old display in progress and start the new one
        if (this.displayInProgress) {
            console.log(`🚫 Cancelling old display #${this.currentDisplayId} for new display #${displayId}`);
            // The old display will check this and abort itself
        }
        
        this.displayInProgress = true;
        this.currentDisplayId = displayId;
        let visibleCount = 0;
        
        try {
        
        // Check if this display has been superseded by a newer one
        if (this.currentDisplayId !== displayId) {
            console.log(`🚫 Display #${displayId} superseded by #${this.currentDisplayId}`);
            // Don't hide loading spinner here - let the newer display handle it
            return;
        }
        
        console.log(`🔧 [DEBUG] Display #${displayId} continuing - not superseded`);
        
        // Check if this request is still the current one
        if (requestController && requestController !== this.currentFetchController) {
            console.log(`🚫 Discarding results from old request #${requestController.fetchId || 'unknown'}`);
            return;
        }
        
        // Also check if the controller was aborted
        if (requestController && requestController.signal.aborted) {
            console.log(`🚫 Discarding results from aborted request #${requestController.fetchId || 'unknown'}`);
            return;
        }
        
        // Store PRs for filtering
        this.allPRs = prs;
        
        const prList = document.getElementById('pr-list');
        prList.innerHTML = '';
        
        // Create a loading placeholder that will move with each PR being processed
        const loadingPlaceholder = document.createElement('div');
        loadingPlaceholder.id = 'pr-loading-placeholder';
        loadingPlaceholder.className = 'pr-item loading-placeholder';
        loadingPlaceholder.innerHTML = `
            <div class="pr-header">
                <div class="loading-spinner"></div>
                <span>Loading pull requests...</span>
            </div>
        `;
        prList.appendChild(loadingPlaceholder);
        

        if (prs.length === 0) {
            prList.innerHTML = '<div class="no-prs">No open pull requests found</div>';
            return;
        }

        // Get current filter values
        const repoQuery = document.getElementById('repo-filter').value.toLowerCase();
        const ageCutoffDate = this.getAgeCutoffDate();
        
        // Pre-calculate how many PRs will pass the filters
        const filteredPRs = prs.filter(pr => {
            const matchesRepoFilter = !repoQuery || pr.repo.toLowerCase().includes(repoQuery);
            const prUpdatedDate = new Date(pr.updated_at);
            const matchesAgeFilter = !ageCutoffDate || prUpdatedDate >= ageCutoffDate;
            return matchesRepoFilter && matchesAgeFilter;
        });
        
        // Hide the main loading spinner now that we're showing detailed progress (only if still current and not auto-refresh)
        if (this.currentDisplayId === displayId && !isAutoRefresh) {
            console.log(`🔧 [DEBUG] Display #${displayId} hiding main loading spinner`);
            this.showLoading(false);
        } else if (this.currentDisplayId === displayId && isAutoRefresh) {
            console.log(`🔧 [DEBUG] Display #${displayId} skipping loading spinner hide (auto-refresh)`);
        } else {
            console.log(`🔧 [DEBUG] Display #${displayId} NOT hiding loading spinner - superseded by #${this.currentDisplayId}`);
        }
        
        let processedCount = 0;
        for (let i = 0; i < prs.length; i++) {
            const pr = prs[i];
            
            // Check if PR passes filters before creating element
            const matchesRepoFilter = !repoQuery || pr.repo.toLowerCase().includes(repoQuery);
            const prUpdatedDate = new Date(pr.updated_at);
            const matchesAgeFilter = !ageCutoffDate || prUpdatedDate >= ageCutoffDate;
            
            // Only update loading placeholder for PRs that will be processed
            if (matchesRepoFilter && matchesAgeFilter) {
                processedCount++;
                const currentLoadingPlaceholder = document.getElementById('pr-loading-placeholder');
                if (currentLoadingPlaceholder) {
                    currentLoadingPlaceholder.innerHTML = `
                        <div class="pr-header">
                            <div class="loading-spinner"></div>
                            <span>Loading "${pr.title}" (${processedCount}/${filteredPRs.length})...</span>
                        </div>
                    `;
                }
            }
            
            if (matchesRepoFilter && matchesAgeFilter) {
                console.log(`🔧 [DEBUG] Display #${displayId} creating element for PR: ${pr.title}`);
                const prElement = await this.createPRElement(pr, isAutoRefresh);
                console.log(`🔧 [DEBUG] Display #${displayId} created element for PR: ${pr.title}`);
                
                // Check if this display was superseded while creating the element
                if (this.currentDisplayId !== displayId) {
                    console.log(`🚫 Display #${displayId} cancelled during PR creation`);
                    // Don't remove placeholder - it might belong to the newer display
                    return;
                }
                
                // Insert the PR element before the loading placeholder
                const placeholder = document.getElementById('pr-loading-placeholder');
                if (placeholder) {
                    prList.insertBefore(prElement, placeholder);
                } else {
                    prList.appendChild(prElement);
                }
                visibleCount++;
                
                // Hide main loading spinner when first PR is added (only if still current)
                if (visibleCount === 1 && this.currentDisplayId === displayId) {
                    this.showLoading(false);
                }
                
                // Debug: Log EVERY PR being added when age filter is active
                if (ageCutoffDate) {
                    const daysDiff = Math.round((new Date() - prUpdatedDate) / (1000 * 60 * 60 * 24));
                    console.log(`✅ Adding PR: "${pr.title}" (${daysDiff} days old, updated: ${pr.updated_at})`);
                    
                    // This should NEVER happen
                    if (prUpdatedDate < ageCutoffDate) {
                        console.error(`🚨 LOGIC BUG: Added old PR when age filter is active!`);
                    }
                }
            }
        }
        
        // Remove the loading placeholder when all PRs are processed
        const finalPlaceholder = document.getElementById('pr-loading-placeholder');
        if (finalPlaceholder) {
            finalPlaceholder.remove();
        }
        
        console.log(`🏁 END display #${displayId}: ${visibleCount} PRs added to DOM`);
        
        // Hide loading spinner if no PRs were added (only if this display is still current and not auto-refresh)
        if (visibleCount === 0 && this.currentDisplayId === displayId && !isAutoRefresh) {
            console.log(`🔧 [DEBUG] Display #${displayId} no PRs added, hiding loading and showing no-prs message`);
            this.showLoading(false);
            if (repoQuery || ageCutoffDate) {
                prList.innerHTML = '<div class="no-prs">No pull requests match the current filters</div>';
            } else {
                prList.innerHTML = '<div class="no-prs">No open pull requests found</div>';
            }
        } else {
            console.log(`🔧 [DEBUG] Display #${displayId} finished with ${visibleCount} PRs, currentDisplayId=${this.currentDisplayId}, isAutoRefresh=${isAutoRefresh}`);
        }
        
        } finally {
            console.log(`🔧 [DEBUG] Display #${displayId} finally block - setting displayInProgress=false`);
            this.displayInProgress = false;
        }
    }

    async createPRElement(pr, isAutoRefresh = false) {
        try {
            console.log(`🔧 [CREATE-PR] Starting createPRElement for ${pr.repo}#${pr.number}: ${pr.title}`);
            const prDiv = document.createElement('div');
            prDiv.className = 'pr-item';
            prDiv.dataset.repo = pr.repo.toLowerCase();
            prDiv.dataset.updatedAt = pr.updated_at;

            const cacheKey = `${pr.repo}#${pr.number}:${pr.updated_at}`;
            let checks, reviews, prDetails;

        // Use cache for auto-refresh if PR hasn't been updated
        if (isAutoRefresh && this.prCache.has(cacheKey)) {
            const cached = this.prCache.get(cacheKey);
            checks = cached.checks;
            reviews = cached.reviews;  
            prDetails = cached.prDetails;
        } else {
            // Fetch CI status, reviews, and PR details in parallel with error handling
            try {
                [checks, reviews, prDetails] = await Promise.all([
                    this.fetchPRChecks(pr.repo, pr.number),
                    this.fetchPRReviews(pr.repo, pr.number),
                    this.fetchPRDetails(pr.repo, pr.number)
                ]);
            } catch (error) {
                console.warn(`Error fetching data for ${pr.repo}#${pr.number}:`, error);
                // Use fallback values if API fails
                checks = { status: 'unknown', workflows: [], checkRuns: [] };
                reviews = { approvals: 0, total: 0 };
                prDetails = { mergeable: null, mergeable_state: 'unknown' };
            }
            
            // Cache the results and clean up old entries for this PR
            const prKey = `${pr.repo}#${pr.number}`;
            for (const key of this.prCache.keys()) {
                if (key.startsWith(prKey + ':') && key !== cacheKey) {
                    this.prCache.delete(key);
                }
            }
            this.prCache.set(cacheKey, { checks, reviews, prDetails });
        }
        
        const ciStatusIcon = this.getCIStatusIcon(checks.status);
        
        // Get failure reasons if needed and determine the best detail URL
        let failureReasonsHtml = '';
        let detailsUrl = `https://github.com/${pr.repo}/pull/${pr.number}/checks`;
        
        if (checks.status === 'failure') {
            const failureReasons = await this.getFailureReasons(checks);
            failureReasonsHtml = `
                <details class="failure-details">
                    <summary class="failure-summary">
                        <h4>Failed Checks (click to expand)</h4>
                    </summary>
                    <div class="failure-list">
                        ${failureReasons}
                    </div>
                </details>
            `;
            
            // Use the first failed workflow's basic URL without fetching detailed failure info
            if (checks.workflows) {
                const failedWorkflow = checks.workflows.find(w => w.conclusion === 'failure');
                if (failedWorkflow) {
                    detailsUrl = failedWorkflow.html_url;
                }
            }
        }
        
        prDiv.innerHTML = `
            <div class="pr-header">
                <div class="pr-info">
                    <h3 class="pr-title">
                        <a href="${pr.html_url}" target="_blank">${pr.title}</a>
                    </h3>
                    <div class="pr-meta">
                        <span class="repo-name">${pr.repo}</span>
                        <span class="pr-number">#${pr.number}</span>
                        <span class="pr-author">by ${pr.user.login}</span>
                        <span class="pr-approvals">✅ ${reviews.approvals} approval${reviews.approvals !== 1 ? 's' : ''}</span>
                        ${this.getMergeableStatusIcon(prDetails.mergeable, prDetails.mergeable_state, reviews.approvals, checks.status)}
                        <span class="pr-updated">updated ${new Date(pr.updated_at).toLocaleDateString()}</span>
                    </div>
                </div>
                <div class="pr-status">
                    ${ciStatusIcon}
                    <div class="pr-actions">
                        ${checks.status === 'failure' && this.authMethod === 'token' ? `
                            <button class="btn btn-restart" onclick="tracker.restartFailedChecks('${pr.repo}', ${pr.number})">
                                Restart Failed CI
                            </button>
                        ` : ''}
                        ${checks.status === 'failure' && this.authMethod === 'oauth' ? `
                            <button class="btn btn-secondary" style="cursor: not-allowed; opacity: 0.6;" title="Restart functionality requires Personal Access Token authentication">
                                Restart Not Available
                            </button>
                        ` : ''}
                        <a href="${detailsUrl}" target="_blank" class="btn btn-details">
                            View Details
                        </a>
                    </div>
                </div>
            </div>
            ${checks.status === 'failure' || checks.status === 'pending' ? `
                <div class="failure-reasons">
                    ${failureReasonsHtml}
                    ${this.hasRunningChecks(checks) ? `
                        <details class="failure-details" style="margin-top: 10px;">
                            <summary class="failure-summary" style="color: #bf8700;">
                                <h4>Running Checks (click to expand)</h4>
                            </summary>
                            <div class="failure-list">
                                ${this.getRunningChecks(checks)}
                            </div>
                        </details>
                    ` : ''}
                </div>
            ` : ''}
        `;

            console.log(`🔧 [CREATE-PR] Completed createPRElement for ${pr.repo}#${pr.number}: ${pr.title}`);
            return prDiv;
        } catch (error) {
            console.error(`❌ [CREATE-PR] Error creating PR element for ${pr.repo}#${pr.number}:`, error);
            console.error('PR object:', pr);
            throw error;
        }
    }

    getCIStatusIcon(status) {
        const icons = {
            'success': '<span class="status-icon success">✅</span>',
            'failure': '<span class="status-icon failure">❌</span>',
            'pending': '<span class="status-icon pending">🟡</span>',
            'unknown': '<span class="status-icon unknown">❓</span>'
        };
        return icons[status] || icons['unknown'];
    }

    async getFailureReasons(checkData) {
        const failedItems = [];
        
        // Add failed check runs
        if (checkData.runs) {
            checkData.runs.forEach(run => {
                if (run.conclusion === 'failure') {
                    failedItems.push({
                        type: 'check_run',
                        name: run.name,
                        summary: run.output?.summary || 'No summary available',
                        url: run.html_url
                    });
                }
            });
        }
        
        // Add failed commit statuses
        if (checkData.statuses) {
            checkData.statuses.forEach(status => {
                if (status.state === 'failure' || status.state === 'error') {
                    failedItems.push({
                        type: 'status',
                        name: status.context,
                        summary: status.description || 'No description available',
                        url: status.target_url
                    });
                }
            });
        }
        
        // Add failed/cancelled workflow runs
        if (checkData.workflows) {
            for (const workflow of checkData.workflows) {
                if (workflow.conclusion === 'failure' || workflow.conclusion === 'cancelled') {
                    // Skip cancelled workflows due to higher priority requests
                    if (workflow.conclusion === 'cancelled') {
                        const isHigherPriority = this.isCancelledForHigherPriority(workflow);
                        console.log(`Workflow "${workflow.name}" (${workflow.id}): cancelled=${workflow.conclusion === 'cancelled'}, higherPriority=${isHigherPriority}, display_title="${workflow.display_title}"`);
                        if (isHigherPriority) {
                            console.log(`Skipping workflow "${workflow.name}" due to higher priority cancellation`);
                            continue;
                        }
                    }
                    
                    let summary = '';
                    let detailUrl = workflow.html_url;
                    
                    if (workflow.conclusion === 'cancelled') {
                        summary = `Workflow was cancelled`;
                    } else if (workflow.conclusion === 'failure') {
                        // Use basic failure information without fetching detailed job info
                        summary = `Workflow "${workflow.name}" failed`;
                        detailUrl = workflow.html_url;
                    }
                    
                    failedItems.push({
                        type: 'workflow',
                        name: workflow.name,
                        summary: summary,
                        url: detailUrl,
                        duration: this.calculateWorkflowDuration(workflow.created_at, workflow.updated_at),
                        conclusion: workflow.conclusion,
                        event: workflow.event
                    });
                }
            }
        }
        
        if (failedItems.length === 0) return '<p>No failure details available</p>';
        
        return failedItems.map(item => `
            <div class="failure-item">
                <strong>${item.name}</strong>
                <p>${item.summary}</p>
                ${item.url ? `<a href="${item.url}" target="_blank">View details</a>` : ''}
            </div>
        `).join('');
    }

    hasRunningChecks(checkData) {
        // Check if there are any running/pending/queued checks
        let hasRunning = false;
        
        // Check running check runs
        if (checkData.runs) {
            hasRunning = checkData.runs.some(run => 
                run.status === 'in_progress' || run.status === 'queued' || run.status === 'pending'
            );
        }
        
        // Check running workflows
        if (!hasRunning && checkData.workflows) {
            hasRunning = checkData.workflows.some(workflow => 
                workflow.status === 'in_progress' || workflow.status === 'queued' || workflow.status === 'pending'
            );
        }
        
        return hasRunning;
    }

    getRunningChecks(checkData) {
        const runningItems = [];
        
        // Add running check runs
        if (checkData.runs) {
            checkData.runs.forEach(run => {
                if (run.status === 'in_progress' || run.status === 'queued' || run.status === 'pending') {
                    let summary = `Status: ${run.status}`;
                    if (run.status === 'in_progress') {
                        summary = 'Currently running...';
                    } else if (run.status === 'queued') {
                        summary = 'Queued and waiting to start';
                    } else if (run.status === 'pending') {
                        summary = 'Pending execution';
                    }
                    
                    runningItems.push({
                        type: 'check_run',
                        name: run.name,
                        summary: summary,
                        url: run.html_url,
                        status: run.status
                    });
                }
            });
        }
        
        // Add running workflows
        if (checkData.workflows) {
            checkData.workflows.forEach(workflow => {
                if (workflow.status === 'in_progress' || workflow.status === 'queued' || workflow.status === 'pending') {
                    let summary = `Status: ${workflow.status}`;
                    if (workflow.status === 'in_progress') {
                        const duration = this.calculateWorkflowDuration(workflow.created_at, new Date().toISOString());
                        summary = `Running for ${duration}`;
                    } else if (workflow.status === 'queued') {
                        summary = 'Queued and waiting to start';
                    } else if (workflow.status === 'pending') {
                        summary = 'Pending execution';
                    }
                    
                    // Add triggering event context if available
                    if (workflow.event) {
                        summary += ` (triggered by ${workflow.event})`;
                    }
                    
                    runningItems.push({
                        type: 'workflow',
                        name: workflow.name,
                        summary: summary,
                        url: workflow.html_url,
                        status: workflow.status
                    });
                }
            });
        }
        
        return runningItems.map(item => `
            <div class="failure-item" style="border-left-color: #bf8700; background-color: #fffdf0;">
                <strong>${item.name}</strong>
                <p>${item.summary}</p>
                ${item.url ? `<a href="${item.url}" target="_blank">View details</a>` : ''}
            </div>
        `).join('');
    }

    calculateWorkflowDuration(startTime, endTime) {
        if (!startTime || !endTime) return 'unknown duration';
        
        const start = new Date(startTime);
        const end = new Date(endTime);
        const diffMs = end - start;
        
        const diffMinutes = Math.floor(diffMs / 60000);
        const diffSeconds = Math.floor((diffMs % 60000) / 1000);
        
        if (diffMinutes > 0) {
            return diffSeconds > 0 ? `${diffMinutes}m ${diffSeconds}s` : `${diffMinutes}m`;
        } else {
            return `${diffSeconds}s`;
        }
    }

    async showCheckDetails(repoFullName, prNumber) {
        try {
            const checks = await this.fetchPRChecks(repoFullName, prNumber);
            const modal = this.createModal(`Check Details for PR #${prNumber}`, this.formatCheckDetails(checks));
            document.body.appendChild(modal);
        } catch (error) {
            this.showError('Failed to load check details: ' + error.message);
        }
    }

    formatCheckDetails(checks) {
        const details = [];
        
        // Add check runs
        if (checks.runs && checks.runs.length > 0) {
            checks.runs.forEach(run => {
                details.push(`
                    <div class="check-detail">
                        <h4>${run.name} ${this.getCIStatusIcon(run.conclusion || run.status)} <span class="check-type">Check Run</span></h4>
                        <p><strong>Status:</strong> ${run.status}</p>
                        <p><strong>Conclusion:</strong> ${run.conclusion || 'N/A'}</p>
                        <p><strong>Started:</strong> ${run.started_at ? new Date(run.started_at).toLocaleString() : 'N/A'}</p>
                        <p><strong>Completed:</strong> ${run.completed_at ? new Date(run.completed_at).toLocaleString() : 'N/A'}</p>
                        ${run.output?.summary ? `<p><strong>Summary:</strong> ${run.output.summary}</p>` : ''}
                        ${run.html_url ? `<a href="${run.html_url}" target="_blank" class="btn btn-small">View Full Log</a>` : ''}
                    </div>
                `);
            });
        }
        
        // Add commit statuses
        if (checks.statuses && checks.statuses.length > 0) {
            checks.statuses.forEach(status => {
                details.push(`
                    <div class="check-detail">
                        <h4>${status.context} ${this.getCIStatusIcon(status.state)} <span class="check-type">Status Check</span></h4>
                        <p><strong>State:</strong> ${status.state}</p>
                        <p><strong>Description:</strong> ${status.description || 'N/A'}</p>
                        <p><strong>Updated:</strong> ${status.updated_at ? new Date(status.updated_at).toLocaleString() : 'N/A'}</p>
                        ${status.target_url ? `<a href="${status.target_url}" target="_blank" class="btn btn-small">View Details</a>` : ''}
                    </div>
                `);
            });
        }
        
        // Add workflow runs
        if (checks.workflows && checks.workflows.length > 0) {
            checks.workflows.forEach(workflow => {
                details.push(`
                    <div class="check-detail">
                        <h4>${workflow.name} ${this.getCIStatusIcon(workflow.conclusion || workflow.status)}</h4>
                        <p><strong>Status:</strong> ${workflow.status}</p>
                        <p><strong>Conclusion:</strong> ${workflow.conclusion || 'N/A'}</p>
                        <p><strong>Started:</strong> ${workflow.created_at ? new Date(workflow.created_at).toLocaleString() : 'N/A'}</p>
                        <p><strong>Updated:</strong> ${workflow.updated_at ? new Date(workflow.updated_at).toLocaleString() : 'N/A'}</p>
                        ${workflow.html_url ? `<a href="${workflow.html_url}" target="_blank" class="btn btn-small">View Workflow</a>` : ''}
                    </div>
                `);
            });
        }
        
        if (details.length === 0) {
            return '<p>No checks found</p>';
        }
        
        return details.join('<hr>');
    }

    createModal(title, content) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>${title}</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    ${content}
                </div>
            </div>
        `;

        modal.querySelector('.modal-close').addEventListener('click', () => {
            document.body.removeChild(modal);
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
            }
        });

        return modal;
    }

    getCurrentFilterState() {
        return {
            repoQuery: document.getElementById('repo-filter').value.toLowerCase(),
            ageFilterDays: parseInt(document.getElementById('age-filter').value)
        };
    }
    
    filtersChanged(oldState, newState) {
        return oldState.repoQuery !== newState.repoQuery || 
               oldState.ageFilterDays !== newState.ageFilterDays;
    }

    async checkMergeQueueStatus(prs, signal, user) {
        // Check auto-merge status for each PR using GraphQL and filter results
        const filteredPRs = [];
        
        for (const pr of prs) {
            if (signal && signal.aborted) return [];
            
            try {
                // Extract repo owner and name from repository URL
                const repoMatch = pr.repository_url.match(/repos\/([^\/]+)\/([^\/]+)$/);
                if (!repoMatch) continue;
                
                const [, owner, repo] = repoMatch;
                
                // Use GraphQL to check if this PR has auto-merge enabled
                const graphqlQuery = {
                    query: `
                        query($owner: String!, $repo: String!, $number: Int!) {
                            repository(owner: $owner, name: $repo) {
                                pullRequest(number: $number) {
                                    autoMergeRequest {
                                        enabledAt
                                        enabledBy {
                                            login
                                        }
                                        mergeMethod
                                    }
                                }
                            }
                        }
                    `,
                    variables: {
                        owner: owner,
                        repo: repo,
                        number: pr.number
                    }
                };
                
                const response = await fetch('/api/github-graphql', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                    body: JSON.stringify(graphqlQuery),
                    signal: signal
                });
                
                if (response.ok) {
                    const data = await response.json();
                    const autoMergeRequest = data.data?.repository?.pullRequest?.autoMergeRequest;
                    
                    // Determine if we should include this PR
                    const isMyPR = pr.user.login === user.login;
                    const iEnabledMergeWhenReady = autoMergeRequest && autoMergeRequest.enabledBy.login === user.login;
                    
                    console.log(`🔍 [DEBUG] PR #${pr.number} by ${pr.user.login}:`);
                    console.log(`  - isMyPR: ${isMyPR} (${pr.user.login} === ${user.login})`);
                    console.log(`  - autoMergeRequest: ${!!autoMergeRequest}`);
                    if (autoMergeRequest) {
                        console.log(`  - enabledBy: ${autoMergeRequest.enabledBy.login}`);
                        console.log(`  - iEnabledMergeWhenReady: ${iEnabledMergeWhenReady}`);
                    }
                    
                    if (isMyPR || iEnabledMergeWhenReady) {
                        if (autoMergeRequest) {
                            pr.autoMergeRequest = autoMergeRequest;
                            pr.hasMergeWhenReady = true;
                            console.log(`🎯 [MERGE_WHEN_READY] PR #${pr.number} has "merge when ready" enabled by ${autoMergeRequest.enabledBy.login}`);
                        }
                        filteredPRs.push(pr);
                        console.log(`✅ [FILTER] Including PR #${pr.number}: ${isMyPR ? 'my PR' : ''} ${iEnabledMergeWhenReady ? 'I enabled merge when ready' : ''}`);
                    } else {
                        console.log(`🚫 [FILTER] Excluding PR #${pr.number}: not my PR and I didn't enable merge when ready`);
                    }
                } else {
                    // If we can't check merge status, include it if it's the user's PR
                    if (pr.user.login === user.login) {
                        filteredPRs.push(pr);
                        console.log(`✅ [FILTER] Including PR #${pr.number}: my PR (couldn't check merge status)`);
                    }
                    console.warn(`⚠️ [MERGE_WHEN_READY] Failed to check auto-merge for PR #${pr.number}: ${response.status}`);
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    // If we can't check merge status, include it if it's the user's PR
                    if (pr.user.login === user.login) {
                        filteredPRs.push(pr);
                        console.log(`✅ [FILTER] Including PR #${pr.number}: my PR (error checking merge status)`);
                    }
                    console.warn(`⚠️ [MERGE_WHEN_READY] Error checking auto-merge for PR #${pr.number}:`, error.message);
                }
            }
        }
        
        return filteredPRs;
    }

    applyFilters() {
        const ageFilterDays = parseInt(document.getElementById('age-filter').value);
        console.log(`🔄 applyFilters called: ageFilter=${ageFilterDays} days`);
        
        // Cancel any ongoing fetch to prevent race conditions
        if (this.currentFetchController && !this.currentFetchController.signal.aborted) {
            console.log(`🚫 applyFilters: Aborting fetch #${this.currentFetchController.fetchId}`);
            this.currentFetchController.abort();
        } else if (this.currentFetchController && this.currentFetchController.signal.aborted) {
            console.log(`🧹 applyFilters: Clearing aborted controller #${this.currentFetchController.fetchId}`);
            this.currentFetchController = null;
        }
        
        // Immediately clear the current display and show loading
        const prList = document.getElementById('pr-list');
        prList.innerHTML = '';
        this.showLoading(true);
        
        // Re-render PRs with current filters
        if (this.allPRs) {
            // Use setTimeout to ensure loading spinner is visible before starting display
            setTimeout(() => {
                // Make sure we still show loading in case it was hidden by a cancelled operation
                this.showLoading(true);
                this.displayPullRequests(this.allPRs, null, false);
            }, 10);
        }
    }

    // Keep the old method for backward compatibility
    filterPRs(query) {
        document.getElementById('repo-filter').value = query;
        this.applyFilters();
    }

    showUserInfo(user) {
        document.getElementById('user-avatar').src = user.avatar_url;
        document.getElementById('username').textContent = user.login;
        document.getElementById('user-info').classList.remove('hidden');
        document.getElementById('login-btn').classList.add('hidden');
        document.getElementById('token-login-btn').classList.add('hidden');
    }

    hideUserInfo() {
        document.getElementById('user-info').classList.add('hidden');
        document.getElementById('login-btn').classList.remove('hidden');
    }

    showMainContent() {
        document.getElementById('main-content').classList.remove('hidden');
    }

    hideMainContent() {
        document.getElementById('main-content').classList.add('hidden');
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (show) {
            loading.classList.remove('hidden');
        } else {
            loading.classList.add('hidden');
        }
    }

    showError(message) {
        const errorDiv = document.getElementById('error-message');
        errorDiv.textContent = message;
        errorDiv.classList.remove('hidden');
        setTimeout(() => errorDiv.classList.add('hidden'), 5000);
    }

    showSuccess(message) {
        const errorDiv = document.getElementById('error-message');
        errorDiv.textContent = message;
        errorDiv.className = 'success';
        errorDiv.classList.remove('hidden');
        setTimeout(() => {
            errorDiv.classList.add('hidden');
            errorDiv.className = 'error hidden';
        }, 3000);
    }

    showTokenModal() {
        const modal = document.getElementById('token-modal');
        const tokenInput = document.getElementById('token-input');
        const tokenSubmit = document.getElementById('token-submit');
        const tokenCancel = document.getElementById('token-cancel');
        const tokenClose = document.getElementById('token-modal-close');
        
        modal.classList.remove('hidden');
        tokenInput.value = '';
        tokenInput.focus();
        
        const handleSubmit = async () => {
            const token = tokenInput.value.trim();
            if (!token) {
                this.showError('Please enter a token');
                return;
            }
            
            // Basic token format validation
            if (!token.startsWith('github_pat_') && !token.startsWith('ghp_')) {
                this.showError('Token should start with "github_pat_" (fine-grained) or "ghp_" (classic)');
                return;
            }
            
            try {
                // Validate the token by trying to fetch user info
                this.accessToken = token;
                const user = await this.fetchUser();
                
                // If we get here, the token is valid
                await this.setAuthToken(token, 'token');
                this.hideTokenModal();
                this.showUserInfo(user);
                this.showMainContent();
                console.log('🏗️ [TOKEN] Setting up page visibility detection');
                document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
                console.log('🏗️ [TOKEN] Calling initial fetchPullRequests after token auth');
                this.fetchPullRequests(false);
                this.showSuccess('Successfully authenticated with Personal Access Token');
                
            } catch (error) {
                console.error('Token validation failed:', error);
                this.accessToken = null;
                
                // Provide more specific error messages
                let errorMessage = 'Token validation failed';
                if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                    errorMessage = 'Invalid token - check that your token is correct';
                } else if (error.message.includes('403') || error.message.includes('Forbidden')) {
                    errorMessage = 'Insufficient permissions - token needs "Pull requests" and "Metadata" read access';
                } else if (error.message.includes('NetworkError') || error.message.includes('fetch')) {
                    errorMessage = 'Network error - check your connection and try again';
                } else {
                    errorMessage = `Token validation failed: ${error.message}`;
                }
                
                this.showError(errorMessage);
            }
        };
        
        const handleClose = () => {
            this.hideTokenModal();
        };
        
        // Add event listeners
        tokenSubmit.addEventListener('click', handleSubmit);
        tokenCancel.addEventListener('click', handleClose);
        tokenClose.addEventListener('click', handleClose);
        
        // Handle Enter key
        tokenInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                handleSubmit();
            }
        });
        
        // Handle modal backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                handleClose();
            }
        });
    }
    
    hideTokenModal() {
        const modal = document.getElementById('token-modal');
        modal.classList.add('hidden');
        
        // Clean up event listeners to prevent duplicates
        const tokenSubmit = document.getElementById('token-submit');
        const tokenCancel = document.getElementById('token-cancel');
        const tokenClose = document.getElementById('token-modal-close');
        const tokenInput = document.getElementById('token-input');
        
        // Clone and replace elements to remove all event listeners
        tokenSubmit.replaceWith(tokenSubmit.cloneNode(true));
        tokenCancel.replaceWith(tokenCancel.cloneNode(true));
        tokenClose.replaceWith(tokenClose.cloneNode(true));
        tokenInput.replaceWith(tokenInput.cloneNode(true));
        
        // Remove modal backdrop listener
        modal.replaceWith(modal.cloneNode(true));
    }

    toggleAutoRefresh() {
        const autoRefreshCheckbox = document.getElementById('auto-refresh');
        this.autoRefreshEnabled = autoRefreshCheckbox.checked;
        
        if (this.autoRefreshEnabled) {
            this.startAutoRefresh();
        } else {
            this.stopAutoRefresh();
        }
    }

    startAutoRefresh() {
        this.stopAutoRefresh(); // Clear any existing interval
        
        if (!this.autoRefreshEnabled) {
            console.log('⏸️ Auto-refresh disabled, not starting');
            return;
        }
        
        const intervalSelect = document.getElementById('refresh-interval');
        const intervalSeconds = parseInt(intervalSelect.value);
        
        console.log(`🔄 Starting auto-refresh every ${intervalSeconds} seconds (interval value: "${intervalSelect.value}")`);
        
        this.autoRefreshInterval = setInterval(() => {
            const now = new Date().toLocaleTimeString();
            console.log(`🔄 [${now}] Auto-refresh check: hidden=${document.hidden}, isRefreshing=${this.isRefreshing}, displayInProgress=${this.displayInProgress}`);
            
            // Only refresh if page is visible and not already refreshing
            if (!document.hidden && !this.isRefreshing && !this.displayInProgress) {
                console.log(`✅ [${now}] Auto-refresh triggered - fetching PRs`);
                this.fetchPullRequests(true);
            } else {
                console.log(`⏸️ [${now}] Auto-refresh skipped`);
            }
        }, intervalSeconds * 1000);
    }

    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            console.log('🛑 Stopping auto-refresh');
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
    }

    handleVisibilityChange() {
        try {
            console.log(`👁️ [VISIBILITY] Page visibility changed: hidden=${document.hidden}`);
            
            // Don't do anything if we're not properly initialized or authenticated
            if (!this.accessToken) {
                console.log(`👁️ [VISIBILITY] Skipping - not authenticated yet`);
                return;
            }
            
            if (document.hidden) {
                // Page is now hidden, pause auto-refresh
                console.log(`👁️ [VISIBILITY] Page hidden - stopping auto-refresh`);
                this.stopAutoRefresh();
            } else {
                // Page is now visible, resume auto-refresh if enabled
                console.log(`👁️ [VISIBILITY] Page visible - autoRefreshEnabled=${this.autoRefreshEnabled}`);
                if (this.autoRefreshEnabled) {
                    this.startAutoRefresh();
                    // Skip immediate refresh to avoid network errors during page load
                    console.log(`👁️ [VISIBILITY] Page returned to focus - auto-refresh will handle updates`);
                }
            }
        } catch (error) {
            console.error('❌ [VISIBILITY] Error in handleVisibilityChange:', error);
        }
    }

    showRefreshStatus(show) {
        const refreshIndicator = document.getElementById('refresh-indicator');
        if (!refreshIndicator) {
            // Element doesn't exist, ignore silently
            return;
        }
        if (show) {
            refreshIndicator.classList.remove('hidden');
        } else {
            refreshIndicator.classList.add('hidden');
        }
    }

    async getWorkflowFailureDetails(workflow) {
        // Return basic failure info without fetching detailed job information
        // This eliminates the expensive job logs API calls that were causing performance issues
        return { 
            text: `Workflow "${workflow.name}" failed`,
            url: workflow.html_url 
        };
    }

    isCancelledForHigherPriority(workflow) {
        // Check if workflow was cancelled due to higher priority request
        // Use only workflow metadata to avoid expensive API calls
        
        // Pattern for the exact message we see in GitHub Actions
        const higherPriorityPattern = /canceling since a higher priority.*request.*exists/i;
        
        // Check workflow display_title which often contains the cancellation message
        if (workflow.display_title && higherPriorityPattern.test(workflow.display_title)) {
            return true;
        }
        
        // Check workflow name as fallback
        if (workflow.name && higherPriorityPattern.test(workflow.name)) {
            return true;
        }
        
        // For performance, assume other cancelled workflows are not higher priority cancellations
        // This avoids making expensive API calls for job details and annotations
        return false;
    }

}

// Initialize the tracker when the page loads
let tracker;
console.log('🚀 [STARTUP] GitHub PR Tracker script loaded - v7');
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 [STARTUP] DOM loaded, initializing tracker');
    tracker = new GitHubPRTracker();
    console.log('🚀 [STARTUP] GitHubPRTracker initialized');
});