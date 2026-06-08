const BASE = 'https://bitlogicalpha.com';
let viewCoin = 'BTC';
let allCharts = { BTC: [], ETH: [] };
let insightsLoaded = false;
let altsLoaded = false;
let macroLoaded = false;
let cachedMarketData = [];


// ── SLUGIFY ───────────────────────────────────────────────
function slugify(title){
  return title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g,'')
    .replace(/\s+/g,'-')
    .replace(/-+/g,'-')
    .trim();
}

// ── CACHE HELPERS ─────────────────────────────────────────
function saveCache(key, data){
  try{ localStorage.setItem(key, JSON.stringify({data, ts: Date.now()})); }catch(e){}
}
function loadCache(key, maxAgeMs=3600000){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return null;
    const {data, ts} = JSON.parse(raw);
    return {data, ts, stale: Date.now()-ts > maxAgeMs};
  }catch(e){ return null; }
}
function timeAgo(ts){
  const mins = Math.round((Date.now()-ts)/60000);
  if(mins < 2) return 'just now';
  if(mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins/60);
  return `${hrs}h ago`;
}
// ── SPARKLINE HISTORY ──────────────────────────────────────
function recordDailyState(coin, status){
  try{
    const key = 'bl_history_' + coin;
    const today = new Date().toISOString().slice(0,10);
    let history = JSON.parse(localStorage.getItem(key)||'[]');
    // Only record once per day
    if(history.length && history[history.length-1].d === today){
      history[history.length-1].s = status; // update today's
    } else {
      history.push({d:today, s:status});
    }
    // Keep last 7 days only
    if(history.length > 7) history = history.slice(-7);
    localStorage.setItem(key, JSON.stringify(history));
  }catch(e){}
}

function getSparkline(coin){
  try{
    const key = 'bl_history_' + coin;
    return JSON.parse(localStorage.getItem(key)||'[]');
  }catch(e){ return []; }
}

function renderSparkline(coin){
  return '';
}

function showLastUpdated(containerId, ts, stale=false){
  const el = document.getElementById(containerId);
  if(!el) return;
  let badge = el.querySelector('.last-updated');
  if(!badge){ badge = document.createElement('div'); badge.className='last-updated'; el.appendChild(badge); }
  badge.className = 'last-updated' + (stale?' stale':'');
  badge.innerHTML = `<span class="last-updated-dot"></span>${(stale ? '⚠ Cached · ' : '✓ Updated · ') + timeAgo(ts)}`;
}
let cachedGlobalData = null;

document.getElementById('navDate').textContent = new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).toUpperCase();

function toggleBtcSection(header){
  const body = header.nextElementSibling;
  const toggle = header.querySelector('.btc-toggle');
  body.classList.toggle('open');
  toggle.classList.toggle('open');
}

function tocJump(e, id){
  e.preventDefault();
  jumpTo(id);
}

function tocScroll(dir){
  const el = document.getElementById('tocLinks');
  if(!el) return;
  el.scrollBy({left: dir * 200, behavior:'smooth'});
}

