const CHECKIN_MEALS=['Breakfast','Lunch','Break-fast 4pm'];
const {$,esc,localDate,setOnlineBadge,registerSW}=AMFCC;

let selectedMeal='';
let selectedStudent=null;
let statusData=null;
let modeReady=false;
let submitting=false;
let searchTimer=null;
let searchSequence=0;

function personLabel(person){
  return `${person.student_name} · ${person.registration_number}`;
}

function formatServiceDate(value){
  return new Intl.DateTimeFormat('en-ZW',{
    timeZone:APP_CONFIG.TIMEZONE,
    weekday:'short',day:'numeric',month:'short',year:'numeric'
  }).format(new Date(`${value}T12:00:00+02:00`));
}

function windowFor(meal){
  if(!statusData)return null;
  if(meal==='Breakfast')return statusData.breakfast;
  if(meal==='Lunch')return statusData.lunch;
  return statusData.break_4pm;
}

function mealWindowLabel(meal){
  const windowData=windowFor(meal);
  if(!windowData)return 'Checking availability';
  if(windowData.status==='holiday_disabled')return 'Not used in Holiday Mode';
  if(windowData.status==='conference_disabled')return 'Not used in Conference Mode';
  if(windowData.is_open)return windowData.cutoff_label==='Open today'
    ?'Open today'
    :`Closes ${windowData.cutoff_label}`;
  return windowData.cutoff_label==='Open today'
    ?'Closed for today'
    :`Closed ${windowData.cutoff_label||''}`.trim();
}

function mealIsOpen(meal){
  return Boolean(modeReady&&statusData?.check_in_enabled&&windowFor(meal)?.is_open);
}

function renderMeals(){
  $('checkinMeals').innerHTML=CHECKIN_MEALS.map(meal=>`
    <button
      class="btn meal checkin-meal ${selectedMeal===meal?'selected':''}"
      data-checkin-meal="${esc(meal)}"
      type="button"
      aria-pressed="${selectedMeal===meal?'true':'false'}"
      ${mealIsOpen(meal)?'':'disabled'}>
      <span>${esc(meal)}</span>
      <small>${esc(mealWindowLabel(meal))}</small>
    </button>
  `).join('');
}

function hideSearchResults(){
  $('studentSearchResults').hidden=true;
  $('studentSearchResults').innerHTML='';
}

function renderSearchStatus(text){
  $('studentSearchResults').hidden=false;
  $('studentSearchResults').innerHTML=`<div class="student-search-status">${esc(text)}</div>`;
}

