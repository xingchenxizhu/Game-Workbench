// Deterministic code fixtures for pipeline validation; these are not production art.
import { encodePng } from '../modules/material/lib/png.js';
export function rigFixtures(){
  const width=320,height=480,source=Buffer.alloc(width*height*4);
  const specs=[['head',128,48,64,72],['torso',112,120,96,150],['left-upper-leg',116,270,36,104],['right-upper-leg',168,270,36,104],['left-foot',108,374,52,30],['right-foot',164,374,52,30]];
  const parts=specs.map(([name,x,y,w,h],index)=>{
    const rgba=Buffer.alloc(w*h*4);
    for(let py=0;py<h;py++)for(let px=0;px<w;px++){
      const i=(py*w+px)*4,p=((y+py)*width+x+px)*4;
      const color=[60+index*22+(px*5+py*3)%28,95+index*10+(px*3+py*7)%34,170-index*16,255];
      for(let c=0;c<4;c++){rgba[i+c]=color[c];source[p+c]=color[c];}
    }
    return {name,x,y,width:w,height:h,png:encodePng(rgba,w,h)};
  });
  const sheet=Buffer.alloc(400*400*4,255);
  for(let row=0;row<2;row++)for(let col=0;col<2;col++)for(let y=40;y<130;y++)for(let x=50;x<140;x++){
    const i=(((row*200)+y)*400+col*200+x)*4;sheet[i]=40+col*60;sheet[i+1]=100+row*50;sheet[i+2]=150;
  }
  return {source:encodePng(source,width,height),parts,sheet:encodePng(sheet,400,400)};
}
export function tileFixture(){
  const size=512,rgba=Buffer.alloc(size*size*4,254);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4;rgba[i+3]=255;
    if(Math.abs(x-256)/220+Math.abs(y-256)/110<=1){rgba[i]=50+(x*3+y)%30;rgba[i+1]=130+(x+y)%30;rgba[i+2]=45;}
  }
  return encodePng(rgba,size,size);
}
