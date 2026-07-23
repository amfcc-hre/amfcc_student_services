window.AMFCC = (() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));
  const normalizeReg = value => String(value ?? '').replace(/\D/g,'').slice(0,5);
  const localDate = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_CONFIG.TIMEZONE, year:'numeric', month:'2-digit', day:'2-digit'
  }).format(new Date());
  const formatDateTime = value => value ? new Intl.DateTimeFormat('en-ZW', {
    timeZone: APP_CONFIG.TIMEZONE, dateStyle:'medium', timeStyle:'short'
  }).format(new Date(value)) : 'Not recorded';
  const formatDate = value => value ? new Intl.DateTimeFormat('en-ZW', {
    timeZone: APP_CONFIG.TIMEZONE, dateStyle:'medium'
  }).format(new Date(value)) : '';
  const toIso = localValue => localValue ? new Date(localValue).toISOString() : null;
  const setOnlineBadge = id => {
    const el=$(id); if(!el) return;
    el.textContent=navigator.onLine?'● Online':'● Offline';
    el.className='status-badge '+(navigator.onLine?'online':'offline');
  };
  const downloadCsv = (rows, filename) => {
    if (!Array.isArray(rows) || !rows.length) throw new Error('There are no rows to export.');
    const headers=[...new Set(rows.flatMap(row=>Object.keys(row)))];
    const quote=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
    const csv=[headers.map(quote).join(','),...rows.map(row=>headers.map(h=>quote(row[h])).join(','))].join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a'); link.href=url; link.download=filename; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const registerSW = () => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(console.warn);
  };
  return {$,esc,normalizeReg,localDate,formatDateTime,formatDate,toIso,setOnlineBadge,downloadCsv,registerSW};
})();
