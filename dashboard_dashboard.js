const {$,esc,formatDateTime,localDate,downloadCsv,studentYearLabel,studentYearMatches}=AMFCC;
let pin=sessionStorage.getItem('amfcc_dashboard_pin')||'';
let dataCache=null,timer=null,reviewPassId=null,editOriginal=null;

function toast(kind,title,text){
  $('toastBox').className='result-box '+kind;
  $('toastBox').innerHTML=`<div class="icon">${kind==='good'?'✓':kind==='warn'?'⚠':'✕'}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>`;
  $('toast').classList.add('open');
  setTimeout(()=>$('toast').classList.remove('open'),2600);
}

async function load(){
  if(!pin)return false;
  const {data,error}=await amfccDb.rpc('student_services_dashboard_v2',{p_pin:pin});
  if(error||data?.status!=='success'){
    $('pinError').textContent=error?.message||data?.message||'Incorrect password.';
    $('pinError').style.display='block';
    return false;
  }
  dataCache=data;
  render();
  $('updated').textContent='Updated '+new Date().toLocaleTimeString('en-ZW');
  return true;
}

const YEAR_FILTER_IDS=['campusYearFilter','accommodationYearFilter','passYearFilter','dutyYearFilter','recentYearFilter','movementYearFilter','detailYearFilter'];
function configureYearFilters(){
  const leadership=dataCache?.access_level==='student_leadership';
  YEAR_FILTER_IDS.forEach(id=>{
    const select=$(id);
    if(!select)return;
    const thirdYear=select.querySelector('option[value="3"]');
    if(thirdYear){
      thirdYear.hidden=leadership;
      thirdYear.disabled=leadership;
    }
    if(leadership&&select.value==='3')select.value='ALL';
  });
}

function render(){
  const c=dataCache.counts||{};
  $('onCount').textContent=c.on_campus||0;
  $('offCount').textContent=c.off_campus||0;
  $('bedRestCount').textContent=c.bed_rest||0;
  $('pendingCount').textContent=c.pending_passes||0;
  $('overdueCount').textContent=c.overdue_passes||0;
  const access=dataCache.access_level||'';
  $('accessBadge').textContent=access==='management'?'Management View':'Student Leadership View';
  $('accessBadge').className='access-badge '+access;
  $('settingsLink').style.display=dataCache.can_manage_settings?'inline':'none';
  $('leadershipPassNotice').style.display=dataCache.can_review_passes?'none':'block';
  $('holidayBanner').style.display=dataCache.school_holiday_mode?'block':'none';
  configureYearFilters();
  renderCampus();
  renderAccommodation();
  renderPasses();
  renderDuty();
  renderRecent();
}

function academicYear(){return Number(dataCache?.current_academic_year)||AMFCC.currentAcademicYear();}
function yearBadge(reg){return `<span class="year-badge">${esc(studentYearLabel(reg,academicYear()))}</span>`;}
function yearMatches(reg,filter){return studentYearMatches(reg,filter,academicYear());}

function healthHtml(s){
  const items=[];
  if(s.bed_rest)items.push('<span class="health-pill bed-rest">🛏️ Bed rest</span>');
  if(s.maternity)items.push('<span class="health-pill maternity">Maternity</span>');
  return items.join(' ')||'<span class="muted">None</span>';
}

function studentNameHtml(s){
  return `<span class="student-name-stack"><span>${s.bed_rest?'<span class="bed-icon" title="On bed rest">🛏️</span>':''}<b>${esc(s.student_name)}</b></span>${yearBadge(s.registration_number)}</span>`;
}

function campusMatches(s,filter){
  if(filter==='ALL')return true;
  if(filter==='BED_REST')return Boolean(s.bed_rest);
  if(filter==='MATERNITY')return Boolean(s.maternity);
  return s.status===filter;
}

