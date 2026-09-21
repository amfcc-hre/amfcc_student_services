(function(){
  "use strict";
  const W=583,H=843;
  function clean(value){return String(value==null?'':value).trim();}
  function value(data,section,key){return clean(data&&data[section]&&data[section][key]);}
  function money(input){const n=Number(input);return input==null||input===''?'':(Number.isFinite(n)?'$'+n.toFixed(2):clean(input));}
  function safeName(value){return clean(value).replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()||'student';}
  function wrap(font,text,size,maxWidth){
    const words=clean(text).split(/\s+/).filter(Boolean),lines=[];let line='';
    words.forEach(word=>{const next=line?line+' '+word:word;if(font.widthOfTextAtSize(next,size)<=maxWidth)line=next;else{if(line)lines.push(line);line=word;}});
    if(line)lines.push(line);return lines;
  }
  async function build(data){
    if(!window.PDFLib)throw new Error('PDF tools are still loading. Try again in a moment.');
    const {PDFDocument,StandardFonts,rgb}=window.PDFLib;
    const doc=await PDFDocument.create(),page=doc.addPage([W,H]);
    const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
    const black=rgb(0.05,0.05,0.05),grey=rgb(.25,.25,.25);
    const y=top=>H-top;
    const text=(str,x,top,size=9,font=regular,opts={})=>{if(!clean(str))return;page.drawText(clean(str),{x,y:y(top)-size,size,font,color:opts.color||black,maxWidth:opts.maxWidth});};
    const centered=(str,top,size,font=bold)=>{const width=font.widthOfTextAtSize(str,size);text(str,(W-width)/2,top,size,font);};
    const line=(x1,top1,x2,top2,width=.7)=>page.drawLine({start:{x:x1,y:y(top1)},end:{x:x2,y:y(top2)},thickness:width,color:black});
    const section=(letter,title,top)=>{page.drawRectangle({x:31,y:y(top+22),width:22,height:22,borderColor:black,borderWidth:1});text(letter,38,top+4,11,bold);text(title,62,top+5,10,bold);line(31,top+27,552,top+27,1);};
    const field=(label,val,top,opts={})=>{
      const x=opts.x||38,labelWidth=opts.labelWidth||205,end=opts.end||545,size=opts.size||9;
      text(label,x,top,8,bold);line(x+labelWidth,top+12,end,top+12,.55);
      const available=end-(x+labelWidth)-6;const lines=wrap(regular,val,size,available);
      if(lines[0])text(lines[0],x+labelWidth+4,top+1,size,regular,{maxWidth:available});
      return lines;
    };
    text('FORM 002',492,22,8,bold);
    centered('AFRICA MULTINATION FOR CHRIST COLLEGE',43,13,bold);
    centered('STUDENT REGISTRATION FORM',65,12,bold);
    text('Official one-page term enrolment record',188,84,7,regular,{color:grey});

    section('A','SECTION A — PERSONAL DETAILS',103);
    field('FULL NAME OF STUDENT',data.student_name,139,{labelWidth:169});
    text('(as it appears on B/C, ID or PP)',38,157,6.8,regular,{color:grey});
    field('GENDER',value(data,'student_answers','gender'),174,{labelWidth:92,end:280});
    field('MARITAL STATUS',value(data,'student_answers','marital_status'),174,{x:300,labelWidth:108,end:545});
    field('IF MARRIED, WHERE IS YOUR SPOUSE',value(data,'student_answers','spouse_location'),202,{labelWidth:226});
    field('ID NO. / PASSPORT NO.',value(data,'student_answers','identity_number'),230,{labelWidth:150});
    field('STUDENT REGISTRATION NUMBER',data.registration_number,258,{labelWidth:208});

    section('B','SECTION B — SCHOOL FEES DETAILS',295);
    field('ARREARS FROM PREVIOUS TERM(S)',money(value(data,'fees_answers','arrears_previous_terms')),332,{labelWidth:215});
    field('AMOUNT PAID FOR THE CURRENT TERM',money(value(data,'fees_answers','amount_paid_current_term')),360,{labelWidth:238});
    field('OUTSTANDING BALANCE',money(value(data,'fees_answers','outstanding_balance')),388,{labelWidth:160});
    field('PAYMENT PLAN',value(data,'fees_answers','payment_plan'),416,{labelWidth:110});
    field('SPONSOR NAME',value(data,'student_answers','sponsor_name'),444,{labelWidth:118});
    field('SPONSOR CONTACT',value(data,'student_answers','sponsor_contact'),472,{labelWidth:128});
    field('CERTIFIED BY',value(data,'fees_answers','fees_certified_by'),500,{labelWidth:105});

    section('C','SECTION C — ACCOMMODATION',537);
    field('HOSTEL TO WHICH ALLOCATED',value(data,'accommodation_answers','accommodation_hostel')||value(data,'student_answers','accommodation_hostel'),574,{labelWidth:196});
    field('ROOM NUMBER',value(data,'accommodation_answers','accommodation_room')||value(data,'student_answers','accommodation_room'),602,{labelWidth:110});
    field('TYPE OF ACCOMMODATION',value(data,'accommodation_answers','accommodation_type')||value(data,'student_answers','accommodation_type'),630,{labelWidth:183});
    text('(delete the inappropriate: Shared / Married)',38,648,6.8,regular,{color:grey});
    field('IF SHARED, NUMBER OF OCCUPANTS IN ROOM',value(data,'accommodation_answers','shared_occupants')||value(data,'student_answers','shared_occupants'),665,{labelWidth:272});
    field('CERTIFIED BY',value(data,'accommodation_answers','accommodation_certified_by'),693,{labelWidth:105});

    line(31,732,552,732,1);
    field('OFFICIAL DATE OF ARRIVAL',value(data,'admin_answers','official_date_of_arrival'),745,{labelWidth:177,end:345});
    field('TERM',data.term_name,745,{x:365,labelWidth:43,end:545});
    field("PRINCIPAL'S SIGNATURE",value(data,'final_answers','principal_signature'),779,{labelWidth:165});
    text('Generated from the AMFCC term enrolment record',31,817,6.5,regular,{color:grey});
    text(new Date().toLocaleDateString('en-ZW'),500,817,6.5,regular,{color:grey});
    const bytes=await doc.save();
    return {bytes,filename:'AMFCC-'+safeName(data.student_name)+'-'+safeName(data.term_name)+'-enrolment.pdf'};
  }
  function download(result){const blob=new Blob([result.bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=result.filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  window.AMFCCRegistrationPDF={build,download};
})();
