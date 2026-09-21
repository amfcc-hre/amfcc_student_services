(async function(){
  try{
    if(!window.amfccDb)return;
    const {data,error}=await window.amfccDb.rpc('student_term_registration_status');
    if(error||!data||data.status!=='success'||!data.registration_is_open)return;
    const tile=document.getElementById('enrolmentTile');
    document.getElementById('enrolmentTitle').textContent=data.term_name+' enrolment';
    document.getElementById('enrolmentCopy').textContent='Enrolment is open. Enter your registration number and complete your student sections.';
    tile.hidden=false;
  }catch(_error){/* Other Student Services stay available if the optional tile cannot load. */}
})();
