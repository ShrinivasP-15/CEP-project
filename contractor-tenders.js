/**
 * Contractor Tenders Module
 * Handles tender bidding, active project tracking, stage completion reporting,
 * and extension requests for contractors.
 */
const TENDER_META_KEY='tenderMeta';
const STAGE_UPDATE_KEY='contractorStageUpdates';
const STAGE_META_KEY='contractorStageMeta';
const REMOVED_CONTRACTOR_BLOCKS_KEY='removedContractorBlocks';
const STAGE_EXTENSION_REQUESTS_KEY='stageExtensionRequests';

// DOM element references
const messageBox=document.getElementById('message');
const searchInput=document.getElementById('searchInput');
const stageForm=document.getElementById('stageForm');
const extensionForm=document.getElementById('extensionForm');

// State variables
let currentUser=null;
let tenders=[];
let applications=[];
let stages=[];
let selectedTenderId='';
let selectedHistoryTenderId='';
let myMetric=null;
let stageExtensionRequests=[];
let useLocalExtensionRequests=false;

/**
 * Global notification helper
 */
function showMessage(text,type){messageBox.textContent=text;messageBox.className=`msg ${type}`;setTimeout(()=>messageBox.className='msg',4000)}

/**
 * XSS prevention helper
 */
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}

// Local Storage data retrieval helpers
function getTenderMeta(){try{return JSON.parse(localStorage.getItem(TENDER_META_KEY)||'{}')}catch{return {}}}
function mergeTenderMeta(items){const meta=getTenderMeta();return items.map(item=>meta[item.proj_id]?{...item,...meta[item.proj_id]}:item)}
function getLocalStages(){try{return JSON.parse(localStorage.getItem(STAGE_UPDATE_KEY)||'[]')}catch{return []}}
function setLocalStages(items){localStorage.setItem(STAGE_UPDATE_KEY,JSON.stringify(items))}
function getStageMeta(){try{return JSON.parse(localStorage.getItem(STAGE_META_KEY)||'{}')}catch{return {}}}
function setStageMeta(items){localStorage.setItem(STAGE_META_KEY,JSON.stringify(items))}
function getLocalExtensionRequests(){try{return JSON.parse(localStorage.getItem(STAGE_EXTENSION_REQUESTS_KEY)||'[]')}catch{return []}}
function setLocalExtensionRequests(items){localStorage.setItem(STAGE_EXTENSION_REQUESTS_KEY,JSON.stringify(items))}
function getRemovedContractorBlocks(){try{return JSON.parse(localStorage.getItem(REMOVED_CONTRACTOR_BLOCKS_KEY)||'{}')}catch{return {}}}

/**
 * Database schema compatibility: Handles missing columns by gracefully stripping them
 */
async function updateStageRecord(stageId,record){
    let currentRecord={...record};
    for(let attempt=0;attempt<6;attempt++){
        const response=await supabaseClient.from('Stage Tracking').update(currentRecord).eq('stage_id',stageId);
        if(!response.error)return response;
        
        // Use fallback utility to identify missing columns from error message
        const fallback=nextStageSchemaFallback(currentRecord,response.error);
        if(!fallback)return response;
        currentRecord=fallback.fallbackRecord;
    }
    return { error: { message: 'Unable to update stage because the Stage Tracking table is missing required columns.' } };
}

/**
 * Checks if a contractor was previously removed from a project and should be blocked from re-applying
 */
function wasRemovedFromTender(tenderId){
    const blocked=getRemovedContractorBlocks();
    const projectKey=String(tenderId??'').trim();
    const blockedIdentities=Array.isArray(blocked[projectKey])?blocked[projectKey].map(normalizeIdentity):[];
    if(!blockedIdentities.length) return false;
    
    // Check all possible identities of the current user (ID, email, username)
    const myIdentities = [currentUser?.id,currentUser?.email,currentUser?.username].map(normalizeIdentity).filter(v=>v && !['not assigned','null','undefined'].includes(v));
    return myIdentities.some(identity=>blockedIdentities.includes(identity));
}

/**
 * Helper: Logic for current tender status (taking republishing into account)
 */
function tenderStatusValue(tender){
    return tender?.republished===true?'Re-published':StageWorkflow.deriveProjectStatus(tender,stageOrderForTender(tender?.proj_id));
}

/**
 * Helper: Logic for identifying projects the current contractor is assigned to
 */
function myAssignedProjects(){
    return tenders.filter(t=>PerformanceSystem.contractorMatchesProject(currentUser,t));
}

/**
 * Main Data Fetcher: Loads tenders, applications, stages, and performance metrics
 */
