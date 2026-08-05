const {
  $,
  esc,
  normalizeReg,
  formatDateTime,
  toIso,
  setOnlineBadge,
  registerSW
}=AMFCC;

let currentReg=localStorage.getItem('amfcc_student_reg')||'';
let holidayMode=false;
let companionPeople=[];

$('reg').value=currentReg;

function showMessage(kind,title,text){
  $('messageBox').className='result-box '+kind;
  $('messageBox').innerHTML=`
    <div class="icon">${kind==='good'?'✓':kind==='warn'?'⚠':'✕'}</div>
    <h2>${esc(title)}</h2>
    <p>${esc(text)}</p>
  `;
  $('message').classList.add('open');
  setTimeout(()=>$('message').classList.remove('open'),3600);
}

function setLookupMessage(kind,text){
  const element=$('companionLookupMessage');
  element.className='lookup-message '+(kind||'');
  element.textContent=text||'';
}

function approvalLabel(role){
  return ({
    administrator:'School Administrator',
    principal:'Principal',
    dean:'Dean',
    director:'Director'
  })[role]||role;
}

function updateRules(data){
  holidayMode=Boolean(data.school_holiday_mode);

  if(holidayMode){
    $('holidayModeBanner').style.display='block';
    $('holidayModeBanner').textContent=
      'School Holiday Mode is active. You may submit a pass at any time. Only School Administrator approval is required.';

    $('passRuleNotice').textContent=
      'School Holiday Mode: there is no Wednesday deadline. Approval requires only the School Administrator.';
  }else{
    $('holidayModeBanner').style.display='none';

    $('passRuleNotice').textContent=
      'Requests must be submitted by Wednesday at 4:00 pm. Approval requires the School Administrator and one of the Principal, Dean or Director.';
  }
}

function renderCompanions(){
  $('peopleCount').textContent=
    `${companionPeople.length} added`;

  if(!companionPeople.length){
    $('companionList').innerHTML=`
      <div class="empty small-empty">
        No additional people added. This will be an individual pass.
      </div>
    `;
    return;
  }

  $('companionList').innerHTML=companionPeople.map(person=>`
    <div class="verified-person">
      <div class="verified-icon">✓</div>
      <div class="verified-person-details">
        <strong>${esc(person.student_name)}</strong>
        <span>Registration: ${esc(person.registration_number)}</span>
      </div>
      <button
        type="button"
        class="remove-person"
        data-remove-companion="${esc(person.registration_number)}"
        aria-label="Remove ${esc(person.student_name)}">
        Remove
      </button>
    </div>
  `).join('');
}

async function findAndAddCompanion(){
  const rawValue=$('companionReg').value.trim();
  const registrationNumber=normalizeReg(rawValue);
  const applicantRegistration=normalizeReg($('reg').value);

  setLookupMessage('','');

  if(!/^\\d{5}$/.test(registrationNumber)){
    setLookupMessage('bad','Enter a valid five-digit registration number.');
    return;
  }

  if(!/^\\d{5}$/.test(applicantRegistration)){
    setLookupMessage(
      'bad',
      'Enter your own registration number at the top of the page first.'
    );
    return;
  }

  if(registrationNumber===applicantRegistration){
    setLookupMessage(
      'warn',
      'Do not add your own registration number. You are already included as the applicant.'
    );
    return;
  }

  if(companionPeople.some(
    person=>String(person.registration_number)===registrationNumber
  )){
    setLookupMessage('warn','This person has already been added.');
    return;
  }

  if(companionPeople.length>=5){
    setLookupMessage(
      'warn',
      'A pass can include up to five additional people.'
    );
    return;
  }

  $('addCompanion').disabled=true;
  $('addCompanion').textContent='Checking…';
  setLookupMessage('checking','Checking the registration number…');

  const {data,error}=await amfccDb.rpc('gate_pass_student_lookup',{
    p_registration_number:registrationNumber
  });

  $('addCompanion').disabled=false;
  $('addCompanion').textContent='Find and add';

  if(error){
    setLookupMessage(
      'bad',
      error.message||'The registration number could not be checked.'
    );
    return;
  }

  if(data?.status!=='success'){
    setLookupMessage(
      'bad',
      data?.message||'No active student was found with that number.'
    );
    return;
  }

  companionPeople.push({
    registration_number:String(data.registration_number),
    student_name:data.student_name
  });

  $('companionReg').value='';
  renderCompanions();
  setLookupMessage(
    'good',
    `${data.student_name} has been added to this pass.`
  );
}

