const {$,normalizeReg,registerSW}=AMFCC;
const DEVICE_TOKEN=APP_CONFIG.GATE_DEVICE_TOKEN;
const DESTINATIONS={
  '1':'Tanaka/Amalinda Shops',
  '2':'MDH',
  '3':'Town/Other'
};
let moduleMode=localStorage.getItem('amfcc_terminal_module')||'campus';
let direction=localStorage.getItem('amfcc_'+moduleMode+'_direction')||'IN';
let selectedCheckoutOption=null;
let scanTimer=null,resultTimer=null,isRecording=false;

function focusScanner(){
  if(!$('manual').classList.contains('open')&&!$('result').classList.contains('open')){
    setTimeout(()=>$('scannerInput').focus(),50);
  }
}
function updateClock(){
  const now=new Date();
  $('clock').textContent=now.toLocaleTimeString('en-ZW',{hour12:false});
  $('date').textContent=now.toLocaleDateString('en-ZW',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
}
function clearDestination(){selectedCheckoutOption=null;renderDestination();}
function selectDestination(code,announce=true){
  if(moduleMode!=='campus'||direction!=='OUT'||!DESTINATIONS[code])return;
  selectedCheckoutOption=code;
  renderDestination();
  if(announce)AMFCCSounds.modeOut();
  focusScanner();
}
function renderDestination(){
  document.querySelectorAll('[data-destination]').forEach(button=>button.classList.toggle('selected',button.dataset.destination===selectedCheckoutOption));
  $('selectedDestination').textContent=selectedCheckoutOption?`Selected: ${selectedCheckoutOption}. ${DESTINATIONS[selectedCheckoutOption]}`:'No destination selected';
  $('selectedDestination').classList.toggle('active',Boolean(selectedCheckoutOption));
}
function renderKeyLegend(){
  if(moduleMode==='duty'){
    $('keyLegend').textContent='SPACE: DUTY IN / OUT · F1: CAMPUS MOVEMENT · CTRL+SHIFT+A: MANUAL · ESC: CLEAR';
  }else if(direction==='OUT'){
    $('keyLegend').textContent='1: TANAKA/AMALINDA · 2: MDH · 3: TOWN/OTHER · SPACE: CHECK IN · F1: GATE DUTY';
  }else{
    $('keyLegend').textContent='SPACE: CHECK OUT · F1: GATE DUTY · CTRL+SHIFT+A: MANUAL · ESC: CLEAR';
  }
}
function renderMode(announce=false){
  $('terminal').className=`${moduleMode} ${direction.toLowerCase()}`;
  $('module').textContent=moduleMode==='campus'?'CAMPUS MOVEMENT':'GATE DUTY';
  $('mode').textContent=(moduleMode==='campus'?'CHECK ':'GATE DUTY ')+(direction==='IN'?'IN':'OUT');
  $('subtitle').textContent=moduleMode==='campus'?'Campus movement terminal':'Gate duty attendance';
  $('hint').textContent=moduleMode==='campus'?(direction==='OUT'?'Select 1, 2 or 3 if there is no approved gate pass':'Ready for the next student'):'Scan to record gate duty';
  localStorage.setItem('amfcc_terminal_module',moduleMode);
  localStorage.setItem('amfcc_'+moduleMode+'_direction',direction);
  if(moduleMode!=='campus'||direction!=='OUT')clearDestination();
  renderKeyLegend();
  renderDestination();
  if(announce){moduleMode==='duty'?AMFCCSounds.duty():(direction==='IN'?AMFCCSounds.modeIn():AMFCCSounds.modeOut());}
  focusScanner();
}
function toggleDirection(){direction=direction==='IN'?'OUT':'IN';renderMode(true);}
function toggleModule(){moduleMode=moduleMode==='campus'?'duty':'campus';direction=localStorage.getItem('amfcc_'+moduleMode+'_direction')||'IN';renderMode(true);}
function showResult(kind,title,data={}){
  const result=$('result');
  const duty=moduleMode==='duty';
  result.className=`gate-result open ${kind}${kind==='success'?' '+(duty?'duty':direction.toLowerCase()):''}`;
  $('resultIcon').textContent=kind==='success'?'✓':kind==='warn'?'⚠':'✕';
  $('resultTitle').textContent=title;
  $('resultStudent').textContent=data.student_name||'';
  $('resultMeta').textContent=[data.registration_number,data.checkout_destination_label,data.message,new Date().toLocaleTimeString('en-ZW',{hour12:false})].filter(Boolean).join(' • ');
  if(kind==='success')direction==='IN'?AMFCCSounds.checkIn():AMFCCSounds.checkOut();
  else if(kind==='warn')AMFCCSounds.warning();
  else AMFCCSounds.error();
  clearTimeout(resultTimer);
  resultTimer=setTimeout(hideResult,kind==='bad'?3600:2600);
}
function hideResult(){$('result').className='gate-result';focusScanner();}
function setConnection(online,dbOk){
  $('internet').textContent=online?'● Internet':'● Offline';
  $('database').textContent=dbOk?'● Database':'● Database unavailable';
  $('internet').style.color=online?'#88f0ad':'#ff9b92';
  $('database').style.color=dbOk?'#88f0ad':'#ff9b92';
}
async function heartbeat(){
  if(!navigator.onLine){setConnection(false,false);return;}
  const {data,error}=await amfccDb.rpc('gate_terminal_heartbeat',{p_device_token:DEVICE_TOKEN});
  const ok=!error&&data?.status==='success';
  setConnection(true,ok);
  if(ok)$('lastSync').textContent='Last sync '+new Date().toLocaleTimeString('en-ZW',{hour12:false});
}
async function record(raw,source='scanner'){
  if(isRecording)return;
  const reg=normalizeReg(raw);
  $('scannerInput').value='';
  if(!navigator.onLine)return showResult('bad','NO CONNECTION',{message:'The record was not saved.'});
  if(!/^\d{5}$/.test(reg))return showResult('bad','CARD NOT RECOGNISED',{message:'Please see security.'});
  isRecording=true;
  const fn=moduleMode==='campus'?'gate_record_movement_v3':'gate_duty_record';
  const args={p_device_token:DEVICE_TOKEN,p_registration_number:reg,p_direction:direction,p_source:source};
  if(moduleMode==='campus')args.p_checkout_option=direction==='OUT'?selectedCheckoutOption:null;
  const {data,error}=await amfccDb.rpc(fn,args);
  isRecording=false;
  if(error)return showResult('bad','NOT RECORDED',{message:error.message});
  if(data?.status==='success'){
    const title=moduleMode==='duty'?(direction==='IN'?'GATE DUTY STARTED':'GATE DUTY ENDED'):(direction==='IN'?'CHECKED IN':'CHECKED OUT');
    if(moduleMode==='campus'&&direction==='OUT')clearDestination();
    return showResult('success',title,data);
  }
  if(data?.status==='destination_required'){
    clearDestination();
    return showResult('bad','SELECT DESTINATION',data);
  }
  if(['duplicate','same_status'].includes(data?.status))return showResult('warn',moduleMode==='duty'?'GATE DUTY ALREADY RECORDED':(direction==='IN'?'ALREADY CHECKED IN':'ALREADY CHECKED OUT'),data);
  showResult('bad','CARD NOT RECOGNISED',data||{message:'Please see security.'});
}
function openManual(){$('manual').classList.add('open');$('manualReg').focus();}
function closeManual(){$('manual').classList.remove('open');$('manualReg').value='';focusScanner();}
function manualRecord(){const reg=$('manualReg').value;closeManual();record(reg,'manual');}

$('scannerInput').addEventListener('input',event=>{
  clearTimeout(scanTimer);
  scanTimer=setTimeout(()=>{const reg=normalizeReg(event.target.value);if(/^\d{5}$/.test(reg))record(reg);},90);
});
$('scannerInput').addEventListener('keydown',event=>{
  AMFCCSounds.unlock();
  if(event.key==='Enter'){event.preventDefault();clearTimeout(scanTimer);record(event.target.value);}
});
$('result').onclick=hideResult;
$('manualRecord').onclick=manualRecord;
$('manualClose').onclick=closeManual;
$('manualReg').onkeydown=e=>{if(e.key==='Enter')manualRecord();};
document.querySelectorAll('[data-destination]').forEach(button=>button.onclick=()=>selectDestination(button.dataset.destination));
document.addEventListener('keydown',event=>{
  AMFCCSounds.unlock();
  if(event.ctrlKey&&event.shiftKey&&event.key.toLowerCase()==='a'){event.preventDefault();openManual();return;}
  if($('manual').classList.contains('open')){if(event.key==='Escape')closeManual();return;}
  if(event.key==='F1'){event.preventDefault();toggleModule();return;}
  if(event.code==='Space'){event.preventDefault();toggleDirection();return;}
  if(moduleMode==='campus'&&direction==='OUT'&&['1','2','3'].includes(event.key)){event.preventDefault();selectDestination(event.key);return;}
  if(event.key==='Escape'){$('scannerInput').value='';clearDestination();hideResult();}
});
document.addEventListener('click',focusScanner);
window.addEventListener('online',heartbeat);
window.addEventListener('offline',()=>setConnection(false,false));
renderMode(false);updateClock();setInterval(updateClock,1000);heartbeat();setInterval(heartbeat,60000);focusScanner();registerSW();