function renderCampus(){
  const q=$('campusSearch').value.toLowerCase();
  const filter=$('campusFilter').value;
  const year=$('campusYearFilter').value;
  const rows=(dataCache.students||[]).filter(s=>
    yearMatches(s.registration_number,year)&&campusMatches(s,filter)&&(`${s.student_name} ${s.registration_number}`.toLowerCase().includes(q))
  );
  $('campusRows').innerHTML=rows.map(s=>`<tr>
    <td>${studentNameHtml(s)}</td>
    <td>${esc(s.registration_number)}</td>
    <td><span class="pill ${esc(s.status)}">${s.status==='IN'?'ON CAMPUS':s.status==='OUT'?'OFF CAMPUS':'UNKNOWN'}</span></td>
    <td><div class="health-icons">${healthHtml(s)}</div></td>
    <td>${esc(formatDateTime(s.last_movement_at))}</td>
    <td><button class="btn secondary compact-btn" data-edit-student="${esc(s.registration_number)}">Edit</button></td>
  </tr>`).join('')||'<tr><td colspan="6" class="empty">No matching students.</td></tr>';
}

function accommodationMatches(s,filter){
  if(filter==='ALL')return true;
  if(filter==='ALLOCATED')return Boolean(s.residence);
  if(filter==='NOT_ALLOCATED')return !s.residence;
  if(filter==='BED_REST')return Boolean(s.bed_rest);
  if(filter==='MATERNITY')return Boolean(s.maternity);
  return true;
}

function renderAccommodation(){
  const q=$('accommodationSearch').value.toLowerCase();
  const filter=$('accommodationFilter').value;
  const year=$('accommodationYearFilter').value;
  const rows=(dataCache.students||[]).filter(s=>
    yearMatches(s.registration_number,year)&&accommodationMatches(s,filter)&&(`${s.student_name} ${s.registration_number} ${s.residence||''} ${s.room||''}`.toLowerCase().includes(q))
  );
  $('accommodationRows').innerHTML=rows.map(s=>`<tr>
    <td>${studentNameHtml(s)}</td>
    <td>${esc(s.registration_number)}</td>
    <td>${s.residence?esc(s.residence):'<span class="accommodation-missing">Not allocated</span>'}</td>
    <td>${esc(s.room||'—')}</td>
    <td>${esc(s.bed||'—')}</td>
    <td>${s.maternity?'<span class="health-pill maternity">Maternity</span>':s.bed_rest?'<span class="health-pill bed-rest">🛏️ Bed rest</span>':esc(s.accommodation_status||'—')}</td>
    <td><button class="btn secondary compact-btn" data-edit-student="${esc(s.registration_number)}">Edit</button></td>
  </tr>`).join('')||'<tr><td colspan="7" class="empty">No matching students.</td></tr>';
}

function renderPasses(){
  const q=$('passSearch').value.toLowerCase();
  const filter=$('passFilter').value;
  const year=$('passYearFilter').value;
  const rows=(dataCache.gate_passes||[]).filter(p=>{
    const statusMatch=filter==='ALL'||(filter==='OVERDUE'?Boolean(p.overdue):p.status===filter);
    return yearMatches(p.registration_number,year)&&statusMatch&&(`${p.student_name} ${p.registration_number} ${p.destination}`.toLowerCase().includes(q));
  });
  $('passRows').innerHTML=rows.map(p=>{
    const studentCell=dataCache.can_review_passes
      ?`<span class="student-name-stack"><button class="student-link" data-review="${esc(p.id)}">${esc(p.student_name)}</button>${yearBadge(p.registration_number)}<small>${esc(p.registration_number)}</small></span>`
      :`<span class="student-name-stack"><b>${esc(p.student_name)}</b>${yearBadge(p.registration_number)}<small>${esc(p.registration_number)}</small></span>`;
    const reviewButton=dataCache.can_review_passes
      ?`<button class="btn secondary compact-btn" data-review="${esc(p.id)}">Review</button>`
      :'';
    return `<tr class="${p.overdue?'overdue':''}">
      <td>${studentCell}</td>
      <td>${esc(p.destination)}</td>
      <td><div class="status-review"><span class="pill ${p.overdue?'overdue':esc(p.status)}">${p.overdue?'OVERDUE':esc(p.status.toUpperCase())}</span>${reviewButton}</div></td>
      <td>${esc(formatDateTime(p.departure_at))}<br><small>Return ${esc(formatDateTime(p.expected_return_at))}</small></td>
    </tr>`;
  }).join('')||'<tr><td colspan="4" class="empty">No matching gate passes.</td></tr>';
}

