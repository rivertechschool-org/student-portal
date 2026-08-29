// shared/config.js
// Shared configuration and authentication manager for both portals

class PortalAuth {
    constructor() {
        this.supabase = null;
        this.currentUser = null;
        this.userProfile = null;
        this.config = {
            supabaseUrl: 'https://joxvhzxkrcigknsdrusr.supabase.co',
            supabaseKey: 'sb_publishable_xgvdFBaHCJKl9p-Lu61aZw_3oLkeTtc',
            mainPortalUrl: '../index.html',
            classesPortalUrl: './portal/',
            theme: {
                primary: '#6aa9ff',
                secondary: '#8bffb0',
                background: '#0f1216',
                cardBg: '#151a21',
                textColor: '#e6edf3',
                mutedColor: '#97a2b0',
                borderColor: '#2a3140',
                danger: '#ff6a6a',
                warning: '#ffd36a'
            }
        };
        this.initialized = false;
        this.initFailed = false;
    }

    async initialize() {
        if (this.initialized) return this;

        try {
            // Wait for Supabase to be available
            if (typeof supabase === 'undefined') {
                await this.loadSupabase();
            }

            this.supabase = supabase.createClient(this.config.supabaseUrl, this.config.supabaseKey, {
                auth: {
                    autoRefreshToken: true,
                    persistSession: true,
                    detectSessionInUrl: true,
                    // Bypass the Navigator LockManager. The default lock can
                    // deadlock when a tab is hidden mid-token-refresh, which
                    // freezes EVERY query behind it on tab return (the
                    // "frozen buttons" bug the old always-reload papered
                    // over). Tradeoff: rare multi-tab refresh races, which
                    // Supabase tolerates via its 10s token reuse window.
                    lock: async (_name, _acquireTimeout, fn) => await fn()
                }
            });

            // Check current session
            await this.checkCurrentSession();

            // Set up auth state listener and store the unsubscribe function
            this._setupAuthListener();

            this.initialized = true;
            console.log('✅ PortalAuth initialized');

        } catch (error) {
            console.error('❌ PortalAuth initialization failed:', error);
            // Mark failure so callers polling on `initialized` (waitForAuth)
            // can detect the terminal state instead of looping forever when
            // Supabase fails to load.
            this.initFailed = true;
        }

        return this;
    }

    _setupAuthListener() {
        // Clean up previous listener if exists
        if (this._authUnsubscribe) {
            this._authUnsubscribe();
            this._authUnsubscribe = null;
        }

        // DEADLOCK WARNING: this callback is dispatched while supabase-js
        // holds its internal auth lock. Any supabase call made (and awaited)
        // inside it queues behind that lock, which only releases when the
        // callback returns -> the call never resolves and EVERY query on the
        // page freezes behind it. SIGNED_IN re-fires on every tab return, so
        // this was the "frozen buttons after switching tabs" bug. Keep the
        // callback synchronous and defer supabase work with setTimeout(0).
        const { data: { subscription } } = this.supabase.auth.onAuthStateChange((event, session) => {
            console.log('🔐 Auth state changed:', event);

            if (event === 'PASSWORD_RECOVERY') {
                // User clicked password reset link - show reset form
                console.log('🔑 Password recovery mode detected');
                this.currentUser = session?.user || null;
                this.notifyAuthChange('PASSWORD_RECOVERY');
                this.showPasswordResetForm();
            } else if (event === 'SIGNED_IN' && session) {
                this.currentUser = session.user;
                setTimeout(() => {
                    this.loadUserProfile()
                        .then(() => this.notifyAuthChange('SIGNED_IN'))
                        .catch(err => console.warn('Profile load after SIGNED_IN failed:', err));
                }, 0);
            } else if (event === 'SIGNED_OUT') {
                this.currentUser = null;
                this.userProfile = null;
                this.notifyAuthChange('SIGNED_OUT');
            } else if (event === 'TOKEN_REFRESHED') {
                console.log('🔄 Token refreshed');
                // Update current user from refreshed session
                if (session?.user) {
                    this.currentUser = session.user;
                }
            }
        });

        this._authUnsubscribe = () => subscription.unsubscribe();
    }

