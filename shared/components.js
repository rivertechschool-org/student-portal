// shared/components.js
// Additional utility components for the unified portal system

/**
 * Loading Manager - Handle loading states consistently across portals
 */
class LoadingManager {
    constructor() {
        this.activeLoaders = new Set();
    }

    show(id = 'default', message = 'Loading...') {
        this.activeLoaders.add(id);
        
        // Remove existing loader with same ID
        const existing = document.getElementById(`loader-${id}`);
        if (existing) existing.remove();
        
        const loader = document.createElement('div');
        loader.id = `loader-${id}`;
        loader.className = 'portal-loader';
        loader.innerHTML = `
            <div class="loader-backdrop">
                <div class="loader-content">
                    <div class="loader-spinner"></div>
                    <div class="loader-message">${message}</div>
                </div>
            </div>
        `;
        
        // Add styles if not present
        this.addLoaderStyles();
        
        document.body.appendChild(loader);
        
        // Auto-hide after 30 seconds to prevent stuck loaders
        setTimeout(() => this.hide(id), 30000);
    }

    hide(id = 'default') {
        this.activeLoaders.delete(id);
        const loader = document.getElementById(`loader-${id}`);
        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => {
                if (loader.parentNode) {
                    loader.remove();
                }
            }, 300);
        }
    }

    hideAll() {
        for (const id of this.activeLoaders) {
            this.hide(id);
        }
    }

    addLoaderStyles() {
        if (document.getElementById('loader-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'loader-styles';
        styles.textContent = `
            .portal-loader {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 9999;
                transition: opacity 0.3s ease;
            }
            
            .loader-backdrop {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(15, 18, 22, 0.8);
                backdrop-filter: blur(4px);
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .loader-content {
                background: var(--card-bg, #151a21);
                border: 1px solid var(--border-color, #2a3140);
                border-radius: 12px;
                padding: 30px;
                text-align: center;
                min-width: 200px;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
            }
            
            .loader-spinner {
                width: 40px;
                height: 40px;
                border: 3px solid var(--border-color, #2a3140);
                border-top: 3px solid var(--primary, #6aa9ff);
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin: 0 auto 16px;
            }
            
            .loader-message {
                color: var(--text-color, #e6edf3);
                font-size: 14px;
                font-weight: 500;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(styles);
    }
}

/**
 * Modal Manager - Create consistent modals across portals
 */
class ModalManager {
    constructor() {
        this.activeModals = new Map();
        this.setupModalStyles();
    }

    create(id, options = {}) {
        const config = {
            title: 'Modal',
            content: '',
            size: 'medium', // small, medium, large, fullscreen
            closable: true,
            overlay: true,
            ...options
        };

        // Remove existing modal with same ID
        this.close(id);

        const modal = document.createElement('div');
        modal.id = `modal-${id}`;
        modal.className = `portal-modal portal-modal--${config.size}`;
        
        modal.innerHTML = `
            ${config.overlay ? '<div class="modal-overlay"></div>' : ''}
            <div class="modal-container">
                <div class="modal-header">
                    <h3 class="modal-title">${config.title}</h3>
                    ${config.closable ? '<button class="modal-close" aria-label="Close">&times;</button>' : ''}
                </div>
                <div class="modal-content">
                    ${config.content}
                </div>
                ${config.footer ? `<div class="modal-footer">${config.footer}</div>` : ''}
            </div>
        `;

        document.body.appendChild(modal);
        this.activeModals.set(id, modal);

        // Event listeners
        if (config.closable) {
            modal.querySelector('.modal-close')?.addEventListener('click', () => this.close(id));
            if (config.overlay) {
                modal.querySelector('.modal-overlay')?.addEventListener('click', () => this.close(id));
            }
        }

        // ESC key support — store handler reference for cleanup
        const escHandler = (e) => {
            if (e.key === 'Escape' && config.closable) {
                this.close(id);
            }
        };
        document.addEventListener('keydown', escHandler);
        modal._escHandler = escHandler;

        // Show with animation
        requestAnimationFrame(() => {
            modal.classList.add('modal-visible');
        });

        return modal;
    }

    close(id) {
        const modal = this.activeModals.get(id) || document.getElementById(`modal-${id}`);
        if (!modal) return;

        // Remove ESC key handler
        if (modal._escHandler) {
            document.removeEventListener('keydown', modal._escHandler);
            modal._escHandler = null;
        }

        modal.classList.remove('modal-visible');

        setTimeout(() => {
            if (modal.parentNode) {
                modal.remove();
            }
            this.activeModals.delete(id);
        }, 300);
    }

    closeAll() {
        for (const id of this.activeModals.keys()) {
            this.close(id);
        }
    }

    setupModalStyles() {
        if (document.getElementById('modal-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'modal-styles';
        styles.textContent = `
            .portal-modal {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.3s ease, visibility 0.3s ease;
            }
            
            .portal-modal.modal-visible {
                opacity: 1;
                visibility: visible;
            }
            
            .modal-overlay {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.6);
                backdrop-filter: blur(4px);
            }
            
            .modal-container {
                position: relative;
                background: var(--card-bg, #151a21);
                border: 1px solid var(--border-color, #2a3140);
                border-radius: 12px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
                max-height: 90vh;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                transform: scale(0.9);
                transition: transform 0.3s ease;
            }
            
            .portal-modal.modal-visible .modal-container {
                transform: scale(1);
            }
            
            .portal-modal--small .modal-container { width: 400px; }
            .portal-modal--medium .modal-container { width: 600px; }
            .portal-modal--large .modal-container { width: 800px; }
            .portal-modal--fullscreen .modal-container { 
                width: 95vw; 
                height: 95vh; 
                max-height: none;
            }
            
            .modal-header {
                padding: 20px 24px;
                border-bottom: 1px solid var(--border-color, #2a3140);
                display: flex;
                align-items: center;
                justify-content: space-between;
            }
            
            .modal-title {
                margin: 0;
                color: var(--text-color, #e6edf3);
                font-size: 18px;
                font-weight: 600;
            }
            
            .modal-close {
                background: none;
                border: none;
                color: var(--muted-color, #97a2b0);
                font-size: 24px;
                cursor: pointer;
                padding: 4px;
                border-radius: 4px;
                transition: all 0.2s ease;
            }
            
            .modal-close:hover {
                background: var(--border-color, #2a3140);
                color: var(--text-color, #e6edf3);
            }
            
            .modal-content {
                padding: 24px;
                flex: 1;
                overflow-y: auto;
                color: var(--text-color, #e6edf3);
            }
            
            .modal-footer {
                padding: 16px 24px;
                border-top: 1px solid var(--border-color, #2a3140);
                display: flex;
                gap: 12px;
                justify-content: flex-end;
            }
            
            @media (max-width: 768px) {
                .portal-modal--small .modal-container,
                .portal-modal--medium .modal-container,
                .portal-modal--large .modal-container {
                    width: 95vw;
                    margin: 20px;
                }
                
                .modal-header {
                    padding: 16px 20px;
                }
                
                .modal-content {
                    padding: 20px;
                }
                
                .modal-footer {
                    padding: 16px 20px;
                }
            }
        `;
        document.head.appendChild(styles);
    }
}

/**
 * Form Validator - Consistent form validation across portals
 */
class FormValidator {
    constructor(form, rules = {}) {
        this.form = form;
        this.rules = rules;
        this.errors = new Map();
        this.setupValidation();
    }

    setupValidation() {
        this.form.addEventListener('submit', (e) => {
            if (!this.validate()) {
                e.preventDefault();
                this.showErrors();
            }
        });

        // Real-time validation
        Object.keys(this.rules).forEach(fieldName => {
            const field = this.form.querySelector(`[name="${fieldName}"]`);
            if (field) {
                field.addEventListener('blur', () => this.validateField(fieldName));
                field.addEventListener('input', () => this.clearFieldError(fieldName));
            }
        });
    }

    validate() {
        this.errors.clear();
        let isValid = true;

        Object.entries(this.rules).forEach(([fieldName, rules]) => {
            if (!this.validateField(fieldName)) {
                isValid = false;
            }
        });

        return isValid;
    }

    validateField(fieldName) {
        const field = this.form.querySelector(`[name="${fieldName}"]`);
        const rules = this.rules[fieldName];
        
        if (!field || !rules) return true;

        const value = field.value.trim();
        
        // Required validation
        if (rules.required && !value) {
            this.errors.set(fieldName, rules.messages?.required || `${fieldName} is required`);
            return false;
        }

        // Skip other validations if field is empty and not required
        if (!value && !rules.required) {
            return true;
        }

        // Min length validation
        if (rules.minLength && value.length < rules.minLength) {
            this.errors.set(fieldName, rules.messages?.minLength || `${fieldName} must be at least ${rules.minLength} characters`);
            return false;
        }

        // Email validation
        if (rules.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            this.errors.set(fieldName, rules.messages?.email || 'Please enter a valid email address');
            return false;
        }

        // Custom validation
        if (rules.custom && !rules.custom(value)) {
            this.errors.set(fieldName, rules.messages?.custom || `${fieldName} is invalid`);
            return false;
        }

        // Match field validation
        if (rules.matches) {
            const matchField = this.form.querySelector(`[name="${rules.matches}"]`);
            if (matchField && value !== matchField.value.trim()) {
                this.errors.set(fieldName, rules.messages?.matches || `${fieldName} must match ${rules.matches}`);
                return false;
            }
        }

        return true;
    }

    showErrors() {
        // Clear existing errors
        this.form.querySelectorAll('.field-error').forEach(error => error.remove());
        this.form.querySelectorAll('.field-invalid').forEach(field => {
            field.classList.remove('field-invalid');
        });

        // Show new errors
        this.errors.forEach((message, fieldName) => {
            const field = this.form.querySelector(`[name="${fieldName}"]`);
            if (field) {
                field.classList.add('field-invalid');
                
                const errorEl = document.createElement('div');
                errorEl.className = 'field-error';
                errorEl.textContent = message;
                
                field.parentNode.appendChild(errorEl);
            }
        });

        // Add error styles if not present
        this.addErrorStyles();
    }

    clearFieldError(fieldName) {
        const field = this.form.querySelector(`[name="${fieldName}"]`);
        if (field) {
            field.classList.remove('field-invalid');
            const error = field.parentNode.querySelector('.field-error');
            if (error) error.remove();
        }
        this.errors.delete(fieldName);
    }

    addErrorStyles() {
        if (document.getElementById('form-validation-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'form-validation-styles';
        styles.textContent = `
            .field-invalid {
                border-color: var(--danger-color, #ff6a6a) !important;
                box-shadow: 0 0 0 2px rgba(255, 106, 106, 0.2) !important;
            }
            
            .field-error {
                color: var(--danger-color, #ff6a6a);
                font-size: 12px;
                margin-top: 4px;
                display: block;
            }
        `;
        document.head.appendChild(styles);
    }
}

/**
 * Data Cache Manager - Simple caching for API responses
 */
class CacheManager {
    constructor(defaultTTL = 5 * 60 * 1000) { // 5 minutes
        this.cache = new Map();
        this.defaultTTL = defaultTTL;
    }

    set(key, data, ttl = this.defaultTTL) {
        const expiresAt = Date.now() + ttl;
        this.cache.set(key, { data, expiresAt });
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        
        if (Date.now() > item.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        
        return item.data;
    }

    has(key) {
        return this.get(key) !== null;
    }

    delete(key) {
        this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    // Cleanup expired entries
    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now > item.expiresAt) {
                this.cache.delete(key);
            }
        }
    }
}

/**
 * Event Bus - Cross-portal communication
 */
class EventBus {
    constructor() {
        this.events = new Map();
    }

    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }
        this.events.get(event).add(callback);
    }

    off(event, callback) {
        if (this.events.has(event)) {
            this.events.get(event).delete(callback);
        }
    }

    emit(event, data) {
        if (this.events.has(event)) {
            this.events.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            });
        }
    }

    once(event, callback) {
        const onceCallback = (data) => {
            callback(data);
            this.off(event, onceCallback);
        };
        this.on(event, onceCallback);
    }
}

/**
 * Theme Manager - Dynamic theme switching
 */
class ThemeManager {
    constructor() {
        this.themes = {
            default: {
                primary: '#6aa9ff',
                secondary: '#8bffb0',
                background: '#0f1216',
                cardBg: '#151a21',
                textColor: '#e6edf3',
                mutedColor: '#97a2b0',
                borderColor: '#2a3140'
            },
            light: {
                primary: '#2563eb',
                secondary: '#10b981',
                background: '#ffffff',
                cardBg: '#f8fafc',
                textColor: '#1e293b',
                mutedColor: '#64748b',
                borderColor: '#e2e8f0'
            },
            highContrast: {
                primary: '#ffffff',
                secondary: '#ffff00',
                background: '#000000',
                cardBg: '#1a1a1a',
                textColor: '#ffffff',
                mutedColor: '#cccccc',
                borderColor: '#666666'
            }
        };
        
        this.currentTheme = 'default';
        this.loadSavedTheme();
    }

    setTheme(themeName) {
        if (!this.themes[themeName]) {
            console.warn(`Theme '${themeName}' not found`);
            return;
        }

        this.currentTheme = themeName;
        const theme = this.themes[themeName];
        
        // Apply CSS custom properties
        const root = document.documentElement;
        Object.entries(theme).forEach(([key, value]) => {
            const cssVar = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
            root.style.setProperty(cssVar, value);
        });

        // Save preference
        localStorage.setItem('portal-theme', themeName);
        
        // Emit theme change event
        window.dispatchEvent(new CustomEvent('themeChanged', { 
            detail: { theme: themeName, colors: theme } 
        }));
    }

    loadSavedTheme() {
        const saved = localStorage.getItem('portal-theme');
        if (saved && this.themes[saved]) {
            this.setTheme(saved);
        }
    }

    getCurrentTheme() {
        return this.currentTheme;
    }

    getThemeColors(themeName = this.currentTheme) {
        return this.themes[themeName] || this.themes.default;
    }
}

/**
 * Initialize all utility components
 */
function initializeUtilities() {
    // Make utilities globally available
    window.portalLoading = new LoadingManager();
    window.portalModal = new ModalManager();
    window.portalCache = new CacheManager();
    window.portalEvents = new EventBus();
    window.portalTheme = new ThemeManager();
    
    // Cleanup cache periodically
    setInterval(() => {
        window.portalCache.cleanup();
    }, 60000); // Every minute
    
    console.log('✅ Portal utilities initialized');
}

// Export for module environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        LoadingManager,
        ModalManager,
        FormValidator,
        CacheManager,
        EventBus,
        ThemeManager,
        initializeUtilities
    };
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeUtilities);
} else {
    initializeUtilities();
}