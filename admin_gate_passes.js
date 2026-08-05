const {$,esc,formatDateTime}=AMFCC;

let pin=sessionStorage.getItem('amfcc_admin_pin')||'';
let dataCache=null;
let reviewPassId=null;

function toast(kind,title,text){
  $('toastBox').className='result-box '+kind;
  $('toastBox').innerHTML=`<div class="icon">${kind==='good'?'✓':kind==='warn'?'⚠':'✕'}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>`;
  $('toast').classList.add('open');
  setTimeout(()=>$('toast').classList.remove('open'),3000);
}

function closeLoginOverlay(){
  $('login').classList.remove('open');
  $('login').hidden=true;
  $('login').style.setProperty('display','none','important');
  $('pin').value='';
  $('pin').disabled=true;
  $('adminPage').hidden=false;
}

function localInput(value){
  if(!value)return '';
  const date=new Date(value);
  const pad=number=>String(number).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function load(){
  const {data,error}=await amfccDb.rpc('admin_services_dashboard',{
    p_pin:pin,
    p_term_id:null
  });

  if(error||data?.status!=='success'){
    $('pinError').textContent=error?.message||data?.message||'Incorrect School Administration password.';
    $('pinError').style.display='block';
    return false;
  }

  dataCache=data;
  renderPasses();
  $('updated').textContent='Updated '+new Date().toLocaleTimeString('en-ZW');
  return true;
}

function renderPasses(){
  const query=$('passSearch').value.trim().toLowerCase();
  const status=$('passFilter').value;

  const rows=(dataCache?.gate_passes||[]).filter(pass=>{
    const statusMatch=status==='ALL'||pass.status===status;
    const text=`${pass.student_name} ${pass.registration_number} ${pass.destination}`.toLowerCase();
    return statusMatch&&text.includes(query);
  });

  $('passRows').innerHTML=rows.map(pass=>`<tr>
    <td><b>${esc(pass.student_name)}</b><br><small>${esc(pass.registration_number)}</small></td>
    <td>${esc(pass.destination)}</td>
    <td><span class="pill ${esc(pass.status)}">${esc(pass.status.toUpperCase())}</span>${pass.waiting_on?`<br><small>Waiting on ${esc(pass.waiting_on)}</small>`:''}</td>
    <td>${esc(formatDateTime(pass.departure_at))}<br><small>Return ${esc(formatDateTime(pass.expected_return_at))}</small></td>
    <td><button class="btn secondary compact-btn" data-review="${esc(pass.id)}">Open</button></td>
  </tr>`).join('')||'<tr><td colspan="5" class="empty">No matching gate passes.</td></tr>';
}

async function openReview(id){
  reviewPassId=id;
  $('reviewDetails').innerHTML='<div class="empty">Loading pass…</div>';
  $('reviewModal').classList.add('open');

  const {data,error}=await amfccDb.rpc('admin_gate_pass_review_details',{
    p_pin:pin,
    p_pass_id:id
  });

  if(error||data?.status!=='success'){
    $('reviewModal').classList.remove('open');
    return toast('bad','Could not open pass',error?.message||data?.message||'Try again.');
  }

  const pass=data.pass;
  const people=(pass.people||[]).map(person=>`
    <li><b>${esc(person.student_name)}</b> (${esc(person.registration_number)})${person.is_primary?' · Applicant':''}</li>
  `).join('');

  const approvals=(pass.approvals||[]).map(approval=>`
    <div class="approval-row">
      <b>${esc(approval.role==='administrator'?'School Administrator':approval.role)}</b>
      <span>${esc(approval.decision)} · ${esc(formatDateTime(approval.decided_at))}</span>
    </div>
  `).join('')||'<p class="muted">No decisions yet.</p>';

  $('reviewDetails').innerHTML=`
    <p><b>Applicant:</b> ${esc(pass.student_name)} (${esc(pass.registration_number)})</p>
    <p><b>Destination:</b> ${esc(pass.destination)}</p>
    <p><b>Reason:</b> ${esc(pass.reason)}</p>
    <p><b>Contact:</b> ${esc(pass.contact_details)}</p>
    <p><b>Status:</b> ${esc(pass.status)}</p>
    <p><b>Waiting on:</b> ${esc(pass.waiting_on||'No further signature')}</p>
    <h3>People on this pass</h3>
    <ul class="review-people">${people}</ul>
    <h3>Signatures and decisions</h3>
    <div class="approval-list">${approvals}</div>
  `;

  $('reviewDeparture').value=localInput(pass.departure_at);
  $('reviewExpectedReturn').value=localInput(pass.expected_return_at);
  $('decisionComments').value='';
}

async function saveReview(decision=null){
  if(!reviewPassId)return;

  const departure=$('reviewDeparture').value;
  const expectedReturn=$('reviewExpectedReturn').value;
  const comments=$('decisionComments').value.trim();

  if(!departure||!expectedReturn){
    return toast('warn','Dates required','Enter both the departure and expected return date and time.');
  }
  if(['rejected','cancelled'].includes(decision)&&!comments){
    return toast('warn','Add a reason','A rejection or cancellation reason is required.');
  }

  document.querySelectorAll('#reviewModal button').forEach(button=>button.disabled=true);

  const {data,error}=await amfccDb.rpc('admin_review_gate_pass',{
    p_pin:pin,
    p_pass_id:reviewPassId,
    p_departure_at:new Date(departure).toISOString(),
    p_expected_return_at:new Date(expectedReturn).toISOString(),
    p_decision:decision,
    p_comments:comments||null
  });

  document.querySelectorAll('#reviewModal button').forEach(button=>button.disabled=false);

  if(error||data?.status!=='success'){
    return toast('bad','Not saved',error?.message||data?.message||'Try again.');
  }

  $('reviewModal').classList.remove('open');
  reviewPassId=null;

  if(decision){
    toast('good','Pass updated',`The dates were saved and the pass is now ${data.pass_status}.`);
  }else{
    toast('good','Dates updated','The departure and expected return date and time were saved.');
  }

  await load();
}

async function login(){
  pin=$('pin').value.trim();
  if(!/^\\d{4}$/.test(pin)){
    $('pinError').textContent='Enter the four-digit School Administration password.';
    $('pinError').style.display='block';
    return;
  }

  $('loginBtn').disabled=true;
  const success=await load();
  $('loginBtn').disabled=false;

  if(success){
    sessionStorage.setItem('amfcc_admin_pin',pin);
    closeLoginOverlay();
  }
}

$('loginBtn').onclick=login;
$('pin').onkeydown=event=>{
  if(event.key==='Enter')login();
};
$('refresh').onclick=load;
$('passSearch').oninput=renderPasses;
$('passFilter').onchange=renderPasses;
$('saveSchedule').onclick=()=>saveReview(null);
$('closeReview').onclick=()=>{
  $('reviewModal').classList.remove('open');
  reviewPassId=null;
};
$('toast').onclick=()=>$('toast').classList.remove('open');

document.addEventListener('click',event=>{
  const review=event.target.closest('[data-review]');
  if(review){
    openReview(review.dataset.review);
    return;
  }

  const decision=event.target.closest('[data-decision]');
  if(decision){
    saveReview(decision.dataset.decision);
  }
});

if(pin){
  $('pin').value=pin;
  login();
}else{
  $('pin').focus();
}
