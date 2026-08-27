/**
 * CurriculumGraph — Client-side graph data service.
 *
 * Fetches curriculum data from Supabase's curriculum_nodes, curriculum_edges,
 * and curriculum_clusters tables and converts to the legacy format expected
 * by SkillTreeViewer.html.
 *
 * SAFETY: This is a new file. It does NOT modify any existing code.
 * It's an opt-in data source — the viewer falls back to hardcoded data
 * if this fails or isn't loaded.
 */

class CurriculumGraph {
    constructor(supabaseClient) {
        this.supabase = supabaseClient;
        this._cache = {};
    }

    // ================================================================
    // Domain name mapping: old subject names ↔ new domain names
    // ================================================================

    static DOMAIN_MAP = {
        // Old subject name → New domain name
        'Art': 'Creative',
        'Reading': 'Language',
        'Programming': 'Technology',
        'Robotics': 'Technology',
        // These stay the same
        'Math': 'Math',
        'Science': 'Science',
        // New domains (no legacy equivalent)
        'Bible': 'Bible',
        'LifeSkills': 'LifeSkills',
        'Physical': 'Physical',
        'Social': 'Social',
        'Creative': 'Creative',
        'Language': 'Language',
        'Technology': 'Technology'
    };

    static REVERSE_DOMAIN_MAP = {
        'Creative': 'Art',
        'Language': 'Reading',
        'Technology': 'Programming',
        'Math': 'Math',
        'Science': 'Science'
    };

    /**
     * Map a subject name (old or new) to the canonical domain name.
     */
    static toDomain(subject) {
        return CurriculumGraph.DOMAIN_MAP[subject] || subject;
    }

    /**
     * Map a domain name back to the legacy subject name for skill_progress lookups.
     */
    static toLegacySubject(domain) {
        return CurriculumGraph.REVERSE_DOMAIN_MAP[domain] || domain;
    }

    // ================================================================
    // Data fetching
    // ================================================================

    /**
     * Fetch all nodes for a domain. Returns null on error.
     */
    async getNodesForDomain(domain) {
        const cacheKey = `nodes_${domain}`;
        if (this._cache[cacheKey]) return this._cache[cacheKey];

        try {
            const { data: nodes, error } = await this.supabase
                .from('curriculum_nodes')
                .select('*')
                .eq('domain', domain);

            if (error) throw error;
            if (!nodes || nodes.length === 0) return null;

            this._cache[cacheKey] = nodes;
            return nodes;
        } catch (e) {
            console.warn(`CurriculumGraph: Failed to fetch nodes for ${domain}:`, e.message);
            return null;
        }
    }

    /**
     * Fetch all edges where at least one endpoint is in the given node IDs.
     */
    async getEdgesForNodes(nodeIds) {
        const cacheKey = `edges_${nodeIds.sort().join(',')}`;
        if (this._cache[cacheKey]) return this._cache[cacheKey];

        try {
            // Fetch edges where from_node or to_node is in our set
            const { data: edges, error } = await this.supabase
                .from('curriculum_edges')
                .select('*')
                .or(`from_node.in.(${nodeIds.join(',')}),to_node.in.(${nodeIds.join(',')})`);

            if (error) throw error;

            this._cache[cacheKey] = edges || [];
            return edges || [];
        } catch (e) {
            console.warn('CurriculumGraph: Failed to fetch edges:', e.message);
            return [];
        }
    }

    /**
     * Fetch edges that are internal to a domain (both endpoints in the domain).
     */
    async getInternalEdges(domain) {
        const cacheKey = `internal_edges_${domain}`;
        if (this._cache[cacheKey]) return this._cache[cacheKey];

        try {
            // Get all node IDs for this domain first
            const nodes = await this.getNodesForDomain(domain);
            if (!nodes) return [];

            const nodeIds = nodes.map(n => n.id);

            const { data: edges, error } = await this.supabase
                .from('curriculum_edges')
                .select('*')
                .in('from_node', nodeIds)
                .in('to_node', nodeIds);

            if (error) throw error;

            this._cache[cacheKey] = edges || [];
            return edges || [];
        } catch (e) {
            console.warn('CurriculumGraph: Failed to fetch internal edges:', e.message);
            return [];
        }
    }

    /**
     * Fetch cluster metadata for a domain.
     */
    async getClustersForDomain(domain) {
        const cacheKey = `clusters_${domain}`;
        if (this._cache[cacheKey]) return this._cache[cacheKey];

        try {
            const { data: clusters, error } = await this.supabase
                .from('curriculum_clusters')
                .select('*')
                .eq('domain', domain);

            if (error) throw error;

            this._cache[cacheKey] = clusters || [];
            return clusters || [];
        } catch (e) {
            console.warn('CurriculumGraph: Failed to fetch clusters:', e.message);
            return [];
        }
    }

    /**
     * Fetch cross-domain edges for a specific node.
     */
    async getCrossDomainEdges(nodeId) {
        try {
            const { data: edges, error } = await this.supabase
                .from('curriculum_edges')
                .select('*')
                .eq('edge_type', 'cross_domain')
                .or(`from_node.eq.${nodeId},to_node.eq.${nodeId}`);

            if (error) throw error;
            return edges || [];
        } catch (e) {
            console.warn('CurriculumGraph: Failed to fetch cross-domain edges:', e.message);
            return [];
        }
    }

