(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  let lookup=null,record=null,saveTimer=null,saving=false,pendingSave=false,sessionEnded=false,opening=false,statusChecking=false;
  const panels=['closedPanel','lookupPanel','confirmPanel','enrolmentForm','submittedPanel'];
  function show(id){panels.forEach(key=>$(key).hidden=key!==id);}
  function message(text,bad){const node=$('toast');node.textContent=text;node.className='registration-toast'+(bad?' bad':'');node.hidden=false;clearTimeout(node._timer);node._timer=setTimeout(()=>node.hidden=true,3200);}
  function setSaveState(text,kind){$('saveState').textContent=text;$('saveState').className='save-state '+(kind||'');}
  function tokenKey(reg,term){return 'amfcc_enrolment_token_'+term+'_'+reg;}
  function answers(){return {
    gender:$('gender').value,marital_status:$('maritalStatus').value,spouse_location:$('spouseLocation').value.trim(),
    identity_number:$('identityNumber').value.trim(),student_email:$('studentEmail').value.trim(),student_phone:$('studentPhone').value.trim(),
    ...(record&&record.sponsor_required===false?{}:{sponsor_name:$('sponsorName').value.trim(),sponsor_contact:$('sponsorContact').value.trim()}),
    accommodation_type:$('accommodationType').value,accommodation_hostel:$('accommodationHostel').value.trim(),
    accommodation_room:$('accommodationRoom').value.trim(),shared_occupants:$('sharedOccupants').value?Number($('sharedOccupants').value):null
  };}
  function applyAnswers(a){a=a||{};$('gender').value=a.gender||'';$('maritalStatus').value=a.marital_status||'';$('spouseLocation').value=a.spouse_location||'';$('identityNumber').value=a.identity_number||'';$('studentEmail').value=a.student_email||'';$('studentPhone').value=a.student_phone||'';$('sponsorName').value=a.sponsor_name||'';$('sponsorContact').value=a.sponsor_contact||'';$('accommodationType').value=a.accommodation_type||'';$('accommodationHostel').value=a.accommodation_hostel||'';$('accommodationRoom').value=a.accommodation_room||'';$('sharedOccupants').value=a.shared_occupants||'';updateConditional();}
  function updateConditional(){
    const exempt=record&&record.sponsor_required===false;
    $('sponsorSection').hidden=!!exempt;$('registrationExemption').hidden=!exempt;
    ['sponsorName','sponsorContact'].forEach(id=>{$(id).disabled=!!exempt;$(id).required=false;});
    $('formInstructions').textContent=exempt?'Complete your personal and accommodation details. Sponsor details and the Administrator’s Office check are not required for executive or missions students.':'Complete your student information in Section A. You may also provide sponsor and accommodation details for Administration.';
    const married=$('maritalStatus').value==='Married',shared=$('accommodationType').value==='Shared';
    $('spouseField').hidden=!married;$('spouseLocation').required=married;
    $('sharedFields').hidden=!shared;$('marriedNote').hidden=$('accommodationType').value!=='Married';
    ['accommodationHostel','accommodationRoom','sharedOccupants'].forEach(id=>$(id).required=false);
  }
  function queueSave(){if(!record||record.is_locked||sessionEnded||opening)return;setSaveState('Unsaved changes','saving');clearTimeout(saveTimer);saveTimer=setTimeout(saveDraft,650);}
  async function saveDraft(){
    if(!record||record.is_locked||sessionEnded||opening)return;
    if(saving){pendingSave=true;return;} saving=true;pendingSave=false;
    const activeRecord=record;setSaveState('Saving…','saving');
    try{
      const {data,error}=await amfccDb.rpc('student_term_registration_save',{p_registration_number:String(activeRecord.registration_number),p_resume_token:activeRecord.resume_token,p_answers:answers()});
      if(record!==activeRecord||sessionEnded||record.is_locked)return;
      if(error)throw error;
      if(data.status==='unauthorized'){endCurrentSession();return;}
      if(data.status!=='success')throw new Error(data.message||'Draft could not be saved.');
      record.student_answers=data.student_answers;setSaveState('Draft saved','saved');
    }catch(error){if(record===activeRecord&&!sessionEnded){setSaveState('Save failed','');message(error.message||'Draft could not be saved.',true);}}
    finally{saving=false;if(pendingSave&&!sessionEnded)saveDraft();}
  }
  function showSessionConflict(text){
    $('sessionConflict').hidden=false;$('sessionConflictText').textContent=text;
    $('takeoverButton').hidden=false;$('startButton').hidden=true;
  }
  function endCurrentSession(){
    if(sessionEnded)return;sessionEnded=true;clearTimeout(saveTimer);pendingSave=false;
    if(record){lookup={registration_number:record.registration_number,term_id:record.term_id,term_name:record.term_name,has_started:true};$('confirmName').textContent=record.student_name;$('confirmDetails').textContent='Registration '+record.registration_number+' · '+record.term_name;}
    show('confirmPanel');setSaveState('Session ended','');
    showSessionConflict('This session has ended because registration is continuing in another page or browser. Changes that were not saved here will not be submitted.');
  }
  async function checkSession(){
    if(!record||record.is_locked||sessionEnded||opening||statusChecking||document.hidden)return;
    const activeRecord=record;statusChecking=true;
    try{
      const {data,error}=await amfccDb.rpc('student_term_registration_session_status',{p_registration_number:String(activeRecord.registration_number),p_resume_token:activeRecord.resume_token});
      if(record!==activeRecord||sessionEnded||error||!data)return;
      if(data.status==='unauthorized')endCurrentSession();
      else if(data.status==='locked'){clearTimeout(saveTimer);pendingSave=false;record.is_locked=true;showSubmitted();}
      else if(data.status==='closed'){clearTimeout(saveTimer);pendingSave=false;sessionEnded=true;show('closedPanel');setSaveState('Enrolment closed','');}
    }catch(error){/* Keep the current form available while the service is unreachable. */}
    finally{statusChecking=false;}
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
    try{const {data,error}=await amfccDb.rpc('student_term_registration_lookup',{p_registration_number:reg});if(error)throw error;if(data.status!=='success')throw new Error(data.message||'Student record was not found.');lookup=data;record=null;sessionEnded=false;$('sessionConflict').hidden=true;$('startButton').hidden=false;$('takeoverButton').hidden=!data.has_started||data.is_locked;$('confirmName').textContent=data.student_name;$('confirmDetails').textContent='Registration '+data.registration_number+' · '+data.term_name+' · '+data.status_label;$('startButton').textContent=data.has_started?'Continue enrolment':'Start enrolment';show('confirmPanel');}
    catch(error){$('lookupMessage').textContent=error.message||'Student record was not found.';$('lookupMessage').hidden=false;}
    finally{button.disabled=false;button.textContent='Continue';}
  }
  async function start(takeover){
    if(!lookup||opening)return;
    if(takeover&&!window.confirm('End all other registration sessions for this student and continue here? Saved draft answers will be restored. Unsaved changes in other pages or browsers will be lost. Submitted forms cannot be reopened.'))return;
    const button=takeover?$('takeoverButton'):$('startButton');
    opening=true;clearTimeout(saveTimer);pendingSave=false;button.disabled=true;button.textContent='Opening…';
    try{
      const stored=localStorage.getItem(tokenKey(lookup.registration_number,lookup.term_id));
      const {data,error}=await amfccDb.rpc(takeover?'student_term_registration_takeover':'student_term_registration_start',takeover?{p_registration_number:String(lookup.registration_number)}:{p_registration_number:String(lookup.registration_number),p_resume_token:stored||null});
      if(error)throw error;
      if(data.status==='resume_token_required'){showSessionConflict('This registration was started in another page or browser. You can end those sessions and continue here. Saved draft answers will be restored, and unsaved changes in other sessions will be lost.');return;}
      if(data.status!=='success')throw new Error(data.message||'The enrolment could not be opened.');
      record=data;sessionEnded=false;localStorage.setItem(tokenKey(data.registration_number,data.term_id),data.resume_token);applyAnswers(data.student_answers);
      $('sessionConflict').hidden=true;
      $('studentIdentity').innerHTML='<strong>'+escapeHtml(data.student_name)+'</strong><br>Registration '+escapeHtml(data.registration_number)+' · '+escapeHtml(data.term_name);
      $('termSummary').textContent=data.term_name+' · '+data.student_name;
      $('returnRequest').hidden=!data.return_reason;$('returnRequestText').textContent=data.return_reason||'';
      if(data.is_locked){showSubmitted();}else{show('enrolmentForm');setSaveState(data.return_reason?'Information requested':data.student_answers&&Object.keys(data.student_answers).length?'Draft restored':'Draft ready',data.return_reason?'':'saved');}
      if(takeover)message('Other registration sessions have ended. Continue on this page.');
    }catch(error){message(error.message||'The enrolment could not be opened.',true);}
    finally{opening=false;button.disabled=false;button.textContent=takeover?'End other sessions and continue here':lookup&&lookup.has_started?'Continue enrolment':'Start enrolment';}
  }
  function escapeHtml(value){return String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function validateConditional(){
    if($('maritalStatus').value==='Married'&&!$('spouseLocation').value.trim())return 'Enter where your spouse is.';
    return '';
  }
  async function submit(event){
    event.preventDefault();if(sessionEnded||opening||!record)return;const invalid=validateConditional();if(invalid){$('formMessage').textContent=invalid;$('formMessage').hidden=false;return;}
    if(!event.currentTarget.reportValidity())return;if(!window.confirm('Submit this enrolment now? You will not be able to edit it afterwards.'))return;
    $('formMessage').hidden=true;const button=$('submitButton');button.disabled=true;button.textContent='Submitting…';const activeRecord=record,submittedAnswers=answers();
    try{clearTimeout(saveTimer);const {data,error}=await amfccDb.rpc('student_term_registration_submit',{p_registration_number:String(record.registration_number),p_resume_token:activeRecord.resume_token,p_answers:submittedAnswers});if(record!==activeRecord||sessionEnded)return;if(error)throw error;if(data.status==='unauthorized'){endCurrentSession();return;}if(data.status!=='success')throw new Error(data.message||'The form could not be submitted.');record.student_answers=submittedAnswers;record.is_locked=true;showSubmitted();message('Term enrolment submitted.');}
    catch(error){$('formMessage').textContent=error.message||'The form could not be submitted.';$('formMessage').hidden=false;}
    finally{button.disabled=false;button.textContent='Submit term enrolment';}
  }
  function showSubmitted(){show('submittedPanel');setSaveState('Submitted','saved');$('submittedMessage').textContent=(record.term_name||'Your term')+' form has been received. You can download the printable student-submitted version below.';}
  async function downloadPdf(){
    const button=$('downloadStudentPdf');button.disabled=true;button.textContent='Preparing PDF…';
    try{const result=await AMFCCRegistrationPDF.build({student_name:record.student_name,registration_number:record.registration_number,term_name:record.term_name,sponsor_required:record.sponsor_required,admin_office_required:record.admin_office_required,student_answers:record.student_answers||answers(),admin_answers:{},fees_answers:{},accommodation_answers:{},final_answers:{}});AMFCCRegistrationPDF.download(result);}
    catch(error){message(error.message||'The PDF could not be created.',true);}finally{button.disabled=false;button.textContent='Download printable form';}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    $('lookupForm').addEventListener('submit',findStudent);$('startButton').addEventListener('click',()=>start(false));$('takeoverButton').addEventListener('click',()=>start(true));$('endOtherSessionsButton').addEventListener('click',()=>start(true));$('notMeButton').addEventListener('click',()=>{lookup=null;record=null;clearTimeout(saveTimer);pendingSave=false;sessionEnded=false;show('lookupPanel');$('registrationNumber').focus();});
    $('maritalStatus').addEventListener('change',()=>{updateConditional();queueSave();});$('accommodationType').addEventListener('change',()=>{updateConditional();queueSave();});
    $('enrolmentForm').addEventListener('input',queueSave);$('enrolmentForm').addEventListener('submit',submit);$('downloadStudentPdf').addEventListener('click',downloadPdf);
    window.addEventListener('storage',event=>{if(record&&!record.is_locked&&event.key===tokenKey(record.registration_number,record.term_id)&&event.newValue!==record.resume_token)endCurrentSession();});
    window.addEventListener('focus',checkSession);document.addEventListener('visibilitychange',checkSession);setInterval(checkSession,20000);
    checkStatus();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
  });
})();