async function loadApprovedPasses(){
  $('refreshApproved').disabled=true;

  const {data,error}=await amfccDb.rpc('public_approved_gate_passes');

  $('refreshApproved').disabled=false;

  if(error||data?.status!=='success'){
    $('approvedPasses').innerHTML=`
      <div class="empty">Approved passes could not be loaded.</div>
    `;
    return;
  }

  const rows=data.passes||[];

  $('approvedPasses').innerHTML=rows.length
    ?rows.map(item=>{
      const names=Array.isArray(item.names)
        ?item.names.map(esc).join(', ')
        :esc(item.student_name||'');

      return `
        <div class="approved-pass-row">
          <strong>${names}</strong>
          <span class="pill ${esc(item.status)}">
            ${esc(String(item.status||'').toUpperCase())}
          </span>
        </div>
      `;
    }).join('')
    :'<div class="empty">There are no active approved passes.</div>';
}

function peopleHtml(pass){
  const people=pass.people||[];
  if(!people.length)return '';

  return `
    <div class="pass-people">
      <strong>People on this pass:</strong>
      <ul>
        ${people.map(person=>`
          <li>
            ${esc(person.student_name)}
            ${person.is_primary
              ?' <span class="muted">(Applicant)</span>'
              :''}
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}

function renderPasses(data){
  $('studentName').className='student-confirmation confirmed';
  $('studentName').textContent=
    `✓ ${data.student_name} · ${data.registration_number}`;

  updateRules(data);

  if(data.pilot_mode){
    $('pilotBanner').style.display='block';
    $('pilotBanner').textContent=
      `Pilot mode is active: electronic and paper passes are running together until ${
        data.pilot_ends_at
          ?formatDateTime(data.pilot_ends_at)
          :'the pilot is ended by administration'
      }.`;
  }else{
    $('pilotBanner').style.display='none';
  }

  const list=data.passes||[];

  $('passes').innerHTML=list.length
    ?list.map(pass=>{
      const approvals=pass.approvals||[];
      const requiredRoles=holidayMode
        ?['administrator']
        :['administrator','principal','dean','director'];

      const approvalHtml=requiredRoles.map(role=>{
        const approval=approvals.find(item=>item.role===role);

        return `
          <div class="approval">
            <strong>${approvalLabel(role)}</strong>
            ${
              approval
                ?`
                  <span class="pill ${esc(approval.decision)}">
                    ${esc(approval.decision.toUpperCase())}
                  </span>
                  <br>
                  <small>
                    ${esc(formatDateTime(approval.decided_at))}
                    ${approval.comments
                      ?' · '+esc(approval.comments)
                      :''}
                  </small>
                `
                :'<span class="muted">Not signed</span>'
            }
          </div>
        `;
      }).join('');

      const roleNotice=pass.role_on_pass==='companion'
        ?`
          <div class="notice info">
            You were added to this shared pass by another student.
          </div>
        `
        :'';

      return `
        <article class="card pass-card ${esc(pass.status)}">
          <div class="pass-head">
            <div>
              <h3>${esc(pass.destination)}</h3>
              <p class="muted">
                Submitted ${esc(formatDateTime(pass.submitted_at))}
              </p>
            </div>
            <span class="pill ${esc(pass.status)}">
              ${esc(pass.status.toUpperCase())}
            </span>
          </div>

          ${roleNotice}
          ${peopleHtml(pass)}

          <p><strong>Reason:</strong> ${esc(pass.reason)}</p>

          <div class="grid two">
            <p>
              <strong>Departure:</strong><br>
              ${esc(formatDateTime(pass.departure_at))}
            </p>
            <p>
              <strong>Expected return:</strong><br>
              ${esc(formatDateTime(pass.expected_return_at))}
            </p>
          </div>

          ${
            pass.waiting_on
              ?`<div class="notice warn">
                  Waiting on: ${esc(pass.waiting_on)}
                </div>`
              :''
          }

          ${
            pass.cancellation_reason
              ?`<div class="notice bad">
                  ${esc(pass.cancellation_reason)}
                </div>`
              :''
          }

          <div class="approval-grid">${approvalHtml}</div>
        </article>
      `;
    }).join('')
    :'<div class="empty">No gate pass requests found.</div>';
}

async function loadPasses(){
  const registrationNumber=normalizeReg($('reg').value);

  if(!/^\\d{5}$/.test(registrationNumber)){
    $('studentName').className='student-confirmation bad-text';
    $('studentName').textContent='Enter a valid five-digit registration number.';

    return showMessage(
      'bad',
      'Check the number',
      'Enter a valid five-digit registration number.'
    );
  }

  currentReg=registrationNumber;
  $('reg').value=registrationNumber;
  localStorage.setItem('amfcc_student_reg',registrationNumber);

  $('loadPasses').disabled=true;
  $('loadPasses').textContent='Loading…';

  const {data,error}=await amfccDb.rpc('student_gate_pass_status_v2',{
    p_registration_number:registrationNumber
  });

  $('loadPasses').disabled=false;
  $('loadPasses').textContent='View my passes';

  if(error||data?.status!=='success'){
    $('studentName').className='student-confirmation bad-text';
    $('studentName').textContent=
      error?.message||data?.message||'Student could not be found.';

    return showMessage(
      'bad',
      'Could not load',
      error?.message||data?.message||'Try again.'
    );
  }

  renderPasses(data);
}

