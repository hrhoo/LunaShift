import {icon} from './icons.js';
import {timelinePlotBounds} from './charts.js';
const eventHour=label=>{
 const raw=label.dataset.hour??label.dataset.replayHour;
 return raw===''||raw===undefined?null:Number(raw);
};
const timeLabel=hour=>{const minutes=Math.round(hour*60);return minutes<60?`${minutes} min`:`${Math.floor(minutes/60)}h${minutes%60?' '+minutes%60+'m':''}`;};

/** @param {HTMLElement | null} [controlsHost] Optional header container for the time-range selector. */
export function attachMissionEvents(range, host, result, plotCanvas, onSelect, controlsHost = null) {
 const m = result.metrics;
 const events = [
  ['landing', 'pin', 'Landed', 0],
  ['ready', 'battery', 'Energy ready', m.readyHour],
  ['science', 'flask', 'Measurement', m.scienceStartHour],
  ['data', 'data', 'Data created', m.scienceEndHour],
  ['transmit', 'antenna', 'Sending begins', m.firstTxHour],
  ['complete', 'check', 'Result returned', m.completeHour],
 ];
 host.replaceChildren();
 for (const [key, symbol, title, hour] of events) {
  const button = document.createElement('button');
  button.dataset.event = key;
  button.dataset.hour = hour ?? '';
  button.disabled = hour == null;
  button.innerHTML = `<span>${icon(symbol)}</span><span><small>${title}</small><b>Not reached</b></span>`;
  button.onclick = () => onSelect(hour, key);
  host.append(button);
 }
 attachEventLabels(range, host, result.settings.durationHours, {plotCanvas, controlsHost});
 return () => {
  host._eventLayout.disconnect();
  controlsHost?.replaceChildren();
 };
}

