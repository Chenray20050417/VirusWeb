// 只讀取資料：此檔案不會寫入 Firebase，也不會觸發 Unity 干擾。
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB5Z2xqC1xpy7lFshctHCZ6RMX3HeLjrB0',
  authDomain: 'virusgame-c7baa.firebaseapp.com',
  databaseURL: 'https://virusgame-c7baa-default-rtdb.firebaseio.com',
  projectId: 'virusgame-c7baa',
  storageBucket: 'virusgame-c7baa.firebasestorage.app',
  messagingSenderId: '317939129488',
  appId: '1:317939129488:web:677930a67ab1997c0a4c15'
};
const db = getDatabase(initializeApp(firebaseConfig));
const roomPath = 'rooms/ab123';
const $ = id => document.getElementById(id);
let round = null, offset = 0;
const labels = { STOMACH_ACID: '胃液遮擋', VIRUS_FRENZY: '病毒狂暴', AIM_DRIFT: '準心干擾' };
const phases = { IDLE:'尚未開始', WAITING:'等待準備', VOTING:'點擊競賽', RESULT:'結算中', INTERFERENCE:'干擾執行中' };
const safeNumber = v => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;

function render() {
  if (!round) return;
  $('phase').textContent = phases[round.phase] || String(round.phase || '未知階段');
  $('round').textContent = Number.isFinite(Number(round.roundId)) ? String(round.roundId) : '--';
  const totals = round.totals || {};
  const values = Object.keys(labels).map(key => safeNumber(totals[key]));
  const highest = Math.max(0,...values);
  [['acid','acidBar'],['virus','virusBar'],['aim','aimBar']].forEach(([n,b],i) => {
    $(n).textContent = values[i].toLocaleString('zh-TW');
    $(b).style.width = `${highest ? values[i]/highest*100 : 0}%`;
  });
  const sum = values.reduce((a,b)=>a+b,0);
  $('totalClicks').textContent = `目前累積 ${sum.toLocaleString('zh-TW')} 次有效點擊`;
  const keys = Object.keys(labels);
  const leaders = keys.filter((_,i)=>highest>0 && values[i]===highest);
  const final = ['RESULT','INTERFERENCE'].includes(round.phase);
  $('winner').textContent = final && round.winner && labels[round.winner] ? `${labels[round.winner]} 勝出！` : leaders.length===1 ? `${labels[leaders[0]]} 領先` : leaders.length>1 ? '目前平手' : '尚無有效點擊';
  $('mvp').textContent = final && round.mvpName ? String(round.mvpName) : '等待結算';
  $('mvpClicks').textContent = final && Number.isFinite(Number(round.mvpVotes)) ? `勝出干擾個人點擊 ${Number(round.mvpVotes)} 次` : '勝出項目個人有效點擊數最高者';
  const end = safeNumber(round.endsAt); // 毫秒 Unix 時間戳，0 表示未啟動
  const remain = end ? Math.max(0,Math.ceil((end-(Date.now()+offset))/1000)) : null;
  $('time').textContent = remain===null ? '--:--' : `${String(Math.floor(remain/60)).padStart(2,'0')}:${String(remain%60).padStart(2,'0')}`;
}
onValue(ref(db, '.info/serverTimeOffset'), snap => { offset = Number(snap.val()) || 0; render(); });
onValue(ref(db, roomPath + '/currentRound'), snap => {
  round = snap.val();
  $('connection').textContent = round ? '● Firebase 已連線' : '尚無本輪資料';
  if (round) render();
}, error => { $('connection').textContent = '讀取失敗：請檢查 Firebase 規則'; console.error(error); });
setInterval(render, 200);