function validateSubmission(){
  const registrationNumber=normalizeReg($('reg').value);
  const destination=$('destination').value.trim();
  const reason=$('reason').value.trim();
  const contact=$('contact').value.trim();
  const departure=$('departure').value;
  const expectedReturn=$('expectedReturn').value;

  if(!/^\\d{5}$/.test(registrationNumber)){
    return 'Enter your valid five-digit registration number.';
  }

  if(destination.length<2){
    return 'Enter the destination.';
  }

  if(reason.length<3){
    return 'Enter a short reason for the pass.';
  }

  if(contact.length<3){
    return 'Enter a phone number or contact person.';
  }

  if(!departure||!expectedReturn){
    return 'Enter both the departure and expected return date and time.';
  }

  const departureDate=new Date(departure);
  const returnDate=new Date(expectedReturn);

  if(Number.isNaN(departureDate.getTime())||
     Number.isNaN(returnDate.getTime())){
    return 'The departure or return date is not valid.';
  }

  if(returnDate<=departureDate){
    return 'Expected return must be later than departure.';
  }

  return '';
}

async function submitPass(){
  const validationMessage=validateSubmission();

  if(validationMessage){
    return showMessage(
      'bad',
      'Check the form',
      validationMessage
    );
  }

  const registrationNumber=normalizeReg($('reg').value);

  const payload={
    p_registration_number:registrationNumber,
    p_destination:$('destination').value.trim(),
    p_reason:$('reason').value.trim(),
    p_departure_at:toIso($('departure').value),
    p_expected_return_at:toIso($('expectedReturn').value),
    p_contact_details:$('contact').value.trim(),

    // JSON is used instead of a database text-array.
    // This avoids the browser/PostgREST array conversion error.
    p_companions:companionPeople.map(
      person=>String(person.registration_number)
    )
  };

  $('submitPass').disabled=true;
  $('submitPass').textContent='Submitting…';

  const {data,error}=await amfccDb.rpc(
    'student_submit_gate_pass_v3',
    payload
  );

  $('submitPass').disabled=false;
  $('submitPass').textContent='Submit request';

  if(error){
    return showMessage(
      'bad',
      'Could not submit',
      error.message||'The request could not be submitted.'
    );
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
    ?`${peopleCount} person${peopleCount===1?'':'s'} included. The pass is waiting for School Administrator approval.`
    :`${peopleCount} person${peopleCount===1?'':'s'} included. The pass is waiting for School Administrator and senior staff approval.`;

  showMessage('good','Request submitted',text);

  $('requestSection').style.display='none';

  [
    'destination',
    'reason',
    'departure',
    'expectedReturn',
    'contact',
    'companionReg'
  ].forEach(id=>$(id).value='');

  companionPeople=[];
  renderCompanions();
  setLookupMessage('','');

  await loadPasses();
  await loadApprovedPasses();
}

$('loadPasses').onclick=loadPasses;

$('showForm').onclick=()=>{
  const open=$('requestSection').style.display==='none';
  $('requestSection').style.display=open?'block':'none';

  if(open){
    const normalized=normalizeReg($('reg').value);
    if(/^\\d{5}$/.test(normalized)){
      $('reg').value=normalized;
      loadPasses();
    }
  }
};

$('submitPass').onclick=submitPass;
$('addCompanion').onclick=findAndAddCompanion;
$('refreshApproved').onclick=loadApprovedPasses;

$('reg').onkeydown=event=>{
  if(event.key==='Enter'){
    event.preventDefault();
    loadPasses();
  }
};

$('companionReg').onkeydown=event=>{
  if(event.key==='Enter'){
    event.preventDefault();
    findAndAddCompanion();
  }
};

$('companionList').onclick=event=>{
  const button=event.target.closest('[data-remove-companion]');
  if(!button)return;

  companionPeople=companionPeople.filter(
    person=>String(person.registration_number)!==
      String(button.dataset.removeCompanion)
  );

  renderCompanions();
  setLookupMessage('good','The person was removed from this pass.');
};

$('message').onclick=()=>$('message').classList.remove('open');

window.addEventListener('online',()=>{
  setOnlineBadge('online');
  loadApprovedPasses();
});

window.addEventListener(
  'offline',
  ()=>setOnlineBadge('online')
);

setOnlineBadge('online');
renderCompanions();
loadApprovedPasses();
setInterval(loadApprovedPasses,30000);
registerSW();

if(currentReg){
  loadPasses();
}