// Labels may move to avoid collisions; their track markers always keep true time.
export function attachEventLabels(range,host,duration,{plotCanvas,controlsHost}={}){
 host._eventLayout?.disconnect();
 let wrapper=range.closest('.event-timeline');
 if(!wrapper){wrapper=document.createElement('div');wrapper.className='event-timeline';range.before(wrapper);wrapper.append(range,host);}
 wrapper.previousElementSibling?.classList.contains('event-scale-controls')&&wrapper.previousElementSibling.remove();
 wrapper.querySelector('.event-axis-ticks')?.remove();
 host.classList.add('event-callouts');
 const labels=[...host.querySelectorAll('button')];
 labels.forEach(label=>{
  label.className='event-callout';label.type='button';
  const hour=eventHour(label);if(hour!==null&&Number.isFinite(hour))label.querySelector('b').textContent=`T + ${timeLabel(hour)}`;
  const icon=label.querySelector('.icon');
  if(icon?.parentElement===label){const circle=document.createElement('span');circle.className='event-symbol';icon.before(circle);circle.append(icon);}
  else if(icon)icon.parentElement.classList.add('event-symbol');
 });
 const hours=labels.map(eventHour).filter(h=>h!==null&&Number.isFinite(h)&&h>=0&&h<=duration);
 const latest=Math.max(0,...hours),focus=latest>0?Math.min(duration,Math.ceil((latest+Math.max(latest*.08,1/6))*12)/12):duration;
 const controls=document.createElement('div');controls.className='event-scale-controls';
 const description=document.createElement('span');description.textContent='EVENT START TIMES';
 const select=document.createElement('select');select.setAttribute('aria-label','Timeline time range');
 select.add(new Option(`Mission events · ${timeLabel(focus)}`,'events'));
 select.add(new Option(`Full mission · ${timeLabel(duration)}`,'full'));
 controls.append(description,select);
 if(controlsHost)controlsHost.replaceChildren(controls);
 else wrapper.before(controls);
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.classList.add('event-leaders');svg.setAttribute('aria-hidden','true');host.prepend(svg);
 const ticks=document.createElement('div');ticks.className='event-axis-ticks';wrapper.append(ticks);
 let currentHour=Number(range.value),full=currentHour>focus;
 const layout=()=>{
  if(plotCanvas){
   const plotWidth=plotCanvas.clientWidth;
   if(!plotWidth)return;
   const {left,right}=timelinePlotBounds(plotWidth);
   // The chart uses unzoomed pixels. Convert its bounds to the slider's local units.
   const zoom=Number(getComputedStyle(wrapper).zoom)||1;
   wrapper.style.marginLeft=`${left/zoom-11}px`;wrapper.style.width=`${(right-left)/zoom+22}px`;
  }
  const width=wrapper.clientWidth;if(!width)return;
  const span=full?duration:focus;range.max=span;select.value=full?'full':'events';
  const gap=14,columns=Math.max(1,Math.floor(width/140)),cardWidth=Math.min(138,(width-gap*(columns-1))/columns);
  const sides=[labels.filter((_,i)=>i%2===0),labels.filter((_,i)=>i%2===1)];
  const topRows=Math.ceil(sides[0].length/columns),bottomRows=Math.ceil(sides[1].length/columns),rail=topRows*110+14,height=rail+44+bottomRows*110;
  wrapper.style.height=`${height+30}px`;range.style.top=`${rail-14}px`;
  host.style.height=`${height}px`;svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.replaceChildren();
  host._eventNodes=[];
  sides.forEach((side,below)=>{
   for(let start=0;start<side.length;start+=columns){
    const batch=side.slice(start,start+columns),lane=Math.floor(start/columns);
    const positions=batch.map(label=>{const hour=eventHour(label);return Math.max(0,Math.min(width-cardWidth,(hour===null?width/2:11+(width-22)*hour/span)-cardWidth/2));});
    for(let i=1;i<positions.length;i++)positions[i]=Math.max(positions[i],positions[i-1]+cardWidth+gap);
    positions[positions.length-1]=Math.min(width-cardWidth,positions.at(-1));
    for(let i=positions.length-2;i>=0;i--)positions[i]=Math.min(positions[i],positions[i+1]-cardWidth-gap);
    batch.forEach((label,i)=>{
     const left=positions[i],top=below?rail+44+lane*110:(topRows-1-lane)*110;
     label.style.cssText=`left:${left}px;top:${top}px;width:${cardWidth}px`;
     const hour=eventHour(label);if(hour===null||!Number.isFinite(hour)||hour<0||hour>span)return;
     const x=11+(width-22)*hour/span,end=left+cardWidth/2,edge=below?top-5:top+94,elbow=below?rail+24+lane*8:rail-24-lane*8;
     const group=document.createElementNS(svg.namespaceURI,'g'),path=document.createElementNS(svg.namespaceURI,'path'),dot=document.createElementNS(svg.namespaceURI,'circle');
     path.setAttribute('d',`M ${x} ${rail} L ${x} ${elbow} L ${end} ${elbow} L ${end} ${edge}`);
     dot.setAttribute('cx',x);dot.setAttribute('cy',rail);dot.setAttribute('r',3);
     group.append(path,dot);svg.append(group);host._eventNodes.push({label,group,hour});
     label.onmouseenter=()=>group.classList.add('highlighted');label.onmouseleave=()=>group.classList.remove('highlighted');
     label.onfocus=()=>group.classList.add('highlighted');label.onblur=()=>group.classList.remove('highlighted');
    });
   }
  });
  ticks.style.top=`${height}px`;ticks.replaceChildren();
  for(let i=0;i<=4;i++){const tick=document.createElement('span');tick.textContent=i===0?'T + 0':timeLabel(span*i/4);tick.style.left=`${11+(width-22)*i/4}px`;ticks.append(tick);}
  syncEventLabels(host,currentHour);
  range.dispatchEvent(new Event('timeline-range-change'));
 };
 host._eventSetHour=hour=>{currentHour=hour;if(hour>Number(range.max)+1e-8&&!full){full=true;layout();}};
 select.onchange=()=>{
  full=select.value==='full';
  if(!full&&currentHour>focus){currentHour=focus;range.max=focus;range.value=focus;range.dispatchEvent(new Event('input',{bubbles:true}));}
  layout();
 };
 host._eventLayout=new ResizeObserver(layout);host._eventLayout.observe(wrapper.parentElement);
 layout();
}

export function syncEventLabels(host,hour){
 host._eventSetHour?.(hour);
 for(const label of host.querySelectorAll('button')){
  const h=eventHour(label),reached=h!==null&&h<=hour+1e-8,selected=h!==null&&Math.abs(h-hour)<1e-6;
  label.classList.toggle('reached',reached);label.setAttribute('aria-pressed',String(selected));
 }
 for(const {group,hour:h}of host._eventNodes||[]){group.classList.toggle('reached',h<=hour+1e-8);group.classList.toggle('selected',Math.abs(h-hour)<1e-6);}
 const range=host.parentElement.querySelector('input[type=range]');
 if(range){range.value=hour;range.style.setProperty('--event-progress',`${Math.min(100,hour/Number(range.max)*100)}%`);}
}
