const {$,esc,formatDate,setOnlineBadge}=AMFCC;

function addDays(iso,days){
  const date=new Date(iso+'T12:00:00');
  date.setDate(date.getDate()+days);
  return [
    date.getFullYear(),
    String(date.getMonth()+1).padStart(2,'0'),
    String(date.getDate()).padStart(2,'0')
  ].join('-');
}

function renderPeople(targetId,names){
  const target=$(targetId);
  target.innerHTML=Array.isArray(names)&&names.length
    ?names.map(name=>'<div class="duty-person">'+esc(name)+'</div>').join('')
    :'<div class="empty">No students entered.</div>';
}

function renderDuties(data){
  $('week-range').textContent=formatDate(data.week_start)+' to '+formatDate(data.week_end||addDays(data.week_start,6));
  $('podName').textContent=data.prefect_on_duty||'Not entered';
  $('seniorPodName').textContent=data.senior_prefect_on_duty||'Not entered';
  $('bellRingerName').textContent=data.bell_ringer||'Not entered';
  $('kitchenDepartment').textContent=data.kitchen_department||'Not entered';
  $('toiletDepartment').textContent=data.toilet_department||'Not entered';
  renderPeople('kitchenPeople',data.kitchen_people);
  renderPeople('toiletPeople',data.toilet_people);
  $('dutyMessage').className='notice good';
  $('dutyMessage').textContent='Showing the current Monday-to-Sunday duty roster.';
}

async function loadDuties(){
  $('refreshDuties').disabled=true;
  $('refreshDuties').textContent='Refreshing…';
  const {data,error}=await amfccDb.rpc('student_duties_board');
  $('refreshDuties').disabled=false;
  $('refreshDuties').textContent='Refresh';

  if(error||data?.status!=='success'){
    $('dutyMessage').className='notice bad';
    $('dutyMessage').textContent=error?.message||data?.message||'The duty roster could not be loaded.';
    return;
  }
  renderDuties(data);
}

$('refreshDuties').addEventListener('click',loadDuties);
window.addEventListener('online',()=>{setOnlineBadge('online');loadDuties();});
window.addEventListener('offline',()=>setOnlineBadge('online'));
setOnlineBadge('online');
loadDuties();
