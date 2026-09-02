const CACHE='amfcc-student-services-v22-meal-checkin-collection';
const CORE=[
  './','./index.html','./manifest.webmanifest','./assets_icon.png',
  './shared_ui.css','./shared_config.js','./shared_supabase.js','./shared_utils.js',
  './shared_scanner.js','./shared_sounds.js',
  './meal_checkin_index.html','./meal_checkin.css','./meal_checkin.js',
  './meal_index.html','./meal_meal.css','./meal_meal.js',
  './library_index.html','./library_student.css','./library_student.js',
  './gate_index.html','./gate_gate.css','./gate_gate.js',
  './passes_index.html','./passes_passes.css','./passes_passes.js',
  './duties_index.html','./duties_duties.css','./duties_duties.js'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>Promise.all(CORE.map(url=>cache.add(new Request(url,{cache:'reload'})).catch(()=>null)))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(fetch(event.request,{cache:'no-store'}).then(response=>{
    if(response&&response.ok&&response.type!=='opaque'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
    return response;
  }).catch(()=>caches.match(event.request)));
});
