/**
 * StageWorkflow Module
 * Centralized logic for managing project stages, status transitions, and payment workflows.
 * This ensures consistency across Admin, Contractor, and Auditor dashboards.
 */
(function(){
    /**
     * Safely parses date strings into Date objects
     */
    function parseDate(value){
        if(!value) return null;
        const date=new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    /**
     * Sorts project stages by date (end date preferred, then start date)
     */
    function sortStages(stages){
        return [...(stages||[])].sort((a,b)=>{
            const aDate=parseDate(a?.end_date||a?.['end date']||a?.date||a?.['start date'])?.getTime()||0;
            const bDate=parseDate(b?.end_date||b?.['end date']||b?.date||b?.['start date'])?.getTime()||0;
            if(aDate!==bDate)return aDate-bDate;
            return String(a?.stage_name||'').localeCompare(String(b?.stage_name||''));
        });
    }

    /**
     * Standardizes status strings into a fixed set of recognized keywords
     */
    function normalizeStatus(stage){
        const status=String(stage?.status||'').trim();
        if(['Not Started','In Progress','Completed','Verified','Paid','Rejected'].includes(status)) return status;
        if(status==='Started') return 'In Progress';
        if(status==='Open'||status==='Pending Nod'||!status) return 'Not Started';
        return status;
    }

    /**
     * Normalizes payment status
     */
    function normalizePaymentStatus(stage){
        const payment=String(stage?.payment_status||'').trim();
        if(payment==='Released') return 'Released';
        return 'Pending';
    }

    /**
     * Getters for stage properties
     */
    function paymentDate(stage){ return stage?.payment_date || ''; }
    function amount(stage){ return stage?.stage_amount ?? ''; }
    function proof(stage){ return stage?.proof_image_url || stage?.image_url || ''; }

    /**
     * Checks if a stage is fully processed and paid
     */
    function isPaid(stage){
        return normalizeStatus(stage)==='Paid' || normalizePaymentStatus(stage)==='Released';
    }

    /**
     * Checks if a stage has been verified by the officer
     */
    function isVerified(stage){
        return normalizeStatus(stage)==='Verified';
    }

    /**
     * Checks if a stage can still be updated by a contractor
     */
    function isEditable(stage){
        if(isPaid(stage)) return false;
        return ['Not Started','In Progress','Rejected'].includes(normalizeStatus(stage));
    }

    /**
     * Core Logic: Resolves the state of each stage in a sequence
     * Calculates dependencies (e.g., stage 2 is locked if stage 1 isn't paid)
     */
    function resolveStages(stages){
        const ordered=sortStages(stages);
        return ordered.map((stage,index)=>{
            const previous=index>0 ? ordered[index-1] : null;
            const status=normalizeStatus(stage);
            const payment_status=normalizePaymentStatus(stage);
            const paid=isPaid(stage);
            
            // A stage is locked if the previous stage in the sequence hasn't been completed and paid
            const lockedByPrevious=Boolean(previous && !isPaid(previous));
            const waitingForVerification=status==='Completed' && !paid;
            const waitingForPayment=status==='Verified' && payment_status!=='Released' && !paid;
            const active=!lockedByPrevious && isEditable(stage) && !paid;
            
            let displayStatus=status;
            if(status==='Verified' && payment_status==='Released') displayStatus='Paid';
            if(status==='Not Started' && lockedByPrevious) displayStatus='Locked';
            
            return {
                ...stage,
                status,
                payment_status,
                payment_date: paymentDate(stage),
                stage_amount: amount(stage),
                proof_image_url: proof(stage),
                lockedByPrevious,
                waitingForVerification,
                waitingForPayment,
                active,
                displayStatus
            };
        });
    }

    /**
     * Finds the single stage that currently requires attention
     */
    function currentStage(stages){
        const resolved=resolveStages(stages);
        return resolved.find(stage=>stage.active||stage.waitingForVerification||stage.waitingForPayment) || null;
    }

    /**
     * Aggregates completion metrics for a project
     */
    function counts(stages){
        const resolved=resolveStages(stages);
        return {
            total: resolved.length,
            paid: resolved.filter(stage=>isPaid(stage)).length,
            verified: resolved.filter(stage=>isVerified(stage)||isPaid(stage)).length,
            remaining: resolved.filter(stage=>!isPaid(stage)).length
        };
    }

    /**
     * Automatically updates project status based on stage completion
     */
    function deriveProjectStatus(project,stages){
        const currentStatus=String(project?.Status ?? project?.status ?? '').trim() || 'Open';
        const summary=counts(stages||[]);
        // If all stages are paid, the project is considered 'Closed'
        if(summary.total>0 && summary.paid===summary.total) return 'Closed';
        return currentStatus;
    }

    // Export StageWorkflow API
    window.StageWorkflow={
        sortStages,
        normalizeStatus,
        normalizePaymentStatus,
        resolveStages,
        currentStage,
        counts,
        deriveProjectStatus,
        isPaid,
        isVerified,
        isEditable
    };
})();
