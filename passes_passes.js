const {$,esc,normalizeReg,formatDateTime,toIso,setOnlineBadge,registerSW}=AMFCC;

let currentReg=localStorage.getItem('amfcc_student_reg')||'';
let holidayMode=false;
let companionRegs=[];

$('reg').value=currentReg;

function showMessage(kind,title,text){
  $('messageBox').className='result-box '+kind;
  $('messageBox').innerHTML=`<div class="icon">${kind==='good'?'✓':kind==='warn'?'⚠':'✕'}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>`;
  $('message').classList.add('open');
  setTimeout(()=>$('message').classList.remove('open'),3400);
}

function approvalLabel(role){
  return ({administrator:'School Administrator',principal:'Principal',dean:'Dean',director:'Director'})[role]||role;
}

function updateRules(data){
  holidayMode=Boolean(data.school_holiday_mode);
  if(holidayMode){
    $('holidayModeBanner').style.display='block';
    $('holidayModeBanner').textContent='School Holiday Mode is active. You may submit a pass at any time. Only School Administrator approval is required.';
    $('passRuleNotice').textContent='School Holiday Mode: there is no Wednesday deadline. Approval requires only the School Administrator.';
  }else{
    $('holidayModeBanner').style.display='none';
    $('passRuleNotice').textContent='Requests must be submitted by Wednesday at 4:00 pm. Approval requires the School Administrator and one of the Principal, Dean or Director.';
  }
}

function renderCompanions(){
  if(!companionRegs.length){
    $('companionList').innerHTML='<span class="muted">No additional people added.</span>';
    return;
  }
  $('companionList').innerHTML=companionRegs.map(reg=>`
    <span class="companion-chip">
      ${esc(reg)}
      <button type="button" data-remove-companion="${esc(reg)}" aria-label="Remove ${esc(reg)}">×</button>
    </span>
  `).join('');
}

function addCompanion(){
  const reg=normalizeReg($('companionReg').value);
  const applicant=normalizeReg($('reg').value);

  if(!/^\\d{5}$/.test(reg)){
    return showMessage('bad','Check the number','Enter a five-digit companion registration number.');
  }
  if(reg===applicant){
    return showMessage('warn','Already included','You are already the main person on this pass.');
  }
  if(companionRegs.includes(reg)){
    return showMessage('warn','Already added','That person is already on this pass.');
  }
  if(companionRegs.length>=5){
    return showMessage('warn','Maximum reached','A pass can include up to five additional people.');
  }

  companionRegs.push(reg);
  $('companionReg').value='';
  renderCompanions();
}

async function loadApprovedPasses(){
  $('refreshApproved').disabled=true;
  const {data,error}=await amfccDb.rpc('public_approved_gate_passes');
  $('refreshApproved').disabled=false;

  if(error||data?.status!=='success'){
    $('approvedPasses').innerHTML='<div class="empty">Approved passes could not be loaded.</div>';
    return;
  }

  const rows=data.passes||[];
  $('approvedPasses').innerHTML=rows.length?rows.map(item=>{
    const names=(item.names||[]).map(esc).join(', ');
    return `<div class="approved-pass-row"><strong>${names}</strong><span class="pill ${esc(item.status)}">${esc(String(item.status||'').toUpperCase())}</span></div>`;
  }).join(''):'<div class="empty">There are no active approved passes.</div>';
}

function peopleHtml(pass){
  const people=pass.people||[];
  if(!people.length)return '';
  return `<div class="pass-people"><strong>People on this pass:</strong><ul>${people.map(person=>`
    <li>${esc(person.student_name)}${person.is_primary?' <span class="muted">(Applicant)</span>':''}</li>
  `).join('')}</ul></div>`;
}

