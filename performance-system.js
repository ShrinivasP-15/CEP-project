/**
 * PerformanceSystem Module
 * Automated monitoring system for contractor performance scoring.
 * It tracks missed deadlines, rejected verifications, and stale updates.
 */
(function () {
    const DEFAULT_SCORE = 100;
    const WARNING_THRESHOLD = 50;
    const AUTO_BLACKLIST_THRESHOLD = 40;
    const STALE_UPDATE_DAYS = 7;
    const MAX_ACTIVE_PROJECTS = 3;
    const BLACKLIST_OVERRIDE_KEY = 'manualBlacklistOverrides';

    // Utility: Standardizes string comparison
    function normalizeText(value) {
        return String(value ?? '').trim().toLowerCase();
    }

    function normalizeRole(value) {
        return normalizeText(value);
    }

    function isContractor(user) {
        return normalizeRole(user?.role) === 'contractor';
    }

    // Storage utility for local persistence (fallback)
    function readJsonStorage(key, fallback) {
        try {
            return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
        } catch {
            return fallback;
        }
    }

    // Blacklist manual override management
    function getBlacklistOverrides() {
        return readJsonStorage(BLACKLIST_OVERRIDE_KEY, []);
    }

    function hasBlacklistOverride(contractorId) {
        return getBlacklistOverrides().includes(String(contractorId));
    }

    function setBlacklistOverride(contractorId, enabled) {
        const current = new Set(getBlacklistOverrides().map(String));
        if (enabled) {
            current.add(String(contractorId));
        } else {
            current.delete(String(contractorId));
        }
        localStorage.setItem(BLACKLIST_OVERRIDE_KEY, JSON.stringify([...current]));
    }

    /**
     * Helper: Matches a contractor to a project using multiple identity fields
     */
    function contractorMatchesProject(contractor, project) {
        const assignedId = project?.assigned_contractor_id ?? project?.assignedContractorId ?? null;
        const contractorId = String(contractor?.id ?? '').trim();
        const assignedOfficer = normalizeText(project?.['Assigned officer'] ?? project?.assigned_officer ?? '');
        const contractorName = normalizeText(contractor?.username);
        const contractorEmail = normalizeText(contractor?.email);

        // Priority 1: Match by unique ID
        if (assignedId !== null && assignedId !== undefined && String(assignedId).trim() !== '') {
            return String(assignedId).trim() === contractorId;
        }

        // Priority 2: Match by username or email (legacy support)
        return Boolean(
            assignedOfficer &&
            (assignedOfficer === contractorName || assignedOfficer === contractorEmail)
        );
    }

    /**
     * Core Algorithm: Calculates performance metrics and blacklist status
     */
    function calculateMetric(contractor, context) {
        const today = new Date();
        today.setHours(0,0,0,0);
        
        const assignedProjects = (context.projects || []).filter(p => contractorMatchesProject(contractor, p));
        const activeProjects = assignedProjects.filter(p => {
            return (p?.assigned_contractor_id || p?.['Assigned officer']) && normalizeText(p?.Status ?? p?.status) !== 'closed';
        });
        
        const verificationMap = context.verificationMap;
        const stageMap = context.stageMap;
        let score = DEFAULT_SCORE;

        const details = {
            totalAssignedTenders: assignedProjects.length,
            activeProjects: activeProjects.length,
            missedDeadlines: 0,
            rejectedVerifications: 0,
            staleUpdates: 0,
            completedOnTime: 0,
            reasons: []
        };

        assignedProjects.forEach(project => {
            const projectKey = String(project?.proj_id ?? '');
            const deadline = toDate(project?.['End Date'] ?? project?.end_date);
            const status = normalizeText(project?.Status ?? project?.status);
            
            const verifications = verificationMap.get(projectKey) || [];
            const stages = stageMap.get(projectKey) || [];
            
            // Penalize for missed overall project deadline
            if (deadline && deadline < today && status !== 'closed') {
                score -= 20;
                details.missedDeadlines += 1;
            }

            // Penalize for rejected stage verifications
            if (verifications.some(record => normalizeText(record?.['Verification Satus'] || record?.verification_status) === 'rejected')) {
                score -= 15;
                details.rejectedVerifications += 1;
            }

            // Penalize for inactivity (no updates for 7 days)
            const latestActivity = getLatestDate([
                ...stages.map(s => s.date),
                ...verifications.map(v => v.date || v.created_at || v.updated_at)
            ]);
            if (!latestActivity || Math.floor((today.getTime() - latestActivity.getTime()) / (1000 * 60 * 60 * 24)) >= STALE_UPDATE_DAYS) {
                score -= 10;
                details.staleUpdates += 1;
            }

            // Bonus for completing projects on or before deadline
            if (status === 'closed' && deadline && latestActivity && latestActivity <= deadline) {
                score += 10;
                details.completedOnTime += 1;
            }
        });

        const performanceScore = Math.max(0, Math.min(100, Math.round(score)));
        const shouldWarn = performanceScore < WARNING_THRESHOLD;
        const shouldAutoBlacklist = performanceScore < AUTO_BLACKLIST_THRESHOLD;
        const manualOverride = hasBlacklistOverride(contractor.id);
        
        // Final blacklist status: Auto-blacklist (if not overridden) OR manual admin flag
        const isBlacklisted = (shouldAutoBlacklist && !manualOverride) || contractor.is_blacklisted === true || contractor.is_blacklisted === 1;

        return {
            id: contractor.id,
            username: contractor.username || 'Unknown',
            email: contractor.email || '-',
            performanceScore,
            shouldWarn,
            shouldAutoBlacklist,
            isBlacklisted,
            details
        };
    }

    /**
     * Main Data Loader: Aggregates users, projects, verifications, and stages
     */
    async function loadPerformanceData(client) {
        const [usersRes, projectsRes, verificationsRes, stageRes] = await Promise.all([
            client.from('users').select('id, username, email, role, performance_score, is_blacklisted'),
            client.from('Project').select('*'),
            client.from('Verification').select('*'),
            client.from('Stage Tracking').select('*').catch(() => ({ data: [] }))
        ]);

        const contractors = (usersRes.data || []).filter(isContractor);
        const verificationMap = buildVerificationMap(verificationsRes.data || []);
        const stageMap = buildStageMap(stageRes.data || []);

        const metrics = contractors.map(contractor => calculateMetric(contractor, {
            projects: projectsRes.data || [],
            verificationMap,
            stageMap
        }));

        return { metrics, contractors };
    }

    /**
     * Sync: Recalculates metrics and updates the database
     */
    async function syncContractorPerformance(client, options = {}) {
        const data = await loadPerformanceData(client);
        if (options.persist) {
            for (const metric of data.metrics) {
                const payload = {
                    performance_score: metric.performanceScore,
                    // Note: We don't force is_blacklisted to false if the score improves, 
                    // admin must manually unblacklist if they flagged the user.
                    is_blacklisted: metric.shouldAutoBlacklist && !metric.manualOverride ? true : metric.isBlacklisted
                };
                await client.from('users').update(payload).eq('id', metric.id);
            }
        }
        return data;
    }

    // Internal mapping helpers
    function toDate(v) { if(!v) return null; const d=new Date(v); return isNaN(d.getTime())?null:d; }
    function getLatestDate(vals) { return vals.map(toDate).filter(Boolean).sort((a,b)=>b-a)[0]||null; }
    function buildVerificationMap(recs) {
        const m=new Map();
        recs.forEach(r=>{ const k=String(r.proj_id); if(!m.has(k)) m.set(k,[]); m.get(k).push(r); });
        return m;
    }
    function buildStageMap(recs) {
        const m=new Map();
        recs.forEach(r=>{ const k=String(r.proj_id); if(!m.has(k)) m.set(k,[]); m.get(k).push(r); });
        return m;
    }

    // Export PerformanceSystem API
    window.PerformanceSystem = {
        WARNING_THRESHOLD,
        AUTO_BLACKLIST_THRESHOLD,
        MAX_ACTIVE_PROJECTS,
        normalizeText,
        contractorMatchesProject,
        loadPerformanceData,
        syncContractorPerformance,
        getWorkloadMessage: () => `Maximum ${MAX_ACTIVE_PROJECTS} active projects allowed for a contractor.`,
        getSetupSqlPath: () => 'contractor-performance-setup.sql'
    };
})();