function renderDuty(){
  const q=$('dutySearch').value.toLowerCase(),year=$('dutyYearFilter').value;
  const rows=(dataCache.gate_duty_today||[]).filter(r=>yearMatches(r.registration_number,year)&&(`${r.student_name} ${r.registration_number}`.toLowerCase().includes(q)));
  $('dutyRows').innerHTML=rows.map(r=>`<tr><td>${esc(formatDateTime(r.scanned_at))}</td><td><span class="student-name-stack"><b>${esc(r.student_name)}</b>${yearBadge(r.registration_number)}</span></td><td>${esc(r.registration_number)}</td><td><span class="pill ${esc(r.direction)}">${esc(r.direction)}</span></td><td>${esc(r.source)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No gate duty records today.</td></tr>';
}

function renderRecent(){
  const q=$('recentSearch').value.toLowerCase(),year=$('recentYearFilter').value;
  const rows=(dataCache.recent_movements||[]).filter(r=>yearMatches(r.registration_number,year)&&(`${r.student_name} ${r.registration_number}`.toLowerCase().includes(q)));
  $('recentRows').innerHTML=rows.map(r=>`<tr><td>${esc(formatDateTime(r.scanned_at))}</td><td><span class="student-name-stack"><b>${esc(r.student_name)}</b>${yearBadge(r.registration_number)}</span></td><td>${esc(r.registration_number)}</td><td><span class="pill ${esc(r.direction)}">${esc(r.direction)}</span></td><td>${r.gate_pass_id?'Approved pass':esc(r.checkout_destination_label||'Not linked')}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No campus movements recorded.</td></tr>';
}

function activateTab(tabId){
  document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===tabId));
  document.querySelectorAll('.section').forEach(s=>s.classList.toggle('active',s.id===tabId));
}

function applyMetricFilter(tab,value,button){
  activateTab(tab);
  document.querySelectorAll('.metric-filter').forEach(x=>x.classList.toggle('selected-filter',x===button));
  if(tab==='campus'){
    $('campusFilter').value=value;
    $('campusSearch').value='';
    renderCampus();
  }else if(tab==='passes'){
    $('passFilter').value=value;
    $('passSearch').value='';
    renderPasses();
  }
}

function openStudentEdit(registrationNumber){
  const s=(dataCache.students||[]).find(x=>String(x.registration_number)===String(registrationNumber));
  if(!s)return toast('warn','Student not found','Refresh the dashboard and try again.');
  editOriginal={...s};
  $('studentEditSummary').innerHTML=`<p><b>${esc(s.student_name)}</b></p><p>Registration: ${esc(s.registration_number)}</p><p>Current campus status: <b>${s.status==='IN'?'On campus':s.status==='OUT'?'Off campus':'Unknown'}</b></p>`;
  $('editCampusStatus').value=s.status==='IN'||s.status==='OUT'?s.status:'';
  $('editCampusNote').value='';
  $('editResidence').value=s.residence||'';
  $('editRoom').value=s.room||'';
  $('editBed').value=s.bed||'';
  $('editAccommodationStatus').value=['waiting','allocated','checked_in','checked_out'].includes(s.accommodation_status)?s.accommodation_status:'allocated';
  $('removeAccommodation').checked=false;
  toggleAccommodationFields();
  $('studentEditModal').classList.add('open');
}

