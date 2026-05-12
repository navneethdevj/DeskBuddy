/**
 * IrisColor — custom iris & glow colour for DeskBuddy.
 *
 * FIX: Each picker (center / mid / edge / ring / highlight / pupilCore)
 * now affects ONLY its own visual zone. No bleed-over between zones.
 */
const IrisColor = (() => {
  const STOP_PCT = [0,4,8,13,19,26,34,43,53,63,73,82,89,94,98,100];
  const LDELTA   = [-30,-26,-22,-17,-12,-7,-3,0,3,7,11,15,18,21,23,25];
  const SMULT    = [1.28,1.22,1.16,1.10,1.06,1.02,1.0,0.98,0.95,0.91,0.87,0.83,0.80,0.77,0.74,0.71];
  const C_END=5, M_START=4, M_END=11, E_START=10, M_PEAK=7;
  const DEFAULT_HEX='#8795db';
  let _styleEl=null;

  function _clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
  function _sStep(t){t=_clamp(t,0,1);return t*t*t*(t*(t*6-15)+10);}
  function _normHex(hex){
    if(typeof hex!=='string')return'';
    const raw=hex.trim().replace(/^#/,'');
    if(!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw))return'';
    const full=raw.length===3?raw.split('').map(c=>c+c).join(''):raw;
    return'#'+full.toLowerCase();
  }
  function _hexToRgb(hex){
    const h=_normHex(hex).replace('#','');
    if(!h)return[0,0,0];
    return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
  }
  function _rgbToHex(r,g,b){
    return'#'+[r,g,b].map(v=>Math.round(_clamp(v,0,255)).toString(16).padStart(2,'0')).join('');
  }
  function _rgbToHsl(r,g,b){
    r/=255;g/=255;b/=255;
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h=0,s=0;
    const l=(mx+mn)/2;
    if(mx!==mn){const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);
      switch(mx){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;case b:h=((r-g)/d+4)/6;break;}}
    return[h*360,s*100,l*100];
  }
  function _hslToHex(h,s,l){
    h=((h%360)+360)%360;h/=360;s/=100;l/=100;let r,g,b;
    if(s===0){r=g=b=l;}else{
      const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
      const hue2rgb=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
      r=hue2rgb(p,q,h+1/3);g=hue2rgb(p,q,h);b=hue2rgb(p,q,h-1/3);}
    return'#'+[r,g,b].map(x=>Math.round(_clamp(x*255,0,255)).toString(16).padStart(2,'0')).join('');
  }
  function _mixHex(a,b,t){
    const te=_sStep(t),aa=_hexToRgb(a),bb=_hexToRgb(b);
    return _rgbToHex(aa[0]+(bb[0]-aa[0])*te,aa[1]+(bb[1]-aa[1])*te,aa[2]+(bb[2]-aa[2])*te);
  }
  function _toTriplet(hex,fallback){
    const n=_normHex(hex);const rgb=n?_hexToRgb(n):fallback;return`${rgb[0]},${rgb[1]},${rgb[2]}`;
  }
  function _buildBaseStops(h,sat,light){
    return STOP_PCT.map((_,i)=>{const s=_clamp(sat*SMULT[i],18,98);const l=_clamp(light+LDELTA[i],14,80);return _hslToHex(h,s,l);});
  }
  function _applyZones(base,centerHex,midHex,edgeHex){
    const stops=base.slice();
    if(centerHex){
      for(let i=0;i<C_END;i++){const t=i/C_END;stops[i]=_mixHex(centerHex,base[C_END],t);}
      stops[C_END]=_mixHex(centerHex,base[C_END],0.62);
    }
    if(edgeHex){
      const span=STOP_PCT.length-1-E_START;
      for(let i=E_START;i<STOP_PCT.length;i++){const t=(i-E_START)/span;stops[i]=_mixHex(base[E_START],edgeHex,t);}
      stops[E_START]=_mixHex(base[E_START],edgeHex,0.32);
    }
    if(midHex){
      for(let i=M_START;i<M_END;i++){
        let inf;if(i<=M_PEAK)inf=(i-M_START)/(M_PEAK-M_START);else inf=(M_END-1-i)/(M_END-1-M_PEAK);
        stops[i]=_mixHex(stops[i],midHex,_sStep(inf));
      }
    }
    return stops;
  }
  function _derivePalette(baseHex,overrides={}){
    const bn=_normHex(baseHex)||DEFAULT_HEX;
    const [r,g,b]=_hexToRgb(bn);const [h,s,l]=_rgbToHsl(r,g,b);
    const sat=_clamp(s,28,88),light=_clamp(l,30,58);
    const base=_buildBaseStops(h,sat,light);
    const cN=_normHex(overrides.centerHex||'');
    const mN=_normHex(overrides.midHex||'');
    const eN=_normHex(overrides.edgeHex||'');
    const stops=(cN||mN||eN)?_applyZones(base,cN,mN,eN):base;
    const ringHex=_normHex(overrides.ringHex||'');
    const ring=ringHex||stops[8];
    const shimmer=ringHex?_mixHex(ringHex,'#ffffff',0.28):stops[11];
    const hlHex=_normHex(overrides.highlightHex||'');
    const highlight=hlHex||stops[12];
    const pcHex=_normHex(overrides.pupilCoreHex||'');
    const pupilCore=pcHex||_hslToHex(h,42,14);
    const pupilSheen=_mixHex(highlight,'#ffffff',0.35);
    return{stops,center:stops[0],innerMid:stops[6],mid:stops[7],outerMid:stops[10],edge:stops[13],rim:stops[14],ring,shimmer,highlight,pupilCore,pupilSheen};
  }
  function _buildIrisGradient(stops){
    return`radial-gradient(\n          circle at calc(50% + var(--gaze-x,0%)) calc(50% + var(--gaze-y,0%)),\n${stops.map((c,i)=>`          ${c} ${STOP_PCT[i]}%`).join(',\n')}\n        )`;
  }
  function _buildBg(p){
    const hl=_hexToRgb(p.highlight),sh=_hexToRgb(p.shimmer),rn=_hexToRgb(p.ring),rim=_hexToRgb(p.rim);
    return`radial-gradient(circle at 32% 28%,rgba(${hl},0.80) 0%,rgba(${hl},0.40) 12%,rgba(${hl},0.14) 24%,rgba(${hl},0.00) 46%),radial-gradient(circle at 70% 76%,rgba(${sh},0.22) 0%,rgba(${sh},0.09) 24%,rgba(${sh},0.00) 54%),radial-gradient(circle at 50% 50%,rgba(${rn},0.00) 28%,rgba(${rn},0.18) 46%,rgba(${rn},0.28) 57%,rgba(${rn},0.00) 76%),${_buildIrisGradient(p.stops)},radial-gradient(circle at 50% 50%,rgba(12,16,32,0.00) 62%,rgba(${rim},0.09) 84%,rgba(10,12,26,0.16) 100%)`.replace(/rgba\((\d+),(\d+),(\d+)/g,(_,r,g,b)=>`rgba(${r}, ${g}, ${b}`);
  }
  function _getStyleEl(){if(!_styleEl){_styleEl=document.createElement('style');_styleEl.id='iris-color-dynamic';document.head.appendChild(_styleEl);}return _styleEl;}

  function applyIris(hex){applyIrisProfile({baseHex:hex});}

  function applyIrisProfile(profile={}){
    const base=_normHex(profile.baseHex||'');
    const hasOverride=!!(_normHex(profile.centerHex||'')||_normHex(profile.midHex||'')||_normHex(profile.edgeHex||'')||_normHex(profile.ringHex||'')||_normHex(profile.highlightHex||'')||_normHex(profile.pupilCoreHex||''));
    if(!base&&!hasOverride){clearIris();return;}
    const p=_derivePalette(base||DEFAULT_HEX,profile);
    _getStyleEl().textContent=`body.eye-custom .pupil{background:${_buildBg(p)} !important;filter:none !important;transition:background 0.3s ease !important;}`;
    const bs=document.body.style;
    bs.setProperty('--iris-color-center',p.center);
    bs.setProperty('--iris-color-inner-mid',p.innerMid);
    bs.setProperty('--iris-color-mid',p.mid);
    bs.setProperty('--iris-color-outer-mid',p.outerMid);
    bs.setProperty('--iris-color-edge',p.edge);
    bs.setProperty('--iris-custom-ring-rgb',_toTriplet(p.ring,[195,206,255]));
    bs.setProperty('--iris-custom-shimmer-rgb',_toTriplet(p.shimmer,[200,212,255]));
    bs.setProperty('--iris-custom-highlight-rgb',_toTriplet(p.highlight,[255,255,255]));
    bs.setProperty('--iris-custom-pupil-core',_normHex(p.pupilCore)||'#111a34');
    bs.setProperty('--iris-custom-pupil-sheen-rgb',_toTriplet(p.pupilSheen,[165,188,255]));
    document.body.classList.add('eye-custom');
  }
  function clearIris(){
    if(_styleEl)_styleEl.textContent='';
    document.body.classList.remove('eye-custom');
    ['--iris-color-center','--iris-color-inner-mid','--iris-color-mid','--iris-color-outer-mid','--iris-color-edge','--iris-custom-ring-rgb','--iris-custom-shimmer-rgb','--iris-custom-highlight-rgb','--iris-custom-pupil-core','--iris-custom-pupil-sheen-rgb'].forEach(v=>document.body.style.removeProperty(v));
  }
  function applyGlow(hex){
    const n=_normHex(hex);if(!n){clearGlow();return;}
    const [r,g,b]=_hexToRgb(n);const t=`${r}, ${g}, ${b}`;
    document.body.style.setProperty('--eye-glow-rgb',t);document.body.style.setProperty('--user-glow-rgb',t);document.body.classList.add('glow-custom');
  }
  function clearGlow(){document.body.classList.remove('glow-custom');document.body.style.removeProperty('--eye-glow-rgb');document.body.style.removeProperty('--user-glow-rgb');}
  function setEmotionSync(enabled){document.body.classList.toggle('glow-emotion-lock',!!enabled);}
  function getCurrentIrisHex(){return document.body.style.getPropertyValue('--iris-color-mid').trim()||'';}
  function getCustomGlowHex(){
    const t=document.body.style.getPropertyValue('--eye-glow-rgb').trim();if(!t)return'';
    const pts=t.split(',').map(s=>parseInt(s.trim(),10));if(pts.length!==3||pts.some(isNaN))return'';
    return'#'+pts.map(x=>_clamp(x,0,255).toString(16).padStart(2,'0')).join('');
  }
  function getIrisProfile(){
    const bs=document.body.style;
    return{baseHex:bs.getPropertyValue('--iris-color-mid').trim()||'',centerHex:bs.getPropertyValue('--iris-color-center').trim()||'',edgeHex:bs.getPropertyValue('--iris-color-edge').trim()||'',pupilCoreHex:bs.getPropertyValue('--iris-custom-pupil-core').trim()||''};
  }
  return{applyIris,applyIrisProfile,clearIris,applyGlow,clearGlow,setEmotionSync,hexToRgb:_hexToRgb,getCurrentIrisHex,getCustomGlowHex,getIrisProfile};
})();
