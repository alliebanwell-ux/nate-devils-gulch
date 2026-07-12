
"use strict";

const FALLBACK_RACE = {"runner":"Nate","race":"Devil’s Gulch 100","start":"2026-07-11T05:00:00-07:00","latest":{"time":"2026-07-11T16:48:00-07:00","lat":47.418526,"lon":-120.522873,"gpxMile":41.46582813546316,"courseMileLabel":"41.5","section":"Sand Creek → Mission Creek #1","note":"Left Sand Creek at 4:18 PM; climbing toward Mission Creek #1"},"checkins":[{"time":"2026-07-11T08:11:00-07:00","lat":47.3163,"lon":-120.49665,"gpxMile":12.519292439571823,"snapMeters":4.65775464476558,"segmentMph":null},{"time":"2026-07-11T09:31:00-07:00","lat":47.29816,"lon":-120.51979,"gpxMile":17.279270032854164,"snapMeters":41.04026597823736,"segmentMph":3.569983194961756},{"time":"2026-07-11T10:28:00-07:00","lat":47.291796,"lon":-120.545533,"gpxMile":20.82504938562506,"snapMeters":7.083444899471145,"segmentMph":3.7323993187062072,"deviceSpeedMph":3.74,"elevationFt":5031.3},{"time":"2026-07-11T11:20:00-07:00","lat":47.326891,"lon":-120.524976,"gpxMile":23.767282360887947,"snapMeters":2.0585288305550535,"segmentMph":3.394884202226407,"deviceSpeedMph":2.49,"elevationFt":5680.77},{"time":"2026-07-11T11:46:00-07:00","lat":47.33493,"lon":-120.52923,"gpxMile":24.44129755167908,"snapMeters":38.29475268824026,"segmentMph":1.5554196710564647},{"time":"2026-07-11T12:20:00-07:00","lat":47.368938,"lon":-120.550468,"gpxMile":27.249589490531363,"snapMeters":7.936008301958956,"segmentMph":4.955809303856968,"deviceSpeedMph":5.0,"elevationFt":4717.49},{"time":"2026-07-11T12:50:00-07:00","lat":47.386211,"lon":-120.572096,"gpxMile":29.042825256336325,"snapMeters":16.376030035444334,"segmentMph":3.5864715316099236,"deviceSpeedMph":3.11,"elevationFt":4577.66},{"time":"2026-07-11T14:00:00-07:00","lat":47.37819,"lon":-120.54469,"gpxMile":33.01780621205272,"snapMeters":13.039115997239572,"segmentMph":3.407126533471194},{"time":"2026-07-11T14:13:00-07:00","lat":47.38686,"lon":-120.54832,"gpxMile":33.68770859689552,"snapMeters":17.632910250105663,"segmentMph":3.091857160812922},{"time":"2026-07-11T16:04:00-07:00","lat":47.432066,"lon":-120.528946,"gpxMile":39.68007388236888,"snapMeters":46.10310562008304,"segmentMph":3.2391163705261414,"deviceSpeedMph":0.0,"elevationFt":1722.77},{"time":"2026-07-11T16:28:00-07:00","lat":47.424363,"lon":-120.526456,"gpxMile":40.52123153200915,"snapMeters":7.019807639344453,"segmentMph":2.1028941241006827,"deviceSpeedMph":3.11,"elevationFt":2001.41},{"time":"2026-07-11T16:48:00-07:00","lat":47.418526,"lon":-120.522873,"gpxMile":41.46582813546316,"snapMeters":11.82084691063926,"segmentMph":2.8337898103620276,"deviceSpeedMph":2.49,"elevationFt":2481.1}],"crewBase":{"name":"Avid Hotel Wenatchee","city":"Wenatchee, WA"},"messageEmail":"natethegood13@gmail.com","lastUpdatedLabel":"Saturday 4:48 PM","finishCutoff":"2026-07-12T20:00:00-07:00"};

async function loadJSON(path, fallback){
  try{
    const res = await fetch(path + "?v=" + Date.now(), {cache:"no-store"});
    if(!res.ok) throw new Error(path+" "+res.status);
    return await res.json();
  }catch(err){
    console.warn("Using fallback for",path,err);
    return fallback;
  }
}