function toggleAccommodationFields(){
  const disabled=$('removeAccommodation').checked;
  ['editResidence','editRoom','editBed','editAccommodationStatus'].forEach(id=>$(id).disabled=disabled);
}

async function saveStudentEdit(){
  if(!editOriginal)return;
  const registration=String(editOriginal.registration_number);
  const selectedStatus=$('editCampusStatus').value;
  const campusChanged=selectedStatus&&selectedStatus!==editOriginal.status;
  const removeAccommodation=$('removeAccommodation').checked;
  const residence=$('editResidence').value.trim();
  const room=$('editRoom').value.trim();
  const bed=$('editBed').value.trim();
  const accommodationStatus=$('editAccommodationStatus').value;
  const accommodationChanged=removeAccommodation||
    residence!==(editOriginal.residence||'')||
    room!==(editOriginal.room||'')||
    bed!==(editOriginal.bed||'')||
    accommodationStatus!==(editOriginal.accommodation_status||'allocated');

  if(!campusChanged&&!accommodationChanged){
    return toast('warn','No changes','Change the campus status or accommodation before saving.');
  }

  $('saveStudentEdit').disabled=true;
  $('saveStudentEdit').textContent='Saving...';
  try{
    if(campusChanged){
      const {data,error}=await amfccDb.rpc('dashboard_update_student_campus_status',{
        p_pin:pin,
        p_registration_number:registration,
        p_direction:selectedStatus,
        p_note:$('editCampusNote').value.trim()||null
      });
      if(error||!['success','same_status'].includes(data?.status)){
        throw new Error(error?.message||data?.message||'Campus status was not saved.');
      }
    }

    if(accommodationChanged){
      const {data,error}=await amfccDb.rpc('dashboard_update_student_accommodation',{
        p_pin:pin,
        p_registration_number:registration,
        p_residence:residence,
        p_room:room||null,
        p_bed:bed||null,
        p_allocation_status:accommodationStatus,
        p_remove:removeAccommodation
      });
      if(error||data?.status!=='success'){
        throw new Error(error?.message||data?.message||'Accommodation was not saved.');
      }
    }

    $('studentEditModal').classList.remove('open');
    editOriginal=null;
    toast('good','Student updated','Campus and accommodation changes were saved.');
    await load();
  }catch(error){
    toast('bad','Not saved',error.message||'Try again.');
  }finally{
    $('saveStudentEdit').disabled=false;
    $('saveStudentEdit').textContent='Save changes';
  }
}

function openReview(id){
  if(!dataCache.can_review_passes)return toast('warn','View only','Management password is required to change a gate pass.');
  const p=(dataCache.gate_passes||[]).find(x=>x.id===id);
  if(!p)return;
  reviewPassId=id;
  const approvals=(p.approvals||[]).map(a=>`<div class="approval-row"><b>${esc(a.role)}</b><span>${esc(a.decision)} · ${esc(formatDateTime(a.decided_at))}</span></div>`).join('')||'<p class="muted">No decisions yet.</p>';
  $('reviewDetails').innerHTML=`<p><b>${esc(p.student_name)}</b> (${esc(p.registration_number)})</p><p><b>Destination:</b> ${esc(p.destination)}</p><p><b>Reason:</b> ${esc(p.reason)}</p><p><b>Departure:</b> ${esc(formatDateTime(p.departure_at))}</p><p><b>Expected return:</b> ${esc(formatDateTime(p.expected_return_at))}</p><p><b>Contact:</b> ${esc(p.contact_details)}</p><p><b>Status:</b> ${esc(p.status)}</p><h3>Signatures and decisions</h3><div class="approval-list">${approvals}</div>`;
  $('reviewModal').classList.add('open');
}

