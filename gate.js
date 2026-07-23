const DEVICE_TOKEN='AMFCC-GATE-7X4Q-2026-K9M2';
const db=supabase.createClient(APP_CONFIG.SUPABASE_URL,APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let direction=localStorage.getItem('amfcc_gate_direction')||'IN';
let stream=null,scanning=false,resultTimer=null,scanBuffer='',scanTimer=null;

function norm(v){return String(v||'').replace(/\D/g,'').slice(0,5)}
function focusScanner(){setTimeout(()=>$('scannerInput').focus(),100)}
function updateStation(){
  const isIn=direction==='IN';
  $('station').className='station '+(isIn?'in':'out');
  $('stationMode').textContent=isIn?'CHECK IN':'CHECK OUT';
  localStorage.setItem('amfcc_gate_direction',direction);
  focusScanner();
}
function show(cls,icon,title,d={}){
  $('resultBox').className='box '+cls;
  $('resultBox').innerHTML=`<div class="ico">${icon}</div><h2>${esc(title)}</h2>${d.student_name?`<div class="name">${esc(d.student_name)}</div>`:''}<p>${esc(d.registration_number||'')}</p><p>${esc(d.message||'')}</p>`;
  $('result').classList.add('open');
  clearTimeout(resultTimer);
  resultTimer=setTimeout(hideResult,3000);
}
function hideResult(){$('result').classList.remove('open');focusScanner()}

async function recordRegistration(raw,source='scanner'){
  if(!navigator.onLine)return show('bad','✕','NO CONNECTION',{message:'Connect this gate device to the internet.'});
  const reg=norm(raw);
  if(!/^\d{5}$/.test(reg))return show('bad','✕','CHECK THE NUMBER',{message:'A valid student registration number has five digits.'});
  const {data,error}=await db.rpc('gate_record_movement',{p_device_token:DEVICE_TOKEN,p_registration_number:reg,p_direction:direction});
  $('scannerInput').value='';
  $('manualReg').value='';
  if(error)return show('bad','✕','NOT RECORDED',{message:error.message});
  if(data.status==='success')show('ok','✓',direction==='IN'?'ON CAMPUS':'OFF CAMPUS',data);
  else if(data.status==='duplicate'||data.status==='same_status')show('warn','⚠','ALREADY RECORDED',data);
  else show('bad','✕','NOT RECORDED',data);
}

async function startScan(){
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    $('video').srcObject=stream;await $('video').play();$('cam').classList.add('open');scanning=true;scanLoop();
  }catch(e){show('bad','✕','CAMERA BLOCKED',{message:'Allow camera access in the browser settings.'})}
}
function stopScan(){scanning=false;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;$('cam').classList.remove('open');focusScanner()}
async function scanLoop(){
  if(!scanning)return;
  const v=$('video');
  if(v.readyState>=2){
    try{
      if('BarcodeDetector'in window){
        const det=new BarcodeDetector({formats:['qr_code','code_128','ean_13']});
        const codes=await det.detect(v);if(codes[0]?.rawValue)return acceptCode(codes[0].rawValue);
      }else{
        const c=document.createElement('canvas'),x=c.getContext('2d');c.width=v.videoWidth;c.height=v.videoHeight;x.drawImage(v,0,0);
        const code=jsQR(x.getImageData(0,0,c.width,c.height).data,c.width,c.height);if(code?.data)return acceptCode(code.data);
      }
    }catch(e){}
  }
  requestAnimationFrame(scanLoop);
}
function acceptCode(v){const reg=norm(v);if(/^\d{5}$/.test(reg)){stopScan();recordRegistration(reg,'camera')}}

function openPin(){
  $('pinInput').value='';$('pinError').textContent='';$('pinModal').classList.add('open');setTimeout(()=>$('pinInput').focus(),100);
}
function closePin(){$('pinModal').classList.remove('open');focusScanner()}
async function verifyGuard(){
  const pin=$('pinInput').value;
  $('pinContinue').disabled=true;$('pinContinue').textContent='Checking…';
  const {data,error}=await db.rpc('staff_dashboard',{p_pin:pin,p_service_date:new Date().toISOString().slice(0,10)});
  $('pinContinue').disabled=false;$('pinContinue').textContent='Continue';
  if(error||!data||data.status!=='success'){$('pinError').textContent='Incorrect PIN.';return}
  closePin();$('guardModal').classList.add('open');setTimeout(()=>$('manualReg').focus(),100);
}
function closeGuard(){$('guardModal').classList.remove('open');focusScanner()}
function setDirection(d){direction=d;updateStation();closeGuard()}
function manualRecord(){const reg=$('manualReg').value;if(!/^\d{5}$/.test(norm(reg)))return show('bad','✕','CHECK THE NUMBER',{message:'Enter a five-digit registration number.'});closeGuard();recordRegistration(reg,'manual')}

$('guardBtn').onclick=openPin;$('pinCancel').onclick=closePin;$('pinContinue').onclick=verifyGuard;$('pinInput').addEventListener('keydown',e=>{if(e.key==='Enter')verifyGuard()});
$('guardClose').onclick=closeGuard;$('setIn').onclick=()=>setDirection('IN');$('setOut').onclick=()=>setDirection('OUT');$('manualRecord').onclick=manualRecord;$('manualReg').addEventListener('keydown',e=>{if(e.key==='Enter')manualRecord()});
$('cameraBtn').onclick=startScan;$('cancelScan').onclick=stopScan;$('result').onclick=hideResult;
$('scannerInput').addEventListener('input',e=>{clearTimeout(scanTimer);scanTimer=setTimeout(()=>{const reg=norm(e.target.value);if(/^\d{5}$/.test(reg))recordRegistration(reg,'hardware')},80)});
$('scannerInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const reg=norm(e.target.value);if(/^\d{5}$/.test(reg))recordRegistration(reg,'hardware')}});
document.addEventListener('click',e=>{if(!$('pinModal').classList.contains('open')&&!$('guardModal').classList.contains('open')&&!$('cam').classList.contains('open'))focusScanner()});
window.addEventListener('online',()=>{$('online').textContent='● Online';$('online').style.background='#e7f7ec';$('online').style.color='#12683a'});
window.addEventListener('offline',()=>{$('online').textContent='● Offline';$('online').style.background='#fdeaea';$('online').style.color='#9a2020'});
updateStation();focusScanner();
