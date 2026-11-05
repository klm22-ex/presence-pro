/* === Supabase === */
let ppSupabase = null;
let ppSession = null;
let ppOrganizationId = null;
let ppUserRole = null;
let employeePortalUser = null;
const PP_CONFIG = window.PRESENCEPRO_SUPABASE || {};
const PP_SUPABASE_READY = window.supabase && PP_CONFIG.url && PP_CONFIG.key && !PP_CONFIG.url.includes('YOUR_PROJECT_REF') && !PP_CONFIG.key.includes('YOUR_SUPABASE');
if(PP_SUPABASE_READY){
  ppSupabase = window.supabase.createClient(PP_CONFIG.url, PP_CONFIG.key, {auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});
}
function ppHasSupabase(){return !!ppSupabase;}
function ppAuthModal(show){const m=document.getElementById('authModal'); if(m)m.classList.toggle('open',show);}
function ppSetAuthStatus(msg){const el=document.getElementById('authStatus');if(el)el.textContent=msg||'';}
function ppSetDemoIdentity(){
  const name=document.querySelector('.profile-text strong'); if(name)name.textContent='Mode démonstration';
}
async function ppLoadOrganization(){
  const {data,error}=await ppSupabase.from('profiles').select('organization_id,full_name,role').eq('id',ppSession.user.id).maybeSingle();
  if(error)throw error;
  if(!data){
    ppUserRole=null;
    const pending=JSON.parse(localStorage.getItem('pp_pending_org')||'null');
    if(pending){
      const {data:orgId,error:orgErr}=await ppSupabase.rpc('create_organization',{p_name:pending.org,p_full_name:pending.name});
      if(orgErr)throw orgErr;
      localStorage.removeItem('pp_pending_org');
      ppOrganizationId=orgId;
      const {data:createdProfile,error:profileErr}=await ppSupabase.from('profiles').select('organization_id,role').eq('id',ppSession.user.id).maybeSingle();
      if(profileErr)throw profileErr;
      ppUserRole=createdProfile?.role||null;
      if(createdProfile?.organization_id)ppOrganizationId=createdProfile.organization_id;
    }else{
      const {data:emp,error:empErr}=await ppSupabase.from('employees').select('organization_id').eq('auth_user_id',ppSession.user.id).maybeSingle();
      if(empErr)throw empErr;if(emp){ppOrganizationId=emp.organization_id;ppUserRole='employee';}
    }
  }else{ppOrganizationId=data.organization_id;ppUserRole=data.role||null;}
}
function ppLocalDateISO(date=new Date()){const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`;}
function ppTime(value){return value?new Date(value).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'—';}
function ppDateLabel(value){return value?new Date(value+'T00:00:00').toLocaleDateString('fr-FR'):'—';}
function ppMinutes(value){if(!value||!/^\d{2}:\d{2}$/.test(value))return null;const [h,m]=value.split(':').map(Number);return h*60+m;}
function ppGetSettings(){try{return JSON.parse(localStorage.getItem('presencepro_settings_v1')||'{}')}catch{return {};}}
function ppAttendanceStatus(arrival){if(!arrival)return 'absent';const cfg=ppGetSettings(),cutoff=ppMinutes(cfg.startTime||'08:00');const dt=new Date(arrival);const mins=dt.getHours()*60+dt.getMinutes();return mins>(cutoff??480)+15?'late':'present';}
function ppRefreshDashboard(){
  const total=employees.filter(e=>e.active!==false).length;
  const present=employees.filter(e=>e.active!==false&&e.status!=='absent').length;
  const late=employees.filter(e=>e.active!==false&&e.status==='late').length;
  const absent=Math.max(0,total-present);
  const pct=total?Math.round(present/total*100):0;
  [['totalEmployees',total],['presentCount',present],['lateCount',late],['absentCount',absent]].forEach(([id,val])=>{const el=document.getElementById(id);if(el)el.textContent=val;});
  const ring=document.querySelector('#progressRing strong');if(ring)ring.textContent=pct+'%';
  const legends=document.querySelectorAll('.progress-wrap .legend>div strong');if(legends.length===3){legends[0].textContent=present;legends[1].textContent=late;legends[2].textContent=absent;}
  const positive=document.querySelector('#presentCount')?.parentElement?.querySelector('small');if(positive)positive.textContent=`${pct}% de l’effectif`;
  const ringEl=document.getElementById('progressRing');if(ringEl)ringEl.style.setProperty('--progress',pct+'%');
  renderReports();
}
async function ppLoadEmployees(){
  if(!ppSupabase||!ppOrganizationId)return;
  const today=ppLocalDateISO();
  const since=new Date();since.setDate(since.getDate()-30);const sinceISO=ppLocalDateISO(since);
  const [{data:emps,error:e1},{data:att,error:e2}]=await Promise.all([
    ppSupabase.from('employees').select('*').order('created_at',{ascending:true}),
    ppSupabase.from('attendance').select('*').gte('attendance_date',sinceISO).lte('attendance_date',today).order('attendance_date',{ascending:false})
  ]);
  if(e1)throw e1;if(e2)throw e2;
  employees.length=0;
  const employeeMap=new Map((emps||[]).map(e=>[e.id,e]));
  for(const e of (emps||[])){
    const a=(att||[]).find(x=>x.employee_id===e.id&&x.attendance_date===today);
    let photo='';
    if(e.photo_path){const {data}=await ppSupabase.storage.from('employee-photos').createSignedUrl(e.photo_path,3600);photo=data?.signedUrl||'';}
    const arrival=a?.arrival_at||null;
    employees.push({id:e.id,name:e.full_name,email:e.email||'',code:e.code,department:e.department||'Autre',active:e.active!==false,status:ppAttendanceStatus(arrival),time:ppTime(arrival),initials:e.full_name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase(),photo,authUserId:e.auth_user_id||null,accountLinked:!!e.auth_user_id,fingerprint:false,nativeBiometric:false,biometricId:null,supabaseId:e.id});
  }
  history.splice(0,history.length,...(att||[]).map(r=>{const emp=employeeMap.get(r.employee_id);return [ppDateLabel(r.attendance_date),emp?.full_name||'Employé supprimé',ppTime(r.arrival_at),ppTime(r.departure_at),r.arrival_at?ppAttendanceStatus(r.arrival_at):'absent'];}));
  renderRecent();renderEmployees();renderHistory();renderBiometric();ppRefreshDashboard();
}
async function ppCreateEmployee({name,email,code,department,photoFile}){
  const enrollmentCode='PP-'+crypto.randomUUID().replace(/-/g,'').slice(0,8).toUpperCase();
  const {data:e,error}=await ppSupabase.from('employees').insert({organization_id:ppOrganizationId,full_name:name,email:email.trim().toLowerCase(),code,department,enrollment_code:enrollmentCode}).select().single();
  if(error)throw error;
  let photoPath=null;
  if(photoFile){
    const ext=(photoFile.name.split('.').pop()||'jpg').toLowerCase();
    photoPath=`${ppOrganizationId}/${e.id}.${ext}`;
    const {error:upErr}=await ppSupabase.storage.from('employee-photos').upload(photoPath,photoFile,{upsert:true,contentType:photoFile.type});
    if(upErr)throw upErr;
    const {error:upDbErr}=await ppSupabase.from('employees').update({photo_path:photoPath}).eq('id',e.id);
    if(upDbErr)throw upDbErr;
  }
  await ppLoadEmployees();
  return enrollmentCode;
}
async function ppRecordAttendance(emp,type){
  const now=new Date().toISOString(),date=ppLocalDateISO(),employeeId=emp.supabaseId||emp.id;
  const {data:existing,error:findError}=await ppSupabase.from('attendance').select('id,arrival_at,departure_at').eq('employee_id',employeeId).eq('attendance_date',date).maybeSingle();
  if(findError)throw findError;
  if(type==='arrival'&&existing?.arrival_at)throw new Error('L’arrivée est déjà enregistrée aujourd’hui.');
  if(type==='departure'&&!existing?.arrival_at)throw new Error('Enregistrez d’abord l’arrivée.');
  if(type==='departure'&&existing?.departure_at)throw new Error('Le départ est déjà enregistré aujourd’hui.');
  if(existing){const patch={source:'admin'};patch[type==='arrival'?'arrival_at':'departure_at']=now;const {error}=await ppSupabase.from('attendance').update(patch).eq('id',existing.id);if(error)throw error;}
  else{if(type!=='arrival')throw new Error('Enregistrez d’abord l’arrivée.');const payload={organization_id:ppOrganizationId,employee_id:employeeId,attendance_date:date,arrival_at:now,source:'admin'};const {error}=await ppSupabase.from('attendance').insert(payload);if(error)throw error;}
  await ppLoadEmployees();
}
async function ppSaveBiometricCredential(emp,credentialId){
  const {error}=await ppSupabase.from('biometric_credentials').upsert({organization_id:ppOrganizationId,employee_id:emp.supabaseId||emp.id,credential_id:credentialId,device_label:navigator.userAgent.slice(0,120)},{onConflict:'credential_id'});
  if(error)throw error;
}
async function ppLoadBiometricCredentials(){
  if(!ppSupabase||!ppOrganizationId)return;
  const {data,error}=await ppSupabase.from('biometric_credentials').select('employee_id,credential_id');
  if(error)throw error;
  for(const e of employees){const row=(data||[]).find(x=>x.employee_id===e.supabaseId||x.employee_id===e.id);e.nativeBiometric=!!row;e.biometricId=row?.credential_id||null;}
}
async function ppInit(){
  if(!ppHasSupabase()){ppSetDemoIdentity();return;}
  const {data}=await ppSupabase.auth.getSession();ppSession=data.session;employeePortalUser=data.session?.user||null;
  ppSupabase.auth.onAuthStateChange((_event,session)=>{ppSession=session;employeePortalUser=session?.user||null;if(!session){ppUserRole=null;ppOrganizationId=null;}});
  if(!ppSession){return;}
  await ppBootCloud();
}
async function ppBootCloud(){
  try{await ppLoadOrganization();await ppLoadEmployees();await ppLoadBiometricCredentials();await ppLoadOrganizationSettings();await loadLeaveRequests();renderBiometric();}
  catch(err){console.error(err);showToast('Connexion Supabase : '+(err.message||'erreur'));}
}
const employees = [
  {id:1,name:"Jean Mukendi",code:"EMP001",department:"Administration",status:"present",time:"07:58",initials:"JM",photo:"",fingerprint:true,biometricId:"FP-001"},
  {id:2,name:"Paul Kabeya",code:"EMP002",department:"Finance",status:"late",time:"08:32",initials:"PK",photo:"",fingerprint:true,biometricId:"FP-002"},
  {id:3,name:"Marie Kalala",code:"EMP003",department:"Ressources humaines",status:"present",time:"07:55",initials:"MK",photo:"",fingerprint:true,biometricId:"FP-003"},
  {id:4,name:"David Ilunga",code:"EMP004",department:"Informatique",status:"absent",time:"—",initials:"DI",photo:"",fingerprint:false,biometricId:null},
  {id:5,name:"Sarah Mbuyi",code:"EMP005",department:"Administration",status:"present",time:"07:49",initials:"SM",photo:"",fingerprint:true,biometricId:"FP-005"},
  {id:6,name:"Christian Banza",code:"EMP006",department:"Finance",status:"present",time:"08:02",initials:"CB",photo:"",fingerprint:true,biometricId:"FP-006"},
  {id:7,name:"Grâce Tshibanda",code:"EMP007",department:"Enseignement",status:"present",time:"07:51",initials:"GT",photo:"",fingerprint:true,biometricId:"FP-007"},
  {id:8,name:"Michel Kanku",code:"EMP008",department:"Informatique",status:"late",time:"08:21",initials:"MK",photo:"",fingerprint:false,biometricId:null}
];

const history = [
  ["07/10/2026","Jean Mukendi","07:58","16:04","present"],
  ["07/10/2026","Paul Kabeya","08:32","—","late"],
  ["07/10/2026","Marie Kalala","07:55","16:01","present"],
  ["07/10/2026","Sarah Mbuyi","07:49","16:08","present"],
  ["07/10/2026","Christian Banza","08:02","15:58","present"],
  ["06/10/2026","Jean Mukendi","07:53","16:03","present"],
  ["06/10/2026","Paul Kabeya","08:27","16:11","late"]
];

const labels = {present:"Présent",late:"En retard",absent:"Absent"};

function showApp(mode){
  const landing=document.getElementById('landingPage'), shell=document.getElementById('appShell');
  if(landing)landing.style.display='none';
  if(shell){shell.style.display='flex';shell.classList.remove('mode-admin','mode-agent');shell.classList.add(mode==='agent'?'mode-agent':'mode-admin');}
}
async function enterAdmin(afterAuthentication=false){
  // Un clic depuis l'accueil exige toujours une nouvelle saisie des identifiants.
  if(!afterAuthentication){
    if(ppSupabase && ppSession){
      try{await ppSupabase.auth.signOut();}catch(err){console.error('Déconnexion avant authentification:',err);}
      ppSession=null;ppUserRole=null;ppOrganizationId=null;employeePortalUser=null;
    }
    showApp('admin');ppAuthModal(true);ppSetAuthStatus('');
    const form=document.getElementById('authForm');if(form)form.reset();
    return;
  }
  if(!ppSession){showApp('admin');ppAuthModal(true);return;}
  try{
    await ppLoadOrganization();
    if(!['owner','admin'].includes(ppUserRole)){
      await ppSupabase.auth.signOut();
      ppSession=null;ppUserRole=null;ppOrganizationId=null;employeePortalUser=null;
      ppAuthModal(false);backToHome();
      showToast('Accès refusé : ce compte ne possède pas les droits administrateur.');
      return;
    }
    showApp('admin');ppAuthModal(false);navigateTo('dashboard');
    ppSetAuthStatus('');
  }catch(err){
    ppAuthModal(true);
    ppSetAuthStatus(err.message||'Impossible de vérifier les droits administrateur.');
  }
}
function enterAgent(){
  showApp('agent');
  navigateTo('agentHome');
  loadEmployeeIdentity();
  loadAgentHistory();loadMyLeaveRequests();
}
async function agentSignOut(){
  if(!ppSupabase||!employeePortalUser){backToHome();return;}
  if(!confirm('Voulez-vous vraiment déconnecter ce compte employé de ce téléphone ?'))return;
  try{
    const {error}=await ppSupabase.auth.signOut();
    if(error)throw error;
    ppSession=null;employeePortalUser=null;
    const profile=document.getElementById('agentProfileCard'),identity=document.getElementById('employeeIdentity'),greeting=document.getElementById('agentGreeting');
    if(profile)profile.innerHTML='<div class="agent-profile-empty">Vous êtes déconnecté. Connectez-vous pour consulter votre profil.</div>';
    if(identity)identity.innerHTML='<div class="person-avatar">?</div><div><strong>Non connecté</strong><small>Connectez votre compte employé.</small></div>';
    if(greeting)greeting.textContent='👋';
    showToast('Compte employé déconnecté.');
    backToHome();
  }catch(e){showToast('Déconnexion impossible : '+(e.message||'erreur'));}
}
function backToHome(){
  const landing=document.getElementById('landingPage'), shell=document.getElementById('appShell');
  if(shell){shell.classList.remove('mode-admin','mode-agent');shell.style.display='none';}
  if(landing)landing.style.display='flex';
  ppAuthModal(false);
}
async function loadAgentHistory(){
  const body=document.getElementById('agentHistoryTable');
  if(!body)return;
  if(!ppSupabase||!employeePortalUser){body.innerHTML='<tr><td colspan="4" style="text-align:center;padding:28px;color:#738196">Connectez votre compte employé pour voir votre historique.</td></tr>';return;}
  try{
    const {data:emp}=await ppSupabase.from('employees').select('id,full_name').eq('auth_user_id',employeePortalUser.id).maybeSingle();
    if(!emp){body.innerHTML='<tr><td colspan="4" style="text-align:center;padding:28px;color:#738196">Votre compte n’est pas encore associé à un profil employé.</td></tr>';return;}
    const {data,error}=await ppSupabase.from('attendance').select('attendance_date,arrival_at,departure_at').eq('employee_id',emp.id).order('attendance_date',{ascending:false}).limit(50);
    if(error)throw error;
    body.innerHTML=(data||[]).map(r=>{const a=r.arrival_at?new Date(r.arrival_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'—';const d=r.departure_at?new Date(r.departure_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):'—';const st=r.arrival_at?(r.departure_at?'Complet':'En cours'):'—';return `<tr><td>${new Date(r.attendance_date+'T00:00:00').toLocaleDateString('fr-FR')}</td><td>${a}</td><td>${d}</td><td><span class="status ${r.departure_at?'present':'late'}">${st}</span></td></tr>`}).join('')||'<tr><td colspan="4" style="text-align:center;padding:28px;color:#738196">Aucun pointage enregistré.</td></tr>';
  }catch(e){body.innerHTML=`<tr><td colspan="4" style="text-align:center;padding:28px;color:#b45309">Impossible de charger l’historique.</td></tr>`;}
}
function navigateTo(id){
  const agentSections=['agentHome','agentHistory','kiosk'];
  const shell=document.getElementById('appShell');
  if(shell?.classList.contains('mode-agent')&&!agentSections.includes(id)){
    showToast('Cette rubrique est réservée à l’administration.');
    id='agentHome';
  }
  const target=document.getElementById(id);
  if(!target)return;
  document.querySelectorAll(".page-section").forEach(s=>s.classList.remove("active"));
  target.classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.section===id));
  const titles={dashboard:"Tableau de bord",employees:"Employés",attendance:"Pointage",biometric:"Biométrie",history:"Historique",reports:"Rapports",leaveRequests:"Congés & absences",kiosk:"Mode Pointage",settings:"Paramètres",agentHome:"Espace agent",agentHistory:"Mon historique"};
  document.getElementById("pageTitle").textContent=titles[id]||"PrésencePro";
  document.getElementById("sidebar").classList.remove("open");
  window.scrollTo({top:0,behavior:"smooth"});
}

document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>navigateTo(btn.dataset.section)));
document.getElementById("mobileMenu").addEventListener("click",()=>document.getElementById("sidebar").classList.toggle("open"));

function personHTML(name,code,initials,photo=""){
  const avatar=photo
    ? `<img class="person-photo" src="${photo}" alt="Photo de ${name}" width="70" height="70" loading="lazy">`
    : `<div class="person-avatar">${initials}</div>`;
  return `<div class="person">${avatar}<div class="person-details"><strong>${name}</strong><small>${code}</small></div></div>`;
}
function statusHTML(status){return `<span class="status ${status}">${labels[status]}</span>`;}

function renderRecent(){
  document.getElementById("recentTable").innerHTML=employees.slice(0,5).map(e=>`<tr><td>${personHTML(e.name,e.code,e.initials,e.photo)}</td><td>${e.time}</td><td>${e.status==="present"?"16:0"+(e.id%7):"—"}</td><td>${statusHTML(e.status)}</td></tr>`).join("");
}
function renderEmployees(){
  const q=(document.getElementById("employeeSearch").value||"").toLowerCase();
  const filter=document.getElementById("employeeFilter").value;
  const accountFilter=document.getElementById("employeeAccountFilter")?.value||"all";
  const list=employees.filter(e=>(e.name.toLowerCase().includes(q)||e.code.toLowerCase().includes(q))&&(filter==="all"||e.status===filter)&&(accountFilter==="all"||(accountFilter==="linked"&&e.accountLinked)||(accountFilter==="unlinked"&&!e.accountLinked)));
  document.getElementById("employeeTable").innerHTML=list.map(e=>`<tr><td>${personHTML(e.name,e.code,e.initials,e.photo)}</td><td>${e.code}</td><td>${e.department}</td><td>${e.accountLinked?'<span class="bio-ok">● Compte associé</span>':'<span class="bio-missing">● À associer</span>'}</td><td>${statusHTML(e.status)}</td><td>${e.time}</td><td><button class="ghost-btn employee-view-btn" type="button" data-employee-id="${String(e.id)}">Voir</button></td></tr>`).join("")||`<tr><td colspan="7" style="text-align:center;color:#8794a6;padding:30px">Aucun employé trouvé.</td></tr>`;
}
function escapeHTML(value){return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));}
async function showEmployeeDetails(employeeId){
  const emp=employees.find(e=>String(e.id)===String(employeeId)||String(e.supabaseId)===String(employeeId));
  if(!emp){showToast("Employé introuvable.");return;}
  const modal=document.getElementById("employeeDetailsModal");
  const body=document.getElementById("employeeDetailsBody");
  if(!modal||!body)return;
  const photo=emp.photo?`<img class="employee-detail-photo" src="${escapeHTML(emp.photo)}" alt="Photo de ${escapeHTML(emp.name)}">`:`<div class="employee-detail-photo employee-detail-initials">${escapeHTML(emp.initials||"?")}</div>`;
  body.innerHTML=`<div class="employee-detail-heading">${photo}<div><h3>${escapeHTML(emp.name)}</h3><p>${escapeHTML(emp.code)}</p><span class="employee-active-badge ${emp.active===false?'inactive':''}">${emp.active===false?'Désactivé':'Actif'}</span></div></div>
  <form id="editEmployeeForm" class="employee-edit-form" data-employee-id="${escapeHTML(emp.id)}">
    <h3>Informations du profil</h3>
    <label>Nom complet<input id="editEmployeeName" required maxlength="120" value="${escapeHTML(emp.name)}"></label>
    <label>E-mail professionnel<input id="editEmployeeEmail" type="email" required maxlength="254" value="${escapeHTML(emp.email||"")}" placeholder="agent@entreprise.com"></label>
    <label>Matricule<input id="editEmployeeCode" required maxlength="40" value="${escapeHTML(emp.code)}"></label>
    <label>Département<select id="editEmployeeDepartment"><option ${emp.department==='Administration'?'selected':''}>Administration</option><option ${emp.department==='Finance'?'selected':''}>Finance</option><option ${emp.department==='Ressources humaines'?'selected':''}>Ressources humaines</option><option ${emp.department==='Informatique'?'selected':''}>Informatique</option><option ${emp.department==='Enseignement'?'selected':''}>Enseignement</option><option ${emp.department==='Autre'?'selected':''}>Autre</option></select></label>
    <label>Remplacer la photo (facultatif)<input id="editEmployeePhoto" type="file" accept="image/*"></label>
    <label class="employee-active-toggle"><input id="editEmployeeActive" type="checkbox" ${emp.active===false?'':'checked'}> Employé actif</label>
    <div class="employee-detail-grid"><div><small>Statut du jour</small><strong>${escapeHTML(labels[emp.status]||emp.status||"Non renseigné")}</strong></div><div><small>Dernier pointage</small><strong>${escapeHTML(emp.time||"—")}</strong></div><div><small>Compte agent</small><strong>${emp.accountLinked?"Associé":"Non associé"}</strong></div></div>
    <button class="primary-btn full" type="submit">Enregistrer les modifications</button><p class="employee-edit-note">Les changements seront enregistrés dans Supabase si vous êtes connecté comme administrateur.</p>
  </form><div id="employeeDeviceRequests" class="employee-detail-history"><h3>Appareils des agents</h3><p class="detail-loading">Chargement des demandes…</p></div><div class="employee-detail-history"><h3>Historique récent</h3><p class="detail-loading">Chargement de l’historique…</p></div>`;
  const editForm=body.querySelector('#editEmployeeForm');
  editForm.addEventListener('submit',async event=>{
    event.preventDefault();
    const saveButton=editForm.querySelector('button[type="submit"]');saveButton.disabled=true;saveButton.textContent='Enregistrement…';
    const name=document.getElementById('editEmployeeName').value.trim();
    const email=document.getElementById('editEmployeeEmail').value.trim().toLowerCase();
    const code=document.getElementById('editEmployeeCode').value.trim().toUpperCase();
    const department=document.getElementById('editEmployeeDepartment').value;
    const active=document.getElementById('editEmployeeActive').checked;
    const photoFile=document.getElementById('editEmployeePhoto').files[0];
    if(employees.some(other=>other!==emp&&other.code.toUpperCase()===code)){showToast('Ce matricule est déjà utilisé.');saveButton.disabled=false;saveButton.textContent='Enregistrer les modifications';return;}
    try{
      const realId=emp.supabaseId||((typeof emp.id==='string'&&emp.id.includes('-'))?emp.id:null);
      if(ppSupabase&&ppSession&&ppOrganizationId&&realId){
        const patch={full_name:name,email,code,department,active};
        if(photoFile){
          const ext=(photoFile.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
          const photoPath=`${ppOrganizationId}/${realId}.${ext}`;
          const {error:uploadError}=await ppSupabase.storage.from('employee-photos').upload(photoPath,photoFile,{upsert:true,contentType:photoFile.type});
          if(uploadError)throw uploadError;
          patch.photo_path=photoPath;
        }
        const {error}=await ppSupabase.from('employees').update(patch).eq('id',realId).eq('organization_id',ppOrganizationId);
        if(error)throw error;
        await ppLoadEmployees();
        const refreshed=employees.find(x=>String(x.id)===String(realId));
        if(refreshed)showEmployeeDetails(refreshed.id);
      }else{
        emp.name=name;emp.email=email;emp.code=code;emp.department=department;emp.active=active;
        if(photoFile){emp.photo=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(photoFile);});}
        emp.initials=name.split(/\s+/).map(x=>x[0]).join('').slice(0,2).toUpperCase();
        renderEmployees();renderRecent();renderBiometric();showEmployeeDetails(emp.id);
        localStorage.setItem('pp_demo_employees',JSON.stringify(employees.map(({photo,...x})=>x)));
      }
      showToast('Profil employé mis à jour.');
    }catch(err){console.error(err);showToast('Modification impossible : '+(err.message||'vérifiez les droits Supabase.'));saveButton.disabled=false;saveButton.textContent='Enregistrer les modifications';}
  });
  modal.classList.add("open");
  const deviceBox=body.querySelector('#employeeDeviceRequests');
  if(emp.supabaseId|| (typeof emp.id==='string'&&emp.id.includes('-')))ppLoadDeviceRequests(emp.supabaseId||emp.id,deviceBox);
  const historyBox=body.querySelectorAll(".employee-detail-history")[1];
  try{
    let rows=[];
    const realId=emp.supabaseId||((typeof emp.id==="string"&&emp.id.includes("-"))?emp.id:null);
    if(ppSupabase&&realId){
      const {data,error}=await ppSupabase.from("attendance").select("attendance_date,arrival_at,departure_at").eq("employee_id",realId).order("attendance_date",{ascending:false}).limit(7);
      if(error)throw error;
      rows=(data||[]).map(r=>({date:new Date(r.attendance_date+"T00:00:00").toLocaleDateString("fr-FR"),arrival:r.arrival_at?new Date(r.arrival_at).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}):"—",departure:r.departure_at?new Date(r.departure_at).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"}):"—"}));
    }else{
      rows=history.filter(r=>r[1]===emp.name).slice(0,7).map(r=>({date:r[0],arrival:r[2],departure:r[3]}));
    }
    historyBox.innerHTML=`<h3>Historique récent</h3>${rows.length?`<div class="employee-detail-history-list">${rows.map(r=>`<div class="employee-detail-history-row"><strong>${escapeHTML(r.date)}</strong><span>Arrivée : ${escapeHTML(r.arrival)}</span><span>Départ : ${escapeHTML(r.departure)}</span></div>`).join("")}</div>`:'<p class="detail-empty">Aucun pointage trouvé pour cet employé.</p>'}`;
  }catch(err){console.error(err);historyBox.innerHTML='<h3>Historique récent</h3><p class="detail-empty">Impossible de charger l’historique pour le moment.</p>';}
}

function renderHistory(){
  const q=(document.getElementById('historySearch')?.value||'').toLowerCase();
  const dateFilter=document.getElementById('historyDate')?.value||'';
  const list=history.filter(r=>r[1].toLowerCase().includes(q)&&(!dateFilter||r[0]===ppDateLabel(dateFilter)));
  const body=document.getElementById('historyTable');if(!body)return;
  body.innerHTML=list.map(r=>`<tr><td>${escapeHTML(r[0])}</td><td><strong>${escapeHTML(r[1])}</strong></td><td>${escapeHTML(r[2])}</td><td>${escapeHTML(r[3])}</td><td>${statusHTML(r[4])}</td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;padding:28px;color:#738196">Aucun pointage trouvé pour ces filtres.</td></tr>';
}
function reportRows(){const from=document.getElementById('reportFrom')?.value||'';const to=document.getElementById('reportTo')?.value||'';const dept=document.getElementById('reportDepartment')?.value||'all';return history.filter(r=>{const iso=r[0].split('/').reverse().join('-');const emp=employees.find(e=>e.name===r[1]);return (!from||iso>=from)&&(!to||iso<=to)&&(dept==='all'||emp?.department===dept);});}
function renderReports(){
  const rows=reportRows();const total=employees.filter(e=>e.active!==false).length;const present=rows.filter(r=>r[2]!=='—').length;const late=rows.filter(r=>r[4]==='late').length;const days=Math.max(1,new Set(rows.map(r=>r[0])).size);const rate=rows.length?Math.round((present/rows.length)*100):0;const lateRate=rows.length?Math.round(late/rows.length*100):0;
  const a=document.getElementById('reportPresenceRate');if(a)a.textContent=rate+'%';const b=document.getElementById('reportLateRate');if(b)b.textContent=lateRate+'%';const c=document.getElementById('reportRecordCount');if(c)c.textContent=rows.length;const d=document.getElementById('reportAbsentCount');if(d)d.textContent=Math.max(0,total*days-new Set(rows.filter(r=>r[2]!=='—').map(r=>r[0]+'|'+r[1])).size);
  const body=document.getElementById('reportTable');if(body)body.innerHTML=rows.map(r=>`<tr><td>${escapeHTML(r[0])}</td><td>${escapeHTML(r[1])}</td><td>${escapeHTML(r[2])}</td><td>${escapeHTML(r[3])}</td><td>${escapeHTML(labels[r[4]]||r[4])}</td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;padding:24px">Aucune donnée pour cette période.</td></tr>';
}
function downloadCSV(){const rows=reportRows();if(!rows.length){showToast('Aucune donnée à exporter pour cette période.');return;}const data=[['Date','Employé','Arrivée','Départ','Statut'],...rows.map(r=>[...r.slice(0,4),labels[r[4]]||r[4]])];const csv='\ufeff'+data.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`presencepro-rapport-${ppLocalDateISO()}.csv`;a.click();URL.revokeObjectURL(url);}
function printReport(){const rows=reportRows();if(!rows.length){showToast('Aucune donnée à imprimer.');return;}const w=window.open('','_blank');if(!w){showToast('Autorisez les fenêtres pop-up pour imprimer le rapport.');return;}w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport PrésencePro</title><style>body{font:14px Arial;padding:24px;color:#182235}h1{margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{border:1px solid #ccd3df;padding:9px;text-align:left}th{background:#edf2f7}</style></head><body><h1>PrésencePro RDC — Rapport des présences</h1><p>Généré le ${new Date().toLocaleString('fr-FR')}</p><table><thead><tr><th>Date</th><th>Employé</th><th>Arrivée</th><th>Départ</th><th>Statut</th></tr></thead><tbody>${rows.map(r=>`<tr>${[r[0],r[1],r[2],r[3],labels[r[4]]||r[4]].map(v=>`<td>${escapeHTML(v)}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);w.document.close();}
function updateDate(){
  const now=new Date();
  document.getElementById("currentDate").textContent=now.toLocaleDateString("fr-FR",{weekday:"short",day:"2-digit",month:"short",year:"numeric"});
  const dashboardDate=document.getElementById("dashboardDate");if(dashboardDate)dashboardDate.textContent=now.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).toUpperCase();
  document.getElementById("attendanceDate").textContent=now.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
}
function updateClock(){
  document.getElementById("liveClock").textContent=new Date().toLocaleTimeString("fr-FR",{hour12:false});
}
function showToast(message){
  const t=document.getElementById("toast");t.textContent=message;t.classList.add("show");
  clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>t.classList.remove("show"),2800);
}

async function recordAttendance(type){
  const code=document.getElementById("attendanceCode").value.trim().toUpperCase();
  const emp=employees.find(e=>e.code===code);
  if(!emp){showToast("Employé introuvable. Vérifiez le matricule.");return;}
  if(emp.active===false){showToast('Cet employé est désactivé. Réactivez son profil avant le pointage.');return;}
  const time=new Date().toLocaleTimeString("fr-FR",{hour12:false,hour:"2-digit",minute:"2-digit"});
  try{
    if(ppHasSupabase() && ppSession && ppOrganizationId){await ppRecordAttendance(emp,type);}
    else{
      const today=ppDateLabel(ppLocalDateISO());let row=history.find(r=>r[0]===today&&r[1]===emp.name);
      if(type==='arrival'&&row&&row[2]!=='—')throw new Error('L’arrivée est déjà enregistrée aujourd’hui.');
      if(type==='departure'&&(!row||row[2]==='—'))throw new Error('Enregistrez d’abord l’arrivée.');
      if(type==='departure'&&row&&row[3]!=='—')throw new Error('Le départ est déjà enregistré aujourd’hui.');
      if(type==='arrival'){emp.time=time;emp.status=ppAttendanceStatus(new Date(`${ppLocalDateISO()}T${time}:00`).toISOString());if(row){row[2]=time;row[4]=emp.status;}else{row=[today,emp.name,time,'—',emp.status];history.unshift(row);}}
      else{row[3]=time;}
      renderHistory();ppRefreshDashboard();
    }
    showToast(`${type==="arrival"?"Arrivée":"Départ"} enregistrée pour ${emp.name} à ${time}.`);
  }catch(err){showToast('Impossible d’enregistrer le pointage : '+(err.message||'erreur'));}
  document.getElementById("attendanceCode").value="";renderRecent();renderEmployees();renderHistory();
}

document.getElementById("employeeTable").addEventListener("click",e=>{const btn=e.target.closest(".employee-view-btn");if(btn)showEmployeeDetails(btn.dataset.employeeId);});
const employeeDetailsModal=document.getElementById("employeeDetailsModal");
const closeEmployeeDetails=document.getElementById("closeEmployeeDetails");
if(closeEmployeeDetails)closeEmployeeDetails.addEventListener("click",()=>employeeDetailsModal?.classList.remove("open"));
if(employeeDetailsModal)employeeDetailsModal.addEventListener("click",e=>{if(e.target===employeeDetailsModal)employeeDetailsModal.classList.remove("open");});
const modal=document.getElementById("employeeModal");
document.getElementById("addEmployeeBtn").addEventListener("click",()=>{document.getElementById("newCode").value=ppNextEmployeeMatricule();modal.classList.add("open");});
document.getElementById("closeModal").addEventListener("click",()=>modal.classList.remove("open"));
modal.addEventListener("click",e=>{if(e.target===modal)modal.classList.remove("open")});
function ppNextEmployeeMatricule(){
  const numbers=employees.map(emp=>String(emp.code||'').trim().match(/^EMP(\\d+)$/i))
    .filter(Boolean).map(match=>Number(match[1])).filter(Number.isFinite);
  const next=Math.max(0,...numbers)+1;
  return 'EMP'+String(next).padStart(3,'0');
}
document.getElementById("employeeForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const name=document.getElementById("newName").value.trim();
  const email=document.getElementById("newEmail").value.trim().toLowerCase();
  const code=ppNextEmployeeMatricule();
  const department=document.getElementById("newDepartment").value;
  document.getElementById("newCode").value=code;
  const photo=document.getElementById("newPhoto").files[0];
  let enrollmentCode=null;
  try{
    if(ppHasSupabase() && ppSession && ppOrganizationId){
      enrollmentCode=await ppCreateEmployee({name,email,code,department,photoFile:photo});
    }else{
      const photoUrl=photo?URL.createObjectURL(photo):"";
      employees.push({id:Date.now(),name,email,code,department,status:"absent",time:"—",initials:name.split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase(),photo:photoUrl,fingerprint:false,biometricId:null});
    }
    document.getElementById("employeeForm").reset();document.getElementById("photoPreview").innerHTML="<span>Aperçu photo</span>";modal.classList.remove("open");
    renderEmployees();renderRecent();renderBiometric();document.getElementById("totalEmployees").textContent=employees.length;
    if(enrollmentCode){
      showToast(`${name} a été ajouté. L’agent pourra créer son compte avec son e-mail et son matricule.`);
    }else{
      showToast(`${name} a été ajouté en mode démonstration.`);
    }
  }catch(err){showToast('Création impossible : '+(err.message||'erreur'));}

});

document.getElementById("employeeSearch").addEventListener("input",renderEmployees);
document.getElementById("employeeFilter").addEventListener("change",renderEmployees);
document.getElementById("employeeAccountFilter")?.addEventListener("change",renderEmployees);
document.getElementById("historySearch").addEventListener("input",renderHistory);
document.getElementById('historyDate')?.addEventListener('change',renderHistory);
document.getElementById('reportFrom')?.addEventListener('change',renderReports);document.getElementById('reportTo')?.addEventListener('change',renderReports);document.getElementById('reportDepartment')?.addEventListener('change',renderReports);

// Demandes de congé et d’absence (nécessite la migration SQL V15).
async function submitLeaveRequest(event){
  event.preventDefault();
  if(!ppSupabase||!ppSession){showToast('Connectez votre compte employé pour envoyer une demande.');return;}
  const start=document.getElementById('leaveStart').value,end=document.getElementById('leaveEnd').value,reason=document.getElementById('leaveReason').value.trim(),type=document.getElementById('leaveType').value;
  if(!start||!end||start>end){showToast('Vérifiez les dates de la demande.');return;}
  try{const {data:emp,error:empErr}=await ppSupabase.from('employees').select('id,organization_id').eq('auth_user_id',ppSession.user.id).maybeSingle();if(empErr)throw empErr;if(!emp)throw new Error('Associez d’abord votre compte à un profil employé.');
    const {error}=await ppSupabase.from('leave_requests').insert({organization_id:emp.organization_id,employee_id:emp.id,request_type:type,start_date:start,end_date:end,reason,status:'pending'});if(error)throw error;
    document.getElementById('leaveRequestForm').reset();showToast('Demande envoyée au responsable.');await loadMyLeaveRequests();await loadLeaveRequests();
  }catch(err){showToast('Demande impossible : '+(err.message||'vérifiez la configuration SQL V15.'));}
}
async function loadMyLeaveRequests(){
  const box=document.getElementById('myLeaveRequests');if(!box)return;
  if(!ppSupabase||!ppSession){box.innerHTML='<p class="settings-help">Connectez votre compte employé pour voir vos demandes.</p>';return;}
  try{const {data:emp,error:empErr}=await ppSupabase.from('employees').select('id').eq('auth_user_id',ppSession.user.id).maybeSingle();if(empErr)throw empErr;if(!emp){box.innerHTML='<p class="settings-help">Votre compte n’est pas encore associé à un employé.</p>';return;}
    const {data,error}=await ppSupabase.from('leave_requests').select('id,request_type,start_date,end_date,reason,status,created_at').eq('employee_id',emp.id).order('created_at',{ascending:false}).limit(10);if(error)throw error;
    box.innerHTML=(data||[]).map(r=>`<div class="leave-item"><div><strong>${escapeHTML(r.request_type)}</strong><small>${escapeHTML(r.start_date)} → ${escapeHTML(r.end_date)}</small><small>${escapeHTML(r.reason)}</small></div><span class="leave-status ${escapeHTML(r.status)}">${r.status==='pending'?'En attente':r.status==='approved'?'Approuvée':'Refusée'}</span></div>`).join('')||'<p class="settings-help">Aucune demande pour le moment.</p>';
  }catch(err){box.innerHTML='<p class="settings-help">La fonction congés nécessite la migration SQL V15.</p>';}
}
async function loadLeaveRequests(){
  const body=document.getElementById('leaveRequestsTable');if(!body)return;
  if(!ppSupabase||!ppSession||!ppOrganizationId){body.innerHTML='<tr><td colspan="6" style="text-align:center;padding:24px">Connectez-vous à un compte administrateur relié à une organisation.</td></tr>';return;}
  try{const {data,error}=await ppSupabase.from('leave_requests').select('id,employee_id,request_type,start_date,end_date,reason,status,created_at').order('created_at',{ascending:false}).limit(100);if(error)throw error;const pendingCount=(data||[]).filter(r=>r.status==='pending').length;const nc=document.getElementById('notificationsCount');if(nc){nc.textContent=pendingCount;nc.hidden=pendingCount===0;}
    const ids=[...new Set((data||[]).map(r=>r.employee_id))];let names={};if(ids.length){const {data:emps,error:ee}=await ppSupabase.from('employees').select('id,full_name').in('id',ids);if(ee)throw ee;(emps||[]).forEach(e=>names[e.id]=e.full_name);}
    body.innerHTML=(data||[]).map(r=>`<tr><td>${escapeHTML(names[r.employee_id]||'Employé')}</td><td>${escapeHTML(r.request_type)}</td><td>${escapeHTML(r.start_date)} → ${escapeHTML(r.end_date)}</td><td>${escapeHTML(r.reason)}</td><td><span class="leave-status ${escapeHTML(r.status)}">${r.status==='pending'?'En attente':r.status==='approved'?'Approuvée':'Refusée'}</span></td><td>${r.status==='pending'?`<button class="ghost-btn" onclick="decideLeaveRequest('${r.id}','approved')">Approuver</button> <button class="ghost-btn" onclick="decideLeaveRequest('${r.id}','rejected')">Refuser</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="6" style="text-align:center;padding:24px">Aucune demande.</td></tr>';
  }catch(err){body.innerHTML='<tr><td colspan="6" style="text-align:center;padding:24px">Impossible de charger les demandes. Vérifiez que la migration SQL V15 a été exécutée.</td></tr>';}
}
async function decideLeaveRequest(id,status){if(!ppSupabase||!ppSession)return;try{const {error}=await ppSupabase.from('leave_requests').update({status,reviewed_by:ppSession.user.id,reviewed_at:new Date().toISOString()}).eq('id',id).eq('status','pending');if(error)throw error;showToast(status==='approved'?'Demande approuvée.':'Demande refusée.');await loadLeaveRequests();}catch(err){showToast('Décision impossible : vérifiez les permissions de votre compte.');}}
document.getElementById('leaveRequestForm')?.addEventListener('submit',submitLeaveRequest);

async function ppLoadOrganizationSettings(){
  if(!ppSupabase||!ppOrganizationId)return;
  try{const {data,error}=await ppSupabase.from('organization_settings').select('organization_name,start_time,end_time').eq('organization_id',ppOrganizationId).maybeSingle();if(error)throw error;if(data){const cfg=readAppSettings();cfg.organizationName=data.organization_name||cfg.organizationName;cfg.startTime=data.start_time||cfg.startTime;cfg.endTime=data.end_time||cfg.endTime;localStorage.setItem(PP_SETTINGS_KEY,JSON.stringify(cfg));refreshSettingsUI();}}catch(e){console.warn('Paramètres partagés non chargés :',e.message);}
}
function openSubscriptionInfo(){document.getElementById('subscriptionModal')?.classList.add('open');}
function closeSubscriptionInfo(){document.getElementById('subscriptionModal')?.classList.remove('open');}
function openNotifications(){if(document.getElementById('appShell')?.classList.contains('mode-agent')){navigateTo('agentHome');loadMyLeaveRequests();return;}navigateTo('leaveRequests');loadLeaveRequests();}

// Paramètres de l’organisation et horaires
const PP_SETTINGS_KEY='presencepro_settings_v1';
function readAppSettings(){try{return JSON.parse(localStorage.getItem(PP_SETTINGS_KEY)||'{}')}catch{return {}}}
function refreshSettingsUI(){
  const cfg=readAppSettings();
  const orgLabel=document.getElementById('settingsOrganizationLabel');if(orgLabel)orgLabel.textContent=cfg.organizationName||'PrésencePro';
  const hoursLabel=document.getElementById('settingsHoursLabel');if(hoursLabel)hoursLabel.textContent=`${cfg.startTime||'08:00'} — ${cfg.endTime||'16:00'}`;
  const orgInput=document.getElementById('settingsOrganizationName');if(orgInput)orgInput.value=cfg.organizationName||'PrésencePro';
  const startInput=document.getElementById('settingsStartTime');if(startInput)startInput.value=cfg.startTime||'08:00';
  const endInput=document.getElementById('settingsEndTime');if(endInput)endInput.value=cfg.endTime||'16:00';
}
function openSettingsModal(tab='organization'){
  refreshSettingsUI();const modal=document.getElementById('settingsModal');if(!modal)return;
  document.querySelectorAll('[data-settings-panel]').forEach(panel=>panel.hidden=panel.dataset.settingsPanel!==tab);
  document.querySelectorAll('[data-settings-tab]').forEach(btn=>btn.classList.toggle('active',btn.dataset.settingsTab===tab));
  modal.classList.add('open');
}
function closeSettingsModal(){document.getElementById('settingsModal')?.classList.remove('open');}
document.querySelectorAll('[data-settings-open]').forEach(btn=>btn.addEventListener('click',()=>openSettingsModal(btn.dataset.settingsOpen)));
document.querySelectorAll('[data-settings-tab]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-settings-panel]').forEach(panel=>panel.hidden=panel.dataset.settingsPanel!==btn.dataset.settingsTab);document.querySelectorAll('[data-settings-tab]').forEach(b=>b.classList.toggle('active',b===btn));}));
document.getElementById('closeSettingsModal')?.addEventListener('click',closeSettingsModal);
document.getElementById('settingsModal')?.addEventListener('click',e=>{if(e.target.id==='settingsModal')closeSettingsModal();});
document.getElementById('settingsOrganizationForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const name=document.getElementById('settingsOrganizationName').value.trim();if(!name)return;
  const cfg=readAppSettings();cfg.organizationName=name;
  if(ppSupabase&&ppSession&&ppOrganizationId){
    const {error}=await ppSupabase.from('organizations').update({name}).eq('id',ppOrganizationId);
    if(error){console.warn('Organisation non synchronisée avec Supabase:',error);localStorage.setItem(PP_SETTINGS_KEY,JSON.stringify(cfg));refreshSettingsUI();showToast('Nom enregistré sur cet appareil. Exécutez la migration SQL V15 pour activer la synchronisation.');closeSettingsModal();return;}
    const current=readAppSettings();const {error:settingsError}=await ppSupabase.from('organization_settings').upsert({organization_id:ppOrganizationId,organization_name:name,start_time:current.startTime||'08:00',end_time:current.endTime||'16:00',updated_at:new Date().toISOString()},{onConflict:'organization_id'});if(settingsError)console.warn('Nom non copié dans les paramètres partagés:',settingsError.message);
  }
  localStorage.setItem(PP_SETTINGS_KEY,JSON.stringify(cfg));refreshSettingsUI();showToast('Nom de l’organisation enregistré.');closeSettingsModal();
});
document.getElementById('settingsHoursForm')?.addEventListener('submit',async e=>{
  e.preventDefault();const start=document.getElementById('settingsStartTime').value,end=document.getElementById('settingsEndTime').value;
  if(!start||!end||start>=end){showToast('Choisissez une heure de début antérieure à l’heure de fin.');return;}
  const cfg=readAppSettings();cfg.startTime=start;cfg.endTime=end;localStorage.setItem(PP_SETTINGS_KEY,JSON.stringify(cfg));if(ppSupabase&&ppSession&&ppOrganizationId){const {error}=await ppSupabase.from('organization_settings').upsert({organization_id:ppOrganizationId,start_time:start,end_time:end,organization_name:cfg.organizationName||'PrésencePro',updated_at:new Date().toISOString()},{onConflict:'organization_id'});if(error)console.warn('Horaires non synchronisés:',error.message);}refreshSettingsUI();employees.forEach(emp=>{if(emp.time&&emp.time!=='—')emp.status=ppAttendanceStatus(new Date(`${ppLocalDateISO()}T${emp.time}:00`).toISOString());});renderEmployees();renderRecent();renderHistory();ppRefreshDashboard();showToast('Horaires enregistrés sur cet appareil.');closeSettingsModal();
});
refreshSettingsUI();

updateDate();updateClock();setInterval(updateClock,1000);renderRecent();renderEmployees();renderHistory();ppRefreshDashboard();


function renderBiometric(){
  const box=document.getElementById("biometricTable"); if(!box)return;
  box.innerHTML=employees.map(e=>`<div class="bio-row">${personHTML(e.name,e.code,e.initials,e.photo)}<div class="bio-state">${(e.nativeBiometric||e.fingerprint)?`<span class="bio-ok">● Biométrie enregistrée</span><small>${e.nativeBiometric?"Tablette / appareil":"Profil démo"}</small>`:`<span class="bio-missing">● À enregistrer</span>`}</div><button class="ghost-btn" onclick="enrollFingerprint(${e.id})">${(e.nativeBiometric||e.fingerprint)?"Réenregistrer":"Enregistrer"}</button></div>`).join("");
}
function enrollFingerprint(id){
  const select=document.getElementById("biometricEmployee");
  if(select){select.value=String(id);}
  registerBiometric();
}

function simulateFingerprint(){
  const verified=employees.find(e=>e.fingerprint); if(!verified){showToast("Aucun profil biométrique enregistré.");return;}
  document.getElementById("fingerprintState").textContent="IDENTITÉ VÉRIFIÉE"; document.getElementById("deviceStatus").textContent=`Empreinte reconnue : ${verified.name}`;
  showToast(`Identité vérifiée : ${verified.name}. Pointage prêt à être enregistré.`); setTimeout(()=>document.getElementById("fingerprintState").textContent="CAPTEUR EN ATTENTE",2500);
}
document.getElementById("newPhoto").addEventListener("change",e=>{const f=e.target.files[0]; if(f){const r=new FileReader();r.onload=()=>document.getElementById("photoPreview").innerHTML=`<img src="${r.result}" alt="Aperçu">`;r.readAsDataURL(f);}});
renderBiometric();

/* === Biométrie native de l'appareil : WebAuthn / Passkeys === */
const BIO_STORE_KEY = "presencepro_biometric_credentials_v2";
function loadBioStore(){ try{return JSON.parse(localStorage.getItem(BIO_STORE_KEY)||"{}");}catch{return {};}}
function saveBioStore(store){localStorage.setItem(BIO_STORE_KEY,JSON.stringify(store));}
function bytesToB64(bytes){let s="";bytes=new Uint8Array(bytes);for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
function b64ToBytes(str){str=str.replace(/-/g,"+").replace(/_/g,"/");while(str.length%4)str+="=";const bin=atob(str);return Uint8Array.from(bin,c=>c.charCodeAt(0));}
function randomBytes(n=32){const a=new Uint8Array(n);crypto.getRandomValues(a);return a;}
function webauthnReady(){return window.isSecureContext && !!window.PublicKeyCredential && !!navigator.credentials;}
async function updateBiometricDeviceStatus(){
  const status=document.getElementById("deviceStatus"), small=document.getElementById("deviceStatusSmall"), dot=document.getElementById("deviceDot");
  if(!status)return;
  if(!webauthnReady()){status.textContent="Biométrie native non disponible ici";small.textContent="Ouvrez l’application en HTTPS sur une tablette/téléphone compatible.";return;}
  try{
    const available=await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    status.textContent=available?"Biométrie de l’appareil disponible":"Authentificateur biométrique non détecté";
    small.textContent=available?"Empreinte / Face ID / verrouillage sécurisé compatible":"Activez un verrouillage biométrique sur l’appareil.";
    if(dot)dot.style.background=available?"var(--green)":"var(--orange)";
  }catch{status.textContent="Vérification de l’appareil impossible";}
}
function refreshBiometricEmployeeSelect(){
  const select=document.getElementById("biometricEmployee");if(!select)return;
  select.innerHTML=employees.map(e=>`<option value="${e.id}">${e.name} — ${e.code}</option>`).join("");
}
function refreshBioFlags(){
  const store=loadBioStore();
  employees.forEach(e=>{e.nativeBiometric=!!store[e.id];});
}
function credentialIdForEmployee(id){return loadBioStore()[id]||null;}

async function registerBiometric(){
  const id=document.getElementById("biometricEmployee")?.value;const emp=employees.find(e=>String(e.id)===String(id));if(!emp)return;
  if(!webauthnReady()){showToast("La biométrie nécessite HTTPS et une tablette/téléphone compatible.");return;}
  try{
    const credential=await navigator.credentials.create({publicKey:{
      challenge:randomBytes(32),rp:{name:"PrésencePro RDC",id:location.hostname},
      user:{id:randomBytes(16),name:emp.code,displayName:emp.name},
      pubKeyCredParams:[{type:"public-key",alg:-7},{type:"public-key",alg:-257}],
      authenticatorSelection:{authenticatorAttachment:"platform",residentKey:"required",requireResidentKey:true,userVerification:"required"},
      timeout:60000,attestation:"none"
    }});
    if(!credential)throw new Error("Aucun identifiant biométrique créé.");
    const store=loadBioStore();store[emp.id]=bytesToB64(credential.rawId);saveBioStore(store);if(ppHasSupabase() && ppSession && ppOrganizationId){await ppSaveBiometricCredential(emp,store[emp.id]);}refreshBioFlags();renderBiometric();renderEmployees();
    document.getElementById("fingerprintState").textContent="BIOMÉTRIE ENREGISTRÉE";showToast(`Biométrie de ${emp.name} enregistrée sur cet appareil.`);
  }catch(err){
    console.error(err);showToast(err.name==="NotAllowedError"?"L’enregistrement biométrique a été annulé ou refusé.":"Impossible d’enregistrer la biométrie sur cet appareil.");
  }
}

async function verifyBiometric(){
  if(!webauthnReady()){showToast("La biométrie native nécessite HTTPS et un appareil compatible.");return;}
  try{
    const assertion=await navigator.credentials.get({publicKey:{challenge:randomBytes(32),rpId:location.hostname,userVerification:"required",timeout:60000}});
    if(!assertion)throw new Error("Aucune vérification.");
    const credentialId=bytesToB64(assertion.rawId),store=loadBioStore();
    let entry=Object.entries(store).find(([,value])=>value===credentialId);
    if(!entry && ppHasSupabase() && ppSession && ppOrganizationId){
      const {data}=await ppSupabase.from("biometric_credentials").select("employee_id,credential_id").eq("credential_id",credentialId).maybeSingle();
      if(data)entry=[String(data.employee_id),data.credential_id];
    }
    if(!entry){showToast("Biométrie reconnue, mais aucun profil PrésencePro n’est associé à cet appareil.");return;}
    const emp=employees.find(e=>String(e.id)===String(entry[0]));
    if(!emp){showToast("Profil associé introuvable.");return;}
    const time=new Date().toLocaleTimeString("fr-FR",{hour12:false,hour:"2-digit",minute:"2-digit"});
    if(ppHasSupabase() && ppSession && ppOrganizationId){
      await ppRecordAttendance(emp,'arrival');
    }else{
      emp.time=time;emp.status=time>"08:15"?"late":"present";
      renderRecent();renderEmployees();renderHistory();
    }
    document.getElementById("fingerprintState").textContent="IDENTITÉ VÉRIFIÉE";
    document.getElementById("deviceStatus").textContent=`${emp.name} identifié`;
    document.getElementById("deviceStatusSmall").textContent=`${emp.code} • pointage à ${time}`;
    showToast(`✅ ${emp.name} — arrivée enregistrée à ${time}.`);
    setTimeout(()=>{const s=document.getElementById("fingerprintState");if(s)s.textContent="PRÊT À VÉRIFIER";},3000);
  }catch(err){
    console.error(err);showToast(err.name==="NotAllowedError"?"Vérification biométrique annulée ou refusée.":"La vérification biométrique a échoué.");
  }
}

const oldRenderBiometric=renderBiometric;
renderBiometric=function(){refreshBioFlags();refreshBiometricEmployeeSelect();oldRenderBiometric();};
renderBiometric();updateBiometricDeviceStatus();


/* === Auth UI === */
(function initAuthUI(){
  const form=document.getElementById('authForm'),toggle=document.getElementById('authToggle'),title=document.getElementById('authTitle'),submit=document.getElementById('authSubmit'),fields=document.getElementById('signupFields');
  if(!form)return;let signup=false;
  const logout=document.getElementById('adminLogoutBtn');
  if(logout)logout.addEventListener('click',async()=>{
    if(!ppSupabase){showToast('La connexion Supabase n’est pas disponible.');return;}
    logout.disabled=true;logout.textContent='Déconnexion…';
    try{
      const {error}=await ppSupabase.auth.signOut();
      if(error)throw error;
      ppSession=null;ppUserRole=null;ppOrganizationId=null;employeePortalUser=null;
      const authForm=document.getElementById('authForm');if(authForm)authForm.reset();
      ppSetAuthStatus('');
      backToHome();
      showToast('Déconnexion réussie. Pour revenir à l’administration, saisissez à nouveau votre e-mail et votre mot de passe.');
    }catch(err){
      showToast(err.message||'Impossible de se déconnecter.');
    }finally{
      logout.disabled=false;logout.textContent='↪ Se déconnecter';
    }
  });
  toggle.addEventListener('click',()=>{signup=!signup;title.textContent=signup?'Créer votre espace':'Connexion';submit.textContent=signup?'Créer le compte':'Se connecter';toggle.textContent=signup?'J’ai déjà un compte':'Créer un compte';fields.style.display=signup?'block':'none';});
  form.addEventListener('submit',async e=>{e.preventDefault();if(!ppHasSupabase()){ppSetAuthStatus('Ajoutez d’abord vos identifiants Supabase dans js/supabase-config.js.');return;}
    const email=document.getElementById('authEmail').value.trim(),password=document.getElementById('authPassword').value,name=document.getElementById('authFullName').value.trim(),org=document.getElementById('authOrgName').value.trim();
    try{
      if(signup){
        if(!name||!org){ppSetAuthStatus('Nom et organisation sont obligatoires.');return;}
        localStorage.setItem('pp_pending_org',JSON.stringify({name,org}));
        const {data,error}=await ppSupabase.auth.signUp({email,password});if(error)throw error;
        if(data.session){ppSession=data.session;await ppBootCloud();await enterAdmin(true);}else ppSetAuthStatus('Compte créé. Vérifiez votre email si la confirmation est activée, puis connectez-vous.');
      }else{const {data,error}=await ppSupabase.auth.signInWithPassword({email,password});if(error)throw error;ppSession=data.session;await ppBootCloud();await enterAdmin(true);}
    }catch(err){ppSetAuthStatus(err.message||'Erreur de connexion.');}
  });
})();

ppInit();

/* === V7 : téléphone personnel + QR entreprise === */
let qrScanner = null;
function openEmployeeAccess(){
  const m=document.getElementById('employeeAccessModal');
  if(m)m.classList.add('open');
  const status=document.getElementById('employeeAccessStatus'); if(status)status.textContent='';
}
function closeEmployeeAccess(){
  const m=document.getElementById('employeeAccessModal');
  if(m)m.classList.remove('open');
}
async function employeeLoginFromApp(){
  const email=document.getElementById('employeeAccessEmail').value.trim().toLowerCase();
  const password=document.getElementById('employeeAccessPassword').value;
  const code=document.getElementById('employeeAccessCode').value.trim().toUpperCase();
  const status=document.getElementById('employeeAccessStatus');
  if(!email||!password||!code){status.textContent='E-mail, mot de passe et matricule sont obligatoires.';return;}
  if(!ppHasSupabase()){status.textContent='Supabase n’est pas configuré.';return;}
  try{
    const {data,error}=await ppSupabase.auth.signInWithPassword({email,password});
    if(error)throw error;
    ppSession=data.session; employeePortalUser=data.user;
    const {error:claimErr}=await ppSupabase.rpc('employee_claim_by_email_and_code',{p_email:email,p_employee_code:code});
    if(claimErr)throw claimErr;
    await loadEmployeeIdentity();
    loadAgentHistory();loadMyLeaveRequests();
    status.textContent='✅ E-mail et matricule vérifiés. Profil employé connecté.';
    showToast('Compte agent identifié et connecté.');
    setTimeout(closeEmployeeAccess,700);
  }catch(e){
    await ppSupabase.auth.signOut();
    ppSession=null;employeePortalUser=null;
    status.textContent='Connexion impossible : '+(e.message||'vérifiez votre e-mail, votre matricule et votre mot de passe.');
  }
}
async function employeeCreateFromApp(){
  const name=document.getElementById('employeeAccessName').value.trim();
  const email=document.getElementById('employeeAccessEmail').value.trim().toLowerCase();
  const password=document.getElementById('employeeAccessPassword').value;
  const code=document.getElementById('employeeAccessCode').value.trim().toUpperCase();
  const status=document.getElementById('employeeAccessStatus');
  if(!email||!password||!code){status.textContent='E-mail, mot de passe et matricule sont obligatoires.';return;}
  if(!ppHasSupabase()){status.textContent='Supabase n’est pas configuré.';return;}
  try{
    const {data,error}=await ppSupabase.auth.signUp({email,password,options:{data:{full_name:name||null,role:'employee'}}});
    if(error)throw error;
    if(!data.session){
      status.textContent='Compte créé. Consultez votre boîte e-mail et confirmez votre adresse. Revenez ensuite vous connecter avec votre e-mail, votre mot de passe et votre matricule.';
      return;
    }
    ppSession=data.session; employeePortalUser=data.user;
    const {error:claimErr}=await ppSupabase.rpc('employee_claim_by_email_and_code',{p_email:email,p_employee_code:code});
    if(claimErr)throw claimErr;
    await loadEmployeeIdentity();
    loadAgentHistory();loadMyLeaveRequests();
    status.textContent='✅ Compte créé : e-mail et matricule vérifiés.';
    showToast('Compte agent créé et profil associé.');
    setTimeout(closeEmployeeAccess,700);
  }catch(e){
    if(ppSession){
      try{await ppSupabase.auth.signOut();}catch{}
      ppSession=null;employeePortalUser=null;
    }
    status.textContent='Création impossible : '+(e.message||'vérifiez les informations fournies par votre administrateur.');
  }
}
(function initEmployeeAccessUI(){
  const form=document.getElementById('employeeAccessForm'), create=document.getElementById('employeeCreateBtn');
  if(!form||!create)return;
  form.addEventListener('submit',e=>{e.preventDefault();employeeLoginFromApp();});
  create.addEventListener('click',employeeCreateFromApp);
})();

function employeeSignIn(){
  if(!ppHasSupabase()){showToast('Supabase doit être connecté pour le mode employé.');return;}
  const email=prompt('Email du compte employé :');
  if(!email)return;
  const password=prompt('Mot de passe :');
  if(!password)return;
  ppSupabase.auth.signInWithPassword({email:email.trim(),password}).then(async ({data,error})=>{
    if(error)throw error;
    employeePortalUser=data.user;
    await loadEmployeeIdentity();
    loadAgentHistory();
    showToast('Compte employé connecté.');
  }).catch(e=>showToast('Connexion employé impossible : '+(e.message||'erreur')));
}
async function loadEmployeeIdentity(){
  const box=document.getElementById('employeeIdentity'),profile=document.getElementById('agentProfileCard'),greeting=document.getElementById('agentGreeting');
  if(!ppSupabase||!employeePortalUser){
    if(box)box.innerHTML='<div class="person-avatar">?</div><div><strong>Non connecté</strong><small>Connectez votre compte employé.</small></div>';
    if(profile)profile.innerHTML='<div class="agent-profile-main"><div class="agent-profile-photo">'+avatar+'</div><div class="agent-profile-name"><strong>'+name+'</strong><span>'+code+'</span></div><span class="agent-status '+(data.active===false?'inactive':'')+'">'+status+'</span></div><div class="agent-profile-details"><div><small>Département</small><strong>'+department+'</strong></div><div><small>Compte</small><strong>Vérifié à chaque pointage</strong></div></div>';
  if(profile&&ppSupabase){
    const deviceBox=document.createElement('div');deviceBox.className='agent-device-status';deviceBox.innerHTML='<small>Statut de ce téléphone</small><strong>Vérification…</strong>';profile.appendChild(deviceBox);
    const {data:device,error:deviceError}=await ppSupabase.from('employee_devices').select('status,device_label').eq('employee_id',data.id).eq('device_id',ppDeviceId()).maybeSingle();
    if(deviceError)deviceBox.innerHTML='<small>Statut de ce téléphone</small><strong>Indisponible pour le moment</strong>';
    else if(!device)deviceBox.innerHTML='<small>Statut de ce téléphone</small><strong>Pas encore enregistré — le premier scan lancera l’enregistrement.</strong>';
    else if(device.status==='active')deviceBox.innerHTML='<small>Statut de ce téléphone</small><strong>Téléphone autorisé.</strong>';
    else if(device.status==='pending')deviceBox.innerHTML='<small>Statut de ce téléphone</small><strong>Demande en attente d’approbation de l’administrateur.</strong>';
    else deviceBox.innerHTML='<small>Statut de ce téléphone</small><strong>Ce téléphone n’est pas autorisé. Demandez une nouvelle approbation.</strong>';
  }
  if(greeting)greeting.textContent='👋';return;
  }
  const {data,error}=await ppSupabase.from('employees').select('id,full_name,code,department,photo_path,active').eq('auth_user_id',employeePortalUser.id).maybeSingle();
  if(error||!data){
    if(box)box.innerHTML='<div class="person-avatar">?</div><div><strong>Compte non associé</strong><small>Demandez à l’administrateur d’associer votre matricule.</small></div>';
    if(profile)profile.innerHTML='<div class="agent-profile-empty">Aucun profil employé n’est associé à ce compte.</div>';return;
  }
  const name=escapeHTML(data.full_name||'Employé'),initials=(data.full_name||'E').split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
  let photoUrl='';if(data.photo_path){try{const {data:photo}=await ppSupabase.storage.from('employee-photos').createSignedUrl(data.photo_path,3600);photoUrl=photo?.signedUrl||'';}catch{}}
  const avatar=photoUrl?'<img src="'+escapeHTML(photoUrl)+'" alt="Photo de profil de '+name+'">':'<span>'+escapeHTML(initials)+'</span>';
  const code=escapeHTML(data.code||'Non renseigné'),department=escapeHTML(data.department||'Non renseigné'),status=data.active===false?'Inactif':'Actif';
  if(box)box.innerHTML='<div class="person-avatar">'+avatar+'</div><div><strong>'+name+'</strong><small>'+code+' • '+department+'</small></div>';
  if(profile)profile.innerHTML='<div class="agent-profile-main"><div class="agent-profile-photo">'+avatar+'</div><div class="agent-profile-name"><strong>'+name+'</strong><span>'+code+'</span></div><span class="agent-status '+(data.active===false?'inactive':'')+'">'+status+'</span></div><div class="agent-profile-details"><div><small>Département</small><strong>'+department+'</strong></div><div><small>Compte</small><strong>Associé à ce téléphone</strong></div></div>';
  if(greeting)greeting.textContent=(data.full_name||'').trim().split(/\s+/)[0]||'👋';
}
async function claimEmployeeAccount(){
  if(!ppHasSupabase()){showToast('Supabase doit être connecté.');return;}
  if(!ppSession){showToast('Connectez-vous d’abord avec le compte de l’employé.');return;}
  const email=prompt('E-mail professionnel enregistré par votre administrateur :');
  if(!email)return;
  const code=prompt('Votre matricule professionnel :');
  if(!code)return;
  try{
    const {data,error}=await ppSupabase.rpc('employee_claim_by_email_and_code',{p_email:email.trim().toLowerCase(),p_employee_code:code.trim().toUpperCase()});
    if(error)throw error;
    showToast('✅ Téléphone associé à votre profil employé.');
    await loadEmployeeIdentity();
    loadAgentHistory();
  }catch(e){showToast('Association impossible : '+(e.message||'code invalide ou déjà utilisé'));}
}

function ppDeviceId(){
  const key='presencepro_device_id';
  let id=localStorage.getItem(key);
  if(!id){id=crypto.randomUUID();localStorage.setItem(key,id);}
  return id;
}
function ppDeviceLabel(){
  const ua=navigator.userAgent||'Navigateur';
  const platform=/Android/i.test(ua)?'Android':/iPhone|iPad/i.test(ua)?'iPhone/iPad':/Windows/i.test(ua)?'Windows':/Mac/i.test(ua)?'Mac':'Appareil web';
  return platform+' • '+(navigator.language||'fr');
}
async function ppEnsureDeviceAuthorized(){
  if(!ppSupabase||!ppSession)throw new Error('Connectez-vous avec votre compte agent.');
  const {data,error}=await ppSupabase.rpc('request_my_employee_device',{p_device_id:ppDeviceId(),p_device_label:ppDeviceLabel()});
  if(error)throw error;
  if(data?.status!=='active')throw new Error('Nouvel appareil en attente : demandez à votre administrateur de l’approuver avant de pointer.');
  return true;
}
async function ppLoadDeviceRequests(employeeId,container){
  if(!container||!ppSupabase||!ppSession||!ppOrganizationId)return;
  try{
    const {data,error}=await ppSupabase.from('employee_devices').select('device_id,device_label,status,requested_at').eq('employee_id',employeeId).eq('status','pending').order('requested_at',{ascending:false});
    if(error)throw error;
    container.innerHTML=(data||[]).length?'<h4>Demandes de changement de téléphone</h4>'+(data||[]).map(d=>'<div class="device-request-row"><span><strong>'+escapeHTML(d.device_label)+'</strong><small>En attente • '+new Date(d.requested_at).toLocaleString('fr-FR')+'</small></span><button type="button" class="primary-btn device-approve-btn" data-device-id="'+escapeHTML(d.device_id)+'">Approuver</button><button type="button" class="ghost-btn device-reject-btn" data-device-id="'+escapeHTML(d.device_id)+'">Refuser</button></div>').join(''):'<p class="employee-edit-note">Aucune demande de changement de téléphone.</p>';
    container.querySelectorAll('.device-approve-btn,.device-reject-btn').forEach(btn=>btn.addEventListener('click',async()=>{
      btn.disabled=true;
      try{
        const approve=btn.classList.contains('device-approve-btn');
        const {error:reviewError}=await ppSupabase.rpc('admin_review_employee_device',{p_employee_id:employeeId,p_device_id:btn.dataset.deviceId,p_approve:approve});
        if(reviewError)throw reviewError;
        showToast(approve?'Nouvel appareil autorisé.':'Demande refusée.');
        await ppLoadDeviceRequests(employeeId,container);
      }catch(e){showToast('Action impossible : '+(e.message||'erreur'));btn.disabled=false;}
    }));
  }catch(e){container.innerHTML='<p class="employee-edit-note">Impossible de charger les demandes : '+escapeHTML(e.message||'erreur')+'</p>';}
}
function setKioskFeedback(kind,title,detail){
  const box=document.getElementById('kioskResult');if(!box)return;
  box.className='kiosk-result '+kind;
  const icon=kind==='success'?'✓':kind==='error'?'!':kind==='loading'?'…':'⌁';
  box.innerHTML='<span class="kiosk-icon" aria-hidden="true">'+icon+'</span><div><strong>'+escapeHTML(title)+'</strong><small>'+escapeHTML(detail||'')+'</small></div>';
}
async function startQrScan(){
  if(typeof Html5Qrcode==='undefined'){setKioskFeedback('error','Scanner indisponible','Actualisez la page puis réessayez.');showToast('Le module de scan QR n’est pas chargé.');return;}
  if(!ppSession){setKioskFeedback('error','Connexion nécessaire','Connectez votre compte employé avant de scanner.');showToast('Connectez d’abord votre compte employé.');return;}
  const button=document.getElementById('startQrBtn');
  if(button){button.disabled=true;button.textContent='Ouverture de la caméra…';}
  setKioskFeedback('loading','Préparation du scan','Autorisez l’accès à la caméra si votre téléphone le demande.');
  try{
    if(qrScanner){try{await qrScanner.stop();}catch{}qrScanner=null;}
    qrScanner=new Html5Qrcode('qrReader');
    await qrScanner.start({facingMode:'environment'},{fps:10,qrbox:{width:220,height:220}},async text=>{
      if(qrScanner){try{await qrScanner.stop();}catch{}qrScanner=null;}
      if(button){button.disabled=false;button.textContent='↻ Scanner à nouveau';}
      await handleCompanyQr(text);
    });
    setKioskFeedback('loading','Caméra active','Placez le QR de votre entreprise dans le cadre.');
    if(button)button.textContent='Caméra activée — cadrer le QR';
  }catch(e){
    qrScanner=null;
    if(button){button.disabled=false;button.textContent='Réessayer le scan';}
    setKioskFeedback('error','Caméra inaccessible','Vérifiez l’autorisation caméra et utilisez le site en HTTPS.');
    showToast('Impossible d’ouvrir la caméra. Vérifiez l’autorisation caméra et utilisez HTTPS.');
  }
}
async function handleCompanyQr(text){
  setKioskFeedback('loading','Vérification du QR','Contrôle de sa validité et de votre compte…');
  let payload;try{payload=JSON.parse(text);}catch{setKioskFeedback('error','QR non reconnu','Ce code ne correspond pas à un QR PrésencePro.');showToast('QR PrésencePro non reconnu.');return;}
  if(payload.type!=='presencepro-company'||!payload.organization_id||!payload.token){setKioskFeedback('error','QR invalide','Le code est incomplet ou n’est pas un QR quotidien.');showToast('QR du jour invalide ou incomplet.');return;}
  if(!ppSupabase||!ppSession){setKioskFeedback('error','Connexion nécessaire','Connectez votre compte employé sur ce téléphone.');showToast('Connectez d’abord votre compte employé sur ce téléphone.');return;}
  try{await ppEnsureDeviceAuthorized();}catch(deviceError){setKioskFeedback('error','Téléphone non autorisé',deviceError.message||'Demandez l’approbation de votre administrateur.');showToast(deviceError.message||'Appareil non autorisé.');return;}
  const {data:emp,error}=await ppSupabase.from('employees').select('id,full_name,code').eq('organization_id',payload.organization_id).eq('auth_user_id',ppSession.user.id).maybeSingle();
  if(error){setKioskFeedback('error','Vérification impossible','Un problème est survenu lors de la vérification de votre profil.');showToast(error.message||'Erreur de vérification du profil.');return;}
  if(!emp){setKioskFeedback('error','Profil non associé','Demandez à votre administrateur d’associer votre compte à votre fiche employé.');showToast('Aucun employé associé à ce compte dans cette entreprise.');return;}
  const {data:result,error:recordError}=await ppSupabase.rpc('record_my_attendance_with_qr',{p_organization_id:payload.organization_id,p_token:payload.token,p_device_id:ppDeviceId()});
  if(recordError){
    const msg=(recordError.message||'').toLowerCase();
    const expired=msg.includes('token')||msg.includes('qr')||msg.includes('expired')||msg.includes('expire');
    setKioskFeedback('error',expired?'QR expiré ou invalide':'Pointage non enregistré',expired?'Demandez le QR quotidien actuel à votre administrateur.':'Vérifiez votre connexion puis réessayez.');
    showToast(recordError.message||'Pointage impossible.');return;
  }
  const action=result?.action==='arrival'?'Arrivée':'Départ';
  const timestamp=action==='Arrivée'?result?.arrival_at:result?.departure_at;
  const time=timestamp?new Date(timestamp).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  const name=result?.employee_name||emp.full_name;
  setKioskFeedback('success',action+' enregistrée avec succès',name+' • '+time+' • Pointage confirmé par le serveur.');
  const btn=document.getElementById('startQrBtn');if(btn){btn.disabled=false;btn.textContent='Scanner à nouveau';}
  showToast(action+' enregistrée pour '+name+'.');
  await loadAgentHistory();await loadMyLeaveRequests();
}
async function showCompanyQr(){
  const box=document.getElementById('companyQr'); if(!box)return;
  if(!ppSupabase||!ppSession||!ppOrganizationId||!['owner','admin'].includes(ppUserRole)){showToast('Accès refusé : connectez-vous avec un compte administrateur autorisé.');return;}
  if(typeof QRCode==='undefined'){showToast('Le générateur QR n’est pas chargé. Actualisez la page puis réessayez.');return;}
  box.innerHTML='Génération du QR quotidien…';
  try{
    const {data,error}=await ppSupabase.rpc('get_daily_company_qr',{p_organization_id:ppOrganizationId});
    if(error)throw error;
    const payload={type:'presencepro-company',organization_id:data.organization_id,token:data.token,version:2};
    box.innerHTML='';
    new QRCode(box,{text:JSON.stringify(payload),width:200,height:200,correctLevel:QRCode.CorrectLevel.M});
    const expiry=new Date(data.expires_at).toLocaleString('fr-FR',{timeZone:'Africa/Kinshasa',dateStyle:'short',timeStyle:'short'});
    const label=document.createElement('small');
    label.textContent='Valable jusqu’au '+expiry+' • Fuseau Africa/Kinshasa';
    box.appendChild(label);
    showToast('QR quotidien sécurisé prêt à être affiché.');
  }catch(e){
    box.textContent='QR indisponible';
    showToast(e.message||'Impossible de générer le QR du jour.');
  }
}
async function verifyEmployeeBiometric(){
  if(!webauthnReady()){showToast('Biométrie native indisponible : utilisez HTTPS et un appareil compatible.');return;}
  try{await navigator.credentials.get({publicKey:{challenge:randomBytes(32),rpId:location.hostname,userVerification:'required',timeout:60000}});showToast('✅ Appareil vérifié. Vous pouvez scanner le QR de l’entreprise.');}
  catch(e){showToast('Vérification biométrique annulée ou refusée.');}
}
const _navigateTo=navigateTo;
navigateTo=function(id){_navigateTo(id);if(id==='kiosk')loadEmployeeIdentity();};
