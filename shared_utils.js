window.AMFCC = (() => {
  const $ = id => document.getElementById(id);

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));

  const normalizeReg = value => String(value ?? '').replace(/\D/g,'').slice(0,5);

  const currentAcademicYear = () => {
    const year = new Intl.DateTimeFormat('en', {
      timeZone: APP_CONFIG.TIMEZONE,
      year: 'numeric'
    }).format(new Date());
    return Number(year);
  };

  const studentYearNumber = (registrationNumber, academicYear = currentAcademicYear()) => {
    const digits = String(registrationNumber ?? '').replace(/\D/g, '');
    if (digits.length < 2) return null;
    const intakeSuffix = Number(digits.slice(0, 2));
    if (!Number.isInteger(intakeSuffix)) return null;
    const intakeYear = 2000 + intakeSuffix;
    const yearNumber = Number(academicYear) - intakeYear + 1;
    return Number.isInteger(yearNumber) && yearNumber >= 1 && yearNumber <= 9
      ? yearNumber
      : null;
  };

  const ordinal = number => {
    const n = Number(number);
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
    if (n % 10 === 1) return `${n}st`;
    if (n % 10 === 2) return `${n}nd`;
    if (n % 10 === 3) return `${n}rd`;
    return `${n}th`;
  };

  const studentYearLabel = (registrationNumber, academicYear = currentAcademicYear()) => {
    const yearNumber = studentYearNumber(registrationNumber, academicYear);
    return yearNumber ? `${ordinal(yearNumber)} Year` : 'Year unknown';
  };

  const studentYearMatches = (
    registrationNumber,
    filter,
    academicYear = currentAcademicYear()
  ) => {
    if (!filter || String(filter).toUpperCase() === 'ALL') return true;
    const yearNumber = studentYearNumber(registrationNumber, academicYear);
    return yearNumber !== null && String(yearNumber) === String(filter);
  };

  const localDate = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_CONFIG.TIMEZONE,
    year:'numeric',
    month:'2-digit',
    day:'2-digit'
  }).format(new Date());

  const formatDateTime = value => value ? new Intl.DateTimeFormat('en-ZW', {
    timeZone: APP_CONFIG.TIMEZONE,
    dateStyle:'medium',
    timeStyle:'short'
  }).format(new Date(value)) : 'Not recorded';

  const formatDate = value => value ? new Intl.DateTimeFormat('en-ZW', {
    timeZone: APP_CONFIG.TIMEZONE,
    dateStyle:'medium'
  }).format(new Date(value)) : '';

  const toIso = localValue => localValue ? new Date(localValue).toISOString() : null;

  const setOnlineBadge = id => {
    const el = $(id);
    if (!el) return;
    el.textContent = navigator.onLine ? '● Online' : '● Offline';
    el.className = 'status-badge ' + (navigator.onLine ? 'online' : 'offline');
  };

  const downloadCsv = (rows, filename) => {
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('There are no rows to export.');
    }
    const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const quote = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const csv = [
      headers.map(quote).join(','),
      ...rows.map(row => headers.map(h => quote(row[h])).join(','))
    ].join('\n');

    const url = URL.createObjectURL(
      new Blob([csv], {type:'text/csv;charset=utf-8'})
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  let serviceWorkerRefreshing = false;

  const registerSW = () => {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (serviceWorkerRefreshing) return;
      serviceWorkerRefreshing = true;
      window.location.reload();
    });

    return navigator.serviceWorker
      .register('./sw.js', {scope:'./', updateViaCache:'none'})
      .then(registration => {
        registration.update().catch(() => {});
        return registration;
      })
      .catch(error => {
        console.warn('Service worker registration failed:', error);
        return null;
      });
  };

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => registerSW(), {once:true});
  }

  return {
    $,
    esc,
    normalizeReg,
    currentAcademicYear,
    studentYearNumber,
    studentYearLabel,
    studentYearMatches,
    localDate,
    formatDateTime,
    formatDate,
    toIso,
    setOnlineBadge,
    downloadCsv,
    registerSW
  };
})();