async function decide(decision){
  if(!dataCache.can_review_passes)return toast('warn','Management only','Use the Management password to make a senior staff decision.');
  const role=$('actorRole').value;
  if(!role)return toast('warn','Choose a role','Select Principal, Dean or Director.');
  const comments=$('decisionComments').value.trim();
  if(['rejected','cancelled'].includes(decision)&&!comments)return toast('warn','Add a reason','A rejection or cancellation reason is required.');
  const {data,error}=await amfccDb.rpc('dashboard_gate_pass_decision',{p_pin:pin,p_pass_id:reviewPassId,p_actor_role:role,p_decision:decision,p_comments:comments||null});
  if(error||data?.status!=='success')return toast('bad','Not saved',error?.message||data?.message||'Try again.');
  $('reviewModal').classList.remove('open');
  $('decisionComments').value='';
  toast('good','Decision saved',`The pass is now ${data.pass_status}.`);
  load();
}

async function login(){
  pin=$('pin').value.trim();
  if(!/^\d{4}$/.test(pin)){
    $('pinError').textContent='Enter the four-digit password.';
    $('pinError').style.display='block';
    return;
  }
  const ok=await load();
  if(ok){
    sessionStorage.setItem('amfcc_dashboard_pin',pin);
    $('login').classList.remove('open');
    clearInterval(timer);
    timer=setInterval(load,10000);
  }
}

function movementReportRows(rows,periodLabel,generatedAt,periodStart){
  return (rows||[]).map(r=>({
    'Report Period':periodLabel,
    'Generated At':formatDateTime(generatedAt),
    'Period Start':periodStart?formatDateTime(periodStart):'Current snapshot',
    'Registration Number':r.registration_number,
    'Student Name':r.student_name,
    'Class Year':studentYearLabel(r.registration_number,academicYear()),
    'Current Campus Status':r.current_campus_status,
    'On Campus':r.on_campus,
    'On Bed Rest':r.on_bed_rest,
    'Bed Rest Started':r.bed_rest_started_at?formatDateTime(r.bed_rest_started_at):'',
    'Maternity':r.maternity,
    'On Gate Pass':r.on_gate_pass,
    'Gate Pass Status':r.gate_pass_status,
    'Gate Pass Destination':r.gate_pass_destination,
    'Gate Pass Departure':r.gate_pass_departure_at?formatDateTime(r.gate_pass_departure_at):'',
    'Gate Pass Expected Return':r.gate_pass_expected_return_at?formatDateTime(r.gate_pass_expected_return_at):'',
    'Gate Pass Overdue':r.gate_pass_overdue,
    'Latest Movement':r.latest_movement_at?formatDateTime(r.latest_movement_at):'',
    'Latest Direction':r.latest_movement_direction||'',
    'Latest Checkout Destination':r.latest_checkout_destination||'',
    'Movements in Selected Period':r.movements_in_period??'',
    'Last Movement in Selected Period':r.last_movement_in_period?formatDateTime(r.last_movement_in_period):'',
    'Last Direction in Selected Period':r.last_direction_in_period||'',
    'Last Destination in Selected Period':r.last_destination_in_period||'',
    'Residence':r.residence||'',
    'Room':r.room||'',
    'Bed':r.bed||''
  }));
}