function addMinutes(base, mins){ return new Date(base.getTime()+mins*60000); }
function formatTime(d){
  let h=d.getHours(); const m=String(d.getMinutes()).padStart(2,"0");
  const ap=h>=12?"PM":"AM"; h=h%12||12;
  return `${h}:${m} ${ap}${d.getDate()===12?" Sun":""}`;
}
function formatWindow(lo,hi){
  let a=formatTime(lo), b=formatTime(hi);
  if(lo.getDate()===hi.getDate()) b=b.replace(" Sun","");
  return `${a}–${b}`;
}
function bufferText(mins){
  const n=Math.round(mins);
  if(n<0) return `${Math.abs(n)}m past`;
  const h=Math.floor(n/60),m=n%60;
  return h?`${h}h ${m}m`:`${m}m`;
}

function project(lat,lon,bounds,w,h,pad=70){
  const mean=(bounds.minLat+bounds.maxLat)/2;
  const xs=Math.cos(mean*Math.PI/180);
  const xr=(bounds.maxLon-bounds.minLon)*xs;
  const yr=bounds.maxLat-bounds.minLat;
  const scale=Math.min((w-2*pad)/xr,(h-2*pad)/yr);
  return {
    x:pad+(lon-bounds.minLon)*xs*scale,
    y:h-pad-(lat-bounds.minLat)*scale
  };
}

function svgEl(name,attrs={}){
  const el=document.createElementNS("http://www.w3.org/2000/svg",name);
  Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));
  return el;
}

function buildElevation(svg,currentMile){
  const legs=[[0,15,4300,3200],[15,25,1500,1500],[25,31,950,2400],[31,42,2000,4500],[42,47,1850,1750],[47,51,900,100],[51,53,950,350],[53,65,2800,2800],[65,67,350,950],[67,76,3200,950],[76,88,1700,4800],[88,92,900,100],[92,101,3200,940],[101,104,415,600]];
  const profile=[[0,1200]]; let e=1200;
  legs.forEach(([a,b,g,l])=>{ const mid=a+(b-a)*.48; profile.push([mid,e+g]); e=e+g-l; profile.push([b,e]); });
  const ys=profile.map(p=>p[1]), ymin=Math.min(...ys), ymax=Math.max(...ys);
  const W=1100,H=330,p=50;
  const X=m=>p+m/104*(W-2*p), Y=v=>H-p-(v-ymin)/(ymax-ymin)*(H-2*p);
  svg.innerHTML="";
  const defs=svgEl("defs"); const grad=svgEl("linearGradient",{id:"elevFill",x1:"0",y1:"0",x2:"0",y2:"1"});
  grad.append(svgEl("stop",{offset:"0%","stop-color":"#4a8466","stop-opacity":".55"}),svgEl("stop",{offset:"100%","stop-color":"#4a8466","stop-opacity":".06"})); defs.append(grad); svg.append(defs);
  const pts=profile.map(([m,v])=>`${X(m)},${Y(v)}`).join(" ");
  svg.append(svgEl("polygon",{points:`${p},${H-p} ${pts} ${W-p},${H-p}`,fill:"url(#elevFill)"}));
  svg.append(svgEl("polyline",{points:pts,fill:"none",stroke:"#285b43","stroke-width":"3"}));
  const mx=X(currentMile);
  svg.append(svgEl("line",{x1:mx,y1:p,x2:mx,y2:H-p,stroke:"#b85f37","stroke-width":"3","stroke-dasharray":"8 7"}));
  svg.append(svgEl("circle",{cx:mx,cy:150,r:7,fill:"#b85f37",stroke:"#fff","stroke-width":"3"}));
  const t=svgEl("text",{x:mx+10,y:28,fill:"#b85f37","font-weight":"900","font-size":"15"}); t.textContent=`Mile ${currentMile.toFixed(1)}`; svg.append(t);
}