function updateTocArrows(){
  const el = document.getElementById('tocLinks');
  const left = document.getElementById('tocArrowLeft');
  const right = document.getElementById('tocArrowRight');
  if(!el || !left || !right) return;
  left.classList.toggle('hidden', el.scrollLeft <= 4);
  right.classList.toggle('hidden', el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
}

// Init arrows after page loads
setTimeout(updateTocArrows, 500);

function jumpTo(id){
  const el = document.getElementById(id);
  if(!el) return;
  // Auto-expand if collapsed (btc sections, res sections)
  const body = el.querySelector('.btc-section-body, .res-section-body');
  const toggle = el.querySelector('.btc-toggle, .res-toggle-arrow');
  if(body && !body.classList.contains('open')){
    body.classList.add('open');
    if(toggle) toggle.style.transform='rotate(180deg)';
  }
  setTimeout(()=>{
    const navHeight = document.querySelector('.sticky-nav').offsetHeight;
    const top = el.getBoundingClientRect().top + window.scrollY - navHeight - 16;
    window.scrollTo({top, behavior:'smooth'});
  }, 50);
}

// ── TAB SWITCHING ─────────────────────────────────────────
function toggleResSection(header){
  const body = header.nextElementSibling;
  const isOpen = header.classList.contains('open');
  const label = header.querySelector('.res-toggle-label');
  header.classList.toggle('open', !isOpen);
  body.classList.toggle('open', !isOpen);
  if(label) label.textContent = isOpen ? 'Expand' : 'Collapse';
}

function toggleSection(type){
  if(type==='news'){
    const full = document.getElementById('newsFull');
    const label = document.getElementById('newsToggleLabel');
    const arrow = document.getElementById('newsToggleArrow');
    if(!full) return;
    const isOpen = full.classList.contains('open');
    full.classList.toggle('open', !isOpen);
    if(label) label.textContent = isOpen ? 'Expand' : 'Collapse';
    if(arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
  }
  if(type==='cal'){
    const full = document.getElementById('calFull');
    const label = document.getElementById('calToggleLabel');
    const arrow = document.getElementById('calToggleArrow');
    if(!full) return;
    const isOpen = full.classList.contains('open');
    full.classList.toggle('open', !isOpen);
    if(label) label.textContent = isOpen ? 'Expand' : 'Collapse';
    if(arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
  }
}

// ── HEATMAP ───────────────────────────────────────────────
async function fetchHeatmap(){
  try{
    const cached = loadCache('bl_heatmap', 3600000);
    if(cached) { renderHeatmap(cached); }
    else {
      renderHeatmap({ score: null, updated: '—', note: 'Loading...' });
    }
    const txt = await fetch(`${BASE}/charts/ACCUMULATION/manifest.txt?t=${Date.now()}`).then(r=>r.ok?r.text():null);
    if(txt){
      const lines = txt.split('\n').map(l=>l.trim()).filter(Boolean);
      const data = {};
      lines.forEach(l=>{
        if(l.toLowerCase().startsWith('score:'))      data.score   = parseFloat(l.split(':')[1].trim());
        else if(l.toLowerCase().startsWith('updated:')) data.updated = l.substring(l.indexOf(':')+1).trim();
        else if(l.toLowerCase().startsWith('note:'))    data.note    = l.substring(l.indexOf(':')+1).trim();
      });
      saveCache('bl_heatmap', data);
      renderHeatmap(data);
    }
    // Ensure BTC price updates once market data arrives
    if(!cachedMarketData || !cachedMarketData.length){
      let attempts = 0;
      const retry = setInterval(()=>{
        attempts++;
        const priceEl = document.getElementById('heatmapPrice');
        const liveBTC = cachedMarketData?.find(c=>c.id==='bitcoin')?.current_price;
        if(liveBTC && priceEl){ priceEl.textContent = '$'+liveBTC.toLocaleString(); clearInterval(retry); }
        else if(attempts >= 20) clearInterval(retry);
      }, 500);
    }
  } catch(e){
    renderHeatmap({ score: null, updated: '—', note: 'Data unavailable.' });
  }
}

// ── WHALE FOOTPRINT ─────────────────────────────────────
async function fetchWhaleFootprint(){
  var chartEl   = document.getElementById('whaleChart');
  var summaryEl = document.getElementById('whaleSummary');
  var wallsEl   = document.getElementById('whaleWallsList');
  if(!chartEl) return;
  chartEl.innerHTML = '<div style="text-align:center;padding:20px;font-size:10px;color:#6b6560;letter-spacing:1px">Fetching order book...</div>';
  try{
    var res = await fetch('https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=500').then(function(r){ return r.ok?r.json():null; });
    if(!res) throw new Error('Failed');
    var currentPrice = (cachedMarketData && cachedMarketData.find(function(c){ return c.id==='bitcoin'; }) || {}).current_price || 0;

    function cluster(orders){
      var map = {};
      for(var i=0;i<orders.length;i++){
        var price  = parseFloat(orders[i][0]);
        var qty    = parseFloat(orders[i][1]);
        var bucket = Math.round(price/500)*500;
        map[bucket] = (map[bucket]||0) + qty*price;
      }
      var arr = [];
      for(var k in map) arr.push({price:parseFloat(k), value:map[k]/1e6});
      arr.sort(function(a,b){ return b.price-a.price; });
      return arr;
    }

    var bids = cluster(res.bids);
    var asks = cluster(res.asks);
    var totalBid = bids.reduce(function(s,b){ return s+b.value; },0);
    var totalAsk = asks.reduce(function(s,a){ return s+a.value; },0);
    var ratio = totalBid/(totalBid+totalAsk);
    var pressure = ratio>0.55?'BUY PRESSURE':ratio<0.45?'SELL PRESSURE':'BALANCED';
    var pc = ratio>0.55?'#4caf7d':ratio<0.45?'#e05555':'#c9a84c';

    var topBids = bids.slice().sort(function(a,b){ return b.value-a.value; }).slice(0,3);
    var topAsks = asks.slice().sort(function(a,b){ return b.value-a.value; }).slice(0,3);

    summaryEl.innerHTML =
      '<div style="background:var(--surface);padding:18px 16px;text-align:center">' +
        '<div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Total Bid Liquidity</div>' +
        '<div style="font-family:Playfair Display,serif;font-size:clamp(18px,3vw,24px);font-weight:700;color:#4caf7d">$' + totalBid.toFixed(0) + 'M</div>' +
        '<div style="font-size:8px;color:var(--text-dim);margin-top:4px">Buy walls below price</div>' +
      '</div>' +
      '<div style="background:var(--surface);padding:18px 16px;text-align:center;border-left:3px solid ' + pc + '">' +
        '<div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Bid/Ask Ratio</div>' +
        '<div style="font-family:Playfair Display,serif;font-size:24px;font-weight:700;color:' + pc + '">' + (ratio*100).toFixed(0) + '%</div>' +
        '<div style="font-size:8px;color:' + pc + ';margin-top:4px;letter-spacing:1px">' + pressure + '</div>' +
      '</div>' +
      '<div style="background:var(--surface);padding:18px 16px;text-align:center">' +
        '<div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px">Total Ask Liquidity</div>' +
        '<div style="font-family:Playfair Display,serif;font-size:clamp(18px,3vw,24px);font-weight:700;color:#e05555">$' + totalAsk.toFixed(0) + 'M</div>' +
        '<div style="font-size:8px;color:var(--text-dim);margin-top:4px">Sell walls above price</div>' +
      '</div>';

    var allLevels = asks.slice(0,15).map(function(a){ return {price:a.price,value:a.value,side:'ask'}; })
      .concat(bids.slice(0,15).map(function(b){ return {price:b.price,value:b.value,side:'bid'}; }))
      .sort(function(a,b){ return b.price-a.price; });
    var maxVal = Math.max.apply(null, allLevels.map(function(l){ return l.value; }));

    var bars = '';
    for(var i=0;i<allLevels.length;i++){
      var l = allLevels[i];
      var pct    = Math.min(100, (l.value/maxVal)*100);
      var color  = l.side==='bid'?'#4caf7d':'#e05555';
      var isWall = l.value > maxVal*0.4;
      var isCur  = Math.abs(l.price-currentPrice)<500;
      bars +=
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px' + (isCur?';border-left:2px solid #c9a84c;padding-left:6px':'') + '">' +
          '<div style="font-size:8px;color:' + (isCur?'#c9a84c':'#3a3530') + ';font-family:DM Mono,monospace;width:70px;flex-shrink:0;text-align:right">$' + l.price.toLocaleString() + '</div>' +
          '<div style="flex:1;height:' + (isWall?12:7) + 'px;background:var(--surface2);border-radius:1px">' +
            '<div style="height:100%;width:' + pct.toFixed(1) + '%;background:' + color + ';opacity:' + (isWall?1:0.5) + ';border-radius:1px' + (isWall?';box-shadow:0 0 6px '+color+'80':'') + '"></div>' +
          '</div>' +
          '<div style="font-size:8px;color:' + color + ';width:60px;flex-shrink:0">' + (isWall?'🐋 ':'') + '$' + l.value.toFixed(0) + 'M</div>' +
        '</div>';
    }

    chartEl.innerHTML =
      '<div style="display:flex;justify-content:space-between;margin-bottom:12px">' +
        '<div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase">Order Book Depth</div>' +
        '<div style="font-size:9px;color:var(--gold);letter-spacing:1px">▲ ASKS &nbsp; ▼ BIDS</div>' +
      '</div>' +
      '<div style="max-height:400px;overflow-y:auto">' + bars + '</div>' +
      '<div style="margin-top:8px;font-size:8px;color:var(--text-dim);letter-spacing:1px">🐋 = Wall detected · Gold = Current price · Live Binance BTCUSDT</div>';

    var wallHtml = '';
    for(var i=0;i<topBids.length;i++){
      wallHtml += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--text-dim)">' +
        '<span style="font-size:10px;color:#4caf7d">🐋 BUY WALL at $' + topBids[i].price.toLocaleString() + '</span>' +
        '<span style="font-size:10px;color:#4caf7d;font-weight:700">$' + topBids[i].value.toFixed(0) + 'M in bids</span>' +
      '</div>';
    }
    for(var i=0;i<topAsks.length;i++){
      wallHtml += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--text-dim)">' +
        '<span style="font-size:10px;color:#e05555">🧱 SELL WALL at $' + topAsks[i].price.toLocaleString() + '</span>' +
        '<span style="font-size:10px;color:#e05555;font-weight:700">$' + topAsks[i].value.toFixed(0) + 'M in asks</span>' +
      '</div>';
    }
    wallsEl.innerHTML = wallHtml || '—';

  } catch(e){
    chartEl.innerHTML = '<div style="text-align:center;padding:20px;font-size:10px;color:var(--text-muted)">Order book unavailable. Try refreshing.</div>';
  }
}


function renderHeatmap(d){
  if(!d) return;
  const score = d.score;
  const displayScore = score;
  const hasScore = score !== null && score !== undefined && !isNaN(score);
  let zone, zoneColor, signal;
  if(!hasScore){
    zone='—'; zoneColor='var(--text-dim)'; signal='Loading...';
  } else if(displayScore >= 1.0){
    zone='AGGRESSIVE ACCUMULATION · DEEP VALUE'; zoneColor='#4caf7d'; signal='High Conviction Buy Zone';
  } else if(displayScore >= 0.5){
    zone='MODERATE ACCUMULATION'; zoneColor='#7bc47f'; signal='Below fair value — Accumulate';
  } else if(displayScore >= -0.5){
    zone='NEUTRAL · HOLD'; zoneColor='#c9a84c'; signal='Standard DCA zone — Near fair value';
  } else if(displayScore >= -1.0){
    zone='MODERATE CAUTION'; zoneColor='#e07755'; signal='Above fair value — Reduce entries';
  } else {
    zone='PROFIT TAKING · DE-RISK'; zoneColor='#e05555'; signal='High Conviction Sell Zone — Overheated';
  }
  const pct = hasScore ? Math.min(100, Math.max(0, ((2 - displayScore) / 4) * 100)) : 50;
  const scoreEl = document.getElementById('heatmapScore');
  if(scoreEl){ scoreEl.textContent=hasScore?(displayScore>0?'+':'')+displayScore.toFixed(1):'—'; scoreEl.style.color=zoneColor; }
  const zoneEl = document.getElementById('heatmapZone');
  if(zoneEl){ zoneEl.textContent=zone; zoneEl.style.color=zoneColor; }
  const priceEl = document.getElementById('heatmapPrice');
  const liveBTC = cachedMarketData?.find(c=>c.id==='bitcoin')?.current_price;
  if(priceEl) priceEl.textContent = liveBTC ? '$'+liveBTC.toLocaleString() : '---';
  const sigEl = document.getElementById('heatmapSignal');
  if(sigEl){ sigEl.textContent=signal; sigEl.style.color=zoneColor; }
  const updEl = document.getElementById('heatmapUpdated');
  if(updEl) updEl.textContent=d.updated;
  const noteEl = document.getElementById('heatmapNote');
  if(noteEl) noteEl.textContent=d.note;
  setTimeout(()=>{
    const pointer = document.getElementById('heatmapPointer');
    if(pointer){ pointer.style.left=pct+'%'; }
  }, 300);
}

function switchTab(tab){
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const tabBtn = document.getElementById('tab-'+tab);
  if(tabBtn) tabBtn.classList.add('active');
  const tabView = document.getElementById('view-'+tab);
  if(tabView) tabView.classList.add('active');
  window.scrollTo({top:0,behavior:'smooth'});
  history.replaceState(null, '', '#'+tab);
  if(tab==='insights' && !insightsLoaded){
    insightsLoaded=true;
    fetchFearGreed();
    setTimeout(()=>fetchPerformance(), 800);
    setTimeout(()=>fetchDominance(), 1500);
    setTimeout(()=>fetchGoldBtcRatio(), 2000);
    setTimeout(()=>fetchMetrics(), 2500);
    setTimeout(()=>fetchWeeklySummary(), 500);
    setTimeout(()=>computeCustomFG(), 1000);
  }
  if(tab==='news'){
    if(window._newsItems) renderNewsTab(window._newsItems);
    else fetch(`${BASE}/news.json?t=${Date.now()}`).then(r=>r.json()).then(d=>{window._newsItems=d;renderNewsTab(d);}).catch(()=>{});
  }
  if(tab==='macro' && !macroLoaded){
    macroLoaded=true;
    fetchMacro();
  }
  if(tab==='accumulation'){
    fetchHeatmap();
  }
  if(tab==='alts' && !altsLoaded){
    altsLoaded=true;
    fetchAlts();
    setInterval(()=>{
      if(document.getElementById('view-alts').classList.contains('active')) fetchAlts();
    }, 60000);
  }
}

function renderEthBtcRatio(eth, btc, btcDom){
  const el = document.getElementById('ethBtcWidget');
  if(!el) return;

  const ratio    = eth.current_price / btc.current_price;
  const ratio24h = (eth.price_change_percentage_24h||0) - (btc.price_change_percentage_24h||0);
  const ratio7d  = (eth.price_change_percentage_7d_in_currency||0) - (btc.price_change_percentage_7d_in_currency||0);
  const ratio30d = (eth.price_change_percentage_30d_in_currency||0) - (btc.price_change_percentage_30d_in_currency||0);

  let regime, regimeColor, regimeIcon, insight;
  if(ratio24h > 0.5){
    regime = 'ALTCOIN VELOCITY INCREASING'; regimeColor = '#4caf7d'; regimeIcon = '🚀';
    insight = 'ETH is outperforming BTC. Capital is beginning to rotate down the risk curve — from Bitcoin into the broader altcoin ecosystem. Watch for sustained ETH dominance over 3-5 days before calling a full alt season rotation.';
  } else if(ratio24h < -0.5){
    regime = 'BITCOIN DOMINANCE REGIME'; regimeColor = '#f7931a'; regimeIcon = '🛡️';
    insight = 'BTC is outperforming ETH. Capital is concentrating in Bitcoin — the flight-to-quality trade within crypto. Alts tend to underperform until ETH reclaims relative strength.';
  } else {
    regime = 'ABSORPTION PHASE'; regimeColor = '#c9a84c'; regimeIcon = '📊';
    insight = 'ETH and BTC are moving in lockstep. The market is digesting recent price action. A breakout in the ETH/BTC ratio in either direction will define the next leg.';
  }

  const sign = v => v >= 0 ? '+' : '';
  const col  = v => v >= 0 ? '#4caf7d' : '#e05555';
  const arr  = v => v >= 0 ? '▲' : '▼';

  // Arc gauge — ratio mapped 0.02 (bear extreme) to 0.08 (bull extreme)
  const gaugeMin = 0.02, gaugeMax = 0.08;
  const gaugePct = Math.min(100, Math.max(0, ((ratio - gaugeMin) / (gaugeMax - gaugeMin)) * 100));
  const circ = 251; // 2π×40
  const arcOffset = circ - (gaugePct / 100) * circ;
  // Gauge color: red at low end, gold at mid, green at high
  const gaugeColor = ratio < 0.035 ? '#e05555' : ratio < 0.055 ? '#c9a84c' : '#4caf7d';

  // Perf bars
  const periods = [
    {label:'30D', val: ratio30d},
    {label:'7D',  val: ratio7d},
    {label:'24H', val: ratio24h},
  ];
  const maxAbs = Math.max(...periods.map(p => Math.abs(p.val)), 1);
  const perfBars = periods.map(p => {
    const w = Math.min(100, (Math.abs(p.val) / maxAbs) * 100);
    return `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="font-size:9px;color:var(--text-dim);letter-spacing:2px;width:28px;flex-shrink:0">${p.label}</span>
        <div style="flex:1;height:6px;background:var(--surface);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${w}%;background:${col(p.val)};border-radius:3px;transition:width 1.2s ease;box-shadow:0 0 6px ${col(p.val)}60"></div>
        </div>
        <span style="font-size:11px;font-weight:600;color:${col(p.val)};width:52px;text-align:right;letter-spacing:0.5px">${arr(p.val)} ${Math.abs(p.val).toFixed(2)}%</span>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:220px 1fr;gap:2px">

      <!-- LEFT: Gauge + hero number -->
      <div style="background:var(--surface2);padding:28px 24px;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;overflow:hidden">
        <div style="font-size:9px;color:var(--text-muted);letter-spacing:3px;text-transform:uppercase;margin-bottom:20px;align-self:flex-start">ETH / BTC</div>

        <!-- SVG Arc Gauge -->
        <div style="position:relative;width:140px;height:140px;margin-bottom:16px">
          <svg width="140" height="140" viewBox="0 0 100 100">
            <defs>
              <filter id="ethbtcGlow">
                <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="${gaugeColor}" flood-opacity="0.8"/>
              </filter>
            </defs>
            <!-- Track -->
            <circle cx="50" cy="50" r="40" fill="none" stroke="var(--surface)" stroke-width="8"/>
            <!-- Arc -->
            <circle cx="50" cy="50" r="40" fill="none"
              stroke="${gaugeColor}" stroke-width="8" stroke-linecap="round"
              stroke-dasharray="${circ}" stroke-dashoffset="${arcOffset}"
              transform="rotate(-90,50,50)"
              filter="url(#ethbtcGlow)"
              style="transition:stroke-dashoffset 1.4s cubic-bezier(0.34,1.56,0.64,1),stroke 0.6s ease"/>
            <!-- Zone labels -->
            <text x="8" y="58" font-size="6" fill="#6b6560" font-family="monospace">BEAR</text>
            <text x="72" y="58" font-size="6" fill="#6b6560" font-family="monospace">BULL</text>
          </svg>
          <!-- Hero number overlay -->
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
            <div style="font-family:'Playfair Display',serif;font-size:26px;font-weight:700;color:${gaugeColor};line-height:1;letter-spacing:-1px">${ratio.toFixed(4)}</div>
            <div style="font-size:8px;color:var(--text-dim);letter-spacing:1px;margin-top:4px">RATIO</div>
          </div>
        </div>

        <!-- 24H change badge -->
        <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border:1px solid ${col(ratio24h)}40;background:${col(ratio24h)}10;border-radius:2px">
          <span style="font-size:11px;color:${col(ratio24h)};font-weight:700;letter-spacing:1px">${arr(ratio24h)} ${Math.abs(ratio24h).toFixed(2)}% · 24H</span>
        </div>

        <!-- Ghost BG number -->
      </div>

      <!-- RIGHT: Regime + perf bars + insight -->
      <div style="display:flex;flex-direction:column;gap:2px">

        <!-- Regime banner -->
        <div style="background:var(--surface2);padding:20px 24px;border-left:3px solid ${regimeColor}">
          <div style="font-size:9px;color:var(--text-muted);letter-spacing:3px;text-transform:uppercase;margin-bottom:10px">Current Regime</div>
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:28px;line-height:1">${regimeIcon}</span>
            <div>
              <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:700;color:${regimeColor};letter-spacing:1px;line-height:1.2">${regime}</div>
              <div style="font-size:9px;color:var(--text-muted);letter-spacing:1px;margin-top:4px">Based on 24H relative performance</div>
            </div>
          </div>
          <!-- Signal strength bar -->
          <div style="margin-top:14px;height:3px;background:var(--surface);border-radius:2px;overflow:hidden">
            <div style="height:100%;width:${Math.min(100,Math.abs(ratio24h)*20+5)}%;background:${regimeColor};box-shadow:0 0 6px ${regimeColor};transition:width 1.2s ease"></div>
          </div>
          <div style="font-size:8px;color:var(--text-dim);letter-spacing:1px;margin-top:4px">Signal strength</div>
        </div>

        <!-- Perf bars -->
        <div style="background:var(--surface2);padding:20px 24px;flex:1">
          <div style="font-size:9px;color:var(--text-muted);letter-spacing:3px;text-transform:uppercase;margin-bottom:14px">Relative Performance (ETH − BTC)</div>
          ${perfBars}
        </div>

      </div>
    </div>

    <!-- Insight footer -->
    <div style="background:var(--surface2);border-left:3px solid var(--gold);padding:18px 24px;margin-top:2px">
      <div style="font-size:9px;color:var(--gold);letter-spacing:3px;text-transform:uppercase;margin-bottom:10px">BitLogic Analysis · ETH/BTC</div>
      ${btcDom !== null ? `<div style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;margin-bottom:12px;border:1px solid ${ratio24h > 0.5 && btcDom < 55 ? '#4caf7d40' : ratio24h < -0.5 ? '#f7931a40' : '#3a3530'};background:${ratio24h > 0.5 && btcDom < 55 ? 'rgba(76,175,125,0.06)' : 'transparent'}">
        <span style="font-size:9px;color:var(--text-muted);letter-spacing:2px">BTC.D</span>
        <span style="font-size:12px;font-weight:600;color:${btcDom > 57 ? '#f7931a' : '#4caf7d'}">${btcDom.toFixed(1)}%</span>
        ${ratio24h > 0.5 && btcDom < 55 ? '<span style="font-size:9px;color:#4caf7d;letter-spacing:1px;font-weight:700">✓ CONFIRMED ALT TREND — ETH rising + BTC.D falling</span>' :
          ratio24h > 0.5 && btcDom >= 55 ? '<span style="font-size:9px;color:#c9a84c;letter-spacing:1px">⚠ ETH rising but BTC.D still elevated — unconfirmed</span>' :
          ratio24h < -0.5 ? '<span style="font-size:9px;color:#f7931a;letter-spacing:1px">BTC leading — dominance rising</span>' :
          '<span style="font-size:9px;color:var(--text-dim);letter-spacing:1px">Watching for BTC.D direction</span>'}
      </div>` : ''}
      <div style="font-size:12px;color:var(--text-muted);line-height:1.8;letter-spacing:0.3px">${insight}</div>
      <div style="font-size:11px;color:var(--text-muted);line-height:1.8;margin-top:10px;padding-top:10px;border-top:1px solid var(--text-dim)">The ETH/BTC ratio measures the relative strength of the smart-contract ecosystem against the macro store of value. A sustained breakout above recent highs is the primary lead indicator for altcoin season.</div>
    </div>`;

  // Add @media mobile collapse
  el.style.overflow = 'hidden';
  const grid = el.querySelector('[style*="grid-template-columns:220px"]');
  if(grid && window.innerWidth < 700){
    grid.style.gridTemplateColumns = '1fr';
  }
}

// ── ALTS TAB ──────────────────────────────────────────────
async function fetchAlts(){
  const cachedAlts = loadCache('bl_alts', 300000);
  if(cachedAlts && cachedAlts.data){
    const w=document.getElementById('altSeasonWidget');
    const g=document.getElementById('gainersWidget');
    const l=document.getElementById('losersWidget');
    const t=document.getElementById('altsTableWidget');
    const e=document.getElementById('ethBtcWidget');
    if(w&&cachedAlts.data.season)  w.innerHTML=cachedAlts.data.season;
    if(g&&cachedAlts.data.gainers) g.innerHTML=cachedAlts.data.gainers;
    if(l&&cachedAlts.data.losers)  l.innerHTML=cachedAlts.data.losers;
    if(t&&cachedAlts.data.table)   t.innerHTML=cachedAlts.data.table;
    if(e&&cachedAlts.data.ethbtc)  e.innerHTML=cachedAlts.data.ethbtc;
  }
  try{
    // Fetch dedicated alts data with 90d — needs top 100 coins with all periods
    let data;
    try{
      data = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d,30d,1y').then(r=>r.json());
    }catch(e){
      // fallback: wait for cached data if API fails
      await new Promise(r=>setTimeout(r,2000));
      data = cachedMarketData.length ? cachedMarketData : null;
    }
    if(!data || !data.length) throw new Error('No market data');

    // ── ETH/BTC RATIO ──
    const ethCoin = data.find(c=>c.id==='ethereum');
    const btcCoin = data.find(c=>c.id==='bitcoin');
    const btcDom = cachedGlobalData?.data?.market_cap_percentage?.btc || null;
    if(ethCoin && btcCoin) renderEthBtcRatio(ethCoin, btcCoin, btcDom);
    // Save alts cache
    saveCache('bl_alts', {data:{
      season:  document.getElementById('altSeasonWidget')?.innerHTML||'',
      gainers: document.getElementById('gainersWidget')?.innerHTML||'',
      losers:  document.getElementById('losersWidget')?.innerHTML||'',
      table:   document.getElementById('altsTableWidget')?.innerHTML||'',
      ethbtc:  document.getElementById('ethBtcWidget')?.innerHTML||'',
    }});

    // --- ALTCOIN SEASON INDEX ---
    const btc = data.find(c=>c.id==='bitcoin');
    const btcChange24h = btc?.price_change_percentage_24h || 0;
    const btcChange7d  = btc?.price_change_percentage_7d_in_currency || 0;
    const top50alts = data.filter(c=>c.id!=='bitcoin').slice(0,49);

    // 24h score
    const out24 = top50alts.filter(c=>(c.price_change_percentage_24h||0) > btcChange24h).length;
    const score24 = Math.round((out24/50)*100);

    // 7d score
    const out7d = top50alts.filter(c=>(c.price_change_percentage_7d_in_currency||0) > btcChange7d).length;
    const score7d = Math.round((out7d/50)*100);

    function getStatus(score){
      if(score>=75) return {status:'Altcoin Season 🔥', color:'#4caf7d'};
      if(score>=50) return {status:'Rotation Underway', color:'#c9a84c'};
      if(score>=25) return {status:'Bitcoin Season',   color:'#c9a84c'};
      return              {status:'BTC Dominance 🔒',  color:'#e05555'};
    }
    const s24 = getStatus(score24);
    const s7d = getStatus(score7d);

    // Description based on 7d (more meaningful)
    let desc;
    if(score7d>=75) desc='More than 75% of the top 50 altcoins are outperforming Bitcoin over the past 7 days. Capital is rotating out of BTC and into alts. Historically this signals peak cycle risk but also the strongest short-term alt gains.';
    else if(score7d>=50) desc='More than half of the top 50 altcoins are outperforming Bitcoin over 7 days. Capital rotation has started but has not reached full altcoin season levels. Selective opportunities in quality alts.';
    else if(score7d>=25) desc='Bitcoin is outperforming most altcoins over the past week. Capital is concentrated in BTC. Typical in early bull phases and periods of uncertainty. Alts tend to underperform until BTC stabilises.';
    else desc='Bitcoin is strongly outperforming nearly all altcoins over 7 days. This typically signals a risk-off environment or early accumulation phase. Hold quality, avoid speculative alts.';

    document.getElementById('altSeasonWidget').innerHTML=`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px;margin-bottom:16px">
        <div style="background:rgba(255,255,255,0.03);padding:16px;border-top:2px solid ${s24.color}">
          <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">24H Score</div>
          <div style="font-family:'Playfair Display',serif;font-size:32px;font-weight:700;color:${s24.color};line-height:1">${score24}<span style="font-size:16px;color:var(--text-muted)">/100</span></div>
          <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${s24.color};margin-top:6px">${s24.status}</div>
          <div class="alt-season-bar-wrap" style="margin-top:12px"><div class="alt-season-bar-fill" style="width:${score24}%;background:${s24.color}"></div></div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:6px">${out24} / 50 alts outperforming BTC</div>
        </div>
        <div style="background:rgba(255,255,255,0.03);padding:16px;border-top:2px solid ${s7d.color}">
          <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">7D Score</div>
          <div style="font-family:'Playfair Display',serif;font-size:32px;font-weight:700;color:${s7d.color};line-height:1">${score7d}<span style="font-size:16px;color:var(--text-muted)">/100</span></div>
          <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${s7d.color};margin-top:6px">${s7d.status}</div>
          <div class="alt-season-bar-wrap" style="margin-top:12px"><div class="alt-season-bar-fill" style="width:${score7d}%;background:${s7d.color}"></div></div>
          <div style="font-size:10px;color:var(--text-dim);margin-top:6px">${out7d} / 50 alts outperforming BTC</div>
        </div>
      </div>
      <div class="alt-season-labels" style="margin-bottom:8px"><span>Bitcoin Season (0)</span><span>Altcoin Season (100)</span></div>

      <!-- Four-phase bar with needle -->
      <div style="position:relative;margin:12px 0 20px">

        <!-- Needle marker -->
        <div style="position:absolute;top:-18px;left:${score7d}%;transform:translateX(-50%);z-index:3">
          <div style="font-size:9px;font-weight:700;color:${s7d.color};letter-spacing:1px;white-space:nowrap;text-align:center">${score7d}</div>
        </div>
        <div style="position:absolute;top:-4px;left:${score7d}%;transform:translateX(-50%);width:2px;height:calc(100% + 8px);background:${s7d.color};box-shadow:0 0 8px ${s7d.color};z-index:3;border-radius:1px;pointer-events:none"></div>

        <!-- Four phase boxes -->
        <div style="display:grid;grid-template-columns:25fr 20fr 20fr 25fr;gap:2px">
          ${[
            {label:'BTC Dominance', range:'0 – 24',  color:'#e05555', min:0,  max:24},
            {label:'Bitcoin Season',range:'25 – 49', color:'#c9a84c', min:25, max:49},
            {label:'Rotation',      range:'50 – 74', color:'#c9a84c', min:50, max:74},
            {label:'Altcoin Season',range:'75 – 100',color:'#4caf7d', min:75, max:100},
          ].map(box => {
            const isActive = score7d >= box.min && score7d <= box.max;
            return `<div style="
              padding:10px 8px;
              background:${isActive ? `${box.color}22` : 'rgba(255,255,255,0.02)'};
              border-top:${isActive ? '3px' : '2px'} solid ${isActive ? box.color : `${box.color}40`};
              border:1px solid ${isActive ? `${box.color}60` : 'transparent'};
              border-top:${isActive ? '3px' : '2px'} solid ${isActive ? box.color : `${box.color}40`};
              box-shadow:${isActive ? `0 0 12px ${box.color}30, inset 0 0 20px ${box.color}08` : 'none'};
              text-align:center;
              opacity:${isActive ? '1' : '0.45'};
              transition:all 0.3s;
              position:relative;
            ">
              <div style="font-size:${isActive ? '10px' : '9px'};letter-spacing:2px;text-transform:uppercase;color:${box.color};font-weight:${isActive ? '700' : '400'}">${box.label}</div>
              <div style="font-size:${isActive ? '11px' : '9px'};color:${isActive ? 'var(--text)' : 'var(--text-dim)'};margin-top:4px;letter-spacing:1px">${box.range}</div>
              ${isActive ? `<div style="font-size:8px;color:${box.color};letter-spacing:1px;margin-top:3px;animation:metapulse 2s ease infinite">● YOU ARE HERE</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="alt-season-desc">${desc}</div>
      <div class="alt-season-meta">
        <div class="alt-season-meta-item"><span class="alt-season-meta-label">BTC 24H</span><span class="alt-season-meta-value ${btcChange24h>=0?'up':'down'}">${btcChange24h>=0?'+':''}${btcChange24h.toFixed(2)}%</span></div>
        <div class="alt-season-meta-item"><span class="alt-season-meta-label">BTC 7D</span><span class="alt-season-meta-value ${btcChange7d>=0?'up':'down'}">${btcChange7d>=0?'+':''}${btcChange7d.toFixed(2)}%</span></div>
        <div class="alt-season-meta-item"><span class="alt-season-meta-label">Methodology</span><span style="font-size:11px;color:var(--text-muted)">Top 50 alts vs BTC</span></div>
      </div>`;

    // --- TOP 5 GAINERS & LOSERS (from top 100, excl BTC/stablecoins) ---
    const filtered = data.filter(c=>!['bitcoin','tether','usd-coin','dai','true-usd','first-digital-usd','ethena-usde'].includes(c.id));
    const sorted = [...filtered].sort((a,b)=>(b.price_change_percentage_24h||0)-(a.price_change_percentage_24h||0));
    const gainers = sorted.slice(0,5);
    const losers = sorted.slice(-5).reverse();

    function perfRow(c,i){
      const chg = c.price_change_percentage_24h||0;
      const up = chg>=0;
      const price = c.current_price>=1 ? '$'+c.current_price.toLocaleString(undefined,{maximumFractionDigits:2}) : '$'+c.current_price.toFixed(4);
      return `<div class="performer-row">
        <div class="performer-left">
          <span class="performer-rank">#${c.market_cap_rank}</span>
          <div><div class="performer-name">${c.name}</div><div class="performer-symbol">${c.symbol.toUpperCase()}</div></div>
        </div>
        <div class="performer-right">
          <div class="performer-price">${price}</div>
          <div class="performer-change ${up?'up':'down'}">${up?'+':''}${chg.toFixed(2)}%</div>
        </div>
      </div>`;
    }

    document.getElementById('gainersWidget').innerHTML = gainers.map(perfRow).join('');
    document.getElementById('losersWidget').innerHTML = losers.map(perfRow).join('');

    // --- TOP 20 TABLE (excl stables) ---
    const top20 = data.filter(c=>!['tether','usd-coin','dai','true-usd','first-digital-usd','ethena-usde'].includes(c.id)).slice(0,20);
    const fmtPct = v => v==null?'--':`<span class="${v>=0?'up':'down'}">${v>=0?'+':''}${v.toFixed(2)}%</span>`;
    const fmtMcap = v => v>=1e12?'$'+(v/1e12).toFixed(2)+'T':v>=1e9?'$'+(v/1e9).toFixed(1)+'B':v>=1e6?'$'+(v/1e6).toFixed(0)+'M':'$'+v.toFixed(0);
    const fmtPrice = v => v>=1000?'$'+v.toLocaleString(undefined,{maximumFractionDigits:0}):v>=1?'$'+v.toFixed(2):'$'+v.toFixed(4);

    document.getElementById('altsTableWidget').innerHTML=`
      <div style="overflow-x:auto">
      <table class="alts-table">
        <thead><tr>
          <th>#</th><th>Coin</th><th>Price</th><th>24H</th><th>7D</th><th>Market Cap</th>
        </tr></thead>
        <tbody>${top20.map((c,i)=>`<tr>
          <td>${c.market_cap_rank}</td>
          <td><strong>${c.name}</strong> <span style="color:var(--text-dim);font-size:10px">${c.symbol.toUpperCase()}</span></td>
          <td>${fmtPrice(c.current_price)}</td>
          <td>${fmtPct(c.price_change_percentage_24h)}</td>
          <td>${fmtPct(c.price_change_percentage_7d_in_currency)}</td>
          <td>${fmtMcap(c.market_cap)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;

  }catch(e){
    console.error('fetchAlts error',e);
  }
}

// ── TREND WIDGET ──────────────────────────────────────────
// Inject live prices into trend cards — called by fetchMarket after CoinGecko loads
function injectPrices(prices){
  if(!prices || !prices.length) return;
  const coins = [
    {coin:'BTC',  id:'bitcoin'},
    {coin:'ETH',  id:'ethereum'},
    {coin:'GOLD', id:'pax-gold'},
  ];
  coins.forEach(({coin, id})=>{
    const data     = prices.find(p=>p.id===id);
    const priceEl  = document.getElementById('trend-price-'+coin);
    if(!data || !priceEl) return;
    priceEl.textContent = '$'+data.current_price.toLocaleString();
    const changeEl = document.getElementById('trend-change-'+coin);
    if(changeEl){
      const chg = data.price_change_percentage_24h || 0;
      const up  = chg >= 0;
      changeEl.className   = 'trend-change '+(up?'up':'down');
      changeEl.textContent = (up?'↑':'↓')+' '+Math.abs(chg).toFixed(2)+'% today';
    }

  });
  const el = document.getElementById('trendWidget');
  if(el) showLastUpdated('trendWidget', Date.now(), false);
}

async function fetchTrend(){
  const el = document.getElementById('trendWidget');
  try{
    const [btcRes, ethRes, goldRes] = await Promise.all([
      fetch(`${BASE}/charts/BTC/manifest.txt?t=${Date.now()}`).then(r=>r.ok?r.text():''),
      fetch(`${BASE}/charts/ETH/manifest.txt?t=${Date.now()}`).then(r=>r.ok?r.text():''),
      fetch(`${BASE}/charts/GOLD/manifest.txt?t=${Date.now()}`).then(r=>r.ok?r.text():'')
    ]);

    function parseManifest(txt){
      const lines = txt.split('\n').map(l=>l.trim()).filter(Boolean);
      let status='neutral', note='', updated='', real_rates=null, etf_flows=null, cot_signal=null;
      lines.forEach(l=>{
        if(l.toLowerCase().startsWith('status:'))      status=l.split(':')[1].trim().toLowerCase();
        else if(l.toLowerCase().startsWith('note:'))        note=l.substring(l.indexOf(':')+1).trim();
        else if(l.toLowerCase().startsWith('updated:'))     updated=l.substring(l.indexOf(':')+1).trim();
        else if(l.toLowerCase().startsWith('real_rates:'))  real_rates=parseFloat(l.split(':')[1].trim());
        else if(l.toLowerCase().startsWith('etf_flows:'))   etf_flows=parseFloat(l.split(':')[1].trim());
        else if(l.toLowerCase().startsWith('cot_signal:'))  cot_signal=l.split(':')[1].trim().toLowerCase();
      });
      return {status,note,updated,real_rates,etf_flows,cot_signal};
    }

    const btc  = parseManifest(btcRes);
    const eth  = parseManifest(ethRes);
    const gold = parseManifest(goldRes);

    // Store globally for logic panel access
    window._cachedTrendData = { BTC: btc, ETH: eth, GOLD: gold };

    const statusConfig = {
      positive: {label:'Positive', color:'#4caf7d', cls:'positive'},
      negative: {label:'Negative', color:'#e05555', cls:'negative'},
      neutral:  {label:'Neutral',  color:'#c9a84c', cls:'neutral'},
    };

    function buildCard(coin, label, data, price, change){
      const s = statusConfig[data.status] || statusConfig.neutral;
      const up = change >= 0;
      const ribbonWidth = data.status==='positive'?80:data.status==='negative'?20:50;
      const sparkline = renderSparkline(coin);
      const priceLoading = price === '---';

      // Glow config per status
      const glowColor = data.status==='positive' ? 'rgba(76,175,125,0.12)' :
                        data.status==='negative' ? 'rgba(224,85,85,0.10)'  :
                        'rgba(107,101,96,0.08)';
      const glowBorder = data.status==='positive' ? '#4caf7d' :
                         data.status==='negative' ? '#e05555' :
                         '#6b6560';
      const glowAnim   = data.status==='positive' ? 'animation:cardglow 2.5s ease-in-out infinite' :
                         data.status==='negative' ? 'animation:cardglowred 2.5s ease-in-out infinite' : '';
      const coinIcon   = data.status==='positive' ? '●' :
                         data.status==='negative' ? '●' : '●';
      const iconColor  = s.color;

      return `<div class="trend-card ${s.cls}" style="position:relative;overflow:hidden">
        <!-- Status glow background -->
        <div style="position:absolute;inset:0;background:${glowColor};pointer-events:none;${glowAnim}"></div>
        <!-- Top border glow -->
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${glowBorder};box-shadow:0 0 8px ${glowBorder};opacity:0.8"></div>

        <div class="trend-coin-label" style="position:relative">
          <div style="display:flex;align-items:center;gap:8px">
            <!-- Coin icon with glow -->
            <div style="width:32px;height:32px;border-radius:50%;background:${glowColor};border:1.5px solid ${glowBorder};display:flex;align-items:center;justify-content:center;box-shadow:0 0 10px ${glowBorder}60;${glowAnim}">
              <span style="font-size:11px;font-weight:900;color:${iconColor};letter-spacing:-0.5px">${coin==='GOLD'?'XAU':label.substring(0,3)}</span>
            </div>
            <span style="font-size:11px;letter-spacing:3px;color:var(--text-muted)">${label}</span>
          </div>
          <span class="trend-live" style="color:${s.color}">
            <span class="trend-live-dot" style="background:${s.color}"></span>
            LIVE
          </span>
        </div>
        <div class="trend-price" id="trend-price-${coin}" style="position:relative">${priceLoading ? '<span class="trend-price-loading">---</span>' : '$'+price}</div>
        <div class="trend-ribbon" style="position:relative">
          <div class="trend-ribbon-fill" style="width:${ribbonWidth}%;background:${s.color};box-shadow:0 0 8px ${s.color}40"></div>
        </div>
        <div class="trend-ribbon-labels"><span>Negative</span><span>Neutral</span><span>Positive</span></div>
        <div class="trend-status-wrap" style="position:relative">
          <div class="trend-status-text" style="color:${s.color}">${s.label}</div>
        </div>
        <div class="trend-change ${priceLoading ? '' : (change >= 0 ? 'up' : 'down')}" id="trend-change-${coin}" style="margin-top:8px;position:relative">${priceLoading ? '' : (change >= 0 ? '↑' : '↓')+' '+Math.abs(change).toFixed(2)+'% today'}</div>
        ${sparkline}
        ${data.note?`<div class="trend-note" style="position:relative">${data.note}</div>`:''}
        <div class="trend-updated" style="position:relative;color:var(--text-muted)">Updated: ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
        <!-- View Logic chevron -->
        <div style="border-top:1px solid var(--text-dim);margin-top:14px;padding-top:10px;position:relative">
          <button onclick="toggleLogicPanel('${coin}',this)" style="background:none;border:1px solid var(--text-dim);color:var(--text-muted);font-family:'DM Mono',monospace;font-size:9px;letter-spacing:2px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 0;width:100%;text-transform:uppercase;transition:all 0.2s" onmouseover="this.style.borderColor='var(--gold)';this.style.color='var(--gold)'" onmouseout="this.style.borderColor='var(--text-dim)';this.style.color='var(--text-muted)'">
            <span>+ Market Health Check</span>
          </button>
          <div id="logicPanel_${coin}" style="display:none;border-top:1px solid var(--text-dim);margin-top:8px"></div>
        </div>
      </div>`;
    }

    // ── Step 1: Render immediately with manifest data, prices as placeholders ──
    el.innerHTML =
      buildCard('BTC',  'BTC / USD',  btc,  '---', 0) +
      buildCard('ETH',  'ETH / USD',  eth,  '---', 0) +
      buildCard('GOLD', 'GOLD / USD', gold, '---', 0);

    recordDailyState('BTC',  btc.status);
    recordDailyState('ETH',  eth.status);
    recordDailyState('GOLD', gold.status);

    // ── Step 2: Inject prices — injectPrices() is global, called by fetchMarket too ──
    injectPrices(cachedMarketData);


  }catch(e){
    const cached = loadCache('bl_trend', 86400000);
    if(cached && cached.data){
      el.innerHTML = cached.data;
      showLastUpdated('trendWidget', cached.ts, true);
    } else {
      setTimeout(()=>fetchTrend(), 3000);
    }
  }
}

async function fetchMarket(){
  // Show cached data immediately while fetching
  const cached = loadCache('bl_market', 3600000);
  if(cached && cached.data && cached.data.length && cached.data.find(c=>c.id==='pax-gold')){
    cachedMarketData = cached.data;
    const top5c = cached.data.filter(c=>c.id!=='pax-gold').slice(0,5);
    renderTop5(top5c);
    updateTicker(top5c);
    if(cached.stale) showLastUpdated('marketGrid', cached.ts, true);
    else showLastUpdated('marketGrid', cached.ts, false);
  }
  try{
    const data = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h,7d,30d,1y').then(r=>r.json());
    cachedMarketData = data;
    saveCache('bl_market', data);
    injectPrices(data); // inject prices into trend cards immediately
    const top5 = data.filter(c=>c.id!=='pax-gold').slice(0,5);
    renderTop5(top5);
    updateTicker(top5);
    showLastUpdated('marketGrid', Date.now(), false);

    // ATH Banner
    const btc = data.find(c=>c.id==='bitcoin');
    if(btc && btc.ath){
      const pctFromAth = ((btc.current_price - btc.ath) / btc.ath * 100);
      const pctBelow = Math.abs(pctFromAth).toFixed(1);
      const barWidth = Math.max(5, 100 - Math.abs(pctFromAth));
      document.getElementById('athPct').textContent = '-' + pctBelow + '%';
      document.getElementById('athSub').textContent = `below ATH of $${btc.ath.toLocaleString()}`;
      document.getElementById('athBar').style.width = barWidth + '%';
      document.getElementById('athBanner').style.display = 'flex';
    }
  }catch(e){
    if(!cached) document.getElementById('marketGrid').innerHTML='<div class="loading" style="grid-column:1/-1">Market data unavailable</div>';
    else showLastUpdated('marketGrid', cached.ts, true);
    setTimeout(()=>fetchMarket(), 5000);
  }
}

function renderTop5(top5){
  document.getElementById('marketGrid').innerHTML=top5.map((c,i)=>{
    const up=c.price_change_percentage_24h>=0;
    return `<div class="coin-card">
      <div class="coin-rank">0${i+1}</div>
      <div class="coin-name">${c.name}</div>
      <div class="coin-symbol">${c.symbol.toUpperCase()}</div>
      <div class="coin-price">$${c.current_price.toLocaleString()}</div>
      <div class="coin-change ${up?'up':'down'}">${up?'↑':'↓'} ${Math.abs(c.price_change_percentage_24h).toFixed(2)}%</div>
      <div class="coin-cap">$${(c.market_cap/1e9).toFixed(1)}B cap</div>
    </div>`;
  }).join('');
}

function updateTicker(data){
  const items=data.map(c=>{
    const up=c.price_change_percentage_24h>=0;
    return `<span class="ticker-item"><span class="ticker-name">${c.symbol.toUpperCase()}</span><span class="ticker-price">$${c.current_price.toLocaleString()}</span><span class="ticker-change ${up?'up':'down'}">${up?'↑':'↓'}${Math.abs(c.price_change_percentage_24h).toFixed(2)}%</span></span>`;
  }).join('');
  document.getElementById('tickerTrack').innerHTML = items + items;
  // Adjust animation speed based on number of items
  const track = document.getElementById('tickerTrack');
  const itemCount = track.querySelectorAll('.ticker-item').length / 2;
  const duration = Math.max(20, itemCount * 3); // 3s per item, min 20s
  track.style.animationDuration = duration + 's';
}

async function fetchNews(){
  const el=document.getElementById('newsList');
  const cached = loadCache('bl_news', 86400000);
  if(cached && cached.data){ el.innerHTML = cached.data; if(cached.stale) showLastUpdated('newsList', cached.ts, true); }
  try{
    const res=await fetch(`${BASE}/news.json?t=${Date.now()}`);
    if(!res.ok) throw new Error();
    const items=await res.json();
    window._newsItems = items;
    if(!items.length){el.innerHTML='<div class="empty-news">No analysis published yet.</div>';return}
    const n=items[0];
    const shareText = encodeURIComponent(`${n.title}\n\nRead the full analysis 👇\nhttps://bitlogicalpha.com\n\n#Bitcoin #Crypto #Gold @QuantAlphaTrend`);
    const shareUrl = `https://x.com/intent/tweet?text=${shareText}`;
    const firstPara = n.body ? n.body.split('\n').filter(p=>p.trim())[0] || '' : '';
    const html = `
      <div class="news-item">
        <div class="news-meta-row"><span class="news-date">${n.date||''}</span></div>
        <div class="news-preview">
          <a class="news-preview-title news-title-link" href="${BASE}/article.html?id=0" target="_blank">${n.title||''}</a>
        </div>
        <div class="news-full" id="newsFull">
          <div class="news-body"><p>${firstPara}</p></div>
          <div class="news-footer">
            <a class="news-share" href="${BASE}/article.html?id=0" target="_blank" style="color:var(--gold);font-size:9px;letter-spacing:2px;text-decoration:none">READ FULL ARTICLE →</a>
            <a class="news-share" href="${shareUrl}" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              Share on X
            </a>
          </div>
        </div>
      </div>`;
    el.innerHTML = html;
    saveCache('bl_news', html);
    showLastUpdated('newsList', Date.now(), false);
    // Also populate news tab if open
    renderNewsTab(items);
  }catch(e){
    if(!cached) el.innerHTML='<div class="empty-news">No analysis published yet.</div>';
    else showLastUpdated('newsList', cached.ts, true);
  }
}

function renderNewsTab(items){
  const el = document.getElementById('newsTabList');
  if(!el || !items || !items.length) return;
  el.innerHTML = items.map((n,i)=>`
    <a href="${BASE}/article.html?id=${i}" target="_blank" style="display:block;background:var(--surface);padding:20px 24px;border-left:2px solid var(--text-dim);text-decoration:none;transition:border-color 0.2s,background 0.2s;margin-bottom:2px" onmouseover="this.style.borderColor='var(--gold)';this.style.background='var(--surface2)'" onmouseout="this.style.borderColor='var(--text-dim)';this.style.background='var(--surface)'">
      <div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:6px">${n.date||''}</div>
      <div style="font-family:'Playfair Display',serif;font-size:15px;font-weight:700;color:var(--text);line-height:1.3;margin-bottom:8px">${n.title||''}</div>
      <div style="font-size:9px;color:var(--gold);letter-spacing:2px">READ FULL ARTICLE →</div>
    </a>`).join('');
}

// ── INSIGHTS ──────────────────────────────────────────────
function fgColor(v){
  if(v>=75) return '#4caf7d';
  if(v>=55) return '#7bc47f';
  if(v>=45) return '#c9a84c';
  if(v>=25) return '#e07755';
  return '#e05555';
}

async function fetchFearGreed(){
  // Show cached immediately
  const cached = loadCache('bl_fg', 3600000);
  if(cached && cached.data){
    applyFearGreedData(cached.data);
    window._fgHistory = cached.data;
    if(cached.stale) showLastUpdated('fgHistory', cached.ts, true);
  }
  try{
    const data=await fetch('https://api.alternative.me/fng/?limit=30').then(r=>r.json());
    applyFearGreedData(data.data);
    window._fgHistory = data.data;
    saveCache('bl_fg', data.data);
    showLastUpdated('fgHistory', Date.now(), false);

    // Load analyst comment
    try{
      const commentRes = await fetch(`${BASE}/charts/FG/manifest.txt?t=${Date.now()}`);
      if(commentRes.ok){
        const txt = await commentRes.text();
        let comment='', date='';
        txt.split('\n').forEach(l=>{
          if(l.toLowerCase().startsWith('comment:')) comment=l.substring(l.indexOf(':')+1).trim();
          else if(l.toLowerCase().startsWith('date:')) date=l.substring(l.indexOf(':')+1).trim();
        });
        if(comment){
          document.getElementById('fgCommentText').textContent=comment;
          document.getElementById('fgCommentDate').textContent=date;
          document.getElementById('fgCommentWrap').style.display='block';
        }
      }
    }catch(e){}
  }catch(e){
    if(!cached) document.getElementById('fgClass').textContent='Unavailable';
  }
}

function applyFearGreedData(items){
  const latest = items[0];
  const value  = parseInt(latest.value);
  const color  = fgColor(value);

  // BitLogic classification — overrides API label
  function blLabel(v){
    if(v>=75) return 'Extreme Greed';
    if(v>=56) return 'Greed';
    if(v>=45) return 'Neutral';
    if(v>=25) return 'Fear';
    return 'Extreme Fear';
  }
  const classification = blLabel(value);

  // ── Score number + background ghost ──
  document.getElementById('fgVal').textContent = value;
  document.getElementById('fgVal').style.color = color;
  document.getElementById('fgBgScore').textContent = value;
  document.getElementById('fgClass').textContent = classification;
  document.getElementById('fgClass').style.color = color;
  document.getElementById('fgUpdated').textContent =
    `Updated: ${new Date(latest.timestamp*1000).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`;

  // ── SVG gauge: arc + glow filter + needle + ticks ──
  const svg = document.getElementById('fgSvg');

  // Inject glow filter if not present
  if(!svg.querySelector('defs')){
    const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
    defs.innerHTML = `
      <filter id="fgGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="${color}" flood-opacity="0.7"/>
      </filter>`;
    svg.insertBefore(defs, svg.firstChild);
  } else {
    const shadow = svg.querySelector('feDropShadow');
    if(shadow){ shadow.setAttribute('flood-color', color); }
  }

  // Arc — full circle, starts at top (rotate handled by needle math)
  // circumference = 2π×80 = 502.65
  const circ = 502;
  const arc  = document.getElementById('fgArc');
  arc.style.stroke = color;
  // Arc goes from top, clockwise. We use strokeDashoffset to show value%
  // SVG starts at 3 o'clock; we rotate the whole SVG -90deg via transform
  arc.setAttribute('transform','rotate(-90,100,100)');
  arc.style.strokeDasharray = circ;
  setTimeout(()=>{ arc.style.strokeDashoffset = circ - (value/100)*circ; }, 50);

  // Tick marks every 10 units
  const tickGroup = document.getElementById('fgTicks');
  tickGroup.innerHTML = '';
  for(let t=0; t<=100; t+=10){
    const angle = (t/100)*360 - 90; // -90 so 0 = top
    const rad   = angle * Math.PI / 180;
    const isMajor = t%50===0;
    const r1 = isMajor ? 68 : 72;
    const r2 = 80;
    const x1 = 100 + r1*Math.cos(rad);
    const y1 = 100 + r1*Math.sin(rad);
    const x2 = 100 + r2*Math.cos(rad);
    const y2 = 100 + r2*Math.sin(rad);
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',x1); line.setAttribute('y1',y1);
    line.setAttribute('x2',x2); line.setAttribute('y2',y2);
    line.setAttribute('stroke','#f0ece4');
    line.setAttribute('stroke-width', isMajor ? '1.5' : '0.8');
    tickGroup.appendChild(line);
  }

  // Needle rotation: 0 = top = 0 score, 360 = full = 100 score
  const needleAngle = (value/100)*360;
  const needle = document.getElementById('fgNeedle');
  setTimeout(()=>{
    needle.setAttribute('transform',`rotate(${needleAngle},100,100)`);
    needle.style.stroke = color;
  }, 50);

  // ── History bars ──
  const hist = document.getElementById('fgHistory');
  hist.innerHTML = [...items].reverse().map(item=>{
    const v = parseInt(item.value);
    const c = fgColor(v);
    const h = Math.max(8,(v/100)*48);
    const d = new Date(item.timestamp*1000).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    return `<div class="fg-bar-item" style="background:${c};height:${h}px;opacity:0.7" data-tip="${d}: ${v}"></div>`;
  }).join('');

  // ── Gradient scale with position pointer ──
  const scaleWrap = document.getElementById('fgScaleWrap');
  if(scaleWrap){
    // Pointer sits at value% across the bar
    const pct = value; // 0-100
    scaleWrap.innerHTML = `
      <div style="position:relative;margin-bottom:16px">
        <div style="position:absolute;left:${pct}%;transform:translateX(-50%);top:-14px;font-size:8px;color:${color};letter-spacing:1px;font-weight:700;white-space:nowrap">${value}</div>
        <div style="position:absolute;left:${pct}%;transform:translateX(-50%);top:-5px;width:2px;height:8px;background:${color};border-radius:1px;box-shadow:0 0 4px ${color}"></div>
        <div style="height:8px;border-radius:4px;background:linear-gradient(90deg,#e05555 0%,#e07755 25%,#c9a84c 45%,#7bc47f 65%,#4caf7d 100%);overflow:visible"></div>
        <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:8px;color:var(--text-dim);letter-spacing:0.5px">
          <span>Extreme Fear</span><span>Fear</span><span>Neutral</span><span>Greed</span><span>Extreme Greed</span>
        </div>
      </div>`;
  }
}

async function fetchGlobalData(){
  if(cachedGlobalData) return cachedGlobalData;
  const data = await fetch('https://api.coingecko.com/api/v3/global').then(r=>r.json());
  cachedGlobalData = data;
  return data;
}

async function fetchDominance(){
  const cached = loadCache('bl_dominance', 3600000);
  if(cached && cached.data){
    applyDominanceData(cached.data);
    if(cached.stale) showLastUpdated('domLegend', cached.ts, true);
  }
  try{
    const data = await fetchGlobalData();
    applyDominanceData(data);
    saveCache('bl_dominance', data);
    showLastUpdated('domLegend', Date.now(), false);
  }catch(e){
    if(!cached) setTimeout(()=>fetchDominance(),5000);
  }
}

function applyDominanceData(data){
    const mcp=data.data.market_cap_percentage;
    const btc=mcp.btc||0;
    const eth=mcp.eth||0;
    const other=100-btc-eth;
    const circ=390;
    document.getElementById('domBtc').style.strokeDashoffset=circ-(btc/100)*circ;
    document.getElementById('domBtcVal').textContent=btc.toFixed(1)+'%';
    const ethArc=document.getElementById('domEth');
    ethArc.style.strokeDasharray=`${(eth/100)*circ} ${circ}`;
    ethArc.style.strokeDashoffset=-(btc/100)*circ;
    document.getElementById('domLegend').innerHTML=[
      {name:'Bitcoin',sym:'BTC',val:btc,color:'#f7931a', tip:'BTC dominance shows Bitcoin\'s share of total crypto market cap. High dominance = investors prefer BTC over altcoins.'},
      {name:'Ethereum',sym:'ETH',val:eth,color:'#627eea', tip:'ETH dominance reflects Ethereum\'s market share. Rising ETH dom often signals growing interest in DeFi and smart contracts.'},
      {name:'Others',sym:'ALT',val:other,color:'#3a3530', tip:'Altcoin dominance is everything outside BTC and ETH. When this rises, capital is rotating into smaller coins — altcoin season.'},
    ].map(item=>`
      <div>
        <div class="dom-item">
          <div class="dom-dot" style="background:${item.color}"></div>
          <span class="dom-item-name">
            <span class="dom-tooltip-wrap">
              ${item.name} (${item.sym})
              <span class="dom-tooltip-icon">?</span>
              <span class="dom-tooltip">${item.tip}</span>
            </span>
          </span>
          <span class="dom-item-val" style="color:${item.color}">${item.val.toFixed(1)}%</span>
        </div>
        <div class="dom-item-bar"><div class="dom-item-bar-fill" style="width:${item.val}%;background:${item.color}"></div></div>
      </div>`).join('');
    const GOLD_MCAP_T=21;
    const cryptoMcapT=(data.data.total_market_cap.usd||0)/1e12;
    const total=GOLD_MCAP_T+cryptoMcapT;
    const ratio=(GOLD_MCAP_T/cryptoMcapT).toFixed(1);
    document.getElementById('goldBar').style.width=(GOLD_MCAP_T/total)*100+'%';
    document.getElementById('cryptoBar').style.width=(cryptoMcapT/total)*100+'%';
    document.getElementById('goldMcap').textContent='$'+GOLD_MCAP_T+'T';
    document.getElementById('cryptoMcap').textContent='$'+cryptoMcapT.toFixed(1)+'T';
    document.getElementById('goldCompNote').innerHTML=`Gold's market cap is currently <strong>${ratio}x larger</strong> than the entire crypto market. If crypto were to reach just half of gold's market cap, it would represent a <strong>${((GOLD_MCAP_T/2)/cryptoMcapT).toFixed(1)}x increase</strong> from current levels.`;
    document.getElementById('goldComparison').style.display='block';
}

async function fetchMetrics(){
  const cached = loadCache('bl_metrics', 3600000);
  if(cached && cached.data){
    document.getElementById('metricsGrid').innerHTML = cached.data;
    if(cached.stale) showLastUpdated('metricsGrid', cached.ts, true);
  }
  try{
    const [global, btcArr] = await Promise.all([
      fetchGlobalData(),
      Promise.resolve(cachedMarketData.length ? cachedMarketData : null)
    ]);
    const g = global.data;
    const b = btcArr ? btcArr.find(c=>c.id==='bitcoin') : null;
    if(!b) throw new Error('No BTC data');
    const up=b.price_change_percentage_24h>=0;
    const metrics=[
      {label:'Total Market Cap',value:'$'+((g.total_market_cap.usd||0)/1e12).toFixed(2)+'T',sub:'All crypto combined',bar:Math.min(100,((g.total_market_cap.usd||0)/3e12)*100)},
      {label:'24h Market Volume',value:'$'+((g.total_volume.usd||0)/1e9).toFixed(0)+'B',sub:'Global trading volume',bar:Math.min(100,((g.total_volume.usd||0)/500e9)*100)},
      {label:'BTC 24h Change',value:(up?'+':'')+b.price_change_percentage_24h.toFixed(2)+'%',sub:'$'+b.current_price.toLocaleString(),bar:Math.abs(b.price_change_percentage_24h)*5,color:up?'#4caf7d':'#e05555'},
      {label:'Active Cryptocurrencies',value:(g.active_cryptocurrencies||0).toLocaleString(),sub:'Listed on CoinGecko',bar:60},
    ];
    const html = metrics.map(m=>`
      <div class="sentiment-card">
        <div class="sc-label">${m.label}</div>
        <div class="sc-value" style="${m.color?'color:'+m.color:''}">${m.value}</div>
        <div class="sc-sub">${m.sub}</div>
        <div class="sc-bar"><div class="sc-bar-fill" style="width:${m.bar}%;background:${m.color||'var(--gold)'}"></div></div>
      </div>`).join('');
    document.getElementById('metricsGrid').innerHTML = html;
    saveCache('bl_metrics', html);
    showLastUpdated('metricsGrid', Date.now(), false);
  }catch(e){
    if(!cached) setTimeout(()=>fetchMetrics(),5000);
    else showLastUpdated('metricsGrid', cached.ts, true);
  }
}

function getWeekKey(dateStr){
  if(!dateStr) return 'Unknown Week';
  // Handle "06 Apr 2026" format
  const months={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
  let d;
  const parts = dateStr.trim().split(/\s+/);
  if(parts.length===3){
    const day=parseInt(parts[0]);
    const mon=months[parts[1].toLowerCase().substring(0,3)];
    const year=parseInt(parts[2]);
    if(!isNaN(day)&&mon!==undefined&&!isNaN(year)) d=new Date(year,mon,day);
  }
  if(!d||isNaN(d)) d=new Date(dateStr);
  if(isNaN(d)) return 'Unknown Week';
  const day=d.getDay();
  const monday=new Date(d);
  monday.setDate(d.getDate()-(day===0?6:day-1));
  const sunday=new Date(monday);
  sunday.setDate(monday.getDate()+6);
  const fmt=(dt)=>dt.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
  return `${fmt(monday)} — ${fmt(sunday)}`;
}

function toggleWeek(el){
  const item=el.closest('.week-item');
  const body=item.querySelector('.week-body');
  const icon=el.querySelector('.week-toggle');
  body.classList.toggle('open');
  icon.classList.toggle('open');
  item.classList.toggle('expanded');
}

function togglePost(el){
  const expand=el.nextElementSibling;
  expand.classList.toggle('open');
}

async function fetchWeeklySummary(){
  const el=document.getElementById('weeklyList');
  const cachedWS = loadCache('bl_weekly', 3600000);
  if(cachedWS && cachedWS.data) el.innerHTML = cachedWS.data;
  try{
    const res=await fetch(`${BASE}/news.json?t=${Date.now()}`);
    if(!res.ok) throw new Error();
    const items=await res.json();
    if(!items.length){el.innerHTML='<div class="empty-week">No posts yet — weekly summaries will appear automatically.</div>';return}
    const weeks={};
    items.forEach(item=>{
      const key=getWeekKey(item.date||'');
      if(!weeks[key]) weeks[key]=[];
      weeks[key].push(item);
    });
    el.innerHTML=Object.entries(weeks).map(([week,posts],i)=>`
      <div class="week-item ${i===0?'expanded':''}">
        <div class="week-header" onclick="toggleWeek(this)">
          <div class="week-header-left">
            <div class="week-label">Week of ${week}</div>
            <div class="week-count">${posts.length} post${posts.length>1?'s':''}</div>
          </div>
          <div class="week-toggle ${i===0?'open':''}">▼</div>
        </div>
        <div class="week-body ${i===0?'open':''}">
          ${posts.map(p=>`
            <div class="week-post" onclick="togglePost(this)">
              <div class="week-post-date">${p.date||''}</div>
              <a class="week-post-title" href="${p.url||'#'} target="_blank" onclick="event.stopPropagation()">${p.title||''}</a>
              <div class="week-post-arrow">→</div>
            </div>
            <div class="week-post-expand">
              ${p.body?`<div class="week-post-excerpt">${p.body.split('\n').filter(x=>x.trim()).map(x=>{
                if(/^[1-9]\d*\./.test(x.trim())) return `<p class="news-list-item">${x}</p>`;
                return `<p>${x}</p>`;
              }).join('')}</div>`:''}
            </div>`).join('')}
        </div>
      </div>`).join('');
    saveCache('bl_weekly', {data: el.innerHTML});
  }catch(e){if(!cachedWS) el.innerHTML='<div class="empty-week">No posts yet.</div>'}
}

function buildPerfCard(name, color, price, rows, winners){
  const fmt = v => v==null||isNaN(v) ? '--' : (v>=0?'+':'')+v.toFixed(2)+'%';
  const perfColor = v => v==null ? 'var(--text-dim)' : v>=0 ? '#4caf7d' : '#e05555';
  const perfBar   = v => v==null ? 0 : Math.min(100, Math.abs(v)*3);
  const rowsHtml  = rows.map((r,i) => {
    const isWinner = winners[i] === name;
    return '<div class="perf-row">'
      +'<div class="perf-period">'+r.label+(isWinner?' ★':'')+'</div>'
      +'<div class="perf-bar-wrap"><div class="perf-bar-inner" style="width:'+perfBar(r.val)+'%;background:'+perfColor(r.val)+'"></div></div>'
      +'<div class="perf-val" style="color:'+perfColor(r.val)+'">'+fmt(r.val)+'</div>'
      +'</div>';
  }).join('');
  return '<div class="perf-card">'
    +'<div class="perf-card-header">'
    +'<div class="perf-dot" style="background:'+color+'"></div>'
    +'<div class="perf-name">'+name+'</div>'
    +'</div>'
    +'<div class="perf-price">$'+price.toLocaleString()+'</div>'
    +'<div class="perf-rows">'+rowsHtml+'</div>'
    +'</div>';
}

async function fetchPerformance(){
  const el = document.getElementById('perfWrap');
  const cachedPerf = loadCache('bl_perf', 3600000);
  if(cachedPerf && cachedPerf.data && cachedPerf.data.html) el.innerHTML = cachedPerf.data.html;
  try{
    let prices = cachedMarketData;
    let attempts = 0;
    while((!prices||!prices.length||!prices.find(p=>p.id==='pax-gold'))&&attempts<10){
      await new Promise(r=>setTimeout(r,500));
      prices = cachedMarketData;
      attempts++;
    }
    if(!prices||!prices.length) throw new Error('No market data');
    const btc  = prices.find(d=>d.id==='bitcoin');
    const gold = prices.find(d=>d.id==='pax-gold');
    if(!btc||!gold){ el.innerHTML='<div class="loading">Data unavailable</div>'; return; }

    function perfColor(v){ return v>=0?'#4caf7d':'#e05555'; }
    function perfBar(v){ return Math.min(100, Math.abs(v)*3); }
    function fmt(v){ if(v==null) return '--'; return (v>=0?'+':'')+v.toFixed(2)+'%'; }

    const periods = [
      { label:'24h',  btcVal: btc.price_change_percentage_24h,  goldVal: gold.price_change_percentage_24h },
      { label:'7d',   btcVal: btc.price_change_percentage_7d_in_currency,  goldVal: gold.price_change_percentage_7d_in_currency },
      { label:'30d',  btcVal: btc.price_change_percentage_30d_in_currency, goldVal: gold.price_change_percentage_30d_in_currency },
      { label:'1y',   btcVal: btc.price_change_percentage_1y_in_currency,  goldVal: gold.price_change_percentage_1y_in_currency },
    ];

    // Determine winner for each period
    const winners = periods.map(p=>{
      if(p.btcVal==null||p.goldVal==null) return null;
      return p.btcVal > p.goldVal ? 'BTC' : 'GOLD';
    });

    

    const btcRows  = periods.map(p=>({label:p.label, val:p.btcVal}));
    const goldRows = periods.map(p=>({label:p.label, val:p.goldVal}));

    const btcWins  = winners.filter(w=>w==='BTC').length;
    const goldWins = winners.filter(w=>w==='GOLD').length;
    const winnerText = btcWins > goldWins
      ? `<strong>BTC</strong> is outperforming Gold in ${btcWins} of 4 timeframes`
      : goldWins > btcWins
      ? `<strong>Gold</strong> is outperforming BTC in ${goldWins} of 4 timeframes — risk-off environment`
      : `<strong>BTC and Gold</strong> are evenly matched across timeframes`;

    el.innerHTML = `
      <div class="perf-grid">
        ${buildPerfCard('BTC', '#f7931a', btc.current_price, btcRows, winners)}
        ${buildPerfCard('GOLD', '#c9a84c', gold.current_price, goldRows, winners)}
      </div>
      <div class="perf-winner">★ = outperformer for that period · ${winnerText}</div>`;

  }catch(e){
    el.innerHTML='<div class="loading">Performance data unavailable</div>';
  }
}

// ── DIVERGENCE TRACKER ───────────────────────────────────
function renderDivergenceTracker(){
  const el = document.getElementById('divergenceWidget');
  if(!el) return;

  const fedData = window._fedLiqData;
  const fgData  = window._fgHistory;

  if(!fedData || !fedData.length || !fgData || !fgData.length){
    let attempts = 0;
    const retry = setInterval(()=>{
      attempts++;
      if(window._fedLiqData && window._fedLiqData.length && window._fgHistory && window._fgHistory.length){
        clearInterval(retry); renderDivergenceTracker();
      } else if(attempts >= 30){
        clearInterval(retry);
        if(!window._fgHistory){
          fetch('https://api.alternative.me/fng/?limit=30')
            .then(r=>r.json())
            .then(d=>{ window._fgHistory = d.data; renderDivergenceTracker(); })
            .catch(()=>{ if(el) el.innerHTML='<div class="loading">Data unavailable</div>'; });
        }
      }
    }, 500);
    return;
  }

  // ── Build series ──────────────────────────────────────────
  const liqSeries = fedData.map(d => ({
    date: d.date,
    netLiq: d.balance_sheet - d.tga - d.rrp
  }));
  const liqMin = Math.min(...liqSeries.map(d=>d.netLiq));
  const liqMax = Math.max(...liqSeries.map(d=>d.netLiq));
  const liqNorm = liqSeries.map(d => ({
    date: d.date, raw: d.netLiq,
    norm: Math.round(((d.netLiq - liqMin)/(liqMax - liqMin))*100)
  }));

  const fgSeries = fgData.map(d => ({
    date:  new Date(d.timestamp*1000).toISOString().slice(0,10),
    value: parseInt(d.value)
  })).reverse();

  const latestLiq = liqNorm[liqNorm.length-1];
  const latestFG  = fgSeries[fgSeries.length-1];

  // ── Divergence Score: (Liq% change) - (Sentiment% change) ─
  const prevLiq = liqNorm.length > 1 ? liqNorm[liqNorm.length-2] : latestLiq;
  const prevFG  = fgSeries.length > 1 ? fgSeries[fgSeries.length-2] : latestFG;
  const liqPctChange  = prevLiq.norm !== 0 ? ((latestLiq.norm - prevLiq.norm) / Math.max(1,Math.abs(prevLiq.norm))) * 100 : 0;
  const fgPctChange   = prevFG.value  !== 0 ? ((latestFG.value  - prevFG.value)  / Math.max(1,prevFG.value))  * 100 : 0;
  const divScore = Math.round((liqPctChange - fgPctChange) * 10) / 10;

  // ── Signal classification ─────────────────────────────────
  let signal, signalColor, signalDesc, glowColor, glowAnim;
  if(divScore > 15){
    signal = 'BULLISH DIVERGENCE'; signalColor = '#4caf7d';
    glowColor = 'rgba(76,175,125,0.12)'; glowAnim = 'pulse';
    signalDesc = 'High Conviction Buy. Liquidity is expanding while sentiment is falling. Smart money is loading — retail is still fearful. Historically one of the strongest risk/reward entry signals.';
  } else if(divScore > 5){
    signal = 'ACCUMULATION'; signalColor = '#7bc47f';
    glowColor = 'rgba(76,175,125,0.06)'; glowAnim = 'static';
    signalDesc = 'Leaning Bullish. Liquidity trending higher than sentiment. Conditions are improving faster than the crowd realises. Early accumulation zone.';
  } else if(divScore >= -5){
    signal = 'ALIGNED'; signalColor = '#c9a84c';
    glowColor = 'none'; glowAnim = 'none';
    signalDesc = 'Neutral. Sentiment and liquidity moving in the same direction. No meaningful divergence detected. Watch for a breakout in either direction.';
  } else if(divScore >= -15){
    signal = 'DISTRIBUTION'; signalColor = '#e07755';
    glowColor = 'rgba(224,119,85,0.06)'; glowAnim = 'static';
    signalDesc = 'Leaning Bearish. Sentiment rising faster than liquidity justifies. Distribution conditions — the crowd is buying while conditions quietly deteriorate.';
  } else {
    signal = 'BEARISH DIVERGENCE'; signalColor = '#e05555';
    glowColor = 'rgba(224,85,85,0.12)'; glowAnim = 'pulse';
    signalDesc = 'High Conviction Sell. Liquidity contracting while sentiment remains elevated. Exit the Greed signal. Historically precedes sharp corrections.';
  }

  // ── Chart data — last 10 FG daily + last 10 liq ──────────
  const fgLast10  = fgSeries.slice(-10);
  const liqLast10 = liqNorm.slice(-10);
  const chartData = fgLast10.map(fg => {
    const liq = liqLast10.reduce((c,d) =>
      Math.abs(new Date(d.date)-new Date(fg.date)) < Math.abs(new Date(c.date)-new Date(fg.date)) ? d : c
    , liqLast10[0]);
    return { date: fg.date, fg: fg.value, liq: liq.norm, raw: liq.raw };
  });
  if(chartData.length > 0){
    chartData[chartData.length-1].fg  = latestFG.value;
    chartData[chartData.length-1].liq = latestLiq.norm;
  }

  // ── SVG ───────────────────────────────────────────────────
  const w=600, h=260, pad=12;
  const pts = chartData.length;
  const xStep = (w-pad*2)/(pts-1);
  const liqLine = chartData.map((d,i)=>`${pad+i*xStep},${h-pad-(d.liq/100)*(h-pad*2)}`).join(' ');
  const fgLine  = chartData.map((d,i)=>`${pad+i*xStep},${h-pad-(d.fg/100)*(h-pad*2)}`).join(' ');
  const areaPoints = [
    ...chartData.map((d,i)=>`${pad+i*xStep},${h-pad-(d.liq/100)*(h-pad*2)}`),
    ...[...chartData].reverse().map((d,i)=>`${pad+(pts-1-i)*xStep},${h-pad-(d.fg/100)*(h-pad*2)}`)
  ].join(' ');

  // Y axis ticks
  const yTicks = [0,25,50,75,100].map(v=>{
    const y = h-pad-(v/100)*(h-pad*2);
    const rawVal = liqMin+(v/100)*(liqMax-liqMin);
    return '<text x="'+(pad-6)+'" y="'+(y+3)+'" text-anchor="end" font-size="8" fill="#e07755" font-family="DM Mono,monospace" opacity="0.8">'+v+'</text>'+
           '<line x1="'+pad+'" y1="'+y+'" x2="'+(w-pad)+'" y2="'+y+'" stroke="rgba(255,255,255,'+(v===50?'0.06':'0.03')+')" stroke-dasharray="'+(v===50?'4,4':'2,4')+'"/>'+
           '<text x="'+(w-pad+6)+'" y="'+(y+3)+'" text-anchor="start" font-size="8" fill="#4caf7d" font-family="DM Mono,monospace" opacity="0.8">$'+(rawVal/1000).toFixed(1)+'T</text>';
  }).join('');

  const glowStyle = glowAnim==='pulse'
    ? 'animation:scorebreath 2s ease-in-out infinite;'
    : '';

  el.innerHTML = `
    <!-- Top cards -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:2px;margin-bottom:2px" id="divGrid">
      <div style="background:var(--surface2);padding:20px 16px;text-align:center">
        <div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">Fear & Greed</div>
        <div style="font-family:'Playfair Display',serif;font-size:32px;font-weight:700;color:${fgColor(latestFG.value)};line-height:1">${latestFG.value}</div>
        <div style="font-size:9px;color:var(--text-dim);letter-spacing:1px;margin-top:6px">${latestFG.value>=56?'Greed':latestFG.value>=45?'Neutral':latestFG.value>=25?'Fear':'Extreme Fear'}</div>
      </div>
      <div style="background:var(--surface2);padding:20px 16px;text-align:center">
        <div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">Net Liq (norm.)</div>
        <div style="font-family:'Playfair Display',serif;font-size:clamp(22px,4vw,32px);font-weight:700;color:#4caf7d;line-height:1">${latestLiq.norm}</div>
        <div style="font-size:9px;color:var(--text-dim);letter-spacing:1px;margin-top:6px">$${(latestLiq.raw/1000).toFixed(2)}T</div>
      </div>
      <div style="background:var(--surface2);padding:20px 16px;text-align:center">
        <div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">Divergence Score</div>
        <div style="display:flex;align-items:baseline;justify-content:center;gap:8px">
          <div style="font-family:'Playfair Display',serif;font-size:clamp(22px,4vw,32px);font-weight:700;color:${signalColor};line-height:1;${glowStyle}">${divScore>0?'+':''}${divScore}</div>
          ${(()=>{
            // Show FG change vs yesterday — the most meaningful daily signal
            const prevFGVal = fgSeries.length > 1 ? fgSeries[fgSeries.length-2].value : latestFG.value;
            const fgDelta   = latestFG.value - prevFGVal;
            const dColor    = fgDelta < 0 ? '#4caf7d' : fgDelta > 0 ? '#e07755' : 'var(--text-dim)';
            const dArrow    = fgDelta < 0 ? '↓' : fgDelta > 0 ? '↑' : '→';
            // FG falling while liq stable/up = divergence widening = good
            const label = fgDelta < 0 ? 'FG cooling' : fgDelta > 0 ? 'FG heating' : 'FG flat';
            return '<div style="display:flex;flex-direction:column;align-items:flex-start;gap:2px">' +
              '<span style="font-size:11px;color:'+dColor+';font-weight:700;font-family:DM Mono,monospace">'+dArrow+' '+(fgDelta>0?'+':'')+fgDelta+'</span>' +
              '<span style="font-size:7px;color:var(--text-dim);letter-spacing:1px">'+label+'</span>' +
              '</div>';
          })()}
        </div>
        <!-- Mini sparkline of last 5 divergence scores -->
        ${(()=>{
          // Compute last 5 rolling divergence scores
          const scores = [];
          for(let i = Math.max(1, liqNorm.length-5); i < liqNorm.length; i++){
            const pL = liqNorm[i-1], cL = liqNorm[i];
            const pF = fgSeries[Math.max(0,fgSeries.length-1-(liqNorm.length-1-i)+1)];
            const cF = fgSeries[Math.max(0,fgSeries.length-1-(liqNorm.length-1-i))];
            const lPct = pL.norm !== 0 ? ((cL.norm-pL.norm)/Math.max(1,Math.abs(pL.norm)))*100 : 0;
            const fPct = pF && cF && pF.value !== 0 ? ((cF.value-pF.value)/Math.max(1,pF.value))*100 : 0;
            scores.push(Math.round((lPct-fPct)*10)/10);
          }
          scores.push(divScore);
          const sMin = Math.min(...scores)-1, sMax = Math.max(...scores)+1;
          const sw=80, sh=24, sp=2;
          const xS = (sw-sp*2)/(scores.length-1);
          const pts = scores.map((s,i)=>{
            const x = sp+i*xS;
            const y = sh-sp-((s-sMin)/(sMax-sMin))*(sh-sp*2);
            return x+','+y;
          }).join(' ');
          const lastColor = scores[scores.length-1] > scores[scores.length-2] ? '#4caf7d' : '#e05555';
          return '<svg viewBox="0 0 '+sw+' '+sh+'" width="80" height="24" style="display:block;margin:6px auto 0">' +
            '<polyline points="'+pts+'" fill="none" stroke="'+signalColor+'" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>' +
            '<circle cx="'+(sp+(scores.length-1)*xS)+'" cy="'+(sh-sp-((divScore-sMin)/(sMax-sMin))*(sh-sp*2))+'" r="2.5" fill="'+lastColor+'"/>' +
            '</svg>';
        })()}
        <div style="font-size:8px;color:var(--text-dim);letter-spacing:1px;margin-top:4px">Liq%Δ − Sentiment%Δ</div>
        <!-- Confidence gauge -->
        <div style="margin-top:14px">
          ${(()=>{
            // Map divScore (-30 to +30) to needle angle (-90° to +90°)
            const clamp = Math.max(-30, Math.min(30, divScore));
            const angle = (clamp / 30) * 90;
            const rad   = (angle - 90) * Math.PI / 180;
            const cx=60, cy=52, r=38;
            const nx = cx + r * Math.cos(rad);
            const ny = cy + r * Math.sin(rad);
            // Arc gradient stops
            const zones = [
              {start:-90,end:-54,color:'#e05555'},  // < -18 bearish
              {start:-54,end:-18,color:'#e07755'},  // -18 to -6
              {start:-18,end:18, color:'#c9a84c'},  // neutral
              {start:18, end:54, color:'#7bc47f'},  // +6 to +18
              {start:54, end:90, color:'#4caf7d'},  // > +18 bullish
            ];
            const arcPaths = zones.map(z=>{
              const a1=(z.start-90)*Math.PI/180, a2=(z.end-90)*Math.PI/180;
              const x1=cx+r*Math.cos(a1),y1=cy+r*Math.sin(a1);
              const x2=cx+r*Math.cos(a2),y2=cy+r*Math.sin(a2);
              return '<path d="M'+x1+' '+y1+' A'+r+' '+r+' 0 0 1 '+x2+' '+y2+'" fill="none" stroke="'+z.color+'" stroke-width="5" stroke-linecap="round"/>';
            }).join('');
            return '<svg viewBox="0 0 120 60" width="100" style="display:block;margin:0 auto">'+
              arcPaths+
              '<line x1="'+cx+'" y1="'+cy+'" x2="'+nx+'" y2="'+ny+'" stroke="white" stroke-width="2" stroke-linecap="round" opacity="0.9"/>'+
              '<circle cx="'+cx+'" cy="'+cy+'" r="3" fill="white" opacity="0.8"/>'+
              '<text x="6"  y="58" font-size="7" fill="#e05555" font-family="DM Mono,monospace" opacity="0.7">SELL</text>'+
              '<text x="94" y="58" font-size="7" fill="#4caf7d" font-family="DM Mono,monospace" opacity="0.7" text-anchor="end">BUY</text>'+
              '</svg>';
          })()}
        </div>
      </div>
      <div style="background:${glowColor!=='none'?glowColor:'var(--surface2)'};padding:20px 16px;text-align:center;border-left:3px solid ${signalColor};${glowStyle}">
        <div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:10px">Signal</div>
        <div style="font-family:'Playfair Display',serif;font-size:14px;font-weight:700;color:${signalColor};line-height:1.3">${signal}</div>
        <div style="font-size:8px;color:${signalColor};letter-spacing:1px;margin-top:8px;opacity:0.8">${divScore>15||divScore<-15?'HIGH CONVICTION':divScore>5||divScore<-5?'MODERATE':'NEUTRAL'}</div>
      </div>
    </div>

    <!-- Chart -->
    <div style="background:var(--surface2);padding:20px 56px 20px 56px;position:relative">
      <div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:12px">Last 10 days · FG daily · Net Liq weekly</div>
      <div style="position:relative">
        <svg id="divChart" viewBox="0 0 ${w} ${h}" width="100%" height="260" style="display:block;overflow:visible;cursor:crosshair">
          ${yTicks}
          <!-- Threshold bands -->
          <line x1="${pad}" y1="${h-pad-(70/100)*(h-pad*2)}" x2="${w-pad}" y2="${h-pad-(70/100)*(h-pad*2)}" stroke="rgba(224,119,85,0.2)" stroke-dasharray="3,3"/>
          <line x1="${pad}" y1="${h-pad-(30/100)*(h-pad*2)}" x2="${w-pad}" y2="${h-pad-(30/100)*(h-pad*2)}" stroke="rgba(76,175,125,0.2)" stroke-dasharray="3,3"/>
          <!-- Divergence area -->
          <polygon points="${areaPoints}" fill="${glowColor!=='none'?glowColor:'rgba(201,168,76,0.05)'}"/>
          <!-- Lines -->
          <polyline points="${liqLine}" fill="none" stroke="#4caf7d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <polyline points="${fgLine}"  fill="none" stroke="#e07755" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <!-- Hover elements -->
          <line id="divHoverLine" x1="0" y1="${pad}" x2="0" y2="${h-pad}" stroke="rgba(255,255,255,0.2)" stroke-width="1" stroke-dasharray="3,3" display="none"/>
          <circle id="divDotFG"  cx="0" cy="0" r="4" fill="#e07755" display="none"/>
          <circle id="divDotLiq" cx="0" cy="0" r="4" fill="#4caf7d" display="none"/>
        </svg>
        <div id="divTooltip" style="position:absolute;pointer-events:none;display:none;background:#1a1a1a;border:1px solid #3a3530;padding:8px 12px;font-family:'DM Mono',monospace;font-size:10px;line-height:1.8;white-space:nowrap;z-index:10">
          <div id="divTipDate"  style="color:#c9a84c;font-size:9px;letter-spacing:1px;margin-bottom:4px"></div>
          <div><span style="color:#e07755">F&G: </span><span id="divTipFG"    style="color:#e07755;font-weight:700"></span></div>
          <div><span style="color:#4caf7d">Liq: </span><span id="divTipLiq"   style="color:#4caf7d;font-weight:700"></span></div>
          <div><span style="color:#c9a84c">Δ: </span>  <span id="divTipDelta" style="color:#c9a84c;font-weight:700"></span></div>
        </div>
      </div>
      <div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap;justify-content:space-between">
        <div style="display:flex;gap:16px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:6px"><div style="width:16px;height:2px;background:#e07755"></div><span style="font-size:8px;color:#e07755;letter-spacing:1px">FEAR & GREED</span></div>
          <div style="display:flex;align-items:center;gap:6px"><div style="width:16px;height:2px;background:#4caf7d"></div><span style="font-size:8px;color:#4caf7d;letter-spacing:1px">NET LIQUIDITY</span></div>
        </div>
        <span style="font-size:8px;color:var(--text-dim);letter-spacing:1px">Hover for values</span>
      </div>
    </div>

    <!-- Signal description -->
    <div style="background:${glowColor!=='none'?glowColor:'var(--surface2)'};border-left:3px solid ${signalColor};padding:18px 24px;margin-top:2px">
      <div style="font-size:9px;color:var(--gold);letter-spacing:3px;text-transform:uppercase;margin-bottom:10px">BitLogic Alpha Index · Divergence Signal</div>
      <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:700;color:${signalColor};margin-bottom:8px">${signal}</div>
      <div style="font-size:12px;color:var(--text-muted);line-height:1.85">${signalDesc}</div>
    </div>

    <!-- Score table -->
    <div style="background:var(--surface);padding:20px 24px;border-top:1px solid var(--text-dim)">
      <div style="font-size:9px;color:var(--text-muted);letter-spacing:3px;text-transform:uppercase;margin-bottom:14px">Signal Reference · BitLogic Alpha Index</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${[
          ['+15 and above', 'HIGH CONVICTION BUY', 'BULLISH DIVERGENCE', '#4caf7d', true],
          ['+5 to +15',     'LEANING BULLISH',     'ACCUMULATION',       '#7bc47f', false],
          ['-5 to +5',      'NEUTRAL',             'ALIGNED',            '#c9a84c', false],
          ['-5 to -15',     'LEANING BEARISH',     'DISTRIBUTION',       '#e07755', false],
          ['Below -15',     'HIGH CONVICTION SELL','BEARISH DIVERGENCE', '#e05555', true],
        ].map(([range, type, status, color, pulse]) =>
          '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surface2)' + (pulse?';box-shadow:inset 0 0 12px '+color+'20':'') + '">' +
          '<div style="width:8px;height:8px;border-radius:50%;background:'+color+';flex-shrink:0' + (pulse?';animation:livepulse 1.4s ease-in-out infinite':'') + '"></div>' +
          '<div style="font-size:9px;color:'+color+';letter-spacing:1px;font-weight:700;width:90px;flex-shrink:0">'+range+'</div>' +
          '<div style="font-size:9px;color:var(--text-muted);letter-spacing:1px;flex:1">'+type+'</div>' +
          '<div style="font-size:9px;color:'+color+';letter-spacing:2px;font-weight:700">'+status+'</div>' +
          '</div>'
        ).join('')}
      </div>
    </div>`;

  // Wire hover
  setTimeout(()=>{
    const svg = document.getElementById('divChart');
    if(!svg) return;
    const hLine = document.getElementById('divHoverLine');
    const dotFG  = document.getElementById('divDotFG');
    const dotLiq = document.getElementById('divDotLiq');
    const tip    = document.getElementById('divTooltip');
    const W=600, H=260, P=12;
    const chartW = W-P*2;
    svg.addEventListener('mousemove', function(e){
      const rect = svg.getBoundingClientRect();
      const mx = (e.clientX-rect.left)*(W/rect.width);
      const ci = Math.max(0,Math.min(chartData.length-1,Math.round((mx-P)/(chartW/(chartData.length-1)))));
      const d = chartData[ci];
      if(!d) return;
      const xPos = P+ci*(chartW/(chartData.length-1));
      const yFG  = H-P-(d.fg/100)*(H-P*2);
      const yLiq = H-P-(d.liq/100)*(H-P*2);
      const rawLiq = liqMin+(d.liq/100)*(liqMax-liqMin);
      const delta = d.fg-d.liq;
      hLine.setAttribute('x1',xPos); hLine.setAttribute('x2',xPos); hLine.removeAttribute('display');
      dotFG.setAttribute('cx',xPos);  dotFG.setAttribute('cy',yFG);  dotFG.removeAttribute('display');
      dotLiq.setAttribute('cx',xPos); dotLiq.setAttribute('cy',yLiq); dotLiq.removeAttribute('display');
      document.getElementById('divTipDate').textContent  = d.date;
      document.getElementById('divTipFG').textContent    = d.fg;
      document.getElementById('divTipLiq').textContent   = '$'+(rawLiq/1000).toFixed(2)+'T';
      document.getElementById('divTipDelta').textContent = (delta>0?'+':'')+delta;
      const tipLeft = e.clientX-rect.left+12;
      tip.style.left    = (tipLeft>rect.width-160?tipLeft-170:tipLeft)+'px';
      tip.style.top     = (e.clientY-rect.top-10)+'px';
      tip.style.display = 'block';
    });
    svg.addEventListener('mouseleave',()=>{
      hLine.setAttribute('display','none');
      dotFG.setAttribute('display','none');
      dotLiq.setAttribute('display','none');
      tip.style.display='none';
    });
  },100);
}


function updateSimulator(){
  // ── Read slider values (deltas in billions) ───────────────
  const deltaBS  = parseInt(document.getElementById('simBs')?.value  || 0);
  const deltaTGA = parseInt(document.getElementById('simTga')?.value || 0);
  const deltaRRP = parseInt(document.getElementById('simRrp')?.value || 0);

  // ── Update slider labels ──────────────────────────────────
  const fmt  = v => (v >= 0 ? '+' : '') + '$' + Math.abs(v) + 'B';
  const fmtT = v => (v >= 0 ? '+' : '-') + '$' + (Math.abs(v)/1000).toFixed(2) + 'T';
  document.getElementById('simBsVal').textContent  = fmt(deltaBS);
  document.getElementById('simTgaVal').textContent = fmt(deltaTGA);
  document.getElementById('simRrpVal').textContent = fmt(deltaRRP);

  // ── Get baseline values ───────────────────────────────────
  // Try to extract from rendered fed liquidity widget
  let currentBS  = 6582; // defaults in billions
  let currentTGA = 525;
  let currentRRP = 68;

  // Try to read from cachedFedData if available
  if(window._fedLiqData && window._fedLiqData.length){
    const latest = window._fedLiqData[window._fedLiqData.length - 1];
    currentBS  = latest.balance_sheet;
    currentTGA = latest.tga;
    currentRRP = latest.rrp;
  }

  const currentNetLiq = currentBS - currentTGA - currentRRP;

  // ── Simulated values ──────────────────────────────────────
  const simulatedBS  = currentBS  + deltaBS;
  const simulatedTGA = currentTGA + deltaTGA;
  const simulatedRRP = currentRRP + deltaRRP;
  const projectedNetLiq = simulatedBS - simulatedTGA - simulatedRRP;

  // ── Liquidity Impulse = BS↑ is good, TGA↑ is bad, RRP↑ is bad ──
  const liquidityImpulse = deltaBS - deltaTGA - deltaRRP;

  // ── BTC Projected Price using Liquidity Beta ──────────────
  const currentBTC = cachedMarketData?.find(c=>c.id==='bitcoin')?.current_price || 78000;
  const liquidityBeta = 4.0;
  const percentChange = (liquidityImpulse / currentNetLiq) * liquidityBeta;
  const projectedBTC  = Math.max(0, Math.round(currentBTC * (1 + percentChange) / 100) * 100);

  // ── Colors ────────────────────────────────────────────────
  const impulseColor = liquidityImpulse > 0 ? '#4caf7d' : liquidityImpulse < 0 ? '#e05555' : 'var(--gold)';

  // ── Update output cards ───────────────────────────────────
  const netDeltaEl = document.getElementById('simNetDelta');
  if(netDeltaEl){
    netDeltaEl.textContent = fmt(liquidityImpulse);
    netDeltaEl.style.color = impulseColor;
  }
  const projectedEl = document.getElementById('simProjected');
  if(projectedEl){
    projectedEl.textContent = '$' + (projectedNetLiq/1000).toFixed(2) + 'T';
    projectedEl.style.color = impulseColor;
  }
  const floorEl = document.getElementById('simBtcFloor');
  if(floorEl){
    floorEl.textContent = '$' + projectedBTC.toLocaleString();
    floorEl.style.color = impulseColor;
  }

  // ── Regime label ──────────────────────────────────────────
  const regimeEl = document.getElementById('simRegimeLabel');
  if(regimeEl){
    let regime, color;
    const pct = percentChange * 100;
    if(pct > 20){
      regime = '🚀 STRONG EXPANSION — HIGHLY BULLISH';       color = '#4caf7d';
    } else if(pct > 5){
      regime = '▲ MODERATE EXPANSION — BULLISH BACKDROP';    color = '#7bc47f';
    } else if(pct > -5){
      regime = '→ NEUTRAL — BASELINE CONDITIONS';             color = '#c9a84c';
    } else if(pct > -20){
      regime = '▼ MODERATE CONTRACTION — BEARISH PRESSURE';  color = '#e07755';
    } else {
      regime = '⚠ SEVERE LIQUIDITY DRAIN — RISK-OFF';        color = '#e05555';
    }
    regimeEl.textContent = regime;
    regimeEl.style.color = color;
    const bar = document.getElementById('simRegimeBar');
    if(bar) bar.style.borderLeft = '3px solid ' + color;
  }
}

// ── MACRO TAB ─────────────────────────────────────────────
// ── VIEW LOGIC PANEL ─────────────────────────────────────
function toggleLogicPanel(coin, btn){
  const panel = document.getElementById('logicPanel_'+coin);
  if(!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  btn.querySelector('span').textContent = isOpen ? '+ Market Health Check' : '− Hide Health Check';
  if(!isOpen) fetchLogicPanel(coin);
}

async function fetchLogicPanel(coin){
  const panel = document.getElementById('logicPanel_'+coin);
  if(!panel) return;
  panel.innerHTML = '<div style="padding:12px 0;font-size:9px;color:var(--text-muted);letter-spacing:1px">Loading signals...</div>';
  try{
    let liqStatus='—',liqColor='var(--text-muted)',liqIcon='⚪';
    if(window._fedLiqData && window._fedLiqData.length>=2){
      const latest=window._fedLiqData[window._fedLiqData.length-1];
      const prev=window._fedLiqData[window._fedLiqData.length-2];
      const change=(latest.balance_sheet-latest.tga-latest.rrp)-(prev.balance_sheet-prev.tga-prev.rrp);
      if(change>=0){liqStatus='Expanding (+$'+Math.abs(change).toFixed(0)+'B WoW)';liqColor='#4caf7d';liqIcon='✅';}
      else{liqStatus='Contracting (-$'+Math.abs(change).toFixed(0)+'B WoW)';liqColor='#e07755';liqIcon='⚠️';}
    }
    let flowStatus='—',flowColor='var(--text-muted)',flowIcon='⚪';
    let frStatus='N/A',frColor='var(--text-muted)',frIcon='⚪';
    let liqLabel='Liquidity',flowLabel='Exchange Flows',frLabel='Funding Rate';
    const tipBTC = {
      liq:  "Measures the global dollar flow from the Federal Reserve and Treasury (Net Liquidity). Bullish when liquidity is expanding, as it provides the 'fuel' for price growth. Bearish when the system is tightening.",
      flow: "Tracks the net movement of assets in and out of major exchanges. Outflows suggest investors are moving coins to cold storage (Bullish). Inflows suggest increased selling pressure (Bearish).",
      fr:   "The cost of holding leveraged long positions. Positive rates mean longs pay shorts (Bullish Sentiment). Extreme high rates suggest the market is 'too crowded' and a correction is likely."
    };
    const tipGOLD = {
      liq:  "The actual yield of government bonds after subtracting inflation. Gold is the ultimate hedge against low or negative real rates. When real rates rise, Gold becomes less attractive compared to cash/bonds.",
      flow: "Tracks the capital entering or exiting the world's largest Gold ETFs. Persistent inflows represent institutional accumulation. Outflows signal rotation into other risk assets.",
      fr:   "A weekly breakdown of how professional speculators and big banks are positioned. 'High Long' warns the trade is over-crowded, while 'Commercial Short' shows big banks hedging against a potential top."
    };
    const tips = coin==='GOLD' ? tipGOLD : tipBTC;
    function tipHtml(text){ return '<span class="sig-tooltip-wrap"><button class="sig-tooltip-btn">i</button><div class="sig-tooltip-box">'+text+'</div></span>'; }

    if(coin==='GOLD'){
      // Gold-specific signals from manifest
      liqLabel='Real Interest Rates';
      flowLabel='GLD/IAU ETF Flows';
      frLabel='COT Report';
      const goldData = window._cachedTrendData?.GOLD;
      // Real rates
      if(goldData && goldData.real_rates!==null){
        const rr = goldData.real_rates;
        if(rr<0){liqStatus='Negative ('+rr.toFixed(2)+'%) — Bullish for Gold';liqColor='#4caf7d';liqIcon='✅';}
        else if(rr<=1.5){liqStatus='Low ('+rr.toFixed(2)+'%) — Neutral';liqColor='#c9a84c';liqIcon='⚪';}
        else{liqStatus='High ('+rr.toFixed(2)+'%) — Bearish for Gold';liqColor='#e05555';liqIcon='⚠️';}
      } else { liqStatus='Update real_rates in gold manifest'; }
      // ETF flows
      if(goldData && goldData.etf_flows!==null){
        const ef = goldData.etf_flows;
        if(ef>0){flowStatus='Inflows +$'+ef.toFixed(0)+'M — Bullish';flowColor='#4caf7d';flowIcon='✅';}
        else if(ef<0){flowStatus='Outflows -$'+Math.abs(ef).toFixed(0)+'M — Bearish';flowColor='#e05555';flowIcon='⚠️';}
        else{flowStatus='Flat — Neutral';flowColor='#c9a84c';flowIcon='⚪';}
      } else { flowStatus='Update etf_flows in gold manifest'; }
      // COT
      if(goldData && goldData.cot_signal){
        const cot = goldData.cot_signal;
        if(cot==='bullish'){frStatus='Speculators net long — Bullish';frColor='#4caf7d';frIcon='✅';}
        else if(cot==='bearish'){frStatus='Speculators net short — Bearish';frColor='#e05555';frIcon='⚠️';}
        else{frStatus='Mixed positioning — Neutral';frColor='#c9a84c';frIcon='⚪';}
      } else { frStatus='Update cot_signal in gold manifest'; }
    } else {
      // BTC / ETH signals
      const assetId = coin==='BTC'?'bitcoin':'ethereum';
      const assetData = cachedMarketData?.find(c=>c.id===assetId);
      if(assetData){
        const chg24=assetData.price_change_percentage_24h||0;
        if(chg24>1){flowStatus='Inflows dominant (price +'+chg24.toFixed(1)+'%)';flowColor='#4caf7d';flowIcon='✅';}
        else if(chg24<-1){flowStatus='Outflows dominant (price '+chg24.toFixed(1)+'%)';flowColor='#e05555';flowIcon='⚠️';}
        else{flowStatus='Neutral ('+Math.abs(chg24).toFixed(1)+'% 24h)';flowColor='#c9a84c';flowIcon='⚪';}
      }
      const symbol=coin==='ETH'?'ETHUSDT':'BTCUSDT';
      const frData=await fetch('https://fapi.binance.com/fapi/v1/premiumIndex?symbol='+symbol).then(r=>r.ok?r.json():null).catch(()=>null);
      if(frData&&frData.lastFundingRate!==undefined){
        const fr=parseFloat(frData.lastFundingRate)*100;
        if(fr>0.05){frStatus='High ('+fr.toFixed(4)+'%) — Longs paying';frColor='#e07755';frIcon='⚠️';}
        else if(fr>0.01){frStatus='Moderate ('+fr.toFixed(4)+'%)';frColor='#c9a84c';frIcon='⚪';}
        else if(fr>=0){frStatus='Low ('+fr.toFixed(4)+'%) — Healthy';frColor='#4caf7d';frIcon='✅';}
        else{frStatus='Negative ('+fr.toFixed(4)+'%) — Shorts paying';frColor='#4caf7d';frIcon='✅';}
      }
    }
    panel.innerHTML='<div style="padding:14px 0 4px;display:flex;flex-direction:column;gap:12px">'+
      '<div style="display:flex;align-items:flex-start;gap:12px;background:var(--surface);padding:12px 14px"><span style="font-size:14px;flex-shrink:0;margin-top:1px">'+liqIcon+'</span><div><div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">'+(liqLabel||'Liquidity')+tipHtml(tips.liq)+'</div><div style="font-size:12px;color:'+liqColor+';font-weight:500;letter-spacing:0.3px">'+liqStatus+'</div></div></div>'+
      '<div style="display:flex;align-items:flex-start;gap:12px;background:var(--surface);padding:12px 14px"><span style="font-size:14px;flex-shrink:0;margin-top:1px">'+flowIcon+'</span><div><div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">'+(flowLabel||'Exchange Flows')+tipHtml(tips.flow)+'</div><div style="font-size:12px;color:'+flowColor+';font-weight:500;letter-spacing:0.3px">'+flowStatus+'</div></div></div>'+
      '<div style="display:flex;align-items:flex-start;gap:12px;background:var(--surface);padding:12px 14px"><span style="font-size:14px;flex-shrink:0;margin-top:1px">'+frIcon+'</span><div><div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:4px">'+(frLabel||'Funding Rate')+tipHtml(tips.fr)+'</div><div style="font-size:12px;color:'+frColor+';font-weight:500;letter-spacing:0.3px">'+frStatus+'</div></div></div>'+
      '</div>';
  }catch(e){panel.innerHTML='<div style="padding:12px 0;font-size:9px;color:var(--text-muted)">Signal data unavailable.</div>';}
}

async function fetchMacro(){
  // Lazy-load Chart.js only when Macro tab is first opened
  if(typeof Chart === "undefined"){
    await new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
      s.onload=resolve; s.onerror=reject;
      document.head.appendChild(s);
    });
  }
  try{
    const [btcRes, m2Res, fedRes, fgRes] = await Promise.all([
      fetch(`${BASE}/data/btc-daily.json?t=${Date.now()}`).then(r=>r.ok?r.json():null),
      fetch(`${BASE}/data/m2-monthly.json?t=${Date.now()}`).then(r=>r.ok?r.json():null),
      fetch(`${BASE}/data/fed-liquidity.json?t=${Date.now()}`).then(r=>r.ok?r.json():null),
      window._fgHistory ? Promise.resolve(null) :
        fetch('https://api.alternative.me/fng/?limit=30').then(r=>r.json()).then(d=>d.data).catch(()=>null),
    ]);
    if(!btcRes || !m2Res) throw new Error('Data unavailable');
    if(fgRes) window._fgHistory = fgRes;
    renderMacroChart(btcRes, m2Res);
    if(fedRes){
      window._fedLiqData = fedRes;
      renderFedLiquidity(fedRes);
      renderDivergenceTracker();
    }
    const el = document.getElementById('macroLastUpdated');
    if(el) el.textContent = 'BTC updated daily · M2 & Fed updated manually';
  }catch(e){
    const canvas = document.getElementById('macroChart');
    if(canvas){
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.font = '12px DM Mono, monospace';
      ctx.fillText('Data unavailable — check back shortly', 20, canvas.height/2);
    }
  }
}

function renderFedLiquidity(data){
  const el = document.getElementById('fedLiquidityWidget');
  if(!el || !data.length) return;

  const latest  = data[data.length - 1];
  const prev    = data[data.length - 2] || latest;
  const netLiq  = latest.balance_sheet - latest.tga - latest.rrp;
  const prevLiq = prev.balance_sheet - prev.tga - prev.rrp;
  const change  = netLiq - prevLiq;
  const isExpanding = change >= 0;
  const regime  = isExpanding ? 'EXPANSION' : 'CONTRACTION';
  const color   = isExpanding ? '#4caf7d' : '#e05555';
  const icon    = isExpanding ? '▲' : '▼';
  const signal  = isExpanding ? 'BULLISH BACKDROP' : 'BEARISH BACKDROP';

  // Bar fill: map net liquidity between reasonable range
  // typical range ~$4T to $7T
  const minL = 4000, maxL = 7500;
  const fillPct = Math.min(100, Math.max(5, ((netLiq - minL) / (maxL - minL)) * 100));

  el.innerHTML = `
    <div id="fedLiqGrid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px">
      <div style="background:var(--surface2);padding:24px 20px">
        <div style="font-size:9px;color:var(--text-muted);letter-spacing:3px;text-transform:uppercase;margin-bottom:12px">Net Liquidity</div>
        <div style="font-family:'Playfair Display',serif;font-size:32px;font-weight:700;color:${color};line-height:1">${(netLiq/1000).toFixed(2)}T</div>
        <div style="font-size:9px;color:var(--text-dim);letter-spacing:1px;margin-top:6px">USD · Balance Sheet − TGA − RRP</div>
      </div>
      <div style="background:var(--surface2);padding:24px 20px">
        <div style="font-size:9px;color:var(--text-muted);letter-spacing:3px;text-transform:uppercase;margin-bottom:12px">Week-on-Week</div>
        <div style="font-family:'Playfair Display',serif;font-size:32px;font-weight:700;color:${color};line-height:1">${icon} ${Math.abs(change/1000).toFixed(2)}T</div>
        <div style="font-size:9px;color:var(--text-dim);letter-spacing:1px;margin-top:6px">vs prev week · ${latest.date}</div>
      </div>
      <div style="background:var(--surface2);padding:24px 20px;border-left:3px solid ${color}">
        <div style="font-size:9px;color:var(--text-muted);letter-spacing:3px;text-transform:uppercase;margin-bottom:12px">Regime</div>
        <div style="font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:${color};line-height:1.2">${regime}</div>
        <div style="font-size:9px;color:${color};letter-spacing:2px;margin-top:6px">${signal}</div>
      </div>
    </div>
    <div style="background:var(--surface);padding:16px 20px;border-top:1px solid var(--text-dim)">
      <div style="font-size:9px;color:var(--text-muted);letter-spacing:2px;margin-bottom:8px">LIQUIDITY LEVEL</div>
      <div style="height:6px;background:var(--surface2);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${fillPct}%;background:${color};border-radius:3px;box-shadow:0 0 8px ${color}60;transition:width 1.2s ease"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:8px;color:var(--text-dim);letter-spacing:1px">
        <span>$4T Contracted</span><span>$7.5T Expanded</span>
      </div>
    </div>`;
}

function applyMacroYearRange(reset){
  if(!window._macroBtcData || !window._macroM2Data) return;
  const fromSel = document.getElementById('macroYearFrom');
  const toSel   = document.getElementById('macroYearTo');
  if(reset){ fromSel.value='2020'; toSel.value='2026'; }
  const fromStr = fromSel.value + '-01-01';
  const toStr   = toSel.value   + '-12-31';
  const btcFiltered = window._macroBtcData.filter(d => d.date >= fromStr && d.date <= toStr);
  const m2Filtered  = window._macroM2Data.filter(d => (d.date+'-01') >= fromStr && (d.date+'-01') <= toStr);
  buildMacroChart(btcFiltered.length ? btcFiltered : window._macroBtcData,
                  m2Filtered.length  ? m2Filtered  : window._macroM2Data);
}

function renderMacroChart(btcData, m2Data){
  const canvas = document.getElementById('macroChart');
  if(!canvas) return;
  if(window._macroChartInstance) window._macroChartInstance.destroy();

  btcData = [...btcData].sort((a,b) => new Date(a.date) - new Date(b.date));
  m2Data  = [...m2Data].sort((a,b)  => new Date(a.date+'-01') - new Date(b.date+'-01'));

  // Normalize to weekly points so pre-2023 sparse and post-2023 daily data
  // are displayed with consistent visual spacing
  const weekly = [];
  let lastDate = null;
  for(const d of btcData){
    if(!lastDate || (new Date(d.date) - new Date(lastDate)) >= 6 * 24 * 3600 * 1000){
      weekly.push(d);
      lastDate = d.date;
    }
  }

  window._macroBtcData = weekly;
  window._macroM2Data  = m2Data;
  buildMacroChart(weekly, m2Data);
}

function buildM2Points(btcData, m2Data){
  const m2Entries = m2Data.map(d => ({ date: new Date(d.date+'-01'), value: d.value }));
  return btcData.map(d => {
    const day = new Date(d.date);
    let before = null, after = null;
    for(let i = 0; i < m2Entries.length; i++){
      if(m2Entries[i].date <= day) before = m2Entries[i];
      if(m2Entries[i].date > day && !after) after = m2Entries[i];
    }
    if(before && after){
      const t = (day - before.date) / (after.date - before.date);
      return before.value + (after.value - before.value) * t;
    }
    return before ? before.value : (after ? after.value : null);
  });
}

function buildMacroChart(btcData, m2Data){
  const canvas = document.getElementById('macroChart');
  if(!canvas) return;
  if(window._macroChartInstance) window._macroChartInstance.destroy();

  const labels    = btcData.map(d => d.date);
  const btcPrices = btcData.map(d => d.price);
  const m2Prices  = buildM2Points(btcData, m2Data);

  const ctx = canvas.getContext('2d');
  window._macroChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'BTC Price (USD)',
          data: btcPrices,
          borderColor: '#f7931a',
          backgroundColor: 'rgba(247,147,26,0.08)',
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: true,
          tension: 0,
          yAxisID: 'yBTC',
        },
        {
          label: 'Global M2 (Trillions USD)',
          data: m2Prices,
          borderColor: '#4caf7d',
          backgroundColor: 'rgba(76,175,125,0.06)',
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          tension: 0.4,
          yAxisID: 'yM2',
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a1a',
          borderColor: '#3a3530',
          borderWidth: 1,
          titleColor: '#c9a84c',
          bodyColor: '#a89880',
          titleFont: { family: 'DM Mono, monospace', size: 11 },
          bodyFont:  { family: 'DM Mono, monospace', size: 11 },
          callbacks: {
            label: item => {
              if(item.datasetIndex===0) return ' BTC: $'+Math.round(item.parsed.y).toLocaleString();
              return item.parsed.y ? ' M2: $'+item.parsed.y.toFixed(1)+'T' : ' M2: —';
            }
          }
        }
      },
      scales: {
        x: {
          grid:  { color: 'rgba(255,255,255,0.04)' },
          border:{ color: '#3a3530' },
          ticks: {
            color: '#6b6560',
            font:  { family: 'DM Mono, monospace', size: 9 },
            maxRotation: 0,
            maxTicksLimit: 10,
            callback: function(val, index){
              const label = this.getLabelForValue(val);
              if(label && label.substring(5) === '01-01') return label.substring(0,4);
              const total = this.chart.data.labels.length;
              const step  = Math.max(1, Math.floor(total / 10));
              return index % step === 0 ? label.substring(0,7) : '';
            }
          }
        },
        yBTC: {
          type: 'logarithmic',
          position: 'left',
          grid:  { color: 'rgba(255,255,255,0.04)' },
          border:{ color: '#3a3530' },
          ticks: {
            color: '#f7931a',
            font:  { family: 'DM Mono, monospace', size: 9 },
            maxTicksLimit: 8,
            callback: v => '$'+(v>=1000 ? Math.round(v/1000)+'K' : v)
          }
        },
        yM2: {
          type: 'linear',
          position: 'right',
          grid:  { drawOnChartArea: false },
          border:{ color: '#3a3530' },
          ticks: {
            color: '#4caf7d',
            font:  { family: 'DM Mono, monospace', size: 9 },
            maxTicksLimit: 6,
            callback: v => '$'+v.toFixed(0)+'T'
          }
        }
      }
    }
  });
}

