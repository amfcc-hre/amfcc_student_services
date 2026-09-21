(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  let lookup=null,record=null,saveTimer=null,saving=false,pendingSave=false;
  const panels=['closedPanel','lookupPanel','confirmPanel','enrolmentForm','submittedPanel'];
  function show(id){panels.forEach(key=>$(key).hidden=key!==id);}
  function message(text,bad){const node=$('toast');node.textContent=text;node.className='registration-toast'+(bad?' bad':'');node.hidden=false;clearTimeout(node._timer);node._timer=setTimeout(()=>node.hidden=true,3200);}
  function setSaveState(text,kind){$('saveState').textContent=text;$('saveState').className='save-state '+(kind||'');}
  function tokenKey(reg,term){return 'amfcc_enrolment_token_'+term+'_'+reg;}
  function answers(){return {
    gender:$('gender').value,marital_status:$('maritalStatus').value,spouse_location:$('spouseLocation').value.trim(),
    identity_number:$('identityNumber').value.trim(),sponsor_name:$('sponsorName').value.trim(),sponsor_contact:$('sponsorContact').value.trim(),
    accommodation_type:$('accommodationType').value,accommodation_hostel:$('accommodationHostel').value.trim(),
    accommodation_room:$('accommodationRoom').value.trim(),shared_occupants:$('sharedOccupants').value?Number($('sharedOccupants').value):null
  };}
  function applyAnswers(a){a=a||{};$('gender').value=a.gender||'';$('maritalStatus').value=a.marital_status||'';$('spouseLocation').value=a.spouse_location||'';$('identityNumber').value=a.identity_number||'';$('sponsorName').value=a.sponsor_name||'';$('sponsorContact').value=a.sponsor_contact||'';$('accommodationType').value=a.accommodation_type||'';$('accommodationHostel').value=a.accommodation_hostel||'';$('accommodationRoom').value=a.accommodation_room||'';$('sharedOccupants').value=a.shared_occupants||'';updateConditional();}
  function updateConditional(){
    const married=$('maritalStatus').value==='Married',shared=$('accommodationType').value==='Shared';
    $('spouseField').hidden=!married;$('spouseLocation').required=married;
    $('sharedFields').hidden=!shared;$('marriedNote').hidden=$('accommodationType').value!=='Married';
    ['accommodationHostel','accommodationRoom','sharedOccupants'].forEach(id=>$(id).required=shared);
  }
  function queueSave(){if(!record||record.is_locked)return;setSaveState('Unsaved changes','saving');clearTimeout(saveTimer);saveTimer=setTimeout(saveDraft,650);}
  async function saveDraft(){
    if(saving){pendingSave=true;return;} saving=true;pendingSave=false;setSaveState('Saving…','saving');
    try{const {data,error}=await amfccDb.rpc('student_term_registration_save',{p_registration_number:String(record.registration_number),p_resume_token:record.resume_token,p_answers:answers()});if(error)throw error;if(data.status!=='success')throw new Error(data.message||'Draft could not be saved.');record.student_answers=data.student_answers;setSaveState('Draft saved','saved');}
    catch(error){setSaveState('Save failed','');message(error.message||'Draft could not be saved.',true);}finally{saving=false;if(pendingSave)saveDraft();}
  }
  async function checkStatus(){
    const {data,error}=await amfccDb.rpc('student_term_registration_status');
    if(error){$('termSummary').textContent='The enrolment service could not be reached.';show('closedPanel');return;}
    if(data.status!=='success'||!data.registration_is_open){$('termSummary').textContent='No term enrolment is currently open.';show('closedPanel');return;}
    $('termSummary').textContent=data.term_name+' enrolment is open';show('lookupPanel');
  }
  async function findStudent(event){
    event.preventDefault();const reg=$('registrationNumber').value.replace(/\D/g,'');$('lookupMessage').hidden=true;
    if(!/^\d{5}$/.test(reg)){ $('lookupMessage').textContent='Enter your five-digit registration number.';$('lookupMessage').hidden=false;return; }
    const button=event.currentTarget.querySelector('button');button.disabled=true;button.textContent='Finding record…';
    try{const {data,error}=await amfccDb.rpc('student_term_registration_lookup',{p_registration_number:reg});if(error)throw error;if(data.status!=='success')throw new Error(data.message||'Student record was not found.');lookup=data;$('confirmName').textContent=data.student_name;$('confirmDetails').textContent='Registration '+data.registration_number+' · '+data.term_name+' · '+data.status_label;$('startButton').textContent=data.has_started?'Continue enrolment':'Start enrolment';show('confirmPanel');}
    catch(error){$('lookupMessage').textContent=error.message||'Student record was not found.';$('lookupMessage').hidden=false;}
    finally{button.disabled=false;button.textContent='Continue';}
  }
  async function start(){
    const button=$('startButton');button.disabled=true;button.textContent='Opening…';
    try{
      const stored=localStorage.getItem(tokenKey(lookup.registration_number,lookup.term_id));
      const {data,error}=await amfccDb.rpc('student_term_registration_start',{p_registration_number:String(lookup.registration_number),p_resume_token:stored||null});
      if(error)throw error;if(data.status!=='success')throw new Error(data.message||'The enrolment could not be opened.');
      record=data;localStorage.setItem(tokenKey(data.registration_number,data.term_id),data.resume_token);applyAnswers(data.student_answers);
      $('studentIdentity').innerHTML='<strong>'+escapeHtml(data.student_name)+'</strong><br>Registration '+escapeHtml(data.registration_number)+' · '+escapeHtml(data.term_name);
      $('termSummary').textContent=data.term_name+' · '+data.student_name;
      if(data.is_locked){showSubmitted();}else{show('enrolmentForm');setSaveState(data.student_answers&&Object.keys(data.student_answers).length?'Draft restored':'Draft ready','saved');}
    }catch(error){message(error.message||'The enrolment could not be opened.',true);}
    finally{button.disabled=false;button.textContent=lookup&&lookup.has_started?'Continue enrolment':'Start enrolment';}
  }
  function escapeHtml(value){return String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function validateConditional(){
    if($('maritalStatus').value==='Married'&&!$('spouseLocation').value.trim())return 'Enter where your spouse is.';
    if($('accommodationType').value==='Shared'&&(!$('accommodationHostel').value.trim()||!$('accommodationRoom').value.trim()||Number($('sharedOccupants').value)<1))return 'Complete the hostel, room and occupant details for shared accommodation.';
    return '';
  }
  async function submit(event){
    event.preventDefault();const invalid=validateConditional();if(invalid){$('formMessage').textContent=invalid;$('formMessage').hidden=false;return;}
    if(!event.currentTarget.reportValidity())return;if(!window.confirm('Submit this enrolment now? You will not be able to edit it afterwards.'))return;
    $('formMessage').hidden=true;const button=$('submitButton');button.disabled=true;button.textContent='Submitting…';
    try{clearTimeout(saveTimer);const {data,error}=await amfccDb.rpc('student_term_registration_submit',{p_registration_number:String(record.registration_number),p_resume_token:record.resume_token,p_answers:answers()});if(error)throw error;if(data.status!=='success')throw new Error(data.message||'The form could not be submitted.');record.student_answers=answers();record.is_locked=true;showSubmitted();message('Term enrolment submitted.');}
    catch(error){$('formMessage').textContent=error.message||'The form could not be submitted.';$('formMessage').hidden=false;}
    finally{button.disabled=false;button.textContent='Submit term enrolment';}
  }
  function showSubmitted(){show('submittedPanel');setSaveState('Submitted','saved');$('submittedMessage').textContent=(record.term_name||'Your term')+' form has been received. You can download the printable student-submitted version below.';}
  async function downloadPdf(){
    const button=$('downloadStudentPdf');button.disabled=true;button.textContent='Preparing PDF…';
    try{const result=await AMFCCRegistrationPDF.build({student_name:record.student_name,registration_number:record.registration_number,term_name:record.term_name,student_answers:record.student_answers||answers(),admin_answers:{},fees_answers:{},accommodation_answers:{},final_answers:{}});AMFCCRegistrationPDF.download(result);}
    catch(error){message(error.message||'The PDF could not be created.',true);}finally{button.disabled=false;button.textContent='Download printable form';}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    $('lookupForm').addEventListener('submit',findStudent);$('startButton').addEventListener('click',start);$('notMeButton').addEventListener('click',()=>{lookup=null;show('lookupPanel');$('registrationNumber').focus();});
    $('maritalStatus').addEventListener('change',()=>{updateConditional();queueSave();});$('accommodationType').addEventListener('change',()=>{updateConditional();queueSave();});
    $('enrolmentForm').addEventListener('input',queueSave);$('enrolmentForm').addEventListener('submit',submit);$('downloadStudentPdf').addEventListener('click',downloadPdf);
    checkStatus();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
  });
})();
