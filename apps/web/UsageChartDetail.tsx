import {useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';

/** A chart's preview and explicit activation are separate: focus must not
 * consume the first touch. Placement stays inside the report's reading area. */
export function useUsageChartDetail(dialog=false){
  const [active,setActive]=useState<{key:string;content:ReactNode}|null>(null),clicked=useRef('');
  const anchor=useRef<HTMLButtonElement|null>(null),popup=useRef<HTMLDivElement>(null),id=useId();
  const close=()=>{clicked.current='';setActive(null);};
  useLayoutEffect(()=>{
    if(!active)return;
    const place=()=>{
      const button=anchor.current,tip=popup.current,container=tip?.offsetParent;if(!button||!tip||!(container instanceof HTMLElement))return;
      let top=0,bottom=innerHeight,left=0,right=innerWidth;
      for(let parent=tip.parentElement;parent;parent=parent.parentElement){
        const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
        if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,bounds.top+parent.clientTop);bottom=Math.min(bottom,bounds.top+parent.clientTop+parent.clientHeight);}
        if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,bounds.left+parent.clientLeft);right=Math.min(right,bounds.left+parent.clientLeft+parent.clientWidth);}
      }
      const bounds=button.getBoundingClientRect(),origin=container.getBoundingClientRect(),below=Math.max(0,bottom-bounds.bottom),above=Math.max(0,bounds.top-top),up=below<180&&above>below;
      tip.style.width='max-content';tip.style.maxWidth=Math.max(0,Math.min(420,right-left))+'px';tip.style.maxHeight=Math.floor(Math.min(180,up?above:below))+'px';
      const size=tip.getBoundingClientRect();
      tip.style.left=Math.max(left,Math.min(bounds.left,right-size.width))-origin.left-container.clientLeft+'px';
      tip.style.top=(up?bounds.top-size.height:bounds.bottom)-origin.top-container.clientTop+'px';
    };
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[active]);
  const bind=(key:string,label:string,content:ReactNode|(()=>ReactNode)=label)=>({
    'aria-label':label,'aria-expanded':active?.key===key,'aria-controls':active?.key===key?id:undefined,
    onFocus:(event:React.FocusEvent<HTMLButtonElement>)=>{anchor.current=event.currentTarget;setActive({key,content:typeof content==='function'?content():content});},
    onPointerEnter:(event:React.PointerEvent<HTMLButtonElement>)=>{if(event.pointerType==='mouse'){anchor.current=event.currentTarget;setActive({key,content:typeof content==='function'?content():content});}},
    onClick:(event:React.MouseEvent<HTMLButtonElement>)=>{anchor.current=event.currentTarget;clicked.current=clicked.current===key?'':key;setActive(clicked.current?{key,content:typeof content==='function'?content():content}:null);},
  });
  const boundary={
    onKeyDown:(event:React.KeyboardEvent)=>{if(event.key==='Escape')close();},
    onBlur:(event:React.FocusEvent)=>{if(!event.currentTarget.contains(event.relatedTarget))close();},
    onPointerLeave:(event:React.PointerEvent)=>{if(event.pointerType==='mouse')close();},
  };
  return {bind,boundary,close,element:active&&<div ref={popup} id={id} className="usage-detail-popup" role={dialog?'dialog':'tooltip'} aria-label={dialog?'会话点详情':undefined}>{active.content}</div>};
}
