(function () {
  "use strict";
  var controlSession = null;
  var modeData = null;
  function el(id) { return document.getElementById(id); }
  function actor() {
    var name = String(el("adminSettingsActor").value || "").trim();
    if (!name) { el("adminSettingsActor").focus(); throw new Error("Enter your name for the audit record."); }
    localStorage.setItem("amfcc_admin_settings_actor",name); return name;
  }
  function isoOrNull(value) { return value ? new Date(value).toISOString() : null; }
  function showMessage(message,error) {
    var box=el("settingsMessage"); box.textContent=message; box.className="notice "+(error?"bad":"good"); box.style.display="block";
  }
  async function call(name,args) {
    var r=await window.amfccDb.rpc(name,args||{}); if(r.error) throw r.error; return r.data;
  }
  function modeMessage(mode,conference) {
    var base=mode==="holiday"?"Holiday Mode":"School Term Mode";
    if(conference) return base+" remains the calendar and gate-pass mode. Conference Mode is also ON, so meal planning has no deadline, manual-work sessions are disabled, and every active task is an Emergency.";
    if(mode==="holiday") return "Holiday Mode: manual work uses Morning and Afternoon slots and the existing holiday gate-pass rules apply.";
    return "School Term Mode: standard meal deadlines, gate-pass rules, and manual-work sessions apply.";
  }
  function renderMode() {
    if(!modeData) return; var mode=modeData.base_mode||modeData.mode||"normal";el("operatingMode").value=mode; el("holidayMode").checked=mode==="holiday";el("conferenceMode").checked=!!modeData.conference_mode; el("holidayRuleSummary").textContent=modeMessage(mode,!!modeData.conference_mode);
  }
  async function getControlSession(pin) {
    pin=String(pin||"").trim(); if(!/^\d{4}$/.test(pin)) return;
    var result=await call("system_control_login",{p_role:"administrator",p_pin:pin});
    if(result&&result.status==="success"){controlSession=result;sessionStorage.setItem("amfcc_admin_control_session",JSON.stringify(result));await refreshMode();}
  }
  function restoreControlSession(){try{var raw=sessionStorage.getItem("amfcc_admin_control_session");if(!raw)return false;controlSession=JSON.parse(raw);return !!controlSession.session_token}catch(e){return false}}
  async function refreshMode(){if(!controlSession)return;var data=await call("system_control_bootstrap",{p_session_token:controlSession.session_token});if(!data||data.status!=="success"){controlSession=null;sessionStorage.removeItem("amfcc_admin_control_session");return}modeData=await call("system_mode_status",{});renderMode()}
  async function saveSettings(event) {
    event.preventDefault(); event.stopImmediatePropagation();
    var button=el("saveSettings"),old=button.textContent;button.disabled=true;button.textContent="Saving...";
    try{
      if(!controlSession) throw new Error("Sign out and sign in again before changing settings.");
      var name=actor(),mode=el("operatingMode").value,conference=!!el("conferenceMode").checked;
      var result=await call("system_control_set_mode",{p_session_token:controlSession.session_token,p_mode:mode,p_actor_name:name});if(!result||result.status!=="success")throw new Error(result&&result.message||"Mode could not be changed.");
      result=await call("system_control_set_conference",{p_session_token:controlSession.session_token,p_enabled:conference,p_actor_name:name});if(!result||result.status!=="success")throw new Error(result&&result.message||"Conference Mode could not be changed.");
      var settings=[
        ["gate_pass_pilot_mode",!!el("pilotMode").checked],
        ["gate_pass_pilot_ends_at",isoOrNull(el("pilotEnd").value)],
        ["gate_terminal_result_seconds",Number(el("resultSeconds").value)]
      ];
      for(var i=0;i<settings.length;i++){result=await call("system_control_update_setting",{p_session_token:controlSession.session_token,p_setting_key:settings[i][0],p_setting_value:settings[i][1],p_actor_name:name});if(!result||result.status!=="success")throw new Error(result&&result.message||"A setting could not be saved.");}
      modeData={mode:mode,base_mode:mode,conference_mode:conference};renderMode();showMessage("Calendar mode, Conference overlay, and Admin settings saved.",false);
    }catch(error){showMessage(error.message||"Settings could not be saved.",true)}finally{button.disabled=false;button.textContent=old}
  }
  document.addEventListener("DOMContentLoaded",function(){
    el("adminSettingsActor").value=localStorage.getItem("amfcc_admin_settings_actor")||"";
    el("loginBtn").addEventListener("click",function(){var pin=el("pin").value;getControlSession(pin).catch(function(){})});
    el("operatingMode").addEventListener("change",function(){el("holidayMode").checked=this.value==="holiday";el("holidayRuleSummary").textContent=modeMessage(this.value,el("conferenceMode").checked)});
    el("conferenceMode").addEventListener("change",function(){el("holidayRuleSummary").textContent=modeMessage(el("operatingMode").value,this.checked)});
    el("saveSettings").addEventListener("click",saveSettings,true);
    if(restoreControlSession()) refreshMode().catch(function(){});
  });
})();