async function loadData(){
    // Sync user details to get latest performance scores
    try{
        const { data:userRecord }=await supabaseClient.from('users').select('id, username, email, role, performance_score, is_blacklisted').eq('email',currentUser.email).maybeSingle();
        if(userRecord){
            currentUser={...currentUser,...userRecord};
            AuthSession.setCurrentUser(currentUser);
        }
    }catch(error){ console.error(error); }

    const [tenderRes,applicationRes,extensionRes]=await Promise.all([
        supabaseClient.from('Project').select('*').order('Start Date',{ascending:false}),
        supabaseClient.from('Applications').select('*').order('application_id',{ascending:false}),
        supabaseClient.from('StageExtensionRequests').select('*').order('requested_date',{ascending:false})
    ]);

    if(tenderRes.error){console.error(tenderRes.error);showMessage('Unable to load tenders.','err');return}
    
    tenders=mergeTenderMeta(tenderRes.data||[]);
    applications=(applicationRes.data||[]).map(app=>({...app,status:app.status||'Pending'}));

    // Load stage tracking with local storage fallback for offline support or schema mismatch
    const stageRes=await supabaseClient.from('Stage Tracking').select('*');
    if(stageRes.error){
        console.error(stageRes.error);
        stages=getLocalStages();
        showMessage('Tenders loaded. Stage updates are using local storage.','warn');
    }else{
        stages=normalizeDbStages(stageRes.data||[]);
        const localStages=getLocalStages();
        const ids=new Set(stages.map(item=>item.stage_id));
        stages=[...localStages.filter(item=>!ids.has(item.stage_id)),...stages];
    }
    
    stageExtensionRequests=extensionRes.data||getLocalExtensionRequests();

    // Sync performance scoring system
    try{
        const perf=await PerformanceSystem.syncContractorPerformance(supabaseClient,{persist:true});
        myMetric=perf.metrics.find(m=>String(m.id)===String(currentUser.id)||normalizeIdentity(m.email)===normalizeIdentity(currentUser.email))||null;
    }catch(error){ console.error(error); }
    
    render();
}

/**
 * Action: Submits a new tender application
 */
async function applyForTender(button){
    const tenderId=button.dataset.id;
    const activeProjectCount=myWork().length;
    
    // Validation: Check blacklisting, project limits, and removal history
    if(myMetric?.isBlacklisted){showMessage('Blacklisted contractors cannot apply for tenders.','err');return}
    if(wasRemovedFromTender(tenderId)){showMessage('You were removed from this project earlier.','err');return}
    if(activeProjectCount >= PerformanceSystem.MAX_ACTIVE_PROJECTS){
        showMessage(`${PerformanceSystem.getWorkloadMessage()} You already have ${activeProjectCount} active projects.`,'err');
        return;
    }

    button.disabled=true;
    button.textContent='Applying...';
    try{
        const payload={application_id:uuid(),tender_id:tenderId,contractor_id:currentUser.email,contractor_name:currentUser.username,status:'Pending'};
        const { error }=await supabaseClient.from('Applications').insert([payload]);
        if(error)throw error;
        showMessage('Applied successfully','ok');
        await loadData();
    }catch(error){
        console.error(error);
        showMessage(`Unable to apply: ${error.message}`,'err');
    }finally{
        button.disabled=false;
        button.textContent='Apply';
    }
}

/**
 * Action: Updates a project stage (In Progress or Completed) with optional proof image
 */
stageForm.addEventListener('submit',async e=>{
    e.preventDefault();
    if(!selectedTenderId){showMessage('Select a tender first.','warn');return}
    if(myMetric?.isBlacklisted){showMessage('Blacklisted contractors cannot update stages.','err');return}
    
    const stageId=document.getElementById('stageSelect').value;
    const status=document.getElementById('stageStatus').value;
    const remarks=document.getElementById('remarks').value.trim();
    const date=document.getElementById('stageDate').value;
    
    if(!stageId){showMessage('Please select a stage to update.','err');return}

    // Process uploaded proof image
    const fileInput=document.getElementById('stageImage');
    const file=fileInput.files[0];
    let imageUrl='';
    if(file){
        try{ imageUrl=await readImageFile(file); }catch(err){ showMessage('Failed to read image','err'); return; }
    }

    const existingStage = stages.find(s=>s.stage_id===stageId);
    if(!canEditStage(existingStage)){showMessage('Only the current active stage can be updated.','err');return}

    const updatePayload={
        contractor_id:currentUser.id||currentUser.email,
        status,
        remarks,
        date,
        completion_date: status==='Completed'?date:null,
        image_url: imageUrl || existingStage?.image_url,
        proof_image_url: imageUrl || existingStage?.proof_image_url
    };

    try{
        // Save to Supabase
        let response=await updateStageRecord(stageId,updatePayload);
        
        // Also save locally for persistence
        const localStages=getLocalStages().filter(item=>item.stage_id!==stageId);
        localStages.unshift({...existingStage, ...updatePayload, stage_id:stageId, proj_id:selectedTenderId});
        setLocalStages(localStages);
        
        if(!response.error){
            await PerformanceSystem.syncContractorPerformance(supabaseClient,{persist:true});
            showMessage('Stage updated successfully','ok');
        }else{
            showMessage(`Stage saved locally. Database error: ${response.error.message}`,'warn');
        }
        clearStageForm();
        await loadData();
    }catch(error){
        console.error(error);
        showMessage(`Unable to save stage: ${error.message}`,'err');
    }
});

// Realtime update listener
window.addEventListener('DOMContentLoaded',async()=>{
    loadUserInfo();
    await loadData();
    setInterval(loadData, 15000); // Polling fallback
    try {
        supabaseClient.channel('contractor-realtime')
            .on('postgres_changes',{event:'*',schema:'public',table:'Project'},()=>loadData())
            .on('postgres_changes',{event:'*',schema:'public',table:'Applications'},()=>loadData())
            .on('postgres_changes',{event:'*',schema:'public',table:'Stage Tracking'},()=>loadData())
            .on('postgres_changes',{event:'*',schema:'public',table:'StageExtensionRequests'},()=>loadData())
            .subscribe();
    } catch(e){ console.warn('Realtime subscription failed.',e); }
});
