// 第 2 版第一階段：頭貼/暱稱資料。頭貼目前為占位符，正式請換成自製圖片。
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getDatabase, ref, update } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';
const config={apiKey:'AIzaSyB5Z2xqC1xpy7lFshctHCZ6RMX3HeLjrB0',authDomain:'virusgame-c7baa.firebaseapp.com',databaseURL:'https://virusgame-c7baa-default-rtdb.firebaseio.com',projectId:'virusgame-c7baa',appId:'1:317939129488:web:677930a67ab1997c0a4c15'};
const firebaseApp=getApps()[0]||initializeApp(config);
const db=getDatabase(firebaseApp);
const roomId='ab123';
const overlay=document.getElementById('profileOverlay'), holder=document.getElementById('profileAvatarOptions');
const nameInput=document.getElementById('profileName'), confirmBtn=document.getElementById('profileConfirm');
const feedback=document.getElementById('profileFeedback');
const icons=['🦠','👾','🧬','🤖','👽','🐙']; // 示範頭貼：正式換成你們自己製作的圖片
let choice=-1;
icons.forEach((symbol,i)=>{const b=document.createElement('button');b.type='button';b.className='profile-avatar';b.textContent=symbol;b.setAttribute('aria-label',`頭貼 ${i+1}`);b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>{choice=i;holder.querySelectorAll('button').forEach((node,j)=>node.setAttribute('aria-pressed',String(i===j)));});holder.appendChild(b);});
// 與原版 app.js 使用同一個 visitor ID
const id=localStorage.getItem('stomachGameParticipantID');
const stored=JSON.parse(localStorage.getItem('stomachGoV2Profile')||'null');
if(stored?.name && Number.isInteger(stored.avatarId)) {nameInput.value=stored.name;holder.children[stored.avatarId]?.click();}
confirmBtn.addEventListener('click',async()=>{
 const name=nameInput.value.trim();
 if(choice<0 || name.length<1 || name.length>12){feedback.textContent='請選一個頭貼，並輸入 1–12 字的名字';return;}
 const visitorId=localStorage.getItem('stomachGameParticipantID');
 if(!visitorId){feedback.textContent='尚未取得參與者 ID，請重新整理頁面';return;}
 confirmBtn.disabled=true;feedback.textContent='儲存中…';
 try{await update(ref(db,`rooms/${roomId}/participants/${visitorId}`),{name,avatarId:choice,profileCreatedAt:Date.now()});
 localStorage.setItem('stomachGoV2Profile',JSON.stringify({name,avatarId:choice}));overlay.hidden=true;
 const message=document.getElementById('message'); if(message)message.textContent=`${name}，註冊完成！目前等待正式投票功能開放。`;
 }catch(e){console.error(e);feedback.textContent='儲存失敗，請檢查 Firebase 資料庫規則及網路連線';}finally{confirmBtn.disabled=false;}
});