    showPasswordResetForm() {
        // Create modal overlay for password reset
        const existingModal = document.getElementById('password-reset-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'password-reset-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100000;
            padding: 20px;
        `;

        modal.innerHTML = `
            <div style="
                background: #151a21;
                border: 1px solid #2a3140;
                border-radius: 12px;
                padding: 30px;
                max-width: 400px;
                width: 100%;
                color: #e6edf3;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            ">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                  <h2 style="margin: 0; color: #6aa9ff;">🔐 Reset Your Password</h2>
                  <button onclick="document.getElementById('password-reset-modal')?.remove()" style="background: none; border: none; color: #97a2b0; font-size: 24px; cursor: pointer; padding: 4px;" aria-label="Close">&times;</button>
                </div>
                <p style="color: #97a2b0; margin-bottom: 20px;">Enter your new password below.</p>

                <form id="password-reset-form" onsubmit="window.portalAuth.handlePasswordReset(event)">
                    <div style="margin-bottom: 15px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 500;">New Password</label>
                        <input type="password" id="reset-new-password" required minlength="6"
                               placeholder="Enter new password (min 6 characters)"
                               style="width: 100%; padding: 12px; border: 1px solid #2a3140; border-radius: 8px; background: #0f1216; color: #e6edf3; font-size: 14px; box-sizing: border-box;">
                    </div>

                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 5px; font-weight: 500;">Confirm Password</label>
                        <input type="password" id="reset-confirm-password" required minlength="6"
                               placeholder="Confirm new password"
                               style="width: 100%; padding: 12px; border: 1px solid #2a3140; border-radius: 8px; background: #0f1216; color: #e6edf3; font-size: 14px; box-sizing: border-box;">
                    </div>

                    <div id="reset-error" style="color: #ff6a6a; font-size: 14px; margin-bottom: 15px; display: none;"></div>

                    <button type="submit" id="reset-submit-btn" style="
                        width: 100%;
                        padding: 12px;
                        background: linear-gradient(135deg, #6aa9ff 0%, #8bffb0 100%);
                        border: none;
                        border-radius: 8px;
                        color: #0f1216;
                        font-weight: 600;
                        font-size: 16px;
                        cursor: pointer;
                        transition: opacity 0.2s;
                    ">
                        Update Password
                    </button>
                </form>
            </div>
        `;

        document.body.appendChild(modal);
    }

    async handlePasswordReset(event) {
        event.preventDefault();

        const newPassword = document.getElementById('reset-new-password')?.value;
        const confirmPassword = document.getElementById('reset-confirm-password')?.value;
        const errorDiv = document.getElementById('reset-error');
        const submitBtn = document.getElementById('reset-submit-btn');

        // Clear previous errors
        if (errorDiv) {
            errorDiv.style.display = 'none';
            errorDiv.textContent = '';
        }

        // Validate passwords match
        if (newPassword !== confirmPassword) {
            if (errorDiv) {
                errorDiv.textContent = 'Passwords do not match.';
                errorDiv.style.display = 'block';
            }
            return;
        }

        // Validate password length
        if (newPassword.length < 6) {
            if (errorDiv) {
                errorDiv.textContent = 'Password must be at least 6 characters.';
                errorDiv.style.display = 'block';
            }
            return;
        }

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Updating...';
            }

            const { error } = await this.supabase.auth.updateUser({
                password: newPassword
            });

            if (error) throw error;

            // Success - remove modal and show notification
            const modal = document.getElementById('password-reset-modal');
            if (modal) modal.remove();

            PortalUI.showNotification('Password updated successfully! You can now log in with your new password.', 'success', 5000);

            // Clean up URL hash (remove recovery tokens)
            window.history.replaceState(null, '', window.location.pathname);

            // Redirect to login after short delay
            setTimeout(() => {
                window.location.href = window.location.pathname;
            }, 2000);

        } catch (error) {
            console.error('Password reset error:', error);
            if (errorDiv) {
                errorDiv.textContent = error.message || 'Failed to update password. Please try again.';
                errorDiv.style.display = 'block';
            }
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Update Password';
            }
        }
    }

    async loadSupabase() {
        return new Promise((resolve, reject) => {
            if (typeof supabase !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = '/shared/supabase.min.js';
            script.onload = () => {
                console.log('📦 Supabase loaded');
                resolve();
            };
            script.onerror = () => reject(new Error('Failed to load Supabase'));
            document.head.appendChild(script);
        });
    }

    async checkCurrentSession() {
        try {
            const { data: { session }, error } = await this.supabase.auth.getSession();
            
            if (error) {
                console.warn('Session check error:', error.message);
                return false;
            }
            
            if (session?.user) {
                this.currentUser = session.user;
                await this.loadUserProfile();
                return true;
            }
            
            return false;
        } catch (error) {
            console.warn('Session check failed:', error.message);
            return false;
        }
    }

    async reconnect() {
        console.log('🔄 Reconnecting to Supabase...');

        try {
            // Clean up old auth listener before creating new client
            if (this._authUnsubscribe) {
                this._authUnsubscribe();
                this._authUnsubscribe = null;
            }

            // Recreate the Supabase client
            this.supabase = supabase.createClient(this.config.supabaseUrl, this.config.supabaseKey, {
                auth: {
                    autoRefreshToken: true,
                    persistSession: true,
                    detectSessionInUrl: true,
                    // Bypass the Navigator LockManager. The default lock can
                    // deadlock when a tab is hidden mid-token-refresh, which
                    // freezes EVERY query behind it on tab return (the
                    // "frozen buttons" bug the old always-reload papered
                    // over). Tradeoff: rare multi-tab refresh races, which
                    // Supabase tolerates via its 10s token reuse window.
                    lock: async (_name, _acquireTimeout, fn) => await fn()
                }
            });

            // Re-setup the auth listener for the new client
            this._setupAuthListener();

            // Restore the session
            const { data: { session }, error } = await this.supabase.auth.getSession();

            if (error) {
                console.error('❌ Reconnect session error:', error);
                return false;
            }

            if (session?.user) {
                this.currentUser = session.user;
                await this.loadUserProfile();
                console.log('✅ Reconnected successfully');
                return true;
            }

            console.warn('⚠️ Reconnected but no session');
            return false;

        } catch (error) {
            console.error('❌ Reconnect failed:', error);
            return false;
        }
    }

    // Synchronous reconnect - creates new client immediately without waiting for session
    reconnectSync() {
        try {
            // Clean up old auth listener
            if (this._authUnsubscribe) {
                this._authUnsubscribe();
                this._authUnsubscribe = null;
            }

            // Recreate the Supabase client immediately
            this.supabase = supabase.createClient(this.config.supabaseUrl, this.config.supabaseKey, {
                auth: {
                    autoRefreshToken: true,
                    persistSession: true,
                    detectSessionInUrl: true,
                    // Bypass the Navigator LockManager. The default lock can
                    // deadlock when a tab is hidden mid-token-refresh, which
                    // freezes EVERY query behind it on tab return (the
                    // "frozen buttons" bug the old always-reload papered
                    // over). Tradeoff: rare multi-tab refresh races, which
                    // Supabase tolerates via its 10s token reuse window.
                    lock: async (_name, _acquireTimeout, fn) => await fn()
                }
            });

            // Re-setup auth listener
            this._setupAuthListener();

            return true;
        } catch (error) {
            return false;
        }
    }

    async loadUserProfile() {
        try {
            const { data: { user } } = await this.supabase.auth.getUser();
            if (!user) return null;
    
            // Fetch profile by auth_user_id (for activated accounts) or id (for legacy accounts)
            const { data: profiles, error } = await this.supabase
                .from('user_profiles')
                .select('*')
                .or(`auth_user_id.eq.${user.id},id.eq.${user.id}`);
    
            if (error) {
                console.error('Profile fetch error:', error);
                return null;
            }
    
            // If profile exists, use it
            if (profiles && profiles.length > 0) {
                this.userProfile = profiles[0];
                await this._syncProfileEmail(user, profiles[0]);
                return profiles[0];
            }
    
            // No profile found - this shouldn't happen for properly registered users
            console.warn('⚠️ No profile found for authenticated user:', user.email);
            console.warn('User may have incomplete registration');
            
            // Return null - don't try to create profiles here
            // Profile creation should only happen during registration
            this.userProfile = null;
            return null;
    
        } catch (error) {
            console.error('Profile load error:', error);
            return null;
        }
    }

    // Keep user_profiles.email in step with the address in Supabase Auth.
    //
    // Auth is the source of truth: it's what you sign in with, and it only
    // changes after the confirmation links are clicked. user_profiles.email is
    // a mirror that the rest of the app reads — notification emails, the
    // enrollment_applications RLS policies, directory lookups. If a user
    // changes their email and the mirror doesn't follow, their notifications
    // keep going to the old address.
    //
    // Runs on every profile load, only writes when the two disagree, and only
    // ever touches the caller's own row.
    async _syncProfileEmail(user, profile) {
        try {
            const authEmail = user?.email;
            if (!authEmail) return;

            // PIN-only students are signed in against a synthetic
            // pin-<uuid>@pin.rivertech.me auth user created by the pin-login
            // edge function. That's not a real mailbox — never let it
            // overwrite a genuine address on the profile.
            if (/@pin\.rivertech\.me$/i.test(authEmail)) return;

            if ((profile?.email || '').toLowerCase() === authEmail.toLowerCase()) return;

            // The "Users can update own profile" RLS policy keys on
            // auth_user_id. Legacy rows that never got one can't self-update,
            // so don't fire a write that would silently match zero rows.
            if (!profile?.auth_user_id) return;

            const { error } = await this.supabase
                .from('user_profiles')
                .update({ email: authEmail })
                .eq('auth_user_id', user.id);

            if (error) {
                console.warn('Profile email sync failed:', error.message);
                return;
            }

            console.log(`✉️ Profile email synced to confirmed auth email: ${authEmail}`);
            profile.email = authEmail;
            if (this.userProfile) this.userProfile.email = authEmail;

        } catch (err) {
            // Never let a mirror update break sign-in.
            console.warn('Profile email sync error:', err);
        }
    }

    // Navigation helpers
    goToMainPortal(section = '') {
        const url = this.config.mainPortalUrl + (section ? '#' + section : '');
        window.location.href = url;
    }

    goToClassesPortal(section = '') {
        const url = this.config.classesPortalUrl + (section ? '#' + section : '');
        window.location.href = url;
    }

    requireAuth(redirectToMain = true) {
        if (!this.isAuthenticated()) {
            console.log('🔒 Authentication required');
            if (redirectToMain) {
                this.goToMainPortal();
            }
            return false;
        }
        return true;
    }

    isAuthenticated() {
        // User is authenticated if they have a session, even if profile is missing
        return !!this.currentUser;
    }
    
    hasCompleteProfile() {
        // Check if user has both auth and profile
        return !!(this.currentUser && this.userProfile);
    }

    getUserInfo() {
        return {
            user: this.currentUser,
            profile: this.userProfile,
            isAuthenticated: this.isAuthenticated(),
            hasProfile: !!this.userProfile
        };
    }

    // Auth state notification system
    notifyAuthChange(event) {
        window.dispatchEvent(new CustomEvent('portalAuthChange', {
            detail: { event, user: this.currentUser, profile: this.userProfile }
        }));
    }

    // Logout across both portals
    async logout() {
        try {
            await this.supabase.auth.signOut();
            this.currentUser = null;
            this.userProfile = null;
            this.goToMainPortal();
        } catch (error) {
            console.error('Logout error:', error);
            // Force logout anyway
            this.currentUser = null;
            this.userProfile = null;
            this.goToMainPortal();
        }
    }
}

// Shared UI utilities
class PortalUI {
    static applyTheme(theme) {
        const root = document.documentElement;
        Object.entries(theme).forEach(([key, value]) => {
            root.style.setProperty(`--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`, value);
        });
    }

    static showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `portal-notification portal-notification--${type}`;
        notification.textContent = message;
        
        const styles = {
            info: { bg: '#2196f3', color: '#fff' },
            success: { bg: '#4caf50', color: '#fff' },
            error: { bg: '#f44336', color: '#fff' },
            warning: { bg: '#ff9800', color: '#fff' }
        };
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 24px;
            border-radius: 8px;
            color: ${styles[type].color};
            background: ${styles[type].bg};
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            max-width: 400px;
            animation: slideInRight 0.3s ease-out;
            font-family: inherit;
            font-size: 14px;
            line-height: 1.4;
        `;
        
        // Add animation styles if not already present
        if (!document.getElementById('portal-notification-styles')) {
            const style = document.createElement('style');
            style.id = 'portal-notification-styles';
            style.textContent = `
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOutRight {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease-out';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }, duration);
    }

    static createUnifiedNavigation(currentApp = 'main', currentSection = '') {
        return this.buildUnifiedNav(currentApp, currentSection);
    }

    // Single source for every nav destination. buildUnifiedNav renders the
    // primary ones as the bar; getSecondaryNavItems returns the `secondary`
    // ones for the Portal page launcher. Move an item between the two by
    // toggling that one flag — there is no second list to keep in step.
    static navDestinations(userType, currentApp = 'main') {
        const sharedPath = currentApp === 'portal' ? '../shared' : './shared';
        // .jpg, not .png - there is no PNG in shared/, and referencing one 404s
        // on every page render. The crop and border match how Riven is framed
        // everywhere else.
        const rivenIcon = `<span style="display: inline-flex; width: 18px; height: 18px; border-radius: 50%; overflow: hidden; vertical-align: middle; border: 1px solid #d97a3a;"><img src="${sharedPath}/riven-avatar.jpg" alt="" style="width: 100%; height: 100%; object-fit: cover; object-position: 53% 17%; transform: scale(1.8); transform-origin: 53% 17%;"></span>`;
        return [
            { icon: '🏠', label: 'Home', app: 'main', section: 'dashboard', roles: ['student', 'parent', 'teacher', 'admin'] },
            { icon: '🎮', label: 'Games', app: 'main', section: 'games', roles: ['student'] },
            { icon: '🌟', label: 'Skills', app: 'main', section: 'skills', roles: ['student'] },
            { icon: '📊', label: 'Portal', app: 'portal', section: 'home', roles: ['student', 'teacher', 'admin', 'parent'] },
            { icon: '📄', label: 'Documents', app: 'portal', section: 'documents', roles: ['student', 'teacher', 'admin', 'parent'] , secondary: true },
            { icon: '📚', label: userType === 'parent' ? "Children's Classes" : 'Classes', app: 'portal', section: 'classes', roles: ['student', 'teacher', 'admin', 'parent'] },
            { icon: '📝', label: 'Testing', app: 'portal', section: 'testing-center', roles: ['student', 'teacher', 'admin'] , secondary: true },
            { icon: '👥', label: 'My Students', app: 'portal', section: 'my-students', roles: ['teacher', 'admin'] },
            { icon: '💬', label: 'Messages', app: 'portal', section: 'messaging', roles: ['student', 'teacher', 'admin', 'parent'] },
            { icon: '🏆', label: 'Activities', app: 'portal', section: 'activities', roles: ['student', 'teacher', 'admin', 'parent'] , secondary: true },

            { icon: '💰', label: 'RTC', app: 'portal', section: 'admin-rtc-management', roles: ['teacher', 'admin'] , secondary: true },
            { icon: rivenIcon, label: 'Riven', app: 'portal', section: 'teacher-terminal', roles: ['teacher', 'admin'] },
            { icon: '👤', label: 'Profile', app: 'portal', section: 'profile', roles: ['student', 'teacher', 'admin', 'parent'] },
            { icon: '🔑', label: 'Admin', app: 'portal', section: 'admin-dashboard', roles: ['admin'] },
        ];
    }

    static getSecondaryNavItems(userType, currentApp = 'portal') {
        return this.navDestinations(userType, currentApp)
            .filter(i => i.secondary && i.roles.includes(userType));
    }

    static buildUnifiedNav(currentApp = 'main', currentSection = '') {
        const auth = window.portalAuth;
        const userInfo = auth ? auth.getUserInfo() : { isAuthenticated: false };

        if (!userInfo.isAuthenticated) return '';

        const userType = userInfo.profile?.user_type || 'student';
        // "PIN-only" mode: an unclaimed inactive student profile that signed
        // in via the games PIN. They get games + skills + RTC only — no
        // grades, classes, messaging, dashboard, etc. They can upgrade to a
        // full account later via the regular Activate Account flow.
        const isPinOnlyStudent = userType === 'student'
            && userInfo.profile?.account_status === 'inactive';

        const allItems = PortalUI.navDestinations(userType, currentApp);

        // Filter to items visible for this user type.
        // `secondary` items are the periodic ones — they live on the Portal page
        // rather than the nav bar, so the bar stays scannable. Same definitions
        // either way; getSecondaryNavItems() reads the same list.
        let visibleItems = allItems
            .filter(item => item.roles.includes(userType))
            .filter(item => !item.secondary);

        // PIN-only students see only Games and Skills. Everything else
        // belongs to a fully claimed account.
        if (isPinOnlyStudent) {
            const allowedSections = new Set(['games', 'skills']);
            visibleItems = visibleItems.filter(item =>
                item.app === 'main' && allowedSections.has(item.section)
            );
        }

        // URLs for cross-app navigation
        const mainUrl = currentApp === 'portal' ? '../index.html' : window.location.pathname;
        const portalUrl = currentApp === 'main' ? './portal/index.html' : window.location.pathname;

        // Build nav items HTML
        const navItemsHTML = visibleItems.map(item => {
            const isActive = item.app === currentApp && item.section === currentSection;
            const activeClass = isActive ? ' active' : '';

            if (item.app === currentApp) {
                // Same app — button with local navigation
                const onclickFn = currentApp === 'main' ? 'portal.showTab' : 'app.showSection';
                return `<button class="nav-item${activeClass}" data-section="${item.section}" onclick="${onclickFn}('${item.section}')"><span>${item.icon}</span><span>${item.label}</span></button>`;
            } else {
                // Other app — link to the other app with hash
                const targetUrl = item.app === 'main' ? mainUrl : portalUrl;
                return `<a href="${targetUrl}#${item.section}" class="nav-item${activeClass}"><span>${item.icon}</span><span>${item.label}</span></a>`;
            }
        }).join('');

        return navItemsHTML;
    }

    // ==================== SITE THEME SYSTEM ====================

    static SITE_THEMES = {
        'default-dark': {
            label: 'Default Dark',
            colors: {
                '--bg': '#0f1216', '--card': '#151a21', '--text': '#e6edf3', '--muted': '#97a2b0',
                '--accent': '#6aa9ff', '--accent-2': '#8bffb0', '--danger': '#ff6a6a', '--warning': '#ffd36a',
                '--success': '#8bffb0', '--link': '#a0c2ff', '--border': '#2a3140',
                '--nav-bg': '#0c1118', '--nav-text': '#c7d2fe', '--nav-hover': '#a5b4fc',
                '--nav-active-bg': '#0b0f14', '--input-bg': '#0e1319',
                '--surface-bg': '#0b1017', '--surface-border': '#1a2330', '--text-light': '#e5e7eb',
                '--class-card-bg': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                '--class-card-hover-shadow': 'rgba(102, 126, 234, 0.3)'
            },
            buttons: { bg: 'linear-gradient(135deg, #6aa9ff, #8bffb0)', text: '#0b0f14', shadow: 'rgba(106, 169, 255, 0.3)' }
        },
        'midnight-blue': {
            label: 'Midnight Blue',
            colors: {
                '--bg': '#0a0e1a', '--card': '#111827', '--text': '#e0e7ff', '--muted': '#9ca3bf',
                '--accent': '#818cf8', '--accent-2': '#c084fc', '--danger': '#f87171', '--warning': '#fbbf24',
                '--success': '#6ee7b7', '--link': '#a5b4fc', '--border': '#1e293b',
                '--nav-bg': '#0f172a', '--nav-text': '#c7d2fe', '--nav-hover': '#a5b4fc',
                '--nav-active-bg': '#0a0f1f', '--input-bg': '#0f172a',
                '--surface-bg': '#0d1323', '--surface-border': '#1e293b', '--text-light': '#e0e7ff',
                '--class-card-bg': 'linear-gradient(135deg, #4338ca 0%, #6d28d9 100%)',
                '--class-card-hover-shadow': 'rgba(99, 102, 241, 0.3)'
            },
            buttons: { bg: 'linear-gradient(135deg, #818cf8, #c084fc)', text: '#0a0e1a', shadow: 'rgba(129, 140, 248, 0.3)' }
        },
        'light': {
            label: 'Light',
            colors: {
                '--bg': '#f8fafc', '--card': '#ffffff', '--text': '#1e293b', '--muted': '#64748b',
                '--accent': '#3b82f6', '--accent-2': '#10b981', '--danger': '#ef4444', '--warning': '#f59e0b',
                '--success': '#10b981', '--link': '#2563eb', '--border': '#e2e8f0',
                '--nav-bg': '#ffffff', '--nav-text': '#475569', '--nav-hover': '#1e293b',
                '--nav-active-bg': '#f1f5f9', '--input-bg': '#f8fafc',
                '--surface-bg': '#f1f5f9', '--surface-border': '#e2e8f0', '--text-light': '#334155',
                '--class-card-bg': 'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
                '--class-card-hover-shadow': 'rgba(59, 130, 246, 0.3)'
            },
            buttons: { bg: 'linear-gradient(135deg, #3b82f6, #10b981)', text: '#ffffff', shadow: 'rgba(59, 130, 246, 0.3)' }
        },
        'warm-ember': {
            label: 'Warm Ember',
            colors: {
                '--bg': '#1a1210', '--card': '#231a16', '--text': '#f5e6d3', '--muted': '#a89080',
                '--accent': '#f59e0b', '--accent-2': '#ef4444', '--danger': '#dc2626', '--warning': '#fbbf24',
                '--success': '#84cc16', '--link': '#fbbf24', '--border': '#3d2e24',
                '--nav-bg': '#1e1512', '--nav-text': '#d4a574', '--nav-hover': '#f59e0b',
                '--nav-active-bg': '#171010', '--input-bg': '#1e1512',
                '--surface-bg': '#1c1410', '--surface-border': '#3d2e24', '--text-light': '#f0dcc8',
                '--class-card-bg': 'linear-gradient(135deg, #b45309 0%, #dc2626 100%)',
                '--class-card-hover-shadow': 'rgba(180, 83, 9, 0.3)'
            },
            buttons: { bg: 'linear-gradient(135deg, #f59e0b, #ef4444)', text: '#1a1210', shadow: 'rgba(245, 158, 11, 0.3)' }
        },
        'nord': {
            label: 'Nord',
            colors: {
                '--bg': '#2e3440', '--card': '#3b4252', '--text': '#eceff4', '--muted': '#a0aec0',
                '--accent': '#88c0d0', '--accent-2': '#a3be8c', '--danger': '#bf616a', '--warning': '#ebcb8b',
                '--success': '#a3be8c', '--link': '#81a1c1', '--border': '#434c5e',
                '--nav-bg': '#2e3440', '--nav-text': '#d8dee9', '--nav-hover': '#88c0d0',
                '--nav-active-bg': '#292e39', '--input-bg': '#3b4252',
                '--surface-bg': '#353b48', '--surface-border': '#434c5e', '--text-light': '#e5e9f0',
                '--class-card-bg': 'linear-gradient(135deg, #5e81ac 0%, #81a1c1 100%)',
                '--class-card-hover-shadow': 'rgba(94, 129, 172, 0.3)'
            },
            buttons: { bg: 'linear-gradient(135deg, #88c0d0, #a3be8c)', text: '#2e3440', shadow: 'rgba(136, 192, 208, 0.3)' }
        },
        'amoled-black': {
            label: 'AMOLED Black',
            colors: {
                '--bg': '#000000', '--card': '#0a0a0a', '--text': '#e4e4e7', '--muted': '#71717a',
                '--accent': '#a78bfa', '--accent-2': '#34d399', '--danger': '#f87171', '--warning': '#fbbf24',
                '--success': '#34d399', '--link': '#c4b5fd', '--border': '#27272a',
                '--nav-bg': '#0a0a0a', '--nav-text': '#a1a1aa', '--nav-hover': '#a78bfa',
                '--nav-active-bg': '#000000', '--input-bg': '#0a0a0a',
                '--surface-bg': '#050505', '--surface-border': '#27272a', '--text-light': '#d4d4d8',
                '--class-card-bg': 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)',
                '--class-card-hover-shadow': 'rgba(124, 58, 237, 0.3)'
            },
            buttons: { bg: 'linear-gradient(135deg, #a78bfa, #34d399)', text: '#000000', shadow: 'rgba(167, 139, 250, 0.3)' }
        }
    };

    static BUTTON_COLOR_SCHEMES = {
        ocean:  { bg: 'linear-gradient(135deg, #6aa9ff, #8bffb0)', text: '#0b0f14', shadow: 'rgba(106, 169, 255, 0.3)' },
        sunset: { bg: 'linear-gradient(135deg, #f7971e, #f5576c)', text: '#0b0f14', shadow: 'rgba(247, 151, 30, 0.3)' },
        purple: { bg: 'linear-gradient(135deg, #667eea, #f093fb)', text: '#0b0f14', shadow: 'rgba(102, 126, 234, 0.3)' },
        cyber:  { bg: 'linear-gradient(135deg, #4facfe, #00f2fe)', text: '#0b0f14', shadow: 'rgba(79, 172, 254, 0.3)' },
        slate:  { bg: '#2b3442',                                   text: '#e6edf3', shadow: 'rgba(43, 52, 66, 0.3)' }
    };

    static applySiteTheme(themeName, customOverrides) {
        const theme = this.SITE_THEMES[themeName] || this.SITE_THEMES['default-dark'];
        const root = document.documentElement;

        // Store resolved colors for bg-image alpha styles
        this._currentColors = { ...theme.colors };
        if (customOverrides && typeof customOverrides === 'object') {
            Object.assign(this._currentColors, customOverrides);
        }

        // Apply all color variables from the preset
        Object.entries(theme.colors).forEach(([prop, value]) => {
            root.style.setProperty(prop, value);
        });

        // Apply custom overrides on top (if any)
        if (customOverrides && typeof customOverrides === 'object') {
            Object.entries(customOverrides).forEach(([prop, value]) => {
                if (value) root.style.setProperty(prop, value);
            });
        }

        // Update semantic aliases
        root.style.setProperty('--primary', 'var(--accent)');
        root.style.setProperty('--secondary', 'var(--accent-2)');
        root.style.setProperty('--background', 'var(--bg)');
        root.style.setProperty('--card-bg', 'var(--card)');
        root.style.setProperty('--text-color', 'var(--text)');
        root.style.setProperty('--muted-color', 'var(--muted)');
        root.style.setProperty('--border-color', 'var(--border)');
        root.style.setProperty('--danger-color', 'var(--danger)');
        root.style.setProperty('--warning-color', 'var(--warning)');
        root.style.setProperty('--success-color', 'var(--success)');
        root.style.setProperty('--link-color', 'var(--link)');

        // Apply button colors from theme (can be overridden by button scheme)
        root.style.setProperty('--btn-bg', theme.buttons.bg);
        root.style.setProperty('--btn-text', theme.buttons.text);
        root.style.setProperty('--btn-shadow', theme.buttons.shadow);

        // Cache to localStorage for flash prevention
        try {
            const cache = { theme: themeName, colors: { ...theme.colors } };
            if (customOverrides) {
                Object.assign(cache.colors, customOverrides);
            }
            cache.buttons = theme.buttons;
            localStorage.setItem('site_theme_cache', JSON.stringify(cache));
        } catch (e) { /* storage full or unavailable */ }
    }

    static applyButtonScheme(scheme) {
        if (scheme && scheme.startsWith('custom:')) {
            // Custom single-color button
            const hex = scheme.substring(7);
            const contrast = this.getContrastText(hex);
            const r = parseInt(hex.slice(1,3), 16);
            const g = parseInt(hex.slice(3,5), 16);
            const b = parseInt(hex.slice(5,7), 16);
            document.documentElement.style.setProperty('--btn-bg', hex);
            document.documentElement.style.setProperty('--btn-text', contrast);
            document.documentElement.style.setProperty('--btn-shadow', `rgba(${r}, ${g}, ${b}, 0.3)`);
        } else {
            const s = this.BUTTON_COLOR_SCHEMES[scheme] || this.BUTTON_COLOR_SCHEMES.ocean;
            document.documentElement.style.setProperty('--btn-bg', s.bg);
            document.documentElement.style.setProperty('--btn-text', s.text);
            document.documentElement.style.setProperty('--btn-shadow', s.shadow);
        }
        try {
            localStorage.setItem('btn_scheme_cache', scheme || 'ocean');
        } catch (e) { /* */ }
    }

    static getContrastText(hex) {
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        // Relative luminance formula
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.5 ? '#0b0f14' : '#f0f0f0';
    }

    static loadThemeFromProfile(profile) {
        if (!profile) {
            this.applySiteTheme('default-dark');
            return;
        }

        const themeName = profile.site_theme || 'default-dark';
        const customOverrides = profile.site_theme_custom || null;

        this.applySiteTheme(themeName, customOverrides);

        // Apply button color scheme override (if user has one that differs from theme default)
        const btnScheme = profile.button_color_scheme;
        if (btnScheme) {
            this.applyButtonScheme(btnScheme);
        }

        // Apply background image if set
        if (customOverrides && customOverrides['--bg-image-url']) {
            this.applyBgImage(customOverrides['--bg-image-url'], customOverrides['--bg-overlay-opacity']);
        } else {
            document.body.classList.remove('has-bg-image');
        }
    }

    static _hexToRgb(hex) {
        hex = (hex || '').trim();
        if (!hex.startsWith('#') || hex.length < 7) return { r: 15, g: 18, b: 22 };
        return {
            r: parseInt(hex.slice(1,3), 16) || 0,
            g: parseInt(hex.slice(3,5), 16) || 0,
            b: parseInt(hex.slice(5,7), 16) || 0
        };
    }

    static _rgba(hex, a) {
        const { r, g, b } = this._hexToRgb(hex);
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    static _currentColors = {};

    /**
     * Make UI elements semi-transparent by replacing CSS variable values with rgba equivalents.
     * This works because every element uses var(--card), var(--nav-bg), etc. for backgrounds,
     * including inline style="" attributes. Changing the variable value itself means everything
     * that references it becomes transparent — no cascade/specificity battles.
     */
    static _applyTransparentVars() {
        const c = this._currentColors || {};
        const root = document.documentElement;

        // Replace solid hex vars with rgba transparent versions
        const alphaMap = {
            '--card':          { fallback: '#151a21', alpha: 0.80 },
            '--nav-bg':        { fallback: '#0c1118', alpha: 0.75 },
            '--nav-active-bg': { fallback: '#0b0f14', alpha: 0.70 },
            '--surface-bg':    { fallback: '#0b1017', alpha: 0.75 },
            '--input-bg':      { fallback: '#0e1319', alpha: 0.80 },
        };

        Object.entries(alphaMap).forEach(([varName, { fallback, alpha }]) => {
            const hex = c[varName] || fallback;
            root.style.setProperty(varName, this._rgba(hex, alpha));
        });

        // Make class card gradient semi-transparent by adding alpha to color stops
        const gradient = c['--class-card-bg'] || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        const transparentGradient = gradient.replace(/#[0-9a-fA-F]{6}/g, (hex) => {
            return this._rgba(hex, 0.75);
        });
        root.style.setProperty('--class-card-bg', transparentGradient);

        // Inject a minimal style for backdrop-filter (blur effect, not background overrides)
        let el = document.getElementById('bg-image-alpha-styles');
        if (!el) {
            el = document.createElement('style');
            el.id = 'bg-image-alpha-styles';
            document.head.appendChild(el);
        }
        el.textContent = `
body.has-bg-image .card,
body.has-bg-image .portal-container,
body.has-bg-image .container,
body.has-bg-image .modal,
body.has-bg-image .modal-head,
body.has-bg-image .header,
body.has-bg-image .notification-dropdown,
body.has-bg-image .user-badge {
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
body.has-bg-image .nav,
body.has-bg-image .app-nav,
body.has-bg-image .nav-tabs,
body.has-bg-image .notification-bell-container {
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
}
body.has-bg-image .subs-row,
body.has-bg-image .roster-row,
body.has-bg-image .note-card,
body.has-bg-image .game-card,
body.has-bg-image .class-card,
body.has-bg-image .alert {
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}`;
    }

    /**
     * Restore solid (opaque) CSS variable values from stored theme colors.
     */
    static _restoreSolidVars() {
        const c = this._currentColors || {};
        const root = document.documentElement;
        const keys = ['--card', '--nav-bg', '--nav-active-bg', '--surface-bg', '--input-bg', '--class-card-bg'];
        keys.forEach(k => {
            if (c[k]) root.style.setProperty(k, c[k]);
        });
        const el = document.getElementById('bg-image-alpha-styles');
        if (el) el.remove();
    }

    static applyBgImage(url, opacity) {
        if (!url) {
            document.documentElement.style.setProperty('--bg-image', 'none');
            document.body.classList.remove('has-bg-image');
            this._restoreSolidVars();
            return;
        }
        document.documentElement.style.setProperty('--bg-image', `url("${url}")`);
        document.body.classList.add('has-bg-image');

        // Set overlay
        const bgHex = this._currentColors['--bg'] || '#0f1216';
        const { r, g, b } = this._hexToRgb(bgHex);
        const alpha = (parseInt(opacity || 85) / 100).toFixed(2);
        document.documentElement.style.setProperty('--bg-overlay', `rgba(${r}, ${g}, ${b}, ${alpha})`);

        // Replace CSS vars with transparent rgba versions
        this._applyTransparentVars();
    }

    static addNavigationStyles() {
        if (document.getElementById('unified-nav-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'unified-nav-styles';
        style.textContent = `
            .unified-portal-nav {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 20px;
                background: rgba(15, 18, 22, 0.95);
                backdrop-filter: blur(10px);
                border-bottom: 1px solid var(--border-color, #2a3140);
                position: sticky;
                top: 0;
                z-index: 1000;
                font-family: inherit;
            }
            
            .nav-brand {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 600;
                color: var(--text-color, #e6edf3);
            }
            
            .nav-logo {
                font-size: 24px;
            }
            
            .nav-title {
                font-size: 18px;
            }
            
            .nav-links {
                display: flex;
                gap: 4px;
            }
            
            .nav-link {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 8px 12px;
                border-radius: 6px;
                text-decoration: none;
                color: var(--muted-color, #97a2b0);
                font-size: 14px;
                transition: all 0.2s ease;
                position: relative;
            }
            
            .nav-link:hover {
                background: rgba(106, 169, 255, 0.1);
                color: var(--primary, #6aa9ff);
            }
            
            .nav-link.active {
                background: rgba(106, 169, 255, 0.2);
                color: var(--primary, #6aa9ff);
            }
            
            .nav-icon {
                font-size: 16px;
            }
            
            .nav-text {
                font-weight: 500;
            }
            
            .nav-user {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            
            .user-info {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                font-size: 12px;
            }
            
            .user-name {
                color: var(--text-color, #e6edf3);
                font-weight: 600;
            }
            
            .user-type {
                color: var(--muted-color, #97a2b0);
                text-transform: capitalize;
            }
            
            .nav-logout {
                background: none;
                border: 1px solid var(--border-color, #2a3140);
                color: var(--muted-color, #97a2b0);
                padding: 6px;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 16px;
            }
            
            .nav-logout:hover {
                border-color: var(--danger, #ff6a6a);
                color: var(--danger, #ff6a6a);
                background: rgba(255, 106, 106, 0.1);
            }
            
            @media (max-width: 768px) {
                .unified-portal-nav {
                    padding: 8px 12px;
                }
                
                .nav-text {
                    display: none;
                }
                
                .nav-links {
                    gap: 2px;
                }
                
                .nav-link {
                    padding: 8px;
                }
                
                .user-info {
                    display: none;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

// Initialize shared portal system
window.portalAuth = new PortalAuth();
window.PortalUI = PortalUI;

// Flash prevention — apply cached theme before DOM load
(function() {
    try {
        const cached = localStorage.getItem('site_theme_cache');
        if (cached) {
            const data = JSON.parse(cached);
            const root = document.documentElement;
            if (data.colors) {
                Object.entries(data.colors).forEach(([prop, value]) => {
                    root.style.setProperty(prop, value);
                });
            }
            if (data.buttons) {
                root.style.setProperty('--btn-bg', data.buttons.bg);
                root.style.setProperty('--btn-text', data.buttons.text);
                root.style.setProperty('--btn-shadow', data.buttons.shadow);
            }
            if (data.bgImage) {
                root.style.setProperty('--bg-image', `url("${data.bgImage}")`);
                // Note: document.body may not exist yet (script in <head>), so we
                // defer has-bg-image class and transparent vars to DOMContentLoaded
                PortalUI._currentColors = data.colors || {};
                PortalUI._pendingBgImage = { overlay: data.bgOverlay };
            }
        }
        const btnCache = localStorage.getItem('btn_scheme_cache');
        if (btnCache) {
            PortalUI.applyButtonScheme(btnCache);
        }
    } catch (e) { /* ignore parse errors */ }
})();

// Auto-initialize when DOM is ready
function _portalInit() {
    window.portalAuth.initialize();
    PortalUI.addNavigationStyles();
    // If the IIFE cached a pending bg image, apply it now that document.body exists
    if (PortalUI._pendingBgImage) {
        const pending = PortalUI._pendingBgImage;
        document.body.classList.add('has-bg-image');
        const bgHex = PortalUI._currentColors['--bg'] || '#0f1216';
        const { r, g, b } = PortalUI._hexToRgb(bgHex);
        const a = (parseInt(pending.overlay || 85) / 100).toFixed(2);
        document.documentElement.style.setProperty('--bg-overlay', `rgba(${r}, ${g}, ${b}, ${a})`);
        PortalUI._applyTransparentVars();
        PortalUI._pendingBgImage = null;
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _portalInit);
} else {
    _portalInit();
}









