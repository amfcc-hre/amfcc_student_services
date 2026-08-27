const {$,esc,formatDateTime,formatDate,localDate,downloadCsv,studentYearLabel,studentYearMatches}=AMFCC;
let pin=sessionStorage.getItem('amfcc_admin_pin')||'';
let selectedTermId=null;
let dataCache=null;
let timer=null;
let reviewPassId=null;
let editOriginal=null;


function closeLoginOverlay(){
  const modal=$('login');
  const input=$('pin');
  if(input){input.value='';input.blur();input.disabled=true;}
  if(modal){
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
    modal.hidden=true;
    modal.style.setProperty('display','none','important');
    modal.style.pointerEvents='none';
  }
  document.body.style.overflow='';
}

function toast(kind,title,text){
  $('toastBox').className='result-box '+kind;
  $('toastBox').innerHTML=`<div class="icon">${kind==='good'?'✓':kind==='warn'?'⚠':'✕'}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>`;
  $('toast').classList.add('open');
  setTimeout(()=>$('toast').classList.remove('open'),3000);
}

function localInput(value){
  if(!value)return '';
  const d=new Date(value),pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function load(){
  if(!pin)return false;
  const {data,error}=await amfccDb.rpc('admin_services_dashboard_v3',{
    p_pin:pin,
    p_term_id:selectedTermId?Number(selectedTermId):null
  });
  if(error||data?.status!=='success'){
    $('pinError').textContent=error?.message||data?.message||'Incorrect Admin password.';
    $('pinError').style.display='block';
    return false;
  }
  dataCache=data;
  selectedTermId=String(data.selected_term?.id||'');
  render();
  $('updated').textContent='Updated '+new Date().toLocaleTimeString('en-ZW');
  return true;
}

function render(){
  const c=dataCache.counts||{};
  const f=dataCache.fee_summary||{};
  $('onCount').textContent=c.on_campus||0;
  $('offCount').textContent=c.off_campus||0;
  $('bedRestCount').textContent=c.bed_rest||0;
  $('pendingCount').textContent=c.pending_passes||0;
  $('overdueCount').textContent=c.overdue_passes||0;
  $('unpaidCount').textContent=f.unpaid||0;
  $('paidFeesCount').textContent=f.paid||0;
  $('unpaidFeesCount').textContent=f.unpaid||0;
  $('holidayBanner').style.display=dataCache.school_holiday_mode?'block':'none';
  renderTerms();
  renderCampus();
  renderAccommodation();
  renderPasses();
  renderFees();
  renderDuty();
  renderRecent();
  renderSettings();
}

function renderTerms(){
  const terms=dataCache.terms||[];
  $('termSelect').innerHTML=terms.map(t=>`<option value="${esc(t.id)}" ${String(t.id)===String(selectedTermId)?'selected':''}>${esc(t.term_name)}</option>`).join('');
  const term=dataCache.selected_term||{};
  $('accommodationTermNotice').textContent=`Fees column is for ${term.term_name||'the selected term'}. Due date: ${formatDate(term.fees_due_date)||'Not set'}.`;
  $('feeTermSummary').textContent=`${term.term_name||''} · Fees due ${formatDate(term.fees_due_date)||'not set'}`;
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

function studentByRegistration(registrationNumber){
  return (dataCache?.students||[]).find(student=>String(student.registration_number)===String(registrationNumber));
}

function studentRecord(person){
  return studentByRegistration(person?.registration_number)||person||{};
}

function genderMatches(person,filter){
  return filter==='ALL'||String(studentRecord(person).gender||'').toUpperCase()===String(filter).toUpperCase();
}

function campusStatusMatches(person,filter){
  return filter==='ALL'||String(studentRecord(person).status||'UNKNOWN').toUpperCase()===String(filter).toUpperCase();
}

function personMatches(person,gender,year,campusStatus){
  const record=studentRecord(person);
  return genderMatches(record,gender)&&yearMatches(record.registration_number,year)&&campusStatusMatches(record,campusStatus);
}

function passPeople(pass){
  const people=Array.isArray(pass.people)&&pass.people.length?pass.people:[{student_name:pass.student_name,registration_number:pass.registration_number,is_primary:true}];
  return people.filter(person=>person&&person.student_name);
}

function passPeopleHtml(pass){
  return `<span class="student-name-stack">${passPeople(pass).map(person=>`<span><button class="student-link" data-review="${esc(pass.id)}">${esc(person.student_name)}</button>${person.is_primary?' <small>Applicant</small>':''}<br><small>${esc(person.registration_number)} · ${yearBadge(person.registration_number)}</small></span>`).join('')}</span>`;
}

function renderCampus(){
  const q=$('campusSearch').value.toLowerCase();
  const filter=$('campusFilter').value;
  const gender=$('campusGenderFilter').value;
  const year=$('campusYearFilter').value;
  const rows=(dataCache.students||[]).filter(s=>personMatches(s,gender,year,'ALL')&&campusMatches(s,filter)&&(`${s.student_name} ${s.registration_number}`.toLowerCase().includes(q)));
  $('campusRows').innerHTML=rows.map(s=>`<tr>
    <td>${studentNameHtml(s)}</td><td>${esc(s.registration_number)}</td>
    <td><span class="pill ${esc(s.status)}">${s.status==='IN'?'ON CAMPUS':s.status==='OUT'?'OFF CAMPUS':'UNKNOWN'}</span></td>
    <td><div class="health-icons">${healthHtml(s)}</div></td><td>${esc(formatDateTime(s.last_movement_at))}</td>
    <td><button class="btn secondary compact-btn" data-edit-student="${esc(s.registration_number)}">Edit</button></td>
  </tr>`).join('')||'<tr><td colspan="6" class="empty">No matching students.</td></tr>';
}

function accommodationMatches(s,filter){
  if(filter==='ALL')return true;
  if(filter==='ALLOCATED')return Boolean(s.residence);
  if(filter==='NOT_ALLOCATED')return !s.residence;
  if(filter==='FEES_UNPAID')return !s.fees_paid;
  if(filter==='BED_REST')return Boolean(s.bed_rest);
  if(filter==='MATERNITY')return Boolean(s.maternity);
  return true;
}

function feesIcon(paid){
  return paid?'<span class="yes-icon" title="Fees paid">✓</span>':'<span class="no-icon" title="Fees not paid">✕</span>';
}

function renderAccommodation(){
  const q=$('accommodationSearch').value.toLowerCase();
  const filter=$('accommodationFilter').value;
  const gender=$('accommodationGenderFilter').value;
  const year=$('accommodationYearFilter').value;
  const campus=$('accommodationCampusFilter').value;
  const rows=(dataCache.students||[]).filter(s=>personMatches(s,gender,year,campus)&&accommodationMatches(s,filter)&&(`${s.student_name} ${s.registration_number} ${s.residence||''} ${s.room||''}`.toLowerCase().includes(q)));
  $('accommodationRows').innerHTML=rows.map(s=>`<tr>
    <td>${studentNameHtml(s)}</td><td>${esc(s.registration_number)}</td>
    <td>${s.residence?esc(s.residence):'<span class="accommodation-missing">Not allocated</span>'}</td>
    <td>${esc(s.room||'—')}</td><td>${esc(s.bed||'—')}</td><td>${feesIcon(Boolean(s.fees_paid))}</td>
    <td>${s.maternity?'<span class="health-pill maternity">Maternity</span>':s.bed_rest?'<span class="health-pill bed-rest">🛏️ Bed rest</span>':esc(s.accommodation_status||'—')}</td>
    <td><button class="btn secondary compact-btn" data-edit-student="${esc(s.registration_number)}">Edit</button></td>
  </tr>`).join('')||'<tr><td colspan="8" class="empty">No matching students.</td></tr>';
}

function renderPasses(){
  const q=$('passSearch').value.toLowerCase();
  const filter=$('passFilter').value;
  const gender=$('passGenderFilter').value;
  const year=$('passYearFilter').value;
  const campus=$('passCampusFilter').value;
  const holiday=Boolean(dataCache.school_holiday_mode);
  $('passRuleNotice').textContent=holiday
    ?'School Holiday Mode: School Administrator approval alone completes a pass. The Wednesday deadline is paused.'
    :'Normal mode: each pass needs School Administrator approval plus one approval from the Principal, Dean or Director.';
  const rows=(dataCache.gate_passes||[]).filter(p=>{
    const statusMatch=filter==='ALL'||(filter==='OVERDUE'?Boolean(p.overdue):p.status===filter);
    const people=passPeople(p);
    const peopleMatch=people.some(person=>personMatches(person,gender,year,campus));
    const hay=people.map(person=>`${person.student_name} ${person.registration_number}`).join(' ')+` ${p.destination||''}`;
    return peopleMatch&&statusMatch&&hay.toLowerCase().includes(q);
  });
  $('passRows').innerHTML=rows.map(p=>`<tr class="${p.overdue?'overdue':''}">
    <td>${passPeopleHtml(p)}</td>
    <td>${esc(p.destination)}</td>
    <td><div class="status-review"><span class="pill ${p.overdue?'overdue':esc(p.status)}">${p.overdue?'OVERDUE':esc(p.status.toUpperCase())}</span><button class="btn secondary compact-btn" data-review="${esc(p.id)}">Review</button></div>${p.waiting_on?`<small class="muted">Waiting on ${esc(p.waiting_on)}</small>`:''}</td>
    <td>${esc(formatDateTime(p.departure_at))}<br><small>Return ${esc(formatDateTime(p.expected_return_at))}</small></td>
  </tr>`).join('')||'<tr><td colspan="4" class="empty">No matching gate passes.</td></tr>';
}

function feeMatches(s,filter){
  if(filter==='PAID')return Boolean(s.fees_paid);
  if(filter==='UNPAID')return !s.fees_paid;
  return true;
}

function renderFees(){
  const q=$('feeSearch').value.toLowerCase();
  const filter=$('feeFilter').value;
  const gender=$('feeGenderFilter').value;
  const year=$('feeYearFilter').value;
  const campus=$('feeCampusFilter').value;
  const term=dataCache.selected_term||{};
  const rows=(dataCache.students||[]).filter(s=>personMatches(s,gender,year,campus)&&feeMatches(s,filter)&&(`${s.student_name} ${s.registration_number}`.toLowerCase().includes(q)));
  $('feeRows').innerHTML=rows.map(s=>`<tr>
    <td>${studentNameHtml(s)}</td><td>${esc(s.registration_number)}</td><td>${esc(term.term_name||'')}</td>
    <td>${esc(formatDate(term.fees_due_date)||'—')}</td>
    <td><button class="fee-status fee-toggle ${s.fees_paid?'fee-paid':'fee-unpaid'}" data-fee-reg="${esc(s.registration_number)}" data-fee-paid="${s.fees_paid?'true':'false'}">${s.fees_paid?'✓ Paid':'✕ Not paid'}</button></td>
    <td>${s.fee_updated_at?esc(formatDateTime(s.fee_updated_at)):'Initial setting'}</td>
  </tr>`).join('')||'<tr><td colspan="6" class="empty">No matching students.</td></tr>';
}

function renderDuty(){
  const q=$('dutySearch').value.toLowerCase(),gender=$('dutyGenderFilter').value,year=$('dutyYearFilter').value,campus=$('dutyCampusFilter').value;
  const rows=(dataCache.gate_duty_today||[]).filter(r=>personMatches(r,gender,year,campus)&&(`${r.student_name} ${r.registration_number}`.toLowerCase().includes(q)));
  $('dutyRows').innerHTML=rows.map(r=>`<tr><td>${esc(formatDateTime(r.scanned_at))}</td><td><span class="student-name-stack"><b>${esc(r.student_name)}</b>${yearBadge(r.registration_number)}</span></td><td>${esc(r.registration_number)}</td><td><span class="pill ${esc(r.direction)}">${esc(r.direction)}</span></td><td>${esc(r.source)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No gate duty records today.</td></tr>';
}

function renderRecent(){
  const q=$('recentSearch').value.toLowerCase(),gender=$('recentGenderFilter').value,year=$('recentYearFilter').value,campus=$('recentCampusFilter').value;
  const rows=(dataCache.recent_movements||[]).filter(r=>personMatches(r,gender,year,campus)&&(`${r.student_name} ${r.registration_number}`.toLowerCase().includes(q)));
  $('recentRows').innerHTML=rows.map(r=>`<tr><td>${esc(formatDateTime(r.scanned_at))}</td><td><span class="student-name-stack"><b>${esc(r.student_name)}</b>${yearBadge(r.registration_number)}</span></td><td>${esc(r.registration_number)}</td><td><span class="pill ${esc(r.direction)}">${esc(r.direction)}</span></td><td>${r.gate_pass_id?'Approved pass':esc(r.checkout_destination_label||'Not linked')}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No campus movements recorded.</td></tr>';
}

function renderSettings(){
  const settings=dataCache.settings||{};
  $('holidayMode').checked=Boolean(settings.school_holiday_mode);
  $('pilotMode').checked=Boolean(settings.gate_pass_pilot_mode);
  $('pilotEnd').value=localInput(settings.gate_pass_pilot_ends_at);
  $('resultSeconds').value=Number(settings.gate_terminal_result_seconds||2.4);
  updateHolidayRuleSummary();
}

function updateHolidayRuleSummary(){
  const on=$('holidayMode').checked;
  $('holidayRuleSummary').textContent=on
    ?'Holiday rule: no Wednesday cutoff and one School Administrator signature.'
    :'Normal rule: Wednesday 4:00 pm cutoff and two signatures: School Administrator plus Principal, Dean or Director.';
}

function activateTab(tabId){
  document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===tabId));
  document.querySelectorAll('.section').forEach(s=>s.classList.toggle('active',s.id===tabId));
}

function applyMetricFilter(tab,value,button){
  activateTab(tab);
  document.querySelectorAll('.metric-filter').forEach(x=>x.classList.toggle('selected-filter',x===button));
  if(tab==='campus'){$('campusFilter').value=value;$('campusSearch').value='';renderCampus();}
  else if(tab==='passes'){$('passFilter').value=value;$('passSearch').value='';renderPasses();}
  else if(tab==='fees'){$('feeFilter').value=value;$('feeSearch').value='';renderFees();}
}

function openStudentEdit(registrationNumber){
  const s=(dataCache.students||[]).find(x=>String(x.registration_number)===String(registrationNumber));
  if(!s)return toast('warn','Student not found','Refresh and try again.');
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
  const accommodationChanged=removeAccommodation||residence!==(editOriginal.residence||'')||room!==(editOriginal.room||'')||bed!==(editOriginal.bed||'')||accommodationStatus!==(editOriginal.accommodation_status||'allocated');
  if(!campusChanged&&!accommodationChanged)return toast('warn','No changes','Change campus status or accommodation first.');

  $('saveStudentEdit').disabled=true;
  try{
    if(campusChanged){
      const {data,error}=await amfccDb.rpc('dashboard_update_student_campus_status',{p_pin:pin,p_registration_number:registration,p_direction:selectedStatus,p_note:$('editCampusNote').value.trim()||null});
      if(error||!['success','same_status'].includes(data?.status))throw new Error(error?.message||data?.message||'Campus status was not saved.');
    }
    if(accommodationChanged){
      const {data,error}=await amfccDb.rpc('dashboard_update_student_accommodation',{p_pin:pin,p_registration_number:registration,p_residence:residence,p_room:room||null,p_bed:bed||null,p_allocation_status:accommodationStatus,p_remove:removeAccommodation});
      if(error||data?.status!=='success')throw new Error(error?.message||data?.message||'Accommodation was not saved.');
    }
    $('studentEditModal').classList.remove('open');
    editOriginal=null;
    toast('good','Student updated','Campus and accommodation changes were saved.');
    await load();
  }catch(error){toast('bad','Not saved',error.message||'Try again.');}
  finally{$('saveStudentEdit').disabled=false;}
}

function openReview(id){
  const p=(dataCache.gate_passes||[]).find(x=>x.id===id);
  if(!p)return;
  reviewPassId=id;
  const approvals=(p.approvals||[]).map(a=>`<div class="approval-row"><b>${esc(a.role==='administrator'?'School Administrator':a.role)}</b><span>${esc(a.decision)} · ${esc(formatDateTime(a.decided_at))}</span></div>`).join('')||'<p class="muted">No decisions yet.</p>';
  $('reviewDetails').innerHTML=`<p><b>${esc(p.student_name)}</b> (${esc(p.registration_number)})</p><p><b>Destination:</b> ${esc(p.destination)}</p><p><b>Reason:</b> ${esc(p.reason)}</p><p><b>Departure:</b> ${esc(formatDateTime(p.departure_at))}</p><p><b>Expected return:</b> ${esc(formatDateTime(p.expected_return_at))}</p><p><b>Contact:</b> ${esc(p.contact_details)}</p><p><b>Status:</b> ${esc(p.status)}</p><p><b>Waiting on:</b> ${esc(p.waiting_on||'No further signature')}</p><h3>Signatures and decisions</h3><div class="approval-list">${approvals}</div>`;
  $('reviewModal').classList.add('open');
}

async function decide(decision){
  const comments=$('decisionComments').value.trim();
  if(['rejected','cancelled'].includes(decision)&&!comments)return toast('warn','Add a reason','A rejection or cancellation reason is required.');
  const {data,error}=await amfccDb.rpc('admin_gate_pass_decision',{p_pin:pin,p_pass_id:reviewPassId,p_decision:decision,p_comments:comments||null});
  if(error||data?.status!=='success')return toast('bad','Not saved',error?.message||data?.message||'Try again.');
  $('reviewModal').classList.remove('open');
  $('decisionComments').value='';
  toast('good','Decision saved',`The pass is now ${data.pass_status}.`);
  load();
}

async function toggleFee(button){
  const reg=button.dataset.feeReg;
  const current=button.dataset.feePaid==='true';
  button.classList.add('fee-updating');
  const {data,error}=await amfccDb.rpc('admin_update_fee_status',{p_pin:pin,p_registration_number:reg,p_term_id:Number(selectedTermId),p_fees_paid:!current,p_notes:null});
  button.classList.remove('fee-updating');
  if(error||data?.status!=='success')return toast('bad','Fee status not saved',error?.message||data?.message||'Try again.');
  toast('good','Fee status updated',`${data.student_name}: ${data.fees_paid?'Paid':'Not paid'} for ${data.term_name}.`);
  load();
}

async function updateSetting(key,value){
  const {data,error}=await amfccDb.rpc('admin_update_setting',{p_pin:pin,p_setting_key:key,p_setting_value:value});
  if(error||data?.status!=='success')throw new Error(error?.message||data?.message||'Could not save setting.');
  return data;
}

async function saveSettings(){
  $('saveSettings').disabled=true;
  $('settingsMessage').style.display='none';
  try{
    const holidayResult=await updateSetting('school_holiday_mode',$('holidayMode').checked);
    await updateSetting('gate_pass_pilot_mode',$('pilotMode').checked);
    if($('pilotEnd').value)await updateSetting('gate_pass_pilot_ends_at',new Date($('pilotEnd').value).toISOString());
    await updateSetting('gate_terminal_result_seconds',Number($('resultSeconds').value||2.4));
    $('settingsMessage').className='notice good';
    $('settingsMessage').textContent=`Settings saved.${holidayResult.passes_auto_approved?` ${holidayResult.passes_auto_approved} pending pass(es) were automatically approved.`:''}`;
    $('settingsMessage').style.display='block';
    await load();
  }catch(error){
    $('settingsMessage').className='notice bad';
    $('settingsMessage').textContent=error.message;
    $('settingsMessage').style.display='block';
  }finally{$('saveSettings').disabled=false;}
}

async function login(){
  pin=$('pin').value.trim();
  if(!/^\d{4}$/.test(pin)){
    $('pinError').textContent='Enter the four-digit Admin password.';
    $('pinError').style.display='block';
    return;
  }
  const ok=await load();
  if(ok){
    sessionStorage.setItem('amfcc_admin_pin',pin);
    closeLoginOverlay();
    clearInterval(timer);
    timer=setInterval(load,12000);
  }
}

function movementReportRows(rows,periodLabel,generatedAt,periodStart){
  return (rows||[]).map(r=>({
    'Report Period':periodLabel,'Generated At':formatDateTime(generatedAt),
    'Period Start':periodStart?formatDateTime(periodStart):'Current snapshot',
    'Registration Number':r.registration_number,'Student Name':r.student_name,'Class Year':studentYearLabel(r.registration_number,academicYear()),
    'Current Campus Status':r.current_campus_status,'On Campus':r.on_campus,
    'On Bed Rest':r.on_bed_rest,'Bed Rest Started':r.bed_rest_started_at?formatDateTime(r.bed_rest_started_at):'',
    'Maternity':r.maternity,'On Gate Pass':r.on_gate_pass,'Gate Pass Status':r.gate_pass_status,
    'Gate Pass Destination':r.gate_pass_destination,'Gate Pass Departure':r.gate_pass_departure_at?formatDateTime(r.gate_pass_departure_at):'',
    'Gate Pass Expected Return':r.gate_pass_expected_return_at?formatDateTime(r.gate_pass_expected_return_at):'',
    'Gate Pass Overdue':r.gate_pass_overdue,'Latest Movement':r.latest_movement_at?formatDateTime(r.latest_movement_at):'',
    'Latest Direction':r.latest_movement_direction||'','Latest Checkout Destination':r.latest_checkout_destination||'',
    'Movements in Selected Period':r.movements_in_period??'','Last Movement in Selected Period':r.last_movement_in_period?formatDateTime(r.last_movement_in_period):'',
    'Last Direction in Selected Period':r.last_direction_in_period||'','Last Destination in Selected Period':r.last_destination_in_period||'',
    'Residence':r.residence||'','Room':r.room||'','Bed':r.bed||''
  }));
}

async function exportMovements(){
  const period=$('movementPeriod').value;
  const year=$('movementYearFilter').value;
  $('exportMovements').disabled=true;
  const {data,error}=await amfccDb.rpc('student_movements_export',{p_pin:pin,p_period:period});
  $('exportMovements').disabled=false;
  if(error||data?.status!=='success')return toast('bad','Export failed',error?.message||data?.message||'Try again.');
  const filteredRows=(data.rows||[]).filter(r=>yearMatches(r.registration_number,year));
  const summary={active_students:filteredRows.length,on_campus:filteredRows.filter(r=>r.on_campus==='Yes').length,on_bed_rest:filteredRows.filter(r=>r.on_bed_rest==='Yes').length,on_gate_pass:filteredRows.filter(r=>r.on_gate_pass==='Yes').length};
  $('movementExportSummary').innerHTML=`<span><b>${esc(summary.active_students||0)}</b> active</span><span><b>${esc(summary.on_campus||0)}</b> on campus</span><span><b>${esc(summary.on_bed_rest||0)}</b> bed rest</span><span><b>${esc(summary.on_gate_pass||0)}</b> gate pass</span>`;
  try{downloadCsv(movementReportRows(filteredRows,data.period_label,data.generated_at,data.period_start),`student-movements-${period}-${year==='ALL'?'all-years':`year-${year}`}-${localDate()}.csv`);}catch(e){toast('warn','No records',e.message);}
}

async function exportReport(){
  const type=$('reportType').value,start=$('startDate').value||null,end=$('endDate').value||null,year=$('detailYearFilter').value;
  const {data,error}=await amfccDb.rpc('student_services_export',{p_pin:pin,p_report:type,p_start_date:start,p_end_date:end});
  if(error||data?.status!=='success')return toast('bad','Export failed',error?.message||data?.message||'Try again.');
  const rows=(data.rows||[]).filter(r=>yearMatches(r.registration_number,year)).map(r=>({'Class Year':studentYearLabel(r.registration_number,academicYear()),...r}));
  try{downloadCsv(rows,`${type}-${year==='ALL'?'all-years':`year-${year}`}-${start||'start'}-${end||localDate()}.csv`);}catch(e){toast('warn','No records',e.message);}
}

document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>activateTab(b.dataset.tab));
document.querySelectorAll('.metric-filter').forEach(b=>b.onclick=()=>applyMetricFilter(b.dataset.filterTab,b.dataset.filterValue,b));
document.addEventListener('click',e=>{
  const review=e.target.closest('[data-review]');if(review){openReview(review.dataset.review);return;}
  const edit=e.target.closest('[data-edit-student]');if(edit){openStudentEdit(edit.dataset.editStudent);return;}
  const fee=e.target.closest('[data-fee-reg]');if(fee)toggleFee(fee);
});
document.querySelectorAll('[data-decision]').forEach(b=>b.onclick=()=>decide(b.dataset.decision));
$('closeReview').onclick=()=>$('reviewModal').classList.remove('open');
$('closeStudentEdit').onclick=()=>{$('studentEditModal').classList.remove('open');editOriginal=null;};
$('saveStudentEdit').onclick=saveStudentEdit;
$('removeAccommodation').onchange=toggleAccommodationFields;
$('loginBtn').onclick=login;
$('pin').onkeydown=e=>{if(e.key==='Enter')login();};
$('termSelect').onchange=async()=>{selectedTermId=$('termSelect').value;await load();};
['campusGenderFilter','campusFilter','campusYearFilter'].forEach(id=>$(id).onchange=renderCampus);$('campusSearch').oninput=renderCampus;
['accommodationGenderFilter','accommodationYearFilter','accommodationCampusFilter','accommodationFilter'].forEach(id=>$(id).onchange=renderAccommodation);$('accommodationSearch').oninput=renderAccommodation;
['passGenderFilter','passYearFilter','passCampusFilter','passFilter'].forEach(id=>$(id).onchange=renderPasses);$('passSearch').oninput=renderPasses;
['feeGenderFilter','feeYearFilter','feeCampusFilter','feeFilter'].forEach(id=>$(id).onchange=renderFees);$('feeSearch').oninput=renderFees;
['dutyGenderFilter','dutyYearFilter','dutyCampusFilter'].forEach(id=>$(id).onchange=renderDuty);$('dutySearch').oninput=renderDuty;
['recentGenderFilter','recentYearFilter','recentCampusFilter'].forEach(id=>$(id).onchange=renderRecent);$('recentSearch').oninput=renderRecent;
$('refresh').onclick=load;
$('holidayMode').onchange=async()=>{
  updateHolidayRuleSummary();
  const requestedValue=$('holidayMode').checked;
  $('holidayMode').disabled=true;
  try{
    await updateSetting('school_holiday_mode',requestedValue);
    toast('good','Holiday Mode updated',requestedValue?'Holiday Mode is now ON. Gate option 4 will appear within 15 seconds.':'Holiday Mode is now OFF. Normal gate-pass rules have returned.');
    await load();
  }catch(error){
    $('holidayMode').checked=!requestedValue;
    updateHolidayRuleSummary();
    toast('bad','Holiday Mode not saved',error.message||'Try again.');
  }finally{
    $('holidayMode').disabled=false;
  }
};
$('saveSettings').onclick=saveSettings;
$('exportMovements').onclick=exportMovements;$('exportReport').onclick=exportReport;
$('toast').onclick=()=>$('toast').classList.remove('open');

const today=localDate();
$('startDate').value=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
$('endDate').value=today;
if(pin){$('pin').value=pin;login();}else $('pin').focus();