// ── BITLOGIC CUSTOM SENTIMENT INDEX ──────────────────────
function computeCustomFG(){
  const el = document.getElementById('customFgWidget');
  if(!el) return;

  const prices = cachedMarketData;
  const global = cachedGlobalData;

  // Wait until both market data AND global data are ready
  if(!prices || !prices.length || !global){
    let attempts = 0;
    const retry = setInterval(()=>{
      attempts++;
      if(cachedMarketData && cachedMarketData.length && cachedGlobalData){
        clearInterval(retry);
        computeCustomFG();
      } else if(attempts >= 20){
        clearInterval(retry);
        if(cachedMarketData && cachedMarketData.length){
          // Global data never arrived — compute without it
          computeCustomFG();
        } else {
          el.innerHTML='<div class="loading">Market data unavailable</div>';
        }
      }
    }, 500);
    return;
  }

  const btc = prices.find(p=>p.id==='bitcoin');
  if(!btc){ el.innerHTML='<div class="loading">BTC data unavailable</div>'; return; }

  // ── Five signals, each scored 0–100 ──────────────────
  // 1. Price momentum 24h (25%) — centre at 0%, ±5% = full range
  const chg24 = btc.price_change_percentage_24h || 0;
  const s1 = Math.min(100, Math.max(0, (chg24 + 5) / 10 * 100));

  // 2. Price momentum 7d (25%) — centre at 0%, ±15% = full range
  const chg7 = btc.price_change_percentage_7d_in_currency || 0;
  const s2 = Math.min(100, Math.max(0, (chg7 + 15) / 30 * 100));

  // 3. Price momentum 30d (20%) — centre at 0%, ±30% = full range
  const chg30 = btc.price_change_percentage_30d_in_currency || 0;
  const s3 = Math.min(100, Math.max(0, (chg30 + 30) / 60 * 100));

  // 4. BTC dominance (15%) — high dom = fear (BTC flight to safety), low dom = greed (alt season)
  const btcDom = global?.data?.market_cap_percentage?.btc || 55;
  // dom 70%+ = extreme fear, dom 40%- = extreme greed, centre ~55%
  const s4 = Math.min(100, Math.max(0, (70 - btcDom) / 30 * 100));

  // 5. Altcoin outperformance vs BTC (15%)
  const top50 = prices.filter(c=>c.id!=='bitcoin').slice(0,49);
  const altsBeatingBtc = top50.filter(c=>(c.price_change_percentage_7d_in_currency||0) > chg7).length;
  const s5 = Math.min(100, Math.max(0, (altsBeatingBtc / 50) * 100));

  // ── Weighted composite ────────────────────────────────
  const score = Math.round(s1*0.25 + s2*0.25 + s3*0.20 + s4*0.15 + s5*0.15);

  // ── Classification ────────────────────────────────────
  function cfgLabel(v){
    if(v>=75) return 'Extreme Greed';
    if(v>=56) return 'Greed';
    if(v>=45) return 'Neutral';
    if(v>=25) return 'Fear';
    return 'Extreme Fear';
  }
  function cfgColor(v){
    if(v>=75) return '#4caf7d';
    if(v>=56) return '#7bc47f';
    if(v>=45) return '#c9a84c';
    if(v>=25) return '#e07755';
    return '#e05555';
  }

  const label = cfgLabel(score);
  const color = cfgColor(score);

  // Signal breakdown rows
  const signals = [
    {name:'24H Momentum',    score:Math.round(s1), weight:'25%'},
    {name:'7D Momentum',     score:Math.round(s2), weight:'25%'},
    {name:'30D Momentum',    score:Math.round(s3), weight:'20%'},
    {name:'BTC Dominance',   score:Math.round(s4), weight:'15%'},
    {name:'Altcoin Strength',score:Math.round(s5), weight:'15%'},
  ];

  const signalRows = signals.map(sig=>{
    const c = cfgColor(sig.score);
    return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <span style="font-size:9px;color:var(--text-muted);letter-spacing:1px;width:130px;flex-shrink:0">${sig.name}</span>
      <div style="flex:1;height:4px;background:var(--surface);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${sig.score}%;background:${c};border-radius:2px;transition:width 1.2s ease"></div>
      </div>
      <span style="font-size:10px;color:${c};font-weight:600;width:28px;text-align:right">${sig.score}</span>
      <span style="font-size:8px;color:var(--text-dim);width:28px">${sig.weight}</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:200px 1fr;gap:2px" id="bsiGrid">

      <!-- Score panel -->
      <div style="background:var(--surface2);padding:28px 24px;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;overflow:hidden">
        <div style="font-size:9px;color:var(--text-muted);letter-spacing:3px;text-transform:uppercase;margin-bottom:16px;align-self:flex-start">BitLogic BSI</div>
        <div style="font-family:'Playfair Display',serif;font-size:64px;font-weight:700;color:${color};line-height:1;animation:scorebreath 3s ease-in-out infinite">${score}</div>
        <div style="font-size:9px;color:var(--text-dim);letter-spacing:2px;margin-top:4px">/ 100</div>
        <div style="font-family:'Playfair Display',serif;font-size:20px;font-weight:700;color:${color};margin-top:12px">${label}</div>
      </div>

      <!-- Signal breakdown -->
      <div style="background:var(--surface2);padding:24px 28px">
        <div style="font-size:9px;color:var(--text-muted);letter-spacing:3px;text-transform:uppercase;margin-bottom:16px">Signal Breakdown</div>
        ${signalRows}
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--text-dim);font-size:9px;color:var(--text-dim);letter-spacing:1px;line-height:1.6">
          Weighted composite of 5 on-chain signals · Calculated from live market data
        </div>
      </div>
    </div>

    <!-- Divergence note -->
    <div style="background:var(--surface);padding:14px 24px;border-top:1px solid var(--text-dim);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div style="font-size:9px;color:var(--text-dim);letter-spacing:1px">
        BitLogic BSI vs Alternative.me F&G — <span style="color:${Math.abs(score - (parseInt(document.getElementById('fgVal')?.textContent)||50)) >= 10 ? '#c9a84c' : 'var(--text-muted)'}">
          ${Math.abs(score - (parseInt(document.getElementById('fgVal')?.textContent)||50)) >= 10 ? '⚠ Divergence detected' : 'Signals aligned'}
        </span>
      </div>
      <div style="font-size:9px;color:var(--text-dim);letter-spacing:1px">Updated live · No external API</div>
    </div>`;

  // Mobile: stack vertically
  if(window.innerWidth < 600){
    const grid = document.getElementById('bsiGrid');
    if(grid) grid.style.gridTemplateColumns = '1fr';
  }
}

const HALVING_DATE = new Date('2028-04-17T00:00:00Z');
const PREV_HALVING  = new Date('2024-04-20T00:00:00Z');

function updateHalving(){
  const now = new Date();
  const diff = HALVING_DATE - now;
  if(diff <= 0){ document.querySelector('.halving-wrap').innerHTML='<div style="color:var(--gold);font-family:\'Playfair Display\',serif;font-size:18px">Halving complete — reward is now 1.5625 BTC</div>'; return; }
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000) / 60000);
  const secs  = Math.floor((diff % 60000) / 1000);
  document.getElementById('halvDays').textContent  = String(days).padStart(3,'0');
  document.getElementById('halvHours').textContent = String(hours).padStart(2,'0');
  document.getElementById('halvMins').textContent  = String(mins).padStart(2,'0');
  document.getElementById('halvSecs').textContent  = String(secs).padStart(2,'0');
  // Progress bar
  const totalCycle = HALVING_DATE - PREV_HALVING;
  const elapsed    = now - PREV_HALVING;
  const pct        = Math.min(100, Math.max(0, (elapsed / totalCycle) * 100));
  const elapsedDays = Math.floor(elapsed / 86400000);
  const fillEl = document.getElementById('halvFill');
  if(fillEl){
    fillEl.style.width = pct.toFixed(1) + '%';
    document.getElementById('halvPct').textContent       = pct.toFixed(1) + '%';
    document.getElementById('halvElapsed').textContent   = elapsedDays.toLocaleString() + ' days';
    document.getElementById('halvRemaining').textContent = days.toLocaleString() + ' days';
    document.getElementById('halvCyclePos').textContent  = elapsedDays.toLocaleString() + ' days in';
  }
}
updateHalving();
setInterval(updateHalving, 1000);

// ── MARKET CALENDAR ────────────────────────────────────────
async function fetchCalendar(){
  const el = document.getElementById('calWrap');
  function renderCalendar(events){
    if(!events.length){ el.innerHTML='<div class="cal-empty">No events scheduled this week.</div>'; return; }
    function renderEvent(e){
      return `<div class="cal-event">
        <div class="cal-date">
          <span class="cal-day">${e.day||'--'}</span>
          <span class="cal-month">${e.month||''}</span>
        </div>
        <div class="cal-info">
          <div class="cal-tag cal-tag-${e.type||'macro'}">${e.type||'macro'}</div>
          <div class="cal-event-title">${e.title||''}</div>
          <div class="cal-event-desc">${e.desc||''}</div>
        </div>
      </div>`;
    }
    const preview = renderEvent(events[0]);
    const rest = events.slice(1).map(renderEvent).join('');
    el.innerHTML = `<div class="cal-preview">${preview}</div>${rest?`<div class="cal-full" id="calFull">${rest}</div>`:''}`;
  }
  // Render from cache immediately
  const cached = loadCache('bl_cal', 3600000);
  if(cached && cached.data) renderCalendar(cached.data);
  try{
    const res = await fetch(`${BASE}/calendar.json?t=${Date.now()}`);
    if(!res.ok) throw new Error();
    const events = await res.json();
    renderCalendar(events);
    saveCache('bl_cal', events);
    if(!events.length){ el.innerHTML='<div class="cal-empty">No events scheduled this week.</div>'; return; }

  }catch(e){
    if(!cached) el.innerHTML='<div class="cal-empty">Calendar unavailable</div>';
  }
}

// ── GLOSSARY ───────────────────────────────────────────────
const GLOSSARY = [
  {term:'Altcoin', def:'Any cryptocurrency other than Bitcoin. The term covers thousands of tokens including Ethereum, Solana and XRP. Altcoins typically follow Bitcoin\'s price direction but with higher volatility.'},
  {term:'ATH — All-Time High', def:'The highest price an asset has ever reached. Bitcoin\'s current ATH is around $108,000 reached in early 2025. Distance from ATH is a key indicator of where we are in the market cycle.'},
  {term:'Bear Market', def:'A prolonged period of falling prices, typically defined as a decline of 20% or more from recent highs. In crypto, bear markets can last 12-24 months and often see prices fall 70-90% from ATH.'},
  {term:'Block', def:'A batch of validated transactions permanently recorded on the blockchain. Each block is cryptographically linked to the previous one, forming the chain. Bitcoin produces a new block approximately every 10 minutes.'},
  {term:'Block Reward', def:'The amount of new Bitcoin created and awarded to the miner who successfully adds a new block. Currently 3.125 BTC per block after the 2024 halving. This reward halves approximately every four years.'},
  {term:'Bull Market', def:'A sustained period of rising prices and positive market sentiment. Bitcoin\'s bull markets have historically produced gains of 1,000% or more, often triggered by halving events and increased institutional adoption.'},
  {term:'CEX — Centralised Exchange', def:'A company-operated trading platform like Binance or Coinbase where users create accounts and trade. The exchange holds custody of user funds. Offers high liquidity and ease of use but requires trusting a third party.'},
  {term:'Cold Wallet', def:'A crypto wallet that stores private keys offline, disconnected from the internet. Hardware devices like Ledger are the most common cold wallets. Considered the safest way to store significant amounts of crypto long term.'},
  {term:'DeFi — Decentralised Finance', def:'Financial services built on blockchain networks using smart contracts, with no banks or intermediaries. Includes lending, borrowing, trading and yield generation. Operates 24/7 and is accessible to anyone with a wallet.'},
  {term:'DEX — Decentralised Exchange', def:'A trading platform that operates via smart contracts on a blockchain. Users trade directly from their wallets with no account or identity verification required. Uniswap, Jupiter and Hyperliquid are leading DEXs.'},
  {term:'Dominance', def:'Bitcoin\'s share of the total cryptocurrency market capitalisation, expressed as a percentage. High dominance means capital is concentrated in BTC. Falling dominance often signals capital rotating into altcoins — altcoin season.'},
  {term:'Fear & Greed Index', def:'A sentiment indicator that measures market emotion on a scale from 0 (Extreme Fear) to 100 (Extreme Greed). Extreme fear can signal buying opportunities. Extreme greed often precedes corrections. Updated daily.'},
  {term:'Gas Fees', def:'Transaction fees paid to validators on networks like Ethereum to process and confirm transactions. Fees vary based on network congestion. L2 networks like Arbitrum and Base offer significantly lower gas fees than Ethereum mainnet.'},
  {term:'Halving', def:'A programmed event that cuts Bitcoin\'s block reward in half approximately every four years (every 210,000 blocks). It reduces the rate of new Bitcoin supply. Previous halvings in 2012, 2016, 2020 and 2024 have preceded major bull markets.'},
  {term:'Hot Wallet', def:'A crypto wallet connected to the internet — such as a browser extension or mobile app. Convenient for frequent transactions but more exposed to hacking risks. Best used for small amounts of crypto for daily use.'},
  {term:'Layer 1 (L1)', def:'A base blockchain network that handles its own security, consensus and transaction settlement. Bitcoin, Ethereum and Solana are L1s. They are highly secure but can be slower and more expensive at scale.'},
  {term:'Layer 2 (L2)', def:'A network built on top of a Layer 1 that processes transactions faster and cheaper, then settles back to the L1. Examples include Arbitrum, Base and Optimism on Ethereum. L2s inherit L1 security while improving scalability.'},
  {term:'Liquidity', def:'How easily an asset can be bought or sold without significantly affecting its price. High liquidity means tight spreads and fast execution. Low liquidity means larger price impact when trading. Bitcoin and Ethereum have the highest crypto liquidity.'},
  {term:'Market Cap', def:'Total market value of a cryptocurrency, calculated by multiplying its current price by circulating supply. Used to compare the relative size of different assets. Bitcoin\'s market cap is currently around $1.4 trillion.'},
  {term:'Mempool', def:'Short for memory pool — the waiting area where unconfirmed Bitcoin transactions sit before being picked up by miners and added to a block. A congested mempool means higher fees and slower confirmations.'},
  {term:'Node', def:'A computer that participates in a blockchain network by storing a copy of the entire transaction history and validating new transactions. Bitcoin has over 20,000 active nodes worldwide, making it extremely difficult to attack or censor.'},
  {term:'Private Key', def:'A unique cryptographic code that proves ownership of a wallet and authorises transactions. Must never be shared with anyone. Anyone with your private key has complete control over your funds with no way to reverse transactions.'},
  {term:'Proof of Work (PoW)', def:'Bitcoin\'s consensus mechanism. Miners compete to solve complex mathematical puzzles to add new blocks and earn rewards. Requires significant computing power and energy, which makes the network highly secure and resistant to attack.'},
  {term:'Proof of Stake (PoS)', def:'A consensus mechanism where validators lock up (stake) cryptocurrency as collateral to earn the right to validate transactions and create new blocks. Used by Ethereum since 2022. More energy efficient than Proof of Work.'},
  {term:'Smart Contract', def:'Self-executing code stored on a blockchain that automatically carries out predefined actions when conditions are met — with no intermediary required. The foundation of DeFi, NFTs and most blockchain applications beyond simple payments.'},
  {term:'Stablecoin', def:'A cryptocurrency designed to maintain a stable value, typically pegged 1:1 to the US dollar. USDT and USDC are the largest stablecoins. Used as a safe haven during volatility and as a medium of exchange in DeFi.'},
  {term:'Staking', def:'Locking up cryptocurrency in a network to support its operations — validating transactions and securing the blockchain. In return, stakers earn rewards, similar to interest. Available on Ethereum, Solana and many other networks.'},
  {term:'TVL — Total Value Locked', def:'The total amount of assets deposited in a DeFi protocol or blockchain network. A key metric for measuring the size and adoption of DeFi platforms. Higher TVL generally indicates greater trust and usage.'},
  {term:'Validator', def:'A participant in a Proof of Stake blockchain who locks up cryptocurrency to earn the right to validate transactions and create new blocks. Validators earn rewards for honest behaviour and can be penalised (slashed) for acting dishonestly.'},
  {term:'Whale', def:'An individual or entity holding a very large amount of cryptocurrency — large enough that their trades can move markets. Whale activity is closely monitored by traders as large buys or sells can signal major price movements.'},
];

function renderGlossary(){
  const el = document.getElementById('glossaryList');
  if(!el) return;
  el.innerHTML = GLOSSARY.sort((a,b)=>a.term.localeCompare(b.term)).map(g=>`
    <div class="glossary-item">
      <div class="glossary-header" onclick="toggleGlossary(this)">
        <span class="glossary-term">${g.term}</span>
        <span class="glossary-arrow">▼</span>
      </div>
      <div class="glossary-body">
        <div class="glossary-def">${g.def}</div>
      </div>
    </div>`).join('');
}

function toggleGlossary(header){
  const item = header.parentElement;
  item.classList.toggle('open');
}

// ── INIT ──────────────────────────────────────────────────
// Run news and calendar immediately — no API dependency
async function fetchGoldBtcRatio(){
  try{
    // Get BTC and Gold prices from cached data or fetch
    let prices = cachedMarketData;
    if(!prices || !prices.length){
      await new Promise(r=>setTimeout(r,2000));
      prices = cachedMarketData;
    }
    if(!prices || !prices.length) throw new Error('No data');

    const btc = prices.find(p=>p.id==='bitcoin');
    const gold = prices.find(p=>p.id==='pax-gold');
    if(!btc || !gold) throw new Error('Missing prices');

    const btcPrice = btc.current_price;
    const goldPrice = gold.current_price; // ~1 oz gold in USD
    const ratio = (goldPrice / btcPrice).toFixed(6);
    const btcMcap = btc.market_cap / 1e12;
    const goldMcapT = 21; // ~$21T gold market cap
    const mult = (goldMcapT / btcMcap).toFixed(1);
    const totalM = goldMcapT + btcMcap;
    const goldPct = ((goldMcapT / totalM) * 100).toFixed(1);
    const btcPct = ((btcMcap / totalM) * 100).toFixed(1);

    document.getElementById('goldBtcRatioVal').textContent = ratio + ' BTC';
    document.getElementById('goldBtcRatioSub').textContent = `1 oz gold = ${ratio} BTC at current prices`;
    document.getElementById('goldBtcMult').textContent = mult + 'x';
    document.getElementById('goldBtcMultSub').textContent = `Gold is ${mult}x larger than BTC by market cap`;
    document.getElementById('ratioSegGold').style.width = goldPct + '%';
    document.getElementById('ratioSegBtc').style.width = btcPct + '%';
    document.getElementById('ratioGoldPct').textContent = 'Gold ' + goldPct + '%';
    document.getElementById('ratioBtcPct').textContent = 'BTC ' + btcPct + '%';

    // Dynamic insight
    let insight = '';
    const ratioNum = parseFloat(ratio);
    if(ratioNum < 0.02){
      insight = `At ${ratio} BTC per oz of gold, Bitcoin is expensive relative to gold by historical standards. Gold is cheap in BTC terms. This ratio tends to compress during Bitcoin bull runs when BTC outpaces gold.`;
    } else if(ratioNum < 0.05){
      insight = `The Gold/BTC ratio of ${ratio} reflects a balanced relationship between the two assets. Neither is historically cheap or expensive relative to the other. Watch this ratio for early signals of capital rotation.`;
    } else {
      insight = `At ${ratio} BTC per oz of gold, gold is expensive in BTC terms. This is typical in bear markets or early accumulation phases when Bitcoin is underperforming. Historically, a high ratio has preceded significant BTC outperformance.`;
    }
    document.getElementById('goldBtcInsight').innerHTML = `<strong style="color:var(--gold)">BitLogic Analysis:</strong> ${insight}`;

  }catch(e){
    document.getElementById('goldBtcRatioVal').textContent = '--';
    document.getElementById('goldBtcInsight').textContent = 'Data unavailable';
  }
}

// Initialization — see parallel block below
// Start everything in parallel
fetchMarket();
fetchTrend();
fetchNews();
fetchCalendar();
// Pre-fetch fed liquidity so View Logic panel works without opening Macro tab
fetch(`${BASE}/data/fed-liquidity.json?t=${Date.now()}`).then(r=>r.ok?r.json():null).then(d=>{ if(d) window._fedLiqData=d; }).catch(()=>{});

// Open tab from URL hash if present
(function(){
  const valid = ['home','insights','bitcoin','alts','macro','resources','about','accumulation','news'];
  const hash  = window.location.hash.replace('#','');
  if(valid.includes(hash)) switchTab(hash);
})();

window.addEventListener('scroll',()=>{
  const b=document.getElementById('backToTop');
  if(b) b.classList.toggle('visible',window.scrollY>window.innerHeight*0.5);
},{passive:true});

// Refresh intervals
setInterval(fetchMarket, 60000);
setInterval(fetchTrend, 300000);
renderGlossary();

// Render email via JS
const em = document.getElementById('footerEmail');
if(em){ const e='bitlogic.engine'+'@'+'gmail.com'; em.href='mailto:'+e; em.textContent=e; }