async function exportMovements(){
  const period=$('movementPeriod').value;
  const year=$('movementYearFilter').value;
  $('exportMovements').disabled=true;
  $('exportMovements').textContent='Preparing report...';
  const {data,error}=await amfccDb.rpc('student_movements_export',{p_pin:pin,p_period:period});
  $('exportMovements').disabled=false;
  $('exportMovements').textContent='Download student movement CSV';
  if(error||data?.status!=='success')return toast('bad','Export failed',error?.message||data?.message||'Try again.');
  const filteredRows=(data.rows||[]).filter(r=>yearMatches(r.registration_number,year));
  const summary={active_students:filteredRows.length,on_campus:filteredRows.filter(r=>r.on_campus==='Yes').length,on_bed_rest:filteredRows.filter(r=>r.on_bed_rest==='Yes').length,on_gate_pass:filteredRows.filter(r=>r.on_gate_pass==='Yes').length};
  $('movementExportSummary').innerHTML=`<span><b>${esc(summary.active_students||0)}</b> active students</span><span><b>${esc(summary.on_campus||0)}</b> on campus</span><span><b>${esc(summary.on_bed_rest||0)}</b> on bed rest</span><span><b>${esc(summary.on_gate_pass||0)}</b> on gate pass</span>`;
  const rows=movementReportRows(filteredRows,data.period_label,data.generated_at,data.period_start);
  const filename=`student-movements-${period}-${year==='ALL'?'all-years':`year-${year}`}-${localDate()}.csv`;
  try{
    downloadCsv(rows,filename);
    toast('good','Report downloaded',`${data.period_label}: ${summary.active_students||0} students included.`);
  }catch(e){toast('warn','No records',e.message);}
}

async function exportReport(){
  const type=$('reportType').value;
  const start=$('startDate').value||null;
  const end=$('endDate').value||null;
  const year=$('detailYearFilter').value;
  const {data,error}=await amfccDb.rpc('student_services_export',{p_pin:pin,p_report:type,p_start_date:start,p_end_date:end});
  if(error||data?.status!=='success')return toast('bad','Export failed',error?.message||data?.message||'Try again.');
  const rows=(data.rows||[]).filter(r=>yearMatches(r.registration_number,year)).map(r=>({'Class Year':studentYearLabel(r.registration_number,academicYear()),...r}));
  try{downloadCsv(rows,`${type}-${year==='ALL'?'all-years':`year-${year}`}-${start||'start'}-${end||localDate()}.csv`);}catch(e){toast('warn','No records',e.message);}
}

document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>activateTab(b.dataset.tab));
document.querySelectorAll('.metric-filter').forEach(b=>b.onclick=()=>applyMetricFilter(b.dataset.filterTab,b.dataset.filterValue,b));
document.addEventListener('click',e=>{
  const review=e.target.closest('[data-review]');
  if(review){openReview(review.dataset.review);return;}
  const edit=e.target.closest('[data-edit-student]');
  if(edit)openStudentEdit(edit.dataset.editStudent);
});
document.querySelectorAll('[data-decision]').forEach(b=>b.onclick=()=>decide(b.dataset.decision));
$('closeReview').onclick=()=>$('reviewModal').classList.remove('open');
$('closeStudentEdit').onclick=()=>{$('studentEditModal').classList.remove('open');editOriginal=null;};
$('saveStudentEdit').onclick=saveStudentEdit;
$('removeAccommodation').onchange=toggleAccommodationFields;
$('loginBtn').onclick=login;
$('pin').onkeydown=e=>{if(e.key==='Enter')login();};
$('campusSearch').oninput=renderCampus;
$('campusFilter').onchange=renderCampus;
$('campusYearFilter').onchange=renderCampus;
$('accommodationSearch').oninput=renderAccommodation;
$('accommodationFilter').onchange=renderAccommodation;
$('accommodationYearFilter').onchange=renderAccommodation;
$('passSearch').oninput=renderPasses;
$('passFilter').onchange=renderPasses;
$('passYearFilter').onchange=renderPasses;
$('dutySearch').oninput=renderDuty;
$('dutyYearFilter').onchange=renderDuty;
$('recentSearch').oninput=renderRecent;
$('recentYearFilter').onchange=renderRecent;
$('refresh').onclick=load;
$('exportMovements').onclick=exportMovements;
$('exportReport').onclick=exportReport;
$('toast').onclick=()=>$('toast').classList.remove('open');

const today=localDate();
const past=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
$('startDate').value=past;
$('endDate').value=today;
if(pin){$('pin').value=pin;login();}else $('pin').focus();
