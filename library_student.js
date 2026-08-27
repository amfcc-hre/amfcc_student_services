(function () {
  "use strict";

  var state={client:null,catalogue:[]};
  function el(id){return document.getElementById(id)}
  function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(ch){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]})}
  function date(value){if(!value)return "Not entered";return new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric"}).format(new Date(value+"T12:00:00"))}
  function showMessage(id,message,type){var box=el(id);box.textContent=message;box.className="notice "+(type||"info");box.hidden=false}
  function hideMessage(id){var box=el(id);box.hidden=true;box.textContent=""}
  function setBusy(form,busy,label){var button=form.querySelector('button[type="submit"]');if(!button)return;if(!button.dataset.originalLabel)button.dataset.originalLabel=button.textContent;button.disabled=busy;button.textContent=busy?label:button.dataset.originalLabel}
  function registration(raw){var match=String(raw||"").trim().match(/(?:^|\D)(\d{5})(?:\D|$)/);return match?match[1]:""}
  async function rpc(name,args){var result=await state.client.rpc(name,args||{});if(result.error)throw result.error;return result.data}
  function onlineStatus(){var status=el("libraryStatus"),online=navigator.onLine;status.textContent=online?"● Online":"● Offline";status.className="status-badge "+(online?"online":"offline")}

  function renderCatalogue(){
    var onlyAvailable=el("availableOnly").checked;
    var items=state.catalogue.filter(function(item){return !onlyAvailable||Number(item.available_count)>0});
    var box=el("catalogResults");
    if(!state.catalogue.length){box.innerHTML='<div class="empty-library">No books match this search. If the catalogue has not been entered yet, books will appear here after Library staff add them.</div>';return}
    if(!items.length){box.innerHTML='<div class="empty-library">No matching books are available to borrow now. Untick “Show books available” to see titles that are currently on loan.</div>';return}
    box.innerHTML=items.map(function(item){
      var available=Number(item.available_count)||0,total=Number(item.copy_count)||0;
      var status=available>0?available+" available now":total>0?"All copies on loan":"No borrowable copy yet";
      var statusClass=available>0?"available":"unavailable";
      return '<article class="book-item"><h3>'+esc(item.title)+'</h3><p>'+esc(item.author||"Author not entered")+'</p>'+
        (item.subtitle?'<p class="muted">'+esc(item.subtitle)+'</p>':'')+
        '<div class="book-meta"><span class="book-count '+statusClass+'">'+esc(status)+'</span>'+
        '<span class="book-count">'+esc(total)+' total '+(total===1?'copy':'copies')+'</span>'+
        (item.shelf_location?'<span class="book-count">Shelf '+esc(item.shelf_location)+'</span>':'')+
        (item.category?'<span class="book-count">'+esc(item.category)+'</span>':'')+'</div></article>'
    }).join("")
  }

  async function searchCatalogue(event){
    if(event)event.preventDefault();var form=el("catalogForm");setBusy(form,true,"Searching...");hideMessage("catalogMessage");
    try{
      var data=await rpc("library_public_catalog",{p_query:String(el("catalogSearch").value||"").trim()});
      if(!data||data.status!=="success")throw new Error(data&&data.message||"The catalogue is not available right now.");
      state.catalogue=data.titles||[];renderCatalogue();
      showMessage("catalogMessage",state.catalogue.length?state.catalogue.length+" catalogue "+(state.catalogue.length===1?"title":"titles")+" found.":"No catalogue titles were found.","info")
    }catch(error){state.catalogue=[];el("catalogResults").innerHTML="";showMessage("catalogMessage",error.message||"The catalogue could not be searched. Check the internet connection and try again.","bad")}
    finally{setBusy(form,false)}
  }

  function dueLabel(loan){var days=Number(loan.due_in_days);if(loan.overdue)return "Overdue by "+Math.abs(days)+" "+(Math.abs(days)===1?"day":"days");if(days===0)return "Due today";if(days===1)return "Due tomorrow";return "Due in "+days+" days"}
  function renderLoans(loans){
    var box=el("loanResults");
    if(!loans.length){box.innerHTML='<div class="empty-library">No current Library loans were found for that registration number.</div>';return}
    box.innerHTML=loans.map(function(loan){var days=Number(loan.due_in_days),tone=loan.overdue?"overdue":days<=3?"due-soon":"";return '<article class="loan-item '+tone+'"><h3>'+esc(loan.title)+'</h3><p>'+esc(loan.author||"Author not entered")+'</p><div class="loan-meta"><span class="book-count">Borrowed '+esc(date(loan.borrowed_on))+'</span><span class="book-count '+(loan.overdue?"overdue":days<=3?"unavailable":"available")+'">'+esc(dueLabel(loan))+'</span><span class="book-count">Due '+esc(date(loan.due_date))+'</span>'+(Number(loan.renew_count)?'<span class="book-count">Renewed '+esc(loan.renew_count)+' time'+(Number(loan.renew_count)===1?'':'s')+'</span>':'')+'</div></article>'}).join("")
  }

  async function findLoans(event){
    event.preventDefault();var form=el("loanForm"),reg=registration(el("loanReg").value);hideMessage("loanMessage");el("loanResults").innerHTML="";
    if(!reg){showMessage("loanMessage","Enter your five-digit registration number.","bad");el("loanReg").focus();return}
    el("loanReg").value=reg;setBusy(form,true,"Checking...");
    try{
      var data=await rpc("library_student_loans",{p_registration_number:reg});
      if(!data||data.status!=="success")throw new Error(data&&data.message||"Your Library record could not be checked.");
      var loans=data.loans||[];renderLoans(loans);showMessage("loanMessage",loans.length?"Your current Library loans are shown below.":"No current loans were found.",loans.length?"good":"info")
    }catch(error){showMessage("loanMessage",error.message||"Your loans could not be checked. Check the internet connection and try again.","bad")}
    finally{setBusy(form,false)}
  }

  document.addEventListener("DOMContentLoaded",function(){
    state.client=window.amfccDb;
    el("catalogForm").addEventListener("submit",searchCatalogue);
    el("availableOnly").addEventListener("change",renderCatalogue);
    el("loanForm").addEventListener("submit",findLoans);
    el("loanReg").addEventListener("input",function(){this.value=this.value.replace(/\D/g,"").slice(0,5)});
    window.addEventListener("online",onlineStatus);window.addEventListener("offline",onlineStatus);onlineStatus();
    if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"});
    searchCatalogue().catch(function(){})
  })
})();

