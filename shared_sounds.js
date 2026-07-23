window.AMFCCSounds = (() => {
  let ctx=null;
  const ensure=()=>{ if(!ctx) ctx=new (window.AudioContext||window.webkitAudioContext)(); if(ctx.state==='suspended') ctx.resume(); return ctx; };
  const tone=(frequency,start,duration,volume=.12,type='sine')=>{
    const c=ensure(),osc=c.createOscillator(),gain=c.createGain();
    osc.frequency.value=frequency; osc.type=type;
    gain.gain.setValueAtTime(volume,c.currentTime+start);
    gain.gain.exponentialRampToValueAtTime(.001,c.currentTime+start+duration);
    osc.connect(gain).connect(c.destination); osc.start(c.currentTime+start); osc.stop(c.currentTime+start+duration);
  };
  return {
    unlock:ensure,
    checkIn:()=>{tone(660,0,.12);tone(880,.15,.18)},
    checkOut:()=>{tone(740,0,.12);tone(520,.15,.18)},
    warning:()=>{tone(440,0,.13);tone(440,.18,.13)},
    error:()=>tone(190,0,.35,.16,'square'),
    modeIn:()=>{tone(520,0,.1);tone(700,.12,.12)},
    modeOut:()=>{tone(700,0,.1);tone(520,.12,.12)},
    duty:()=>{tone(520,0,.1);tone(520,.14,.1);tone(780,.28,.16)}
  };
})();
