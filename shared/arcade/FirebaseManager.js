// shared/arcade/FirebaseManager.js
// Manages Firebase initialization and bridges Supabase authentication

class FirebaseManager {
    constructor() {
        this.app = null;
        this.db = null;
        this.auth = null;
        this.supabaseUserId = null;
        this.supabaseUserProfile = null;
        this.firebaseUser = null;
        this.initialized = false;
        this.connectionRef = null;
        this.presenceRef = null;
        this._connectionListeners = [];
        this._isConnected = false;
    }

    /**
     * Initialize Firebase and bridge with Supabase auth
     * @param {Object} config - Firebase config object
     * @returns {Promise<FirebaseManager>}
     */
    async initialize(config) {
        if (this.initialized) return this;

        try {
            // Load Firebase SDKs if not already loaded
            await this._loadFirebaseSDK();

            // Check if config is valid
            if (!config || config.apiKey === "YOUR_API_KEY_HERE") {
                console.warn('Firebase not configured. Running in offline mode.');
                this.initialized = true;
                return this;
            }

            // Initialize Firebase app
            if (!firebase.apps.length) {
                this.app = firebase.initializeApp(config);
            } else {
                this.app = firebase.apps[0];
            }

            this.db = firebase.database();
            this.auth = firebase.auth();

            // Bridge Supabase auth
            await this._bridgeSupabaseAuth();

            // Set up presence system
            this._setupPresence();

            // Set up connection state monitoring
            this._setupConnectionMonitoring();

            this.initialized = true;
            console.log('FirebaseManager initialized successfully');

        } catch (error) {
            console.error('FirebaseManager initialization failed:', error);
            throw error;
        }

        return this;
    }

