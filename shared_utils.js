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

  /* Register from every page, not only the public home page. */
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