function initMap(svg,course,race,state){
  const W=1120,H=760;
  svg.setAttribute("viewBox",`0 0 ${W} ${H}`);
  const bounds={
    minLat:Math.min(...course.route.map(p=>p.lat)),
    maxLat:Math.max(...course.route.map(p=>p.lat)),
    minLon:Math.min(...course.route.map(p=>p.lon)),
    maxLon:Math.max(...course.route.map(p=>p.lon))
  };
  const routeXY=course.route.map(p=>({...project(p.lat,p.lon,bounds,W,H),mile:p.mile}));
  const completed=routeXY.filter(p=>p.mile<=race.latest.gpxMile);
  const remaining=routeXY.filter(p=>p.mile>=race.latest.gpxMile);
  svg.innerHTML="";
  svg.append(svgEl("rect",{width:W,height:H,fill:"transparent"}));
  svg.append(svgEl("polyline",{points:routeXY.map(p=>`${p.x},${p.y}`).join(" "),fill:"none",stroke:"#76847c","stroke-width":"7","stroke-linecap":"round","stroke-linejoin":"round"}));
  svg.append(svgEl("polyline",{points:completed.map(p=>`${p.x},${p.y}`).join(" "),fill:"none",stroke:"#3f8f67","stroke-width":"10","stroke-linecap":"round","stroke-linejoin":"round"}));

  const labelOffsets=[[-130,-30],[-145,34],[-120,42],[18,-36],[18,-20],[18,0],[18,22],[18,44],[18,64],[-145,-10],[-140,12],[-135,38],[18,28],[18,48]];
  course.stations.forEach((s,i)=>{
    const p=project(s.lat,s.lon,bounds,W,H);
    const g=svgEl("g",{class:"station-node","data-index":i,tabindex:"0"});
    const color=s.status==="next"?"#c48b2c":s.status==="finish"?"#b85f37":s.status==="passed"?"#95a19a":"#15382b";
    g.append(svgEl("circle",{cx:p.x,cy:p.y,r:s.status==="next"?10:7,fill:color,stroke:"#fff","stroke-width":"3"}));
    const [dx,dy]=labelOffsets[i]||[14,14];
    const text=svgEl("text",{x:p.x+dx,y:p.y+dy,class:"station-label"}); text.textContent=`${i+1}. ${s.name}`; g.append(text);
    const mile=svgEl("text",{x:p.x+dx,y:p.y+dy+15,class:"station-mile"}); mile.textContent=`Mile ${s.courseMile}${s.cutoff!==null?" · cutoff":""}`; g.append(mile);
    g.addEventListener("click",()=>state.showStation(i));
    g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();state.showStation(i);}});
    svg.append(g);
  });

  const runner=project(race.latest.lat,race.latest.lon,bounds,W,H);
  svg.append(svgEl("circle",{cx:runner.x,cy:runner.y,r:22,fill:"none",stroke:"#3f8f67","stroke-width":"4",class:"runner-pulse"}));
  svg.append(svgEl("circle",{cx:runner.x,cy:runner.y,r:13,fill:"#3f8f67",stroke:"#fff","stroke-width":"5"}));

  const defaultBox={x:0,y:0,w:W,h:H};
  let box={...defaultBox},drag=false,last={x:0,y:0},touches=new Map(),pinchDistance=null;

  function apply(){svg.setAttribute("viewBox",`${box.x} ${box.y} ${box.w} ${box.h}`);}
  function clamp(){
    box.w=Math.max(360,Math.min(1500,box.w));
    box.h=box.w*H/W;
    box.x=Math.max(-250,Math.min(W-box.w+250,box.x));
    box.y=Math.max(-180,Math.min(H-box.h+180,box.y));
  }
  function zoom(f,cx=box.x+box.w/2,cy=box.y+box.h/2){
    const nw=box.w*f,nh=box.h*f;
    box.x=cx-(cx-box.x)*(nw/box.w); box.y=cy-(cy-box.y)*(nh/box.h); box.w=nw; box.h=nh; clamp(); apply();
  }
  state.zoomIn=()=>zoom(.82); state.zoomOut=()=>zoom(1.22);
  state.reset=()=>{box={...defaultBox};apply();};
  state.focusRunner=()=>{box={x:runner.x-250,y:runner.y-170,w:500,h:340};clamp();apply();};

  svg.addEventListener("pointerdown",e=>{touches.set(e.pointerId,{x:e.clientX,y:e.clientY}); if(touches.size===1){drag=true;last={x:e.clientX,y:e.clientY};} svg.setPointerCapture?.(e.pointerId);});
  svg.addEventListener("pointermove",e=>{
    if(!touches.has(e.pointerId)) return;
    touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const rect=svg.getBoundingClientRect();
    if(touches.size===2){
      const arr=[...touches.values()]; const d=Math.hypot(arr[0].x-arr[1].x,arr[0].y-arr[1].y);
      if(pinchDistance){zoom(pinchDistance/d);}
      pinchDistance=d; drag=false;
    }else if(drag){
      box.x-=(e.clientX-last.x)*box.w/rect.width; box.y-=(e.clientY-last.y)*box.h/rect.height;
      last={x:e.clientX,y:e.clientY}; clamp(); apply();
    }
  });
  function end(e){touches.delete(e.pointerId); if(touches.size<2)pinchDistance=null; if(touches.size===0)drag=false;}
  svg.addEventListener("pointerup",end); svg.addEventListener("pointercancel",end);
  svg.addEventListener("wheel",e=>{e.preventDefault();zoom(e.deltaY>0?1.12:.89);},{passive:false});
}

