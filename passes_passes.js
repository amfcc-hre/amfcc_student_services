const {
  $,
  esc,
  formatDateTime,
  toIso,
  setOnlineBadge,
  registerSW
}=AMFCC;

let currentReg=localStorage.getItem('amfcc_student_reg')||'';
let holidayMode=false;
let companionPeople=[];
let selectedApplicant=currentReg
  ?{registration_number:String(currentReg),student_name:''}
  :null;
let selectedCompanion=null;

const searchTimers={applicant:null,companion:null};
const searchSequences={applicant:0,companion:0};

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

function personLabel(person){
  return `${person.student_name} · ${person.registration_number}`;
}

function searchElements(purpose){
  return purpose==='applicant'
    ?{input:$('reg'),results:$('applicantSearchResults')}
    :{input:$('companionReg'),results:$('companionSearchResults')};
}

function hideSearchResults(purpose){
  const {results}=searchElements(purpose);
  results.hidden=true;
  results.innerHTML='';
}

function renderSearchStatus(purpose,text){
  const {results}=searchElements(purpose);
  results.hidden=false;
  results.innerHTML=`<div class="student-search-status">${esc(text)}</div>`;
}

function renderSearchResults(purpose,matches){
  const {results}=searchElements(purpose);
  results.hidden=false;

  if(!matches.length){
    results.innerHTML=`
      <div class="student-search-status">
        No active student matched that name or registration number.
      </div>
    `;
    return;
  }

  results.innerHTML=matches.map(person=>`
    <button
      type="button"
      class="student-search-option"
      data-search-purpose="${purpose}"
      data-student-name="${esc(person.student_name)}"
      data-registration-number="${esc(person.registration_number)}">
      <strong>${esc(person.student_name)}</strong>
      <span>Registration: ${esc(person.registration_number)}</span>
    </button>
  `).join('');
}

async function lookupStudents(query){
  const cleanQuery=String(query||'').trim();

  if(cleanQuery.length<2){
    return {
      matches:[],
      message:'Enter at least two letters of the name or two digits of the registration number.'
    };
  }

  const {data,error}=await amfccDb.rpc('gate_pass_student_search',{
    p_query:cleanQuery
  });

  if(error){
    return {
      matches:[],
      message:error.message||'Student search is temporarily unavailable.'
    };
  }

  if(data?.status!=='success'){
    return {
      matches:[],
      message:data?.message||'No matching students were found.'
    };
  }

  return {
    matches:Array.isArray(data.matches)?data.matches:[],
    message:''
  };
}

function queueStudentSearch(purpose){
  const {input}=searchElements(purpose);
  const query=input.value.trim();

  clearTimeout(searchTimers[purpose]);
  searchSequences[purpose]+=1;
  const sequence=searchSequences[purpose];

  if(query.length<2){
    hideSearchResults(purpose);
    return;
  }

  searchTimers[purpose]=setTimeout(async()=>{
    renderSearchStatus(purpose,'Searching…');
    const result=await lookupStudents(query);

    if(sequence!==searchSequences[purpose])return;

    if(result.message&&!result.matches.length){
      renderSearchStatus(purpose,result.message);
      return;
    }

    renderSearchResults(purpose,result.matches);
  },250);
}

function selectApplicant(person){
  selectedApplicant={
    registration_number:String(person.registration_number),
    student_name:person.student_name
  };

  currentReg=selectedApplicant.registration_number;
  localStorage.setItem('amfcc_student_reg',currentReg);
  $('reg').value=personLabel(selectedApplicant);
  $('studentName').className='student-confirmation confirmed';
  $('studentName').textContent=`✓ Selected: ${personLabel(selectedApplicant)}`;
  hideSearchResults('applicant');
}

function selectCompanion(person){
  selectedCompanion={
    registration_number:String(person.registration_number),
    student_name:person.student_name
  };

  $('companionReg').value=personLabel(selectedCompanion);
  setLookupMessage(
    'good',
    `Selected: ${personLabel(selectedCompanion)}. Select “Add selected person”.`
  );
  hideSearchResults('companion');
}