function renderPasses(data){
  $('studentName').textContent=`${data.student_name} · ${data.registration_number}`;
  updateRules(data);

  if(data.pilot_mode){
    $('pilotBanner').style.display='block';
    $('pilotBanner').textContent=`Pilot mode is active: electronic and paper passes are running together until ${data.pilot_ends_at?formatDateTime(data.pilot_ends_at):'the pilot is ended by administration'}.`;
  }else{
    $('pilotBanner').style.display='none';
  }

  const list=data.passes||[];
  $('passes').innerHTML=list.length?list.map(pass=>{
    const approvals=pass.approvals||[];
    const requiredRoles=holidayMode?['administrator']:['administrator','principal','dean','director'];
    const approvalHtml=requiredRoles.map(role=>{
      const approval=approvals.find(item=>item.role===role);
      return `<div class="approval"><strong>${approvalLabel(role)}</strong>${
        approval
          ?`<span class="pill ${esc(approval.decision)}">${esc(approval.decision.toUpperCase())}</span><br><small>${esc(formatDateTime(approval.decided_at))}${approval.comments?' · '+esc(approval.comments):''}</small>`
          :'<span class="muted">Not signed</span>'
      }</div>`;
    }).join('');

    const roleNotice=pass.role_on_pass==='companion'
      ?'<div class="notice info">You were added to this shared pass by another student.</div>'
      :'';

    return `<article class="card pass-card ${esc(pass.status)}">
      <div class="pass-head">
        <div><h3>${esc(pass.destination)}</h3><p class="muted">Submitted ${esc(formatDateTime(pass.submitted_at))}</p></div>
        <span class="pill ${esc(pass.status)}">${esc(pass.status.toUpperCase())}</span>
      </div>
      ${roleNotice}
      ${peopleHtml(pass)}
      <p><strong>Reason:</strong> ${esc(pass.reason)}</p>
      <div class="grid two">
        <p><strong>Departure:</strong><br>${esc(formatDateTime(pass.departure_at))}</p>
        <p><strong>Expected return:</strong><br>${esc(formatDateTime(pass.expected_return_at))}</p>
      </div>
      ${pass.waiting_on?`<div class="notice warn">Waiting on: ${esc(pass.waiting_on)}</div>`:''}
      ${pass.cancellation_reason?`<div class="notice bad">${esc(pass.cancellation_reason)}</div>`:''}
      <div class="approval-grid">${approvalHtml}</div>
    </article>`;
  }).join(''):'<div class="empty">No gate pass requests found.</div>';
}

async function loadPasses(){
  const reg=normalizeReg($('reg').value);
  if(!/^\\d{5}$/.test(reg)){
    return showMessage('bad','Check the number','Enter a five-digit registration number.');
  }

  currentReg=reg;
  localStorage.setItem('amfcc_student_reg',reg);
  $('loadPasses').disabled=true;

  const {data,error}=await amfccDb.rpc('student_gate_pass_status_v2',{
    p_registration_number:reg
  });

  $('loadPasses').disabled=false;

  if(error||data?.status!=='success'){
    return showMessage('bad','Could not load',error?.message||data?.message||'Try again.');
  }

  renderPasses(data);
}

async function submitPass(){
  const reg=normalizeReg($('reg').value);
  if(!/^\\d{5}$/.test(reg)){
    return showMessage('bad','Check the number','Enter your registration number first.');
  }

  const payload={
    p_registration_number:reg,
    p_destination:$('destination').value.trim(),
    p_reason:$('reason').value.trim(),
    p_departure_at:toIso($('departure').value),
    p_expected_return_at:toIso($('expectedReturn').value),
    p_contact_details:$('contact').value.trim(),
    p_companion_registration_numbers:companionRegs
  };

  $('submitPass').disabled=true;
  const {data,error}=await amfccDb.rpc('student_submit_gate_pass_v2',payload);
  $('submitPass').disabled=false;

  if(error){
    return showMessage('bad','Could not submit',error.message);
  }
  if(data?.status!=='success'){
    return showMessage(
      data?.status==='deadline_closed'?'warn':'bad',
      'Request not submitted',
      data?.message||'Check the information and try again.'
    );
  }

  const peopleCount=(data.people||[]).length;
  const text=data.school_holiday_mode
    ?`${peopleCount} person${peopleCount===1?'':'s'} added. The pass is waiting for School Administrator approval.`
    :`${peopleCount} person${peopleCount===1?'':'s'} added. The pass is waiting for School Administrator and senior staff approval.`;

  showMessage('good','Request submitted',text);
  $('requestSection').style.display='none';
  ['destination','reason','departure','expectedReturn','contact','companionReg'].forEach(id=>$(id).value='');
  companionRegs=[];
  renderCompanions();
  await loadPasses();
  await loadApprovedPasses();
}

$('loadPasses').onclick=loadPasses;
$('showForm').onclick=()=>{
  $('requestSection').style.display=$('requestSection').style.display==='none'?'block':'none';
};
$('submitPass').onclick=submitPass;
$('addCompanion').onclick=addCompanion;
$('refreshApproved').onclick=loadApprovedPasses;

$('reg').onkeydown=event=>{
  if(event.key==='Enter')loadPasses();
};
$('companionReg').onkeydown=event=>{
  if(event.key==='Enter'){
    event.preventDefault();
    addCompanion();
  }
};

$('companionList').onclick=event=>{
  const button=event.target.closest('[data-remove-companion]');
  if(!button)return;
  companionRegs=companionRegs.filter(reg=>reg!==button.dataset.removeCompanion);
  renderCompanions();
};

$('message').onclick=()=>$('message').classList.remove('open');
window.addEventListener('online',()=>{
  setOnlineBadge('online');
  loadApprovedPasses();
});
window.addEventListener('offline',()=>setOnlineBadge('online'));

setOnlineBadge('online');
renderCompanions();
loadApprovedPasses();
setInterval(loadApprovedPasses,30000);
registerSW();

if(currentReg)loadPasses();
