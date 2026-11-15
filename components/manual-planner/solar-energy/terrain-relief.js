/** Cartographic relief from the stored DEM, independent of mission sunlight.
 * Fixed northwest light at 45 degrees; contrast enhancement, no height scaling.
 */
export function prepareTerrainRelief(mesh) {
  if(!mesh||!Number.isInteger(mesh.width)||!Number.isInteger(mesh.height)||mesh.width<2||mesh.height<2||
    !Number.isFinite(mesh.spacing_m)||mesh.spacing_m<=0||!Number.isFinite(mesh.origin_x_m)||!Number.isFinite(mesh.origin_y_m)||
    !['south_to_north','north_to_south'].includes(mesh.row_order))return null;
  const {width,height,spacing_m:spacing}=mesh,sign=mesh.row_order==='south_to_north'?1:-1;
  if(!Array.isArray(mesh.elevations_m)||mesh.elevations_m.length!==height||mesh.elevations_m.some(row=>!Array.isArray(row)||row.length!==width))return null;
  const values=new Float32Array(width*height).fill(NaN);
  for(let r=0;r<height;r++)for(let c=0;c<width;c++){
    const loC=Math.max(0,c-1),hiC=Math.min(width-1,c+1),loR=Math.max(0,r-1),hiR=Math.min(height-1,r+1);
    const heights=[mesh.elevations_m[r][c],mesh.elevations_m[r][loC],mesh.elevations_m[r][hiC],mesh.elevations_m[loR][c],mesh.elevations_m[hiR][c]];
    if(heights.some(v=>!Number.isFinite(v)))continue;
    const dx=(heights[2]-heights[1])/((hiC-loC)*spacing),dy=(heights[4]-heights[3])/((hiR-loR)*spacing*sign);
    const illumination=(.5*dx-.5*dy+Math.SQRT1_2)/Math.hypot(dx,dy,1);
    values[r*width+c]=Math.max(0,Math.min(1,.5+2.2*(illumination-Math.SQRT1_2)));
  }
  return {width,height,spacing,originX:mesh.origin_x_m,originY:mesh.origin_y_m,sign,values};
}

export function sampleTerrainRelief(relief,east,north) {
  if(!relief)return null;
  const {width,height,spacing,originX,originY,sign,values}=relief;
  const x=(east-originX)/spacing,y=(north-originY)/(spacing*sign);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>width-1||y>height-1)return null;
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),fx=x-x0,fy=y-y0;
  const corners=[[x0,y0,(1-fx)*(1-fy)],[x1,y0,fx*(1-fy)],[x0,y1,(1-fx)*fy],[x1,y1,fx*fy]];
  let result=0;
  for(const [c,r,w]of corners){if(w===0)continue;const v=values[r*width+c];if(!Number.isFinite(v))return null;result+=v*w;}
  return result;
}

/** Hue carries energy; neutral relief changes brightness only for map reading. */
export function reliefColor(rgb,shade,terrainOnly=false) {
  if(shade===null)return terrainOnly?[224,226,229]:rgb;
  const gray=35+shade*210;
  if(terrainOnly)return [gray,gray,gray].map(Math.round);
  return rgb.map(v=>Math.round(Math.min(255,.72*v*(.55+.8*shade)+.28*gray)));
}