/* AMFCC dashboard and gate-pass improvements, version 10. */
(() => {
  const {$,esc,formatDateTime,localDate,downloadCsv,studentYearLabel}=window.AMFCC;

  function injectV10Styles(){
    if(document.getElementById('amfccV10Styles'))return;
    const style=document.createElement('style');
    style.id='amfccV10Styles';
    style.textContent=`
      .pass-people-summary{display:grid;gap:4px}
      .pass-person-line{display:flex;flex-direction:column;line-height:1.25}
      .pass-person-line small{color:#66727f}
      .pass-person-line.primary b:after{content:' · Applicant';font-size:11px;color:#66727f;font-weight:700}
      .review-people-list{margin:7px 0 15px;padding-left:20px}
      .review-people-list li{margin:6px 0}
      .outing-type-field{margin-top:10px;padding:12px;border-radius:12px;background:#eef4ff}
      .outing-current{font-size:13px;color:#66727f;margin-top:5px}
      .schedule-edit-v10{margin:14px 0;padding:14px;border-radius:14px;background:#f1f4f7}
      .schedule-edit-v10 h3{margin:0 0 10px}
      .privacy-note-v10{font-size:13px}
      .view-only-pass .action-grid,.view-only-pass #actorRole,.view-only-pass #decisionComments{display:none!important}
      @media(max-width:620px){.pass-person-line{min-width:210px}}
    `;
    document.head.appendChild(style);
  }

  function pageName(){
    return location.pathname.split('/').pop()||'index.html';
  }

  function passPeople(pass){
    const people=Array.isArray(pass?.people)&&pass.people.length
      ?pass.people
      :[{student_name:pass?.student_name,registration_number:pass?.registration_number,is_primary:true}];
    return people.filter(person=>person&&person.student_name);
  }

  function peopleSearchText(pass){
    return passPeople(pass).map(person=>`${person.student_name} ${person.registration_number}`).join(' ');
  }

  function peopleSummaryHtml(pass,withButtons=false){
    return `<div class="pass-people-summary">${passPeople(pass).map(person=>{
      const name=withButtons
        ?`<button class="student-link" data-review="${esc(pass.id)}">${esc(person.student_name)}</button>`
        :`<b>${esc(person.student_name)}</b>`;
      return `<span class="pass-person-line ${person.is_primary?'primary':''}">${name}<small>${esc(person.registration_number)}</small></span>`;
    }).join('')}</div>`;
  }

  function peopleReviewHtml(pass){
    return `<ul class="review-people-list">${passPeople(pass).map(person=>
      `<li><b>${esc(person.student_name)}</b> (${esc(person.registration_number)})${person.is_primary?' · Applicant':''}</li>`
    ).join('')}</ul>`;
  }

  function localDateTimeInput(value){
    if(!value)return '';
    const date=new Date(value);
    const pad=number=>String(number).padStart(2,'0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function removeMaternityControls(){
    document.querySelectorAll('select option[value="MATERNITY"]').forEach(option=>option.remove());
    document.querySelectorAll('.notice.info').forEach(notice=>{
      if(/maternity/i.test(notice.textContent||'')){
        notice.textContent='Student Leadership and senior staff can see only whether a student has been allowed bed rest. Clinic details are restricted to School Administration and Clinic staff.';
        notice.classList.add('privacy-note-v10');
      }
    });
    document.querySelectorAll('#reports .muted').forEach(text=>{
      text.textContent=(text.textContent||'').replace(/,?\s*maternity status/ig,'').replace(/,?\s*maternity/ig,'');
    });
  }

  function patchDashboard(){
    injectV10Styles();
    removeMaternityControls();

    window.healthHtml=function(student){
      return student?.bed_rest
        ?'<span class="health-pill bed-rest">🛏️ Allowed bed rest</span>'
        :'<span class="muted">None</span>';
    };

    async function dashboardLoadV10(){
      if(!pin)return false;
      const {data,error}=await amfccDb.rpc('student_services_dashboard_v3',{p_pin:pin});
      if(error||data?.status!=='success'){
        $('pinError').textContent=error?.message||data?.message||'Incorrect password.';
        $('pinError').style.display='block';
        return false;
      }
      dataCache=data;
      render();
      removeMaternityControls();
      renderPassesV10();
      $('updated').textContent='Updated '+new Date().toLocaleTimeString('en-ZW');
      return true;
    }

    async function dashboardLoginV10(){
      pin=$('pin').value.trim();
      if(!/^\d{4}$/.test(pin)){
        $('pinError').textContent='Enter the four-digit password.';
        $('pinError').style.display='block';
        return;
      }
      const ok=await dashboardLoadV10();
      if(ok){
        sessionStorage.setItem('amfcc_dashboard_pin',pin);
        closeLoginOverlay();
        clearInterval(timer);
        timer=setInterval(dashboardLoadV10,12000);
      }
    }

    function renderPassesV10(){
      const query=($('passSearch')?.value||'').toLowerCase();
      const filter=$('passFilter')?.value||'ALL';
      const year=$('passYearFilter')?.value||'ALL';
      const rows=(dataCache?.gate_passes||[]).filter(pass=>{
        const statusMatch=filter==='ALL'||(filter==='OVERDUE'?Boolean(pass.overdue):pass.status===filter);
        const yearMatch=year==='ALL'||passPeople(pass).some(person=>typeof yearMatches==='function'?yearMatches(person.registration_number,year):true);
        const text=`${peopleSearchText(pass)} ${pass.destination||''}`.toLowerCase();
        return statusMatch&&yearMatch&&text.includes(query);
      });
      $('passRows').innerHTML=rows.map(pass=>`<tr class="${pass.overdue?'overdue':''}">
        <td>${peopleSummaryHtml(pass,Boolean(dataCache?.can_review_passes))}</td>
        <td>${esc(pass.destination)}</td>
        <td><div class="status-review"><span class="pill ${pass.overdue?'overdue':esc(pass.status)}">${pass.overdue?'OVERDUE':esc(String(pass.status||'').toUpperCase())}</span><button class="btn secondary compact-btn" data-review="${esc(pass.id)}">${dataCache?.can_review_passes?'Review':'View'}</button></div>${pass.waiting_on?`<small class="muted">Waiting on ${esc(pass.waiting_on)}</small>`:''}</td>
        <td>${esc(formatDateTime(pass.departure_at))}<br><small>Return ${esc(formatDateTime(pass.expected_return_at))}</small></td>
      </tr>`).join('')||'<tr><td colspan="4" class="empty">No matching gate passes.</td></tr>';
    }

    async function openDashboardReviewV10(id){
      reviewPassId=id;
      $('reviewDetails').innerHTML='<div class="empty">Loading pass…</div>';
      $('reviewModal').classList.add('open');
      const {data,error}=await amfccDb.rpc('dashboard_gate_pass_review_details',{p_pin:pin,p_pass_id:id});
      if(error||data?.status!=='success'){
        $('reviewModal').classList.remove('open');
        return toast('bad','Could not open pass',error?.message||data?.message||'Try again.');
      }
      const pass=data.pass;
      const approvals=(pass.approvals||[]).map(approval=>`<div class="approval-row"><b>${esc(approval.role==='administrator'?'School Administrator':approval.role)}</b><span>${esc(approval.decision)} · ${esc(formatDateTime(approval.decided_at))}</span></div>`).join('')||'<p class="muted">No decisions yet.</p>';
      $('reviewDetails').innerHTML=`
        <p><b>Applicant:</b> ${esc(pass.student_name)} (${esc(pass.registration_number)})</p>
        <h3>Everyone on this pass</h3>${peopleReviewHtml(pass)}
        <p><b>Destination:</b> ${esc(pass.destination)}</p>
        <p><b>Reason:</b> ${esc(pass.reason)}</p>
        <p><b>Departure:</b> ${esc(formatDateTime(pass.departure_at))}</p>
        <p><b>Expected return:</b> ${esc(formatDateTime(pass.expected_return_at))}</p>
        ${pass.contact_details?`<p><b>Contact:</b> ${esc(pass.contact_details)}</p>`:''}
        <p><b>Status:</b> ${esc(pass.status)}</p>
        <h3>Signatures and decisions</h3><div class="approval-list">${approvals}</div>`;

      const roleField=$('actorRole')?.closest('.field');
      const commentsField=$('decisionComments')?.closest('.field');
      const actionGrid=$('reviewModal')?.querySelector('.action-grid');
      const canDecide=Boolean(data.can_decide);
      if(roleField)roleField.style.display=canDecide?'grid':'none';
      if(commentsField)commentsField.style.display=canDecide?'grid':'none';
      if(actionGrid)actionGrid.style.display=canDecide?'grid':'none';
      $('reviewModal').classList.toggle('view-only-pass',!canDecide);
      let notice=$('reviewModal').querySelector('#leadershipReviewNoticeV10');
      if(!notice){
        notice=document.createElement('div');
        notice.id='leadershipReviewNoticeV10';
        notice.className='notice info';
        $('reviewDetails').after(notice);
      }
      notice.style.display=canDecide?'none':'block';
      notice.textContent='Student Leadership view only. Approval decisions are made by School Administration and senior staff.';
    }

    function ensureOutingField(){
      if($('editOutingType'))return;
      const statusField=$('editCampusStatus')?.closest('.field');
      if(!statusField)return;
      const field=document.createElement('div');
      field.id='outingTypeFieldV10';
      field.className='field outing-type-field';
      field.innerHTML=`<label>Type of outing</label><select id="editOutingType"><option value="">Not specified</option><option value="gate_pass">Gate pass</option><option value="tanaka">Tanaka/Amalinda Shops</option><option value="mdh">MDH</option><option value="town_other">Town/Other</option><option value="holiday">Holiday</option></select><div id="outingCurrentV10" class="outing-current"></div>`;
      statusField.after(field);
    }

    function toggleOutingFieldV10(){
      const effective=($('editCampusStatus')?.value||editOriginal?.status||'');
      const field=$('outingTypeFieldV10');
      if(!field)return;
      field.style.display=effective==='OUT'?'grid':'none';
      $('editOutingType').disabled=effective!=='OUT';
    }

    function openStudentEditV10(registrationNumber){
      ensureOutingField();
      const student=(dataCache?.students||[]).find(item=>String(item.registration_number)===String(registrationNumber));
      if(!student)return toast('warn','Student not found','Refresh the dashboard and try again.');
      editOriginal={...student};
      $('studentEditSummary').innerHTML=`<p><b>${esc(student.student_name)}</b></p><p>Registration: ${esc(student.registration_number)}</p><p>Current campus status: <b>${student.status==='IN'?'On campus':student.status==='OUT'?'Off campus':'Unknown'}</b></p>${student.outing_label?`<p>Current outing: <b>${esc(student.outing_label)}</b></p>`:''}`;
      $('editCampusStatus').value=student.status==='IN'||student.status==='OUT'?student.status:'';
      $('editCampusNote').value='';
      $('editOutingType').value=student.outing_type||'';
      $('outingCurrentV10').textContent=student.outing_label?`Current: ${student.outing_label}`:'No outing type recorded.';
      $('editResidence').value=student.residence||'';
      $('editRoom').value=student.room||'';
      $('editBed').value=student.bed||'';
      $('editAccommodationStatus').value=['waiting','allocated','checked_in','checked_out'].includes(student.accommodation_status)?student.accommodation_status:'allocated';
      $('removeAccommodation').checked=false;
      toggleAccommodationFields();
      toggleOutingFieldV10();
      $('studentEditModal').classList.add('open');
    }

    async function saveStudentEditV10(){
      if(!editOriginal)return;
      const registration=String(editOriginal.registration_number);
      const selectedStatus=$('editCampusStatus').value;
      const effectiveStatus=selectedStatus||editOriginal.status;
      const selectedOuting=effectiveStatus==='OUT'?$('editOutingType').value:'';
      const statusChanged=Boolean(selectedStatus&&selectedStatus!==editOriginal.status);
      const outingChanged=effectiveStatus==='OUT'&&selectedOuting!==(editOriginal.outing_type||'');
      const campusChanged=statusChanged||outingChanged;
      const removeAccommodation=$('removeAccommodation').checked;
      const residence=$('editResidence').value.trim();
      const room=$('editRoom').value.trim();
      const bed=$('editBed').value.trim();
      const accommodationStatus=$('editAccommodationStatus').value;
      const accommodationChanged=removeAccommodation||residence!==(editOriginal.residence||'')||room!==(editOriginal.room||'')||bed!==(editOriginal.bed||'')||accommodationStatus!==(editOriginal.accommodation_status||'allocated');
      if(!campusChanged&&!accommodationChanged)return toast('warn','No changes','Change campus status, outing type or accommodation first.');

      $('saveStudentEdit').disabled=true;
      $('saveStudentEdit').textContent='Saving...';
      try{
        if(campusChanged){
          const {data,error}=await amfccDb.rpc('dashboard_update_student_campus_status_v2',{
            p_pin:pin,p_registration_number:registration,p_direction:effectiveStatus,
            p_outing_type:selectedOuting||null,p_note:$('editCampusNote').value.trim()||null
          });
          if(error||!['success','same_status'].includes(data?.status))throw new Error(error?.message||data?.message||'Campus status was not saved.');
        }
        if(accommodationChanged){
          const {data,error}=await amfccDb.rpc('dashboard_update_student_accommodation',{
            p_pin:pin,p_registration_number:registration,p_residence:residence,p_room:room||null,p_bed:bed||null,p_allocation_status:accommodationStatus,p_remove:removeAccommodation
          });
          if(error||data?.status!=='success')throw new Error(error?.message||data?.message||'Accommodation was not saved.');
        }
        $('studentEditModal').classList.remove('open');
        editOriginal=null;
        toast('good','Student updated','Campus status, outing type and accommodation changes were saved.');
        await dashboardLoadV10();
      }catch(error){toast('bad','Not saved',error.message||'Try again.');}
      finally{$('saveStudentEdit').disabled=false;$('saveStudentEdit').textContent='Save changes';}
    }

    async function exportMovementsV10(){
      const period=$('movementPeriod').value;
      const year=$('movementYearFilter').value;
      $('exportMovements').disabled=true;
      const {data,error}=await amfccDb.rpc('student_movements_export_v2',{p_pin:pin,p_period:period});
      $('exportMovements').disabled=false;
      if(error||data?.status!=='success')return toast('bad','Export failed',error?.message||data?.message||'Try again.');
      const rows=(data.rows||[]).filter(row=>typeof yearMatches==='function'?yearMatches(row.registration_number,year):true);
      const summary={active_students:rows.length,on_campus:rows.filter(row=>row.on_campus==='Yes').length,on_bed_rest:rows.filter(row=>row.on_bed_rest==='Yes').length,on_gate_pass:rows.filter(row=>row.on_gate_pass==='Yes').length};
      $('movementExportSummary').innerHTML=`<span><b>${esc(summary.active_students)}</b> active</span><span><b>${esc(summary.on_campus)}</b> on campus</span><span><b>${esc(summary.on_bed_rest)}</b> bed rest</span><span><b>${esc(summary.on_gate_pass)}</b> gate pass</span>`;
      const exportRows=rows.map(row=>({
        'Report Period':data.period_label,'Generated At':formatDateTime(data.generated_at),
        'Registration Number':row.registration_number,'Student Name':row.student_name,
        'Class Year':studentYearLabel(row.registration_number,typeof academicYear==='function'?academicYear():undefined),
        'Current Campus Status':row.current_campus_status,'On Campus':row.on_campus,
        'Allowed Bed Rest':row.on_bed_rest,'On Gate Pass':row.on_gate_pass,
        'Gate Pass Status':row.gate_pass_status,'Gate Pass Destination':row.gate_pass_destination,
        'Gate Pass Departure':row.gate_pass_departure_at?formatDateTime(row.gate_pass_departure_at):'',
        'Gate Pass Expected Return':row.gate_pass_expected_return_at?formatDateTime(row.gate_pass_expected_return_at):'',
        'Gate Pass Overdue':row.gate_pass_overdue,'Latest Movement':row.latest_movement_at?formatDateTime(row.latest_movement_at):'',
        'Latest Direction':row.latest_movement_direction||'','Latest Checkout Destination':row.latest_checkout_destination||'',
        'Movements in Selected Period':row.movements_in_period??'',
        'Last Movement in Selected Period':row.last_movement_in_period?formatDateTime(row.last_movement_in_period):'',
        'Last Direction in Selected Period':row.last_direction_in_period||'','Last Destination in Selected Period':row.last_destination_in_period||'',
        'Residence':row.residence||'','Room':row.room||'','Bed':row.bed||''
      }));
      try{downloadCsv(exportRows,`student-movements-${period}-${year==='ALL'?'all-years':`year-${year}`}-${localDate()}.csv`);}catch(error){toast('warn','No records',error.message);}
    }

    window.renderPasses=renderPassesV10;
    window.openReview=openDashboardReviewV10;
    window.openStudentEdit=openStudentEditV10;
    window.saveStudentEdit=saveStudentEditV10;
    window.load=dashboardLoadV10;

    $('loginBtn').onclick=dashboardLoginV10;
    $('pin').onkeydown=event=>{if(event.key==='Enter')dashboardLoginV10();};
    $('refresh').onclick=dashboardLoadV10;
    $('passSearch').oninput=renderPassesV10;
    $('passFilter').onchange=renderPassesV10;
    $('passYearFilter').onchange=renderPassesV10;
    $('saveStudentEdit').onclick=saveStudentEditV10;
    $('editCampusStatus').onchange=toggleOutingFieldV10;
    if($('exportMovements'))$('exportMovements').onclick=exportMovementsV10;

    document.addEventListener('click',event=>{
      const review=event.target.closest('[data-review]');
      if(review){event.preventDefault();event.stopImmediatePropagation();openDashboardReviewV10(review.dataset.review);return;}
      const edit=event.target.closest('[data-edit-student]');
      if(edit){event.preventDefault();event.stopImmediatePropagation();openStudentEditV10(edit.dataset.editStudent);}
    },true);

    ensureOutingField();
    if(pin){dashboardLoadV10().then(ok=>{if(ok)closeLoginOverlay();});}
  }

  function patchAdminMain(){
    injectV10Styles();

    async function adminLoadV10(){
      if(!pin)return false;
      const {data,error}=await amfccDb.rpc('admin_services_dashboard_v2',{p_pin:pin,p_term_id:selectedTermId?Number(selectedTermId):null});
      if(error||data?.status!=='success'){
        $('pinError').textContent=error?.message||data?.message||'Incorrect Admin password.';
        $('pinError').style.display='block';
        return false;
      }
      dataCache=data;
      selectedTermId=String(data.selected_term?.id||'');
      render();
      renderAdminPassesV10();
      $('updated').textContent='Updated '+new Date().toLocaleTimeString('en-ZW');
      return true;
    }

    async function adminLoginV10(){
      pin=$('pin').value.trim();
      if(!/^\d{4}$/.test(pin)){
        $('pinError').textContent='Enter the four-digit Admin password.';
        $('pinError').style.display='block';
        return;
      }
      const ok=await adminLoadV10();
      if(ok){sessionStorage.setItem('amfcc_admin_pin',pin);closeLoginOverlay();clearInterval(timer);timer=setInterval(adminLoadV10,12000);}
    }

    function renderAdminPassesV10(){
      const query=($('passSearch')?.value||'').toLowerCase();
      const filter=$('passFilter')?.value||'ALL';
      const year=$('passYearFilter')?.value||'ALL';
      const rows=(dataCache?.gate_passes||[]).filter(pass=>{
        const statusMatch=filter==='ALL'||(filter==='OVERDUE'?Boolean(pass.overdue):pass.status===filter);
        const yearMatch=year==='ALL'||passPeople(pass).some(person=>typeof yearMatches==='function'?yearMatches(person.registration_number,year):true);
        return statusMatch&&yearMatch&&`${peopleSearchText(pass)} ${pass.destination||''}`.toLowerCase().includes(query);
      });
      $('passRows').innerHTML=rows.map(pass=>`<tr class="${pass.overdue?'overdue':''}">
        <td>${peopleSummaryHtml(pass,true)}</td><td>${esc(pass.destination)}</td>
        <td><div class="status-review"><span class="pill ${pass.overdue?'overdue':esc(pass.status)}">${pass.overdue?'OVERDUE':esc(String(pass.status||'').toUpperCase())}</span><button class="btn secondary compact-btn" data-review="${esc(pass.id)}">Review</button></div>${pass.waiting_on?`<small class="muted">Waiting on ${esc(pass.waiting_on)}</small>`:''}</td>
        <td>${esc(formatDateTime(pass.departure_at))}<br><small>Return ${esc(formatDateTime(pass.expected_return_at))}</small></td>
      </tr>`).join('')||'<tr><td colspan="4" class="empty">No matching gate passes.</td></tr>';
    }

    function ensureAdminScheduleFields(){
      if($('adminScheduleV10'))return;
      const details=$('reviewDetails');
      const block=document.createElement('div');
      block.id='adminScheduleV10';
      block.className='schedule-edit-v10';
      block.innerHTML=`<h3>Edit departure and return</h3><div class="grid two"><div class="field"><label>Departure date and time</label><input id="adminReviewDepartureV10" type="datetime-local"></div><div class="field"><label>Expected return date and time</label><input id="adminReviewReturnV10" type="datetime-local"></div></div><button id="adminSaveScheduleV10" class="btn secondary" style="width:100%;margin-top:10px">Save time changes only</button>`;
      details.after(block);
      $('adminSaveScheduleV10').onclick=()=>saveAdminReviewV10(null);
    }

    async function openAdminReviewV10(id){
      ensureAdminScheduleFields();
      reviewPassId=id;
      $('reviewDetails').innerHTML='<div class="empty">Loading pass…</div>';
      $('reviewModal').classList.add('open');
      const {data,error}=await amfccDb.rpc('admin_gate_pass_review_details',{p_pin:pin,p_pass_id:id});
      if(error||data?.status!=='success'){
        $('reviewModal').classList.remove('open');
        return toast('bad','Could not open pass',error?.message||data?.message||'Try again.');
      }
      const pass=data.pass;
      const approvals=(pass.approvals||[]).map(approval=>`<div class="approval-row"><b>${esc(approval.role==='administrator'?'School Administrator':approval.role)}</b><span>${esc(approval.decision)} · ${esc(formatDateTime(approval.decided_at))}</span></div>`).join('')||'<p class="muted">No decisions yet.</p>';
      $('reviewDetails').innerHTML=`<p><b>Applicant:</b> ${esc(pass.student_name)} (${esc(pass.registration_number)})</p><h3>Everyone on this pass</h3>${peopleReviewHtml(pass)}<p><b>Destination:</b> ${esc(pass.destination)}</p><p><b>Reason:</b> ${esc(pass.reason)}</p><p><b>Contact:</b> ${esc(pass.contact_details)}</p><p><b>Status:</b> ${esc(pass.status)}</p><p><b>Waiting on:</b> ${esc(pass.waiting_on||'No further signature')}</p><h3>Signatures and decisions</h3><div class="approval-list">${approvals}</div>`;
      $('adminReviewDepartureV10').value=localDateTimeInput(pass.departure_at);
      $('adminReviewReturnV10').value=localDateTimeInput(pass.expected_return_at);
      $('decisionComments').value='';
    }

    async function saveAdminReviewV10(decision=null){
      if(!reviewPassId)return;
      const departure=$('adminReviewDepartureV10').value;
      const expectedReturn=$('adminReviewReturnV10').value;
      const comments=$('decisionComments').value.trim();
      if(!departure||!expectedReturn)return toast('warn','Dates required','Enter both departure and expected return date and time.');
      if(['rejected','cancelled'].includes(decision)&&!comments)return toast('warn','Add a reason','A rejection or cancellation reason is required.');
      document.querySelectorAll('#reviewModal button').forEach(button=>button.disabled=true);
      const {data,error}=await amfccDb.rpc('admin_review_gate_pass',{
        p_pin:pin,p_pass_id:reviewPassId,p_departure_at:new Date(departure).toISOString(),p_expected_return_at:new Date(expectedReturn).toISOString(),p_decision:decision,p_comments:comments||null
      });
      document.querySelectorAll('#reviewModal button').forEach(button=>button.disabled=false);
      if(error||data?.status!=='success')return toast('bad','Not saved',error?.message||data?.message||'Try again.');
      $('reviewModal').classList.remove('open');reviewPassId=null;$('decisionComments').value='';
      toast('good',decision?'Pass updated':'Times updated',decision?`The times were saved and the pass is now ${data.pass_status}.`:'Departure and expected return times were saved.');
      await adminLoadV10();
    }

    window.load=adminLoadV10;
    window.renderPasses=renderAdminPassesV10;
    window.openReview=openAdminReviewV10;
    window.decide=saveAdminReviewV10;

    $('loginBtn').onclick=adminLoginV10;
    $('pin').onkeydown=event=>{if(event.key==='Enter')adminLoginV10();};
    $('refresh').onclick=adminLoadV10;
    $('termSelect').onchange=async()=>{selectedTermId=$('termSelect').value;await adminLoadV10();};
    $('passSearch').oninput=renderAdminPassesV10;
    $('passFilter').onchange=renderAdminPassesV10;
    $('passYearFilter').onchange=renderAdminPassesV10;
    document.querySelectorAll('[data-decision]').forEach(button=>button.onclick=()=>saveAdminReviewV10(button.dataset.decision));

    document.addEventListener('click',event=>{
      const review=event.target.closest('[data-review]');
      if(review){event.preventDefault();event.stopImmediatePropagation();openAdminReviewV10(review.dataset.review);return;}
      const decision=event.target.closest('[data-decision]');
      if(decision){event.preventDefault();event.stopImmediatePropagation();saveAdminReviewV10(decision.dataset.decision);}
    },true);

    ensureAdminScheduleFields();
    if(pin){adminLoadV10().then(ok=>{if(ok)closeLoginOverlay();});}
  }

  function patchAdminGatePassPage(){
    injectV10Styles();

    async function loadV10(){
      const {data,error}=await amfccDb.rpc('admin_services_dashboard_v2',{p_pin:pin,p_term_id:null});
      if(error||data?.status!=='success'){
        $('pinError').textContent=error?.message||data?.message||'Incorrect School Administration password.';
        $('pinError').style.display='block';
        return false;
      }
      dataCache=data;renderV10();$('updated').textContent='Updated '+new Date().toLocaleTimeString('en-ZW');return true;
    }

    function renderV10(){
      const query=($('passSearch')?.value||'').toLowerCase();
      const status=$('passFilter')?.value||'ALL';
      const rows=(dataCache?.gate_passes||[]).filter(pass=>(status==='ALL'||pass.status===status)&&`${peopleSearchText(pass)} ${pass.destination||''}`.toLowerCase().includes(query));
      $('passRows').innerHTML=rows.map(pass=>`<tr><td>${peopleSummaryHtml(pass,false)}</td><td>${esc(pass.destination)}</td><td><span class="pill ${esc(pass.status)}">${esc(String(pass.status||'').toUpperCase())}</span>${pass.waiting_on?`<br><small>Waiting on ${esc(pass.waiting_on)}</small>`:''}</td><td>${esc(formatDateTime(pass.departure_at))}<br><small>Return ${esc(formatDateTime(pass.expected_return_at))}</small></td><td><button class="btn secondary compact-btn" data-review="${esc(pass.id)}">Open</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">No matching gate passes.</td></tr>';
    }

    async function loginV10(){
      pin=$('pin').value.trim();
      if(!/^\d{4}$/.test(pin)){$('pinError').textContent='Enter the four-digit School Administration password.';$('pinError').style.display='block';return;}
      $('loginBtn').disabled=true;const success=await loadV10();$('loginBtn').disabled=false;
      if(success){sessionStorage.setItem('amfcc_admin_pin',pin);closeLoginOverlay();}
    }

    window.load=loadV10;window.renderPasses=renderV10;window.login=loginV10;
    $('loginBtn').onclick=loginV10;$('pin').onkeydown=event=>{if(event.key==='Enter')loginV10();};$('refresh').onclick=loadV10;$('passSearch').oninput=renderV10;$('passFilter').onchange=renderV10;
    if(pin){$('pin').value=pin;loginV10();}
  }

  window.addEventListener('load',()=>setTimeout(()=>{
    const page=pageName();
    if(page==='dashboard_index.html')patchDashboard();
    else if(page==='admin_index.html')patchAdminMain();
    else if(page==='admin_gate_passes.html')patchAdminGatePassPage();
  },0),{once:true});
})();

