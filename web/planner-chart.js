/** Single shared mission chart with honest gaps when no station access exists. */
export function drawMissionChart(canvas,description,state){
 const rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height,d=Math.min(devicePixelRatio||1,2);if(w<5||h<5||!state.current)return;
 if(canvas.width!==Math.round(w*d)||canvas.height!==Math.round(h*d)){canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);}
 const c=canvas.getContext('2d');c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,w,h);c.fillStyle='#fff';c.fillRect(0,0,w,h);
 const current=state.current,records=[{r:current,color:'#397fc7',key:'A'},...(state.alternative?[{r:state.alternative,color:'#b78332',key:'B'}]:[])];
 const chart=state.chart,conf={battery:{field:'socPct',unit:'%',min:0,max:100},power:{field:'powerW',unit:'W'},energy:{field:'cumulativeEnergyKWh',unit:'kWh'},data:{field:'deliveredGB',unit:'GB'},link:{field:'maxRateMarginDb',unit:'dB'}}[chart]||{field:'socPct',unit:'%'};
 const vals=records.flatMap(({r})=>r.samples.filter(p=>chart!=='link'||p.linkAvailable).map(p=>p[conf.field])).filter(Number.isFinite);
 if(chart==='power')vals.push(...records.flatMap(({r})=>r.samples.map(p=>p.loadW)));
 let lo=conf.min??(chart==='link'?Math.min(0,...vals)-1:0),hi=conf.max??Math.max(chart==='data'?current.settings.dataTargetGB:1,...vals)*1.12;
 if(chart==='link')hi=Math.max(1,...vals)+1;if(!(hi>lo))hi=lo+1;
 const left=47,right=w-17,top=25,bottom=h-34,duration=current.settings.durationHours,x=t=>left+t/duration*(right-left),y=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
 const fmt=(v,d=0)=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:d}):'—';
 c.font='10px system-ui';c.textAlign='right';
 for(let i=0;i<5;i++){const v=lo+(hi-lo)*i/4,yy=y(v);c.strokeStyle='#e7edf3';c.lineWidth=1;c.beginPath();c.moveTo(left,yy);c.lineTo(right,yy);c.stroke();c.fillStyle='#8798aa';c.fillText(fmt(v,hi<4?1:0),left-9,yy+3);}
 c.fillStyle='#7c8fa2';c.textAlign='left';c.fillText(conf.unit,left,13);c.textAlign='center';
 for(let i=0;i<=4;i++)c.fillText(fmt(duration*i/4)+' h',x(duration*i/4),h-12);
 function line(r,key,color,dash=[]){c.strokeStyle=color;c.lineWidth=2;c.setLineDash(dash);c.beginPath();let active=false;for(const p of r.samples){const v=p[key];if(!Number.isFinite(v)||(chart==='link'&&!p.linkAvailable)){active=false;continue;}if(active)c.lineTo(x(p.elapsedHours),y(v));else{c.moveTo(x(p.elapsedHours),y(v));active=true;}}c.stroke();c.setLineDash([]);}
 for(const {r,color,key}of records)line(r,conf.field,color,key==='B'?[5,2]:[]);
 if(chart==='power')for(const {r,key}of records)line(r,'loadW',key==='A'?'#8d9cae':'#c5bba8',[3,5]);
 function threshold(v,text,color){if(v<lo||v>hi)return;c.strokeStyle=color;c.lineWidth=1;c.setLineDash([4,5]);c.beginPath();c.moveTo(left,y(v));c.lineTo(right,y(v));c.stroke();c.setLineDash([]);c.fillStyle=color;c.font='9px system-ui';c.textAlign='right';c.fillText(text,right-3,y(v)-5);}
 if(chart==='battery'){threshold(current.settings.reservePct,'Minimum reserve','#a9655c');threshold((current.settings.reservePct/100*current.settings.batteryKWh+current.settings.taskEnergyKWh)/(current.settings.batteryKWh||1)*100,'Task storage threshold','#8796aa');}
 if(chart==='data')threshold(current.settings.dataTargetGB,'Required data','#7d8fa0');
 if(chart==='energy')threshold(current.settings.taskEnergyKWh,'Task-energy amount (gross generation)','#7d8fa0');
 if(chart==='link')threshold(0,'Rate cap met at 0 dB margin','#8c9caa');
 if(!vals.length){c.textAlign='center';c.fillStyle='#8192a5';c.font='12px system-ui';c.fillText('No sampled station access in the selected mission',w/2,(top+bottom)/2);}
 c.strokeStyle='#294862';c.lineWidth=1;c.setLineDash([3,4]);c.beginPath();c.moveTo(x(state.clockMode==='mission'?state.hour:state.lastMissionHour),top);c.lineTo(x(state.clockMode==='mission'?state.hour:state.lastMissionHour),bottom);c.stroke();c.setLineDash([]);
 description.textContent={battery:'Initial energy counts toward storage readiness. The reserve must be maintained throughout the mission.',energy:'Cumulative generated electricity—not stored energy. Some generation is consumed, lost in storage, or curtailed.',power:'Electrical array output; muted dashed curves are demand including modeled radio electricity.',data:'Data actually delivered by the powered link. A contact window by itself does not guarantee transmission.',link:'Margin at the configured rate cap, after the selected fade allowance. Gaps mean no station access. Negative margin reduces the ideal adaptive rate.'}[chart]||'';
}
