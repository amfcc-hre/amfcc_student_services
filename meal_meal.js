const MEALS=['Breakfast','Lunch','Break-fast 4pm','Supper'];
const {$,esc,localDate,setOnlineBadge,registerSW}=AMFCC;

let selectedMeal='';
let selectedCollector=null;
let selectedAdditional=null;
let conferenceMode=true;
let modeReady=false;
let submitting=false;

const searchTimers={collector:null,additional:null};
const searchSequences={collector:0,additional:0};

function personLabel(person){
  return `${person.student_name} · ${person.registration_number}`;
}

function searchElements(purpose){
  return purpose==='collector'
    ?{input:$('collectorSearch'),results:$('collectorSearchResults')}
    :{input:$('additionalSearch'),results:$('additionalSearchResults')};
}

function selectedPerson(purpose){
  return purpose==='collector'?selectedCollector:selectedAdditional;
}

function setSelectedPerson(purpose,person){
  if(purpose==='collector')selectedCollector=person;
  else selectedAdditional=person;
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
    renderSearchStatus(
      purpose,
      'No active student matched that name or registration number.'
    );
    return;
  }

  results.innerHTML=matches.map(person=>`
    <button
      type="button"
      class="student-search-option"
      role="option"
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

function renderSelected(purpose){
  const person=selectedPerson(purpose);
  const element=purpose==='collector'?$('collectorSelected'):$('additionalSelected');

  if(!person){
    element.className='selected-student empty-selection';
    element.textContent=purpose==='collector'
      ?'No student selected yet.'
      :'No additional student selected yet.';
    return;
  }

  element.className='selected-student';
  element.innerHTML=`
    <div>
      <strong>${esc(person.student_name)}</strong>
      <span>Registration: ${esc(person.registration_number)}</span>
    </div>
  `;
}

function selectStudent(purpose,person){
  if(
    purpose==='additional'
    && selectedCollector
    && String(selectedCollector.registration_number)===String(person.registration_number)
  ){
    renderSearchStatus('additional','Choose a different student. Your record is already selected above.');
    return;
  }

  if(
    purpose==='collector'
    && selectedAdditional
    && String(selectedAdditional.registration_number)===String(person.registration_number)
  ){
    selectedAdditional=null;
    $('additionalSearch').value='';
    renderSelected('additional');
  }

  const normalized={
    registration_number:String(person.registration_number),
    student_name:String(person.student_name)
  };

  setSelectedPerson(purpose,normalized);
  searchElements(purpose).input.value=personLabel(normalized);
  hideSearchResults(purpose);
  renderSelected(purpose);
  updateSummaryAndButton();
}

function clearSelectionForEditedInput(purpose){
  const person=selectedPerson(purpose);
  if(!person)return;
  const {input}=searchElements(purpose);
  if(input.value===personLabel(person))return;
  setSelectedPerson(purpose,null);
  renderSelected(purpose);
  updateSummaryAndButton();
}

function normalizedChildren(){
  const raw=Number.parseInt($('childPortions').value,10);
  if(!Number.isFinite(raw))return 0;
  return Math.max(0,Math.min(10,raw));
}

function updateSummaryAndButton(){
  const collectingForOther=$('collectingForOther').checked;
  const studentPortions=1+(collectingForOther&&selectedAdditional?1:0);
  const childPortions=normalizedChildren();

  $('studentPortionCount').textContent=String(studentPortions);
  $('childPortionCount').textContent=String(childPortions);
  $('totalPortionCount').textContent=String(studentPortions+childPortions);

  $('collectButton').disabled=
    !modeReady
    ||conferenceMode
    ||submitting
    ||!selectedMeal
    ||!selectedCollector
    ||(collectingForOther&&!selectedAdditional);
}

function renderMeals(){
  $('studentMeals').innerHTML=MEALS.map(meal=>`
    <button
      class="btn meal ${selectedMeal===meal?'selected':''}"
      data-meal="${esc(meal)}"
      type="button"
      aria-pressed="${selectedMeal===meal?'true':'false'}">
      ${esc(meal)}
    </button>
  `).join('');
}

function formatServiceDate(value){
  if(!value)return '';
  return new Intl.DateTimeFormat('en-ZW',{
    timeZone:APP_CONFIG.TIMEZONE,
    weekday:'long',
    day:'numeric',
    month:'long',
    year:'numeric'
  }).format(new Date(`${value}T12:00:00+02:00`));
}

function formatCollectionTime(value){
  if(!value)return '';
  return new Intl.DateTimeFormat('en-ZW',{
    timeZone:APP_CONFIG.TIMEZONE,
    hour:'numeric',
    minute:'2-digit',
    second:'2-digit'
  }).format(new Date(value));
}

function showConfirmation(data){
  const collector=data.collector||{};
  const additional=data.additional_student||null;
  const children=Number(data.child_portions||0);
  const total=Number(data.total_portions||1);
  const childRow=children>0?`
    <div class="recipient-row child-row">
      <strong>Children</strong>
      <span>${children} ${children===1?'portion':'portions'} · names not required</span>
    </div>
  `:'';
  const additionalRow=additional?`
    <div class="recipient-row">
      <strong>${esc(additional.full_name)}</strong>
      <span>Additional student · ${esc(additional.registration_number)}</span>
    </div>
  `:'';

  $('result').className='collection-result';
  $('resultBox').innerHTML=`
    <div class="result-mark" aria-hidden="true">✓</div>
    <p class="result-kicker">Collection confirmed</p>
    <h2 id="resultTitle">Ready to dish</h2>
    <p class="result-instruction">Show this full screen to Kitchen staff.</p>
    <section class="confirmation-card">
      <div class="confirmation-main">
        <div>
          <h3>${esc(data.meal_session)}</h3>
          <p>Meal collection confirmation</p>
        </div>
        <div class="portion-total">
          <strong>${total}</strong>
          <span>Total ${total===1?'portion':'portions'}</span>
        </div>
      </div>
      <div class="confirmation-details">
        <div class="confirmation-detail">
          <span>Date</span>
          <strong>${esc(formatServiceDate(data.service_date))}</strong>
        </div>
        <div class="confirmation-detail">
          <span>Time collected</span>
          <strong>${esc(formatCollectionTime(data.collected_at))}</strong>
        </div>
      </div>
      <div class="recipient-list">
        <div class="recipient-row">
          <strong>${esc(collector.full_name)}</strong>
          <span>Collector · ${esc(collector.registration_number)}</span>
        </div>
        ${additionalRow}
        ${childRow}
      </div>
    </section>
    <div class="result-actions">
      <button id="resultDone" class="btn primary" type="button">Done</button>
    </div>
  `;
  $('result').hidden=false;
  $('resultDone').focus();
}

function showFailure(kind,title,message){
  $('result').className=`collection-result ${kind}`;
  $('resultBox').innerHTML=`
    <div class="simple-result">
      <div class="result-mark" aria-hidden="true">${kind==='warning'?'!':'×'}</div>
      <p class="result-kicker">${kind==='warning'?'Please check':'Not collected'}</p>
      <h2 id="resultTitle">${esc(title)}</h2>
      <p class="result-instruction">${esc(message)}</p>
      <div class="result-actions">
        <button id="resultDone" class="btn primary" type="button">Go back</button>
      </div>
    </div>
  `;
  $('result').hidden=false;
  $('resultDone').focus();
}

function resetAfterCollection(){
  $('result').hidden=true;
  selectedCollector=null;
  selectedAdditional=null;
  $('collectorSearch').value='';
  $('additionalSearch').value='';
  $('collectingForOther').checked=false;
  $('additionalSection').hidden=true;
  $('childPortions').value='0';
  renderSelected('collector');
  renderSelected('additional');
  updateSummaryAndButton();
  setTimeout(()=>$('collectorSearch').focus(),60);
}

function applyConferenceState(isConference,message){
  conferenceMode=Boolean(isConference);
  $('conferenceBanner').hidden=!conferenceMode;
  $('collectionFields').disabled=conferenceMode||!modeReady;

  if(conferenceMode&&message){
    $('conferenceBanner').querySelector('p').textContent=message;
  }

  updateSummaryAndButton();
}

async function loadMode(){
  modeReady=false;
  applyConferenceState(true,'Checking whether meal collection is available.');

  const {data,error}=await amfccDb.rpc('system_mode_status');

  if(error||data?.status!=='success'){
    modeReady=false;
    applyConferenceState(
      true,
      'The system mode could not be confirmed. Meal collection is paused until the connection is restored.'
    );
    return;
  }

  modeReady=true;
  applyConferenceState(
    Boolean(data.conference_mode),
    'Meal check-in is unavailable while Conference Mode is on.'
  );
}

async function collectMeal(event){
  event.preventDefault();

  if(conferenceMode){
    showFailure(
      'error',
      'Conference Mode is on',
      'Meal collection is unavailable until Conference Mode is turned off.'
    );
    return;
  }

  const collectingForOther=$('collectingForOther').checked;
  if(!selectedMeal||!selectedCollector||(collectingForOther&&!selectedAdditional)){
    showFailure(
      'warning',
      'Complete the form',
      'Choose a meal and click each exact student record before collecting.'
    );
    return;
  }

  if(!navigator.onLine){
    showFailure('error','No connection','Connect to the internet and try again.');
    return;
  }

  submitting=true;
  $('collectButton').textContent='Saving collection…';
  updateSummaryAndButton();

  const {data,error}=await amfccDb.rpc('student_collect_meal',{
    p_collector_registration:selectedCollector.registration_number,
    p_meal_session:selectedMeal,
    p_service_date:localDate(),
    p_additional_registration:collectingForOther
      ?selectedAdditional.registration_number
      :null,
    p_child_portions:normalizedChildren()
  });

  submitting=false;
  $('collectButton').textContent='Here to collect';
  updateSummaryAndButton();

  if(error){
    if(/Conference Mode/i.test(error.message||'')){
      modeReady=true;
      applyConferenceState(true,'Meal check-in is unavailable while Conference Mode is on.');
      showFailure('error','Conference Mode is on',error.message);
      return;
    }
    showFailure('error','Could not save',error.message||'Please try again.');
    return;
  }

  if(data?.status==='collected'){
    showConfirmation(data);
    return;
  }

  if(data?.status==='conference_disabled'){
    modeReady=true;
    applyConferenceState(true,data.message);
    showFailure('error','Conference Mode is on',data.message);
    return;
  }

  if(data?.status==='duplicate'){
    showFailure('warning','Already collected',data.message||'One selected student already collected this meal today.');
    return;
  }

  showFailure('error','Not collected',data?.message||'Please check the selected records and try again.');
}

document.addEventListener('click',event=>{
  const mealButton=event.target.closest('[data-meal]');
  if(mealButton){
    selectedMeal=mealButton.dataset.meal;
    renderMeals();
    updateSummaryAndButton();
    return;
  }

  const personButton=event.target.closest('[data-search-purpose]');
  if(personButton){
    selectStudent(personButton.dataset.searchPurpose,{
      student_name:personButton.dataset.studentName,
      registration_number:personButton.dataset.registrationNumber
    });
    return;
  }

  if(event.target.id==='resultDone'){
    resetAfterCollection();
    return;
  }

  if(!event.target.closest('.student-search-field')){
    hideSearchResults('collector');
    hideSearchResults('additional');
  }
});

$('collectorSearch').addEventListener('input',()=>{
  clearSelectionForEditedInput('collector');
  queueStudentSearch('collector');
});

$('additionalSearch').addEventListener('input',()=>{
  clearSelectionForEditedInput('additional');
  queueStudentSearch('additional');
});

$('collectingForOther').addEventListener('change',event=>{
  $('additionalSection').hidden=!event.target.checked;
  if(!event.target.checked){
    selectedAdditional=null;
    $('additionalSearch').value='';
    hideSearchResults('additional');
    renderSelected('additional');
  }else{
    setTimeout(()=>$('additionalSearch').focus(),60);
  }
  updateSummaryAndButton();
});

$('childPortions').addEventListener('input',updateSummaryAndButton);
$('childPortions').addEventListener('blur',()=>{
  $('childPortions').value=String(normalizedChildren());
  updateSummaryAndButton();
});

$('collectionForm').addEventListener('submit',collectMeal);

window.addEventListener('online',()=>{
  setOnlineBadge('studentStatus');
  loadMode();
});
window.addEventListener('offline',()=>setOnlineBadge('studentStatus'));

renderMeals();
renderSelected('collector');
renderSelected('additional');
setOnlineBadge('studentStatus');
registerSW();
loadMode();
