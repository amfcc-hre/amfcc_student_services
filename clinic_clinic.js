const {$,esc,formatDateTime}=AMFCC;
let pin=sessionStorage.getItem('amfcc_clinic_pin')||'',searchTimer=null,selectedStudent=null,selectedAction='start';
function toast(kind,title,text){$('toastBox').className='result-box '+kind;$('toastBox').innerHTML=`<div class="icon">${kind==='good'?'✓':kind==='warn'?'⚠':'✕'}</div><h2>${esc(title)}</h2><p>${esc(text)}</p>`;$('toast').classList.add('open');setTimeout(()=>$('toast').classList.remove('open'),2400);}
async function login(){
  pin=$('pin').value.trim();if(!/^\d{4}$/.test(pin))return showPinError('Enter the four-digit clinic password.');
  const {data,error}=await amfccDb.rpc('clinic_active_bed_rest',{p_pin:pin});
  if(error||data?.status!=='success')return showPinError(error?.message||data?.message||'Incorrect clinic password.');
  sessionStorage.setItem('amfcc_clinic_pin',pin);$('login').classList.remove('open');renderActive(data.students||[]);$('search').focus();
}
function showPinError(message){$('pinError').textContent=message;$('pinError').style.display='block';}
async function loadActive(){const {data,error}=await amfccDb.rpc('clinic_active_bed_rest',{p_pin:pin});if(error||data?.status!=='success')return toast('bad','Could not refresh',error?.message||data?.message||'Try again.');renderActive(data.students||[]);}
function renderActive(rows){
  $('activeCount').textContent=`${rows.length} student${rows.length===1?'':'s'}`;
  $('activeBedRest').innerHTML=rows.map(s=>`<div class="student-row bed-rest-card"><div class="bed-rest-icon">🛏️</div><div class="student-main"><b>${esc(s.student_name)}</b><div class="student-meta">${esc(s.registration_number)} · Started ${esc(formatDateTime(s.started_at))}${s.residence?` · ${esc(s.residence)} ${esc(s.room||'')}`:''}</div>${s.notes?`<div class="student-meta">${esc(s.notes)}</div>`:''}</div><button class="btn danger" data-clear="${esc(s.registration_number)}" data-name="${esc(s.student_name)}">End bed rest</button></div>`).join('')||'<div class="empty">No students are currently on bed rest.</div>';
}
async function searchStudents(){
  const q=$('search').value.trim();if(q.length<2){$('searchStatus').textContent='Enter at least two letters or digits.';$('searchResults').innerHTML='';return;}
  $('searchStatus').textContent='Searching…';
  const {data,error}=await amfccDb.rpc('clinic_search_students',{p_pin:pin,p_query:q});
  if(error||data?.status!=='success'){$('searchStatus').textContent=error?.message||data?.message||'Search failed.';return;}
  const rows=data.students||[];$('searchStatus').textContent=`${rows.length} match${rows.length===1?'':'es'}`;
  $('searchResults').innerHTML=rows.map(s=>`<div class="student-row ${s.on_bed_rest?'bed-rest-card':''}"><div class="student-main"><b>${s.on_bed_rest?'🛏️ ':''}${esc(s.student_name)}</b><div class="student-meta">${esc(s.registration_number)} · ${s.campus_status==='IN'?'On campus':s.campus_status==='OUT'?'Off campus':'Campus status unknown'}${s.residence?` · ${esc(s.residence)} ${esc(s.room||'')}`:''}</div></div><button class="btn ${s.on_bed_rest?'danger':'good'}" data-action="${s.on_bed_rest?'clear':'start'}" data-reg="${esc(s.registration_number)}" data-name="${esc(s.student_name)}">${s.on_bed_rest?'End bed rest':'Start bed rest'}</button></div>`).join('')||'<div class="empty">No matching students.</div>';
}
function openAction(reg,name,action){
  selectedStudent={registration_number:reg,student_name:name};selectedAction=action;
  $('bedRestTitle').textContent=action==='start'?'Place student on bed rest':'Remove student from bed rest';
  $('bedRestStudent').innerHTML=`<b>${esc(name)}</b><br><span class="muted">${esc(reg)}</span>`;
  $('confirmBedRest').textContent=action==='start'?'Confirm bed rest':'Confirm removal';
  $('confirmBedRest').className='btn '+(action==='start'?'good':'danger');
  $('bedRestNotes').value='';$('bedRestModal').classList.add('open');
}
async function confirmAction(){
  if(!selectedStudent)return;
  $('confirmBedRest').disabled=true;
  const {data,error}=await amfccDb.rpc('clinic_set_bed_rest',{p_pin:pin,p_registration_number:selectedStudent.registration_number,p_action:selectedAction,p_notes:$('bedRestNotes').value.trim()||null});
  $('confirmBedRest').disabled=false;
  if(error||data?.status!=='success')return toast('bad','Not saved',error?.message||data?.message||'Try again.');
  $('bedRestModal').classList.remove('open');toast('good','Saved',data.message);await loadActive();await searchStudents();
}
$('loginBtn').onclick=login;$('pin').onkeydown=e=>{if(e.key==='Enter')login();};$('refresh').onclick=loadActive;
$('search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(searchStudents,250);};
$('searchResults').onclick=e=>{const b=e.target.closest('[data-action]');if(b)openAction(b.dataset.reg,b.dataset.name,b.dataset.action);};
$('activeBedRest').onclick=e=>{const b=e.target.closest('[data-clear]');if(b)openAction(b.dataset.clear,b.dataset.name,'clear');};
$('confirmBedRest').onclick=confirmAction;$('cancelBedRest').onclick=()=>$('bedRestModal').classList.remove('open');$('toast').onclick=()=>$('toast').classList.remove('open');
if(pin){$('pin').value=pin;login();}else $('pin').focus();