    /**
     * Load Firebase SDK scripts dynamically
     */
    async _loadFirebaseSDK() {
        if (typeof firebase !== 'undefined') return;

        const scripts = [
            'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
            'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js',
            'https://www.gstatic.com/firebasejs/10.7.1/firebase-database-compat.js'
        ];

        for (const src of scripts) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = src;
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }
    }

    /**
     * Bridge Supabase authentication to Firebase
     * Uses anonymous auth with supabase_user_id stored in profile
     */
    async _bridgeSupabaseAuth() {
        // Check for PortalAuth
        if (!window.portalAuth) {
            throw new Error('PortalAuth not initialized. Please initialize Supabase auth first.');
        }

        // Wait for Supabase auth to be ready
        if (!window.portalAuth.initialized) {
            await window.portalAuth.initialize();
        }

        const supabaseUser = window.portalAuth.currentUser;
        const supabaseProfile = window.portalAuth.userProfile;

        if (!supabaseUser) {
            throw new Error('User not authenticated with Supabase');
        }

        this.supabaseUserId = supabaseUser.id;
        this.supabaseUserProfile = supabaseProfile;

        // Sign in to Firebase AS this student.
        //
        // This used to be signInAnonymously(), which gave Firebase a throwaway
        // uid unrelated to the student - while every security rule is written
        // as `auth.uid == $supabase_uid`. Those can never match, so every
        // identity-scoped write was refused and the only way to make the arcade
        // work at all was to delete the checks.
        //
        // For a duelling game that is not acceptable: without identity, any
        // signed-in student can write into someone else's match and award
        // themselves the win. So the token is minted server-side with
        // uid = the Supabase user id, and the rules become true instead of
        // being removed.
        await this.signInWithPortalIdentity();

        // Listen for Supabase auth changes
        window.addEventListener('portalAuthChange', (event) => {
            if (event.detail === 'SIGNED_OUT') {
                this._handleSupabaseSignOut();
            } else if (event.detail === 'SIGNED_IN') {
                this._handleSupabaseSignIn();
            }
        });
    }

    /**
     * Handle Supabase sign out - clean up Firebase
     */
    async _handleSupabaseSignOut() {
        try {
            // Set offline status
            if (this.presenceRef && this.supabaseUserId) {
                await this.presenceRef.update({ status: 'offline', last_seen: firebase.database.ServerValue.TIMESTAMP });
            }

            // Sign out of Firebase
            await this.auth.signOut();

            this.supabaseUserId = null;
            this.supabaseUserProfile = null;
            this.firebaseUser = null;

            console.log('Firebase signed out due to Supabase sign out');
        } catch (error) {
            console.error('Error handling Supabase sign out:', error);
        }
    }

    /**
     * Exchange the portal session for a Firebase session with the SAME identity.
     *
     * The private key never reaches the browser. The browser sends its Supabase
     * JWT, the edge function decides who that is, and only then signs a token
     * naming them - so a student cannot ask for someone else's identity.
     */
    async signInWithPortalIdentity() {
        const session = window.portalAuth?.supabase
            ? (await window.portalAuth.supabase.auth.getSession())?.data?.session
            : null;
        if (!session?.access_token) {
            throw new Error('No portal session - cannot sign in to the arcade');
        }

        const resp = await fetch(
            'https://joxvhzxkrcigknsdrusr.supabase.co/functions/v1/firebase-token',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`
                }
            }
        );

        const result = await resp.json().catch(() => ({}));
        if (!resp.ok || !result.token) {
            // Said plainly, because the usual cause is configuration rather
            // than anything the student did.
            throw new Error(result.error || 'The arcade could not verify who you are.');
        }

        const cred = await this.auth.signInWithCustomToken(result.token);
        this.firebaseUser = cred.user;

        // The identity Firebase now reports must be the one the paths are keyed
        // by. If these ever disagree, every rule silently stops matching and
        // the arcade fails in ways that look like anything but this.
        if (this.firebaseUser.uid !== this.supabaseUserId) {
            throw new Error('Arcade identity mismatch - refusing to continue.');
        }

        console.log('Firebase signed in as portal user', this.firebaseUser.uid);
        return this.firebaseUser;
    }

    /**
     * Handle Supabase sign in - re-initialize Firebase
     */
    async _handleSupabaseSignIn() {
        try {
            const supabaseUser = window.portalAuth.currentUser;
            const supabaseProfile = window.portalAuth.userProfile;

            if (supabaseUser) {
                this.supabaseUserId = supabaseUser.id;
                this.supabaseUserProfile = supabaseProfile;

                // Re-auth with Firebase if needed. Same identity as above -
                // signing back in anonymously here would quietly undo it.
                if (!this.firebaseUser || this.firebaseUser.uid !== this.supabaseUserId) {
                    await this.signInWithPortalIdentity();
                }

                // Update presence
                this._setupPresence();

                console.log('Firebase re-initialized after Supabase sign in');
            }
        } catch (error) {
            console.error('Error handling Supabase sign in:', error);
        }
    }

    /**
     * Set up presence system for online/offline status
     */
    _setupPresence() {
        if (!this.db || !this.supabaseUserId) return;

        this.presenceRef = this.db.ref(`arcade/players/${this.supabaseUserId}`);
        const connectedRef = this.db.ref('.info/connected');

        connectedRef.on('value', (snapshot) => {
            if (snapshot.val() === true) {
                // Set online status
                this.presenceRef.update({
                    status: 'online',
                    last_seen: firebase.database.ServerValue.TIMESTAMP
                });

                // Set offline status on disconnect
                this.presenceRef.onDisconnect().update({
                    status: 'offline',
                    last_seen: firebase.database.ServerValue.TIMESTAMP
                });
            }
        });
    }

    /**
     * Monitor connection state
     */
    _setupConnectionMonitoring() {
        if (!this.db) return;

        this.connectionRef = this.db.ref('.info/connected');
        this.connectionRef.on('value', (snapshot) => {
            this._isConnected = snapshot.val() === true;
            this._connectionListeners.forEach(cb => cb(this._isConnected));
        });
    }

    /**
     * Add connection state listener
     * @param {Function} callback - Called with (isConnected: boolean)
     */
    onConnectionChange(callback) {
        this._connectionListeners.push(callback);
        // Immediately call with current state
        callback(this._isConnected);
    }

    /**
     * Remove connection state listener
     */
    offConnectionChange(callback) {
        this._connectionListeners = this._connectionListeners.filter(cb => cb !== callback);
    }

    /**
     * Get database reference
     * @param {string} path - Database path
     * @returns {firebase.database.Reference}
     */
    ref(path) {
        if (!this.db) {
            console.warn('Firebase database not initialized');
            return null;
        }
        return this.db.ref(path);
    }

    /**
     * Get player-specific database reference
     * @param {string} path - Path relative to player's data
     * @returns {firebase.database.Reference}
     */
    playerRef(path) {
        if (!this.supabaseUserId) {
            console.warn('No user ID available');
            return null;
        }
        return this.ref(`arcade/players/${this.supabaseUserId}${path ? '/' + path : ''}`);
    }

    /**
     * Get game-specific database reference
     * @param {string} gameId - Game identifier
     * @param {string} path - Path relative to game data
     * @returns {firebase.database.Reference}
     */
    gameRef(gameId, path) {
        return this.ref(`arcade/games/${gameId}${path ? '/' + path : ''}`);
    }

    /**
     * Generate a unique ID
     * @returns {string}
     */
    generateId() {
        if (!this.db) return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        return this.db.ref().push().key;
    }

    /**
     * Get server timestamp value
     * @returns {Object}
     */
    get serverTimestamp() {
        return firebase.database.ServerValue.TIMESTAMP;
    }

    /**
     * Check if Firebase is configured and connected
     * @returns {boolean}
     */
    get isOnline() {
        return this.initialized && this._isConnected;
    }

    /**
     * Check if user is authenticated
     * @returns {boolean}
     */
    get isAuthenticated() {
        return !!this.supabaseUserId && !!this.firebaseUser;
    }

    /**
     * Get display name for current user (uses username field for game display)
     * @returns {string}
     */
    get displayName() {
        if (this.supabaseUserProfile) {
            // Use username field (specifically for game displays, not real names)
            if (this.supabaseUserProfile.username) {
                return this.supabaseUserProfile.username;
            }
            // Fall back to email prefix if no username set
            return this.supabaseUserProfile.email?.split('@')[0] || 'Player';
        }
        return 'Player';
    }

    /**
     * Clean up resources
     */
    destroy() {
        if (this.connectionRef) {
            this.connectionRef.off();
        }
        this._connectionListeners = [];

        if (this.presenceRef) {
            this.presenceRef.onDisconnect().cancel();
        }
    }
}

// Create global instance
window.FirebaseManager = FirebaseManager;

// Export for ES6 modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FirebaseManager };
}