    // ================================================================
    // Legacy format conversion
    // ================================================================

    /**
     * Convert graph data to the legacy format expected by SkillTreeViewer.
     *
     * The viewer expects:
     *   SKILL_TREE: { "Skill Name": { x, y, type?, constellation, state } }
     *   CONNECTIONS: [ ["From Name", "To Name"], ... ]
     *   CONSTELLATION_COLORS: { "Cluster Name": "#hex" }
     *   CONSTELLATION_POSITIONS: { "Cluster Name": { x, y } }
     *
     * @param {Array} nodes - curriculum_nodes rows
     * @param {Array} edges - curriculum_edges rows (internal to domain)
     * @param {Array} clusters - curriculum_clusters rows
     * @returns {Object} { SKILL_TREE, CONNECTIONS, CONSTELLATION_COLORS, CONSTELLATION_POSITIONS }
     */
    toLegacyFormat(nodes, edges, clusters) {
        // Build SKILL_TREE: keyed by the display name
        // For existing nodes, use legacy_name; for CSV nodes, use title
        const SKILL_TREE = {};
        const idToName = {}; // map node ID to the name used as SKILL_TREE key

        for (const node of nodes) {
            let displayName = node.legacy_name || node.title;
            // Distinct nodes can share a display name (e.g. two "Linear
            // Equations": M-114 and M24). Keying SKILL_TREE by name alone makes
            // the second overwrite the first and merges their edges. Disambiguate
            // colliding names by appending the unique node id so no node is lost.
            if (Object.prototype.hasOwnProperty.call(SKILL_TREE, displayName)) {
                displayName = `${displayName} (${node.id})`;
            }
            idToName[node.id] = displayName;

            const visual = typeof node.visual === 'string' ? JSON.parse(node.visual) : (node.visual || {});

            SKILL_TREE[displayName] = {
                x: visual.x || 0,
                y: visual.y || 0,
                constellation: node.cluster,
                state: 'locked',
                // Preserve root type for root nodes (first in each domain typically)
                ...(node.path_type === 'Spine' && !edges.some(e => e.to_node === node.id && e.edge_type === 'prerequisite_hard') ? { type: 'root' } : {}),
                // Extra metadata for the enhanced viewer
                _nodeId: node.id,
                _pathType: node.path_type,
                _stage: node.stage,
                _demonstration: node.demonstration || '',
                _primaryPath: node.primary_path
            };
        }

        // Build CONNECTIONS: only prerequisite_hard edges within this domain.
        // The viewer derives unlock gates (canUnlock) from CONNECTIONS, so soft
        // deps (leads_to / reinforces / cross_domain) must NOT go here or they'd
        // be treated as hard prerequisites. Mirrors viewer/3d/data.js, which
        // builds prereqs from prerequisite_hard only. (Per the graph plan in git history,
        // leads_to is a soft "suggested next" edge, not a gate.)
        const CONNECTIONS = [];
        for (const edge of edges) {
            if (edge.edge_type === 'prerequisite_hard') {
                const fromName = idToName[edge.from_node];
                const toName = idToName[edge.to_node];
                if (fromName && toName) {
                    CONNECTIONS.push([fromName, toName]);
                }
            }
        }

        // Build CONSTELLATION_COLORS and CONSTELLATION_POSITIONS
        const CONSTELLATION_COLORS = {};
        const CONSTELLATION_POSITIONS = {};

        for (const cluster of clusters) {
            CONSTELLATION_COLORS[cluster.name] = cluster.color;
            const pos = typeof cluster.label_position === 'string'
                ? JSON.parse(cluster.label_position)
                : cluster.label_position;
            if (pos) {
                CONSTELLATION_POSITIONS[cluster.name] = { x: pos.x, y: pos.y };
            }
        }

        return { SKILL_TREE, CONNECTIONS, CONSTELLATION_COLORS, CONSTELLATION_POSITIONS };
    }

    /**
     * High-level: Load a subject/domain and return legacy format data.
     * Returns null if loading fails (caller should fall back to hardcoded).
     *
     * @param {string} subject - Subject name (old "Art" or new "Creative" both work)
     * @returns {Object|null} Legacy format data or null
     */
    async loadDomainAsLegacy(subject) {
        const domain = CurriculumGraph.toDomain(subject);

        try {
            const [nodes, edges, clusters] = await Promise.all([
                this.getNodesForDomain(domain),
                this.getInternalEdges(domain),
                this.getClustersForDomain(domain)
            ]);

            if (!nodes || nodes.length === 0) {
                console.warn(`CurriculumGraph: No nodes found for domain "${domain}"`);
                return null;
            }

            const legacy = this.toLegacyFormat(nodes, edges, clusters);

            console.log(`CurriculumGraph: Loaded ${domain} — ${nodes.length} nodes, ${edges.length} edges, ${clusters.length} clusters`);
            return legacy;
        } catch (e) {
            console.warn(`CurriculumGraph: Failed to load domain "${domain}":`, e.message);
            return null;
        }
    }

    /**
     * Clear the internal cache (e.g., after a curriculum update).
     */
    clearCache() {
        this._cache = {};
    }
}

// Export for both browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CurriculumGraph;
}
