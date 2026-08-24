const MEALS=['Breakfast','Lunch','Break-fast 4pm','Supper'];
const {$,esc,normalizeReg,localDate,setOnlineBadge,registerSW}=AMFCC;
let studentMeal='';

function renderMeals(){
  $('studentMeals').innerHTML=MEALS.map(meal=>`<button class="btn meal ${studentMeal===meal?'selected':''}" data-meal="${esc(meal)}">${esc(meal)}</button>`).join('');
}
function message(kind,title,body){
  $('resultBox').className='result-box '+kind;
  $('resultBox').innerHTML=`<div class="icon">${kind==='good'?'✓':kind==='warn'?'⚠':'✕'}</div><h2>${esc(title)}</h2>${body}`;
  $('result').classList.add('open');
  setTimeout(hideResult,2800);
}
function hideResult(){
  $('result').classList.remove('open');
  $('studentReg').focus();
}
async function checkIn(){
  const reg=normalizeReg($('studentReg').value);
  if(!studentMeal)return message('bad','Choose a meal','<p>Select the meal first.</p>');
  if(!/^\d{5}$/.test(reg))return message('bad','Check the number','<p>Enter a five-digit registration number.</p>');
  if(!navigator.onLine)return message('bad','No connection','<p>Connect to the internet and try again.</p>');
  const {data,error}=await amfccDb.rpc('check_in_student_public',{p_registration_number:reg,p_meal_session:studentMeal,p_service_date:localDate()});
  $('studentReg').value='';
  if(error)return message('bad','Could not save',`<p>${esc(error.message)}</p>`);
  const name=data?.full_name?`<div class="name">${esc(data.full_name)}</div>`:'';
  if(data?.status==='checked_in')message('good','CHECKED IN',`${name}<p>${esc(data.registration_number||reg)} · ${esc(data.meal_session||studentMeal)}</p>`);
  else if(data?.status==='duplicate')message('warn','ALREADY CHECKED IN',`${name}<p>${esc(studentMeal)}</p>`);
  else message('bad',data?.status==='not_eligible'?'NOT ELIGIBLE':'NOT SAVED',`${name}<p>${esc(data?.message||'Please try again.')}</p>`);
}
function startCamera(){
  AMFCCScanner.start({
    video:$('video'),
    overlay:$('camera'),
    onResult:value=>{
      const reg=normalizeReg(value);
      if(/^\d{5}$/.test(reg)){ $('studentReg').value=reg; checkIn(); }
      else message('bad','Card not recognised','<p>Use a student ID QR code.</p>');
    },
    onError:text=>message('bad','Camera unavailable',`<p>${esc(text)}</p>`)
  });
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-meal]');
  if(!button)return;
  studentMeal=button.dataset.meal;
  renderMeals();
});
$('studentCheck').onclick=checkIn;
$('studentScan').onclick=startCamera;
$('cameraCancel').onclick=()=>AMFCCScanner.stop();
$('result').onclick=hideResult;
$('studentReg').onkeydown=event=>{if(event.key==='Enter')checkIn();};
window.addEventListener('online',()=>setOnlineBadge('studentStatus'));
window.addEventListener('offline',()=>setOnlineBadge('studentStatus'));
renderMeals();
setOnlineBadge('studentStatus');
registerSW();
setTimeout(()=>$('studentReg').focus(),60);