async function ensureApplicantSelected(){
  if(selectedApplicant?.registration_number)return true;

  const query=$('reg').value.trim();
  const result=await lookupStudents(query);

  if(result.matches.length===1){
    selectApplicant(result.matches[0]);
    return true;
  }

  if(result.matches.length>1){
    renderSearchResults('applicant',result.matches);
    $('studentName').className='student-confirmation bad-text';
    $('studentName').textContent='Choose the correct student from the matching names.';
    return false;
  }

  $('studentName').className='student-confirmation bad-text';
  $('studentName').textContent=result.message||'No matching student was found.';
  renderSearchStatus(
    'applicant',
    result.message||'No matching student was found.'
  );
  return false;
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
  $('peopleCount').textContent=`${companionPeople.length} added`;

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
  setLookupMessage('','');

  if(!(await ensureApplicantSelected())){
    setLookupMessage(
      'bad',
      'Select your own name at the top of the page before adding another person.'
    );
    return;
  }

  let person=selectedCompanion;

  if(!person){
    const query=$('companionReg').value.trim();
    const result=await lookupStudents(query);

    if(result.matches.length===1){
      person=result.matches[0];
      selectCompanion(person);
    }else if(result.matches.length>1){
      renderSearchResults('companion',result.matches);
      setLookupMessage('warn','Choose the correct person from the matching names.');
      return;
    }else{
      renderSearchStatus(
        'companion',
        result.message||'No matching student was found.'
      );
      setLookupMessage('bad',result.message||'No matching student was found.');
      return;
    }
  }

  const registrationNumber=String(person.registration_number);
  const applicantRegistration=String(selectedApplicant.registration_number);

  if(registrationNumber===applicantRegistration){
    setLookupMessage(
      'warn',
      'Do not add yourself again. You are already included as the applicant.'
    );
    return;
  }

  if(companionPeople.some(
    existing=>String(existing.registration_number)===registrationNumber
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

  companionPeople.push({
    registration_number:registrationNumber,
    student_name:person.student_name
  });

  selectedCompanion=null;
  $('companionReg').value='';
  hideSearchResults('companion');
  renderCompanions();
  setLookupMessage(
    'good',
    `${person.student_name} has been added to this pass.`
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
  selectApplicant({
    student_name:data.student_name,
    registration_number:data.registration_number
  });

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
  $('loadPasses').disabled=true;
  $('loadPasses').textContent='Searching…';

  const selected=await ensureApplicantSelected();

  if(!selected){
    $('loadPasses').disabled=false;
    $('loadPasses').textContent='View my passes';
    return;
  }

  $('loadPasses').textContent='Loading…';

  const {data,error}=await amfccDb.rpc('student_gate_pass_status_v2',{
    p_registration_number:String(selectedApplicant.registration_number)
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
  const destination=$('destination').value.trim();
  const reason=$('reason').value.trim();
  const contact=$('contact').value.trim();
  const requesterEmail=$('requesterEmail').value.trim().toLowerCase();
  const departure=$('departure').value;
  const expectedReturn=$('expectedReturn').value;

  if(!selectedApplicant?.registration_number){
    return 'Search for yourself and select the correct name first.';
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

  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)){
    return 'Enter a valid email address for pass updates.';
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
  if(!(await ensureApplicantSelected())){
    return showMessage(
      'bad',
      'Select your name',
      'Search for yourself and select the correct name before submitting.'
    );
  }

  const validationMessage=validateSubmission();

  if(validationMessage){
    return showMessage(
      'bad',
      'Check the form',
      validationMessage
    );
  }

  const payload={
    p_registration_number:String(selectedApplicant.registration_number),
    p_destination:$('destination').value.trim(),
    p_reason:$('reason').value.trim(),
    p_departure_at:toIso($('departure').value),
    p_expected_return_at:toIso($('expectedReturn').value),
    p_contact_details:$('contact').value.trim(),
    p_requester_email:$('requesterEmail').value.trim().toLowerCase(),
    p_companions:companionPeople.map(
      person=>String(person.registration_number)
    )
  };

  $('submitPass').disabled=true;
  $('submitPass').textContent='Submitting…';

  const {data,error}=await amfccDb.rpc(
    'student_submit_gate_pass_v4',
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

  if(amfccDb.functions&&typeof amfccDb.functions.invoke==='function'){
    amfccDb.functions.invoke('pass-email-worker').catch(()=>{});
  }

  $('requestSection').style.display='none';

  [
    'destination',
    'reason',
    'departure',
    'expectedReturn',
    'contact',
    'requesterEmail',
    'companionReg'
  ].forEach(id=>$(id).value='');

  selectedCompanion=null;
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
};

$('submitPass').onclick=submitPass;
$('addCompanion').onclick=findAndAddCompanion;
$('refreshApproved').onclick=loadApprovedPasses;

$('reg').addEventListener('input',()=>{
  selectedApplicant=null;
  currentReg='';
  localStorage.removeItem('amfcc_student_reg');
  $('studentName').className='student-confirmation muted';
  $('studentName').textContent='Choose the correct student from the search results.';
  queueStudentSearch('applicant');
});

$('companionReg').addEventListener('input',()=>{
  selectedCompanion=null;
  setLookupMessage('','');
  queueStudentSearch('companion');
});

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

document.addEventListener('click',event=>{
  const option=event.target.closest('[data-search-purpose]');

  if(option){
    const person={
      student_name:option.dataset.studentName,
      registration_number:option.dataset.registrationNumber
    };

    if(option.dataset.searchPurpose==='applicant'){
      selectApplicant(person);
    }else{
      selectCompanion(person);
    }
    return;
  }

  const removeButton=event.target.closest('[data-remove-companion]');

  if(removeButton){
    companionPeople=companionPeople.filter(
      person=>String(person.registration_number)!==
        String(removeButton.dataset.removeCompanion)
    );

    renderCompanions();
    setLookupMessage('good','The person was removed from this pass.');
    return;
  }

  if(!event.target.closest('.student-search-field')){
    hideSearchResults('applicant');
    hideSearchResults('companion');
  }
});

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
