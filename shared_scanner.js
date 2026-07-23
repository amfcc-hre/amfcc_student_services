window.AMFCCScanner = (() => {
  let stream=null,active=false,frameId=null,detector=null;
  async function start({video,overlay,onResult,onError}){
    if(!navigator.mediaDevices?.getUserMedia){onError?.('Camera access is unavailable in this browser.');return;}
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      video.srcObject=stream; await video.play(); overlay.classList.add('open'); active=true;
      if('BarcodeDetector' in window) detector=new BarcodeDetector({formats:['qr_code','code_128','ean_13','ean_8']});
      loop(video,onResult,onError);
    }catch(error){onError?.('Allow camera access in browser settings.');}
  }
  async function loop(video,onResult,onError){
    if(!active)return;
    try{
      if(video.readyState>=2){
        if(detector){const codes=await detector.detect(video);if(codes[0]?.rawValue){stop();onResult(codes[0].rawValue);return;}}
        else if(window.jsQR){
          const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
          canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx.drawImage(video,0,0);
          const image=ctx.getImageData(0,0,canvas.width,canvas.height);
          const result=jsQR(image.data,image.width,image.height);if(result?.data){stop();onResult(result.data);return;}
        }
      }
    }catch(error){console.warn(error);}
    frameId=requestAnimationFrame(()=>loop(video,onResult,onError));
  }
  function stop(){active=false;if(frameId)cancelAnimationFrame(frameId);frameId=null;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;document.querySelectorAll('.camera-overlay.open').forEach(el=>el.classList.remove('open'));}
  return {start,stop};
})();