function renderSearchResults(matches){
  $('studentSearchResults').hidden=false;
  if(!matches.length){
    renderSearchStatus('No active student matched that name or registration number.');
    return;
  }
  $('studentSearchResults').innerHTML=matches.map(person=>`
    <button
      type="button"
      class="student-search-option"
      role="option"
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
    return {matches:[],message:'Enter at least two letters or two digits.'};
  }
  const {data,error}=await amfccDb.rpc('gate_pass_student_search',{p_query:cleanQuery});
  if(error)return {matches:[],message:error.message||'Student search is unavailable.'};
  if(data?.status!=='success')return {matches:[],message:data?.message||'No matching students were found.'};
  return {matches:Array.isArray(data.matches)?data.matches:[],message:''};
}

function queueStudentSearch(){
  const query=$('studentSearch').value.trim();
  clearTimeout(searchTimer);
  searchSequence+=1;
  const sequence=searchSequence;
  if(query.length<2){
    hideSearchResults();
    return;
  }
  searchTimer=setTimeout(async()=>{
    renderSearchStatus('Searching…');
    const result=await lookupStudents(query);
    if(sequence!==searchSequence)return;
    if(result.message&&!result.matches.length){
      renderSearchStatus(result.message);
      return;
    }
    renderSearchResults(result.matches);
  },250);
}

function renderSelected(){
  if(!selectedStudent){
    $('studentSelected').className='selected-student empty-selection';
    $('studentSelected').textContent='No student selected yet.';
  }else{
    $('studentSelected').className='selected-student';
    $('studentSelected').innerHTML=`
      <div>
        <strong>${esc(selectedStudent.student_name)}</strong>
        <span>Registration: ${esc(selectedStudent.registration_number)}</span>
      </div>
    `;
  }
  updateReviewAndButton();
}

function selectStudent(person){
  selectedStudent={
    student_name:String(person.student_name),
    registration_number:String(person.registration_number)
  };
  $('studentSearch').value=personLabel(selectedStudent);
  hideSearchResults();
  renderSelected();
}

function clearSelectionForEditedInput(){
  if(!selectedStudent)return;
  if($('studentSearch').value===personLabel(selectedStudent))return;
  selectedStudent=null;
  renderSelected();
}

function updateReviewAndButton(){
  $('reviewMeal').textContent=selectedMeal||'Not selected';
  $('reviewStudent').textContent=selectedStudent
    ?`${selectedStudent.student_name} · ${selectedStudent.registration_number}`
    :'Not selected';
  $('reviewDate').textContent=formatServiceDate(localDate());
  $('checkinButton').disabled=
    !modeReady||submitting||!selectedMeal||!mealIsOpen(selectedMeal)||!selectedStudent;
}

function showModeBanner(kind,title,message){
  $('modeBanner').className=`conference-banner mode-banner ${kind||''}`.trim();
  $('modeBanner').hidden=false;
  $('modeIcon').textContent=kind==='holiday'?'☀️':'⛔';
  $('modeTitle').textContent=title;
  $('modeMessage').textContent=message;
}

function hideModeBanner(){
  $('modeBanner').hidden=true;
}

async function loadStatus(){
  modeReady=false;
  $('checkinFields').disabled=true;
  showModeBanner('','Checking meal check-in','Confirming the current school mode and meal windows.');
  renderMeals();

  const {data,error}=await amfccDb.rpc('meal_planning_status',{p_service_date:localDate()});
  if(error||data?.status!=='success'){
    statusData=null;
    showModeBanner('','Meal check-in is paused','The school mode could not be confirmed. Reconnect and try again.');
    return;
  }

  statusData=data;
  modeReady=true;

  if(data.conference_mode){
    showModeBanner(
      '',
      'Conference meals are automatic',
      'Everyone is cooked for during Conference Mode, so meal check-in and collection are both disabled.'
    );
  }else if(data.holiday_mode){
    showModeBanner(
      'holiday',
      'Meal check-in is not needed in Holiday Mode',
      'Meal Collection remains available when you arrive, but students do not check in ahead.'
    );
  }else{
    hideModeBanner();
  }

  if(selectedMeal&&!mealIsOpen(selectedMeal))selectedMeal='';
  $('checkinFields').disabled=!data.check_in_enabled;
  renderMeals();
  updateReviewAndButton();
}

function showSuccess(data){
  $('result').className='collection-result';
  $('resultBox').innerHTML=`
    <div class="result-mark" aria-hidden="true">✓</div>
    <p class="result-kicker">Check-in confirmed</p>
    <h2 id="resultTitle">Checked in</h2>
    <p class="result-instruction">Kitchen can now include this student in the meal count.</p>
    <section class="checkin-confirmation">
      <header>
        <h3>${esc(data.meal_session)}</h3>
        <p>Meal planning check-in</p>
      </header>
      <dl>
        <div><dt>Student</dt><dd>${esc(data.full_name)}</dd></div>
        <div><dt>Registration</dt><dd>${esc(data.registration_number)}</dd></div>
        <div><dt>Date</dt><dd>${esc(formatServiceDate(data.service_date||localDate()))}</dd></div>
        <div><dt>Next step</dt><dd>Collect when the meal is served</dd></div>
      </dl>
    </section>
    <div class="result-actions"><button id="resultDone" class="btn primary" type="button">Done</button></div>
  `;
  $('result').hidden=false;
  $('resultDone').focus();
}

function showFailure(kind,title,message){
  $('result').className=`collection-result ${kind}`;
  $('resultBox').innerHTML=`
    <div class="simple-result">
      <div class="result-mark" aria-hidden="true">${kind==='warning'?'!':'×'}</div>
      <p class="result-kicker">${kind==='warning'?'Please check':'Not checked in'}</p>
      <h2 id="resultTitle">${esc(title)}</h2>
      <p class="result-instruction">${esc(message)}</p>
      <div class="result-actions"><button id="resultDone" class="btn primary" type="button">Go back</button></div>
    </div>
  `;
  $('result').hidden=false;
  $('resultDone').focus();
}

function closeResult(){
  $('result').hidden=true;
  setTimeout(()=>$('studentSearch').focus(),60);
}

async function submitCheckin(event){
  event.preventDefault();
  if(!selectedMeal||!selectedStudent||!mealIsOpen(selectedMeal)){
    showFailure('warning','Complete the form','Choose an open meal and click your exact student record.');
    return;
  }
  if(!navigator.onLine){
    showFailure('error','No connection','Connect to the internet and try again.');
    return;
  }

  submitting=true;
  $('checkinButton').textContent='Saving check-in…';
  updateReviewAndButton();

  const {data,error}=await amfccDb.rpc('student_plan_meal',{
    p_registration_number:selectedStudent.registration_number,
    p_meal_session:selectedMeal,
    p_service_date:localDate()
  });

  submitting=false;
  $('checkinButton').textContent='Check in';
  updateReviewAndButton();

  if(error){
    showFailure('error','Could not save',error.message||'Please try again.');
    return;
  }
  if(data?.status==='planned'){
    showSuccess(data);
    return;
  }
  if(data?.status==='duplicate'){
    showFailure('warning','Already checked in',data.message||'This meal check-in already exists.');
    return;
  }
  if(data?.status==='holiday_disabled'||data?.status==='conference_disabled'){
    await loadStatus();
    showFailure('error','Check-in is unavailable',data.message||'The current school mode disables meal check-in.');
    return;
  }
  showFailure('error','Not checked in',data?.message||'Please check the selected record and try again.');
}

document.addEventListener('click',event=>{
  const mealButton=event.target.closest('[data-checkin-meal]');
  if(mealButton){
    selectedMeal=mealButton.dataset.checkinMeal;
    renderMeals();
    updateReviewAndButton();
    return;
  }

  const studentButton=event.target.closest('[data-registration-number]');
  if(studentButton){
    selectStudent({
      student_name:studentButton.dataset.studentName,
      registration_number:studentButton.dataset.registrationNumber
    });
    return;
  }

  if(event.target.id==='resultDone'){
    closeResult();
    return;
  }

  if(!event.target.closest('.student-search-field'))hideSearchResults();
});

$('studentSearch').addEventListener('input',()=>{
  clearSelectionForEditedInput();
  queueStudentSearch();
});
$('checkinForm').addEventListener('submit',submitCheckin);

window.addEventListener('online',()=>{
  setOnlineBadge('studentStatus');
  loadStatus();
});
window.addEventListener('offline',()=>setOnlineBadge('studentStatus'));

setOnlineBadge('studentStatus');
renderSelected();
renderMeals();
loadStatus();
registerSW();
