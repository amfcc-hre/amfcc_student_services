const {$,esc,normalizeReg,formatDateTime,toIso,setOnlineBadge,registerSW}=AMFCC;
let currentReg=localStorage.getItem('amfcc_student_reg')||'';
$('reg').value=currentReg;
let holidayMode=false;

function showMessage(kind,title,text){
  $('messageBox').className='result-box '+kind;
  $('messageBox').innerHTML=`<div class="icon">${kind==='good'?'✓':kind==='warn'?'⚠':'✕'}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>`;
  $('message').classList.add('open');
  setTimeout(()=>$('message').classList.remove('open'),3200);
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

function renderPasses(data){
  $('studentName').textContent=`${data.student_name} · ${data.registration_number}`;
  updateRules(data);
  const pilot=data.pilot_mode;
  if(pilot){
    $('pilotBanner').style.display='block';
    $('pilotBanner').textContent=`Pilot mode is active: electronic and paper passes are running together until ${data.pilot_ends_at?formatDateTime(data.pilot_ends_at):'the pilot is ended by administration'}.`;
  }else $('pilotBanner').style.display='none';

  const list=data.passes||[];
  $('passes').innerHTML=list.length?list.map(pass=>{
    const approvals=pass.approvals||[];
    const requiredRoles=holidayMode?['administrator']:['administrator','principal','dean','director'];
    const approvalHtml=requiredRoles.map(role=>{
      const a=approvals.find(x=>x.role===role);
      return `<div class="approval"><strong>${approvalLabel(role)}</strong>${a?`<span class="pill ${esc(a.decision)}">${esc(a.decision.toUpperCase())}</span><br><small>${esc(formatDateTime(a.decided_at))}${a.comments?' · '+esc(a.comments):''}</small>`:'<span class="muted">Not signed</span>'}</div>`;
    }).join('');
    return `<article class="card pass-card ${esc(pass.status)}"><div class="pass-head"><div><h3>${esc(pass.destination)}</h3><p class="muted">Submitted ${esc(formatDateTime(pass.submitted_at))}</p></div><span class="pill ${esc(pass.status)}">${esc(pass.status.toUpperCase())}</span></div><p><strong>Reason:</strong> ${esc(pass.reason)}</p><div class="grid two"><p><strong>Departure:</strong><br>${esc(formatDateTime(pass.departure_at))}</p><p><strong>Expected return:</strong><br>${esc(formatDateTime(pass.expected_return_at))}</p></div>${pass.waiting_on?`<div class="notice warn">Waiting on: ${esc(pass.waiting_on)}</div>`:''}${pass.cancellation_reason?`<div class="notice bad">${esc(pass.cancellation_reason)}</div>`:''}<div class="approval-grid">${approvalHtml}</div></article>`;
  }).join(''):'<div class="empty">No gate pass requests found.</div>';
}

async function loadPasses(){
  const reg=normalizeReg($('reg').value);
  if(!/^\d{5}$/.test(reg))return showMessage('bad','Check the number','Enter a five-digit registration number.');
  currentReg=reg;
  localStorage.setItem('amfcc_student_reg',reg);
  $('loadPasses').disabled=true;
  const {data,error}=await amfccDb.rpc('student_gate_pass_status',{p_registration_number:reg});
  $('loadPasses').disabled=false;
  if(error||data?.status!=='success')return showMessage('bad','Could not load',error?.message||data?.message||'Try again.');
  renderPasses(data);
}

async function submitPass(){
  const reg=normalizeReg($('reg').value);
  if(!/^\d{5}$/.test(reg))return showMessage('bad','Check the number','Enter your registration number first.');
  const payload={
    p_registration_number:reg,
    p_destination:$('destination').value.trim(),
    p_reason:$('reason').value.trim(),
    p_departure_at:toIso($('departure').value),
    p_expected_return_at:toIso($('expectedReturn').value),
    p_contact_details:$('contact').value.trim()
  };
  $('submitPass').disabled=true;
  const {data,error}=await amfccDb.rpc('student_submit_gate_pass',payload);
  $('submitPass').disabled=false;
  if(error)return showMessage('bad','Could not submit',error.message);
  if(data?.status!=='success')return showMessage(data?.status==='deadline_closed'?'warn':'bad','Request not submitted',data?.message||'Check the information and try again.');
  const text=data.school_holiday_mode
    ?'Your pass is waiting for School Administrator approval.'
    :'Your pass is waiting for School Administrator and senior staff approval.';
  showMessage('good','Request submitted',text);
  $('requestSection').style.display='none';
  ['destination','reason','departure','expectedReturn','contact'].forEach(id=>$(id).value='');
  loadPasses();
}

$('loadPasses').onclick=loadPasses;
$('showForm').onclick=()=>{$('requestSection').style.display=$('requestSection').style.display==='none'?'block':'none';};
$('submitPass').onclick=submitPass;
$('reg').onkeydown=e=>{if(e.key==='Enter')loadPasses();};
$('message').onclick=()=>$('message').classList.remove('open');
window.addEventListener('online',()=>setOnlineBadge('online'));
window.addEventListener('offline',()=>setOnlineBadge('online'));
setOnlineBadge('online');
registerSW();
if(currentReg)loadPasses();