async function main(){
  const fallbackCourse = await loadJSON("course.json",{totalGpxMiles:100.7,route:[],stations:[]});
  const race = await loadJSON("race.json",FALLBACK_RACE);
  const course = fallbackCourse;

  const latestTime = new Date(race.latest.time);
  const pct=Math.round(race.latest.gpxMile/course.totalGpxMiles*100);
  document.getElementById("runnerName").textContent=race.runner;
  document.getElementById("currentMile").textContent=race.latest.courseMileLabel;
  document.getElementById("lastUpdated").textContent=race.lastUpdatedLabel;
  document.getElementById("currentSection").textContent=race.latest.section;
  document.getElementById("currentNote").textContent=race.latest.note;
  document.getElementById("progressPercent").textContent=pct;
  document.getElementById("progressMiles").textContent=race.latest.gpxMile.toFixed(1);
  document.getElementById("totalMiles").textContent=course.totalGpxMiles.toFixed(1);
  document.getElementById("progressFill").style.width=`${pct}%`;
  document.getElementById("glancePing").textContent=latestTime.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
  document.getElementById("glanceMile").textContent=race.latest.courseMileLabel;

  const nextStation=course.stations.find(s=>s.status==="next");
  const pop=document.getElementById("mapPopover");
  const state={
    showStation(i){
      const s=course.stations[i];
      const factor=1+Number(document.getElementById("paceSlider").value)/100;
      const baseLo=(new Date(s.etaLo)-latestTime)/60000;
      const baseHi=(new Date(s.etaHi)-latestTime)/60000;
      const lo=s.status==="passed"?baseLo:baseLo/factor;
      const hi=s.status==="passed"?baseHi:baseHi/factor;
      let html=`<strong>${s.name}</strong><span>Course mile ${s.courseMile}</span><span>ETA: ${formatWindow(addMinutes(latestTime,lo),addMinutes(latestTime,hi))}</span>`;
      if(s.cutoff!==null){
        const cutoffDate=new Date(s.cutoff);
        const gapMinutes=(cutoffDate-addMinutes(latestTime,hi))/60000;
        html+=`<span>Cutoff: ${formatTime(cutoffDate)}</span><span>Buffer: ${bufferText(gapMinutes)}</span>`;
      }
      pop.innerHTML=html;
    }
  };

  function renderPace(){
    const slider=document.getElementById("paceSlider"),pct=Number(slider.value),factor=1+pct/100;
    document.getElementById("scenarioLabel").textContent=pct===0?"Baseline":`${pct>0?"+":""}${pct}% ${pct>0?"faster":"slower"}`;
    const projected=course.stations.map(s=>{
      const baseLo=(new Date(s.etaLo)-latestTime)/60000;
      const baseHi=(new Date(s.etaHi)-latestTime)/60000;
      return {...s,lo:s.status==="passed"?baseLo:baseLo/factor,hi:s.status==="passed"?baseHi:baseHi/factor};
    });
    const next=projected.find(s=>s.status==="next"),finish=projected[projected.length-1];
    const nextText=formatWindow(addMinutes(latestTime,next.lo),addMinutes(latestTime,next.hi));
    document.getElementById("nextStationName").textContent=next.name;
    document.getElementById("nextStationEta").textContent=nextText;
    document.getElementById("nextStationMeta").textContent=`Course mile ${next.courseMile}`;
    document.getElementById("glanceNext").textContent=nextText.replace(/ AM| PM/g,"");
    document.getElementById("heroFinish").textContent=formatWindow(addMinutes(latestTime,finish.lo),addMinutes(latestTime,finish.hi));

    document.getElementById("stationCards").innerHTML=projected.filter(s=>s.status!=="passed").slice(0,3).map((s,i)=>`
      <article class="station-card ${i===0?"next":""}">
        <span>${i===0?"Next":"Upcoming"} · mile ${s.courseMile}</span>
        <strong>${s.name}</strong>
        <div>${formatWindow(addMinutes(latestTime,s.lo),addMinutes(latestTime,s.hi))}</div>
      </article>`).join("");

    document.getElementById("projectionTable").innerHTML=projected.map(s=>{
      const adjustedHi=addMinutes(latestTime,s.hi);
      const cutoffDate=s.cutoff===null?null:new Date(s.cutoff);
      const cutoff=cutoffDate===null?"—":formatTime(cutoffDate);
      const gap=cutoffDate===null?null:(cutoffDate-adjustedHi)/60000;
      const cls=s.status==="passed"?"passed":s.status==="next"?"next":"";
      const buffer=gap===null?"—":bufferText(gap);
      const bcls=gap===null?"":gap<0?"buffer-danger":gap<120?"buffer-watch":"buffer-good";
      return `<tr class="${cls}"><td><strong>${s.name}</strong></td><td>${s.courseMile}</td><td>${formatWindow(addMinutes(latestTime,s.lo),adjustedHi)}</td><td>${cutoff}</td><td class="${bcls}">${buffer}</td></tr>`;
    }).join("");
  }

  document.getElementById("paceSlider").addEventListener("input",renderPace);
  renderPace();

  buildElevation(document.getElementById("elevationChart"),race.latest.gpxMile);
  initMap(document.getElementById("courseMap"),course,race,state);
  document.getElementById("zoomIn").onclick=()=>state.zoomIn();
  document.getElementById("zoomOut").onclick=()=>state.zoomOut();
  document.getElementById("focusRunner").onclick=()=>state.focusRunner();
  document.getElementById("resetMap").onclick=()=>state.reset();


  const crewAccessible=course.stations.filter(s=>s.crew==="Crew accessible" || s.crew==="Accessible, not recommended");
  const crewUpcoming=crewAccessible.filter(s=>s.status!=="passed");
  document.getElementById("crewStops").innerHTML=crewAccessible.map((s,i)=>{
    const lo=new Date(s.etaLo),hi=new Date(s.etaHi);
    const status=s.status==="passed"?"Passed":(crewUpcoming[0]&&crewUpcoming[0].name===s.name?"Next crew stop":"Upcoming");
    return `<article class="crew-stop ${status==="Next crew stop"?"next-crew":""}">
      <span>${status} · course mile ${s.courseMile}</span>
      <strong>${s.name}</strong>
      <div>${formatWindow(lo,hi)}</div>
      <span>${s.crew}</span>
      <span>${s.driveNote||""}</span>
    </article>`;
  }).join("");

  const checkins=race.checkins||[];
  document.getElementById("checkinCards").innerHTML=checkins.slice(-4).reverse().map(c=>{
    const t=new Date(c.time);
    const mph=c.segmentMph==null?"First point":`${c.segmentMph.toFixed(2)} mph since prior pin`;
    return `<article class="checkin-card">
      <span>${formatTime(t)} · GPX mile ${c.gpxMile.toFixed(2)}</span>
      <strong>${mph}</strong>
      <span>${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}</span>
    </article>`;
  }).join("");

  const email=race.messageEmail||"";
  const subject=encodeURIComponent(`Message for ${race.runner} after Devil's Gulch`);
  const body=encodeURIComponent(`Hey ${race.runner},\n\nWe were following along and wanted to say:\n\n`);
  document.getElementById("messageButton").href=`mailto:${email}?subject=${subject}&body=${body}`;
}

main().catch(err=>{
  console.error(err);
  document.body.insertAdjacentHTML("beforeend",`<div style="padding:16px;color:#a33e31">Tracker data failed to load. Refresh the page.</div>`);
});

// Reload periodically so an open tracker picks up newly committed Garmin points.
const AUTO_REFRESH_MS = 2 * 60 * 1000;
window.setTimeout(() => window.location.reload(), AUTO_REFRESH_MS);
